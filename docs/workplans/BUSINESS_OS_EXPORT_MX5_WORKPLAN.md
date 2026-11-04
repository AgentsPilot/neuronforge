# Workplan: Business OS Export MX-5 (E8) — Admin "Send export to owner"

> **Last Updated**: 2026-11-04

**Developer:** Dev (EXPORT session)
**Step:** E8 (user's numbering) = doc slice MX-5
**Requirement:** [BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md) §6 (MX-5 row), §7 (AC MX-5), §9 (BQ-30, answered 2026-11-03; BQ-E5-1), §10 (XC-7, XC-13, XC-19, XC-20, XC-21), §11 (S-6, S-13, B.1 UI and Routes rows)
**Plan:** [BUSINESS_OS_EXPORT_REDESIGN_PLAN.md](/docs/workplans/BUSINESS_OS_EXPORT_REDESIGN_PLAN.md) §3 (CC-1…CC-8, frozen interfaces), §4.8 (quoted in §2 below)
**Earlier slices this builds on:** [MX-1a](/docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md) (start function with the admin limit, `startForAdmin`, BQ-30a), [MX-1b](/docs/workplans/BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md) (owner route, drawer, "Sent by AgentPilot support" tag), [MX-3](/docs/workplans/BUSINESS_OS_EXPORT_MX3_WORKPLAN.md) (worker, recipient at send time), [MX-3.1](/docs/workplans/BUSINESS_OS_EXPORT_MX3_1_WORKPLAN.md) (admin ZIP removed, placeholder line), [MX-4](/docs/workplans/BUSINESS_OS_EXPORT_MX4_WORKPLAN.md) (`hasAdminOriginRequest`, history paging, limit hint)
**Coordination:** `C:/Users/Barak/My Projects/AgentsPilot/SELF_SERVICE_EXIT_COORDINATION.md` (outside git). CC-1 read on 2026-11-03: the last line is the EXPORT "E8 (MX-5) STARTED" entry (no lock, no migration, `BusinessDetail.tsx` and `page.tsx` not edited). No lock held by either session that MX-5 needs. The cleanup-regen lock is not needed (no migration)
**Branch:** `feature/bos-export-mx5-admin-send` (RM-created, worktree `neuronforge-mx5`, off `origin/main` `4c389406`). Dev confirmed it with `git branch --show-current` on 2026-11-03 before writing this file. Not `main`
**Date:** 2026-11-03
**Status:** SA approved, QA passed after the Bug 1 fix, user approved the diff 2026-11-04; PR #623 open. Live checks L-1…L-5 owed after deploy

---

## Overview

MX-5 gives an admin one action in the Businesses drawer (`/admin/users`): **send an owner their own module export, to the owner's login email**. It replaces the one placeholder line MX-3.1 left in the "Data export" box. Almost everything it needs already exists. The start function of migration 20261095 already takes `origin = 'admin'` with an admin actor id and counts the admin's 2 per owner per rolling 24 hours apart from the owner's own 2. The repository already has `startForAdmin`. The worker already reads the recipient from the login at send time, whatever the origin. The owner's drawer already labels an admin-origin request "Sent by AgentPilot support". The deletion receipt already reads `adminExportExisted` from admin-origin requests.

So MX-5 is one admin route (POST to send, GET for the box), an inside-only rewrite of `DataExportBlock`, two small read options in the request repository, the admin wording of the "Export requested" email, the registry and guard entries, and tests. DELETE's new safety rule is built in: **a closed and anonymised login is refused before the start function is called**, so nothing is started, counted, exported or emailed.

**No lock, no migration, no manual prod gate, no switch.** Effort 🟢 1.5 d budgeted, 1.75 d planned (§9 has the fallback split).

---

## Table of Contents

1. [Analysis summary (evidence)](#1-analysis-summary-evidence)
2. [Approved scope (plan §4.8) and the user's decision](#2-approved-scope-plan-48-and-the-users-decision)
3. [Constraints carried into this slice](#3-constraints-carried-into-this-slice)
4. [Design](#4-design)
5. [Files to create / modify](#5-files-to-create--modify)
6. [Task list](#6-task-list)
7. [Test plan](#7-test-plan)
8. [Verification and live checks](#8-verification-and-live-checks)
9. [Effort and fallback split](#9-effort-and-fallback-split)
10. [Coordination (CC-1 … CC-8)](#10-coordination-cc-1--cc-8)
11. [Acceptance criteria mapping](#11-acceptance-criteria-mapping)
12. [Risks](#12-risks)
13. [Open questions for SA](#13-open-questions-for-sa)
14. [Open questions for the user](#14-open-questions-for-the-user)
15. [Live schema checks requested](#15-live-schema-checks-requested)

---

## 1. Analysis summary (evidence)

Every claim below was read on this branch (`4c389406`). Line numbers are as read.

| # | Question | Answer | Evidence |
|---|---|---|---|
| E-1 | Does the start function already accept `origin = 'admin'` plus an admin actor id? | **Yes.** It refuses `(p_origin = 'admin') <> (p_admin_actor_id IS NOT NULL)` with 22023. "One in flight" and the rolling-24 h count both filter `req.origin = p_origin`. The admin limit is the literal `2` (`CASE WHEN p_origin = 'owner' THEN 2 ELSE 2 END`). The table CHECK `business_os_export_requests_admin_shape` enforces the same shape | `supabase/migrations/20261095_business_os_export_requests.sql` l.176–238, l.63–66 |
| E-2 | Is there a repository method for it? | **Yes**, `startForAdmin(ownerUserId, adminUserId, modules)`. It Zod-checks both uuids and the modules, sends `p_origin: 'admin'` and `p_admin_actor_id`, and maps 22023 / 23503 to `invalid_arguments` / `unknown_account` | `lib/repositories/BusinessOsExportRequestRepository.ts` l.199–209, l.211–280 |
| E-3 | Is the admin limit mirrored and pinned? | **Yes.** `MODULE_EXPORT_POLICY.ADMIN_DAILY_LIMIT_PER_OWNER = 2`, pinned against the SQL literal by the migration test | `lib/business-os/data-export/moduleExportPolicy.ts` l.25; `supabase/migrations/__tests__/business-os-export-requests.migration.test.ts` l.93 |
| E-4 | Are owner and admin exports independent (BQ-30a)? | **Yes, already.** Both checks filter on origin, so an admin send never blocks or uses up the owner's allowance, and the other way round. The owner's "export again at" hint reads `origin = 'owner'` only | migration l.203–224; `findOwnerLimitAnchor` l.377–405 (`.eq('origin', 'owner')`) |
| E-5 | How does the worker pick the recipient for an admin-origin request? | **The same way as for an owner request**: `deps.findIdentity(job.user_id)` = `AuthAccountRepository.findUserIdentity`, read at send time. The origin is only carried into the audit `details`. An empty or `.invalid` email makes the job `no_recipient` (nothing sent). No change to the worker | `lib/business-os/data-export/moduleExportWorker.ts` l.372–410; `moduleExportWorkerDeps.ts` l.50 |
| E-6 | How is a banned account's email read? | `auth.admin.getUserById` returns banned users with their email; a ban only sets `banned_until`. DELETE's lock seam reads `banned_until` and the email from the same call. So `findUserIdentity` works for a locked (banned) live account, and the worker sends to it | `lib/repositories/AuthAccountRepository.ts` l.210–235; `lib/repositories/AccountLockRepository.ts` l.125–155 |
| E-7 | How does DELETE mark a closed (anonymised) login? | Two ways in DELETE's code. **(1)** The placeholder email `deleted-{12 hex}@deleted.invalid`, recognised by the pure helper `isClosedAccountEmail(email)`. **(2)** `AccountLockRepository.readLoginState().isTombstone`, which is true on any of three signals: that same placeholder, `app_metadata.deleted === true`, or a ban more than 99 years out. The cleanup function writes all three (placeholder at l.4109 and `raw_app_meta_data ... 'deleted', true` at l.4380 of 20261104, plus a 100-year ban) | `lib/business-os/account-deletion/closedAccount.ts` l.15–20; `AccountLockRepository.ts` l.18–22, l.147–150; `closureLifecycle.ts` l.93 (`TOMBSTONE_BAN_MIN_YEARS = 99`); `supabase/migrations/20261104_operator_test_account_cleanup_meeting_replaces.sql` |
| E-8 | Which detection does MX-5 use? | **(1), the helper**, as DELETE asked. It is pure and client-safe, matches only the exact placeholder the cleanup function writes, and is already used by `app/api/admin/user-emails/route.ts` (`adminAccountLabel`) and by `AccountLockRepository`. Way (2) is out of reach: `AccountLockRepository` is pinned to its own files by `accountClosureRepositories.callers.guard.test.ts` (DELETE-owned), and `findUserIdentity` does not return `app_metadata` or `banned_until`. The pattern is **not** copied. SA-Q1 asks whether (2)'s extra signals are wanted | as E-7 |
| E-9 | Backstops behind that check | `emailTransport` refuses any `.invalid` recipient (`isInvalidDomainRecipient`, l.348–363, l.876–882); the owner route and the worker already refuse such an address. Backstops only: none of them stops the start function from creating a request and using an allowance | `lib/notifications/emailTransport.ts`; owner route l.296–303 |
| E-10 | How do admin-origin rows show in the owner's history? | Already labelled. `listRecentForUser` reads every origin, `assembleExportHistory` keeps `origin`, and the drawer renders `copy.origin.admin` ("Sent by AgentPilot support", en / he / es) | `ExportDrawer.tsx` l.257–258; `exportDrawerCopy.ts` l.104, l.137, l.171; `exportHistory.ts` l.27–33 |
| E-11 | Audit events | `DATA_EXPORT_REQUESTED`: the definition already says "by the owner or an admin" and carries `details.origin`; audience `shared`; owner label "Data export requested"; its details are **not** neutralised for the owner (MX-4a SA Q-6 d). `DATA_EXPORT_MODULE_SENT` / `_FAILED` are written by the worker with `origin` | `lib/audit/events.ts` l.118–138, l.1009–1053; `eventAudience.ts` l.109–117; `ownerEventPresentation.ts` l.16–19, l.39 |
| E-12 | Deletion receipt | `hasAdminOriginRequest` (head count, origin `admin`) makes `adminExportExisted` true once an admin send exists. DELETE confirmed this is intended (§10) | `BusinessOsExportRequestRepository.ts` l.408–435 |
| E-13 | Admin route pattern | `requireAdmin(logger)` as the first statement, path id by Zod uuid then lower-cased, `context: { params: { id: string } }` | `app/api/admin/users/[id]/deletion/preview/route.ts` l.55–74 |
| E-14 | "Authz registry" (S-13) | Two places: the admin gate census `app/api/admin/__tests__/adminGate.writes.test.ts` (`CASES`, `toHaveLength(66)` with its arithmetic comment, l.497–525) and the register table in `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (last row 125; rows 115–117 struck by MX-3.1). The surface guard's gated-handler counts are floors, so it needs no edit | as named; `lib/admin/__tests__/admin-authz-surface.guard.test.ts` |
| E-15 | CI guards that constrain the route | `oneExportControl.guard.test.ts` check 6 requires `app/api/admin/users/[id]/data-exports` **not to exist**, so the new route must not reuse that folder name. Check 4 only scans `/api/business-os/...` paths, so an admin path is not caught. `exportRequestRepositories.callers.guard.test.ts` says "MX-5 adds the admin route in its own diff here". `authAccountRepository.callers.guard.test.ts` pins the callers of `findUserIdentity` | `components/business-os/data-export/__tests__/oneExportControl.guard.test.ts` l.39, l.161; callers guards as named |
| E-16 | `DataExportReasonDialog.tsx` | **Deleted** in MX-3.1 (`6cbd72e7`). It collected a 5–500 character reason for the admin ZIP prepare and download, recorded on an **admin-owned** audit row so the owner never saw it. See §4.7 and BQ-E8-2 | `git show 6cbd72e7^:app/admin/users/components/DataExportReasonDialog.tsx` |
| E-17 | Can the admin box reuse the owner's export drawer? | **Not the component.** `ExportDrawer` is built on `SettingsDrawer` (a named exception, "ExportDrawer only", SA MX1B-2), `useExportDrawer` calls the owner's browser seam, and the copy is the owner's three languages. The admin console is English only and has its own dialog and box primitives. The box reuses the **pure** pieces: `enabledModules()` and each module's `name.en` (`exportModules.ts` is pure and client-safe, MX-0 SA C-1), and the history status words | `ExportDrawer.tsx` l.1–60; `exportModules.ts` header, l.181 |
| E-18 | What guards the admin box today | `app/admin/users/__tests__/source.guard.test.ts` l.625–660: no `fetch(`, no browser seam, no `data-exports`, the placeholder line; the box never touches the danger area; `BusinessDetail.tsx` mounts it once as `<DataExportBlock key={user.id} accountId={user.id} />` between the Activity section and the danger area; no backslash in the copy file | as named |
| E-19 | "Export requested" email | Its first line is "You asked for an export of your AgentPilot data on {date} at {time}." That is wrong for an admin send. See BQ-E8-1 | `lib/business-os/data-export/exportRequestedEmail.ts` l.55–62 |
| E-20 | Would a read on drawer open break other tests? | **Yes.** DELETE's drawer pin tests fix the exact list of requests one drawer opening sends (`businessDrawer.pins.dangerReads.render.test.tsx` l.317–329, `commonReads`: "seven common reads", READS-1…4) and the shared pin harness fails a test on any unexpected request. The layout test routes only known URLs (l.228–230) and pins the placeholder text (l.842). So the box must send **nothing** when the drawer opens; it reads only when the admin opens the send dialog (§4.8). Then only one asserting line in the layout test changes | `app/admin/users/__tests__/businessDrawer.pins.dangerReads.render.test.tsx`; `businessDrawer.layout.render.test.tsx` l.228, l.835, l.842 |

---

## 2. Approved scope (plan §4.8) and the user's decision

| Field | Value (quoted from the plan, struck parts dropped) |
|---|---|
| Goal | Admin route `requireAdmin` first, authz registry entry, owner id from the path (`tenant-isolation-guard`), recipient = owner's login email at send time, its own limit 2 per owner per 24 h (in the start function, already built in MX-1a), not counted to the owner; works for a locked (banned) account. The admin ZIP is already removed (MX-3.1, BQ-E6.1-1) |
| Touches | New route under `app/api/admin/users/[id]/` + tests; admin authz registry (add own entry, S-13); `app/admin/users/components/DataExportBlock.tsx` **inside only** (replaces MX-3.1's placeholder line); `app/admin/users/dataExportCopy.ts`. `DataExportReasonDialog.tsx` no longer exists (E-16) |
| Lock / migration | No / none |
| Switches | None |
| Effort | 🟢 1.5 d |
| Done when | AC MX-5; tested against a banned user directly (does not wait for DL-4) |
| Coordination | CC-1; S-13 own entries only; do **not** edit `BusinessDetail.tsx` or `app/admin/users/page.tsx`; keep the `DataExportBlock` test ids |

**User decision, 2026-11-03 (binding): BQ-30 and BQ-30a answered "Yes, as suggested".**
- The admin can only send the owner's own module export (the same per-area CSV emails) to the owner's login email, including when the account is locked, at most 2 a day per owner.
- The admin never receives or sees client data.
- Owner exports and admin exports are independent: neither blocks the other or uses up the other's allowance.

**Added by the coordinator, 2026-11-03 (from DELETE): closed logins.** After DELETE's close-and-anonymise the `auth.users` row still exists, its email is the closed placeholder, it is banned, it has no identities, and the owner's data rows are gone. "Send export to owner" must refuse that login, must not email the placeholder, must not start a request or use up the admin's allowance, and must not export anything. "Works when locked" applies only to a lock on a **live** account (banned, not anonymised). Use DELETE's helper `isClosedAccountEmail`; do not copy the pattern; run the check before the start function.

---

## 3. Constraints carried into this slice

| Rule | How MX-5 meets it |
|---|---|
| CLAUDE.md rule 1 (repositories only) | Reads and the start go through `BusinessOsExportRequestRepository`, `BusinessOsExportModuleJobRepository`, `AuthAccountRepository` and `userPreferencesRepository`. No `.from(` in the route |
| Rule 2 (Zod first) | Path id `z.string().uuid()`, then lower-cased. POST body `z.object({ modules: requestedModulesSchema() }).strict()`, so a `userId`, `email`, `to` or any other key is a 400. GET takes no query (any key is a 400) |
| Rule 3 (Pino + correlationId) | `logger.child({ correlationId })`; ids, counts and codes only; never an email |
| Rule 4 / `tenant-isolation-guard` | The owner id comes **only** from the path, after `requireAdmin`; the admin id only from `requireAdmin`. Every repository call is keyed on the path id. Service role is the repositories' documented choice (the tables are server-write-only) |
| Security: `requireAdmin` first | The first statement of both handlers. Nothing is parsed, read, rate-limited or written above it (route tests T-G1…T-G4, `adminGate.writes`) |
| XC-19 | Nothing reads a plan, tier or lifecycle state, and nothing imports `lib/business-os/entitlements/` (so the `business-os-entitlements` skill does not apply) |
| XC-20 | Recipient = the owner's login email, read at request time for the checks and again by the worker at send time; the admin's own email is never read |
| XC-21 rule 7 | No new pattern: the route copies the owner route's shape and the AD-1b admin path pattern |
| S-6 | `BusinessDetail.tsx` and `page.tsx` are not edited; the mount line stays exactly `<DataExportBlock key={user.id} accountId={user.id} />` |
| Test ids | `drawer-section-export`, `drawer-box-export` (from `DrawerBox`) and `data-export-block` are kept. `data-export-placeholder` goes with the placeholder (SA-Q6) |
| Hazards | No `git stash`; no truncating writes; no backslash in the copy file or this doc; CRLF kept; the `node_modules` junction untouched; no secret printed |

---

## 4. Design

### 4.1 The route

**New file:** `app/api/admin/users/[id]/export-sends/route.ts` (not `data-exports`, see E-15). `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30`, `Cache-Control: no-store` on every answer.

**POST `/api/admin/users/<uuid>/export-sends`** with body `{ modules: [...] }`. The order, with nothing before step 1:

| Step | Action | Refusal |
|---|---|---|
| 1 | `requireAdmin(requestLogger)` | 401 / 403 from the gate (a 403 writes its one refusal row) |
| 2 | Path id: Zod uuid, then lower-cased | 400 `invalid_input` |
| 3 | Body: blank = `{}`; invalid JSON = 400; strict `{ modules }` with `requestedModulesSchema()` (MX-0 ids, switched on, no duplicate) | 400 `invalid_input` |
| 4 | `rateLimit(request, 'admin-export-send', RATE_LIMITS.create)` | 429 |
| 5 | Self-send check (SA-Q4, default refuse): path id = admin id | 409 `admin_self_send` |
| 6 | `authAccountRepository.findUserIdentity(ownerId)` | error → 500; `null` → 404 `account_not_found` |
| 7 | **Closed login:** `isClosedAccountEmail(identity.email)` | 409 `account_closed`. No start call, no audit row, no email. One `warn` with ids and the code |
| 8 | Usable email: trimmed, not empty, not `isInvalidDomainRecipient` | 409 `export_no_login_email` (the owner route's code) |
| 9 | `startForAdmin(ownerId, adminId, modules)` | error → 500 (`unknown_account` → 404); `in_progress` → 409 `export_in_progress`; `daily_limit` → 409 `export_daily_limit` + `retryAt` |
| 10 | `DATA_EXPORT_REQUESTED` with `logAndFlush` (§4.6) | never fails the request |
| 11 | "Export requested" email to the owner, admin wording (§4.5), awaited, 10 s guard, best effort; `markRequestedEmailSent` on success | never fails the request |
| 12 | 201 `{ success: true, data: { requestId, requestedEmailSent } }` | — |

The answer **never carries the owner's email**: the admin box says "sent to the owner's login email" without the address. A banned live account passes steps 6–8 unchanged, because nothing in the route reads `banned_until`.

**GET `/api/admin/users/<uuid>/export-sends`**: what the send dialog needs when the admin opens it (never on drawer open, E-20). Steps 1 and 2, then no query key allowed (400), `rateLimit(..., 'admin-export-sends-read', RATE_LIMITS.read)`, then in parallel:
- `findUserIdentity(ownerId)` → `state`: `'closed'` (the helper), `'no_login_email'`, `'not_found'` or `'ready'`. The email itself is not returned.
- the last 10 **admin-origin** requests of this owner and their jobs, assembled by the existing pure `assembleExportHistory` (module lines with status, sent time and email count; no Resend id, no failure code);
- `nextSendAt`: when the admin may send again, from the admin limit anchor (§4.3). A failed hint read is `null` plus a warn; the POST stays the authority (the MX-4b K-8 rule).

The answer is `{ success: true, data: { state, sends, nextSendAt } }`. No audit (a read of metadata, like the drawer's other reads). A failed history read is a 500, never an empty list.

### 4.2 The closed-login refusal (DELETE's rule)

- **Check:** `isClosedAccountEmail(identity.email)` from `lib/business-os/account-deletion/closedAccount.ts`, imported, never re-implemented. A route test asserts the import and that the route source holds no `deleted.invalid` or `deleted-` literal.
- **Where:** after the identity read and **before** `startForAdmin`. So there is no request row, no module job, no allowance used, no worker run, no audit "requested" or "sent", and no email.
- **What the admin sees:** GET answers `state: 'closed'`; the box shows "This account is closed. Nothing can be sent." and no picker. A POST that races a close still gets 409 `account_closed`.
- **Backstops (unchanged):** step 8's `.invalid` refusal, the worker's `no_recipient`, and `emailTransport`'s `.invalid` refusal. The design does not rely on them.
- **Second detection (E-7 way 2):** not used (E-8). SA-Q1 asks whether to add it.
- **Locked live account:** accepted. Only a tombstone signal would refuse it, and a DL lock writes only a 10-year ban, never the placeholder.

### 4.3 Limits and independence (no SQL change)

The database is the authority for both limits (E-1, E-4). Two small, additive read options in `BusinessOsExportRequestRepository`, both keyed on `user_id`:
- `listRecentForUser(userId, { limit, before, origin })`: a new optional `origin` filter (`.eq('origin', origin)`). Without it the behaviour is unchanged (the owner route and its tests are the oracle).
- `findAdminLimitAnchor(userId, since)`: the same read as `findOwnerLimitAnchor`, with `.eq('origin', 'admin')` and offset `ADMIN_DAILY_LIMIT_PER_OWNER - 1`. Both become thin wrappers over one private `findLimitAnchor(origin, ...)`; the signature and log name of `findOwnerLimitAnchor` stay.
- `nextOwnerExportAt.ts`: add `adminLimitAnchorOffset` next to `ownerLimitAnchorOffset`. `nextOwnerExportAt` itself is reused as it is: it only adds the 24 h window to the anchor.

### 4.4 Recipient and worker (no change)

The worker reads the login email by `job.user_id` at send time (E-5). For an admin-origin request that is the owner, never the admin. The worker never reads the request's `admin_actor_id`. Nothing changes in `lib/business-os/data-export/moduleExportWorker*.ts`. A test pins this (T-W1).

### 4.5 The "Export requested" email (BQ-E8-1)

The owner route sends one "Export requested" email whose first line says "You asked for an export" (E-19). For an admin send, the plan adds an `origin` input to `buildExportRequestedEmail`:
- `origin: 'owner'` (default): today's text, unchanged and pinned.
- `origin: 'admin'`: first line "AgentPilot support started an export of your AgentPilot data on {date} at {time}." The module list, the "within a few minutes" line and "If you did not ask for this, contact us at {support}." stay. English is final after the user's review; Hebrew and Spanish are drafts, like the rest of this email.

To avoid two copies of the send-with-timeout code, the owner route's private `sendRequestedEmail` moves to `lib/business-os/data-export/exportRequestedSend.ts` with an `origin` argument. The owner route imports it and keeps exporting `REQUESTED_EMAIL_TIMEOUT_MS`; its own tests are the oracle that nothing changed (SA-Q3).

### 4.6 Audit

One `DATA_EXPORT_REQUESTED` row per started send, through `logAndFlush`, as in the owner route:
- `userId` = the **owner** and `entityId` = the owner (XC-13: the row goes with the account and is deleted at stage E);
- `actorId` = the admin (from `requireAdmin`);
- `details`: `{ request_id, modules, origin: 'admin' }`. No email, no admin id in `details`, no reason.

The owner sees it in their activity as "Data export requested". That is right: the emails arrive in their mailbox anyway. The worker's `DATA_EXPORT_MODULE_SENT` / `_FAILED` rows already carry `origin`. **No new event, and no change to `events.ts` or `eventAudience.ts`.** Refusals (closed, no email, limit) write no audit row, as in the owner route; they are logged.

### 4.7 Reason prompt (BQ-E8-2)

The deleted reason dialog (E-16) served the admin ZIP: the admin **received** the owner's data, so a reason was recorded on an admin-owned row. In MX-5 the admin receives nothing, and the audit row is on the owner and is shown to the owner with its details (E-11). A reason typed there could be read by the owner. **Default: no reason prompt in MX-5;** the admin id on the audit row (`actor_id`) records who sent it. If the user wants a reason, it needs an admin-only home (a separate admin-owned row, or neutralised details). That is an SA decision and about +0.25 d.

### 4.8 The admin box (`DataExportBlock.tsx`, inside only) and its send dialog

**The box sends nothing when the drawer opens** (E-20). Same mount, same props (`accountId`), same `DrawerBox section="export"` with `testId="drawer-section-export"`, same inner `data-testid="data-export-block"`. Inside: one purpose line ("Send the owner their own data, by email to their login address. You never see the files.") and one button, **Send export to owner…** (`data-testid="data-export-send-open"`). That replaces the placeholder line.

The button opens a new dialog, `app/admin/users/components/DataExportSendDialog.tsx` (EXPORT-owned, in the place of the deleted `DataExportReasonDialog.tsx`, built on the admin dialog primitives `adminDialog` as that one was). The dialog reads `GET .../export-sends` when it opens (`cache: 'no-store'`, `clientLogger`), so the drawer's per-open request list is unchanged:

| State | What the dialog shows |
|---|---|
| Loading | One muted line |
| Read failed | "Could not load the export state." + Try again |
| `closed` | "This account is closed. Nothing can be sent." No picker, no Send |
| `no_login_email` / `not_found` | "This account has no login email the export can be sent to." No Send |
| `ready` | "Select all" + one tick box per **switched-on** module (`enabledModules()`, `name.en`), nothing ticked on open, and **Send** (disabled until a module is ticked). The dialog itself is the confirmation step: "The owner gets one email per area at their login address. You will not receive the files." |
| Limit reached (`nextSendAt` set) | Picker shown, Send disabled, line "2 sends a day per owner. You can send again at {time}." |
| After a send | The line "Sent. The owner will get one email per area at their login address." and the history is read again |
| History | "Sent by support" list, newest first, last 10: date and time, then each module with its status word (Waiting, Working, Sent, Failed, Interrupted) |

While the POST is in flight, Send is disabled and the dialog cannot be closed (Esc, overlay, X), so one press is one request (the `CreditFormDialog` / deleted reason dialog precedent). A 409 maps to its line (closed, no email, in progress, limit with time); a 500 to "Could not send. Please try again." Focus returns to the opener on close. Times use the admin console's formatter in `usersFormat.ts` (SA-Q7).

`dataExportCopy.ts`: `placeholder` goes and the new lines above are added. English only, no backslash.

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/admin/users/[id]/export-sends/route.ts` | create | POST send + GET state (§4.1) |
| `app/api/admin/users/[id]/export-sends/__tests__/route.test.ts` | create | §7.1 |
| `lib/business-os/data-export/exportRequestedSend.ts` | create | Shared "Export requested" send, moved from the owner route (§4.5, SA-Q3) |
| `lib/business-os/data-export/__tests__/exportRequestedSend.test.ts` | create | §7.3 |
| `app/api/business-os/export-requests/route.ts` | modify | Imports the moved send helper; behaviour unchanged |
| `lib/business-os/data-export/exportRequestedEmail.ts` (+ its test) | modify | `origin` input and the admin first line (§4.5) |
| `lib/repositories/BusinessOsExportRequestRepository.ts` (+ its test) | modify | `origin` option on `listRecentForUser`; `findAdminLimitAnchor` (§4.3); header comment |
| `lib/business-os/data-export/nextOwnerExportAt.ts` (+ its test) | modify | `adminLimitAnchorOffset` |
| `app/admin/users/components/DataExportBlock.tsx` | modify (inside only) | §4.8: purpose line + opener button |
| `app/admin/users/components/DataExportSendDialog.tsx` | create | §4.8: the send dialog (reads on open, picker, history, Send) |
| `app/admin/users/dataExportCopy.ts` | modify | §4.8 copy |
| `app/admin/users/__tests__/dataExportBlock.render.test.tsx` | rewrite | §7.4 |
| `app/admin/users/__tests__/dataExportSendDialog.render.test.tsx` | create | §7.4 |
| `app/admin/users/__tests__/source.guard.test.ts` | modify (Data export block only) | Replace the MX-3.1 placeholder rule with the MX-5 rules; add the dialog to `DATA_EXPORT_FILES` (§7.5). CC-3 claim first, because DELETE edits this file too |
| `app/admin/users/__tests__/businessDrawer.layout.render.test.tsx` | modify (asserting lines only) | l.842 pins the placeholder text: becomes the opener button and purpose line; l.835 (no export read on open) kept, its comment reworded. The MX-3.1 G-12 precedent. CC-3 claim first (DELETE-screen test) |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | Two cases, `66 → 68` with the arithmetic line (S-13) |
| `lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts` | modify | Allow the admin route, its test and `exportRequestedSend.ts` on the class rules |
| `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts` | modify | Allow the admin route and its test |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Rows 126–127 (GET, POST), census re-counted from disk, Last Updated, Change History (S-13) |
| `docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` | modify | **Done 2026-11-03:** BQ-30 ticked (l.315) + Change History row. Later: §6 MX-5 row note, §7 MX-5 bullets at merge |
| `docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md` | modify | **Done 2026-11-03:** BQ-30 ticked (l.519) + Change History row |
| `docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md` | modify (if SA-Q8 says so) | One line: support can send the owner their export; the admin never receives it |
| `docs/workplans/BUSINESS_OS_EXPORT_MX5_WORKPLAN.md` | create | This file |

**Not edited:** `BusinessDetail.tsx`, `app/admin/users/page.tsx`, the worker files, any migration, `events.ts`, `eventAudience.ts`, `ownerEventPresentation.ts`, `closedAccount.ts`, `AccountLockRepository.ts`, `emailTransport.ts`, `ExportDrawer.tsx` and the owner's copy.

---

## 6. Task list

- [x] **Task 0 (done by Dev, 2026-11-03):** tick BQ-30 in `BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md` §9 (l.315) and in `BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md` §12 (l.519) with the answer "Yes, as suggested" (BQ-30 + BQ-30a) and the date, and add a Change History row to each (Last Updated moved to 2026-11-03). CRLF kept
- [ ] Task 1: CC-3 claims in the coordination file for `app/admin/users/__tests__/source.guard.test.ts` (Data export block only) and `businessDrawer.layout.render.test.tsx` (the placeholder line only); CC-5 line "workplan approved" after SA
- [x] Task 2 (Dev, 2026-11-04): repository: `origin` option on `listRecentForUser`, private `findLimitAnchor`, `findAdminLimitAnchor`, `adminLimitAnchorOffset`; tests T-R1…T-R5
- [x] Task 3 (Dev, 2026-11-04): `buildExportRequestedEmail` `origin` input + admin first line (en; he and es drafts); tests T-E1…T-E3
- [x] Task 4 (Dev, 2026-11-04): move `sendRequestedEmail` to `exportRequestedSend.ts`; the owner route imports it; owner route tests pass unchanged; tests T-S1…T-S2
- [x] Task 5 (Dev, 2026-11-04): admin route POST (§4.1 steps 1–12) with the closed-login refusal before the start
- [x] Task 6 (Dev, 2026-11-04): admin route GET (state, last 10 admin sends, `nextSendAt`)
- [x] Task 7 (Dev, 2026-11-04): route tests T-G1…T-G4, T-P1…T-P16, T-H1…T-H6, and worker pin T-W1
- [x] Task 8 (Dev, 2026-11-04): `DataExportBlock.tsx` inside rewrite + new `DataExportSendDialog.tsx` + `dataExportCopy.ts`; render tests T-U1…T-U13; the layout test's placeholder line
- [x] Task 9 (Dev, 2026-11-04): guards: `adminGate.writes` (66 → 68), both callers guards, the admin `source.guard` Data export rules
- [x] Task 10 (Dev, 2026-11-04): docs: access register rows 126–127 + census; contents doc line if SA-Q8 says so; requirement §6 MX-5 row note
- [x] Task 11 (Dev, 2026-11-04): verification (§8.1), outputs recorded in the implementation notes
- [ ] Task 12: hand to SA code review, then QA (live checks §8.2)

---

## 7. Test plan

All Jest, pure, with the existing fakes; no network (`tests/jest-no-network.ts`). The route test mocks `@/lib/admin/requireAdminRoute`, the two export repositories, `AuthAccountRepository`, `userPreferencesRepository`, `ownerClock`, `emailTransport`, `logAndFlush` and `rateLimit`. `closedAccount.ts` is **not** mocked: the real helper runs on fixture emails.

### 7.1 Route (`app/api/admin/users/[id]/export-sends/__tests__/route.test.ts`)

| # | Case | Expect |
|---|---|---|
| T-G1 | POST and GET signed out | 401; no repository, rate limit, identity or email call |
| T-G2 | Not an admin | 403; nothing else called |
| T-G3 | Admin check throws | 403 (fail closed) |
| T-G4 | `requireAdmin` is the first statement of both handlers | source scan |
| T-P1 | Happy path, live account | 201 `{ requestId, requestedEmailSent: true }`; `startForAdmin(pathId, adminId, modules)`; no `startForOwner` call; email `to` = the identity's email; the response body has no email |
| T-P2 | **Banned live account** (identity fixture with a normal email; the route never reads a ban) | 201, same as T-P1 |
| T-P3 | **Closed login** (`deleted-0123456789ab@deleted.invalid`) | 409 `account_closed`; **no `startForAdmin` call, no `logAndFlush` call, no `sendEmail` call**, no `markRequestedEmailSent`; the log line holds no email |
| T-P4 | Near-miss emails that are **not** closed (a longer domain after `.invalid`, upper-case hex, 11 hex) | not `account_closed` (the helper's exact match decides; this proves the route did not loosen it). The `.invalid` ones still get `export_no_login_email` |
| T-P5 | Imports `isClosedAccountEmail` from `@/lib/business-os/account-deletion/closedAccount`; no `deleted.invalid` or `deleted-` literal in the route | source scan |
| T-P6 | Unknown account (`findUserIdentity` → null) | 404 `account_not_found`; no start |
| T-P7 | Identity read fails | 500; no start |
| T-P8 | Empty email, or another `.invalid` address | 409 `export_no_login_email`; no start |
| T-P9 | `in_progress` | 409 `export_in_progress`; no audit, no email |
| T-P10 | `daily_limit` | 409 `export_daily_limit` + `retryAt`; no audit, no email |
| T-P11 | Body with `userId`, `email`, `to` or `origin` next to `modules` | 400 (strict); no start |
| T-P12 | Module switched off, unknown or duplicated; empty list | 400 |
| T-P13 | Path id not a uuid; an upper-case uuid | 400; the upper-case one is lower-cased before every call |
| T-P14 | Self-send (path id = admin id) | 409 `admin_self_send`, if SA-Q4 rules so |
| T-P15 | Audit row | `DATA_EXPORT_REQUESTED`, `userId` = `entityId` = owner, `actorId` = admin, `details` exactly `{ request_id, modules, origin: 'admin' }` |
| T-P16 | Email fails or times out | 201 with `requestedEmailSent: false`; the request stands; the email was built with `origin: 'admin'` |
| T-H1 | GET ready | `state: 'ready'`; `sends` only admin-origin (`listRecentForUser` called with `origin: 'admin'`, limit 10); `nextSendAt` from `findAdminLimitAnchor` |
| T-H2 | GET closed | `state: 'closed'`, no email in the body |
| T-H3 | GET no email / not found | `no_login_email` / `not_found` |
| T-H4 | GET hint read fails | 200 with `nextSendAt: null` + a warn |
| T-H5 | GET history read fails | 500, never an empty list |
| T-H6 | GET with any query key | 400 |

### 7.2 Repository, helpers and worker

| # | Case |
|---|---|
| T-R1 | `listRecentForUser` without `origin`: the query is unchanged (no origin filter) |
| T-R2 | `listRecentForUser` with `origin: 'admin'`: `.eq('user_id')` and `.eq('origin', 'admin')`; a bad origin is `invalid_input` with no query |
| T-R3 | `findAdminLimitAnchor`: `.eq('origin', 'admin')`, the same embed filter, `range(1, 1)` |
| T-R4 | `findOwnerLimitAnchor`: unchanged calls and results (the existing tests pass untouched) |
| T-R5 | `adminLimitAnchorOffset()` = `ADMIN_DAILY_LIMIT_PER_OWNER - 1` = 1 |
| T-W1 | Worker: an admin-origin job is sent to `findIdentity(job.user_id)`'s email; `admin_actor_id` is never read (source scan of `moduleExportWorker*.ts`) |

### 7.3 Email

| # | Case |
|---|---|
| T-E1 | `origin` absent or `'owner'`: subject and body identical to today (existing tests) |
| T-E2 | `origin: 'admin'`: the new first line in en / he / es; no "You asked" line; escaping kept |
| T-E3 | No business name, owner name or email address other than the support contact in either wording |
| T-S1 | `exportRequestedSend`: sent / failed / timeout outcomes as before the move |
| T-S2 | The owner route's existing tests pass with no edit |

### 7.4 Admin box and dialog (`dataExportBlock.render.test.tsx`, `dataExportSendDialog.render.test.tsx`, jsdom)

| # | Case |
|---|---|
| T-U1 | Keeps `drawer-box-export`, `drawer-section-export` and `data-export-block`; heading "Data export"; the purpose line and the opener button |
| T-U2 | **No request on mount** (E-20); `GET /api/admin/users/<id>/export-sends` once when the dialog opens, `no-store` |
| T-U3 | `closed`: the closed line, no tick box, no Send |
| T-U4 | `no_login_email` / `not_found`: its line, no Send |
| T-U5 | `ready`: one tick box per switched-on module (the pinned 5), none ticked, Send disabled; Select all ticks all |
| T-U6 | Cancel / close sends nothing |
| T-U7 | Send sends one POST with `{ modules }` only (no id or email in the body); Send disabled and the dialog not closable in flight |
| T-U8 | 201: the sent line, and the history is read again |
| T-U9 | Each 409 code maps to its line; `export_daily_limit` shows the time |
| T-U10 | `nextSendAt` set: Send disabled with the limit line |
| T-U11 | History rows: date, module names in English, status words |
| T-U12 | No email address is rendered anywhere in the box or dialog |
| T-U13 | Focus returns to the opener on close |

### 7.5 Guards

| # | Guard | Change |
|---|---|---|
| T-X1 | `adminGate.writes.test.ts` | + `GET` and `POST /api/admin/users/[id]/export-sends`; arithmetic line "+ 2 `users/[id]/export-sends#GET`, `#POST` (export MX-5), gated from birth = 68"; recount by hand if another admin route lands first |
| T-X2 | `exportRequestRepositories.callers.guard.test.ts` | The admin route + its test on both class rules; `exportRequestedSend.ts` (+ its test) on the request-repository rule. The start function name stays in the repository only |
| T-X3 | `authAccountRepository.callers.guard.test.ts` | The admin route + its test |
| T-X4 | `app/admin/users/__tests__/source.guard.test.ts` | `DataExportBlock.tsx` has no `fetch(` at all; the dialog fetches only `/api/admin/users/` + `export-sends`; neither names the owner seam `@/lib/client/businessOsDataExport` or `data-exports`, or imports from `lib/repositories`; the dialog joins `DATA_EXPORT_FILES`; the danger-area rule, the mount rule and the no-backslash rule are kept unchanged |
| T-X4b | `businessDrawer.layout.render.test.tsx` and `businessDrawer.pins.*` | Layout: the placeholder assertion (l.842) becomes the purpose line + opener; "no export read on open" (l.835) still holds. The pin tests' request lists (`commonReads`, READS-1…4) pass **unchanged**, which is the proof that the box reads nothing on open |
| T-X5 | `oneExportControl.guard.test.ts` | No edit; it must still pass (the new folder is not `data-exports`, and the admin path is not an owner path) |
| T-X6 | Admin authz surface guard | No edit; must pass (`npm run test:authz-guard`) |

---

## 8. Verification and live checks

### 8.1 Before hand-over (outputs recorded in the implementation notes)

| # | Check |
|---|---|
| V-1 | Touched suites + every guard in §7.5 + `components/business-os/data-export` + `app/api/business-os/export-requests` + `lib/business-os/data-export` + `app/admin/users` |
| V-2 | `npm run test:authz-guard` |
| V-3 | Typecheck filtered to the touched files, with proof that the command did not crash (CLAUDE.md ship drill step 1) |
| V-4 | `npm run lint` on the touched files |
| V-5 | `git diff --stat` shows no edit to `BusinessDetail.tsx`, `page.tsx`, the worker files, `events.ts`, `eventAudience.ts` or any migration |
| V-6 | Full `npm test` compared against a `main` baseline run (FAIL lines deduplicated) |

### 8.2 Live checks (QA, after deploy; each needs the user's go-ahead because it changes a test account)

| # | Check |
|---|---|
| L-1 | On the `+test` account (live, not banned): send 1 module. One "Export requested" email (admin wording) and the module email(s) arrive at the `+test` login mailbox; nothing arrives at the admin's mailbox; the owner's drawer shows the request tagged "Sent by AgentPilot support" |
| L-2 | **Banned live account (AC "works for a locked account", tested directly, not via DL-4):** ban the `+test` login (Supabase dashboard, or DELETE's lock path if it is live), send again, confirm delivery, then lift the ban and record both times. The ban is an auth change on a test account, so `env-change-protocol` applies (record the exact `banned_until` before and after) |
| L-3 | A third admin send inside 24 h is refused with the time; the owner can still export for themselves (BQ-30a) |
| L-4 | Closed login: only if a closed test account already exists; otherwise Jest T-P3 covers it (no account is closed for this test) |
| L-5 | `/admin/audit-trail`: the send's `DATA_EXPORT_REQUESTED` row has the owner as user, the admin as actor and `origin: 'admin'` |

---

## 9. Effort and fallback split

| Part | Estimate |
|---|---|
| Repository options + offset helper + tests | 0.25 d |
| Email wording + moved send helper + tests | 0.25 d |
| Route POST + GET + tests | 0.5 d |
| Box + dialog + copy + render tests + the layout line | 0.5 d |
| Guards, register, docs, verification | 0.25 d |
| **Total** | **1.75 d** (budget 1.5 d) |

**Fallback, if SA wants 1.5 d:** the GET keeps `state` and `nextSendAt` but drops the "Sent by support" list (the box shows only the outcome of the send just made); the list moves to a follow-up. Or, if BQ-E8-1 is answered "no requested email for support sends", drop the email wording and the move (−0.25 d).

---

## 10. Coordination (CC-1 … CC-8)

| Item | Action |
|---|---|
| CC-1 | Read 2026-11-03; the "E8 (MX-5) STARTED" line is already there |
| CC-3 | Claim `app/admin/users/__tests__/source.guard.test.ts` (Data export block only) and `businessDrawer.layout.render.test.tsx` (the placeholder assertion only) before editing; DELETE also edits those files |
| CC-5 | Log and message `[EXPORT→DELETE] MX-5 workplan approved`, `PR opened`, `PR merged` |
| CC-6 | No shared item: no edit to `events.ts`, `eventAudience.ts`, `vercel.json`, `bosCronJobs.ts` or any migration |
| CC-7 | Frozen interfaces untouched (`findDeletionFacts`, `DataExportDeletionFacts`, `DownloadMyDataButton`) |
| S-6 | `BusinessDetail.tsx` and `page.tsx` not edited; mount line unchanged |
| S-13 | Only MX-5's own two entries in `adminGate.writes` and rows 126–127 in the register |
| **Receipt (DELETE confirmation, 2026-11-03)** | An admin-origin request makes `adminExportExisted` true in the deletion receipt (`hasAdminOriginRequest`, MX-4a, XC-12). DELETE confirmed this is intended; no change is needed and none is made |
| **Closed logins (DELETE, 2026-11-03)** | MX-5 calls DELETE's `isClosedAccountEmail` and does not copy the pattern (§4.2). If DELETE ever changes the placeholder, the helper changes with it and MX-5 follows with no edit |

---

## 11. Acceptance criteria mapping

| AC MX-5 (requirement §7) | Where proven |
|---|---|
| Only an admin can start it | T-G1…T-G4, `adminGate.writes` (T-X1), authz surface guard (T-X6) |
| The CSVs go to the owner's login email, never to the admin | T-P1 (`to` = the owner's identity), T-W1 (the worker reads `job.user_id`), T-U12, L-1 |
| Works for a locked account | T-P2, L-2 (a banned user, directly) |
| Does not use the owner's limit | E-1 / E-4 (the SQL counts per origin), T-R4, L-3 |
| Refuses a third admin send inside 24 h for the same owner | T-P10, T-U9 / T-U10, L-3 (the SQL literal is pinned by the existing migration test) |
| No admin ZIP route remains | `oneExportControl.guard` check 6 (T-X5) |
| **Added (DELETE, 2026-11-03):** a closed login is refused with nothing started, counted, exported or emailed | T-P3, T-P5, T-H2, T-U3 |

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A closed login slips past because its email is not the exact placeholder (for example a future placeholder format) | The helper is DELETE's single source. The `.invalid` backstops in the route, the worker and `emailTransport` still stop any email. SA-Q1 decides whether to add the `app_metadata.deleted` signal |
| R-2 | Moving `sendRequestedEmail` changes owner behaviour | The owner route's tests run unchanged as the oracle (T-S2). If a mock path breaks, SA-Q3's fallback is a local copy |
| R-3 | The `adminGate.writes` count collides with another admin route landing first | Recount by hand on rebase (MX-3.1 precedent) |
| R-4 | The owner reads the audit row's details | The details hold only ids, module ids and `origin` (no reason, no email) |
| R-5 | An admin and the owner run exports at the same time and the worker sends both | Intended (BQ-30a); each request's emails are separate and labelled in the history |
| R-6 | `source.guard.test.ts` and `businessDrawer.layout.render.test.tsx` are shared with DELETE | CC-3 claims; only the Data export `describe` block and the one placeholder assertion change |
| R-7 | A read on drawer open would break DELETE's request pins across several drawer tests (E-20) | The box reads nothing on open; the dialog reads on open. The unchanged pin tests prove it |

---

## 13. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| SA-Q1 | Use only `isClosedAccountEmail`, or also refuse on `app_metadata.deleted` / a ban over 99 years (DELETE's `readLoginState().isTombstone`)? The second needs either DELETE's guard to allow a new caller of `AccountLockRepository` or `findUserIdentity` to return more fields | Helper only (DELETE's instruction); the anonymise always writes the placeholder |
| SA-Q2 | Route name `export-sends` (GET + POST in one file) | Yes |
| SA-Q3 | Move `sendRequestedEmail` to `lib/business-os/data-export/exportRequestedSend.ts` (shared), or keep a second copy in the admin route | Move; this adds that file to the request-repository callers rule |
| SA-Q4 | Refuse an admin sending to their own account (DE-10a BC-6 precedent; otherwise an admin gets 2 extra self-exports a day) | Refuse, 409 `admin_self_send` |
| SA-Q5 | The GET in this slice (state, last 10 admin sends, `nextSendAt`), or only the POST with the §9 fallback | GET in this slice |
| SA-Q6 | `data-export-placeholder` disappears with the placeholder. A grep finds it in `DataExportBlock.tsx`, `dataExportBlock.render.test.tsx` and DELETE's `businessDrawer.layout.render.test.tsx` l.842 | Drop it; keep the three other ids; edit l.842 under a CC-3 claim |
| SA-Q10 | The box opens a dialog that reads on open, rather than reading on drawer open (E-20). A new file `DataExportSendDialog.tsx` in `app/admin/users/components/` (EXPORT's, in place of the deleted reason dialog) | Yes |
| SA-Q7 | Time format for "send again at" and the history | `usersFormat.ts` if it formats a timestamp; otherwise the admin console's existing date formatting with the zone labelled |
| SA-Q8 | Does the contents doc need a "support can send it" line? | One line, if the doc describes who can export |
| SA-Q9 | Refused attempts (closed, limit) write no audit row, as in the owner route. Should a refused admin send be recorded on an admin-owned row? | No; logged only |

---

## 14. Open questions for the user

| # | Question (plain language) | Suggested default |
|---|---|---|
| BQ-E8-1 | When support sends an owner their export, the owner first gets the "Your data export has started" email. Today it says "You asked for an export". Should it say "AgentPilot support started an export of your data" instead? | **Yes**, for support sends only; the owner's own exports keep today's email. Hebrew and Spanish are drafts for native review |
| BQ-E8-2 | Should the admin type a reason before sending? The old ZIP export asked for one because the admin received the data. Now the admin receives nothing, and the record of the send is shown to the owner, so a reason written there could be read by them | **No reason prompt.** The record keeps which admin sent it. If you want a reason, we keep it in an admin-only record (a small extra step) |
| BQ-E8-3 | In the admin box, show only the exports support sent, or the owner's own exports too? | **Only support's sends** (the box is about what support did); the owner sees both in their own drawer |

---

## 15. Live schema checks requested

Read-only, for SA or QA to run before merge (`business-os-schema-check`). Dev had no live database access in this session; every column below is named from migration 20261095 as merged and applied in MX-1a.

| # | Query (read-only) | Expect |
|---|---|---|
| S-1 | `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'business_os_export_requests' order by ordinal_position;` | `id, user_id, origin, admin_actor_id, modules, requested_at, requested_email_sent_at, created_at, updated_at` |
| S-2 | `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'business_os_export_request_start';` | `p_user_id uuid, p_origin text, p_admin_actor_id uuid, p_modules text[]` |
| S-3 | `select conname from pg_constraint where conname in ('business_os_export_requests_origin_check', 'business_os_export_requests_admin_shape');` | both rows |
| S-4 | `select count(*) from public.business_os_export_requests where origin = 'admin';` | 0 before MX-5 goes live |

**Done 2026-11-03 (coordinator, read-only, prod):** all four match. S-1: the columns are exactly `id, user_id, origin, admin_actor_id, modules, requested_at, requested_email_sent_at, created_at, updated_at`. S-2: one overload, `p_user_id uuid, p_origin text, p_admin_actor_id uuid, p_modules text[]`. S-3: both constraints exist (`business_os_export_requests_admin_shape`, `business_os_export_requests_origin_check`). S-4: 0 admin-origin rows.

---

## SA Review Notes

**Reviewed by SA — 2026-11-03**
**Status:** ✅ Approved with conditions (M-1 and M-2 are conditions of the code review; nothing blocks the start of implementation)

### Evidence check (read on the branch at `4c389406`)

| # | Verdict | Note |
|---|---|---|
| E-1 | ✅ | 20261095 l.176–238: the 22023 shape refusal, `req.origin = p_origin` on both the in-flight and the 24 h checks, `CASE ... THEN 2 ELSE 2`, the advisory lock per user. Table CHECK `business_os_export_requests_admin_shape` at l.63–66 |
| E-2 | ✅ | `startForAdmin` l.202–209 → private `start` (Zod uuids + modules, 22023 → `invalid_arguments`, 23503 → `unknown_account`). The repository logs `adminUserId`; no email is logged |
| E-3, E-4 | ✅ | `findOwnerLimitAnchor` has `.eq('origin', 'owner')`; the owner hint never sees admin rows |
| E-5 | ✅ | `moduleExportWorker.ts` l.376–395: `deps.findIdentity(job.user_id)`, empty or `.invalid` becomes `no_recipient`. `grep admin_actor` over `moduleExportWorker*.ts` and the job repository finds nothing, so T-W1 passes today and pins it from here on |
| E-6 | ✅ | `findUserIdentity` is `auth.admin.getUserById` and returns `{ id, email, createdAt }` only. A ban does not hide the user |
| E-7, E-8 | ✅ | `isClosedAccountEmail` is the exact anchored pattern, pure and client-safe. The reasons not to use way (2) are correct |
| E-13 | ✅ | Note the pattern: `requireAdmin(logger.child({ route, method }))` is the first statement, and the correlation logger is built **after** the gate (see M-1) |
| E-14 | ✅ | `adminGate.writes.test.ts` asserts 66 on this branch (l.525, arithmetic l.497–524). 66 → 68 is right. The access register's last row is 125, so rows 126–127 are right |
| E-15 | ✅ | `oneExportControl.guard` check 6 lists `app/api/admin/users/[id]/data-exports` as a folder that must not exist; `export-sends` is clear. The request-repository callers guard has class rules plus start-function and `.from(` rules; the admin route needs only the two class rules |
| E-19 | ⚠️ partly | True for the first line, but incomplete: `listHeading` ("The parts you chose:") and `notYou` ("If you did not ask for this, ...") are also in the owner's voice. See M-2 |
| E-20 | ✅ | `businessDrawer.pins.dangerReads.render.test.tsx` `commonReads` (seven reads) + the unexpected-request guard; the layout test l.835 (no export read) and l.842 (placeholder text). Read-on-dialog-open keeps every pin list unchanged |
| §15 S-1…S-4 | ✅ | Run read-only on prod by the coordinator on 2026-11-03; all four match (see §15) |

### Must fix (conditions; checked again at code review)

1. **M-1: `requireAdmin` must be literally the first statement of both handlers.** §4.1 step 1 reads `requireAdmin(requestLogger)`, which implies the `correlationId` child logger is built first. The authz surface guard (`firstStatementIsTheGuard`) and T-G4 would then fail, or pass only because a declaration was not counted. Follow `deletion/preview/route.ts` l.61–66: `const gate = await requireAdmin(logger.child({ route: 'admin-export-sends', method: 'POST' }))`, then `if (gate instanceof NextResponse) return gate;`, then `correlationId` and `requestLogger = logger.child({ correlationId, adminId })`. Same for GET.
2. **M-2: the admin wording must replace every owner-voiced line, not only the first.** `buildExportRequestedEmail({ origin: 'admin' })` must also swap `listHeading` (for example "The parts included:") and `notYou` (for example "If you did not expect this, contact us at {support}."), in en / he / es. The owner text stays byte-identical (T-E1). T-E2 asserts that no "You asked", "you chose" or "did not ask" text appears in the admin variant. Show the user the **whole** admin email (subject plus every line) when asking BQ-E8-1, not only the first line.

### Rulings on the SA questions

| # | Ruling |
|---|---|
| SA-Q1 | ✅ Helper only. Do not widen `findUserIdentity` or add an `AccountLockRepository` caller in this slice. Residual race: an account closed between step 7 and step 9 still gets a request row. The worker's `no_recipient` and `emailTransport`'s `.invalid` refusal then stop every email, and the owner's data rows are already gone. Accepted without a lock; say so in a one-line comment at step 7 |
| SA-Q2 | ✅ `app/api/admin/users/[id]/export-sends/route.ts`, GET and POST in one file |
| SA-Q3 | ✅ Move, on four conditions. (a) `exportRequestedSend.ts` takes the caller's logger as an argument (keeps the correlationId) and keeps the "never throws" contract and the `email_timeout` versus `email_failed` distinction. (b) The timeout constant lives in the helper; the owner route re-exports it as `REQUESTED_EMAIL_TIMEOUT_MS` with the same value. (c) The owner route test files (`route.test.ts`, `route.qa.test.ts`) pass with **no edit**. If any of them needs an edit, stop and report before falling back to a local copy. (d) The helper goes on the request-repository class rule only |
| SA-Q4 | ✅ Refuse with 409 `admin_self_send`. Compare the lower-cased path id with `gate.user.id` before the identity read. Should-fix S-1 below lets the dialog know before Send |
| SA-Q5 | ✅ GET in this slice. 1.75 d accepted. The §9 fallback (drop the history list) is pre-approved if the box and dialog run over |
| SA-Q6 | ✅ Drop `data-export-placeholder`; keep the other three ids; edit layout l.842 under the CC-3 claim |
| SA-Q7 | `usersFormat.ts` has **no** timestamp formatter (only `ageLine`, `formatCost`, `formatNumber`), so the first default does not apply. Reuse the date formatting the drawer's other sections already render. Only if there is none, use one inline `Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' })` in the dialog. No new shared formatter module in this slice |
| SA-Q8 | ✅ One line, only if the contents doc already says who can start an export |
| SA-Q9 | ✅ No audit row for refused sends; logged only (ids and code). A 403 already records refused access through the gate |
| SA-Q10 | ✅ `DataExportSendDialog.tsx` reads on open; it joins `DATA_EXPORT_FILES` in `source.guard` |

### Specific checks requested by TL

- **POST order:** correct as written in §4.1 once M-1 is applied. Gate, path id, body (strict), rate limit, self-send, identity, closed, usable email, start, audit, email, 201. No read and no write happens before step 6, and nothing that writes happens before step 9.
- **Closed login before any write:** ✅ step 7, before `startForAdmin`, `logAndFlush`, `sendEmail` and `markRequestedEmailSent`. T-P3 asserts all four are not called. Keep T-P5's source scan (the import is present, no placeholder literal).
- **Tenant isolation (service role, id from the path):** ✅ The owner id comes only from the path (Zod uuid, lower-cased) and the admin id only from the gate. The body is strict, so no id or email can be injected. Every repository call is keyed on the path id, and the recipient is read from the auth row of that same id, at request time and again by the worker at send time. The admin is cross-tenant by role; the data never reaches the admin.
- **Error format:** 409 bodies carry `{ success: false, code, error }` with a fixed English message and **no** `details`. 500 bodies use `devDetails()` (development only). `unknown_account` maps to 404 and `invalid_arguments` to 500. The 201 body must **not** copy the owner route's `sentTo` (T-P1 asserts this). The admin console gets the 409 codes in production by design: they are fixed codes, not internal detail.
- **Pino:** `requestLogger` child with `correlationId` and `adminId` after the gate (M-1); ids, counts and codes only; never the email, including in the closed-refusal warn.
- **Audit:** `logAndFlush` is bounded and never rejects, which is the owner route's accepted pattern (new-api-route skill, awaited audit with flush). `actorId` is supported by `AuditTrailService` (l.212).
- **Refactor of `sendRequestedEmail`:** see SA-Q3 (c). The `jest.mock` paths in the owner tests are module-wide, so the moved helper is still mocked.

### Should fix

- **S-1:** GET returns `state: 'self'` when the path id is the admin's own id, so the dialog shows "You cannot send an export to your own account." and no Send, instead of a 409 after the press.
- **S-2:** the GET's module-job read for the history goes through `BusinessOsExportModuleJobRepository`, as the owner GET does. T-X2 already puts the route on both class rules; confirm that the job read is keyed on `user_id` as well as the request ids.
- **S-3:** in `findLimitAnchor(origin, ...)`, keep `method: 'findOwnerLimitAnchor'` / `'findAdminLimitAnchor'` in the logs, and pick the offset from the origin, not from a caller-passed number.

### Optimisation suggestions

- The GET may run the identity read and the history read in parallel (as designed). If the identity is `closed` or `not_found`, return without the history.

### User questions (not decided by SA)

- **BQ-E8-1:** genuinely the user's call (customer-facing wording). The default is safe to build on, provided M-2 is applied and the user sees the whole admin email.
- **BQ-E8-2:** genuinely the user's call (governance). The default "no reason" is safe: `actor_id` records which admin sent it, and adding an admin-only reason later is additive with no schema change to this slice.
- **BQ-E8-3:** low-stakes. The user may answer, but the default "support's sends only" is safe and the smaller exposure, so build on it.

### Approval
[x] Workplan approved with conditions (M-1, M-2), proceed to implementation

---

## Implementation Notes (Dev, 2026-11-04)

Tasks 2–11 done on `feature/bos-export-mx5-admin-send`, uncommitted. Task 1 (CC-3 claims) was handled by the coordinator.

| # | Note |
|---|---|
| D-1 | **The module list comes from the server.** The admin `source.guard` forbids any `lib/business-os` import on this screen, so the dialog cannot call `enabledModules()` as §4.8 said. The GET returns `modules: [{ id, name }]` (switched-on modules, English names), and each history line carries `name` |
| D-2 | **SA-Q7's inline format throws.** `Intl.DateTimeFormat` with `dateStyle`/`timeStyle` cannot also take `timeZoneName` (TypeError). The dialog uses the same date and time with the fields spelled out: `day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'` |
| D-3 | **`source.guard.test.ts`: two edits, not one.** The dialog was added to `DATA_EXPORT_FILES` (SA-Q10). The MX-3.1 rule `toContain('{DATA_EXPORT_COPY.placeholder}')` had to change too, because the placeholder is gone (SA-Q6). It now asserts the purpose line, and that the dialog fetches only `export-sends` and never names the owner seam or `data-exports`. The danger-area, mount and no-backslash rules are unchanged |
| D-4 | `businessDrawer.layout.render.test.tsx`: only l.842 changed (purpose line + opener). l.835 and its comment are unchanged |
| D-5 | The owner route's `route.test.ts` and `route.qa.test.ts` pass with no edit (84/84) |
| D-6 | The admin email swaps four lines: `subject`, `requested`, `listHeading` and `notYou` (BQ-E8-1, M-2). The owner copy object is untouched (T-E1 checks it byte for byte) |
| D-7 | Contents doc (SA-Q8): its admin limit row said "No admin route exists yet (MX-5)". That line now says who starts it, and one row lists the admin route. A Change History row was added |
| V-1 | 62 suites, 2014 tests: `app/admin/users`, the admin route, `adminGate.writes`, both owner route tests, `lib/business-os/data-export`, `components/business-os/data-export` (incl. `oneExportControl.guard`), the request repository, both callers guards, the 20261095 migration test. One failure, `creditsBlock.render.test.tsx` (untouched, a timeout under load). It passed on a rerun alone, together with the layout and drawer suites (190/190). The `businessDrawer.pins.*` request lists pass unchanged |
| V-2 | `npm run test:authz-guard`: 203/203, no edit |
| V-3 | Full `tsc --noEmit` (exit 2, 1922 errors repo-wide, semantic TS2xxx present, no OOM) found one error in a touched file: `export-sends/route.ts` (logger parameter type). It was fixed, which shows the check can fail. A scoped re-run over the 22 touched TS files plus a planted error reported only the planted TS2322 among them |
| V-4 | ESLint on the touched files is clean (two `no-assign-module-variable` errors in the new dialog test were fixed) |
| V-5 | Not edited: `BusinessDetail.tsx`, `page.tsx`, the worker files, `events.ts`, `eventAudience.ts`, `closedAccount.ts`, `AccountLockRepository.ts`, any migration |
| V-6 | `npm run build` exit 0; `/api/admin/users/[id]/export-sends` is in the route list. The only warnings are pre-existing (Edge runtime notes on supabase-js, Google font retries) |
| — | Not run: the full-suite `npm test` diff against a `main` baseline (V-6 of §8.1) |

---

## SA Code Review

**Code Review by SA — 2026-11-04**
**Status:** ✅ Code Approved (no must-fix; the should-fix items below may be done now or later and do not block QA)

Read on `feature/bos-export-mx5-admin-send` (uncommitted, off `4c389406`): `git diff` plus the untracked files. Focused suites re-run by SA: the admin route test, `exportRequestedSend`, `exportRequestedEmail`, `dataExportBlock` and `dataExportSendDialog` render tests, `source.guard`, `adminGate.writes`, both callers guards, both owner route tests, the request repository test and `nextOwnerExportAt`: 13 suites, 756 tests, all pass. No full build run (not asked).

### Conditions from the workplan review

| # | Verdict | Evidence |
|---|---|---|
| M-1 | ✅ | `route.ts` l.161 (GET) and l.233 (POST): `const gate = await requireAdmin(logger.child({ route, method }))` is the first statement, then the gate return; `correlationId` and `requestLogger` come after. T-G4 pins both handlers line by line; `adminGate.writes` (66 → 68, arithmetic line updated) and the authz surface guard cover them |
| M-2 | ✅ | `exportRequestedEmail.ts`: the owner copy object is unchanged in the diff (byte-identical); `copyFor()` overlays `subject`, `requested`, `listHeading`, `notYou` for `origin: 'admin'` in en / he / es. The remaining shared lines (`arrives`, `filesNotIncluded`) are not in the owner's voice. The test asserts no "You asked" / "you chose" / "did not ask", "ביקשת" / "שבחרת", "Pediste" / "elegiste" / "no lo pediste" in the admin variant |

### Specific checks

- **POST order:** ✅ l.233–345: gate → path id (uuid, lower-cased) → body (blank = `{}`, bad JSON 400, `.strict()` `{ modules }`) → rate limit → self-send 409 → `findUserIdentity` (error 500, null 404) → `isClosedAccountEmail` 409 (warn with ids and code only; no start, audit or email; Q1 race comment present) → usable email 409 → `startForAdmin` (`unknown_account` 404, else 500; `in_progress` / `daily_limit` 409) → `logAndFlush` → `sendExportRequestedEmail(origin 'admin')` → mark on success → 201 `{ requestId, requestedEmailSent }`. No `sentTo`.
- **No email in any response:** ✅ GET answers `{ state, modules, sends, nextSendAt }`; `sends` lines are the `assembleExportHistory` lines (`module`, `status`, `sentAt`, `emailCount`) plus `name`. POST answers ids and a boolean. Refusals carry fixed codes and English lines; 500s use `devDetails()` (development only). T-P1, T-H2, T-U12 assert it.
- **Tenant isolation (tenant-isolation-guard):** ✅ The owner id comes only from the Zod-validated, lower-cased path; the admin id only from `requireAdmin`; the strict body rejects `userId` / `email` / `to` / `origin` (T-P11). Every repository call is keyed on the path id: `findUserIdentity(ownerId)`, `listRecentForUser(ownerId, { origin: 'admin' })` (`.eq('user_id')` + `.eq('origin')`), `findAdminLimitAnchor(ownerId, …)` (`.eq('user_id')` + `.eq('origin', origin)`), `startForAdmin(ownerId, adminId, …)`, `markRequestedEmailSent(requestId, ownerId)`, and in the helper `findPreferredLanguage(userId)`, `ownerClock(userId)`, `findByIdForUser(requestId, userId)`. **S-2:** ✅ `listForRequestsOfUser(ownerId, ids)` filters `.eq('user_id')` AND `.in('request_id')`. The service-role choice is documented in the route header (l.45–49) and in both callers guards' allow-list comments. The recipient is read from the auth row of the same id, and the worker re-reads it by `job.user_id` (T-W1 pins that the worker never reads `admin_actor_id`).
- **S-1:** ✅ GET `state: 'self'` before the identity read; the dialog shows the line and no Send. **S-3:** ✅ private `findLimitAnchor(origin, …)` picks both the offset and the log `method` from the origin; `findOwnerLimitAnchor` keeps its signature.
- **Q3:** ✅ `git diff` shows no change under `app/api/business-os/export-requests/__tests__/` (`route.test.ts`, `route.qa.test.ts` unedited) and both pass. The helper takes the caller's logger, wraps everything in a try/catch that returns `email_failed`, keeps `email_timeout` distinct, and holds the 10 s constant; the owner route re-exports it as `REQUESTED_EMAIL_TIMEOUT_MS`. The helper is on the request-repository class rule only.
- **E-20:** ✅ `DataExportBlock.tsx` has no `fetch` (source.guard) and only toggles state; Radix renders no content while closed and the dialog's effect fetches only when `open` turns true (T-U2: no request on mount, one `no-store` GET on open). Layout l.835 and the `businessDrawer.pins.*` lists pass unchanged.
- **Logging / Zod / rules 1–6:** ✅ Route on `createLogger`, dialog on `clientLogger`; no `console.*` in any added line (the one hit is the prose word "console." in `dataExportCopy.ts`). Zod on the path id and the body; no query accepted on GET. No direct Supabase call, no `any`, no model name.
- **No backslash followed by a hex digit** in any added line or untracked file (checked with `LC_ALL=C grep -E`). The route test splits on `String.fromCharCode(10)`, not an escape.

### Rulings on Dev's deviations

| # | Ruling |
|---|---|
| D-1 (module list from the server) | ✅ **Accepted.** The screen's import guard is the higher rule, and server-side `enabledModules()` is the same source the POST validates against, so the picker can never offer a module the POST refuses. English names on the server match the English-only admin console. Note for later: if the admin console is ever localised, the names move with it |
| D-2 (Intl options spelled out) | ✅ **Accepted.** Correct: ECMA-402 forbids combining `dateStyle` / `timeStyle` with `timeZoneName` (TypeError). The spelled-out fields are the medium-date / short-time equivalent with the zone labelled, inline in the dialog, no shared module, as Q7 asked |
| D-3 (MX-3.1 `it()` rewritten in source.guard) | ✅ **Accepted**, conditional on DELETE's confirmation under CC-3 (already requested). The placeholder assertion cannot survive Q6, and the replacement is stricter: the box still has no `fetch`, no owner seam and no `data-exports`; the dialog is pinned to exactly two `fetch(url,` calls on the `export-sends` URL with neither forbidden name. The danger-area, mount and no-backslash rules are untouched |

### Code Review Comments

1. `app/admin/users/__tests__/dataExportSendDialog.render.test.tsx:178` — T-U9 asks that **each** 409 code maps to its line; only `export_daily_limit` and a 500 are tested. Add one `it.each` over `account_closed`, `export_no_login_email`, `admin_self_send`, `export_in_progress`. Priority: Low (should-fix; the mapping at `DataExportSendDialog.tsx:120–136` is correct by reading)
2. `app/api/admin/users/[id]/export-sends/route.ts:288–292` — `usableEmail()` is called twice and the second result is cast `as string`. Call it once into a const and branch on `null`. Priority: Low (should-fix, clarity only)

### Optimisation Suggestions

- `DataExportSendDialog.tsx:109` drops a history line whose status is not one of the five words, silently. The server type makes that impossible today; a `logger.warn` there would surface a future status instead of hiding it.
- The 409 `account_not_found` from the POST shows the "no login email" line (`DataExportSendDialog.tsx:125`), which matches §4.8's grouping of `not_found` with `no_login_email`. Acceptable as is.

### Code Approved for QA: Yes

QA proceeds with §8.2 L-1…L-5 (each live check needs the user's go-ahead; L-2's ban change follows `env-change-protocol`). The full-suite baseline diff (§8.1 V-6, not run by Dev) is QA's or RM's to run before the PR.

---

## QA Testing Report

**QA — 2026-11-04**
**Test mode:** full (automated only; the live checks §8.2 L-1…L-5 were NOT run, by instruction)
**Strategy used:** A + B (Jest: unit, route with mocked seams, jsdom render, source guards), plus the full-suite comparison V-6. No network, no real account, no prod API
**Focus:** api, ui, security, schema (email copy)
**Skipped:** L-1…L-5 (need the user's go-ahead; they change a test account and send real email). `tests/plugins/integration-tests/` was left out of the full run, so no live plugin API could be reached
**Input source:** prompt (TL brief) + workplan §7 / §8.1

Run in `neuronforge-mx5` on `feature/bos-export-mx5-admin-send` (uncommitted, off `4c389406`). Raw output is in the session scratchpad (`mx5/full.txt`, `mx5/rerun.txt`, `mx5/fail-unique.txt`).

### Test Coverage

| Acceptance criterion / plan item | Tested? | Result | Notes |
|---|---|---|---|
| Only an admin can start it (T-G1…T-G4, T-X1, T-X6) | ✅ | Pass | 401 / 403 with nothing else called, for POST and GET; T-G4 checks the first two lines of each handler; `adminGate.writes` (68) and the authz surface guard pass |
| CSVs go to the owner's login email, never the admin (T-P1, T-W1, T-U12) | ✅ | Pass | `to` = `[owner email]`, not the admin's; the 201 body is exactly `{ requestId, requestedEmailSent }` (no `sentTo`, no `@`); GET body has no `@` in any state; the worker never reads `admin_actor_id` |
| Works for a locked (banned) account (T-P2) | ✅ (Jest) | Pass | The route never reads a ban. Live proof is L-2, not run |
| Does not use the owner's limit; 3rd admin send refused (T-R1…T-R5, T-P10, T-U9/T-U10) | ✅ (Jest) | Pass | `origin: 'admin'` filter and the admin anchor at offset 1; `daily_limit` → 409 + `retryAt`, nothing audited or emailed. Live proof is L-3, not run |
| No admin ZIP route remains (T-X5) | ✅ | Pass | `oneExportControl.guard` passes |
| Closed login refused with nothing started, counted or emailed (T-P3, T-P4, T-P5, T-H2, T-U3) | ✅ | Pass | 409 `account_closed`; no start, no `logAndFlush`, no `sendEmail`, no mark; the log and body hold no email; the real `isClosedAccountEmail` decides the near misses |
| POST refusals: self-send, no login email, in progress, strict body | ✅ | Pass | T-P14 (any case, before the identity read), T-P8 (null, blank, `.invalid`), T-P9, T-P11 (`userId` / `email` / `to` / `origin` → 400, no identity read) |
| Owner "Export requested" email byte-identical (T-E1) | ✅ | Pass | Branch tests, plus a QA check against the **base** builder: the `4c389406` `exportRequestedEmail.ts` was imported in a temporary test next to the branch one, 18 inputs (en/he/es × zone set/unset × 1/2/5 modules). Owner output, with `origin` absent or `'owner'`, deep-equals base in all 18. The temporary files were deleted |
| Admin copy has no owner voice (T-E2, T-E3, M-2) | ✅ | Pass | No "You asked" / "you chose" / "did not ask" (and the he/es equivalents) in the subject, text or HTML; the only address is the support contact; the placeholders match the owner lines |
| Moved send helper keeps its behaviour (T-S1, T-S2) | ✅ | Pass | sent / failed / reject / throw / timeout outcomes; owner route `route.test.ts` + `route.qa.test.ts` pass with no edit |
| Box reads nothing on open; dialog states (T-U1…T-U13, T-X4, T-X4b) | ✅ | Pass | `businessDrawer.pins.*` and the layout test pass unchanged |
| No new full-suite failure (V-6) | ✅ | **Fail** | One new failure: Bug 1 |

### Focused suites (step 2)

The admin route, `exportRequestedSend`, `exportRequestedEmail`, the `dataExportBlock` and `dataExportSendDialog` render tests, `source.guard`, `adminGate.writes`, both callers guards, the owner route tests (`route.test.ts`, `route.qa.test.ts`), the request repository and `nextOwnerExportAt`: **13 suites, 761 tests, all pass** (SA's 756, plus Dev's unknown-status case and QA's 4 additions below).

### Full suite (V-6)

`jest --silent`, the whole repo minus `tests/plugins/integration-tests/`: **1999 suites: 27 failed, 1972 passed. 49936 tests: 151 failed, 29 skipped, 49756 passed** (750 s). There were 54 `FAIL` lines, which dedup to **27 unique suites**. Each one was then rerun alone (`--runInBand`): 26 still fail, 1 passes.

| # | Suite | Rerun alone | Caused by MX-5? | Evidence |
|---|---|---|---|---|
| 1 | `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` | Fails | **Yes: Bug 1** | The only offender it lists is `app/api/admin/users/[id]/export-sends/__tests__/route.test.ts` |
| 2 | `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` | **Passes** | No (QA artifact) | ENOENT on QA's own temporary `lib/business-os/data-export/__qa_tmp__/baseEmail.ts`, which was deleted while the guard was walking the tree. Passes alone |
| 3–13 | `lib/agentkit/v4/.../v4-generator`, `lib/agentkit/v6/compiler/.../LogicalIRCompiler`, `.../logical-ir/schemas/.../validation`, `.../translation/.../IRToNaturalLanguageTranslator`, `lib/orchestration/.../IntentClassifier`, `.../TokenBudgetManager`, `lib/pilot/.../ConditionalEvaluator`, `.../ConditionalEvaluator.contains_any`, `.../StructuredTransforms`, `.../StructuredTransforms.wp33`, `.../StructuredTransforms.wp37` | Fail | No | All 11 are listed in `.github/ci/jest-quarantine.json` (known broken on main). None imports or names an MX-5 file |
| 14–27 | `app/api/payments/stripe-connect/.../stripeDecidesConnectStatus.guard`, `app/api/scheduling/free-slots/.../freeSlotsComposesSharedRules.guard`, `components/crm/contact-drawer/.../bookingsSearchAndPaging.guard`, `.../jobOverAfterHeldMeeting.guard`, `.../noIntakeToSendOnADeadJob.guard`, `lib/__tests__/supabaseFetch`, `lib/ai/pricing-research/.../openaiPricingAdapter`, `lib/business-os/__tests__/bookingNextStep`, `lib/business-os/onboarding/.../servicesAreDraftsWithWords.guard`, `.../theChainHoldsEndToEnd`, `lib/security/.../publicEndpointsAreThrottled.guard`, `lib/services/.../aCancelledMeetingSaysWhetherItWasSent.guard`, `.../bookingMailLandsOnTheJourney.guard`, `lib/utils/.../oneAddressPolicy.guard` | Fail | No | Not quarantined, so they are expected to pass on the Linux CI (not checked in this pass). They fail locally for Windows reasons: backslash paths in the offender lists (`oneAddressPolicy`, `publicEndpointsAreThrottled` name only unrelated files), and the CRLF source-scan pattern (memory: Jest local-vs-CI flake patterns). No failure message names an MX-5 file. None of the 27 files mentions `DataExportBlock`, `DataExportSendDialog`, `dataExportCopy`, `export-requests`, `export-sends`, `exportRequestedEmail`, `exportRequestedSend`, `nextOwnerExportAt`, `BusinessOsExportRequestRepository` or `adminGate`. The count (25 pre-existing) matches the "about 30 on a clean main" baseline |

Not run: a full `main` baseline in a second worktree, because that would need a second `node_modules` (the junction must not be touched). Instead, each suite was attributed by its own failure text and its references, as above.

### Issues Found

#### Bugs (must fix before commit)

1. **The new route test trips DELETE's account-closure callers guard** — File: `app/api/admin/users/[id]/export-sends/__tests__/route.test.ts` l.260 — Severity: **High** (the guard is not quarantined, so the required Jest gate goes red on this PR)
   - Steps to reproduce: `npx jest lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` in the mx5 worktree
   - Expected: `AccountLockRepository appears only in its allow-listed files` → `[]`
   - Actual: `["app/api/admin/users/[id]/export-sends/__tests__/route.test.ts"]`. T-P5 holds `expect(source).not.toMatch(/AccountLockRepository/);`, and the guard scans raw file text, so the literal name in the test counts as naming the lock seam
   - Fix for Dev (either one): drop that one assertion (the DELETE guard itself already proves the route never names `AccountLockRepository`, so it is redundant), or build the pattern so the name is not written out, e.g. `new RegExp(['Account', 'Lock', 'Repository'].join(''))`. Do **not** add the test to DELETE's allow-list: that would need a CC-3 claim, for no benefit. Rerun the guard and the route test afterwards

#### Performance Issues (should fix)

None found.

#### Edge Cases (nice to fix)

1. `DataExportSendDialog.tsx` l.110–112: the unknown-status `clientLogger.warn` (Dev's optional item) has no assertion. The T-U11 unknown-status case checks only that the line is dropped. Adding it would mean mocking `@/lib/logger/client` for the whole file, so QA did not add it. Low
2. `dataExportCopy.ts` `DataExportSendStatusWord` is a hand copy of `ExportHistoryStatus` (`lib/business-os/data-export/exportHistory.ts` l.49), because of the screen's import guard (D-1). Nothing pins that the two unions stay equal, so a new server status would silently become a dropped line plus a warn. Low; a test-only pin could import both
3. Pre-existing gaps that QA closed in this pass (test-only, 4 cases, all pass, ESLint clean, CRLF kept):
   - `route.test.ts`: GET 429 from `admin-export-sends-read`, before the identity read;
   - GET lower-cases an upper-case path id before every read (identity, history, jobs, anchor);
   - GET upper-case admin id is still `self`;
   - T-P16 timeout: also asserts `markRequestedEmailSent` is not called.
   - `dataExportSendDialog.render.test.tsx`: T-U11 now also renders Waiting / Working / Interrupted (only Sent / Failed were covered).

### Test Outputs / Logs

```text
Focused (13 suites):   Test Suites: 13 passed, 13 total   Tests: 761 passed, 761 total
Full run:              Test Suites: 27 failed, 1972 passed, 1999 total
                       Tests: 151 failed, 29 skipped, 49756 passed, 49936 total   Time: 750.366 s
Rerun of the 27 alone: Test Suites: 26 failed, 1 passed, 27 total
New failure:           accountClosureRepositories.callers.guard › AccountLockRepository appears only in its allow-listed files
                       + "app/api/admin/users/[id]/export-sends/__tests__/route.test.ts"
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit (Bug 1, High). Once it is fixed, QA needs only to rerun the guard, the route test and `npm run test:gate`'s view of the guard; no other retest is needed

**Verdict: FAIL** (one High bug, test-only, small fix). Everything else passes. The live checks L-1…L-5 are still owed after deploy, with the user's go-ahead.

### Re-pass after Bug 1 (coordinator, 2026-11-04)
- [x] Bug 1 fixed: the T-P5 line naming the lock repository class is deleted from `export-sends/__tests__/route.test.ts`; DELETE's allow-list is unchanged (DELETE confirmed). `accountClosureRepositories.callers.guard` + the route test: 2 suites, 75/75 pass
- [x] After RM merged `origin/main` (`27f13ab7`): 6 suites, 562/562 pass (route, `source.guard`, `adminGate.writes`, the three callers guards)
- [x] DELETE confirmed CC-3 (the `source.guard` MX-3.1 rewrite), so D-3 is settled

**Verdict after re-pass: PASS.** The live checks L-1…L-5 are still owed after deploy.

---

## Commit Info

- Branch: `feature/bos-export-mx5-admin-send`
- `d28f43a1` feat(admin): send a data export to the business owner (MX-5)
- `db1866db` merge of `origin/main` (`27f13ab7`), no conflicts
- PR: [AgentsPilot/neuronforge#623](https://github.com/AgentsPilot/neuronforge/pull/623)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-03 | Workplan created (Dev, EXPORT session) | E8 / MX-5 admin "Send export to owner" on `feature/bos-export-mx5-admin-send` (off `4c389406`). Evidence E-1…E-20 read on the branch: the start function and `startForAdmin` already take an admin send with its own 2-a-day limit; the worker already sends to the login email by `job.user_id`; the owner's drawer already tags admin sends. New: one admin route (POST send, GET state); the closed-login refusal with DELETE's `isClosedAccountEmail`, before the start function (coordinator, 2026-11-03); two additive repository reads; the admin wording of the "Export requested" email; the box rewrite inside `DataExportBlock` with a new send dialog that reads only when opened, so DELETE's drawer request pins stay unchanged; registry and guard entries. No lock, no migration. BQ-30 and BQ-30a ticked in both requirement files (Task 0, done). SA-Q1…SA-Q10; user questions BQ-E8-1…BQ-E8-3 |
| 2026-11-03 | SA workplan review | Approved with conditions. M-1: `requireAdmin` literally first, correlation logger after the gate (the `deletion/preview` pattern). M-2: the admin email swaps every owner-voiced line (`requested`, `listHeading`, `notYou`), and the user sees the whole admin email under BQ-E8-1. SA-Q1..Q10 ruled (Q7: `usersFormat.ts` has no timestamp formatter). Should-fix S-1..S-3. §15 S-1..S-4 marked done from the coordinator's read-only prod run |
| 2026-11-04 | Implementation (Dev) | Tasks 2–11 done, uncommitted. Deviations D-1 (the module list comes from the server, because of the screen's import guard), D-2 (SA-Q7's Intl options throw, so the fields are spelled out) and D-3 (the source.guard placeholder rule had to change). See Implementation Notes |
| 2026-11-04 | SA code review | Code approved for QA. M-1 and M-2 met; POST order, no email in any answer, tenant scoping (S-2 job read on user_id + request ids), Q3 (owner route tests unedited, helper never throws) and E-20 verified; 13 focused suites, 756 tests pass. D-1, D-2 accepted; D-3 accepted subject to DELETE's CC-3 confirmation. Two low should-fix items (T-U9 coverage of every 409 code; single `usableEmail` call) |
| 2026-11-04 | SA should-fix items applied (Dev) | (1) T-U9: the `it.each` over `account_closed`, `export_no_login_email`, `admin_self_send` and `export_in_progress` was already in `dataExportSendDialog.render.test.tsx` (l.162–176, just above the `export_daily_limit` case at l.178), so it needed no new test. (2) `export-sends/route.ts` step 8: `usableEmail()` is now called once into `to`, the route branches on `null`, and the `as string` cast is gone. (Optional) `DataExportSendDialog.tsx`: a history line with an unknown status logs one `clientLogger` warn (`unknown_status`, request id only) instead of being dropped silently, with a new T-U11 case. Re-run: admin route 52, dialog render 20, `source.guard` 112 = 184/184; ESLint clean on the three files; CRLF kept; no commit |
| 2026-11-04 | QA testing report (automated only) | **FAIL, 1 High bug.** Focused: 13 suites / 761 tests pass. Full run: 1999 suites, 27 failed (54 FAIL lines deduped), 151 tests failed. 25 of the 27 fail without MX-5 (11 quarantined, 14 Windows-only), and 1 was a QA temp-file artifact that passes alone. The 1 new failure is `accountClosureRepositories.callers.guard`: the route test's T-P5 writes the literal `AccountLockRepository`. Owner email checked byte-identical against the base builder. 4 test-only cases added (GET 429, GET lower-casing, GET upper-case self, timeout not marked; T-U11 three status words). L-1…L-5 not run |
| 2026-11-04 | QA re-pass, user approval, PR | Bug 1 fixed (one test line removed), 75/75; DELETE confirmed CC-3; user approved the diff; RM committed `d28f43a1`, merged `origin/main` (`db1866db`, 562/562 after merge), opened PR #623 |
