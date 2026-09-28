# Workplan: Business OS Invite-Only Signup, Slice 0 (Invite records and link)

> **Last Updated**: 2026-09-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md) (§10 Slice 0, §16.4 C-1 to C-13)
**Date:** 2026-09-28
**Branch:** `feature/bos-invite-signup-slice-0`, cut from `origin/main` at 64a4062d on 2026-09-28, in its own worktree (`neuronforge-invite-s0`) so the main checkout's unrelated branch and files are untouched. Every file reference below was checked against `origin/main`.
**Status:** Code Complete (2026-09-28), uncommitted, awaiting the user's diff review and SA code review. R-1 to R-7 are applied to this workplan (see the Change History).

## Overview

Slice 0 builds the invite **record** and the **link**. It does not build signup. An admin can create an invite, see the link once and copy it, list the newest 200 invites with their derived state, and revoke one. A public page on the platform origin reads the token from the URL fragment, validates it on the server, and shows one of these states: valid (a welcome from the inviter, their note, and the offered plan), expired, revoked, used, unavailable, or not recognised. Nothing creates an account, sends an email or writes a plan row. This workplan maps every Slice 0 condition (C-1 to C-13) and the Slice 0 parts of T-1, T-5, T-7, T-12, T-14 and T-15 to concrete files and tasks.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Migration SQL](#4-migration-sql)
5. [Read-only verification script (C-2)](#5-read-only-verification-script-c-2)
6. [Runbook: applying the migration by hand](#6-runbook-applying-the-migration-by-hand)
7. [API contracts](#7-api-contracts)
8. [Task List](#8-task-list)
9. [Traceability: C-1 to C-13 and T-decisions](#9-traceability-c-1-to-c-13-and-t-decisions)
10. [Test plan (C-12)](#10-test-plan-c-12)
11. [Manual QA demo script](#11-manual-qa-demo-script)
12. [Rollback](#12-rollback)
13. [Findings for SA: ambiguities and deviations](#13-findings-for-sa-ambiguities-and-deviations)
14. [Logging-standard check (console.*)](#14-logging-standard-check-console)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)

---

## 1. Analysis Summary

| Area | What Slice 0 touches | Verified against `origin/main` |
|---|---|---|
| Database | One new table, `business_os_invites`. No function, no trigger, no FK. | Last migration on `origin/main` is `20261011_bos_cron_runs.sql`. No branch or worktree has a `20261012+` migration, so the new file is `20261012_business_os_invites.sql`. **Re-check the prefix at implementation time**, because the credit-deduction and credits-boost work may claim a date first. |
| Config | Expiry options (T-14) and the issuance policy with its paid switch (T-15), under `lib/business-os/entitlements/config/`. | The folder holds `catalog`, `chatActionMap`, `cohorts`, `enforcementPoints`, `launch`, `lifecycle`, `tierMatrix`. `tierLiteral.forbidden.test.ts` allows tier ids only under `entitlements/config`, `__fixtures__`, `entitlements/__tests__` and two customer-plan `__tests__` prefixes. |
| Plan display | The public page describes the offered plan through the existing `planPresentation` / `customerPlanView` helpers (`planLabel`, `planMonthlyPriceUsd`, `previewAccountFor`, `describePlanCapabilities`, `isHiddenFromCustomer`, `groupByCategory`) and `resolveEntitlements`. | All exist on `origin/main` and are `server-only`. Plan and capability labels are read as `labels.en` (see §13 F-4). |
| Repositories | New `BusinessOsInviteRepository`. The existing `UserProfileRepository.findById` provides `full_name` (C-9). **No `user_preferences` read in Slice 0** (SA scope cut, C-8 amended: the form defaults to `en`). | `user_preferences` has no repository today; the three existing readers query it directly, which is non-compliant and is **not** copied. The repository arrives with Slice 2. |
| Admin API | `app/api/admin/business-os/invites/route.ts` (GET, POST) and `.../invites/[inviteId]/revoke/route.ts` (POST). | `requireAdmin(logger)` returns `{ user: { id, email } }` or a `NextResponse`. The admin authz guard caps count **exemptions**; three gated handlers change no cap. Rule R3 forbids a `route.ts` under `app/admin/**`, and none is added. |
| Public API | `app/api/public/invites/validate/route.ts` (POST). | `app/api/public/` is the existing home for unauthenticated routes (consent, invoice pay, newsletter). It is outside `/api/admin/**`, so the authz guard is unaffected. |
| Admin page | `app/admin/business-os-invites/`, built like `app/admin/business-os-tiers/`: a `'use client'` `page.tsx` (guard rule R8), `types.ts`, `components/`, and a source guard. It inherits `app/admin/layout.tsx` (`requireAdminPage`). | `AdminSidebar.nav.test.ts` pins the Businesses list and a total of 25 hrefs, so it becomes 26. |
| Public page | `app/invite/` (`layout.tsx` server, `page.tsx` client shell). | No `invite` route exists in `app/`. `middleware.ts` has a `skipOnboardingCheck` allow-list. The subdomain rewrite runs before it, so the new branch goes after the rewrite and a business site's own `/invite` path is untouched. |
| Audit | New `AUDIT_EVENTS.BOS_INVITE_CREATED` and `BOS_INVITE_REVOKED`, plus `EVENT_METADATA` entries (the archiving precedent), their audience tag in `eventAudience.ts` (`bos`), and a new audit entity type `business_os_invite` in `lib/audit/types.ts`. | `lib/audit/events.ts`. The entitlements events have no metadata entries; the archiving ones do. `eventAudience.test.ts` fails on an untagged event, and `AuditLogInput.entityType` is a closed union, so both extra files are required (found at implementation). |
| Purge / deletion | `never('business_os_invites', G, …)` in `descriptors.ts`, and a baseline entry. **Not** in `USER_OWNED_TABLES` or `accountDeletionPolicy.ts` (§13 F-1). | Follows the `archive_runs` / `bos_cron_runs` precedent: tables with no `user_id` column are `never` with global scope, baseline only. |
| Logging | Pino via `createLogger`. `token` and `*.token` are already redacted in `lib/logger/config.ts`, as a backstop only (T-7). | No file to be touched uses `console.*` (§14). |

**Out of scope for Slice 0** (from §10 and §16.5): signup, account creation, the one-time code, `createUser`, the lineage table, plan-row writes, the existing-account check (L-3), `isBusinessOsTenant` widening (L-4), email sending, resend, paid-status filters, the circle report, and the 12-month anonymisation job (L-12).

---

## 2. Implementation Approach

### 2.1 Module layout

Business logic lives in a new `lib/business-os/invites/` folder, kept out of the entitlements module so that module stays about entitlements. It follows the `adminOps.ts` shape: pure functions that receive their repositories and clock as arguments, so they can be tested without a request. Routes stay thin: gate, HTTP shape, audit.

| File | Responsibility | Server-only |
|---|---|---|
| `lib/business-os/entitlements/config/invites.ts` | `INVITE_LINK_EXPIRY` (`optionsDays: [15, 30, 60]`, `defaultDays: 30`), `INVITE_TYPES` (champion maps to cohort grant ids from `COHORT_IDS`; paid maps to `TIER_ORDER` with `defaultGrantId: TIER_ORDER[0]`), `CHAMPION_ACCESS_MONTHS_MAX` (60), `INVITE_ISSUANCE_POLICY` (`admin: ['champion', 'paid']`, `paidInvitesAvailable: false`). | No (pure config) |
| `lib/business-os/invites/inviteToken.ts` | `generateInviteToken()` uses `crypto.randomBytes(32)` and base64url, giving 43 characters. `hashInviteToken()` returns SHA-256 hex (64 characters). `INVITE_TOKEN_PATTERN` is `/^[A-Za-z0-9_-]{43}$/`. `buildInviteLink(token)` returns `platformUrl('/invite') + '#t=' + token`. | Yes (`node:crypto`) |
| `lib/business-os/invites/inviteState.ts` | `deriveInviteState(row, now)` returns `'pending' | 'expired' | 'revoked' | 'accepted'` from timestamps only. It reads no config (C-11, AC-3). | No (pure) |
| `lib/business-os/invites/inviteSchemas.ts` | Zod schemas built from config: create (a discriminated union on `inviteType`, `.strict()`), revoke (`.strict()`), and public validate body (`.strict()`). No list query schema: the list takes no parameters in Slice 0 (SA scope cut). | No |
| `lib/business-os/invites/adminInviteOps.ts` | `createInviteForAdmin`, `revokeInviteForAdmin`, `listInvitesForAdmin`, `buildInviteFormOptions`, and the shared list-view mapper `toInviteListView` (R-7). Covers issuance-policy checks (C-6), the inviter name snapshot (C-9), the `en` language default (C-8 as amended), the explicit insert allow-list, and outcome codes. | Yes |
| `lib/business-os/invites/inviteOffer.ts` | `describeInviteOffer(row, config, now)` returns `{ planName, free, monthlyPriceUsd, access, included }`. The plan part comes from `describePlanOffer` in `lib/business-os/entitlements/planOfferView.ts`, which runs `previewAccountFor` → `resolveEntitlements` → `describePlanCapabilities` → the `isHiddenFromCustomer` filter → `groupByCategory` **inside** the entitlements module (SA M-3), so this file never imports the resolver. `access` is data (`open_ended`, `months`, `while_paid`), so the page can say it in the invite's language (D-dev-4). Nothing about plan contents is written here (FR-9). | Yes |
| `lib/business-os/invites/publicInviteView.ts` | `viewInviteByToken(rawToken, { repository, config, now })`. It checks the format, hashes, looks up, derives state, re-validates the grant against config (GR-1), sets `first_viewed_at` conditionally, and builds the **allow-listed** response (C-4). | Yes |

### 2.2 Key decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **Grant as explicit columns** (`invite_type`, `grant_kind`, `grant_id`, `access_open_ended`, `access_months`). The SQL CHECK keys the access shape on `grant_kind`, never on a plan name: a `cohort` grant is open-ended **or** has positive months, and a `tier` grant has neither. | T-1. FR-12 of the entitlements requirement means no plan names in SQL. Keying on `grant_kind` expresses "champion access is decided" without naming `champion`. |
| D-2 | **Constraints added one `ALTER TABLE … ADD CONSTRAINT` at a time**, after a bare `CREATE TABLE`. | This follows the user's SQL-editor rule of small statements. Each constraint fails on its own line with its own name. |
| D-3 | **No regex or `@` CHECK in SQL.** The token hash CHECK is `char_length = 64`, and the email CHECK is `email = lower(btrim(email))` plus a length range. Syntax checking is Zod's job at the boundary. | The editor rule allows no punctuation inside string literals. Both patterns would need punctuation, and the database CHECK is only a backstop (M-3). |
| D-4 | **Plain `CREATE TABLE`** (not `IF NOT EXISTS`) inside one `BEGIN … COMMIT`. | This follows the `20261011` precedent: a second paste fails at the first statement and changes nothing. The pre-check in §6 says "already applied" first. |
| D-5 | **Public validate returns HTTP 200 with `state: 'not_recognised'`** for an unknown, malformed or wrong token, with byte-identical body and headers. **400 is only for a body that is not `{ token: string }`** (non-JSON, missing key, extra key). | AC-2 and C-4 require one identical response for any bad token. A body-shape error says nothing about any token. See §13 F-2. |
| D-6 | **Malformed tokens skip the database.** Format-valid unknown tokens and real tokens both do exactly one indexed lookup. | The enumeration risk is telling a real token from a well-formed guess, and both take the same path. A malformed token tells the attacker nothing they did not already know. C-3 requires the format check before hashing. |
| D-7 | **Non-valid states return a narrow allow-list:** `state`, `language`, `inviterDisplayName`. Only `valid` adds the note, the offer and `linkExpiresAt`. | This is enough for "ask Dana for a new one" in the invite's language, without showing the note or plan on a dead link. |
| D-8 | **`unavailable` is a derived page state** for a matched, pending invite whose `grant_id` is no longer in config (GR-1). It is never stored. | "Refused cleanly rather than writing an unknown value." Slice 1 reuses the same check at redemption. |
| D-9 | **Audit is non-blocking, then flushed before the response** (R-1, SA ruling on F-3): `auditTrail.log(…).catch(…)` followed by `await auditTrail.flush().catch(…)`. Neither call can fail the request. The durable record is the row: `issuer_admin_id`, `created_at`, `revoked_by_admin_id`, `revoked_at`, `revoke_reason`. | C-5, §8.3 and WC-7. A serverless instance can freeze after the response, so an unflushed entry can be lost. `log()` is awaited (with its `.catch`) before `flush()`, exactly as the entitlements and archiving routes do, because `log()` builds its entry asynchronously: a flush started before `log()` has queued the entry would flush nothing. `log()` never rejects on a queue failure (it catches internally), so awaiting it adds no failure path. |
| D-10 | **The admin page imports nothing outside its own folder** except UI libraries. Form options (expiry list, default, invite types, availability text, default language, enforcement mode) arrive in the GET payload. | This mirrors the Tiers source guard. The client can never re-derive a config rule. |
| D-11 | **The public page strips the fragment** (`history.replaceState(null, '', '/invite')`) right after reading it, before the POST. | The token leaves the address bar and the current history entry. This supports T-7. |
| D-12 | **Inviter name:** `profiles.full_name` through `userProfileRepository.findById(adminId)`, trimmed and capped at 200 characters, otherwise `'AgentPilot'`. | C-9. `requireAdmin` returns only `{ id, email }`, so auth metadata is not available without another admin-API call. See §13 F-5. |
| D-13 | **Champion access months** are 1 to `CHAMPION_ACCESS_MONTHS_MAX` (60), enforced by Zod from config. SQL checks only `> 0`. | This is a value policy, so it lives in config and not in SQL. |

### 2.3 Request flows

**Create (`POST /api/admin/business-os/invites`).** The order is: `requireAdmin` (first statement) → parse the body (Zod `.strict()`, returning 400) → issuance policy (409 `paid_invites_not_available` for any tier grant while the switch is off, C-6) → normalise the email → snapshot the inviter name (C-9) → generate the token and hash → stamp `link_expiry_days` and `link_expires_at = now + days` → `createForAdmin` with an explicit allow-list → audit `log(…).catch` then `await flush().catch` (R-1) → 201 with `{ invite, link }` and `Cache-Control: no-store`. The `invite` object is built by the **same list-view mapper** as GET (`toInviteListView`, R-7), so it can never carry `token_hash`, `issuer_admin_id`, `internal_reason` or `redeemed_account_id`. The raw token exists only in the local variable, the link string and the response body.

**List (`GET`).** The order is: `requireAdmin` → `listRecentForAdmin({ limit: 200 })`, newest first → map each row with `toInviteListView(row, config, now)`, which calls `deriveInviteState(row, now)` → build form options (`buildInviteFormOptions`, with `defaultLanguage: 'en'`, C-8 as amended) → 200. There are **no query parameters** in Slice 0 (SA scope cut: filters and search move to Slice 1). `token_hash` is never selected.

**Revoke (`POST /api/admin/business-os/invites/[inviteId]/revoke`).** The order is: `requireAdmin` → Zod (the path id is a uuid, and the body `{ reason }` is `.strict()`) → `revokeForAdmin(id, adminId, reason, now)`. This is one conditional `UPDATE … WHERE id = $1 AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING`. If no row comes back, `findByIdForAdmin(id)` distinguishes 404 `invite_not_found` from 409 `invite_not_revocable`. Then audit `log(…).catch` and `await flush().catch` (R-1), then 200.

**Validate (`POST /api/public/invites/validate`).** There is no auth. The route file exports `runtime = 'nodejs'` (C-4, and `node:crypto` needs it) and `dynamic = 'force-dynamic'` (C-4: never cached), R-6. The order is: parse the body `{ token: string (max 512) }` with `.strict()` (400 only on shape) → `INVITE_TOKEN_PATTERN` (fail returns `not_recognised`) → `hashInviteToken` → `findByTokenHashForPublicView(hash)`. No row returns `not_recognised`; a repository error returns 503 `unavailable_try_again`. Next come `deriveInviteState`, then the grant re-check (D-8), then for `valid` only `markFirstViewed(id, now)` (a conditional `WHERE first_viewed_at IS NULL`, with its error logged and ignored), and finally the allow-listed response. The response always carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Logs carry the correlation id and the outcome, and `inviteId` only on a match. They never carry the token or the hash.

---

## 3. Files to Create / Modify

Everything below is verified against `origin/main`. After the SA scope cuts (R-2) and the files found at implementation (rows 54 to 59), **42 files are created and 16 are modified, for 58 files** in total (after the SA code review added rows 60 and 61), plus this workplan and the requirement. Rows struck through are cut from Slice 0 and keep their number so the references elsewhere stay stable.

### 3.1 Create

| # | File | Reason |
|---|---|---|
| 1 | `supabase/migrations/20261012_business_os_invites.sql` | C-1, C-2: the table, constraints, indexes, RLS and privileges |
| 2 | `supabase/SQL Scripts/20261012_business_os_invites_rollback.sql` | §12. This is a separate file, following the `20261011` precedent, so it can never be applied by accident |
| 3 | `scripts/check-bos-invites-migration.sql` | C-2: read-only verification of the end state |
| 4 | `supabase/migrations/__tests__/business-os-invites.migration.test.ts` | Text assertions: privileges, no enumerated REVOKE, editor-safe SQL, no plan names, no FK, and a checker that covers every constraint |
| 5 | `lib/business-os/entitlements/config/invites.ts` | T-14 and T-15 config (C-7) |
| 6 | `lib/business-os/entitlements/__tests__/inviteConfig.invariant.test.ts` | C-7 invariants. It lives here so tier ids may be named in assertions |
| 7 | `lib/business-os/invites/inviteToken.ts` | C-3 |
| 8 | `lib/business-os/invites/inviteState.ts` | C-11 |
| 9 | `lib/business-os/invites/inviteSchemas.ts` | C-5 and C-7: `.strict()` bodies with config-built enums |
| 10 | `lib/business-os/invites/adminInviteOps.ts` | C-5, C-6, C-8, C-9, C-13 |
| 11 | `lib/business-os/invites/inviteOffer.ts` | FR-8 and FR-9: the offered plan, from existing presentation helpers |
| 12 | `lib/business-os/invites/publicInviteView.ts` | C-4, FR-8, FR-10 |
| 13 | `lib/business-os/invites/__tests__/inviteToken.test.ts` | C-3 |
| 14 | `lib/business-os/invites/__tests__/inviteState.test.ts` | C-11, AC-3 |
| 15 | `lib/business-os/invites/__tests__/inviteSchemas.test.ts` | C-5, C-7, and injected fields rejected |
| 16 | `lib/business-os/invites/__tests__/adminInviteOps.test.ts` | C-6, C-8, C-9, the allow-list, and token leak checks |
| 17 | `lib/business-os/invites/__tests__/inviteOffer.test.ts` | Plan description comes from config, with no literals |
| 18 | `lib/business-os/invites/__tests__/publicInviteView.test.ts` | C-4, AC-2, and the allow-list |
| 19 | `lib/repositories/BusinessOsInviteRepository.ts` | Repository (new-repository skill) with admin-scoped and token-scoped methods (C-13) |
| 20 | ~~`lib/repositories/UserPreferencesRepository.ts`~~ | **Cut (R-2): moved to Slice 2.** |
| 21 | `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | A unit test per method |
| 22 | ~~`lib/repositories/__tests__/UserPreferencesRepository.test.ts`~~ | **Cut (R-2): moved to Slice 2.** |
| 23 | ~~`lib/repositories/__tests__/businessOsInvites.callers.guard.test.ts`~~ | **Cut (R-2): moved to the first account-issued slice.** C-13 is met by method naming plus the in-code service-role comments. |
| 24 | `app/api/admin/business-os/invites/route.ts` | GET (list and form options), POST (create) |
| 25 | `app/api/admin/business-os/invites/[inviteId]/revoke/route.ts` | POST (revoke) |
| 26 | `app/api/admin/business-os/invites/__tests__/route.test.ts` | GET and POST: 401, 403, 400, 409, happy path |
| 27 | `app/api/admin/business-os/invites/__tests__/revoke.route.test.ts` | 401, 403, 400, 404, 409, happy path |
| 28 | `app/api/public/invites/validate/route.ts` | Public validate (C-4) |
| 29 | `app/api/public/invites/validate/__tests__/route.test.ts` | AC-2, the allow-list, headers, and no token in logs |
| 30 | `app/admin/business-os-invites/page.tsx` | `'use client'` screen (R8). It inherits the layout guard |
| 31 | `app/admin/business-os-invites/types.ts` | Payload types (the HTTP boundary only) |
| 32 | `app/admin/business-os-invites/components/CreateInviteForm.tsx` | FR-1: Paid is shown disabled, with the text from the payload |
| 33 | `app/admin/business-os-invites/components/CreatedLinkPanel.tsx` | FR-3: the link is shown once, with a copy button |
| 34 | `app/admin/business-os-invites/components/InviteList.tsx` | FR-5 (the Slice 0 subset): the newest 200 invites with their derived state. No filters or search (R-2, Slice 1). |
| 35 | `app/admin/business-os-invites/components/RevokeDialog.tsx` | FR-6: a reason of at least 3 characters |
| 36 | `app/admin/business-os-invites/components/EnforcementNote.tsx` | GR-5: "recorded, not enforced", driven by `enforcementMode` in the payload |
| 37 | `app/admin/business-os-invites/__tests__/page.render.test.tsx` | Render and interaction |
| 38 | `app/admin/business-os-invites/__tests__/source.guard.test.ts` | No imports from outside the screen, and no guard of its own |
| 39 | `app/invite/layout.tsx` | Server component: `metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }` |
| 40 | `app/invite/page.tsx` | Client shell: read the fragment, strip it, POST, render the state |
| 41 | `app/invite/invitePageCopy.ts` | Page strings in `en`, `he` and `es` (client-safe, no server import) |
| 42 | `app/invite/__tests__/page.render.test.tsx` | Fragment handling, each state, RTL, and the note rendered as text |
| 43 | `app/invite/__tests__/middleware.invite.test.ts` | `/invite` passes through with `Referrer-Policy: no-referrer`, and the onboarding check is skipped |

### 3.2 Modify

| # | File | Change |
|---|---|---|
| 44 | `middleware.ts` | After the subdomain rewrite block and before `skipOnboardingCheck`, add a branch for `pathname === '/invite' || pathname.startsWith('/invite/')` that returns `NextResponse.next()` with `Referrer-Policy: no-referrer` (C-4, T-7) |
| 45 | `lib/audit/events.ts` | `BOS_INVITE_CREATED`, `BOS_INVITE_REVOKED`, plus `EVENT_METADATA` entries (severity `info`) |
| 46 | `lib/business-os/purge/descriptors.ts` | `never('business_os_invites', G, '…')` in `EXCLUDED` (C-10) |
| 47 | `lib/business-os/purge/__tests__/classification-baseline.json` | `"business_os_invites": "never"`, with `count` raised by 1 |
| 48 | `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | Assert that `business_os_invites` is `never` and that no Reset or Purge option combination includes it |
| 49 | `app/admin/components/AdminSidebar.tsx` | A Businesses entry: name `Invites`, href `/admin/business-os-invites`, description `Business OS invite links` |
| 50 | `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | Businesses list gains the new href. Totals go from 25 to 26 and from `>= 26` to `>= 27` on-disk pages |
| 51 | `lib/repositories/index.ts` | Export the new invite repository, its singleton and its types |
| 52 | `lib/repositories/types.ts` | Invite row, create input and revoke input types (new-repository skill, step 2) |
| 53 | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | One row noting `config/invites.ts`: that it exists, and that it is a config edit to flip `paidInvitesAvailable` (Slice 5 only) |
| 54 | `lib/audit/types.ts` | New audit entity type `business_os_invite` (found at implementation: `entityType` is a closed union) |
| 55 | `lib/audit/eventAudience.ts` | Tag both new events `bos` (found at implementation: `eventAudience.test.ts` fails on an untagged event) |
| 56 | `lib/audit/__tests__/eventAudience.test.ts` | The pinned split moves from 160/15 to 162/17 (two new Business OS events) |
| 57 | `lib/audit/filterOptions.ts` | A `BOS_INVITE_` group rule labelled "Business OS Invites"; without it the two events fall into a group called "Bos", which `filterOptions.test.ts` forbids |
| 58 | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | Seven `KNOWN_NON_GATE_IMPORTERS` entries (the three routes and four invite modules), each with its exact imported symbols and why it is not a capability gate. **SA to confirm** (§13 D-dev-2) |
| 60 | `lib/business-os/entitlements/planOfferView.ts` (new) | SA M-3: `describePlanOffer(config, planId, now)`, the read-only plan preview, so no file outside the module imports the resolver |
| 61 | `lib/business-os/entitlements/__tests__/planOfferView.test.ts` (new) | Its unit test: names and prices from presentation, the included list equals the customer section's for every plan, nothing hidden is named |
| 59 | `components/PlatformChrome.tsx` | `/invite` added to `PUBLIC_PREFIXES`: its header says a new public route must be registered in BOTH the middleware and this list, or an account-less visitor loads the owner's platform shell (§13 D-dev-3) |

Not touched, on purpose: `adminOps.ts` (L-4 and T-2 are Slice 1), `BusinessOsAccountPlanRepository` and its import guard (Slice 0 reaches no plan table), `businessOwnedTables.ts` and `accountDeletionPolicy.ts` (§13 F-1), `lib/logger/config.ts` (`token` is already redacted, and `otp`/`code` are added in Slice 1 per L-2), `next.config.js` (the header is set in the middleware).

---

## 4. Migration SQL

**File:** `supabase/migrations/20261012_business_os_invites.sql`

Written for the Supabase SQL editor, which mangles elaborate scripts. There are **no `--` comments** and **no block comments**. String literals contain **only letters, digits, underscores and spaces**. Every statement is small, and **no alias is a single letter**. All explanations are in §6.

```sql
BEGIN;

CREATE TABLE public.business_os_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  email text NOT NULL,
  email_locked boolean NOT NULL DEFAULT true,
  invite_type text NOT NULL,
  grant_kind text NOT NULL,
  grant_id text NOT NULL,
  access_open_ended boolean,
  access_months integer,
  issuer_kind text NOT NULL,
  issuer_admin_id uuid,
  issuer_account_id uuid,
  inviter_display_name text NOT NULL,
  language text NOT NULL,
  personal_note text,
  internal_reason text NOT NULL,
  link_expiry_days integer NOT NULL,
  link_expires_at timestamptz NOT NULL,
  first_viewed_at timestamptz,
  revoked_at timestamptz,
  revoked_by_admin_id uuid,
  revoke_reason text,
  redeemed_at timestamptz,
  redeemed_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_invites_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_token_hash_key UNIQUE (token_hash);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_token_hash_length CHECK (char_length(token_hash) = 64);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_normalised CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_invite_type_present CHECK (char_length(btrim(invite_type)) > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_grant_kind_known CHECK (grant_kind IN ('cohort', 'tier'));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_grant_id_present CHECK (char_length(btrim(grant_id)) > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_access_shape CHECK ((grant_kind = 'cohort' AND access_open_ended IS TRUE AND access_months IS NULL) OR (grant_kind = 'cohort' AND access_open_ended IS FALSE AND access_months IS NOT NULL AND access_months > 0) OR (grant_kind = 'tier' AND access_open_ended IS NULL AND access_months IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_one_issuer CHECK ((issuer_kind = 'admin' AND issuer_admin_id IS NOT NULL AND issuer_account_id IS NULL) OR (issuer_kind = 'account' AND issuer_account_id IS NOT NULL AND issuer_admin_id IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_inviter_name_length CHECK (char_length(btrim(inviter_display_name)) BETWEEN 1 AND 200);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_language_present CHECK (char_length(btrim(language)) > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_note_length CHECK (personal_note IS NULL OR char_length(personal_note) <= 1000);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_reason_length CHECK (char_length(btrim(internal_reason)) BETWEEN 3 AND 500);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_expiry_days_positive CHECK (link_expiry_days > 0);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_expiry_after_creation CHECK (link_expires_at > created_at);

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_revocation_complete CHECK ((revoked_at IS NULL AND revoked_by_admin_id IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND char_length(btrim(revoke_reason)) >= 3));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_redemption_complete CHECK ((redeemed_at IS NULL) = (redeemed_account_id IS NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_not_revoked_and_redeemed CHECK (revoked_at IS NULL OR redeemed_at IS NULL);

CREATE INDEX business_os_invites_email_idx ON public.business_os_invites (email);

CREATE INDEX business_os_invites_created_at_idx ON public.business_os_invites (created_at DESC);

ALTER TABLE public.business_os_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_invites FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_invites FROM anon;

REVOKE ALL ON TABLE public.business_os_invites FROM authenticated;

REVOKE ALL ON TABLE public.business_os_invites FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_os_invites TO service_role;

COMMIT;
```

**Revoker (SA N-3):** a revoke records its admin in `revoked_by_admin_id`, and the code always sets it (`BusinessOsInviteRepository.revokeForAdmin` writes `revoked_by_admin_id: input.adminId`, pinned by its unit test). The CHECK deliberately does **not** require it, because the future account-issued revoke (§14) has no admin; the migration test pins that choice. **NULL-safe CHECKs (SA M-2):** `access_shape` requires `access_months IS NOT NULL` for a months grant, and `revocation_complete` requires `revoke_reason IS NOT NULL`, because a CHECK passes on NULL.

Totals: one table, one primary key, one unique constraint, **16 CHECK constraints**, two extra indexes, RLS on, no policy, no function, no trigger, no foreign key. There is no `user_id` column, so the table is not tenant data (§8.2) and the ownership test's `user_id` scan does not pick it up.

**File:** `supabase/SQL Scripts/20261012_business_os_invites_rollback.sql`

```sql
BEGIN;

DROP TABLE public.business_os_invites;

COMMIT;
```

---

## 5. Read-only verification script (C-2)

**File:** `scripts/check-bos-invites-migration.sql`

This is one read-only session and **one final `SELECT`**, because the editor shows only the last result. Each row reads `PASS` or `FAIL`. It checks privileges with `aclexplode`, so it sees **every** privilege letter, including `MAINTAIN`, `TRUNCATE`, `REFERENCES` and `TRIGGER`, rather than parsing ACL text.

```sql
SET default_transaction_read_only = on;

WITH invite_table AS (
  SELECT pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'business_os_invites'
),
acl_entries AS (
  SELECT CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
         acl_item.privilege_type AS privilege_name
  FROM invite_table
  CROSS JOIN LATERAL aclexplode(invite_table.table_acl) AS acl_item
  LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl_item.grantee
),
client_entries AS (
  SELECT count(*) AS total,
         COALESCE(string_agg(acl_entries.grantee_name || ' ' || acl_entries.privilege_name, ' '), 'none') AS listing
  FROM acl_entries
  WHERE acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')
),
service_entries AS (
  SELECT count(*) FILTER (WHERE acl_entries.privilege_name IN ('SELECT', 'INSERT', 'UPDATE')) AS expected_total,
         count(*) FILTER (WHERE acl_entries.privilege_name NOT IN ('SELECT', 'INSERT', 'UPDATE')) AS unexpected_total,
         COALESCE(string_agg(acl_entries.privilege_name, ' ' ORDER BY acl_entries.privilege_name), 'none') AS listing
  FROM acl_entries
  WHERE acl_entries.grantee_name = 'service_role'
),
policy_summary AS (
  SELECT count(*) AS total
  FROM pg_policies
  WHERE pg_policies.schemaname = 'public'
    AND pg_policies.tablename = 'business_os_invites'
),
constraint_summary AS (
  SELECT count(*) FILTER (WHERE pg_constraint.contype = 'f') AS foreign_keys,
         count(*) FILTER (WHERE pg_constraint.contype = 'u' AND pg_constraint.conname = 'business_os_invites_token_hash_key') AS token_unique,
         count(*) FILTER (WHERE pg_constraint.contype = 'c' AND pg_constraint.conname IN ('business_os_invites_token_hash_length', 'business_os_invites_email_normalised', 'business_os_invites_invite_type_present', 'business_os_invites_grant_kind_known', 'business_os_invites_grant_id_present', 'business_os_invites_access_shape', 'business_os_invites_one_issuer', 'business_os_invites_inviter_name_length', 'business_os_invites_language_present', 'business_os_invites_note_length', 'business_os_invites_reason_length', 'business_os_invites_expiry_days_positive', 'business_os_invites_expiry_after_creation', 'business_os_invites_revocation_complete', 'business_os_invites_redemption_complete', 'business_os_invites_not_revoked_and_redeemed')) AS named_checks
  FROM pg_constraint
  WHERE pg_constraint.conrelid IN (SELECT invite_table.table_oid FROM invite_table)
),
column_summary AS (
  SELECT count(*) FILTER (WHERE pg_attribute.attname = 'user_id') AS user_id_columns
  FROM pg_attribute
  WHERE pg_attribute.attrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
),
trigger_summary AS (
  SELECT count(*) AS total
  FROM pg_trigger
  WHERE pg_trigger.tgrelid IN (SELECT invite_table.table_oid FROM invite_table)
    AND NOT pg_trigger.tgisinternal
),
index_summary AS (
  SELECT count(*) AS email_index
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
    AND pg_indexes.tablename = 'business_os_invites'
    AND pg_indexes.indexname = 'business_os_invites_email_idx'
),
checks AS (
  SELECT 10 AS sort_order, 'I01 table exists' AS check_name,
         CASE WHEN (SELECT count(*) FROM invite_table) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*) FROM invite_table) || ' of 1 found' AS detail
  UNION ALL
  SELECT 11, 'I02 row level security on',
         CASE WHEN COALESCE((SELECT invite_table.rls_on FROM invite_table), false) THEN 'PASS' ELSE 'FAIL' END,
         'rls ' || COALESCE((SELECT invite_table.rls_on FROM invite_table)::text, 'missing')
  UNION ALL
  SELECT 12, 'I03 no policies',
         CASE WHEN policy_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         policy_summary.total || ' policies'
  FROM policy_summary
  UNION ALL
  SELECT 13, 'I04 PUBLIC anon authenticated hold no privilege at all',
         CASE WHEN client_entries.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         client_entries.listing
  FROM client_entries
  UNION ALL
  SELECT 14, 'I05 service_role holds exactly select insert update',
         CASE WHEN service_entries.expected_total = 3 AND service_entries.unexpected_total = 0 THEN 'PASS' ELSE 'FAIL' END,
         service_entries.listing
  FROM service_entries
  UNION ALL
  SELECT 15, 'I06 token hash is unique',
         CASE WHEN constraint_summary.token_unique = 1 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.token_unique || ' unique constraint'
  FROM constraint_summary
  UNION ALL
  SELECT 16, 'I07 all 16 check constraints present',
         CASE WHEN constraint_summary.named_checks = 16 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.named_checks || ' of 16'
  FROM constraint_summary
  UNION ALL
  SELECT 17, 'I08 no foreign keys',
         CASE WHEN constraint_summary.foreign_keys = 0 THEN 'PASS' ELSE 'FAIL' END,
         constraint_summary.foreign_keys || ' foreign keys'
  FROM constraint_summary
  UNION ALL
  SELECT 18, 'I09 no user_id column',
         CASE WHEN column_summary.user_id_columns = 0 THEN 'PASS' ELSE 'FAIL' END,
         column_summary.user_id_columns || ' user_id columns'
  FROM column_summary
  UNION ALL
  SELECT 19, 'I10 no triggers',
         CASE WHEN trigger_summary.total = 0 THEN 'PASS' ELSE 'FAIL' END,
         trigger_summary.total || ' triggers'
  FROM trigger_summary
  UNION ALL
  SELECT 20, 'I11 email index present',
         CASE WHEN index_summary.email_index = 1 THEN 'PASS' ELSE 'FAIL' END,
         index_summary.email_index || ' email index'
  FROM index_summary
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
```

Two notes. The CHECK count uses an explicit `IN (…)` list of the 16 constraint names (R-5), so no literal contains `%`; the `' '` separators are the only non-alphanumeric characters in any literal. The migration test (file 4) extracts the CHECK names from the migration and the `IN` list from this checker and asserts they are the same 16, so the two files cannot drift. The script asserts **exactly** `SELECT INSERT UPDATE` for `service_role`, which is stricter than the entitlements checker's "no d or D" test.

---

## 6. Runbook: applying the migration by hand

This section holds everything the SQL files cannot, because of the editor constraints.

| Step | What | Expected | If not |
|---|---|---|---|
| 1 | **Pre-check** (read-only): `SELECT count(*) AS existing_invite_tables FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'business_os_invites';` | `0` | `1` means it is already applied. Go to step 3 and do not paste again. |
| 2 | Paste the whole of `20261012_business_os_invites.sql` in one go. | "Success. No rows returned." | Any error rolls the whole transaction back, so nothing is half-applied. Send the error text to Dev. |
| 3 | Paste `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS`, 11 pass, 0 fail | A FAIL on I04 or I05 means privileges drifted (Supabase default privileges). Re-run only the five `REVOKE`/`GRANT` statements from the migration, then step 3 again. Any other FAIL means rollback (§12). |
| 4 | Deploy the code (merge). | The admin Invites page loads an empty list. | If the page shows "could not read invites", the migration is missing. Run step 1. |

**Operator note (R-4).** Until Slice 1 ships, invite links are for **internal demos only**. Do not hand them to real invitees: nobody can sign up from the page yet, and a link would expire before signup exists.

**Why each part of the migration looks the way it does** (moved here from the SQL on purpose):

- **Safe before the code.** Nothing reads the table until the Slice 0 code deploys. Applying it changes nothing a customer or admin sees. Code deployed before the migration fails closed: admin routes return 500 "could not read invites", and the public page shows "try again".
- **No foreign keys** to `auth.users` (T-1, RC-9). A deleted account must not cascade the structural record away, which §9 requires.
- **No `user_id` column.** Invites are platform records, not tenant data (§8.2). The purge classification is `never`, with global scope (C-10).
- **`REVOKE ALL` from all four roles, then a narrow `GRANT`.** An enumerated REVOKE left `MAINTAIN`, `DELETE` and `TRUNCATE` behind in 20261005 (fixed in 20261009). `service_role` gets no `DELETE`: invites are revoked, never deleted.
- **No plan names in SQL** (FR-12). The access CHECK keys on `grant_kind`. Grant ids and language are not CHECK-listed (T-1), because config is the source of truth.
- **The token is stored only as SHA-256 hex.** A database read, including one made with the leaked service-role key, never yields a usable link (§8.1, C-3).
- **`updated_at` has no trigger.** The repository writes it on every update. That keeps Slice 0 function-free (C-2).
- **Delivery and one-time-code columns** arrive in Slices 1 and 2 as additive `ALTER TABLE … ADD COLUMN` (C-1).

---

## 7. API contracts

### 7.1 `GET /api/admin/business-os/invites`

No query parameters in Slice 0 (R-2: filters and search move to Slice 1). The list is the newest 200 invites. `formOptions.defaultLanguage` is always `en` (C-8 as amended). The response is 200:

```json
{
  "success": true,
  "data": {
    "invites": [{
      "id": "uuid", "email": "x@example.com", "inviteType": "champion",
      "grantLabel": "Founding Partner", "accessSummary": "No end date",
      "inviterDisplayName": "Dana", "language": "en",
      "createdAt": "ISO", "linkExpiryDays": 30, "linkExpiresAt": "ISO",
      "state": "pending", "firstViewedAt": null,
      "revokedAt": null, "revokeReason": null, "redeemedAt": null
    }],
    "formOptions": {
      "expiryDays": [15, 30, 60], "defaultExpiryDays": 30,
      "languages": ["en", "es", "he"], "defaultLanguage": "en",
      "championAccessMonthsMax": 60,
      "inviteTypes": [
        { "type": "champion", "label": "Champion (Founding Partner)", "available": true, "unavailableReason": null, "grants": [] },
        { "type": "paid", "label": "Paid", "available": false, "unavailableReason": "available when payments are live",
          "grants": [{ "id": "<TIER_ORDER[0]>", "label": "Essentials", "default": true }, { "id": "<TIER_ORDER[1]>", "label": "Autopilot", "default": false }] }
      ]
    },
    "enforcementMode": "off"
  }
}
```

List rows never include `token_hash`, `issuer_admin_id`, `internal_reason` or `redeemed_account_id`; accepted-account details arrive in Slice 1. The grant ids are shown as `"<TIER_ORDER[n]>"` because at runtime they are read from config, never written in code.

### 7.2 `POST /api/admin/business-os/invites`

Body (discriminated on `inviteType`, every variant `.strict()`):

| Field | champion | paid |
|---|---|---|
| `email` | required, trimmed, lowercased, `.email()`, max 320 | same |
| `inviteType` | `'champion'` | `'paid'` |
| `grantId` | **forbidden** (the grant is `INVITE_TYPES.champion`'s cohort) | required, `z.enum(TIER_ORDER)` |
| `access` | **required key** (RC-4): `{ kind: 'open_ended' }` or `{ kind: 'months', months: 1..60 }` | forbidden |
| `linkExpiryDays` | `z.union` of the literals in `INVITE_LINK_EXPIRY.optionsDays` | same |
| `language` | `z.enum(locales)` from `lib/i18n/config` | same |
| `personalNote` | optional, trimmed, max 1000, plain text | same |
| `reason` | trimmed, min 3, max 500 | same |

Responses: 201 `{ invite, link }` with `Cache-Control: no-store`, where `invite` has exactly the §7.1 list-row shape (the same mapper, R-7). 400 `invalid_input` (Zod flatten, with details only in development). 409 `paid_invites_not_available`. 401 and 403 come from the gate. 500 `could_not_create_invite`.

### 7.3 `POST /api/admin/business-os/invites/[inviteId]/revoke`

Body `{ reason: string 3..500 }` `.strict()`. Responses: 200 `{ invite }`, 400, 401, 403, 404 `invite_not_found`, 409 `invite_not_revocable` (accepted or already revoked).

### 7.4 `POST /api/public/invites/validate`

The route exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` (R-6). Body `{ token: string (max 512) }` `.strict()`. The response is always 200 for a well-formed body:

| `state` | Extra fields (allow-list, exact key set) |
|---|---|
| `not_recognised` | none, and identical bytes for unknown, malformed and one-character-off tokens |
| `valid` | `language`, `inviterDisplayName`, `personalNote`, `linkExpiresAt`, `offer: { planName, free, monthlyPriceUsd, access: { kind, months }, included: [{ category, label, summary }] }` |
| `expired`, `revoked`, `used`, `unavailable` | `language`, `inviterDisplayName` |

Never returned: email, any id, the hash, the issuer email, the internal reason, the revoke reason. Other responses are 400 `invalid_request` (shape only) and 503 `unavailable_try_again`. Every response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

---

## 8. Task List

- ✅ **Step R** — Apply SA's R-1 to R-7 to this workplan, including the three R-2 scope cuts.
- ✅ **Step 0** — Branch `feature/bos-invite-signup-slice-0` cut from `origin/main` (64a4062d) in the `neuronforge-invite-s0` worktree; confirmed with `git branch --show-current`. `20261012` re-checked on `origin/main`: still free (last migration `20261011_bos_cron_runs.sql`).
- ✅ **Step 1** — Migration, rollback and checker (files 1–3), and the migration text test (file 4).
- ✅ **Step 2** — Config `config/invites.ts` and its invariant test (files 5–6).
- ✅ **Step 3** — Pure modules: `inviteToken`, `inviteState`, `inviteSchemas` and their tests (files 7–9, 13–15).
- ✅ **Step 4** — Repository: `BusinessOsInviteRepository`, types, index exports and its unit test (files 19, 21, 51, 52). (Files 20, 22, 23 cut by R-2.)
- ✅ **Step 5** — `adminInviteOps` and `inviteOffer` with their tests (files 10–11, 16–17).
- ✅ **Step 6** — Admin routes (GET, POST, revoke) with integration tests (files 24–27). Add the audit events (files 45, 54, 55).
- ✅ **Step 7** — `publicInviteView`, the public validate route and their tests (files 12, 18, 28–29).
- ✅ **Step 8** — Middleware branch and its test (files 43–44).
- ✅ **Step 9** — Admin page and components, the sidebar entry, and tests (files 30–38, 49–50).
- ✅ **Step 10** — Public page, layout, copy and render test (files 39–42).
- ✅ **Step 11** — Purge registration and baseline, plus the invariant assertion (files 46–48). Add the entitlements doc row (file 53).
- ✅ **Step 12** — Local verification: the 16 new suites (301 tests), `npm run test:authz-guard`, `npm run test:bos-entitlements` (1 pre-existing failure, `customerPlanView.test.ts`, untouched by this slice), every `*guard*` / `*forbidden*` / `*invariant*` suite in the repo (36 suites), the audit, purge, admin and middleware suites, a scoped `tsc --noEmit` over the 51 touched TypeScript files (0 errors in them; 3 pre-existing errors in untouched files reached through imports), `eslint` on the touched files (0 errors; 7 pre-existing warnings), and `npm run lint:hooks` (clean). `npx next build` not run (D-dev-7).
- ✅ **Step 13** — Uncommitted diff handed to SA for code review (verdict: Fix Required, M-1 to M-3).
- ✅ **Step 14** — SA code review fixes. **M-1:** the repository logs and returns only `safeDbError(error)` = `{ code, message }`; `details` / `hint` never leave it, and `toError` builds a fresh `Error` from the projection. Test: a `PostgrestError` whose `details` and `hint` hold a fake hash and email, for all six methods, on a CHECK and a unique violation. **M-2:** `access_months IS NOT NULL` and `revoke_reason IS NOT NULL` added, names unchanged, migration-text assertions added. **M-3:** new `lib/business-os/entitlements/planOfferView.ts` (`describePlanOffer`) with its test; `inviteOffer.ts` imports it and no resolver; its allow-list entry updated. **N-1** documented under F-2. **N-2** checker I11 (email index via `pg_indexes`). **N-3** recorded in §4 and pinned by the migration test. **N-4** inviter name capped by code point, with a surrogate-pair test.
- ⬜ **Step 15** — SA re-checks M-1 to M-3 and the build, then QA. **No commit**; RM commits after approval.

---

## 9. Traceability: C-1 to C-13 and T-decisions

| Condition | What it requires | Satisfied by | Tasks / files | Proven by |
|---|---|---|---|---|
| **C-1** One migration, one table | `business_os_invites` only, with the listed columns, UNIQUE `token_hash`, an email index, safe before deploy | §4. Every C-1 column is present, including `inviter_display_name`, `language`, `personal_note` with its CHECK, `internal_reason`, `link_expiry_days`, the revoke trio and the redeem pair. No delivery or OTP columns. | Step 1, files 1, 4 | Migration test: exactly one `CREATE TABLE`, all C-1 columns present, no delivery or OTP column, no function. §6 step 1. |
| **C-2** Privileges and checker | RLS, no policy, `REVOKE ALL` from the four roles, narrow `GRANT`, no enumerated REVOKE, no function, and a read-only checker covering `MAINTAIN`, `TRUNCATE`, `REFERENCES`, `TRIGGER` and policies | §4 privilege block. §5 checker I02–I05 via `aclexplode`. | Step 1, files 1, 3, 4 | Migration test: regex `/REVOKE\s+(?!ALL\b)/i` has no match, and the grant is exactly `SELECT, INSERT, UPDATE`. The checker contains I01–I11 (I11: the email index, SA N-2). §6 step 3 run on prod. |
| **C-3** Token | 32 random bytes, base64url, SHA-256 digest only, Zod format before hashing, raw token once with `no-store`, fragment link from the origin helper, tests with no token in the row or audit | `inviteToken.ts`, D-6, §2.3 create flow | Steps 3, 5, 6, files 7, 10, 13, 16, 24, 26 | Tests: the token is 43 characters and matches the pattern; the inserted row's `token_hash` is not the token and equals `sha256(token)`; audit `details` contain neither token nor hash (serialised search); the response header is `no-store`; the link starts with `platformUrl('/invite')#t=`. |
| **C-4** Public surface | Middleware allow-list, client shell reading the fragment, validate route outside admin (`nodejs`, `force-dynamic`, `no-store`), `no-referrer`, identical not-recognised response, state only on match, explicit allow-list, conditional `first_viewed_at`, no in-memory limiter | Middleware branch (file 44). `app/invite/*`. `app/api/public/invites/validate`, which exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` (R-6). `publicInviteView.ts`. D-5, D-7, D-11. | Steps 7, 8, 10, files 12, 18, 28, 29, 39–44 | Tests: the route module's `runtime` is `'nodejs'` and `dynamic` is `'force-dynamic'` (R-6); deep equality of status, body and headers across unknown, malformed and one-character-off tokens (AC-2); exact key sets per state; `markFirstViewed` called only for `valid`, with the filter `is('first_viewed_at', null)`; middleware sets the header and skips the onboarding check. Per-IP limiting is recorded as a **follow-up** (a Vercel Firewall rule, ops), not built. |
| **C-5** Admin routes and page | Under `app/api/admin/business-os/invites/**`; `requireAdmin` first; `.strict()` bodies; reason ≥ 3; repository only; new `AUDIT_EVENTS`; non-blocking audit with `correlationId`; revoke as a conditional UPDATE with 409; page at `app/admin/business-os-invites/` with no own check; authz guard green with no cap change | Files 24, 25, 30–38, 45, 54, 55. Revoke flow in §2.3. Audit is `log(…).catch` followed by `await flush().catch` before the response (R-1, SA ruling on F-3). | Steps 6, 9 | Route tests: 401 and 403 with `request.json` never called (proves the gate ran first); 400 on a short reason; 409 on revoking a revoked or accepted invite; `flush` is called after `log` and before the response, and a rejected `flush` still returns 201 / 200 (R-1). The source guard proves no `requireAdmin`, `AdminAccessService` or `profiles` import in the screen. `npm run test:authz-guard` is green with an unchanged `CAPS` block. |
| **C-6** Paid refused on the server | 409 for any tier grant while the switch is off. The disabled UI is presentation only. | `adminInviteOps.createInviteForAdmin` checks `INVITE_ISSUANCE_POLICY.paidInvitesAvailable` **after** Zod and **before** any write | Steps 5, 6, files 10, 16, 26 | Tests: POST `{ inviteType: 'paid', grantId: TIER_ORDER[0], … }` returns 409 `paid_invites_not_available`, and the repository is never called. The config invariant pins `paidInvitesAvailable === false` until Slice 5. |
| **C-7** Config and literals | Expiry and issuance policy under `entitlements/config/`; enums from `COHORT_IDS` and `TIER_ORDER`, not `COHORT_VALUES`; Paid default `TIER_ORDER[0]`; tier-literal guard green without a baseline change; RC-4 a required key | File 5. Schemas in file 9 import only `config/*`, never `adminOps`. | Steps 2, 3, files 5, 6, 9, 15 | Invariant test: champion grant ids ⊆ `COHORT_IDS`; paid grant ids equal `TIER_ORDER`; the default is `TIER_ORDER[0]`; the default expiry is in the options. A source test shows `inviteSchemas.ts` does not reference `COHORT_VALUES`. The schema test rejects a champion body without `access`. `tierLiteral.forbidden.test.ts` passes with `BASELINE` untouched: every invite test **outside** `entitlements/__tests__` derives tier ids from `TIER_ORDER` and never writes the literal. |
| **C-8** Language (**SA-amended for Slice 0, 2026-09-28**) | For Slice 0 the default is `en`; the default from `user_preferences.preferred_language` moves to Slice 2, where the language first drives an email. The rest stands: submitted value validated and persisted; the page reads only the invite column; no `LanguageContext` | `buildInviteFormOptions` (file 10) returns `defaultLanguage: 'en'` and `languages` from `locales`. The create schema uses `z.enum(locales)`. The public view returns `row.language`. | Steps 5, 10 | Tests: `formOptions.defaultLanguage` is `en` and `languages` equals `locales`; an unknown language is refused with 400; the stored row carries the submitted language. The admin source guard finds no import outside the screen (so no `LanguageContext`); the public page test proves it renders in the response `language` and ignores `navigator.language`, and a source test finds no `LanguageContext` or `useLanguage` in `app/invite`. |
| **C-9** Inviter name | Snapshot at creation from profile or metadata through a repository, falling back to "AgentPilot"; the public route never reads admin data | D-12. `userProfileRepository.findById(adminId).full_name`, otherwise `'AgentPilot'`, stored in `inviter_display_name`. The public view selects only that column. | Step 5, files 10, 12, 16, 18 | Tests: a profile name is used; a null or blank name gives `AgentPilot`; a profile error gives `AgentPilot` with a warning; the public view's select constant contains no `issuer_*` column. See §13 F-5 on metadata. |
| **C-10** Purge and deletion registration | `never(...)` in `descriptors.ts`, plus `businessOwnedTables.ts` and `accountDeletionPolicy.ts` "as their tests require" | `never('business_os_invites', G, …)` plus the baseline. **Not** added to `USER_OWNED_TABLES` or deletion policy, because their tests do not require it (no `user_id` column) and adding it would break account deletion (§13 F-1). | Step 11, files 46–48 | The descriptors invariant has a new assertion (never; excluded from every Reset or Purge combination). `businessOwnedTables.test.ts` stays green. The migration test pins the absence of a `user_id` column. |
| **C-11** Expiry derived | One pure function with an injected clock, used by both list and page; no cron; no stored `expired` | `deriveInviteState(row, now)` (file 8), imported by `adminInviteOps` and `publicInviteView` | Steps 3, 5, 7 | Tests cover the boundary (`now == link_expires_at` counts as expired), every state, and precedence (accepted over revoked over expired over pending). A source test shows both callers import it and neither compares `link_expires_at` itself. The migration test shows no `state` or `expired` column. |
| **C-12** Tests | Per route: happy, 401/403, 400; per repository method; token leak; AC-2; AC-3; paid refused; injected fields rejected; three guards green; manual QA | §10 and §11 | Steps 3–12 | §10 table |
| **C-13** Service-role documentation | Every `supabaseServer` use states that invites are platform records reached unscoped by admins and by token hash from the public route; admin methods named for admin scope | The repository header comment and a per-method note. Method names: `createForAdmin`, `listRecentForAdmin`, `findByIdForAdmin`, `revokeForAdmin`, `findByTokenHashForPublicView`, `markFirstViewed`. | Step 4, file 19 | **SA-amended for Slice 0 (R-2):** met by method naming plus the in-code service-role comments. The callers guard (file 23) moves to the first slice that adds account-issued (`issuerAccountId`-scoped) methods. A comment in the repository names those future methods as **separate** methods (§14). The repository unit test pins the method names and that the header comment states the service-role reason. |

| T-decision | Slice 0 application |
|---|---|
| **T-1** | Explicit grant columns, structural CHECKs only (keyed on `grant_kind`, never plan names), no FK anywhere, and no lineage table (that is Slice 1). |
| **T-5** | No account is created in Slice 0, so no mailbox-proof step exists yet. Nothing in the Slice 0 schema or UI marks anything confirmed, and the copy-link panel does not claim delivery. The OTP columns (hash, expiry, attempts) arrive additively in Slice 1. Because T-5 chose "always a one-time code", **no `delivered_by_email` column is needed**. |
| **T-7** | The token is in the fragment (`/invite#t=…`), stripped from the address bar (D-11), POSTed in the body, `Referrer-Policy: no-referrer` (middleware header, layout meta and route response), never passed to a logger (Pino `token` redaction is only a backstop), and never in audit details. |
| **T-12** | **Sequenced by SA (R-2):** Slice 0 pre-selects `en`; the pre-select from `user_preferences.preferred_language` through a new repository arrives in Slice 2. Validate against `locales`, persist on the row. The row is the only source for the page. |
| **T-14** | Code config `INVITE_LINK_EXPIRY`. The create schema is built from it. `link_expiry_days` and `link_expires_at` are stamped at creation. |
| **T-15** | `INVITE_ISSUANCE_POLICY` in `config/invites.ts`, checked at creation (and re-checked at redemption in Slice 1), carrying `paidInvitesAvailable: false`, which the server enforces (C-6). |

---

## 10. Test plan (C-12)

| Suite | File | Cases |
|---|---|---|
| Admin list and create route | `app/api/admin/business-os/invites/__tests__/route.test.ts` | **GET:** 401 signed out; 403 signed in non-admin; 403 when `profiles.role = 'admin'` but not in `admin_users`; 403 when the admin check throws; 200 with no `token_hash` or `issuer_admin_id` in any row, `formOptions` from config (`defaultLanguage: 'en'`), paid `available: false`; 500 on a repository error. **POST:** 401 and 403 with `request.json` never called; 400 bad email, missing `reason`, a 2-character reason, champion without `access`, `linkExpiryDays: 45`, unknown language; 400 for each injected field `grant_id`, `grantKind`, `issuerAdminId`, `issuer`, `userId`, `tokenHash`, `cohort`, `level` (AC-6 style, via `.strict()`); 409 paid with `TIER_ORDER[0]` and no repository call; **201 happy path**: the link has the fragment, `no-store` is set, the stored hash equals `sha256(token)` and differs from the token, `link_expires_at = now + 30d` under a frozen clock, `inviter_display_name` comes from the profile, the audit action is `BOS_INVITE_CREATED` with `correlationId` and **no token or hash anywhere in the serialised audit and logger calls**; the `invite` in the body has exactly the list-row key set and none of `token_hash`, `tokenHash`, `issuer_admin_id`, `internal_reason`, `redeemed_account_id` (R-7); `flush` is called after `log` and before the response, and a rejected `flush` still returns 201 (R-1). |
| Revoke route | `…/__tests__/revoke.route.test.ts` | 401; 403; 400 non-uuid id, short reason, extra key; 404 unknown id; 409 already revoked; 409 accepted; 200 pending; 200 expired (revoke allowed); audit `BOS_INVITE_REVOKED`; `flush` after `log`, and a rejected `flush` still returns 200 (R-1). |
| Public validate route | `app/api/public/invites/validate/__tests__/route.test.ts` | `runtime === 'nodejs'` and `dynamic === 'force-dynamic'` (R-6). No auth call is made. **AC-2**: unknown valid-format token, malformed token (`abc`, 44 characters, a character outside the set) and a real token with one character changed all give identical status, body and `no-store` / `no-referrer` headers. `valid` has the exact key set and no email, ids or hash. `expired` (frozen clock past `link_expires_at`), `revoked`, `used` (`redeemed_at` set in the fixture), and `unavailable` (grant id not in an injected config) each have the narrow key set. `first_viewed_at` is updated only on valid, and only when null. 400 for a non-object body, a missing token or an extra key. 503 on a repository error. The token and the hash never appear in logger calls. Not applicable: 401 and 403 (public by design, §13 F-2). |
| Token | `inviteToken.test.ts` | Length 43; matches the pattern; 1,000 draws are all distinct; the hash is 64 lowercase hex and deterministic; the link format. |
| State | `inviteState.test.ts` | Every state; the boundary instant; precedence; **AC-3**: the state of an existing row is unchanged after the injected expiry config changes to `[7]` / `7` (the function takes no config). |
| Schemas | `inviteSchemas.test.ts` | Enums equal config; the default expiry; RC-4 required; paid requires `grantId`; champion forbids `grantId`; `.strict()` everywhere; the email is normalised. |
| Admin ops | `adminInviteOps.test.ts` | The allow-list: extra properties on the input object never reach `createForAdmin`. The `en` language default. Name snapshot and fallback. Paid refused before the write. The revoke outcome mapping. The list-view mapper's exact key set (R-7). |
| Offer | `inviteOffer.test.ts` | The champion offer is free and its name equals `config.cohorts[<champion id>].labels.en`. A tier offer has a price from `presentation`. `included` is non-empty and excludes hidden capabilities. The access summary covers open-ended and N months. No literal plan names in the source. |
| Public view | `publicInviteView.test.ts` | The pure core of the route cases, with injected repository, config and clock. |
| Invite repository | `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | **One per method:** `createForAdmin` (explicit column object, error path); `listRecentForAdmin` (newest first, the select constant excludes `token_hash`, the limit clamped, error path); `findByIdForAdmin` (found, not found); `revokeForAdmin` (conditional `is('redeemed_at', null)`, `is('revoked_at', null)`, sets the trio plus `updated_at`, null on no row); `findByTokenHashForPublicView` (`eq('token_hash', …)`, the narrow select constant, `maybeSingle`); `markFirstViewed` (conditional, sets `updated_at`). |
| ~~Preferences repository~~ | — | **Cut (R-2), Slice 2.** |
| ~~Callers guard~~ | — | **Cut (R-2)**, first account-issued slice. |
| Migration text | `supabase/migrations/__tests__/business-os-invites.migration.test.ts` | No `--` and no `/*`; every string literal matches `/^[A-Za-z0-9_ ]*$/`; no single-letter alias (`/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b/i`); no `REFERENCES`; no `champion`, `trial`, `basic` or `pro` literal (derived from `COHORT_IDS` and `TIER_ORDER`); REVOKE ALL from exactly the four roles; exactly one GRANT; RLS enabled; no `CREATE FUNCTION` or `CREATE TRIGGER`; the checker's `IN (…)` list names exactly the 16 CHECK constraints the migration defines, and the checker contains no `LIKE` and no `%` (R-5; extracted from both files, so the two cannot drift). |
| Config invariant | `lib/business-os/entitlements/__tests__/inviteConfig.invariant.test.ts` | See C-7. Also: no invite type grants `trial` (BQ-3), and `paidInvitesAvailable === false`. |
| Purge | `descriptors.invariant.test.ts` (modified) | `business_os_invites` is `never`, in no run. The existing baseline tests pass with the new entry. |
| Sidebar | `AdminSidebar.nav.test.ts` (modified) | The Businesses list, count 26. |
| Admin page | `app/admin/business-os-invites/__tests__/page.render.test.tsx` | Loads the list (no filter controls, R-2); the expiry select offers exactly 15/30/60 with 30 selected; the language defaults to `formOptions.defaultLanguage`; the Paid option is disabled with "available when payments are live"; champion requires an access choice; after a create the link panel shows the link and the copy button writes it to the clipboard; after a reload the link is gone; revoke asks for a reason and refreshes the row to Revoked; the enforcement note renders. |
| Admin source guard | `…/source.guard.test.ts` | Imports only from inside the screen, React, lucide and `@/components/ui/*`; no admin check; no entitlements, repositories or `LanguageContext`. |
| Public page | `app/invite/__tests__/page.render.test.tsx` | Reads `#t=`; calls `history.replaceState` before `fetch`; the token goes only in the POST body (never in the URL or a query); renders each state; the valid state ends with the R-4 line naming the inviter; `dir="rtl"` for `he`; the note renders as text (a `<script>` string appears literally); no `dangerouslySetInnerHTML`, `LanguageContext` or `useLanguage` in the source. |
| Middleware | `app/invite/__tests__/middleware.invite.test.ts` | `/invite` gets `Referrer-Policy: no-referrer`, with no redirect even when an auth cookie is present; a business subdomain `/invite` is still rewritten to the site. |
| Guards that must stay green | existing | `npm run test:authz-guard` (CAPS unchanged), `tierLiteral.forbidden.test.ts` (BASELINE unchanged), `npm run test:bos-entitlements` (including `businessOsEntitlements.imports.guard` and `accountSeam.guard`), `businessOwnedTables.test.ts`, `npm run lint:hooks`, `next build`. |
| Manual QA | workplan § QA | §11 demo, plus the token-leak spot check (AC-2 and T-7, the Slice 0 part of AC-9). |

---

## 11. Manual QA demo script

**Preconditions:** the migration is applied and §6 step 3 reads PASS. The branch is deployed to a preview or run locally. You are signed in as a platform admin (in `admin_users`).

**Operator note (R-4):** until Slice 1 ships, links are for internal demos only and must not be handed to real invitees, since they would expire before signup exists.

| # | Action | Expected |
|---|---|---|
| 1 | Open `/admin`. In the sidebar under **Businesses**, click **Invites**. | The page loads with an empty list (or existing rows). The note says champion access is recorded and nothing is enforced yet. |
| 2 | Click **New invite**. | Email is empty. Type offers **Champion** (enabled) and **Paid** (disabled, "available when payments are live"). Link expiry offers exactly 15, 30 and 60 days, with **30** selected. Language is pre-selected to English (C-8 as amended; your saved preference arrives with Slice 2). |
| 3 | Enter `x@example.com`, choose Champion, access **No end date**, keep 30 days, write the note "Welcome aboard, would love your feedback", and the reason "QA slice 0 demo". Click **Create**. | A panel shows the link `…/invite#t=<43 characters>` with a **Copy** button and the warning "This link is shown once." The new row reads **Pending** with an expiry date 30 days out. |
| 4 | Click **Copy**. Open a **private window** and paste the link. | The address bar settles on `/invite`, with no `#t=`. The page shows the **valid** state: "<your name> invited you", your note, **Founding Partner**, "Free", "No end date", the list of what is included, and the link expiry date. No signup form appears (Slice 0); instead the page ends with "You can't create your account from this page yet. <your name> will let you know when you can." (R-4). |
| 5 | In the private window, open the dev tools Network tab and reload the pasted link. | The validate request is a POST with the token in the **body**. Its response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and contains no email and no ids. |
| 6 | Change one character of the token in the URL and load it. Then load `/invite#t=abc`. | Both show the same **"We don't recognise this invitation"** page, and their responses are identical. |
| 7 | Back in the admin window, reload the Invites page. | The link panel is gone and cannot be shown again. The row still reads **Pending**. |
| 8 | Click **Revoke** on the row, enter the reason "QA revoke test" and confirm. | The row reads **Revoked**, with the reason and time. |
| 9 | In the private window, load the original link again. | The page says the invitation **was withdrawn**, names you, and suggests asking for a new one. It shows no note and no plan. |
| 10 | ~~Filter and search~~ | **Dropped (R-2):** filters and search move to Slice 1. |
| 11 | (Optional) Revoke the same row again with the API or a second tab. | 409 "cannot be revoked". |
| 12 | **Leak spot check:** in Vercel logs (or the dev console with `npm run dev:pretty`), search for the first 10 characters of the token. Then check the `audit_trail` rows for the invite id. | There is no match in the logs. The audit entries for `BOS_INVITE_CREATED` and `BOS_INVITE_REVOKED` contain neither the token nor its hash. |
| 13 | (Expiry, optional) Create a second champion invite for `y@example.com` and open its link (valid). Wait at least one minute. Then, on that **test** row only, run in the SQL editor: `UPDATE public.business_os_invites SET link_expires_at = now() WHERE email = 'y@example.com' AND revoked_at IS NULL;`. Reload the link and the list. | The page shows **expired** and the list shows **Expired**, with no job having run. (The CHECK requires `link_expires_at > created_at`, which the minute's wait satisfies.) |

QA records the result of each step in the QA report below.

---

## 12. Rollback

| Scenario | Action | Consequence |
|---|---|---|
| **Code problem after merge** | RM reverts the merge commit. The table can stay: nothing else reads it, and it is inert. | Invite links issued so far stop resolving until redeployed. No account, plan or lineage exists in Slice 0, so no user is affected. |
| **Migration problem** (§6 step 3 FAIL other than privileges) | First revert or hold the code (otherwise admin routes return 500 until redeployed). Then paste `supabase/SQL Scripts/20261012_business_os_invites_rollback.sql`. Then run the §6 step 1 pre-check, which must return `0`. | **All invite records are deleted**, and links already handed out show "not recognised". Before dropping in production, export the rows the admin cares about: `SELECT email, invite_type, grant_id, created_at, link_expires_at, revoked_at FROM public.business_os_invites ORDER BY created_at;` |
| **Privilege drift only** (I04 or I05 FAIL) | Re-run the five `REVOKE`/`GRANT` statements from the migration, then the checker. | No data change. |
| **Purge registration** | Reverted with the code. A `never` descriptor for a missing table emits no delete, so the order of the revert does not matter. | None. |

Rollback is safe in every order because Slice 0 writes to no existing table and no other code reads `business_os_invites`.

---

## 13. Findings for SA: ambiguities and deviations

| # | Condition | Finding | What this workplan does | SA decision needed? |
|---|---|---|---|---|
| **F-1** | C-10 | "plus `businessOwnedTables.ts` / `accountDeletionPolicy.ts` as their tests require." **Their tests do not require it**, because the table has no `user_id` column (`businessOwnedTables.test.ts` scans CREATE TABLE bodies for `user_id`). Adding it to `USER_OWNED_TABLES` would be **harmful**: `accountTablesToProcess()` feeds every `USER_OWNED_TABLES` key into the account-deletion sweep, which deletes `WHERE user_id = …` (`keyColumnFor` defaults to `user_id`), and that would error on this table. | `descriptors.ts` `never(…, G, …)` plus the baseline only, following the `archive_runs` / `bos_cron_runs` precedent. **Consequence:** account erasure does not reach invite rows. §9's "erasure anonymises the invitee email on invite and lineage rows" therefore needs its own mechanism, owned by Slice 1 (the first slice with a redeemed account) or L-12. | Confirm |
| **F-2** | C-12 vs AC-2 | C-12's "per route: 401/403, 400" cannot apply literally to the public validate route. It has no auth, and a 400 for a malformed **token** would break AC-2's identical response. | 400 is only for body **shape** (non-JSON, missing or extra key, or a `token` longer than 512 characters: `.max(512)` is a body-size guard, so an overlong token is a malformed body, not a malformed token, SA N-1). Every token-content failure is the identical 200 `not_recognised`. 401 and 403 are listed as not applicable. | Confirm |
| **F-3** | C-5 | C-5 says audit is non-blocking. The entitlements admin routes instead **flush the audit before responding** (WC-7), because a serverless instance can be frozen after the response. | **SA decided (R-1):** log non-blocking, then `await auditTrail.flush().catch(…)` before the response, in the create and revoke routes (D-9). The row itself stays the durable record (§8.3). | Decided (R-1) |
| **F-4** | FR-9, C-8 | "What the plan includes … in the invite's language." `planLabel` and `describePlanCapabilities` read `labels.en` only, and every plan and capability label is an English placeholder in all three locales today (cohorts.ts, tierMatrix.ts). | The page chrome is translated (`en`/`he`/`es`, RTL for `he`). Plan and capability names render through the existing helpers and are therefore English, exactly like the customer "Your plan" section. Nothing new is duplicated. When real translations land, a `locale` parameter on those helpers fixes both surfaces at once. | Confirm |
| **F-5** | C-9 | "from the admin's profile or auth metadata." `requireAdmin` returns only `{ id, email }`, so auth metadata needs an extra `auth.admin.getUserById` call. | Uses `profiles.full_name` (through the existing `UserProfileRepository.findById`), otherwise `'AgentPilot'`. No metadata call. | Confirm, or ask for the metadata fallback |
| **F-6** | C-4 | "or signed-out visitors are redirected." In `middleware.ts` the onboarding redirect only fires for a **signed-in** user whose onboarding is incomplete; a signed-out visitor already passes. The allow-list is still needed, because an admin testing the link in a normal window, or any signed-in non-onboarded user, would be sent to `/onboarding-chat`. | Adds the branch (with the `Referrer-Policy` header) after the subdomain rewrite. | No |
| **F-7** | C-2 / user SQL rule | "No punctuation inside strings" rules out a regex CHECK on the token hash and an `@` CHECK on the email. | Length CHECKs in SQL (D-3). The syntax is Zod's. The checker's `LIKE 'business_os_invites_%'` is the one remaining `%`, with a fallback noted in §5. | No |
| **F-8** | C-7 | The tier-literal guard's allowed prefixes do not cover the new test folders (`lib/business-os/invites/__tests__`, the new route and page `__tests__`). | Those tests derive tier ids from `TIER_ORDER` and never write the literal. Only the config invariant test (inside `entitlements/__tests__`) names ids. BASELINE and ALLOWED_PREFIXES stay unchanged. | No |
| **F-9** | Branch base | Local `main` is 84 commits behind `origin/main`. Several files this slice touches changed there (`AdminSidebar`, its nav test, `events.ts`, `descriptors.ts`, the baseline, `planPresentation.ts` is new). | Every reference here is against `origin/main`. RM must cut from `origin/main`. | No (RM note) |
| **F-10** | Slice 0 page with no signup | The valid state has nothing to act on. | **SA-reworded (R-4):** the valid page ends with "You can't create your account from this page yet. {inviterDisplayName} will let you know when you can.", in `en`, `he` and `es` in `invitePageCopy.ts`. It is only visible in Slice 0 and is removed by Slice 1. | Decided (R-4) |

### Deviations found at implementation (Dev, 2026-09-28)

| # | What | Why | SA decision needed? |
|---|---|---|---|
| **D-dev-1** | The repository's list method is `listRecentForAdmin`, not `listForAdmin`. | `lib/repositories/__tests__/adminReadMethods.guard.test.ts` pins `.listForAdmin(` (for `UserProfileRepository`) to callers under `app/api/admin/**`, and matches the method NAME on any object. Our caller is `lib/business-os/invites/adminInviteOps.ts`. Renaming keeps that security guard unchanged instead of widening it; the name still ends in `ForAdmin` (C-13). | No |
| **D-dev-2** | Seven files added to `KNOWN_NON_GATE_IMPORTERS` in `enforcementPoints.test.ts` (file 58). **SA: accepted except `resolveEntitlements` in `inviteOffer.ts` (M-3); fixed, the entry now names `describePlanOffer` and no resolver.** | That guard fails on any file outside the entitlements module that imports from it until someone states it is not a gate. The invite code reads config and previews the offered plan (`resolveEntitlements` on a `previewAccountFor` account, like `adminPlansView`); it refuses no capability. Each entry lists its exact symbols, so a later gate import still fails by name. | **Confirm** |
| **D-dev-3** | `/invite` registered in `components/PlatformChrome.tsx` (file 59). | Not in the workplan's file list, but the file's own header requires every public route in both places. Without it the invitee (no account) loads the owner's `PlatformShell` / `UserProvider`. Tested in `app/invite/__tests__/middleware.invite.test.ts`. | No |
| **D-dev-4** | The public offer carries `access: { kind, months }` instead of an English `accessSummary`. | The page renders in the invite's language (C-8); an English sentence from the server would appear untranslated on a Hebrew or Spanish page. Plan and capability NAMES stay English per F-4. The admin list keeps its English `accessSummary`. The key set is still an explicit allow-list with no ids, email or hash. | Confirm |
| **D-dev-5** | Audit `log()` is awaited (with its `.catch`) before `await flush()`. | R-1 says "`log(…).catch`, then `await flush()`". `log()` builds its entry asynchronously before queueing it, so a flush started before it resolves would flush nothing. Awaiting it matches the entitlements and archiving routes and adds no failure path (`log()` never rejects on a queue failure). | No |
| **D-dev-6** | Create returns 409 `grant_not_available` when the champion cohort (or a chosen tier) is no longer in config, and `invite_type_not_allowed` if the issuance policy stops listing a type. | GR-1 and GR-3 at creation, not only at redemption. Neither fires with today's config. | No |
| **D-dev-7** | `npx next build` was not run at first; **run after the SA code review fixes with the CI placeholder env (see Step 14).** | Out of the hand-off's scope (`tsc` and `eslint` on touched files were). The `server-only` modules are imported only by the three route files; the two pages import only their own folder, `react`, `lucide-react` and (the public page) the client-safe `lib/utils/origins`. SA or CI should confirm with a build. | No |

**QA Low items fixed (Dev, 2026-09-28):** QA-1 the GET 401/403 tests assert `listRecentForAdmin` is never called; QA-2 the gate test spies on every body reader (`json`, `text`, `formData`, `arrayBuffer`, `blob`, `clone`, the `body` getter); QA-3 the reason length is counted in code points (`characterCount`, as SQL `char_length`) in `inviteSchemas.ts`, `RevokeDialog.tsx` and `CreateInviteForm.tsx`, with a two-emoji test. QA-4 left as info.

Follow-ups recorded, not built: per-IP rate limiting for `/api/public/invites/validate` as a Vercel Firewall rule (C-4, ops owner); the 12-month anonymisation job (L-12); **invite and lineage email anonymisation on erasure: folded into requirement L-12, designed in the Slice 1 workplan** (F-1, R-3).

---

## 14. Logging-standard check (console.*)

Every existing file this slice modifies was checked on `origin/main`:

| File | `console.*` calls |
|---|---|
| `middleware.ts` | 0 (uses `createEdgeLogger`) |
| `lib/audit/events.ts` | 0 |
| `lib/business-os/purge/descriptors.ts` | 0 |
| `app/admin/components/AdminSidebar.tsx` | 0 |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | 0 |
| `lib/repositories/index.ts` | 0 |
| `lib/repositories/UserProfileRepository.ts` (called, not modified) | 0 |
| `lib/repositories/types.ts`, `lib/audit/types.ts`, `lib/audit/eventAudience.ts`, `lib/audit/filterOptions.ts`, `components/PlatformChrome.tsx` (found at implementation) | 0 |
| `lib/business-os/entitlements/planPresentation.ts`, `customerPlanView.ts`, `resolver.ts` (called, not modified) | 0 |

No conversion is needed. All new server files use `createLogger`. The client pages log nothing. The three existing direct readers of `user_preferences` (`app/api/business-os/my-day/route.ts`, `app/api/cron/insight-detect/route.ts`, `app/api/payments/invoices/[id]/pdf/route.ts`) are **not** touched, so their repository non-compliance is noted here and not fixed in this slice.

---

## SA Review Notes

### SA Workplan Review — 2026-09-28

**Reviewed by SA — 2026-09-28**
**Status:** ✅ Approved with conditions. Dev applies R-1 to R-7 below to this workplan, and may then implement without another SA pass. SA checks R-1 to R-7 at code review.

**Summary.** The workplan is thorough and faithful to the requirement's §16. Every condition C-1 to C-13 maps to a file, a task and a proof. SA spot-checked the references against `origin/main` (64a4062d): `planPresentation.ts`, `customerPlanView.ts`, `lib/i18n/config.ts` (`locales = ['en','es','he']`), `UserProfileRepository`, `app/api/public/`, `20261011_bos_cron_runs.sql` and `supabase/SQL Scripts/` all exist, and no `20261012_*` migration or invite table is on `origin/main`. The migration meets C-1 and C-2: one table, `REVOKE ALL` from all four roles, a narrow `GRANT`, RLS on, no FK, no function, and no plan names. The checker's `aclexplode` approach is stricter than the entitlements checker and is the right one.

#### Rulings on F-1 to F-10

| # | Ruling | Reason |
|---|---|---|
| **F-1** | **Accepted.** Register as `never(…, G, …)` plus the baseline only. Do **not** add to `USER_OWNED_TABLES` or `accountDeletionPolicy.ts`. SA's C-10 wording ("as their tests require") is satisfied, because those tests do not require it. **Tracking:** erasure anonymisation of invite and lineage emails becomes part of **L-12** in the requirement's §16.5, which now covers both the 12-month retention job and the erasure path. SA records it there at the next requirement touch (the Slice 1 workplan review), and the Slice 1 workplan must design it, since Slice 1 creates the first redeemed accounts. Until then, the follow-up line in §13 of this workplan is the interim record. | Adding a table with no `user_id` to the deletion sweep would make account deletion fail. Erasure is not wired to account deletion today anyway (a known backlog item), so nothing is lost in Slice 0, which holds only an admin-typed email. |
| **F-2** | **Accepted.** 200 `not_recognised` for every token-content failure, with identical body and headers. 400 only for body shape. 503 only for a repository error. 401 and 403 are not applicable. | A shape error reveals nothing about any token. C-12's "401/403, 400" applies to authenticated routes; for the public route, AC-2 takes precedence. |
| **F-3** | **Decided: log non-blocking, then flush.** `auditTrail.log(…).catch(…)` followed by `await auditTrail.flush().catch(…)` before the response, in the create and revoke routes, exactly as the entitlements and archiving admin routes do. | `AuditTrailService` batches on a `setInterval` (5 s). On Vercel the instance can freeze after the response, so an unflushed entry can be lost. "Non-blocking" in C-5 means an audit failure never fails the request, and the `.catch` on both calls keeps that. The cost is one round trip on two low-volume admin actions. |
| **F-4** | **Accepted.** The page chrome is translated. Plan and capability names come from the existing helpers and are English today, as on the customer "Your plan" section. | These names are English placeholders in all three locales (requirement §9). Duplicating a translation path here would create a second source; the future `locale` parameter fixes both surfaces at once. |
| **F-5** | **Accepted.** `profiles.full_name` through `UserProfileRepository.findById`, otherwise `AgentPilot`. No auth-metadata call. | C-9 said "profile or metadata"; either one satisfies it. One repository read is simpler than an extra admin-API call, and the fallback is the one the user decided (BQ-9). |
| **F-6** | **Accepted.** | The branch is still needed for signed-in, not-yet-onboarded visitors, and it is where the header is set. |
| **F-7** | **Accepted, with R-5.** | Length checks in SQL and syntax checks in Zod is the right split. |
| **F-8** | **Accepted.** | Only the config invariant test names tier ids, and it sits in an allowed prefix. |
| **F-9** | **Accepted.** RM cuts from `origin/main`. | |
| **F-10** | **Keep the line, reworded (R-4).** | A valid page with nothing to do and no explanation reads as broken. The proposed "coming soon, keep this link" promises a date nobody has committed to, and the link may expire before Slice 1 ships. |

#### Scope judgement (the 53-file count)

The count is **mostly honest**. Of the 43 new files, 19 are tests, and 4 are SQL or operator material (migration, rollback, checker, migration test) that the hand-applied migration process requires. That leaves about 20 production files for a data table, three admin handlers, one public handler, an admin screen and a public page. The admin screen is split into five small components, which is a file-count cost, not a scope cost.

Some real scope **can be deferred without breaking any condition**. SA amends its own conditions for Slice 0 as follows:

| Cut | What is removed from Slice 0 | Where it goes | Condition effect |
|---|---|---|---|
| **Language default from the inviter's saved preference** | Files 20 and 22 (`UserPreferencesRepository` and its test), their exports in file 51, and the default logic in `buildInviteFormOptions`. The form still has a language picker (`en`/`he`/`es`, pre-selected `en`), and the chosen value is still validated and persisted. | **Slice 2**, where the language first drives an email. | **C-8 amended:** for Slice 0, the default is `en`. The rest of C-8 stands (validated, persisted, the page reads only the invite column, no `LanguageContext`). BQ-4's "defaults to the inviter's language" is sequenced, not changed. |
| **List filters and email search** | The `state`, `inviteType` and `q` query parameters, their Zod schema, the filter branches in `listForAdmin` and their tests, and the filter controls in `InviteList.tsx`. The list shows the newest 200 invites with their derived state. | **Slice 1**, when the list gains accepted-account details and grows beyond a handful of rows. | No condition requires them. §11 QA step 10 is dropped. |
| **Callers guard test** | File 23. | The slice that adds the first account-issued (`issuerAccountId`-scoped) methods (§14). | **C-13** is met by method naming plus the in-code service-role comments. A guard with only one kind of caller proves little until a second kind exists. |

That takes Slice 0 from 53 files to **about 49**, and more importantly removes one repository, one query surface and a set of filter tests. **Nothing else should be cut.** The migration test, checker, runbook and rollback protect a migration the user applies to production by hand. The public-route tests are the only proof of AC-2 and the token-leak rules. The purge registration and the admin page are the demo.

Optional, no condition: merge `EnforcementNote.tsx` into `page.tsx`, and `RevokeDialog.tsx` into `InviteList.tsx`, if that reads more simply. It is Dev's call.

#### Required changes before implementing (R-1 to R-7)

| # | Change |
|---|---|
| **R-1** | **Audit flush (F-3).** Change D-9, the §2.3 create and revoke flows, and the C-5 traceability row to "non-blocking `log(…).catch`, then `await flush().catch` before the response". The route tests assert that `flush` is called and that a rejected `flush` still returns 201 or 200. |
| **R-2** | **Apply the three scope cuts** above to §1, §2, §3 (file list and totals), §7.1 (no query parameters; `formOptions.defaultLanguage` is `en`), §8, §9 (C-8 and C-13 rows), §10 and §11. Record the C-8 amendment in §9 as "SA-amended for Slice 0, 2026-09-28". |
| **R-3** | **Track the F-1 gap.** Reword §13's follow-up line to "invite and lineage email anonymisation on erasure: folded into requirement L-12, designed in the Slice 1 workplan". |
| **R-4** | **F-10 wording.** Use: "You can't create your account from this page yet. {inviterDisplayName} will let you know when you can." In `he` and `es` in `invitePageCopy.ts`. Add an operator note to §11 and §6: until Slice 1 ships, links are for internal demos only and must not be handed to real invitees, since they would expire before signup exists. |
| **R-5** | **Checker without `%`.** Replace `LIKE 'business_os_invites_%'` in §5 with an `IN (…)` list of the 16 constraint names, and have the migration test extract and compare that list. It removes the one known editor risk up front instead of holding a fallback. |
| **R-6** | **Public route declarations.** State in §2.3 and the C-4 row that `app/api/public/invites/validate/route.ts` exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'` (required by C-4 and by `node:crypto`), and add a test assertion for both. |
| **R-7** | **Create response shape.** The `invite` object in the 201 response is built by the same list-view mapper as GET, so it can never carry `token_hash`, `issuer_admin_id`, `internal_reason` or `redeemed_account_id`. Add that assertion to the POST happy-path test. |

#### Code review focus (for SA's next pass)

- The token never reaches a logger, audit entry, error or column other than as a hash (grep of the diff plus the tests).
- `requireAdmin` is the first statement of each admin handler, and the authz guard's `CAPS` are unchanged.
- The migration text matches §4 exactly after R-5, and the checker's `IN` list matches it.
- `tierLiteral.forbidden.test.ts` `BASELINE` is unchanged.
- No `LanguageContext` and no `supabaseServer` import outside the repository.

**Workplan approved: proceed to implementation once R-1 to R-7 are applied.**

### SA Code Review — 2026-09-28

**Code Review by SA — 2026-09-28**
**Status:** 🔄 Fix Required. Three must-fix items (M-1 to M-3), no blocker. Once Dev fixes M-1 to M-3, SA re-checks only those three and the build, then hands to QA. The nits are Dev's call, except N-1, which needs one line of documentation either way.

**Scope reviewed.** The uncommitted diff in `neuronforge-invite-s0` on `feature/bos-invite-signup-slice-0` (base `origin/main` 64a4062d): 16 modified files and every new file under `app/invite/`, `app/admin/business-os-invites/`, `app/api/admin/business-os/invites/`, `app/api/public/invites/`, `lib/business-os/invites/`, the repository and its test, the config and its invariant test, the migration, the rollback, the checker and the migration test.

#### Verification run by SA

| Check | Result |
|---|---|
| The 16 new suites, plus the entitlements, audit, purge, admin-sidebar and `adminReadMethods.guard` neighbours (52 suites) | 1,249 pass, 1 fail. The failure is the pre-existing `customerPlanView.test.ts` (see below). |
| `npm run test:authz-guard` | 119/119 green. `CAPS` untouched. |
| `tierLiteral.forbidden.test.ts` | Green, and the test file (with its `BASELINE`) is not in the diff. |
| `grep` of the new code for `console.`, `supabaseServer`, `LanguageContext`, `useLanguage` and `dangerouslySetInnerHTML` | `supabaseServer` appears only in the repository. The others appear only inside comments that say they are not used. |
| `npx next build` | See "Build result" below. |

**The `customerPlanView.test.ts` failure is pre-existing, confirmed.** "A Founding Partner … really does get everything" expects 29 and gets 28. Every tracked source under `lib/business-os/entitlements/` is byte-identical to `origin/main` (`git diff --quiet origin/main` on `config/` and `*.ts`). The only entitlements files this slice touches are `config/invites.ts` (new, and imported by no module in the entitlements folder) and two test files the failing suite does not import. This slice cannot move that count. It belongs to the 2026-09-27 Founding Partner parity change and should be tracked separately. It does not gate this slice.

**Build result.** With no env vars, `npx next build` (8 GB heap) **compiled successfully**, meaning no `server-only` or client-bundle break from `/invite`, the admin page or the middleware. It then failed in "Collecting page data" on `/api/admin/execution-tiers` with `Missing Supabase environment variables`. That is environmental and pre-existing: the worktree has no `.env`, and the failing route is untouched. Re-run with the CI build job's placeholder env (`.github/workflows/build.yml`): **✅ exit 0.** All 307 pages were generated, and `/invite` (static shell, 4.61 kB), `/admin/business-os-invites`, both admin invite routes and `/api/public/invites/validate` are all in the route table. The `requireAdminPage` "Dynamic server usage … used `cookies`" lines for `/admin/business-os-invites` are the same build-time noise every guarded admin page prints, not a failure.

#### Conditions and required changes

| Item | Verdict | Evidence |
|---|---|---|
| C-1 | ✅ (see M-2) | One table, every listed column, `email_locked DEFAULT true`, UNIQUE `token_hash`, email index, no FK, no delivery/OTP columns. |
| C-2 | ✅ | RLS on, no policy, `REVOKE ALL` from the four roles one statement each, then one `GRANT SELECT, INSERT, UPDATE … TO service_role`. No enumerated REVOKE and no function. The checker reads `aclexplode` over `COALESCE(relacl, acldefault(…))`, so `MAINTAIN`/`TRUNCATE`/`REFERENCES`/`TRIGGER` fail I04/I05. It follows the entitlements checker's `default_transaction_read_only` precedent. |
| C-3 | ⚠️ M-1 | Generation, hash, format-before-hash, the fragment link, `no-store` on the 201, and audit/route logs are all clean. **But** a database error on the invite row can write the hash and the email into Pino (M-1). |
| C-4 | ✅ | Middleware branch after the subdomain rewrite. Layout meta `no-referrer` + noindex. The route is `nodejs` + `force-dynamic` and sends both headers on every response. AC-2 is byte-compared in the route test. Explicit per-state allow-list. `markFirstViewed` is conditional. No in-memory limiter. See N-1. |
| C-5 | ✅ | `requireAdmin` is the first statement of all three handlers. `.strict()` bodies, reason ≥ 3, repository only, two new `AUDIT_EVENTS`, `correlationId` in details. Revoke is a conditional UPDATE, with 404/409 told apart by a follow-up read. The page adds no guard of its own. |
| C-6 | ✅ | `refusalFor` runs before any read or write. The 409 is tested with no repository call. |
| C-7 | ✅ | Enums come from `COHORT_IDS`/`TIER_ORDER`/`INVITE_LINK_EXPIRY`, never `COHORT_VALUES`. The Paid default is `TIER_ORDER[0]`. RC-4 `access` is a required key. |
| C-8 (amended) | ✅ | `defaultLanguage: defaultLocale` (`'en'`), `z.enum(locales)`, persisted on the row, and the page renders from the response `language`. No `LanguageContext`. |
| C-9 | ✅ | `profiles.full_name` via `UserProfileRepository.findById`, trimmed and capped, falling back to `AgentPilot`. The public select has no issuer column. See N-4. |
| C-10 | ✅ | `never('business_os_invites', G, …)`, the baseline 128→129, and a new invariant that no Reset/Purge combination includes it. Not in `USER_OWNED_TABLES` (F-1). |
| C-11 | ✅ | `deriveInviteState` is pure, is the only comparison of `link_expires_at`, and fails closed on an unparseable date. |
| C-12 | ✅ | Every route case listed in §10 is present. The migration test extracts the checker's `IN` list from both files. |
| C-13 (amended) | ✅ | Repository header plus per-method notes, the `ForAdmin` / `ForPublicView` naming, and the FUTURE note on `issuerAccountId`-scoped methods. |
| R-1 | ✅ | `await auditTrail.log(…).catch(…)`, then `await auditTrail.flush().catch(…)`, in create and revoke. |
| R-2 | ✅ | No `user_preferences` repository, no list query parameters or filter controls, no callers guard. |
| R-3, R-4, R-5, R-6, R-7 | ✅ | §13 wording. R-4 line in `en`/`he`/`es`. The checker `IN` list. `runtime`/`dynamic` exported and tested. `toInviteListView` shared by GET, create and revoke. |

**Tenant isolation (`tenant-isolation-guard` skill).** Passes. The table holds no tenant data (no `user_id`), so "any invite" is reached only by platform admins behind `requireAdmin`, which is the skill's Step 5 global-catalog case. The insert is an explicit allow-list: `issuer_kind` is fixed to `admin` and `issuer_admin_id` comes from the gate, never the body. The public path reaches one row by hash, and `markFirstViewed` targets the id read from that row, never a caller-supplied id. There is no trigger, no upsert and no spread.

#### Code Review Comments

1. **M-1 — `lib/repositories/BusinessOsInviteRepository.ts:108` (also `:128`, `:146`, `:180`, `:206`, `:228`) — the token hash and invited email can reach the logs.** Priority: High (must-fix). Each catch logs `{ err: error }`. In the installed `@supabase/postgrest-js` (2.75.1), `PostgrestError` extends `Error` with an own `details` field, and `pino.stdSerializers.err` emits own enumerable fields. A CHECK violation (23514) carries `details: "Failing row contains (<id>, <token_hash>, <email>, …)"`, and a unique violation (23505) carries `Key (token_hash)=(…)`. Either one puts the hash and the email into an error-level line, and `lib/logger/config.ts` redacts neither `details` nor `token_hash`. C-3 says the hash never reaches a log. The trigger is rare, since Zod mirrors most CHECKs, but when it fires it fires on exactly this table. **Fix:** log a projection of the database error, `{ code, message }`, which names the constraint but carries no row values. `hint` and `details` are never logged, and the same projection is what `toError` hands back. Add one repository test that feeds a `PostgrestError` with a `details` string containing a fake hash and email, then asserts that neither appears in any logger call or in the returned error.
2. **M-2 — `supabase/migrations/20261012_business_os_invites.sql:45` and `:61` — two CHECKs pass on NULL.** Priority: Medium (must-fix, because this migration is applied to production by hand, and tightening it later costs a second migration plus a data check). In SQL, `TRUE AND NULL` is NULL and a CHECK passes on NULL. So `access_shape` accepts `grant_kind = 'cohort', access_open_ended = false, access_months = NULL`, which is a champion invite with no decided access, exactly what RC-4 and D-1 say the database refuses. `revocation_complete` accepts `revoked_at` set with `revoke_reason` NULL. **Fix:** `… AND access_open_ended IS FALSE AND access_months IS NOT NULL AND access_months > 0` and `… (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL AND char_length(btrim(revoke_reason)) >= 3)`. Keep the names, so the checker's `IN` list is unchanged. Add a migration-text assertion that both CHECKs contain their `IS NOT NULL` term. While there, decide whether a revoke must name its admin (`revoked_by_admin_id IS NOT NULL`). Leaving it nullable is fine for the future account-issued revoke, but say so in §4 (see N-3).
3. **M-3 — `lib/business-os/invites/inviteOffer.ts:33` with `enforcementPoints.test.ts` (the `inviteOffer.ts` entry) — D-dev-2 is partly rejected: `resolveEntitlements` may not be allow-listed outside the module.** Priority: Medium (must-fix). The allow-list's design (QA R3-1, in the test's own header) is that "every symbol here is one nobody can gate with". Every existing entry imports only view builders, config readers or mode readers. **No file outside `lib/business-os/entitlements/` has ever imported the resolver.** `adminPlansView`, `customerPlanView` and `report` all call it from inside the module. `resolveEntitlements` is the very symbol QA's mutation used to walk a gate past a denylist, so exempting it here reopens that hole for this file. **Fix:** move the resolution into the module as one read-only view function, for example `describePlanOffer(config, planId, now)` in `planPresentation.ts`, or a new `lib/business-os/entitlements/planOfferView.ts`. It runs `previewAccountFor` → `resolveEntitlements` → `describePlanCapabilities` → the `isHiddenFromCustomer` filter → `groupByCategory`, and returns `{ planName, free, monthlyPriceUsd, included }`. `inviteOffer.ts` then imports that one symbol (plus the config and type symbols it still needs), and its allow-list entry names no resolver. Add the new function's unit test inside `entitlements/__tests__`. The invite offer test keeps working unchanged.

#### Rulings on Dev's deviations

| # | Ruling |
|---|---|
| **D-dev-1** | **Accepted.** `listRecentForAdmin` keeps `adminReadMethods.guard` unchanged instead of widening it, and still ends in `ForAdmin` (C-13). |
| **D-dev-2** | **Accepted for six of the seven entries; rejected for `resolveEntitlements` in `inviteOffer.ts` (M-3).** The three route entries and `adminInviteOps` / `inviteSchemas` / `publicInviteView` import config constants, labels, types and the mode reader, none of which can refuse a capability. Their `why` texts are accurate, and the exact-symbol pinning keeps the guard's property. After M-3, the `inviteOffer.ts` entry shrinks to the new view function, `INVITE_TYPES`, `INVITE_TYPE_IDS`, `EntitlementConfig` and whatever label or price helpers remain, with no resolver. |
| **D-dev-3** | **Accepted, and required.** `PlatformChrome.tsx`'s header says a public route must be registered in both places. `'/invite'` (no trailing slash) matches `/invite` exactly and `/invite/…`, but not `/invites` or `/invite-x`, which is the right semantics. |
| **D-dev-4** | **Accepted.** `access: { kind: 'open_ended' \| 'months' \| 'while_paid', months }` is closed-vocabulary data with no id, email or hash. It lets the page say it in the invite's language, and F-4 still covers the English plan and capability names. The admin list keeps its English `accessSummary` (the admin screen is English). |
| **D-dev-5** | **Accepted.** Awaiting `log()` (with `.catch`) and then `flush()` is exactly what `entitlements/accounts/[accountId]/route.ts:232-254`, `entitlements/launch/route.ts:147-166` and `archiving/runs/route.ts:94` do, and `log()` catches its own queue failures. Note for TL, not Dev: the `new-api-route` skill checklist still says "never `await` it in the success path". That now contradicts the WC-7 precedent and R-1, so the skill should be updated to say "non-blocking (`.catch`); admin routes that must survive a frozen instance await `log` then `flush`". |
| **D-dev-6** | **Accepted.** `grant_not_available` and `invite_type_not_allowed` apply GR-1 and GR-3 at issuance, are unreachable with today's config, and are 409s with no write. |
| **D-dev-7** | **Superseded:** SA ran the build (above). |
| **Four extra audit files** | **Accepted.** `lib/audit/types.ts` (the closed `entityType` union), `eventAudience.ts` + its pinned-split test (an untagged event fails the suite) and `filterOptions.ts` (otherwise the group is labelled "Bos") are each the minimum the existing guards demand. |

#### Token hygiene and oracle check (C-3, C-4, AC-2)

- **Raw token:** it exists in `createInviteForAdmin`'s local, the `link` string and the 201 body only (`no-store`). The public route passes it to `viewInviteByToken`, which hashes it after the format check. No logger call, audit entry, error string or column carries it. The page strips the fragment with `history.replaceState` before the `fetch`, sends it in a JSON body with `referrerPolicy: 'no-referrer'`, and keeps it only in a ref.
- **Hash:** it is never selected (`BUSINESS_OS_INVITE_ADMIN_COLUMNS` and `…_PUBLIC_COLUMNS` both omit it), and never in audit details or route logs. The one leak path is M-1.
- **Oracle:** malformed, unknown and one-off tokens all return the frozen `NOT_RECOGNISED` with identical status, body and headers (byte-compared in the route test). Unknown and real tokens both take exactly one indexed lookup. A malformed token skips the database, which is a timing difference that reveals only the public token format (D-6, accepted). The extra work on a match (`markFirstViewed`, the offer) is visible only to someone who already holds a real link. A lookup error is 503, not "not recognised", which is correct: it does not tell a guesser anything a real holder would not also see.

#### Optimisation Suggestions (nits, Dev's call)

- **N-1 — `lib/business-os/invites/inviteSchemas.ts:118`.** `token: z.string().max(512)` turns a token longer than 512 characters into a 400 `invalid_request`, while a 44-character token gets 200 `not_recognised`. That reveals nothing about any real token, so it is not an oracle. It is still a second answer for "a malformed token", which AC-2's wording forbids. Either drop `.max(512)` and let `INVITE_TOKEN_PATTERN` reject it (the body size is already bounded by the platform), or add one sentence under F-2 saying an overlong token is a body-shape error.
- **N-2 — `scripts/check-bos-invites-migration.sql`.** C-1 names the email index, but no check asserts it. Consider an I11 that `business_os_invites_email_idx` exists (by `pg_indexes`, no `%`).
- **N-3 — `supabase/migrations/20261012_business_os_invites.sql:61`.** Whether `revoked_by_admin_id` is required on a revoke: record the decision (see M-2).
- **N-4 — `lib/business-os/invites/adminInviteOps.ts:218`.** `.slice(0, INVITER_NAME_MAX)` counts UTF-16 code units, so it can split a surrogate pair at character 200 and store a lone surrogate. Use `Array.from(name).slice(0, INVITER_NAME_MAX).join('')`.
- **Recorded, not for this slice:** the per-IP limit for `/api/public/invites/validate` stays a Vercel Firewall follow-up (C-4). It should be in place before Slice 1 hands links to real invitees.

### Code Approved for QA: No. Fix M-1, M-2 and M-3, then SA re-checks those three plus the build and approves without a full re-review.

### SA Re-check — 2026-09-28

**Status:** ✅ Code Approved for QA. SA re-ran everything below itself rather than relying on Dev's report.

| Item | Result |
|---|---|
| M-1 | ✅ All six repository catches log `{ dbError: safeDbError(error) }`, which is `{ code, message }` only. `toError` builds a fresh `Error` from that projection, so `details` and `hint` never leave the file. PostgREST's `message` for 23514 and 23505 names the constraint and carries no row value. The leak test feeds a CHECK violation and a unique violation with a fake hash and email through all six methods, and asserts neither appears in the logs or in the returned error. |
| M-2 | ✅ `access_shape` now has `access_months IS NOT NULL`, and `revocation_complete` has `revoke_reason IS NOT NULL`. Names are unchanged and the migration-text test pins both. |
| M-3 | ✅ `lib/business-os/entitlements/planOfferView.ts` is read-only and pure: no I/O, no account or user id, takes a config plan id, and returns labels, a price and grouped summaries, never a decision. It exports only `describePlanOffer` and two types, and its only caller outside the module is `inviteOffer.ts`. This does not widen what the module exposes to gates: it answers "what does plan X include" for a named plan, the same question `adminPlansView` and `customerPlanView` already answer, and it cannot resolve a real account. `inviteOffer.ts` no longer imports the resolver, and its allow-list entry is `EntitlementConfig, INVITE_TYPES, INVITE_TYPE_IDS, describePlanOffer, type PlanOfferCategory`. |
| N-1 | ✅ Documented under F-2: `.max(512)` is a body-size guard, so an overlong token counts as a malformed body. |
| N-2 | ✅ Checker I11 (`pg_indexes`, no `%` and no `--`), pinned by the migration test. |
| N-3 | ✅ Recorded in §4 and pinned by the migration test: the code sets `revoked_by_admin_id`, but the database does not require it. |
| N-4 | ✅ The inviter name is capped by code point (`Array.from`). |
| Tests | 53 suites, 1,275 pass. The 1 failure is the pre-existing `customerPlanView.test.ts`, unchanged. `npm run test:authz-guard` 119/119, `enforcementPoints`, `tierLiteral.forbidden`, `accountSeam.guard` and `adminReadMethods.guard` all green. |
| Build | `next build` with the CI placeholder env: exit 0. `/invite` and `/api/public/invites/validate` are in the route table. |

**Code Approved for QA: Yes.**

---

## QA Testing Report

### QA Report — 2026-09-28

**QA — 2026-09-28**
**Test mode:** full
**Strategy used:** A (unit) + B (integration against mocked Supabase and gate) + static SQL review + mutation testing. No database was touched: the migration is not applied anywhere, and no route was called against live Supabase.
**Focus:** all (api, ui, schema, security)
**Skipped:** the live manual demo (§11), because it needs the migration applied. It is written up below as the owed checklist. E2E is not set up in this repo (CLAUDE.md).
**Input source:** TL prompt (QA Slice 0, SA-approved, uncommitted worktree)

**Safety.** Before any test, every modified and untracked file (60) was copied to the session scratchpad with the `git diff --stat` and `git status --porcelain` output. Each mutant edited one file, was restored from that copy at once, and was proven byte-identical with `cmp`. QA's own probes ran from the scratchpad through a Jest config pointed at the worktree, so no file was added to the tree. No `git checkout`, `stash`, `reset`, `clean` or `restore` was run, and nothing was committed.

#### Tests run

| Run | Result |
|---|---|
| The slice's suites plus neighbours: the 6 invite lib suites, `inviteConfig.invariant`, `planOfferView`, `BusinessOsInviteRepository`, both admin route suites, the validate route, both page render suites, the admin source guard, `middleware.invite`, the migration text test, `enforcementPoints`, `tierLiteral.forbidden`, `accountSeam.guard`, `adminReadMethods.guard`, the three purge suites, `businessOwnedTables`, `AdminSidebar.nav`, `eventAudience`, `filterOptions` | **28 suites, 544 tests, all pass** |
| `npm run test:authz-guard` | **119 / 119 pass**, `CAPS` untouched |
| `npm run test:bos-entitlements` | 76 suites, **1,519 pass, 1 fail**: the pre-existing `customerPlanView.test.ts` ("a Founding Partner … really does get everything", 28 vs 29). It is the only failure, and it is not caused by this slice (SA confirmed that the entitlements sources are byte-identical to `origin/main`). |
| QA probes (scratchpad, not added to the tree): `validate.probe.ts` (13), `admin.probe.ts` (7), `page.probe.tsx` (10) | **30 / 30 pass** (details under "Adversarial review") |

#### Test coverage against "done means" and the conditions

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-1: create, list and revoke; a non-admin gets 401/403 on every invite admin route; authz guard green | ✅ | Pass | Probe A3 checks 401 (signed out) and 403 (not admin) on GET, POST create and POST revoke, with zero inserts. The guard passes 119/119. See QA-1 and QA-2 for the gate-order test gaps. |
| AC-2: the link is shown once; the database holds only the hash; unknown, malformed and one-off tokens get an identical answer | ✅ | Pass | Probe P1 byte-compares status, body and **every** response header across 17 bad-token variants: `abc`, empty, a space, one character changed, a fresh unknown token, `=` padding, leading or trailing space, a trailing newline, case flipped, 42 characters, 44 characters, 43 non-ASCII characters, 512 characters, the hash itself, a path and `<script>`. All are identical. Probe A1: the stored `token_hash` is the SHA-256 of the link's token, and GET never re-shows the token or the hash. |
| AC-3: expiry options 15/30/60 with 30 as default; expiry derived; a setting change leaves existing invites unchanged | ✅ | Pass | Probe P3 with the injected clock: 1 ms before `link_expires_at` gives valid, the exact instant gives expired, and 1 ms after gives expired. Mutant M6 (`>=` to `>`) is killed. The form options and AC-3 are covered by the Dev suites. |
| Revoking twice gives 409 | ✅ | Pass | Probe A1, create then revoke then revoke through **one stateful fake table** across both routes: 201, then 200 (Revoked), then 409 `invite_not_revocable`. An unknown id gives 404. Mutant M7 is killed. |
| C-6: a paid invite is refused by the server | ✅ | Pass | Probe A2: every `TIER_ORDER` entry (`basic`, `pro`) returns 409 `paid_invites_not_available` with zero inserts. A paid body carrying `access`, and a champion body carrying `grantId`, are both 400. Mutant M2 is killed. |
| C-3 / T-7: the token is never logged or audited, and appears once with `no-store` | ✅ | Pass | Probe A1: the 201 has `Cache-Control: no-store`, the token matches the 43-character pattern, and the serialised audit entries plus every logger call hold neither the token, the hash nor the invited email. Probe P4: across valid, unknown, malformed, a returned lookup error and a **thrown** lookup, no log line holds the token, its first 20 characters, the one-off variant or the hash. `AuditTrailService.extractRequestContext` reads only IP, user agent and session headers, never the body. |
| C-4: public allow-list; no id, email or hash in any response; `no-store` and `no-referrer` | ✅ | Pass | Probe P2 scans the valid, revoked, used, expired and unavailable responses: no invite id, no UUID pattern, no `@`, no hash, no token, and both headers present. Revoked plus past expiry reports revoked (precedence). The 400 bodies are identical for non-JSON, `{}`, an extra key and a non-string token. The 503 bodies are identical for a returned and a thrown lookup failure. |
| M-1 log scrub | ✅ | Pass | Mutants M4a and M4b are killed. |
| C-8 / FR-9: en, he and es copy; RTL for Hebrew; renders in the invite's language | ✅ | Pass | Probe `page.probe.tsx`: expired, revoked, unavailable and used each render in `he` (`dir="rtl"`, `lang="he"`) and `es` with the right heading and inviter line. No he or es string (static or templated) equals its English counterpart. A bare `/invite` shows not-recognised **without calling the API**. The Dev suite covers the valid state in all three languages, `navigator.language` ignored, and the note rendered as text. Probe P6: a stored `fr` falls back to `en`. |
| C-1 / C-2 migration, rollback, checker | ✅ | Pass | Static review, below |
| Admin page render (FR-1, FR-3, FR-5, FR-6) | ✅ | Pass (Jest) | The Dev render suite covers the list, expiry 15/30/60 with 30 selected, Paid disabled with the server's reason, access required, link shown once with copy, gone after reload, and revoke with a 3-character reason. No dev server was started (production data). |
| The §10 Slice 0 demo | ⚠️ | Owed | Needs the migration applied. See the checklist below. |

#### Static checks: migration, rollback, checker

| Check | Migration | Rollback | Checker |
|---|---|---|---|
| No `--` comments, no `/*` | ✅ 0 / 0 | ✅ | ✅ |
| Every string literal only `[A-Za-z0-9_ ]` | ✅ | ✅ (none) | ✅ |
| No `%`, no `;` inside strings, no non-ASCII bytes, no CRLF | ✅ | ✅ | ✅ |
| `REVOKE ALL` from PUBLIC, anon, authenticated and service_role (4 separate statements), then one `GRANT SELECT, INSERT, UPDATE … TO service_role`; no enumerated REVOKE | ✅ lines 73–81 | — | I04/I05 assert it through `aclexplode` over `COALESCE(relacl, acldefault(…))` |
| RLS enabled; no policy; no function; no trigger; no FK | ✅ | — | I02, I03, I08, I10 |
| NULL-safe CHECKs | ✅ All 16 read: every NOT NULL column's CHECK cannot go NULL; `access_shape` uses only `IS TRUE`/`IS FALSE`/`IS [NOT] NULL` with `access_months IS NOT NULL AND > 0`; `revocation_complete` has `revoke_reason IS NOT NULL`; `redemption_complete` compares two booleans that are never NULL; `not_revoked_and_redeemed` is an OR of two `IS NULL`s. | — | I07 lists all 16 names |
| Matches §4 of this workplan | ✅ `diff` identical | ✅ matches §4 | ✅ |

#### Mutation testing (one file at a time, each restored and `cmp`-verified)

| # | Guarantee | Mutant | Result |
|---|---|---|---|
| M1 | Token hash compare | `publicInviteView.ts`: look up by the raw token instead of `hashInviteToken(rawToken)` | ✅ Killed (15 failures) |
| M2 | Paid refusal | `adminInviteOps.ts` `refusalFor`: the tier/`paidInvitesAvailable` branch short-circuited to false | ✅ Killed (4) |
| M3a | `requireAdmin` first | Create route: `await request.clone().json()` above the gate | ❌ **Survived** (route test and authz guard): QA-2 |
| M3b | `requireAdmin` first | Create route, then the revoke route: plain `await request.json()` above the gate | ✅ Killed (6 and 9) |
| M3c | `requireAdmin` first | GET route: `await businessOsInviteRepository.listRecentForAdmin()` above the gate | ❌ **Survived** (route test and authz guard): QA-1 |
| M4a | M-1 log scrub | `safeDbError` also returns `details` | ✅ Killed (13) |
| M4b | M-1 log scrub | `markFirstViewed` catch logs `{ err: error }` again | ✅ Killed (2) |
| M5 | Identical bad-token answer | The malformed path returns `{ state: 'not_recognised', malformed: true }` | ✅ Killed (5) |
| M6 | Expiry boundary | `deriveInviteState`: `>=` to `>` | ✅ Killed (2) |
| M7 | Revoking twice gives 409 | The revoke UPDATE without `.is('revoked_at', null)` | ✅ Killed (1) |

8 of 10 mutants are killed. The two survivors are both "gate first" variants that no test targets. The code under test is correct today: `requireAdmin` is the first statement of all three handlers (`route.ts:54`, `route.ts:95`, `revoke/route.ts:34`).

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. Malformed tokens skip the database, and unknown and real tokens take one indexed lookup (D-6, accepted by SA).

#### Edge Cases and test gaps (nice to fix)

1. **QA-1 — the GET gate tests do not prove that nothing runs before the gate.** Test gap, Low. `app/api/admin/business-os/invites/__tests__/route.test.ts:191` and `:199` assert only the status for GET. A repository read placed above `requireAdmin` in GET (mutant M3c) passes every test, and the repo-wide authz guard does not check order either (its header, `admin-authz-surface.guard.test.ts:104`, says so: the known OI-20). The revoke tests already do this right (`revoke.route.test.ts:139`, `state.revokes` stays empty). **Fix:** count `listRecentForAdmin` calls in the GET mock and assert 0 on 401 and 403.
2. **QA-2 — "the body is never read before the gate" spies only `request.json`.** Test gap, Low. `route.test.ts:217`. A read through `request.clone().json()` or `request.text()` above the gate survives (M3a). This is unlikely to be written by accident, so Low. **Fix (optional):** also spy `text`, `clone` and `arrayBuffer`, or assert a call-order event (`gate` before `body`), as the revoke suite does with `state.events`.
3. **QA-3 — the reason length is counted differently by Zod and by SQL.** Edge case, Low. `lib/business-os/invites/inviteSchemas.ts:54` (`reasonSchema = z.string().trim().min(3)`) counts UTF-16 code units, while the CHECKs at `supabase/migrations/20261012_business_os_invites.sql:55` (`reason_length`) and `:61` (`revocation_complete`) count characters with `char_length`. Probe A4 confirms that Zod accepts a two-emoji reason (4 code units, 2 characters) for both create and revoke. In production the database refuses it, so the admin sees a 500 (`could_not_create_invite` or `could_not_revoke_invite`) instead of a 400. There is no integrity risk, because the CHECK holds; the only cost is a confusing error. The client dialog (`RevokeDialog.tsx:36`) has the same `.length` count. **Fix:** `.refine((s) => Array.from(s).length >= REASON_MIN)`, the same code-point rule SA's N-4 applied to the inviter name. The other length limits (note, name, email) err in the safe direction.
4. **QA-4 — the checker's read-only guard is session-level.** Info, no action. `scripts/check-bos-invites-migration.sql:1`. `SET default_transaction_read_only = on` applies to transactions that start **after** it, so the `WITH … SELECT` pasted in the same batch is not itself forced read-only. The script contains only `SELECT`s, so nothing can be written either way. It follows the approved entitlements-checker precedent. Mentioned only so nobody relies on it as a guard for a future checker that mixes statements.

**Recorded, not new:** the per-IP limit on `/api/public/invites/validate` (a Vercel Firewall rule) is still an ops follow-up. It should be in place before Slice 1 hands links to real invitees (C-4, SA).

### Owed after the migration is applied (manual demo, for the user)

Preconditions: `20261012_business_os_invites.sql` is applied by hand (§6 step 2), `scripts/check-bos-invites-migration.sql` reads **VERDICT PASS, 11 pass, 0 fail** (§6 step 3), the branch runs on a preview or locally, and you are signed in as a platform admin (in `admin_users`). Links are for internal demos only until Slice 1 (R-4).

| # | Do | Expect | Pass? |
|---|---|---|---|
| 1 | §6 step 1 pre-check first: it returns `0` before applying and `1` after. | `0`, then `1` | ⬜ |
| 2 | `/admin`, then **Businesses**, then **Invites**. | The page loads (empty list or rows), with the "recorded, not enforced" note. | ⬜ |
| 3 | **New invite**. | Type: Champion enabled, Paid disabled with "available when payments are live". Expiry offers exactly 15, 30 and 60 with **30** selected. Language is English. | ⬜ |
| 4 | Create: `x@example.com`, Champion, **No end date**, 30 days, note "Welcome aboard, would love your feedback", reason "QA slice 0 demo". | A panel shows `…/invite#t=<43 characters>` with **Copy** and "shown once". The row reads **Pending**, expiring 30 days out. | ⬜ |
| 5 | **Copy**, open a **private window**, paste. | The address bar settles on `/invite` with no `#t=`. **Valid** state: "<your name> invited you", the note, **Founding Partner**, Free, No end date, what is included, the expiry date, and the "You can't create your account from this page yet" line. No signup form. | ⬜ |
| 6 | In the private window, open DevTools, **Network**, and reload the pasted link. | The validate call is a **POST** with the token in the body only. The response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and contains no email and no id. The `/invite` document response also carries `Referrer-Policy: no-referrer`. | ⬜ |
| 7 | Change one token character in the URL and load it, then load `/invite#t=abc`. | Both show "We don't recognise this invitation", and the two response bodies are identical. | ⬜ |
| 8 | Reload the admin Invites page. | The link panel is gone for good, and the row is still **Pending**. | ⬜ |
| 9 | **Revoke** the row with the reason "QA revoke test". | The row reads **Revoked**, with the reason and time. | ⬜ |
| 10 | Private window: load the original link again. | "This invitation was withdrawn", naming you. No note and no plan. | ⬜ |
| 11 | Revoke the same row again (a second tab or the API). | 409 "cannot be revoked" | ⬜ |
| 12 | (Hebrew) Create a second invite with language **he** and open its link. | The page is right to left, and the chrome is in Hebrew. Plan and capability names are in English (F-4). | ⬜ |
| 13 | **Leak check.** Search the Vercel logs (or the `npm run dev:pretty` output) for the first 10 characters of each token, and read the `audit_trail` rows for the invite ids (`BOS_INVITE_CREATED`, `BOS_INVITE_REVOKED`). | No log match. The audit details hold neither the token, its hash nor the invited email. | ⬜ |
| 14 | (Optional, expiry) §11 step 13 on a **test** row only. | The page and the list both show **Expired**, with no job run. | ⬜ |
| 15 | Clean-up: revoke any demo invite still pending. | Nothing live remains that a real person could open. | ⬜ |

### Final Status

- [x] All automated acceptance checks pass: no High or Medium issue, three Low items (QA-1 and QA-2 are test gaps, QA-3 is an edge case) and one Info item
- [ ] Manual demo: owed after the migration is applied (checklist above)

**Verdict: PASS WITH NOTES.** The slice may go to TL and the user for approval. QA-1 to QA-3 are optional hardening that Dev can take now or in Slice 1. None of them blocks the commit.

**Tree integrity:** after testing, `git diff --stat` and the untracked-file list match QA's starting snapshot, and every file except this workplan is byte-identical to the backup. This workplan changed only inside this section. No Change History row was added, so the diff stays inside the QA section.

---

## Commit Info

*[RM will populate this section]*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | Slice 0 workplan: 53 files (43 new, 10 modified), migration `20261012_business_os_invites.sql`, a read-only checker, traceability for C-1 to C-13 and T-1/5/7/12/14/15, a test plan, a QA demo script, rollback, and ten SA findings (F-1 to F-10). Verified against `origin/main` 64a4062d. |
| 2026-09-28 | SA workplan review: approved with conditions | SA ruled on F-1 to F-10: F-1 accepted, with the erasure gap folded into requirement L-12 and designed in Slice 1; F-2, F-4 to F-9 accepted; F-3 decided as log non-blocking then flush before responding; F-10 kept with new wording. Three scope cuts, with C-8 and C-13 amended for Slice 0: the inviter-language default (moved to Slice 2), list filters and search (moved to Slice 1), and the callers guard (moved to the first account-issued slice). Roughly 53 files become about 49. Required changes R-1 to R-7 must be applied before implementation. |
| 2026-09-28 | R-1 to R-7 applied; implemented (uncommitted) | Dev applied SA's R-1 (log then flush), R-2 (three scope cuts: no `user_preferences` repository, no list filters or search, no callers guard; C-8 and C-13 recorded as SA-amended), R-3 (F-1 follow-up wording), R-4 (F-10 line in three languages, operator note in §6 and §11), R-5 (checker `IN` list), R-6 (route declarations) and R-7 (one list-view mapper). Then implemented Slice 0 on `feature/bos-invite-signup-slice-0`: 40 files created, 16 modified. Seven deviations found at implementation are in §13 (D-dev-1 to D-dev-7); D-dev-2 and D-dev-4 need SA confirmation. Migration `20261012` re-checked free on `origin/main`; not applied to any database. |
| 2026-09-28 | SA code review: fix required | Three must-fix items: M-1 (the repository logs the raw `PostgrestError`, whose `details` can hold the token hash and email), M-2 (the `access_shape` and `revocation_complete` CHECKs pass on NULL), M-3 (`resolveEntitlements` must not be allow-listed outside the entitlements module; move the offer resolution into the module). D-dev-2 accepted except the resolver, and D-dev-1 and D-dev-3 to D-dev-6 accepted. `customerPlanView.test.ts` confirmed pre-existing. `next build` green with the CI placeholder env. |
| 2026-09-28 | SA code review fixes applied (uncommitted) | M-1 (DB errors reduced to `{ code, message }` before logging or returning, with a leak test), M-2 (two NULL-safe CHECKs, names unchanged), M-3 (`describePlanOffer` in the new `entitlements/planOfferView.ts`; no resolver import outside the module), N-1 to N-4. Checker gains I11 (email index). |
| 2026-09-28 | SA re-check: approved for QA | M-1 to M-3 and N-1 to N-4 verified by SA re-running the tests (53 suites, 1 pre-existing failure), the authz guard (119/119) and `next build` (exit 0). `planOfferView.ts` confirmed read-only, and it does not widen what the entitlements module exposes to gates. |
| 2026-09-28 | QA Low items QA-1 to QA-3 fixed (uncommitted) | GET gate tests assert no list read; the body-before-gate test covers every body reader; reason length counted in code points in the schema and both admin forms, with a two-emoji test. |
