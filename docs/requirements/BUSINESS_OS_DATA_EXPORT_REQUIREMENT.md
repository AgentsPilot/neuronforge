# Requirement: Business OS — Export My Data

> **Last Updated**: 2026-10-05

**Created by:** BA
**Date:** 2026-10-05
**Status:** Draft, **PARKED until the admin delete (AD-2, AD-3, AD-4) is finished** — the whole export scope, **including DE-0 (token exposure)**, runs LAST (user decisions 2026-10-05, DX-11 = no). Open business questions DX-1 to DX-10 and DX-12 are asked when the work resumes, then SA review (§9.2). **Re-baseline §1 against main first** (PR #218 merged 2026-10-05; see SQ-E10).

## Overview

A Business OS owner who presses "Export data" today gets a file built for the agent platform in November 2025: agents, runs, configurations, plugin connections and old Pilot-Credit transactions. It contains **none** of their Business OS data: no business profile, plan, credit usage, extra credits, contacts, notes, documents, services, bookings, payments, invoices, ledger, intake forms, website, images, onboarding or emails sent. Three of the export buttons also build the file **in the browser** with `select('*')` on `plugin_connections`. That puts the owner's live OAuth access and refresh tokens into a downloaded JSON file (measured live, §1.2).

This requirement covers four things:
- make the export complete for a Business OS owner, and safe;
- a CI-enforced rule that every new table is classified for export;
- the export offered **before** any delete (the customer delete in the purge requirement, and the admin delete in [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md));
- delivery in small numbered slices.

---

## Table of Contents

0. [Status and sequencing](#0-status-and-sequencing)
1. [Discovery: what exists today](#1-discovery-what-exists-today)
2. [GDPR roles: whose data is in the file](#2-gdpr-roles-whose-data-is-in-the-file)
3. [Proposed scope: what goes in, what never goes in](#3-proposed-scope-what-goes-in-what-never-goes-in)
4. [User stories](#4-user-stories)
5. [Delivery slices](#5-delivery-slices)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Acceptance criteria](#8-acceptance-criteria)
9. [Decisions and open questions](#9-decisions-and-open-questions)
10. [Out of scope / future roadmap](#10-out-of-scope--future-roadmap)
11. [Notes on integration points](#11-notes-on-integration-points)
12. [Appendix A: proposed skill rule text](#appendix-a-proposed-skill-rule-text)
13. [Change History](#change-history)

Evidence tags: ✅ read in code or docs, or measured live, on 2026-10-05 · 🧠 relayed by the coordinator or taken from project memory, not re-read · ❓ needs SA / Dev live verification (`npm run schema:check`).

> **Which checkout.** The `main` working copy here is behind. The repository refactor of the export route exists in worktree `vigilant-mccarthy-63566f` (branch `refactor/data-export-repositories`, SA code-approved 2026-10-04), and discovery below is read from that worktree. Whether that branch has merged is ❓. `docs/workplans/DATA_EXPORT_FOLLOWUPS_WORKPLAN.md`, named in the brief, **was not found in any local checkout** on 2026-10-05. Its two user decisions (our AI provider cost is excluded; Stripe ids are included) are taken from the brief 🧠.

---

## 0. Status and sequencing

| Item | State |
|---|---|
| **Export feature (DE-1 … DE-10)** | **Scheduled last, after admin delete AD-2, AD-3 and AD-4 are finished** (user decision, 2026-10-05). The requirement is written now so that SA can review it and the classification design (SQ-E1) can be settled alongside AD-1a's `SchemaReconciler` |
| **DE-0 — security (token exposure)** | **Separate from the feature.** The finding (§1.2) is independent of export: the browser can read and write the owner's own OAuth tokens, whether or not anyone presses Export. **User decision pending:** does DE-0 jump the queue? BA recommends yes (DX-11) |
| **Consequence of the order** | Admin delete AD-2…AD-4 will ship **before** the business data can be exported. Until DE-3/DE-4 ship, a deleted owner can take away only today's agent-platform export. See DX-12 |

### 0.1 SA ruling — DE-0 re-baseline and implementation conditions (2026-10-13)

**Reviewed by SA — 2026-10-13, against origin/main `9de8c60b`.** Status: ✅ **Approved for Dev with the conditions below** (no Dev workplan round needed for DE-0a; DE-0b needs the user's pre-check output first, condition B-1). Answers SQ-E2 and SQ-E3. Supersedes the DE-0a / DE-0b rows of §5 and AC-E1…AC-E6 where they differ.

#### 0.1.1 Re-baseline of §1.1 (server export) — what is true on origin/main

| §1.1 said | origin/main | Tier |
|---|---|---|
| plugin read = "5 explicit columns" | **13** explicit columns (`USER_DATA_EXPORT_COLUMNS`, `PluginConnectionRepository.ts` L21): `user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, created_at, updated_at, last_used, disconnected_at, profile_data`. Never `access_token`, `refresh_token`, `expires_at`, `last_refreshed_at`, `settings`, `credentials`, `id`. `profile_data` is read but only allow-listed string fields reach the body (`accountProfile`, route.ts L73) | ✅ |
| seven reads `select('*')` (FU-P1) | **Fixed.** All eight reads use named column constants in their repositories | ✅ |
| 500 body leaks `error.message` (FU-P2) | **Fixed.** `details` is `NODE_ENV === 'development'` only (L283) | ✅ |
| `exportData: any` | Still there (L127). Rule-6 debt, **not** DE-0 scope | ✅ |
| Repository refactor "❓ merged" | Merged | ✅ |

**So the server export is token-free and is the right target for the three buttons.**

#### 0.1.2 Inventory — every `plugin_connections` access that is NOT the service role

Grep of `from('plugin_connections')` / `from("plugin_connections")` across `app/`, `components/`, `hooks/`, `lib/` on origin/main (52 hits). Service-role paths (`supabaseServer`, `createServerSupabaseClient`, repositories, `cron/process-queue`) are unaffected and omitted. `access_token` hits that are Supabase **session** tokens are not in scope. **Two server paths run as `authenticated`** (cookie-auth `createServerClient` with the anon key) and count as "browser role" for the privilege change.

| # | File (origin/main) | Runs as | Access | Columns touched | Live? | DE-0 action |
|---|---|---|---|---|---|---|
| C1 | `app/business-os/settings/page.tsx` L439 | browser | SELECT | `*` (tokens) | live | **0a**: remove (server export) |
| C2 | `components/settings/SecurityTab.tsx` L221 | browser | SELECT | `*` (tokens) | live (`/settings`) | **0a**: remove |
| C3 | `components/v2/settings/SecurityTabV2.tsx` L114 | browser | SELECT | `*` (tokens) | live (`/v2/settings`) | **0a**: remove, **and** delete the client `fetch('/api/audit/log', { 'x-user-id' })` audit call that follows — the server route already writes `DATA_EXPORTED` |
| C4 | `app/v2/settings/page.tsx` L82 | browser | SELECT | `*` | live, but the result is **never read** (`const [, setConnections]`) | **0b-prep**: delete the read and the dead state |
| C5 | `app/(protected)/settings/page.tsx` L100 | browser | SELECT | `*` → feeds `PluginsTab` | live (`/settings`) | **0b-prep**: narrow to `id, plugin_key, plugin_name, username, email, status, connected_at, last_used` (the fields `PluginsTab` uses) |
| C6 | `components/settings/PluginsTab.tsx` L196 | browser | **UPDATE** | `status, disconnected_at` (`.eq('id')`) | live | keep; covered by the column grant (B-3) |
| C7 | `components/dashboard/AgentSandBox/useAgentSandbox.ts` L311 | browser (no `'use client'` banner, imports `supabaseClient`) | SELECT | `plugin_key` | live (agents/[id]) | keep; covered |
| C8 | `components/onboarding/PluginsStep.tsx` L30 | browser | SELECT | `plugin_key` | dead (only `Onboarding_old.tsx`, imported nowhere) | none |
| C9 | `components/wizard/hooks/useWorkflowData.ts` L142 | browser | SELECT | `*` | dead (`AgentWizard` imported only by a `.tsxold`) | none — fails closed (42501) after 0b |
| C10 | `components/orchestration-NOT-USED/.../PluginConnectionManager.tsx` L58 | browser | SELECT | `*` | dead | none — fails closed |
| C11 | `lib/plugins/v2/core/UniversalOAuthHandler.ts` L94 | browser client (`supabaseClient`) | **UPSERT** | tokens | dead (`UniversalPlugin` ← `plugins/v2/registry` imported nowhere) | none — fails closed |
| S1 | `lib/intelligence/execution/PluginCoordinator.ts` L113, L331, L453 | **`authenticated`** via `runAgentWithContext` from `/api/agent-stream`, `/api/agent-chains/run`, `/api/run-agent` (legacy AgentKit branch) | SELECT `*` + **UPDATE `access_token, expires_at`** (token refresh) | tokens | live (legacy) | **0b-prep**: move all three calls to `pluginConnectionRepository` (service role, `.eq('user_id')`); add one repository method for the refresh write (`new-repository` skill, unit test). 15 `console.*` in this file — flag + convert (CLAUDE.md § Logging) |
| S2 | `app/api/generate-agent*/route.ts` (×4 + `route copy.ts`) | `authenticated` | SELECT | `plugin_key` | live | keep; covered |
| S3 | `app/api/plugin-connections/disconnect/route.ts` L53 (V1, deprecated) | `authenticated` | UPDATE | `disconnected_at` | no UI caller | keep; covered |
| S4 | `app/oauth/[plugin]/start` → V1 `chatgptResearchStrategy.connect` | `authenticated` | UPSERT | tokens (`'platform-key'`) | no UI caller; V1 deprecated | none — fails closed; QA notes it |

**Writers of real tokens are server-side with the service role:** V2 OAuth callback `app/oauth/callback/[plugin]` → `UserPluginConnections` → `PluginConnectionRepository.upsert`; `app/oauth/token` → repository; `app/api/plugin-connections` POST/DELETE/GET → `createServerSupabaseClient` (service role). No browser INSERT or DELETE exists. No Realtime subscription on the table. The only view over it (`active_plugin_connections`) was already locked by 20261054 (PR #306).

#### 0.1.3 DE-0a — conditions (code only, PR 1)

- **A-1** One shared client helper, `lib/client/downloadUserDataExport.ts` (the `lib/client/` folder already holds browser fetch helpers). It does `fetch('/api/user/data-export', { cache: 'no-store', credentials: 'same-origin' })`; throws on `!res.ok` (401/500 JSON); takes the filename from `Content-Disposition` (fallback `my-data-<YYYY-MM-DD>.json`); downloads via Blob + object URL and revokes it. No DB access, no user id parameter. **SQ-E2 answered: fetch + blob**, so the toasts keep their meaning.
- **A-2** C1, C2 and C3 call the helper. Each keeps its own UX: C1 keeps `exporting` + `Loader2` + `export_success` / `export_error`; C2 and C3 keep their `setSuccessMessage` / `setErrorMessage`. The client data builders, the four `select('*')` reads (`profiles`, `user_preferences`, `notification_settings`, `plugin_connections`) and C3's client audit call are deleted. Remove imports that become unused (`supabase` only if no other use remains in the file).
- **A-3** **File content for now = the server export as it is** (§0.1.1). The old client file's `preferences` and `notifications` sections are dropped; accepted, DE-1 onwards adds Business OS content. No token or `credentials` key may appear.
- **A-4** The three files have 0 `console.*` (checked). No logging conversion owed in 0a.
- **A-5 Jest source guard** (`lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts`, runs in the existing Jest job, a file scan, no added CI time). A "browser file" = starts with `'use client'` **or** imports `@/lib/supabaseClient` (otherwise C7 and C11 escape). It fails if any browser file under `app/`, `components/`, `hooks/`, `lib/` calls `.from('plugin_connections')` / `.from("plugin_connections")` unless the file is in a **frozen allowlist** with a one-line reason; the allowlist after 0a is exactly C4–C11 (after 0b-prep: C5–C11). It also fails if an allowlisted file **no longer** has the call (the list can only shrink), and if C1/C2/C3 reference `plugin_connections` at all. Negative control: the detector flags a synthetic `'use client'` source with `.from('plugin_connections').select('*')` and one that only imports `supabaseClient`.
- **A-6** QA: on each of the three screens, export with a connected plugin; file has no `access_token` / `refresh_token` / `credentials`; signed-out → error message, not a blank file; DevTools Network shows only `/api/user/data-export`.

#### 0.1.4 DE-0b — conditions (PR 2: code prep + migration; user applies to PROD by hand)

- **B-1 Pre-check first (user runs, read-only — paste the output to SA/Dev).** The table was created in the dashboard, so no migration names its full column list. Dev writes `scripts/precheck-plugin-connections-token-privileges.sql` containing the three queries in B-8 "pre". The migration's grant list and the rollback are written **from that output**, not guessed.
- **B-2 Code prep lands in the same PR, before the migration file is applied:** C4 deleted, C5 narrowed, S1 moved to the repository. Without S1 the legacy run paths break (`select('*')` needs every column) and token refresh writes fail.
- **B-3 Migration `supabase/migrations/20261059_plugin_connections_token_column_lockdown.sql`** (next free number on origin/main and on every remote branch today; re-check at PR time). One transaction:
  1. `REVOKE ALL ON public.plugin_connections FROM PUBLIC, anon, authenticated;` — table-level grants must go, because a table-level SELECT covers every column and a column REVOKE alone would change nothing (SQ-E3). `anon` gets **nothing back**: RLS already gives it zero rows, and nothing anonymous reads the table.
  2. `GRANT SELECT (id, user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, created_at, updated_at, last_used, disconnected_at) ON public.plugin_connections TO authenticated;` — minus any column the pre-check shows does not exist. **Never granted:** `access_token, refresh_token, expires_at, last_refreshed_at, credentials, settings, profile_data` (`profile_data` may hold provider tokens) and any column the pre-check lists that is not in the allow list (default deny, record it in a comment).
  3. `GRANT UPDATE (status, disconnected_at) ON public.plugin_connections TO authenticated;` (C6, S3). No INSERT, DELETE, REFERENCES, TRIGGER or TRUNCATE for `authenticated`.
  4. Do not touch `service_role`, `postgres`, RLS or policies.
  5. A `DO` post-condition block (as in 20261054) that raises if `has_column_privilege` is true for `anon`/`authenticated` on any never-granted column for SELECT/INSERT/UPDATE/REFERENCES, or if `has_table_privilege('anon', …, 'SELECT')` is true.
- **B-4 Rollback** `scripts/rollback-plugin-connections-token-column-lockdown.sql`: revoke the column grants of B-3.2/B-3.3, then re-grant exactly the table-level privileges the B-1 pre-check recorded, per role. Not a blanket `GRANT ALL`.
- **B-5 Checker** `scripts/check-plugin-connections-token-column-lockdown.sql`: the B-8 "post" queries, printing PASS/FAIL per row and a VERDICT; it must report both states (before = FAIL, after = PASS), as AC-E6 requires. Avoid the word "into" in any string literal (Supabase SQL editor bug).
- **B-6 Migration test** `supabase/migrations/__tests__/plugin-connections-token-column-lockdown.migration.test.ts` (text assertions as for the 20261054 test): table-level revoke present, token columns absent from every GRANT, no grant to `anon`.
- **B-7 Token rotation (SQ-E3):** **no forced rotation** of the 27 refresh tokens. Exposure was to each owner's own browser session under RLS, with no evidence of misuse. Revisit only if an XSS is found.
- **B-8 SQL for the user (read-only):**

**File:** `scripts/precheck-plugin-connections-token-privileges.sql` (pre) and `scripts/check-plugin-connections-token-column-lockdown.sql` (post)

```sql
-- pre 1: every column
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'plugin_connections' ORDER BY ordinal_position;
-- pre 2: table-level grants (feeds the rollback)
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'plugin_connections' ORDER BY grantee, privilege_type;
-- pre 3: any existing column-level grants
SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'plugin_connections'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC') ORDER BY grantee, column_name, privilege_type;

-- post: every row must be false
SELECT r.role, c.col, p.priv,
       has_column_privilege(r.role, 'public.plugin_connections', c.col, p.priv) AS granted
FROM (VALUES ('anon'), ('authenticated')) r(role),
     (VALUES ('access_token'), ('refresh_token'), ('credentials'), ('profile_data'),
             ('settings'), ('expires_at'), ('last_refreshed_at')) c(col),
     (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
ORDER BY 1, 2, 3;
-- post: authenticated keeps what the app needs (expect true, true, false)
SELECT has_column_privilege('authenticated', 'public.plugin_connections', 'plugin_key', 'SELECT'),
       has_column_privilege('authenticated', 'public.plugin_connections', 'status', 'UPDATE'),
       has_table_privilege('anon', 'public.plugin_connections', 'SELECT');
-- post: negative probe (expect ERROR 42501), rolled back
BEGIN;
SET LOCAL ROLE authenticated;
SELECT access_token FROM public.plugin_connections LIMIT 1;
ROLLBACK;
```

- **B-9 QA (AC-E5), named flows:** connect a V2 OAuth plugin (callback writes via service role); run an agent through `/api/agent-stream` with an expired token (S1 refresh now via repository); `/settings` → Plugins tab lists and disconnects (C5, C6); agent page sandbox plugin check (C7); generate-agent (S2); the three exports (0a). Then run the checker on PROD (VERDICT PASS) and the negative probe.

#### 0.1.5 Split and order

**Two PRs.** PR 1 = DE-0a (code only, no DB, ~0.5 d). PR 2 = DE-0b (code prep B-2 + migration + scripts + test, ~1 d), branched from main **after** PR 1 merges (no stacking). The user runs the B-1 pre-check before Dev writes the migration grant list, and applies 20261059 to PROD by hand **only after PR 2's code is deployed**. Overlap check: the DB-exposure lockdown stream (SECDEF slices, views 1a/20261054, RLS 2a/2b/20261056–57) does not touch `plugin_connections` table privileges. Its open slices 1b / 2c / 3 must not claim 20261059 or this table — TL to tell that stream.

**SA code review DE-0a — 2026-10-13 (uncommitted, branch `fix/data-export-de0a-buttons-server`): ✅ Code Approved for QA.** A-1…A-5 met: the three handlers call `downloadUserDataExport()` only (no DB read, no client audit, no `x-user-id`); the server export names 13 columns, never reads a credential, and passes `profile_data` only through the `accountProfile` allow-list; the helper logs nothing and returns a typed verdict, and each screen keeps its own loading state and messages; the server route already writes `DATA_EXPORTED` (`auditLog`), so dropping C3's client audit loses nothing, and C1/C2 gain a server audit they never had; the guard's allowlist is exactly C4–C11, it can only shrink, the negative control passes, it is a file scan in the existing Jest job (no added CI time); 0 `console.*` in the touched files; 20/20 new tests pass. Non-blocking notes: (1) the guard matches a literal table name only, so `.from(SOME_CONST)` or a browser client built with `createBrowserClient` outside `supabaseClient` would escape it — accepted for a source guard, DE-0b's column revoke is the real control; (2) the server route awaits `auditLog`, which only queues, with no WC-7 flush — this was already true before DE-0a, so it goes to DE-1, not here.

**QA — DE-0a — 2026-10-14 (uncommitted, same branch): ✅ Pass. Ready for the user's diff review once the manual checks below are done.** Mode: full, Jest + source reading (A/B); no browser or live calls, because these need a signed-in session.

| Check | Result |
|---|---|
| Helper `downloadUserDataExport.test.ts` (200 / 401 / 500 / network, filename fallback, path-traversal filename) | ✅ 7/7 |
| Guard `pluginConnectionsBrowserAccess.guard.test.ts` | ✅ 13/13 |
| Route `route.test.ts` + `route.characterization.test.ts`, `userDataExportReads.test.ts`, `ownerAuditReads.guard.test.ts` | ✅ all pass (118 tests across the 10 targeted suites) |
| Tokens absent from the route body. I wrote a temporary QA test: a fake `plugin_connections` row carrying `access_token`, `refresh_token`, `credentials`, `settings`, `expires_at`, and a `profile_data` holding `access_token` / `refresh_token` / `id_token`. It asserted that none of those keys or values appear in the 200 JSON and that `account_profile` = `{name}` | ✅ pass. Removed afterwards so `git status` is unchanged. The existing tests already cover this in part (`profile_data` allow-list in route.test.ts; `access_token` seeded in the characterization test; the repository column list). **Suggest that Dev adopts the test** (optional) |
| Planted regressions. (1) `supabase.from('plugin_connections').select('*')` in SecurityTab's handler made the guard go red, 3 failing tests. (2) `supabase.from('profiles').select('*')` in the BOS settings handler made it go red, 1 failing test. Both files were restored and `cmp` showed them byte-identical | ✅ |
| No client export handler still reads `profiles` / `user_preferences` / `notification_settings` / `plugin_connections` (read the source of all three handlers; the guard enforces it) | ✅ |
| Messages: C1 shows `export_error` (en/es/he keys present) on any `!success`, and `export_success` + the `exporting` spinner on 200. C2/C3 clear both messages first, then show "Failed to export data…" on 401/500/network and "Data exported successfully!…" on 200. A thrown error is caught on all three screens | ✅ (from reading the source; there are no component tests) |
| eslint on the 6 changed files | ✅ 0 errors. Warnings are the same count as HEAD (3 / 11 / 1), none new |
| `tsc --noEmit` | ✅ 0 errors in the changed files (the repo has 1916 errors elsewhere, all pre-existing) |
| Full `npm test` | 15 suites fail. 11 are quarantined. The other 4 (`bookingsSearchAndPaging.guard`, `supabaseFetch`, `publicEndpointsAreThrottled.guard`, `oneAddressPolicy.guard`; 6 tests) fail the same way on the main checkout, because of Windows path separators and the dev env. None come from DE-0a |

**Edge cases (non-blocking):** (E1) The BOS settings handler does not clear an earlier `errorMessage` before it exports. After a failure and then a success, both banners can show. This was already true before DE-0a. (E2) A 401 shows the generic "try again" message, not "sign in again". A-6 only asks for "error, not a blank file", which is met. (E3) A-1 says the helper "throws on !res.ok", but it returns a typed verdict. SA has already accepted this. (E4) `DangerZonePanel`'s plain `<a href="/api/user/data-export">` is a fourth way into the export. The file it gives is token-free, but a signed-out person still saves the error JSON as their "data". This is the SQ-E2 concern; it is out of DE-0a scope and is noted for DE-1.

**Manual checks owed (A-6, signed in, on `/business-os/settings`, `/settings` → Security and `/v2/settings` → Security):** (1) with a plugin connected, export. The file has no `access_token` / `refresh_token` / `credentials` / `profile_data`, and the success message shows. (2) DevTools Network shows only `GET /api/user/data-export`: no `/rest/v1/plugin_connections`, `profiles`, `user_preferences` or `notification_settings`, and no `/api/audit/log`. (3) Signed out (or with the session cookie removed), click Export. The error message shows and nothing downloads. (4) An offline network shows the error message. (5) `audit_trail` gets one `DATA_EXPORTED` row per export.

**QA — DE-0b — 2026-10-14 (uncommitted, branch `fix/data-export-de0b-token-column-lockdown`; SA reviewed in parallel): ✅ Pass. No bugs. Ready for the user's diff review. The B-9 manual flows below are owed before and after the PROD apply.** Mode: full. Strategy: A (Jest), C (the migration and the four scripts executed on a local PGlite 0.5.8 / PG 18.3 replica, in session scratch space outside the repo; prod was never contacted), plus source reading.

| Check | Result |
|---|---|
| New suites: `PluginConnectionRepository.updateRefreshedToken`, `PluginCoordinator.repository`, `plugin-connections-token-column-lockdown.migration` + DE-0a guard `pluginConnectionsBrowserAccess.guard` | ✅ 4 suites, 76/76 |
| data-export route + characterization, `lib/client`, `lib/plugins/__tests__`, settings components, PluginConnection repository suites | ✅ 12 suites, 146/146 |
| `npm run test:plugins:unit` | ✅ 27 suites, 590/590 |
| `npm run test:authz-guard` | ✅ 2 suites, 203/203 |
| Planted regressions: `select('*')` back on C5, and a `plugin_connections` read re-added to `/v2/settings` (C4). Both files were restored and `cmp` showed them byte-identical | ✅ guard red (3 failures) |
| Full `npm test` | 16 suites fail. 11 are quarantined. 4 are the known Windows/dev-env failures (`oneAddressPolicy.guard`, `bookingsSearchAndPaging.guard`, `supabaseFetch`, `publicEndpointsAreThrottled.guard`). The 16th, `finance.source.guard` (DF-5, 2 tests), touches no DE-0b file. It is the slice 4a guard that is new on this base (`392a9b53`). It reads CRLF-checked-out sources, so it is most likely the same Windows-only class, but this was not proven. **Not a DE-0b defect**, so check it on CI |
| Entitlements | n/a: no import from `lib/business-os/entitlements/` |
| `console.*` in the 4 touched source files | ✅ 0 (PluginCoordinator's 15 and the `/settings` page's calls converted to Pino) |

**Replica run.** I rebuilt `plugin_connections` in the prod shape: 19 columns, `access_token NOT NULL`, no `credentials`. Roles `anon` / `authenticated` / `service_role` (BYPASSRLS); all 7 table privileges for `anon` and `authenticated`; RLS on, with own-row policies through `auth.uid()`; one row each for two users.

| Step | Result |
|---|---|
| Pre-check (3 result sets) | 19 columns; 7 table privileges each for `anon` and `authenticated`; no column grants |
| Checker **before** | ✅ VERDICT **FAIL** (19 pass, 27 fail): C2 table privileges held, C3 token columns held |
| Probe before | both SELECTs succeed (the token read is open, as expected) |
| Migration | applies; the DO post-condition block does not raise |
| Checker **after** | ✅ VERDICT **PASS** (46 pass, 0 fail) |
| Probe after | first SELECT ok; `SELECT access_token` → **42501** |
| `authenticated` (sub = user 1) | ✅ SELECT the 13 columns ok (1 row; RLS still scopes). ✅ `UPDATE status, disconnected_at` ok. Another user's row: 0 rows (RLS). **Denied 42501:** `SELECT *`, `access_token`, `refresh_token`, `settings` / `profile_data` / `expires_at` / `last_refreshed_at`, `UPDATE … RETURNING access_token`, `UPDATE access_token`, `UPDATE updated_at`, INSERT and DELETE |
| `anon` | SELECT and UPDATE → 42501 |
| `service_role` | ✅ SELECT tokens, UPDATE `access_token` / `expires_at`, INSERT and DELETE all work |
| Rollback | applies; checker back to FAIL 19/27; probe token read open again; **pre-check output byte-identical to before** |
| Re-apply, then apply a third time | ✅ PASS 46/0 both times (idempotent) |

**Reading.** Every remaining non-service-role access uses only granted columns:

- C5 is narrowed to 8 columns, and those are exactly the fields `PluginsTab` reads.
- C6 updates `status` + `disconnected_at`, filtered on `.eq('id')`, with no `.select()`.
- C7 and C8 select `plugin_key`.
- S2 (the 5 generate-agent routes) selects `plugin_key` with `.eq('user_id')`.
- S3 updates `disconnected_at` with `.eq('plugin_key')` + `.eq('user_id')`.
- C9, C10, C11 and S4 are dead code and fail closed with 42501, as ruled.

No `.update(...).select()` exists on an `authenticated` path; that form would need SELECT on returned columns. The PluginCoordinator refresh calls `updateRefreshedToken(context.userId, pluginKey, {accessToken, expiresAt})`. The repository uses the service role, scoped by `.eq('user_id')` + `.eq('plugin_key')`, with a fixed patch and `count: 'exact'`. It returns nothing token-bearing. None of the new or converted log lines carry a token or the prompt: the prompt is logged as length only, and errors as `{ err }`.

**Edge cases (non-blocking):**

- (E1) The refresh patch also sets `updated_at`, besides `access_token` / `expires_at`. This is harmless housekeeping on the service-role path, but it is wider than the S1 wording.
- (E2) The rollback re-grants all 7 privileges to `anon` and `authenticated` (B-4: "exactly what the pre-check recorded"). That is correct only if the user's PROD pre-check showed all 7 for both roles and nothing for PUBLIC. Compare the rollback with the pasted pre-check before applying.
- (E3) The migration is `20261067`, not `20261059` as in B-3. That follows B-3's own "re-check at PR time". Re-check again at PR time.
- (E3a, 2026-10-14) **Renumbered to `20261068`** at PR time: PR #378 (gpt-image-1 retirement) merged `20261067_bos_llm_images_model_gpt_image_2_5_flare.sql` to main first. No other branch or worktree holds `20261068`. Content unchanged.
- (E4) S3 sets `disconnected_at` but not `status`. This was already true before DE-0b and is out of scope.
- (E5) After the apply, `authenticated` can no longer UPDATE `updated_at`. Any future browser write that sets it will get 42501. No current caller does.

**Manual flows owed (B-9; signed in; run on the deployed DE-0b code, then again after applying 20261068 to PROD):**

1. Connect a V2 OAuth plugin. The callback saves it, and the plugin shows as connected.
2. Run a legacy AgentKit agent through `/api/agent-stream` with an expired token. The run succeeds, and the row's `expires_at` / `updated_at` move forward. Look for no "Refreshed token was not saved" log line.
3. `/settings` → Plugins tab lists the connections, and Disconnect works (`status = disconnected`).
4. On the agent page (`/agents/[id]`), the sandbox plugin check shows the connected plugins.
5. Generate an agent through `/api/generate-agent*`. The connected plugins are detected.
6. `/v2/settings` loads, with no `plugin_connections` request in DevTools.
7. The three DE-0a exports still download, and the files are token-free.
8. On PROD, run the checker (VERDICT PASS) and the negative probe (`SELECT access_token` → 42501).

**SA code review DE-0b — 2026-10-14 (uncommitted, branch `fix/data-export-de0b-token-column-lockdown`, base `392a9b53`): ✅ Code Approved for QA.** B-1…B-6 and B-8 are met. B-7 is no-op by ruling. B-9 is QA's manual list above.

| Check | Finding |
|---|---|
| C4 (`app/v2/settings/page.tsx`) | The page still exists and still loads profile, preferences and notifications. Only the `plugin_connections` read, the `setConnections` state and the unused `PluginConnection` import were removed. Its one `console.*` was converted |
| C5 (`app/(protected)/settings/page.tsx`) | `PLUGINS_TAB_COLUMNS` = the 8 columns in B-3 (a subset of the 13 granted). `PluginsTab` reads only `id, plugin_key, plugin_name, username, email, status, connected_at, last_used` (checked field by field). The filter (`status`) and the order (`connected_at`) are granted columns too. 8 `console.*` → Pino |
| S1 client and tenant scope | `pluginConnectionRepository` is the singleton built on `supabaseServer` (service role). All three calls are scoped by `user_id` from `context.userId`. The refresh write adds `.eq('plugin_key')` and a fixed 3-field patch, with `count: 'exact'` (not `.select()`, see the PostgREST update+select gotcha). Nothing token-bearing is returned or logged. This meets `tenant-isolation-guard` Step 3 |
| S1 callers pass a server-derived user | `/api/agent-stream` and `/api/run-agent` pass `user.id` from `auth.getUser()`. `cron/process-queue` passes the job's `user_id` behind the QStash signature, and was already service role before this change. `run-scheduled-agents-direct` passes `agent.user_id` behind `CRON_SECRET`. No caller takes the id from the body or a header. Before, a cookie client gave an RLS backstop. That backstop is gone, so a server-derived id is now the only control, and it holds |
| S1 behaviour | `findAllByUser` = the same rows as before (every status), now ordered. `findByUserAndPlugin` = the same `.single()`, and a miss gives `data: null`, as before. A failed token save is logged as a warning and the run continues, using the in-memory token. Before, the result was ignored silently. Accepted |
| Other paths that are not service role | Re-grepped all `.from('plugin_connections')`. Every token or `profile_data` reader (BOS stats/setup-status, the payments, invoice and website checkout routes, `stripeAccountContext` callers, `/api/plugin-connections`, admin stats) uses `supabaseServer`, `createServerSupabaseClient` or a service-role `createClient`. Cookie or browser paths: C5–C8, S2 and S3 touch only granted columns. C9–C11 and S4 are dead and fail closed. No `authenticated` `.update().select()` exists. The only SQL functions in migrations that name the table are the SECURITY DEFINER operator-cleanup functions |
| Migration `20261067` | It is the next free number. No ref on origin or any remote branch adds `20261067`+, and no worktree holds one apart from this one. One transaction, `lock_timeout`, a table-level `REVOKE ALL` from PUBLIC, anon and authenticated (this also drops any column grants). There are two column grants. 13 + 6 = the 19 prod columns. `credentials` is correctly absent (prod has no such column). Nothing touches `service_role`, RLS or policies. The post-condition **cannot pass while a token column is still granted**: `has_column_privilege` is true for a table-level grant as well as a column-level one, and PUBLIC-inherited grants count for anon and authenticated. It checks all 6 token columns × anon/authenticated × SELECT/INSERT/UPDATE/REFERENCES, every table privilege for PUBLIC/anon/authenticated, anon/PUBLIC with no column privilege, and the exact SELECT and UPDATE sets for authenticated |
| Rollback | It revokes the two column grants, then re-grants exactly the 7 table privileges to anon and authenticated, which matches the coordinator's prod pre-check. It is not `GRANT ALL`, and grants nothing to PUBLIC. QA showed the pre-check output is byte-identical after a rollback |
| Checker / probe / "into" | 46 rows + VERDICT, read-only. It reports FAIL before and PASS after (QA replica). The probe is separate. No migration or script contains the word "into" |
| Logging, tests | 0 `console.*` left in the 4 touched files. The prompt is logged by length only. The 4 DE-0b suites pass (76/76, re-run by SA). `oneAddressPolicy.guard` fails here on absolute Windows backslash paths that do not match its allowlist: an environment failure, not DE-0b. Entitlements: n/a |

**Non-blocking notes:**

- (N1) Before applying the rollback, check that the pasted pre-check showed all 7 privileges for `service_role` as well. The rollback asserts that `service_role` holds TRUNCATE and TRIGGER too. If prod lacks them, the rollback aborts safely but cannot be applied as written.
- (N2) Tables created in the dashboard can carry functions that no migration shows. Before the apply, the user runs one read-only query: `SELECT p.proname, p.prosecdef FROM pg_proc p WHERE p.prosrc ILIKE '%plugin_connections%';`. Any row with `prosecdef = false` that `authenticated` calls and that reads a token column would get 42501. Send such a row to SA.
- (N3) Already true before DE-0b, not a regression: `/api/agent-chains/run` calls `runAgentWithContext` with `user_id` / `agent_id`, not `userId` / `agent`. It throws before it reaches the coordinator.
- (N4) QA E1 is accepted: also setting `updated_at` on the refresh is correct housekeeping.

---

## 1. Discovery: what exists today

### 1.1 The server export: `GET /api/user/data-export`

| Fact | Tier |
|---|---|
| One GET with no parameters. Auth is `createServerClient` + `getUser()`. 401 if signed out | ✅ |
| Answers with one JSON file: `Content-Disposition: attachment; filename="neuronforge-data-export-<userId>-<ms>.json"`, `Cache-Control: no-store` | ✅ |
| Eight reads, all with the service role (`supabaseServer`), each keyed on `user.id` from `getUser()` (never from the request). They go through purpose-named repository methods `...ForUserDataExport` (refactor workplan, SA-approved) | ✅ worktree / ❓ merged |
| **Sections:** `user_profile` (profiles `*`, spread over auth id/email/created_at), `agents` (`*`, incl. deleted), `agent_executions` (`*`, last 90 days, max 1,000), `agent_configurations` (`*`), `plugin_connections` (**5 explicit columns**, credentials never selected), `subscriptions` (`user_subscriptions *`), `transactions` (`credit_transactions *`, last 12 months, max 5,000), `audit_logs` (`audit_trail *`, BD-26 exclusions, last 90 days, max 10,000), plus `summary` | ✅ |
| **Every read error is ignored** and gives an empty section (SA C-5, deliberate) | ✅ |
| **`audit_logs` is always empty.** It filters on `timestamp`, which does not exist (42703, error swallowed). **FU-1** | ✅ |
| **BD-26:** internal admin audit entries (`OWNER_HIDDEN_ENTITY_TYPES`: `ai_action`, `business_os_account_plan`, `business_os_credit_lot`, `business_os_credit_period`, plus any `BUSINESS_AI_ACTION_%` action) are excluded inside `AuditTrailRepository.listOwnerEntriesForExport`, pinned by `lib/audit/__tests__/ownerAuditReads.guard.test.ts` | ✅ |
| Seven of the eight reads use `select('*')` (**FU-P1**). The 500 body returns `error.message` in production (**FU-P2**). `exportData: any` (rule 6). All three were left for a follow-up | ✅ |
| `credit_transactions` / `user_subscriptions` are agent-platform (Pilot-Credit) tables. `CreditTransactionRepository` is read-only, with "no Business OS use" (SA C-3) | ✅ |
| `export_metadata.data_controller` = `'NeuronForge'`. The route writes a `DATA_EXPORTED` audit row (`info`, GDPR/SOC2 flags, IP and user agent) | ✅ |

**So for a Business OS owner the file holds:** their profile row, plugin connection metadata, and agents and runs if they ever used the agent platform. Nothing from the 60+ Business OS tables.

### 1.2 The client-side export buttons and the token exposure

| Surface | What it does | Tier |
|---|---|---|
| `app/business-os/settings/page.tsx` `handleExportData` (≈ L429) | In the browser: `profiles select('*')`, `user_preferences select('*')`, **`plugin_connections select('*')`**, then builds `my-data-<date>.json` from a Blob | ✅ |
| `components/settings/SecurityTab.tsx` | Same pattern, plus `notification_settings` | 🧠 (coordinator) |
| `components/v2/settings/SecurityTabV2.tsx` | Same pattern, plus `notification_settings` | 🧠 (coordinator) |

**Live measurement (user, 2026-10-05) ✅:**

| Measure | Result |
|---|---|
| Column privileges on `public.plugin_connections.access_token` and `refresh_token` | **`anon` and `authenticated` both hold SELECT, INSERT, UPDATE, REFERENCES** |
| RLS | ON. Policies: "Users can manage own plugin connections" (ALL, `{public}`, `USING auth.uid() = user_id`) and "Users can only see own connections" (SELECT, `{public}`, `auth.uid() = user_id`) |
| Rows holding a refresh token | 27 |

**What that means:**
- A signed-in user's browser can **read and write** their **own** OAuth access and refresh tokens. `anon` gets no rows, because RLS filters on `auth.uid()`.
- The three client "Export data" buttons put those tokens into a plain downloaded JSON file.
- **Beyond the export, any script running on our origin (an XSS) can read them**, and so can a browser extension with page access. The tokens grant access to the owner's Google/other accounts.
- This is direct client DB access to a credential table (CLAUDE.md rule 1, Security Rules).
- **The finding is independent of the export feature.** Removing the buttons (DE-0a) closes the file leak. Only the privilege revoke (DE-0b) closes the browser read/write.

### 1.3 The Danger zone link

`components/business-os/purge/DangerZonePanel.tsx` → `ErasureRequestContent` renders a plain `<a href="/api/user/data-export">Export Data</a>` next to the erasure "Contact us" mailto, with the hint "We recommend downloading a copy of your data first — erasure cannot be undone." ✅ The erasure path already points at the server export. That export just doesn't contain the business.

### 1.4 Per-screen exports

| Export | Where | What | Reuse? | Tier |
|---|---|---|---|---|
| **Ledger** | `GET /api/payments/ledger/export` → `lib/payments/ledgerService` (`buildLedgerReport`, `ledgerToCsv`, `ledgerToWorkbook`) + `lib/payments/ledgerExport.ts`; UI `components/payments/LedgerExportModal.tsx` | Server-side, Zod-validated, xlsx or csv, date range, refunds as their own dated rows, tax/fee splits, per-currency totals, ISO dates | **Yes, for the shaping rules.** The full export's money sections follow the same conventions. The accountant workbook could also be included as an extra file (SQ-E6). It also proves an xlsx writer is already a dependency | ✅ |
| Orders page "save what is on screen" | Described in the ledger route header: exports the loaded rows, capped by pagination | Not reusable as a full export | ✅ (comment) |
| CRM contacts CSV, money list CSV | Named in the brief. **Not located** with the tools BA had (no grep) | Dev locates them in DE-1. Reuse their **column choice and CSV escaping**, not page-capped client builders | ❓ |
| `/monitoring` CSV | `app/(protected)/monitoring/page.tsx`, from `GET /api/audit/query` (BD-26 F-3) | Agent-platform audit view, not reused | ✅ |
| `AuditTrailService.exportUserData()` | Reads every audit row. **No production caller** (BD-26 F-5) | **Do not reuse.** It would bypass BD-26 | ✅ |

### 1.5 Registries that already classify tables

| Registry | What it classifies | Enforcement | Tier |
|---|---|---|---|
| `lib/business-os/businessOwnedTables.ts` | `BUSINESS_OWNED_TABLES` (≈ 60) vs `USER_OWNED_TABLES` (≈ 45, each with a reason). Its header names "what an export includes" as one of its purposes | `businessOwnedTables.test.ts` reads **migration text**, with no DB in CI. Every `CREATE TABLE` with `user_id` must be in exactly one list, and the TS list must equal the SQL array | ✅ |
| `lib/business-os/account/accountDeletionPolicy.ts` | Per account-level table: `delete` / `minimise` / `keep`, plus a reason | Its own test. SA-1 (admin delete): only script/test consumers. Purge slice 3 must **retire it or derive it from the descriptors**: "two registries is the root cause of the `insight_actions` drift" | ✅ |
| `lib/business-os/purge/descriptors.ts` | Per table: `level` (`reset` / `purge` / `never` / `optional:*`), scope, order, snapshot, storage buckets | Invariant test. The **`SchemaReconciler`** (AD-1a, SC-7) compares the descriptors with the live schema through `purge_schema_introspect()`, which returns **columns** and FKs | ✅ / reconciler merge ❓ |

A fourth independent list for export would repeat the exact failure SA-1 diagnosed (§6.4, SQ-E1).

---

## 2. GDPR roles: whose data is in the file

| | **A. The owner's own data** | **B. Data the owner holds about their clients** |
|---|---|---|
| Examples | Login email, profile, preferences, plan, billing account, credits used and added, onboarding chat, own activity history | Contacts, notes, documents, bookings, invoices, payments, intake answers, subscribers, consent records, emails sent to clients |
| Our role | **Controller** | **Processor**, acting for the owner, who is the controller |
| Basis for exporting it | Art. 15 (access) and Art. 20 (portability), the owner's own rights against us | Art. 28(3)(g): we **return** the controller's data on request and at the end of the service, before deleting it. The owner needs it before any delete |
| Who may ask | The owner, about themselves | The owner only. **A client of the business cannot ask us.** They ask the business, which answers with this export or its screens |

**What that means for the export:**

1. **Both kinds go in the file, in separately labelled groups.** The README and metadata say which group is which and who the controller is for each: us for the account, the business for its client records.
2. **Group B is third-party personal data, often in bulk.** The file is as sensitive as the whole CRM. That is why the NFRs require owner-only access, no caching, an audit row, short-lived links and nothing in logs (§7).
3. **We do not filter Group B "for the client's sake".** It is the owner's data to take away. We remove only what is **ours** (internal admin notes, our AI provider cost, caches, platform counters) or **dangerous** (tokens and secrets).
4. **A client's access request goes to the business, not to us.** A per-contact export is the precise tool for that, and is on the roadmap (§10).
5. **`data_controller: 'NeuronForge'` is wrong for Group B** and stale as a brand for Group A (DX-10).

---

## 3. Proposed scope: what goes in, what never goes in

### 3.1 Groups

Table names are as classified in `businessOwnedTables.ts` ✅. **Every column is ❓ until verified live** by `npm run schema:check` in the slice that adds it.

| Group | Contents (tables) | GDPR role | Slice |
|---|---|---|---|
| **A1 Account & profile** | `profiles`, `user_preferences`, `notification_settings` 🧠, `business_profiles`, `business_addresses`, `onboarding_conversations`, `plugin_connections` (metadata only) | Controller | DE-3 |
| **A2 Plan, billing & credits** | `business_os_account_plans`, `business_os_billing_accounts` (Stripe ids **included** 🧠), `business_os_credit_charges` (credits charged, **without our AI provider cost** 🧠), `business_os_credit_totals`, `business_os_credit_lots` / `_credit_lot_draws` (extra credits, DX-9), invites sent (`business_os_invites`) | Controller | DE-3 |
| **A3 Own activity** | `audit_trail` owner-visible rows (BD-26 kept, FU-1 fixed) | Controller | DE-1 |
| **B1 Clients (CRM)** | `crm_contacts`, `crm_activities` (notes, history), `crm_tasks`, `crm_pipeline_stages`, `contact_documents` (metadata; files in DE-8) | Processor | DE-4 |
| **B2 Scheduling** | `scheduling_services`, `scheduling_bookings`, `scheduling_availability_exceptions`, `external_calendar_events` | Processor | DE-4 |
| **B3 Money** | `payment_transactions`, `payment_refunds`, `payment_invoices`, `payment_plans`, `payment_plan_subscriptions`, `payment_plan_installments`, `payment_reminders`, `payment_events`, `proposals`, `payment_automation_rules` / `_executions`, `saved_payment_methods` and `payment_methods` (brand / last 4 / Stripe ids only), `stripe_connect_accounts` (ids and status only), `payment_processors` (**name and status only, never keys**) | Processor | DE-5 |
| **B4 Intake, leads & email** | `business_intake_forms`, `user_intake_settings`, `lead_responses`, `business_subscribers`, `marketing_consent_settings`, `marketing_consent_events`, `marketing_consent_state`, `email_unsubscribes`, `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`, `email_sends` | Processor | DE-6 |
| **C Content** | `websites`, `website_pages`, `website_content`, `smart_links`, `user_media` (generated and uploaded images: metadata; files in DE-8) | Mostly controller | DE-7 |
| **D Insight & assistant activity** | `business_chat_conversation`, `business_chat_saved_plans`, `business_chat_verified_questions`, `daily_briefings`, `insights`, `insight_outcomes`, `insight_actions`, `insight_automations`, `business_health_summaries`, `owner_insight_history`, `channel_connections` (no tokens), `channel_metrics_daily`, `website_page_views` (aggregated, SQ-E7) | Mixed | DE-7 |
| **E Agent platform (existing)** | `agents`, `agent_executions`, `agent_configurations`, `user_subscriptions`, `credit_transactions`, kept as today with explicit columns | Controller | DE-1 |

### 3.2 Never in the export (each needs a recorded reason in the registry)

| Category | Examples | Reason |
|---|---|---|
| Tokens, secrets, keys | `plugin_connections.access_token` / `refresh_token`, processor API keys, webhook secrets, `auth_handoff_codes` | Security. Never selected, not even to drop later |
| Our internal notes about the account | BD-26 operator entity types; admin actor ids and internal reasons on grants (DX-9) | BD-26 user decision |
| Our cost | AI provider cost columns on charges, `token_usage` cost fields, `ai_model_pricing` | User decision 🧠 |
| Caches and platform counters | `business_chat_plan_cache`, `business_os_entitlement_shadow_events`, `derived_metrics`, `daily_briefing_sends` bookkeeping (SQ-E7) | Not the owner's data, or fully derived from exported data |
| Other accounts | Rows of other users, even if linked | Tenant isolation |
| Platform tables with an actor column | `ais_scoring_weights`, `exchange_rates`, `system_settings_config`, … (admin delete SC-8) | Platform data; the owner only appears as "who edited" |

---

## 4. User stories

- As a **Business OS owner**, I want one button that gives me a copy of **everything** I and my business have in the platform, so I can keep it, move to another tool, or answer my accountant.
- As an **owner about to delete my business**, I want the export offered as the first step, so I do not lose my client list by accident.
- As an **owner whose client asks "what do you hold about me?"**, I want my client records in a form I can search and hand over.
- As a **platform admin answering an erasure request**, I want to see whether the account exported recently, and to send the owner an export before I delete. **I never download it myself.**
- As the **product owner**, I want a new table or column to fail CI until someone decides whether it is exported, so the export cannot fall behind again.
- As the **security owner**, I want no browser code able to read or write OAuth token columns, and no export path ever to select them.

---

## 5. Delivery slices

Small, numbered and independent, a few days each. Every slice leaves the export **more** complete and never less safe. Nothing is committed before the user has seen the diff. **DE-0 is security work and is sequenced on its own (§0). DE-1…DE-10 run after admin delete AD-2…AD-4.**

| Slice | Delivers | Depends on | Size |
|---|---|---|---|
| **DE-0a — Security: buttons go through the server** 🔴 user decision pending on jumping the queue | The three buttons (`business-os/settings`, `SecurityTab`, `SecurityTabV2`) stop reading the DB from the browser. Each downloads `GET /api/user/data-export` (no tokens, explicit 5-column plugin read), like `ErasureRequestContent` already does. The client `handleExportData` builders are deleted. Toasts adapted (SQ-E2). Jest source guard: no `'use client'` file calls `.from('plugin_connections')`, with a negative control. `console.*` count in the three files flagged per CLAUDE.md § Logging | Nothing | 🟢 ~0.5 d |
| **DE-0b — Security: revoke browser access to token columns** 🔴 SA to rule | A migration revokes SELECT, INSERT, UPDATE (and REFERENCES) on `plugin_connections.access_token` and `refresh_token` from `anon` and `authenticated`. **Only after proving** no browser code reads or writes them, e.g. connect/refresh flows (SQ-E3). Server code uses the service role and is unaffected. Checker + rollback scripts and a runbook (user applies to PROD by hand, as for 20261018). Includes a probe: signed in as an owner, reading the token column fails with 42501 | DE-0a, SQ-E3 inventory | 🟡 ~1 d |
| **DE-1 — Make the current export honest** | Explicit column lists on the 7 `*` reads (FU-P1). Audit filter `timestamp` → the real column (FU-1), BD-26 unchanged. Production 500 without `error.message` (FU-P2). Typed payload (rule 6). A **section model** (id, group, GDPR role, columns, row source), so DE-3…DE-7 only add sections. Locate the CRM / money per-screen CSVs (§1.4) | Refactor branch merged ❓ | 🟢 ~1 d |
| **DE-2 — Export classification + CI check + skills rule** | Every registered table carries `include` (section + explicit columns), `exclude` (reason), or temporary `planned` (slice id). The existing migration-reading test fails on an unclassified table: inside the existing Jest gate, **no added CI time**. Skill rule in `new-repository`, `new-api-route`, `new-plugin` (Appendix A). **Location of the classification is SA's ruling** (SQ-E1) | DE-1 | 🟡 ~1–1.5 d |
| **DE-3 — Account, plan, billing, credits** | Groups A1 + A2 | DE-2 | 🟡 ~1.5 d |
| **DE-4 — Clients & scheduling** | Groups B1 + B2 (records; files in DE-8) | DE-2 | 🟡 ~1.5 d |
| **DE-5 — Money** | Group B3, with the ledger export's conventions | DE-2 | 🟡 ~1.5 d |
| **DE-6 — Intake, leads, email & consent** | Group B4 | DE-2 | 🟡 ~1.5 d |
| **DE-7 — Content & insight activity** | Groups C + D. Closes all `planned` entries | DE-2 | 🟡 ~1.5 d |
| **DE-8 — Format, size & files** | Format per DX-3 (recommended: zip of one CSV per section, plus `data.json`, a README and the files) and the large-account path per DX-4: a background job builds the file into a private bucket, then a short-lived signed link. Contact documents and images included. `durable-queue-drain` skill if queued. May split into 8a (sync zip) / 8b (async + files) | DE-3…DE-7 | 🔴 ~3 d |
| **DE-9 — One export entry point** | One "Download my data" control with a "what's included" list, in Settings and the Danger zone (DX-5). "Last exported on …" from the `DATA_EXPORTED` audit row | DE-8 | 🟢 ~0.5–1 d |
| **DE-10 — Export before delete** | Customer: the purge slice-5 flow starts with the export step (DX-6). Admin: the admin delete preview gains "last export: date / never" and an action "send this account its export" (delivered only to the account's own email). **Retrofitted onto the already-shipped admin delete**, given the order in §0 | DE-8/DE-9; purge slice 5; AD-1/AD-2 | 🟡 ~1–1.5 d |

**Order:** DE-0a + DE-0b as soon as the user allows (recommended now). After admin delete: DE-1 → DE-2 → DE-3…DE-7 (any order; DE-3 and DE-4 first, as they matter most to an owner leaving) → DE-8 → DE-9 → DE-10.

---

## 6. Functional requirements

### 6.1 Access and safety (all slices)

1. **FR-E1** The export is produced **only on the server**, for the authenticated owner. The user id comes from `getUser()`, never from the request. No `'use client'` file reads any table for export (DE-0a).
2. **FR-E2** Every export read uses an **explicit column list**. `select('*')` is forbidden in export reads (guard).
3. **FR-E3** **No token, secret, key or credential column is ever selected.** A column the registry marks `secret` cannot appear in any export column list (guard).
4. **FR-E4** The browser roles (`anon`, `authenticated`) hold no privilege on OAuth token columns (DE-0b).
5. **FR-E5** BD-26 stays in force: owner-hidden audit types and AI-action events are never exported. Admin actor ids and internal reasons on grants are not exported (DX-9).
6. **FR-E6** Our AI provider cost is never exported. Stripe ids **are** exported 🧠.
7. **FR-E7** All reads go through `lib/repositories/` (rule 1), keyed on the owner's id (rule 4). Service-role use is documented at each call site.

### 6.2 Content

8. **FR-E8** The file is organised by the §3.1 groups. Each group carries its GDPR role and a plain-language description. A README states what each section is, who the controller is, what was left out and why (§3.2 in plain words), the export time in UTC and the owner's timezone (`user_preferences.timezone`).
9. **FR-E9** Timestamps are ISO 8601 UTC. Amounts are bare numbers with an ISO 4217 currency column. Totals are per currency, **never summed across currencies**.
10. **FR-E10** Soft-deleted rows: included or not per section, stated in the README (SQ-E5).
11. **FR-E11** The 2025 windows and caps (90 days, 12 months, 1,000/5,000/10,000) are removed or justified per section. A remaining cap is stated in the file (DX-8).
12. **FR-E12** A section that fails to read is **marked as failed in the file**, not silently emptied. The response is still 200 if the account group was read.

### 6.3 Delivery

13. **FR-E13** Format per DX-3, delivery per DX-4. If a link is used, it is a private bucket, a signed URL valid ≤ 24 h, owner-only, and the file is deleted after expiry.
14. **FR-E14** One export control in the UI (DX-5). Settings, the Danger zone, `SecurityTab` and `SecurityTabV2` all use it.
15. **FR-E15** Every export writes a `DATA_EXPORTED` audit row, non-blocking, with section counts and never contents. An admin-triggered send (DE-10) also writes an `operator`-class row.
16. **FR-E16** Rate limit: one export in progress per account, plus a cool-down (SQ-E8).

### 6.4 Classification and enforcement (DE-2)

17. **FR-E17** Every table in `BUSINESS_OWNED_TABLES` and `USER_OWNED_TABLES` (and every table the purge descriptors classify) has exactly one export classification: `include` (section + explicit columns), `exclude` (reason required), or `planned` (slice id, allowed only until DE-7).
18. **FR-E18** CI fails when a migration creates a table with `user_id` that has no export classification. This extends the existing migration-reading test: no new job, no DB in CI, no added critical-path time.
19. **FR-E19** Column drift: a live column on an `include` table that is in neither its column list nor its `excludedColumns` (with a reason) is **reported** by the live check (`SchemaReconciler` / `schema:check`), run pre-merge by Dev and SA. It never fails the export at runtime (SQ-E1).
20. **FR-E20** The skill rule (Appendix A) is added to the three skills.
21. **FR-E21** **One source of classification.** No fourth independent table list. SA rules where it lives and how `accountDeletionPolicy.ts` relates (SQ-E1).

### 6.5 Export before delete (DE-10)

22. **FR-E22** Customer delete (purge slice 5): the first step offers the export. The owner downloads it or ticks "I don't want a copy" before reaching the preview (DX-6).
23. **FR-E23** Admin delete: the preview shows the last export date (or "never"), plus an action that sends the export to the account's **own** email only. It is not blocking unless DX-6 says so.
24. **FR-E24** The purge 7-day forensic snapshot is **not** an export and is never offered to the customer.

---

## 7. Non-functional requirements

- **Security:** owner-only and server-only. No tokens or secrets. `Cache-Control: no-store`. Signed links are short-lived and single-account. Logs carry no file contents and no client PII, only ids and counts. Use the `tenant-isolation-guard` skill for the admin send path (target from the path, delivery to the target's own email).
- **CSV injection:** cells beginning `=`, `+`, `-`, `@`, tab or CR are neutralised in CSV/xlsx output.
- **Performance:** a typical account completes synchronously. Large accounts take the DX-4 path. Serverless size and duration limits go to SA (SQ-E4).
- **Logging:** Pino `createLogger`, `correlationId`, `{ err }`. No `console.*` in touched files.
- **Accessibility:** the control and the "preparing" state are keyboard-operable and announced, not shown by colour alone.
- **i18n:** button and README copy through `LanguageContext` (Hebrew, English). Column names stay English.
- **CI:** no added critical-path time. New checks are Jest inside existing jobs.
- **Verification:** every column is verified against the live schema (`npm run schema:check`) in the slice that adds it, and recorded in the workplan.

---

## 8. Acceptance criteria

**DE-0a**
- [ ] AC-E1 None of the three settings surfaces sends a browser request to `profiles`, `user_preferences`, `plugin_connections` or `notification_settings` for export. Each export button downloads `GET /api/user/data-export`.
- [ ] AC-E2 A Jest guard fails if any `'use client'` file calls `.from('plugin_connections')` (negative control included).
- [ ] AC-E3 The downloaded file contains no `access_token`, `refresh_token` or other credential key (test account with a connected plugin).

**DE-0b**
- [ ] AC-E4 After the migration, `column_privileges` shows no SELECT / INSERT / UPDATE / REFERENCES for `anon` or `authenticated` on the two token columns. Signed in as an owner, reading `access_token` fails (42501).
- [ ] AC-E5 Connecting a plugin, refreshing a token and every browser feature that lists connections still work (QA manual check, named flows from the SQ-E3 inventory).
- [ ] AC-E6 The rollback script restores the previous privileges exactly, and the checker reports both states.

**DE-1**
- [ ] AC-E7 No export read uses `*` (guard). The audit section contains the owner's visible rows and none of the BD-26 hidden types (fixture with one of each).
- [ ] AC-E8 A forced 500 in production mode returns no internal detail.
- [ ] AC-E9 A section whose read fails is marked failed in the file, and the response is still 200.

**DE-2**
- [ ] AC-E10 A migration creating a `user_id` table with no export classification fails the Jest gate; removing it passes. An `exclude` with no reason fails.
- [ ] AC-E11 Export classification and the ownership / purge classification are one source (per SQ-E1), and a test proves they cannot disagree.
- [ ] AC-E12 The three skills contain the Appendix A rule.
- [ ] AC-E13 The CI critical path is not longer (measured on the PR run).

**DE-3 … DE-7**
- [ ] AC-E14 For a seeded business with a row in every `include` table, every section is present with the expected count and only its listed columns.
- [ ] AC-E15 A second business's rows never appear (two-tenant fixture).
- [ ] AC-E16 No provider cost, token, secret or BD-26 row appears (negative fixtures).
- [ ] AC-E17 Money sections: refunds negative, currency on every amount, no cross-currency total.
- [ ] AC-E18 After DE-7, no `planned` classification remains.

**DE-8 … DE-10**
- [ ] AC-E19 The output opens in a spreadsheet, and the JSON parses. A cell starting with `=` is neutralised.
- [ ] AC-E20 An account above the threshold gets the DX-4 path. The link works for the owner only, and expires.
- [ ] AC-E21 Files in the zip match that account's storage objects (count and size).
- [ ] AC-E22 One export control. "Last exported" shows the latest `DATA_EXPORTED` date.
- [ ] AC-E23 The customer delete flow cannot reach the preview without an export or an explicit decline. The admin preview shows last export. The admin send goes only to the target's own email and writes an `operator` audit row.

**All slices:** route integration tests for happy path + 401 + invalid input where there is input. QA records a manual download check on a real test account.

---

## 9. Decisions and open questions

### 9.1 Business questions (for the user, via TL)

| # | Question | BA recommendation |
|---|---|---|
| **DX-1** | **What goes in?** (a) account (profile, plan, billing, credits used and added); (b) business records about clients; (c) content (website, images, documents); (d) activity (assistant chats, briefings, insights) | **All four.** (c) includes the actual **files**, not just names. (d) leaves out caches and counters |
| **DX-2** | **One download, or pick sections?** | **One download of everything**, organised into labelled sections. The accountant already has the ledger export |
| **DX-3** | **Format: one JSON file, or a zip of spreadsheets?** | **A zip:** one CSV per section (opens in Excel/Sheets, imports into another CRM), a `data.json`, a plain-language README, and the files. JSON keeps working until DE-8 |
| **DX-4** | **Large accounts: limits, or "we'll prepare it and send a link"?** | **Prepare and link.** Small accounts download at once. Large ones are built in the background, shown as "ready" in Settings and emailed as a link valid 24 h. Never a silently truncated export |
| **DX-5** | **Merge the buttons into one?** | **Yes.** One "Download my data" control in Settings and the Danger zone. The old settings pages link to the same thing |
| **DX-6** | **Export before delete: offer or require?** | **Customer:** the export is step 1; download or tick "I don't want a copy" to continue. **Admin:** show "last export"; the admin can send it to the owner's own email; not blocking, because an erasure request must be answerable even if the owner never downloads |
| **DX-7** | **Who may see the client data in the file?** | Only the owner. An admin can trigger delivery but **never** downloads another account's export |
| **DX-8** | **History depth: keep the 90-day / 12-month windows?** | **Everything we still hold**, with DX-4 handling size |
| **DX-9** | **Extra credits from an admin: show the admin's internal reason?** | **No.** Amount, date and "added by AgentsPilot" / "purchased". No admin identity or note (BD-26) |
| **DX-10** | **Name in the file** ("NeuronForge" in the filename and controller field) | Use the name customers know (user to choose). Controller stated per group: us for the account, the business for its client records |
| **DX-11** | **Does the security fix (DE-0) jump the queue?** Today any signed-in browser can read and write its own Google/plugin tokens, and three Export buttons write them into a downloaded file | **Yes, now.** DE-0a is about half a day and closes the file leak. DE-0b (revoke browser access to the token columns) follows once SA confirms nothing in the browser needs it. Neither depends on the export feature **➜ Decided by user 2026-10-05: NO — DE-0 runs LAST together with the export, after the admin delete. Tokens stay browser-readable until then (risk accepted by the user).** |
| **DX-12** | **Admin delete ships before the export (your order).** Until DE-3/DE-4, a deleted owner can take away only the old agent-platform file, not their clients, bookings or invoices. Accept? | **Accept the order, with one guard:** do not use admin delete on a **real** customer with business data until at least DE-3 + DE-4 have shipped, or until the admin has sent the customer the relevant per-screen exports (ledger, contacts) by hand. Test accounts are unaffected (admin delete already recommends test accounts only until AD-3) |

### 9.2 Technical questions for SA

- [ ] **SQ-E1** Where does export classification live: (i) an export map in `businessOwnedTables.ts` keyed by both lists (like `accountDeletionPolicy`), or (ii) an `export` field on the purge `descriptors.ts`, which the `SchemaReconciler` already checks against live columns (making FR-E19 almost free)? BA leans to (ii), or (i) **derived** from one source, given SA-1's "two registries" finding. How is column drift checked with no DB in CI? (raised by: BA | status: open)
- [ ] **SQ-E2** DE-0a UX: with a plain `<a href>` there is no success/error promise. Use `fetch` + blob from the server route (keeps the toasts, still no DB in the browser), or drop the toasts? BA leans to `fetch` + blob. (raised by: BA | status: open)
- [ ] **SQ-E3** DE-0b: inventory every browser read and write of `plugin_connections` (connect, OAuth callback, token refresh, connection lists, plugin tester) and confirm none touches the token columns, or move them server-side first. Also: should `anon`'s table-level privileges on `plugin_connections` go entirely? Should the 27 refresh tokens be rotated? BA's view is no forced rotation without evidence of misuse, since exposure was to each owner's own browser, but SA rules. Column-level REVOKE with table-level grants in place has a known Postgres subtlety: a table-level SELECT grant still covers every column. The migration may need to revoke at table level and re-grant the other columns. (raised by: BA | status: open)
- [ ] **SQ-E4** Serverless limits on our Vercel plan: maximum synchronous response size and duration, streaming vs buffered, and the background threshold. Does a zip need a new dependency (rule 7), or is the existing xlsx writer enough? (raised by: BA | status: open)
- [ ] **SQ-E5** Soft-deleted rows per section (the `agents` "includes deleted" precedent). (raised by: BA | status: open)
- [ ] **SQ-E6** Reuse of `lib/payments/ledgerService`: include its workbook as an extra file, or only follow its conventions? (raised by: BA | status: open)
- [ ] **SQ-E7** Classify the borderline tables: `website_page_views` (visitor IP or user agent?), `derived_metrics`, `daily_briefing_sends`, `external_calendar_events`, `business_events`, and where `email_sends` bodies are stored. (raised by: BA | status: open)
- [ ] **SQ-E8** DE-8 background job (queue + drain per `durable-queue-drain`, or on-demand), private bucket, link TTL, cleanup, and the rate-limit mechanism. (raised by: BA | status: open)
- [ ] **SQ-E9** Admin send-export (DE-10): route under the `/api/admin/users/[id]/…` family. Does it fit SA-3's admin-target exception? (raised by: BA | status: open)
- [x] **SQ-E10** Merge state of `refactor/data-export-repositories` and of AD-1a's `SchemaReconciler`. DE-1 and DE-2 build on both. (raised by: BA | status: answered 2026-10-05 by coordinator — both are on main: `refactor/data-export-repositories` (38f527f0) and AD-1a PR #216. **Also merged today: PR #218 `fix(export): include audit history and plugin connections, explicit columns, no raw error (FU-1, FU-P1, FU-P2)`.** This discovery was read from an older worktree, so §1 and DE-1 must be re-baselined against main before the work starts — parts of DE-1 are likely already done.)

---

## 10. Out of scope / future roadmap

- **Per-contact export** ("everything about this one client"), the precise tool for a client's request to the business.
- Import from another tool (the reverse of portability).
- Scheduled or periodic exports and backups.
- Agent-platform tables beyond today's sections (logs, calibration, memories): classified in DE-2 with a reason, not built here.
- Changing what the purge deletes or keeps, and the customer delete itself (purge slice 5).
- Replacing the temporary erasure contact address (N2).

---

## 11. Notes on integration points

| System | Impact |
|---|---|
| `app/api/user/data-export/route.ts` + `__tests__` (characterization pin) | Extended slice by slice. The pin is updated deliberately in DE-1 |
| `lib/repositories/*` (`...ForUserDataExport`, `PluginConnectionRepository`, `CreditTransactionRepository`, `AuditTrailRepository.listOwnerEntriesForExport`) + `lib/repositories/__tests__/userDataExportReads.test.ts` | New export reads per section, explicit columns |
| `app/business-os/settings/page.tsx`, `components/settings/SecurityTab.tsx`, `components/v2/settings/SecurityTabV2.tsx` | DE-0a: client-side export removed |
| `public.plugin_connections` privileges; every browser reader/writer of it | DE-0b: column privilege migration, checker, rollback, runbook |
| `components/business-os/purge/DangerZonePanel.tsx` | DE-9 shared control; DE-10 export step |
| `lib/business-os/businessOwnedTables.ts` + test, `lib/business-os/purge/descriptors.ts`, `SchemaReconciler`, `lib/business-os/account/accountDeletionPolicy.ts` | DE-2 classification (SQ-E1) |
| `lib/audit/ownerVisibility.ts`, `ownerAuditReads.guard.test.ts` | BD-26 exclusions stay green |
| `lib/payments/ledgerExport.ts`, `ledgerService`, `/api/payments/ledger/export` | DE-5 conventions, possible reuse |
| Supabase Storage (contact documents, user media, website assets) | DE-8 files; private export bucket |
| `AuditTrailService` / `AUDIT_EVENTS.DATA_EXPORTED` | Every export; "last exported" |
| Admin delete (AD-1…AD-4) and purge slice 5 | DE-10, retrofitted after admin delete ships |
| `.claude/skills/new-repository`, `new-api-route`, `new-plugin` | DE-2 skill rule |
| CI Jest gate | New guards inside existing jobs |

---

## Appendix A: proposed skill rule text

To be added by Dev in DE-2, with the same wording in `.claude/skills/new-repository`, `new-api-route` and `new-plugin`:

> **Data export classification (mandatory).** If your change adds a table, or adds a column to a table, that stores customer or business data, classify it for the "export my data" file in the same PR ([BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md) §6.4). Either **include** it with an explicit column list (never `*`), or **exclude** it with a written reason (secret, cache, platform-only, our cost…). Token, secret and key columns are always excluded and must never be granted to `anon` / `authenticated`. An unclassified new table fails CI. A new column on an included table goes into its list or its excluded columns, with a reason. Verify column names against the live schema (`npm run schema:check`).

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-05 | Created (BA, draft) | As-built discovery: the export (Nov 2025, agent platform) holds none of the Business OS data; three client-side buttons read `plugin_connections *`; the Danger zone links to the server export; the ledger export is reusable for conventions; three overlapping table registries. GDPR controller / processor split. Groups A–E and the never-export list. Slices DE-0 to DE-10, FR-E1…E24, AC-E1…E23, business questions DX-1…DX-12, SA questions SQ-E1…SQ-E10, skill rule text. `DATA_EXPORT_FOLLOWUPS_WORKPLAN.md` not found locally; its two user decisions taken from the brief |
| 2026-10-05 | Live token finding + sequencing (coordinator input) | User's live check recorded ✅: `anon` and `authenticated` hold SELECT/INSERT/UPDATE/REFERENCES on `plugin_connections.access_token` / `refresh_token`; RLS on (owner-only); 27 refresh tokens. DE-0 split into 0a (buttons through the server) and 0b (revoke browser privileges, SA to rule), and marked independent of the feature. User decision: the export feature runs **last, after admin delete AD-2…AD-4**. DE-0 queue position pending (DX-11). Added DX-12 (admin delete before export) |
| 2026-10-05 | DX-11 decided; parked; SQ-E10 answered | User: DE-0 does **not** jump the queue — the whole scope incl. the token fix runs last, after AD-2…AD-4 (risk accepted). SQ-E10: the repository refactor and AD-1a are on main; PR #218 (FU-1, FU-P1, FU-P2) also merged today, so the as-built discovery must be re-baselined before DE-1 |
| 2026-10-06 | `business_addresses` added to A1 | New business-owned table from PR #229 (the address book behind `business_profiles.address_parts` / `invoice_address`). Registered alongside its purge descriptor |
| 2026-10-13 | SA ruling on DE-0 (§0.1) | Re-baselined §1.1 against origin/main `9de8c60b`: FU-P1/FU-P2 fixed, plugin read is 13 explicit columns, no tokens. Inventory of every non-service-role `plugin_connections` access (11 browser files, 4 `authenticated` server paths; `PluginCoordinator` reads and refreshes tokens as `authenticated`). SQ-E2 answered (shared fetch + blob helper). SQ-E3 answered (table-level revoke + column re-grant, no `anon` grant, no forced rotation). Migration 20261059, pre-check / checker / rollback scripts, Jest guard. Two PRs, 0a first |
