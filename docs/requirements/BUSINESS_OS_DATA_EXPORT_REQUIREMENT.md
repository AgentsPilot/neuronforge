# Requirement: Business OS — Export My Data

> **Last Updated**: 2026-10-17

**Created by:** BA
**Date:** 2026-10-05
**Status:** Draft, **PARKED until the admin delete (AD-2, AD-3, AD-4) is finished** — the whole export scope, **including DE-0 (token exposure)**, runs LAST (user decisions 2026-10-05, DX-11 = no). Open business questions DX-1 to DX-10 and DX-12 are asked when the work resumes, then SA review (§9.2). **Re-baseline §1 against main first** (PR #218 merged 2026-10-05; see SQ-E10).
**Status update (2026-10-14):** the user decided DX-1 to DX-9 (see [§0.2](#02-user-decisions-2026-10-14)). Where §0.2 differs from the BA recommendations in §9.1 or from §3 / §5 / §6 / §8, **§0.2 wins**. DX-10 and DX-12 stay open.
**Status update (2026-10-15):** **DE-0 is complete** (DE-0a + DE-0b shipped; the user waived DE-0b's B-9 manual checks on 2026-10-14, see §0.1.4). **DE-1 is code complete**, uncommitted, on `feature/data-export-de1`, awaiting SA code review (see [§0.5](#05-de-1-status-and-notes-for-later-slices-2026-10-15)).
**Status update (2026-10-15, DE-4):** **DE-4 (clients and scheduling) is code complete**, uncommitted, on `feature/data-export-de4`, awaiting SA code review (see [§0.7](#07-de-4-status-user-decisions-and-notes-for-de-8b-2026-10-15)). **The owner's synced outside calendar (`external_calendar_events`) is now OUT** (user BC-5, 2026-10-15): this supersedes §0.3.1 SQ-E7, the §3.1 B2 row and the §9.2 SQ-E7 default, each of which carries a note.

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
| **DE-2 — classification, CI check, skill rule** | Code complete, uncommitted (2026-10-15), see §0.6. **§0.3.6 tsc clause superseded by SA DE-2 review: T-1 Jest runtime check is the enforcement.** Drift command is `npm run schema:reconcile` (SA-Q4). BC-1 = BC-2 = No (user, 2026-10-15) |
| **Phase 1 (2026-10-17)** | **Every Phase 1 slice is built; DE-10a, the last one, is code complete (§0.15).** Phase 1 is complete once DE-8b T-14 is recorded, DE-9 (#454) merges, and DE-10a passes SA, QA and its merge. Then the user decides Phase 2 (§0.4.1 F) |

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
**DE-0b shipped — 2026-10-14.** PR #381 merged (`02b57468`) and deployed to Production. Pre-check matched the rollback (anon + authenticated held all 7 privileges; no PUBLIC grant; service_role full). Migration `20261068` applied to PROD 2026-10-14; post-condition passed; checker **VERDICT PASS 46/0**; probe as `authenticated`: safe columns read, `access_token` refused **42501**. Owed: B-9 manual click-through by the user.
**B-9 manual checks WAIVED by the user — 2026-10-14.** Every B-9 flow is an agent-platform flow (V2 OAuth connect, `/api/agent-stream` token refresh, `/settings` Plugins tab, agent sandbox plugin check, generate-agent), and that app is parked, so the user waived the click-through. The automated evidence stands (checker PASS 46/0, probe 42501). **DE-0 (DE-0a + DE-0b) is complete.**

- (N4) QA E1 is accepted: also setting `updated_at` on the refresh is correct housekeeping.
### 0.2 User decisions 2026-10-14

**Decided by the user on 2026-10-14.** These answer the business questions in §9.1. Where they differ from the BA recommendation there, or from §3 (scope), §5 (slices), §6 (FRs) or §8 (ACs), **this section wins**; those sections are not rewritten. The delivery design behind DX-4 and DE-8 is evaluated in [BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md).

| DX | Decision | Differs from BA recommendation? |
|---|---|---|
| **DX-1** — what goes in | **In:** (a) **profile details only** — **no** credits, and **no** billing, plan or payment-to-us data; (b) **client records** — contacts, notes, bookings, services, payments, invoices, ledger, intake; (c) **content, including the actual files** — website, images, documents. **Out:** (d) **activity** — assistant chats, briefings, insights, emails sent. **Open note (non-blocking; owner to check with the lawyer):** a formal GDPR access or erasure request may still require the excluded personal data (the owner's own billing, chats). | **Yes** — BA recommended all four groups, incl. plan, billing, credits and activity. Group A2 and the activity group in §3.1 are therefore out of the export |
| **DX-2** — one download or sections | **One download of everything.** | No |
| **DX-3** — format | **A zip:** one CSV per section, plus `data.json`, a plain-language README, and the files. | No |
| **DX-4** — large accounts / delivery | **One background export engine** for every export. **Quick exports:** a Download button appears on screen. **Big or slow exports:** the owner clicks Export and the screen says it will arrive by email. The email is **one email with one link** to the **in-app export page** (sign-in required); that page lists **all parts**, each with a **short-lived signed download link**. Ready exports are **kept 3 days**, then deleted; "prepare again" is one click. **Limit: 1 at a time, 3 per day** per account — exports started by an admin count too. **Split when large:** "Your records" + "Your files" (files in parts). Design: [async evaluation](/docs/requirements/BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md); applies to DE-8. | **Yes** — BA had a 24-hour link sent by email; the user chose an in-app page behind sign-in, 3-day retention, rate limits and a split |
| **DX-5** — one button | **One "Download my data" button**, in Business OS Settings and the Danger zone. The old settings pages point to it. | No |
| **DX-6** — export before delete | **Customer self-delete:** the export is **offered** (a link), **not required**. To delete, the customer **types an acknowledgement** that they have exported their data (or chosen not to) and understand the account will be erased with no recovery. **Admin delete:** the admin can **send** the export to the owner's email; **not blocking**. | **Yes** (customer side) — BA had the export as a required step 1 with an "I don't want a copy" tick; the user chose an offered link plus a typed acknowledgement |
| **DX-7** — who may download | **The owner AND admins** may download an account's export. **Every admin download is audited with the admin's identity.** | **Yes** — BA recommended owner only |
| **DX-8** — history depth | **Everything we hold.** No 90-day or 12-month windows. | No |
| **DX-9** — admin's reason on extra credits | **Moot** — credits are excluded from the export (DX-1). | n/a |

DX-10 (name in the file) and DX-12 (admin delete before export) are **not** decided by this round.

**DX-1 open lawyer note, extended 2026-10-15 (user, during DE-4):** the note now names **connected apps** (`plugin_connections`: which apps the owner connected, the account name and email on each) alongside **activity** and the owner's billing. Both are out of the export by user decision (connected apps: §0.7, 2026-10-15); a formal GDPR access or erasure request may still require them. Non-blocking; the owner checks with the lawyer.

### 0.3 SA ruling — delivery design, classification and slice plan (2026-10-14)

**Reviewed by SA — 2026-10-14, against origin/main `392a9b53`.** Status: ✅ **Requirement approved for slicing, with the rulings below.** Inputs: §0.2 (binding, not reopened) and the [async evaluation](/docs/requirements/BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md) (BA). This section answers SQ-A1…SQ-A6 and SQ-E1, SQ-E4…SQ-E9. Where it differs from §3, §5, §6, §8 or the evaluation, **this section wins** (§0.2 still wins over this section). Each slice still gets a Dev workplan and an SA workplan review. These rulings are the conditions for those workplans.

#### 0.3.1 What §0.2 means for scope (the rulings Dev builds to)

| Item | Ruling |
|---|---|
| **In: profile details** (DX-1a) | `profiles` (explicit columns), `user_preferences`, `notification_settings`, `business_profiles`, `business_addresses`, `plugin_connections` (the 13 metadata columns of §0.1.1, never a token). **Out:** `business_os_account_plans`, `business_os_billing_accounts`, every `business_os_credit_*` table, `business_os_invites`, `user_subscriptions`, `credit_transactions`. The whole of group A2 in §3.1 is `exclude`, reason "DX-1: billing and credits are not exported" |
| **In: client records** (DX-1b) | Groups B1, B2, B3 and B4 of §3.1, **except** `email_sends` (an email sent = activity, DX-1d). `email_campaigns`, `email_sequences`, `email_sequence_steps` (what the owner wrote) and `email_sequence_enrollments` (which client is in which sequence) stay **in**. The consent tables stay **in**: they are the owner's legal record of a client's consent |
| **In: content + files** (DX-1c) | `website_pages`, `website_content`, `smart_links`, `user_media`, `contact_documents` (metadata in records, the file in "Your files"). Note: `websites` and `insight_outcomes` do **not** exist live (`businessOwnedTables.test.ts` §8.9 exceptions); nothing to export |
| **Out: activity** (DX-1d) | Group D of §3.1 in full, plus `onboarding_conversations` (assistant chat), `email_sends`, `website_page_views` and `smart_link_clicks` (visitor tracking; also closes SQ-E7 for them), and `audit_trail` (the owner's activity history). Today's file carries `audit_logs` and `agent_executions`: both leave in DE-1 |
| **Agent-platform section** | Today's file carries agents and runs. Under DX-1, runs are activity (out), Pilot-Credit tables are billing (out). `agents` + `agent_configurations` are the owner's own content: **SA default = keep them** (no regression for agent-platform users). **Business question BQ-SA-1** (§0.3.8) confirms |
| **SQ-E5 soft-deleted rows** | Excluded everywhere, stated in the README. Exception: none. (The 2025 "agents incl. deleted" precedent is dropped: a deleted agent is not "data we hold" from the owner's view, and the purge does not keep them either) |
| **SQ-E6 ledger** | Follow `ledgerService` **conventions only** (refunds as their own dated negative rows, currency on every amount, per-currency totals). Do **not** add the accountant workbook as a second file: two money views of the same rows can disagree, and the owner already has the ledger export |
| **SQ-E7 borderline** | `website_page_views` out (above). `derived_metrics`, `daily_briefing_sends`, `business_events` out (derived / activity). `external_calendar_events` **in** (the owner's own calendar as we hold it, scheduling group). `email_sends` bodies: out with the table |
| **FR-E12 failed section** | Kept: a section that fails is written to the README and `data.json` as `failed`, never silently empty. The job still finishes, and the page shows "complete with N sections missing" |

> **Superseded in part (user BC-5, 2026-10-15, DE-4):** the SQ-E7 row above says `external_calendar_events` is **in**. It is now **out**: `exclude`, reason "user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data". The owner's real calendar stays with Google / Outlook. B2 is in without it. See [§0.7](#07-de-4-status-user-decisions-and-notes-for-de-8b-2026-10-15).

#### 0.3.2 Delivery engine — SQ-A1 … SQ-A5 (and SQ-E4, SQ-E8)

| # | Ruling | Why |
|---|---|---|
| **SQ-A1 Plan / limits / streaming** | We are on **Vercel Pro**: `vercel.json` runs 3 crons every 5 minutes, which Hobby refuses. **No zip is ever streamed out of a function.** Every download, quick or big, is a Supabase Storage **signed URL** minted by an authenticated route. The 4.5 MB response limit and the "streaming under Fluid" question therefore do not apply, and no `maxDuration` above **300** is used. The repo's ceiling today is 300; 800 is not needed and is not relied on | One delivery path. A 300 s ceiling plus resumable parts is enough, and leaves room if the plan changes |
| **SQ-A2 Starting at once** | **No QStash.** It is a dependency only for the legacy agent queue (`lib/queues/qstashQueue.ts`, `/api/cron/process-queue`). Bringing it into Business OS adds a public signed worker endpoint and two secrets to a third path; that is a new pattern for no gain. Instead: **(1)** the start route enqueues, then runs the drain **in-process for this job only**, with a **25 s budget** (route `maxDuration = 60`). This is the same shape as the admin "Drain now" route (`runQueueDrain`, awaited). **(2)** A dedicated cron `/api/cron/data-export-drain` runs **every minute**, as the backstop and for big exports (`maxDuration = 300`, work budget 240 s). The fail-closed `CRON_SECRET` auth follows `durable-queue-drain` Step 8. An empty queue costs one claim RPC a minute | Reuses the §8.1 claim pattern, crons and the in-process drain shape. No size guess: **"quick" = finished inside the start request** |
| **SQ-A3 Resumable parts** | Table `business_os_data_exports` (one row per job) + `business_os_data_export_parts` (one row per part). **The part is the unit of claim, lease and retry.** Planning (first claim) writes a **frozen manifest**: one `records` part, then `files` parts. Each file part is a list of storage paths bounded at **≤ 200 MB of input and ≤ 500 objects**. Every part is its **own zip object**, so there is **no assemble step**. This is exactly the §0.2 split: "Your records" + "Your files (part 1 of N)". Lease **360 s** (> the 300 s `maxDuration`, per the skill). Up to **5 attempts with backoff**, then `failed`. A job is `ready` when every part is `done`, and `failed` when any part dead-letters. "Prepare again" makes a new job | A killed run loses one part at most. A finished part is never redone (terminal status on the part row = idempotency) |
| **SQ-A4 Zip library** | **`fflate`** as a new **direct** dependency, pinned to the version already in the tree (**0.8.x**: it is already installed as a transitive dependency of `xlsx`, `jspdf` and `pdfkit`). MIT, zero dependencies, TypeScript types included. **Store** (no compression) for files, which are mostly already compressed; deflate for CSV/JSON. Rejected: `archiver` (pulls in a dependency tree, stream API aimed at fs); `jszip` (in-memory only, slower; also only transitive). **Build each part in memory** (≤ 200 MB of input, against about 2 GB of function memory) and upload it with the normal Storage upload. No streaming upload and no TUS client (which would be another new dependency). The part cap is what bounds memory, not streaming. This is a rule-7 approval for `fflate` only | The smallest change: no new code enters the install, and memory is bounded by design |
| **SQ-A4 Bucket** | A new **private** bucket `business-data-exports`, created in the DE-8a migration (`public = false`, `file_size_limit` 250 MB, mime `application/zip`). **No storage policy for `anon` or `authenticated` on any verb**, the same control and the same `pg_policies` assertion as `business-purge-snapshots` (20260916a). Path `{user_id}/{job_id}/{part_no}.zip`. **Owed check (user, read-only, before DE-8a):** the project's global upload limit must be ≥ 250 MB (Dashboard → Storage → Settings). The snapshot bucket's 500 MB suggests it is raised, but this is not verified | Files leave only through a signed URL that a route mints |
| **SQ-A5 Consistency** | **"As of the start time, best effort"** is accepted and stated in the README. Each section is read once, ordered by primary key and paged. Rows that change while the job runs may or may not appear. The **file manifest is frozen at planning**: a file deleted before its part runs is listed in the README as "removed before export", not an error | Snapshot isolation across HTTP reads is not available, and building it would be out of proportion |
| **SQ-E8 Rate limit** | **One in progress:** a partial unique index on `(user_id) WHERE status IN ('queued','running')`. **3 per day:** counted from job rows created in the last rolling 24 h, checked **inside the enqueue RPC** (`SECURITY DEFINER`, REVOKEd from `anon`/`authenticated`, granted to `service_role`), so two clicks cannot both pass. Admin-started jobs count (§0.2). A refusal returns 409 with the time the next export is allowed. An admin refused by the limit can still download an existing ready export (§0.3.4) | Enforced in the database, at the choke point (skill Step 6) |
| **Retention** | `expires_at = ready_at + 3 days`. The same cron's sweep step deletes expired objects and marks the job `expired`. **It also lists the bucket and removes any object older than 3 days that has no live job row.** This covers a hard-deleted auth user, whose job rows cascade away. So no export file can outlive 3 days by any path | One enforcer, shipped with the bucket (the SA-4 lesson from the snapshot bucket) |
| **Email** | **One** transactional email per job (`emailTransport`, `kind: 'transactional'`, `dedupe_key = data-export:{job_id}`), sent when a job becomes `ready` **after** its start request returned, and always for admin-started jobs. It goes to the **target account's own auth email**, never to an admin. The body has **one link to the in-app page** (`/business-os/settings/data-export`), no data, no signed URL. A job that **fails** after the start request returned also gets one email ("could not prepare, try again") | §0.2 DX-4. A forwarded email is useless without the owner's sign-in |
| **Downloads** | `GET /api/business-os/data-exports/[jobId]/parts/[partNo]/download`: signed-in owner, Zod on the path, the job is read **with `.eq('user_id', user.id)`** (a job id is not a capability), then a **signed URL with a 120 s TTL** is returned as JSON and the client navigates to it. A non-blocking `DATA_EXPORT_DOWNLOADED` row per download. `Cache-Control: no-store` | Signed URLs are only ever minted for an authenticated caller, one part at a time |
| **Audit** | New events next to `DATA_EXPORTED`: `DATA_EXPORT_REQUESTED` (actor: owner or admin), `DATA_EXPORT_READY` (section counts and bytes, never content), `DATA_EXPORT_FAILED`, `DATA_EXPORT_DOWNLOADED`, `DATA_EXPORT_EXPIRED`. "Last exported" (DE-9) reads the latest `READY` | FR-E15 |
| **Logs** | Ids, counts, bytes and durations only. No file names (they can be client names), no emails | §7 |
| **Admin queue page** | The new queue is registered on the existing Scheduled jobs & queues page (`DRAIN_QUEUE_IDS`, "Drain now") | Reuse |

#### 0.3.3 SQ-A6 — registration (lands in DE-8a, same PR as the tables)

| Registry | Entry |
|---|---|
| `USER_OWNED_TABLES` | both tables, reason: "an export request belongs to the person; it survives a Reset (an owner may export, then start over); Purge and account deletion remove it". Not business-owned: an agent-platform user with no `business_profiles` row can export too |
| Purge `descriptors.ts` | both tables, `level: 'purge'`, scope `user_id`, `snapshot: 'ids'` (the snapshot must not copy another copy of the business). Parts sit in the blocking/cascade band as the invariant test dictates. **New closed `PurgeArea` `'data_exports'`** (D-5 union) |
| `STORAGE_DESCRIPTORS` | `{ bucket: 'business-data-exports', level: 'purge', pathPrefix: '{user_id}/' }`. The admin delete commit already deletes every `reset`/`purge` bucket prefix, so **an admin delete removes the account's exports immediately** |
| Export classification (DE-2) | both tables and the bucket: `exclude`, reason "the export itself" |
| `accountDeletionPolicy.ts` | `delete` (only if purge slice 3 has not retired the file by then) |

#### 0.3.4 Admin path — SQ-E9, DX-7

- **Routes** (under the `/api/admin/users/[id]/…` family, which is already SA-3's admin-target exception; `tenant-isolation-guard`: the target comes **only** from the path):
  - `GET  /api/admin/users/[id]/data-exports`: status list (state, parts, sizes, dates, who started it, downloaded yes/no). No URLs.
  - `POST /api/admin/users/[id]/data-exports`: "send export to owner". Strict Zod body `{ reason }` (5–500 chars). Starts the **same** job with `requested_by = admin`. The target's limits apply. Delivery is the owner's email only (§0.3.2).
  - `POST /api/admin/users/[id]/data-exports/[jobId]/parts/[partNo]/download`: **POST, not GET**, so a link cannot trigger it and a prefetcher cannot either. Strict Zod body `{ reason }`.
- **Every admin route:** `requireAdmin` is the **first statement**. The path UUIDs go through Zod. The job is read with `.eq('user_id', <path id>)`, and a job of another account is a 404.
- **Admin download order (write-ahead):** `requireAdmin` → Zod → job/part belongs to the path id and is `done`, not expired → **a confirmed admin-owned row via `AuditTrailService.writeNow`** (`{ written }`, as AD-2a writes `BUSINESS_DELETION_STARTED`) `DATA_EXPORT_DOWNLOADED_BY_ADMIN` (`user_id = actor_id = admin`, `entity_type 'user'`, `entity_id = target`, details: job, part, reason; the AD-2a audit placement). If `written` is false, **refuse (503)**. A bulk-PII download without a record is not allowed, so this is the one place an audit failure blocks. Then mint a **60 s** signed URL and return it as JSON. Never by email, never a link that skips the admin's sign-in.
- **UI:** `/admin/users` drawer → a "Data export" card, and the delete preview (below). The Download button is behind a confirm dialog that takes the reason.

#### 0.3.5 Export before delete — the live admin delete and the customer delete

- **Admin delete (AD-2 preview / commit and the `/admin/users` hard delete):** the preview gains a **"Data export"** line: never / in progress / ready on <date> (downloaded by the owner: yes/no) / expired. It also offers "Send export to owner" and "Download (audited)". **Not blocking** (§0.2 DX-6). If an export exists that the owner has **not** downloaded, the preview shows: *"The owner has not downloaded the export sent on <date>. Deleting now deletes it, and the owner will not be able to sign in to fetch it. Download it now if you need to hand it over."* The commit then removes the bucket prefix through `STORAGE_DESCRIPTORS` (§0.3.3). For the hard delete of an auth user, the cascade removes the rows and the sweep removes the objects within 3 days (§0.3.2). DE-10a also makes the hard delete remove the prefix explicitly, through the same descriptor, if that path does not already run the purge engine's storage step (Dev verifies in the workplan). **So "send export" during a delete is useful only if the owner downloads before the admin commits. Otherwise the admin downloads it (audited) and hands it over.** This is how §0.2's "non-blocking" and "the owner signs in" both hold.
- **Customer self-delete:** purge slice 5 (the customer delete) is not built. The Danger zone's erasure path today is a mailto. **DE-10b rides with purge slice 5:** its first step shows the "Download my data" link (offered, not required). Its confirmation is the **typed acknowledgement** (§0.2 DX-6), which reuses the comparison rule of `confirmation.ts` (server-side phrase, fails closed); the phrase text is UI copy for purge slice 5. Until then, DE-9 puts the one button into the Danger zone.

#### 0.3.6 DE-2 classification — SQ-E1 answered: an `export` field on the purge descriptors

- **Where:** `PurgeDescriptor` and `StorageDescriptor` gain a **required** `export` field:
  `{ kind: 'include'; section: ExportSectionId; columns: readonly string[]; excludedColumns?: Readonly<Record<string, string>> }` | `{ kind: 'exclude'; reason: string }` | `{ kind: 'planned'; slice: 'DE-3' | … | 'DE-7' }`.
  A required field means a new descriptor without one **fails `tsc`**. That is the existing type-check job, so there is no added CI time. `accountDeletionPolicy.ts` is not touched (purge slice 3 owns its retirement). **No fourth list.**
- **Why descriptors and not `businessOwnedTables.ts`:** the descriptors are the only registry that covers **every** live tenant table, including `never` and `global` platform tables, and buckets. The `SchemaReconciler` already compares them with live columns, so FR-E19 comes almost free. Coverage measured today: all 61 business-owned tables have a descriptor (`websites` and `insight_outcomes` are not live; a reasoned exception already exists), and 45 of 46 user-owned tables do. **The one gap is `intent_examples`**: DE-2 adds a `level: 'never'` descriptor for it. That does not change what any delete removes; the invariant suite confirms it.
- **CI chain (all Jest/tsc in existing jobs, no added time):** the existing migration-reading test (`CREATE TABLE … user_id` → must be in one ownership list) → the existing list↔descriptor test → **new** `exportClassification.test.ts`: every descriptor has `export`; `exclude` has a non-empty reason; `include.columns` is non-empty, has no `*`, and is disjoint from a **global secret-column deny list** (`access_token`, `refresh_token`, `credentials`, `secret`, `api_key`, `*_key`, `cost_usd`-style provider cost, …); every `include` section id has a reader in the export section registry and vice versa; `planned` is allowed only until the DE-7 PR (the test carries a `PLANNED_ALLOWED = true` constant that DE-7 flips to `false`). Negative controls for each rule.
- **Purge stays blind to it:** a guard asserts that no file under `lib/business-os/purge/` other than `descriptors.ts` / `types.ts` reads `.export`. The executor must never branch on export.
- **Column drift (FR-E19), with no DB in CI:** `SchemaReconciler` gains a **report-only** `exportColumnDrift` list: a live column on an `include` table that is in neither `columns` nor `excludedColumns`. It is surfaced by `npm run schema:check` (and the admin reconciler output). It **never** blocks a delete and never fails an export. Dev and SA run it before each DE-3…DE-7 merge and record it in the workplan.
- **Readers:** the export section readers take their column lists **from the descriptor** (one source). A reader that selects a column not in `columns` fails a unit test.
- **Skill rule:** Appendix A goes into `new-repository`, `new-api-route` and `new-plugin`. Add one line to `durable-queue-drain`: "a new queue table is a tenant table: descriptor + export `exclude`". **Point at `descriptors.ts` as the place**, not at this requirement's §6.4.

#### 0.3.7 Numbered slice plan

Every slice is its own PR from main (no stacking). Nothing is committed before the user sees the diff. All new checks are Jest/tsc in existing jobs (no added CI time). Owner-facing switch-over happens in DE-9, behind the flag `isBusinessOsDataExportEnabled` (env, default off) until then. The old JSON route keeps working until DE-9.

| Slice | Delivers | Depends on | Size |
|---|---|---|---|
| **DE-0a** | Per §0.1 (built, QA ✅, awaiting the user's diff review) | — | 🟢 done |
| **DE-0b** | Per §0.1 (token column lockdown, migration 20261059) | DE-0a merged | 🟡 ~1 d |
| **DE-1 — Honest current export + section model** | Apply DX-1 to today's JSON: drop `subscriptions`, `transactions`, `agent_executions`, `audit_logs`. Typed payload (rule 6, no `any`). Section model `{ id, group, gdprRole, reader }` with the FR-E12 `failed` marker. `DATA_EXPORTED` via `logAndFlush` (the WC-7 note from §0.1). DX-10 filename/controller if decided, else unchanged. The Danger zone's plain `<a>` goes through the shared helper (QA E4). Characterization pin updated deliberately | DE-0a | 🟢 ~1 d |
| **DE-2 — Classification + CI + skill rule** | §0.3.6 in full. Every descriptor classified: today's sections `include`, §0.3.1 exclusions `exclude`, the rest `planned` with a slice id | DE-1 | 🟡 ~1.5 d |
| **DE-3 — Profile details** | The §0.3.1 DX-1a set (+ agents/configurations per BQ-SA-1) | DE-2 | 🟢 ~1 d |
| **DE-4 — Clients & scheduling** | B1 + B2 records (file **metadata** for `contact_documents`) | DE-2 | 🟡 ~1.5 d |
| **DE-5 — Money** | B3 with ledger conventions (SQ-E6); processors, methods and Connect: names / last 4 / ids / status only | DE-2 | 🟡 ~1.5 d |
| **DE-6 — Intake, leads & consent** | B4 minus `email_sends` | DE-2 | 🟢 ~1 d |
| **DE-7 — Content records** | Group C records + `user_media` metadata. Flips `PLANNED_ALLOWED` to false | DE-3…DE-6 | 🟢 ~1 d |
| **M-1 — Measurement (user, read-only, ~15 min)** | Largest account: rows per included table, and file count and bytes per bucket and owner (SQL below). Plus the global upload-limit check (§0.3.2). **Gates DE-8a's sizing and DE-8c's part cap** | — | user |
| **DE-8a — Engine foundation** | Migration: both tables, partial unique index, claim / reap / enqueue RPCs (`SECURITY DEFINER`, REVOKEd), private bucket + `pg_policies` assertion. Repository (`new-repository`), §0.3.3 registrations, audit event names, `fflate` dependency. Test: the claim prevents double-processing; the limit RPC refuses the 2nd concurrent job and the 4th in 24 h. User applies the migration by hand | DE-7, M-1 | 🟡 ~1.5 d |
| **DE-8b — Records zip end to end** | Planner + `records` part (CSV per section with CSV-injection neutralising, `data.json`, README in en/he); start route (inline 25 s), status route, owner download route; `data-export-drain` cron (1 min, sweep + reaper); jobs-queues page entry. Behind the flag | DE-8a | 🔴 ~2.5 d |
| **DE-9 — One button + export page** | `/business-os/settings/data-export` page (status, parts, Download, "prepare again", "last exported"); one "Download my data" control in Settings and the Danger zone; `SecurityTab` / `SecurityTabV2` / BOS settings point to it; the old GET route retired. Flag on after QA | DE-8b | 🟡 ~1.5 d |
| **DE-8c — Files + split** | File manifest from `STORAGE_DESCRIPTORS` `include` buckets under `{user_id}/`, `files` parts (≤ 200 MB / ≤ 500 objects, store mode), "removed before export" list, page shows "Your records" + "Your files (n of N)". AC-E21 count/bytes match | DE-9 | 🟡 ~2 d |
| **DE-8d — Email + failure notice** | §0.3.2 email (en/he, dedupe), sent only when not finished inline or admin-started; failed-job email | DE-8c | 🟢 ~1 d |
| **DE-10a — Admin: status, send, audited download** | §0.3.4 routes + drawer card + delete-preview line and warning (§0.3.5); the hard delete removes the prefix explicitly if needed. `requireAdmin` CI guard green | DE-8d | 🟡 ~1.5 d |
| **DE-10b — Customer delete: offered export + typed acknowledgement** | Inside purge slice 5, not before | purge slice 5 | 🟢 ~0.5 d (inside slice 5) |

**Order:** DE-0b → DE-1 → DE-2 → DE-3…DE-6 (any order, DE-4 first is most valuable) → DE-7 → M-1 (can run any time earlier) → DE-8a → DE-8b → DE-9 → DE-8c → DE-8d → DE-10a. About 19 working days in total, excluding DE-0 and DE-10b.

**M-1 SQL (user runs on PROD, read-only; it avoids the editor's "into" bug):**

**File:** `scripts/measure-data-export-size.sql` (Dev writes it in DE-8a's workplan from this text)

```sql
-- files per owner (top 10 by bytes)
SELECT bucket_id, (storage.foldername(name))[1] AS owner_id,
       count(*) AS files, pg_size_pretty(sum((metadata->>'size')::bigint)) AS bytes
FROM storage.objects
WHERE bucket_id IN ('contact-documents', 'website-images')
GROUP BY 1, 2 ORDER BY sum((metadata->>'size')::bigint) DESC NULLS LAST LIMIT 10;
-- largest owners by client-record volume
SELECT user_id, count(*) AS contacts FROM public.crm_contacts GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
SELECT user_id, count(*) AS activities FROM public.crm_activities GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
SELECT user_id, count(*) AS bookings FROM public.scheduling_bookings GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
SELECT user_id, count(*) AS payments FROM public.payment_transactions GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
-- whole-table sizes (upper bound for any one account)
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC LIMIT 25;
```

Not measured by SA in this review: the read-only DB tool was not available in the SA session. Slice sizes above assume the BA estimate (§1 of the evaluation). **If M-1 shows the largest account's records above ~100 MB of CSV, or one records pass above ~120 s**, DE-8b splits `records` into one part per section group (the same mechanism, ~+0.5 d).

#### 0.3.8 Open questions left

| # | Question | Kind | SA default if unanswered |
|---|---|---|---|
| **BQ-SA-1** | Today's file gives agent-platform users their **agents and agent settings**. §0.2 lists profile, client records and content, but does not mention agents. Keep agents + their settings in the file (runs, Pilot-Credit history and audit history leave per DX-1)? | Business | Keep them |
| **BQ-SA-2** | When an **admin** downloads an owner's export, should the **owner** be able to see that it happened (a line on their export page)? It is audited for us either way (DX-7) | Business | No (internal, as BD-26) |
| **DX-10** | Name in the file and in the controller field (still open) | Business | Unchanged until decided; DE-1 / DE-8b pick it up |
| **DX-12** | Superseded in practice: DE-10a gives the admin the export at delete time. TL may close it | — | — |
| SQ-E1, E4…E9, SQ-A1…A6 | Answered above | — | — |

### 0.4 User decisions 2026-10-14 (round 2)

**Decided by the user on 2026-10-14, after M-1.** These answer the §0.3.8 questions and change the delivery order. **Where they differ from §0.3, this section wins** (§0.2 still stands).

**M-1 result (prod, read-only, 2026-10-14):** 80 stored files across all accounts, ~28 MB in total; the largest account holds 27 files, ~14 MB; the largest single file is 4.7 MB. The busiest account has ~748 CRM activities, 77 bookings, 57 payments. Every export today is far below the §0.3 part cap (200 MB / 500 objects).

| # | Decision | Effect on §0.3 |
|---|---|---|
| **Delivery order** | **Incremental.** Phase 1 serves **small accounts**: one zip holding records **and** files, downloaded on screen. **Once Phase 1 is done, the user decides** the next steps for large accounts | SA re-cuts the §0.3 slice plan into Phase 1 (small) and Phase 2 (large, **not scheduled** until the user decides). Split delivery, the "ready" email and anything that exists only for big or slow exports move to Phase 2. Phase 1 must still fail safely (clear message, no partial file) on an account above its size limit |
| **BQ-SA-1** — agents | **Remove** agents and agent settings. **Business OS data only** | Overrides the SA default (keep). `agents` and `agent_configurations` are out with the rest of the agent-platform section; recorded reason "not Business OS data (user 2026-10-14)" in the classification |
| **BQ-SA-2** — owner sees admin download | **No.** Internal audit only | SA default confirmed |
| **DX-10** — name in the file | **The business's own name** in the file name (e.g. `<business>-data-export-<date>.zip`); the README names **AgentPilot** as the provider | SA rules the file-name rules (Hebrew and other non-Latin names, empty name, unsafe characters, fallback) and the controller wording per group |

DX-12 stays as in §0.3.8.

#### 0.4.1 SA ruling — Phase 1 re-cut (2026-10-14)

**Reviewed by SA — 2026-10-14.** Status: ✅ **Phase 1 approved for workplans, with the rulings below.** Inputs: §0.2 and §0.4 (binding, not reopened), §0.3 (SA's own earlier ruling) and the M-1 result. **Where this section differs from §0.3, this section wins for Phase 1.** Everything in §0.3 that is not named here as changed or moved still applies (classification, token safety, explicit columns, scope rulings §0.3.1, registrations §0.3.3, admin route rules §0.3.4). Each slice still gets a Dev workplan and an SA workplan review.

##### A. Does Phase 1 need the background engine? No. Does it need the bucket? Yes.

| Piece from §0.3.2 | Phase 1 ruling | Why |
|---|---|---|
| Background queue (parts table, claim / reap RPCs, leases, retries) | **Not built in Phase 1.** Moves to Phase 2 | M-1: the largest account is ~14 MB / 27 files, ~1,000 rows. One request builds that in seconds. A queue would exist only for accounts we do not have yet |
| Every-minute drain cron + in-process 25 s drain | **Not built.** Moves to Phase 2 | Nothing is queued in Phase 1, so there is nothing to drain |
| Streaming the zip out of the function | **Still forbidden** (SQ-A1 stands) | The response cap is 4.5 MB and the largest account is ~14 MB already. Every download is a signed URL |
| Private bucket `business-data-exports` | **Built in Phase 1**, exactly as §0.3.2 (private, no `anon` / `authenticated` policy on any verb, the `pg_policies` assertion, path `{user_id}/{job_id}/{part_no}.zip`). `file_size_limit` **50 MB** in Phase 1 (Phase 2 raises it) | It is the only way to hand a file over 4.5 MB to the browser without streaming. **Rejected:** reusing `business-purge-snapshots` (different purpose and retention; mixing them blurs both sweeps and registrations); zipping in the browser from per-file signed URLs (a second code path, `fflate` in the client bundle, and the admin path would need its own). 50 MB matches the Supabase default global upload limit, so **the §0.3.2 "owed check" on the global limit is not needed for Phase 1** (it moves to Phase 2) |
| Jobs table `business_os_data_exports` | **Built in Phase 1**, one row per export. Statuses `queued`, `running`, `ready`, `failed`, `expired` (Phase 1 never writes `queued`; it is in the check constraint now so Phase 2 does not have to alter it). Adds `failure_reason` (`over_ceiling` / `timeout` / `error`), `requested_by` (owner or admin id), `bytes`, `file_count`, `row_count`, `ready_at`, `expires_at`. Each export writes **one part, `part_no = 1`**, so the path and the download route already have the Phase 2 shape | The row is what the rate limit, the 3-day retention, "download again", the admin status line and "last exported" read. It is also the row Phase 2's parts table hangs off, so Phase 2 adds and does not rework |
| Parts table `business_os_data_export_parts` | **Phase 2** | One part per export in Phase 1 needs no row of its own |
| Zip library | **`fflate` approved as in §0.3.2** (rule 7, direct dependency, pinned 0.8.x). Build in memory; store for files, deflate for CSV / JSON | The Phase 1 ceiling (§C) bounds memory to well under 200 MB |
| Email | **Phase 2** (§0.4: the "ready" email moves) | In Phase 1 the owner is on the screen when the file is ready |

**How an export runs in Phase 1 (one request).** `POST /api/business-os/data-exports` (owner, `new-api-route`, `maxDuration = 60`): auth → Zod (empty strict body) → **start RPC** (rate limit, below) creates the job as `running` → **pre-flight ceiling check** (§C) → read the sections (column lists from the descriptors, §0.3.6) → read the files from the `include` buckets → build the zip → **check the finished size** → upload → mark `ready` → return `{ jobId, downloadUrl (signed, 120 s), expiresAt }` with `Cache-Control: no-store`. The client sends the browser to the URL. **Nothing is uploaded until the zip is complete, and no URL is minted until the upload succeeded**, so there is never a partial file. On any failure the job becomes `failed` with its reason, nothing is left in the bucket, the owner sees a clear message, and the log carries ids and counts only. "Download again" within 3 days: `GET /api/business-os/data-exports/[jobId]/parts/[partNo]/download` exactly as §0.3.2 (`.eq('user_id', user.id)`, 120 s URL, non-blocking `DATA_EXPORT_DOWNLOADED`). FR-E12 stays: a section that fails is marked `failed` in the README and `data.json`, never silently empty.

**Rate limit (1 at a time, 3 per day) lives in the start RPC**, in the DE-8a migration: `SECURITY DEFINER`, REVOKEd from `anon` / `authenticated`, granted to `service_role`. One at a time = the partial unique index on `(user_id) WHERE status IN ('queued','running')`. 3 per day = job rows created in the last rolling 24 h with status `running`, `ready` or `expired` (**a `failed` job does not count**: a failure is ours, not the owner's). Admin-prepared exports count against the target account (§0.2). **Stale run:** a function killed at 60 s leaves a `running` row; the RPC first marks any `running` row older than **90 s** as `failed` / `timeout`, so the owner is never locked out and no reaper cron is needed. A refusal returns 409 with the time the next export is allowed. `lib/security/rateLimit.ts` is a request throttle, not a durable daily quota, so it is not the place.

**Retention (3 days).** One **daily** cron, `/api/cron/data-export` (fail-closed `CRON_SECRET`, `durable-queue-drain` Step 8). Step 1, the sweep: delete objects of jobs past `expires_at` and mark them `expired`; list the bucket and delete any object older than 3 days without a live job row (a hard-deleted auth user). Step 2, the size watch (§C). Phase 2 adds its drain as a further step and moves the schedule to every minute: same route, no rework. A new export by the same owner also deletes that owner's earlier ready objects (a newer export replaces the old one).

##### B. Phase 1 slice table

Every slice is its own PR from main (no stacking). Nothing is committed before the user sees the diff. All new checks are Jest / tsc in existing jobs (no added CI time). The owner-facing switch stays behind `isBusinessOsDataExportEnabled` (env, default off) until DE-9.

| Slice | What | Depends on | Effort |
|---|---|---|---|
| **DE-0b** (prerequisite, unchanged) | Token column lockdown, §0.1 | DE-0a merged | 🟡 ~1 d |
| **DE-1 — Honest current export + section model** | As §0.3.7, **plus BQ-SA-1: `agents` and `agent_configurations` leave today's file** with the rest of the agent-platform section | DE-0a | 🟢 ~1 d |
| **DE-2 — Classification + CI + skill rule** | As §0.3.6. **`agents` and `agent_configurations` are classified `exclude`, reason "not Business OS data (user 2026-10-14)"**, not `planned` | DE-1 | 🟡 ~1.5 d |
| **DE-3 — Profile details** | The §0.3.1 DX-1a set **only** (agents removed from this slice) | DE-2 | 🟢 ~1 d |
| **DE-4 — Clients & scheduling** | As §0.3.7 | DE-2 | 🟡 ~1.5 d |
| **DE-5 — Money** | As §0.3.7 | DE-2 | 🟡 ~1.5 d |
| **DE-6 — Intake, leads & consent** | As §0.3.7 | DE-2 | 🟢 ~1 d |
| **DE-7 — Content records** | As §0.3.7; flips `PLANNED_ALLOWED` to false | DE-3…DE-6 | 🟢 ~1 d |
| **DE-8a — Export foundation (Phase 1 cut)** | Migration: jobs table only, partial unique index, start RPC (limit + stale-run rule), private bucket (50 MB) + `pg_policies` assertion. Repository (`new-repository`), §0.3.3 registrations for the jobs table and the bucket, audit event names, `fflate` dependency. Tests: the 2nd concurrent start and the 4th in 24 h are refused; a 91 s old `running` row does not block. User applies the migration by hand | DE-7 | 🟢 ~1 d |
| **DE-8b — One zip end to end (Phase 1 cut)** | The single request of §A: records (CSV per section with CSV-injection neutralising, `data.json`, README en/he) **and files** in one zip; pre-flight and finished-size ceiling (§C); DX-10 naming and controller wording (§E); start route and download-again route; the daily `/api/cron/data-export` (sweep + size watch). Tests: over-ceiling refusal leaves no object and no URL; a file entry name with `../` cannot escape the zip root; a Hebrew name gives the §E file name. Behind the flag | DE-8a | 🔴 ~2.5 d |
| **DE-9 — One button** | One shared "Download my data" control in Business OS Settings and the Danger zone (DX-5): Preparing (up to a minute) → Download, plus "Last export <date> — download again until <date>". `SecurityTab` / `SecurityTabV2` / BOS settings point to it; the old GET route is retired. Flag on after QA. The separate export **page** waits for Phase 2 (its only extra job is to be the email's target) | DE-8b | 🟡 ~1 d |
| **DE-10a — Admin: status + audited download (Phase 1 cut)** | §0.3.4 routes **without "send export to owner"**: `GET` status; `POST /api/admin/users/[id]/data-exports` with `{ reason }` **prepares** an export for the admin (same builder, counts against the target's limit, non-blocking `DATA_EXPORT_REQUESTED` with the admin as actor); `POST …/parts/[partNo]/download` with `{ reason }`, write-ahead `writeNow`, refuse 503 if not written, 60 s URL (DX-7). **No notice to the owner** (BQ-SA-2). Drawer card and the delete-preview line (§0.3.5) without the "send" button; the warning reads: *"The owner has not downloaded an export. Deleting now deletes any export. Download it now if you need to hand it over."* The hard delete removes the prefix explicitly if needed. `requireAdmin` CI guard green | DE-8b | 🟡 ~1.5 d |
| **DE-10b — Customer delete: offered export + typed acknowledgement** | Unchanged (§0.3.5, DX-6), inside purge slice 5, not before | purge slice 5 | 🟢 ~0.5 d (inside slice 5) |

**Admin "send export to owner" (DX-6) moves to Phase 2.** It only has meaning with an email: an admin cannot hand the owner a link the owner will see without one. **Business consequence, plainly:** in Phase 1, when we delete an account, we cannot send the owner their copy automatically. Before deleting, the admin either asks the owner to click "Download my data" themselves, or downloads it (recorded with the admin's name and reason) and hands it over by hand. The delete is not blocked either way (DX-6). Adding a minimal email to Phase 1 instead costs about **+1 day** (see business question below).

##### C. Phase 1 size ceiling and safe failure

| Measure | Ceiling | Today's largest (M-1) |
|---|---|---|
| Stored files, total input bytes | **40 MB** | ~14 MB (35%) |
| Stored files, count | **150 files** | 27 (18%) |
| Records, total rows across included sections | **100,000 rows** | ~1,000 (1%) |
| Finished zip | **45 MB** (under the 50 MB bucket limit) | — |
| Build time | **40 s** of the 60 s route limit | seconds |

- **Pre-flight** (before reading any file): file bytes and count from `storage.objects` metadata for the `include` buckets under `{user_id}/`, rows from `count` head queries. Over any ceiling → the job ends `failed` / `over_ceiling` **before any heavy work**. The finished-size and build-time checks are the backstop: over either → abort **before upload**.
- **What the owner sees:** *"Your account holds more than the on-screen download can package (over 40 MB of files or 150 files). Nothing was downloaded. Please contact support and we will prepare your export."* (en/he; UI copy final in DE-9.) Nothing is kept, nothing is half-written.
- **What we record:** `DATA_EXPORT_FAILED` with reason `over_ceiling` and the measured sizes (never contents); a `warn` log `data_export_over_ceiling` with user id, bytes, files, rows.
- **How we notice an account approaching it:** every `DATA_EXPORT_READY` audit row and success log carry `ceilingUsePct` (the highest of the five ratios), and at **≥ 60%** the log is a `warn` `data_export_near_ceiling`. Because an owner may never export, the daily cron's **size watch** step also runs one aggregate over `storage.objects` (the `include` buckets, grouped by owner) and logs `data_export_accounts_near_ceiling` with the **count** of accounts at ≥ 60% of the file-bytes or file-count ceiling (ids only, at `warn`). Records are not watched daily: at ~1% they are not the risk. **When that count is above zero, it is time for the user to decide Phase 2.**
- **What happens to an account above the ceiling in Phase 1:** neither the owner nor an admin can export it (the admin path uses the same builder and the same ceiling). Today no account is near it.

##### D. BQ-SA-1 applied

`agents` and `agent_configurations` leave the file in **DE-1** (today's JSON loses them along with runs, subscriptions, transactions and audit logs). **DE-2** classifies both `exclude` with the reason "not Business OS data (user 2026-10-14)". **DE-3** no longer carries them. An agent-platform user with no business still gets their profile details (DE-3). The README states that agents are not part of this export.

##### E. DX-10 — file name and controller wording

**File name:** `<business-slug>-data-export-<YYYY-MM-DD>.zip`.

| Rule | Ruling |
|---|---|
| Source | The business name on `business_profiles` (Dev confirms the column with `business-os-schema-check` in the DE-8b workplan) |
| Slug | Unicode NFC. **Keep letters and digits of any script** (`\p{L}`, `\p{N}`, plus combining marks `\p{M}` so Hebrew niqqud and accented letters survive). Every other run of characters (spaces, punctuation, `/ \ : * ? " < > |`, control and bidi-control characters) becomes one `-`. Trim `-` and `.` at both ends. Lowercase (it affects Latin only). At most **60 characters**, cut on a character boundary, never inside a surrogate pair |
| Empty or unsafe | If the slug is empty, or is a Windows reserved name (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`), the fallback applies. An agent-platform user with no business also gets the fallback |
| Fallback | `agentpilot-data-export-<YYYY-MM-DD>.zip` |
| Date | The day the export **started**, `YYYY-MM-DD`, in the owner's timezone (`user_preferences.timezone`, the authority; NULL → UTC, and the README then says "UTC"). The README also gives the exact start time in ISO 8601 with its offset |
| Hebrew and other non-Latin names | The name travels as the signed URL's `download` option, which makes Storage send `Content-Disposition`. The header must be `attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded name>` (RFC 6266 / RFC 5987). **ASCII fallback** = the slug with non-ASCII letters removed and re-trimmed; if nothing is left, `data-export-<date>.zip`. **Dev verifies on Preview in DE-8b** what Storage actually sends for a Hebrew name. If it does not send a correct `filename*`, the client saves the signed URL through the shared fetch-and-blob helper from DE-0a (SQ-E2) with the Unicode name (the Phase 1 ceiling keeps that blob under 45 MB) |
| Never | The business name is **never** in the storage object path, a log line or an audit detail (it can identify a person). The object path stays `{user_id}/{job_id}/1.zip` |
| Names inside the zip | UTF-8 entry names with the language-encoding flag set. Each stored file's name is cleaned the same way, keeps its extension, and can never contain `..`, a leading `/`, or a drive letter (no zip-slip). Duplicate names get ` (2)`, ` (3)`. Dev checks a Hebrew file name opens correctly in Windows Explorer and macOS Archive Utility |

**Controller wording** (README en/he, and `data.json` `meta.controller` per group; this replaces the stale `data_controller: 'NeuronForge'`):

| Group | README wording (en; he to match) |
|---|---|
| **Your account** (profile details, DX-1a) | "AgentPilot is the controller of this data about you. For questions about it, contact AgentPilot support." |
| **Your client records** and **Your content** (DX-1b, DX-1c) | "<Business name> is the controller of these records. AgentPilot keeps them on <Business name>'s behalf, as its processor, and returns them to you here. If one of your clients asks for their data, the request is for <Business name> to answer." With no business name: "the account holder" instead |

The legal-entity line behind "AgentPilot" is README copy; it follows the open lawyer note in §0.2 DX-1 and does not block DE-8b.

##### F. Phase 2 (not scheduled; the user decides after Phase 1)

| From §0.3 | What moves |
|---|---|
| DE-8a (rest) | Parts table `business_os_data_export_parts`, claim / reap RPCs, leases, 5 attempts with backoff; the global upload-limit check; bucket limit raised to 250 MB |
| DE-8b (rest) | Background start (in-process 25 s drain) and the every-minute drain step in `/api/cron/data-export`; records split per section group if needed; jobs-queues page entry |
| DE-8c | Split delivery: "Your records" + "Your files (n of N)", ≤ 200 MB / ≤ 500 objects per part, "removed before export" list |
| DE-8d | The "ready" and "could not prepare" emails |
| DE-9 (rest) | The in-app export page `/business-os/settings/data-export` as the email's target, listing all parts |
| DE-10a (rest) | Admin "send export to owner" and its delete-preview button and warning |
| Phase 1 ceiling | Lifted for accounts that go through the engine |

##### G. Phase 1 total and order

**Order:** DE-0b → DE-1 → DE-2 → DE-3…DE-6 (any order; DE-4 first is the most valuable) → DE-7 → DE-8a → DE-8b → DE-9 → DE-10a. DE-10b rides with purge slice 5.

> **User request 2026-10-16 (recorded in DE-6, §0.10):** DE-10a (admin export) is the **last Phase 1 slice**, and its admin control lives in **`/admin/users`, in the business area, placed just above the Danger Zone**.

**Total:** about **14.5 working days** (DE-1 to DE-10a), excluding DE-0b (~1 d) and DE-10b (inside purge slice 5). §0.3's plan was about 19 days; the difference is the engine, the split and the email.

##### H. User decisions on the Phase 1 trade-offs (2026-10-14)

| Trade-off | Decision |
|---|---|
| Admin "send export to owner" needs email | **Defer to Phase 2.** In Phase 1 the admin asks the owner to download first, or downloads it (audited, with a reason) and hands it over. The delete is never blocked |
| An account above the Phase 1 ceiling cannot export ("contact support") | **Accepted until Phase 2.** The daily 60% watch gives early warning |

Phase 1 plan is **approved by the user for building.** Each slice still gets a Dev workplan and an SA workplan review.

### 0.5 DE-1 status and notes for later slices (2026-10-15)

**DE-1 — Code complete, uncommitted, on `feature/data-export-de1`; awaiting SA code review, then QA and the user's diff review.** Workplan: [BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md) (SA approved with conditions C-1…C-8, 2026-10-14).

| Item | As built in DE-1 |
|---|---|
| Content | Three sections in one group `account` (controller): `account_identity` (from the session), `user_profile` (`profiles`), `plugin_connections`. `agents`, `agent_configurations`, `agent_executions`, `subscriptions`, `transactions` and `audit_logs` are gone (DX-1, BQ-SA-1). The six now-unused repository export methods were deleted (SA Q-5) |
| Section model | `lib/business-os/data-export/sections.ts`: `{ id, group, gdprRole, read }` registry, `runExportSections`. A failed or throwing read is `status: 'failed'`, listed in `summary.failed_sections`, response still 200, no error text in the file or the audit (FR-E12, AC-E9) |
| Payload | Typed (`lib/business-os/data-export/payload.ts`, no `any`), `format_version: 2`, `provider: 'AgentPilot'`, `groups.account.controller: 'AgentPilot'` (SA C-4) |
| File name | `agentpilot-data-export-<YYYY-MM-DD>.json` (UTC date, no user id): the §0.4.1 E fallback form. Business-name slug, owner timezone and `filename*` stay in DE-8b |
| Audit | `DATA_EXPORTED` via `logAndFlush` (WC-7), with section counts and failed sections only |
| Danger zone | The plain `<a href="/api/user/data-export">` is now a button through `downloadUserDataExport()`, with success / error messages (QA E4 closed in code) |
| Profile read | `.maybeSingle()`: no profile row is an `ok`, empty section, not `failed` (SA Q-4) |

**Q-3 ruling (SA, 2026-10-14), applied:** `profiles.plan` is **removed from the export in DE-1**. DX-1a says profile details only, no plan or billing data, and DE-1 is the slice that applies DX-1 to today's file. `hourly_rate_usd`, `role` and `org_id` stay for now (they are not plan or billing data); DE-3 decides them (below).

**AC-E7 note:** the second half of AC-E7 ("the audit section contains the owner's visible rows and none of the BD-26 hidden types") **no longer applies**. The audit section left the export under §0.3.1 (DX-1d), and `ownerAuditReads.guard.test.ts` now proves the export route reads no audit rows at all. BD-26 itself is unchanged and stays covered for `listOwnerEntries` and the owner RLS policy. The first half (no `*` read) holds: the two remaining reads use named column constants, pinned literally in the characterization test.

**Notes for later slices (SA C-6):**

| Slice | Note |
|---|---|
| **DE-2** | `plugin_connections` rows with `status = 'disconnected'` are a **status, not a soft delete** (SA Q-7): they stay in the export. Record this on the descriptor |
| **DE-3** | Decide `profiles.hourly_rate_usd`, `role` and `org_id` explicitly in the Business OS profile column set. Open until then |
| **DE-8b** | **`business_profiles.business_name` does not exist** (a live probe returned 42703, DE-1 workplan §7). DE-8b's workplan must find the real business-name column with the `business-os-schema-check` skill before writing the file-name slug |

### 0.6 DE-2 status, SA rulings and user decisions (2026-10-15)

**DE-2 — Code complete, uncommitted, on `feature/data-export-de2`; C-3 live read done 2026-10-15 (TL, prod read-only: `profiles` 18 cols and `plugin_connections` 19 cols, drift 0, missing 0; `intent_examples` no `user_id`, no FKs). SA code-approved 2026-10-15; QA and the user's diff review next.** Workplan: [BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md) (SA approved with conditions C-1…C-9, 2026-10-15).

**§0.3.6 tsc clause superseded by SA DE-2 review: T-1 Jest runtime check is the enforcement.** §0.3.6 says a descriptor without `export` "fails `tsc`, the existing type-check job". Measured in the DE-2 workplan §1.3, that is not true: Jest is transpile-only, `next build` ignores type errors, and `typecheck:bos-llm` does not scope `descriptors.ts`. SA declined widening that scope (SA-Q1: +22 files, about +62% on a required job with thin headroom, against the no-added-CI-time rule). The required TypeScript field stays as editor feedback and documentation; the gate is `lib/business-os/data-export/__tests__/exportClassification.test.ts` in the existing Jest gate.

**User decisions (via TL, 2026-10-15):**

| # | Question | Decision | Effect |
|---|---|---|---|
| **BC-1** | Should the download list which Business OS modules the owner switched on? | **No** | `user_capabilities`, `user_capability_blocks`: `exclude`, "PLATFORM: module setup, not data the owner entered (user 2026-10-15)" |
| **BC-2** | Should the download include the organisation / team-membership record? | **No** | `organizations`, `organization_members`: `exclude`, "PLATFORM: agent-platform organisation record (user 2026-10-15)" |

**SA rulings that change this requirement:**

| Ruling | Change |
|---|---|
| **SA-Q4** | Column drift is surfaced by **`npm run schema:reconcile`** (new alias for `scripts/purge-schema-reconcile.ts`, read-only), not by `npm run schema:check`. This supersedes "surfaced by `npm run schema:check`" in §0.3.6 and FR-E19. `schema:check` is unchanged |
| **SA-Q5** | Beside `exportColumnDrift`, a second report-only list `exportColumnsMissing` (a declared export column that is not live). It replaces the literal-select coverage `schema:check` loses once the selects come from the descriptors |
| **SA-Q2** | Buckets carry their own shape (`include { folder }` / `exclude` / `planned 'DE-8b'`) and their own expiry flag `PLANNED_FILES_ALLOWED`, flipped by DE-8b (DE-7 flips `PLANNED_TABLES_ALLOWED`) |
| **SA-Q6** | Secret-column deny list with a reviewed exception map (`DENY_EXCEPTIONS`, one entry: `plugin_connections.plugin_key`), checked for stale entries; the same check runs at request time in `exportColumnsOf` (fail closed to a `failed` section). Every later exception is an SA item in its slice |
| **SA-Q8** | One table per section; `account_identity` (from the session) is the only non-table section |
| **SA-Q10** | The audit guard covers every file under `lib/business-os/data-export/`, and refuses archived history too (`archived_records`, `archiveRepository`) |
| **SA-Q11** | `website_blocks` is `planned` DE-7 and must be read **through an owner-scoped parent** (`website_pages` rows filtered by `user_id`), never by a caller-supplied page id alone. `onboarding_prompt_ideas` is `exclude` (assistant activity) |
| **SA-Q12** | The skill rule diverges from Appendix A: it points at `lib/business-os/purge/descriptors.ts` (the `export` field) instead of §6.4, names buckets, and names `npm run schema:reconcile`. It is in `new-repository`, `new-api-route`, `new-plugin`, plus one line in `durable-queue-drain` |

**As built (measured on the branch):** 155 table descriptors = 2 `include` (`profiles` → `user_profile`, `plugin_connections` → `plugin_connections`, the same columns in the same order as DE-1, so the file is unchanged) + 45 `planned` (DE-3: 4, DE-4: 9, DE-5: 15, DE-6: 12, DE-7: 5) + 108 `exclude`; 3 buckets = 2 `planned` DE-8b + 1 `exclude`. `intent_examples` gained a `never` / `global` descriptor (count 154 → 155); no Reset, Purge or admin delete removes anything different (`descriptorsForRun` identical for all 16 combinations). The two repositories select `exportColumnsOf(table).join(', ')`. `plugin_connections` notes record that disconnected rows are a status (§0.5) and that `ACCOUNT_PROFILE_KEYS` is the control on `profile_data` (SA C-4).

**Follow-up (SA-Q9):** `intent_examples` is listed in `USER_OWNED_TABLES` but has no `user_id`; decide in the next ownership pass. DE-2 leaves the ownership entry alone.

### 0.7 DE-4 status, user decisions and notes for DE-8b (2026-10-15)

**DE-4 — Code complete, uncommitted, on `feature/data-export-de4`; awaiting SA code review.** T-0 live read done 2026-10-15 (TL, prod read-only: column counts 19, 11, 10, 16, 15, 26, 36, 8, 11, all as expected; `crm_contacts.notes` live; cross-tenant integrity 0 on all five parent/child edges; largest owner 885 rows / ~200 kB). `npm run schema:reconcile` on the branch (`exportColumnDrift` 0, `exportColumnsMissing` 0) is owed before merge. Workplan: [BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md) (SA approved with conditions C-1…C-12, 2026-10-15).

**What it delivers:** today's JSON download (`GET /api/user/data-export`) gains eight sections in a new group `client_records` (AgentPilot the processor, the account holder the controller): `pipeline_stages`, `clients`, `client_activities`, `client_tasks`, `client_documents` (details only; files in DE-8b), `services`, `bookings`, `time_off`. Each is one table with an explicit column list and a written reason for every column left out. Every read goes through one repository, keyed on the session user's id, paged to the end in `id` order (no silent 1,000-row cut), deleted documents left out. `format_version` stays 2 (additive). No migration, no new route, no new dependency, no flag.

**User decisions (via TL, 2026-10-15; binding, recorded by SA).** These DE-4 BC numbers are separate from DE-2's BC-1 / BC-2 in §0.6.

| # | Question | Decision | Effect |
|---|---|---|---|
| **BC-1** | The owner's private booking notes (`internal_notes`, never shown to the client) | **In** | `scheduling_bookings.internal_notes` included |
| **BC-2** | Cancelled, no-show and completed bookings; finished and cancelled tasks | **In**, with their status | No status filter anywhere except BC-3 |
| **BC-3** | Archived documents / deleted documents | **Archived in, deleted out** | `contact_documents` `rowFilter`: `status` not in (`deleted`). `status` is NOT NULL, so no NULL row is dropped |
| **BC-4** | How a client found the business (`crm_contacts.source_metadata`) | **Readable keys only** | Allow-list, named one by one: `capture_page_url`, `referrer_url`, `referrer_domain`, `capture_channel`, `device_type`, `capture_timestamp`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`. Out: `ip_hash` (a day-salted IP hash, recoverable), `user_agent`, `session_id`, `smart_link_id`, and every key not named (`page_type`, `smart_link_code`, `smart_link_name` are not on the list; none is in live data today) |
| **BC-5** | The synced copy of the owner's own Google / Outlook calendar (`external_calendar_events`) | **Out** | `exclude`, "user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data". **Supersedes §0.3.1 SQ-E7 ("in"), the §3.1 B2 row and the §9.2 SQ-E7 default** (each carries a note) |
| **BC-6** | "Reminder sent" and "intake form sent" markers on a booking | **Out** (DX-1d: emails sent are activity) | `reminder_24hr_sent`, `reminder_2hr_sent`, `intake_sent_at`, `intake_reminded_at` excluded. The client's intake answers and their completion time stay in |
| **BC-7** | The assistant's stored suggestions on a service (`ai_suggestions`) | **Out** | Excluded (assistant output, not a setting the owner chose) |

**SA rulings recorded here (DE-4 review):**

| Ruling | Change |
|---|---|
| **SA-Q1** | One descriptor-driven, read-only `BusinessDataExportRepository`: a granularity exception inside the repository layer (as `BusinessPurgeRepository`, DEV-Q1), bounded E-1…E-6 (read-only; `include` + `user_id` scope only, resolved from a section id; columns only from `exportColumnsOf`; first filter `.eq('user_id', session id)`; service role documented; sole importer `data-export/sections.ts`). DE-5/6/7 sections go through it |
| **SA-Q2** | Soft-delete filter as an optional `rowFilter` on the `include` classification; the filter column must be NOT NULL live (SA C-6) |
| **SA-Q5** | Second `DENY_EXCEPTIONS` entry: `crm_pipeline_stages.stage_key` (the stage's short name, which `crm_contacts.stage` refers to; not a credential) |
| **SA-Q7** | The Phase 1 ceiling is built **now, in today's JSON route** (below) |
| **SA-Q8** | Rows are in `id` (uuid) order, not date order; each row carries its dates. DE-8b's README says so |
| **SA-Q13** | `export_metadata.groups[].controller` is `'AgentPilot'` or `'account_holder'`; DE-8b replaces `account_holder` with the business name |

**Phase 1 ceiling in today's JSON route (SA-Q7, C-9).** Over either limit the route answers **413** `{ success: false, error: "Your account holds more than the on-screen download can package. Nothing was downloaded. Please contact support and we will prepare your export.", code: "export_too_large" }`, `Cache-Control: no-store`, and sends **no file**, never a partial one:

| Limit | Value | Why |
|---|---|---|
| Rows across all sections | **100,000** (`EXPORT_LIMITS.ROW_CEILING`, the §0.4.1 C constant DE-8b reuses) | Bounds memory; reading stops at the first section that passes it |
| JSON body | **4 MB** (`EXPORT_LIMITS.JSON_BODY_MAX_BYTES`), measured on the exact bytes that would be sent, pretty-print included | Vercel refuses a function response over 4.5 MB with a platform crash, not a message. At pretty-printed JSON this is the **binding** limit in Phase 1. Today's largest account is ~200 kB |

A refusal writes **no** `DATA_EXPORTED` entry (nothing was exported; `DATA_EXPORT_FAILED` arrives with the audit names in DE-8a). It logs one `warn` (`event: data_export_over_ceiling`, ids and counts only); the 413 body carries no counts. The browser helper maps it to `code: 'too_large'` only when the body carries `export_too_large` (not on the status alone); the three screens show their generic error until DE-9 writes the copy.

**Third-party data in today's file (accepted in §0.4, restated):** from DE-4's merge, the current "Export data" button includes the owner's clients' details. It is downloaded only by the signed-in owner, never cached, and logs and audit carry counts only.

**Notes for DE-8b (binding conditions):**

| # | Condition |
|---|---|
| **C-11 (SA-Q12)** | The "Your files" manifest for the `contact-documents` bucket **drops any object whose `contact_documents` row is `deleted` or missing**. Deleting a document removes its file from storage, but the delete route continues with the soft delete if the storage call fails, so orphan objects can exist (DE-4 workplan F-7) |
| **C-11 (body cap)** | The 4 MB JSON body cap exists only while the export is a direct JSON response. It is **removed when DE-8b's signed-URL zip replaces** the direct response; the §0.4.1 C zip ceilings (40 MB files, 150 files, 45 MB zip, 100,000 rows) take over |
| CSV header | DE-8b takes each section's CSV header from `exportColumnsOf(exportDescriptorOfSection(id).table)`, so an empty section still has a header row. Rows are flat objects keyed by those columns; arrays and jsonb cells are JSON text in one cell; `clients.source_metadata` is the one reshaped cell |
| README | Says rows are in `id` order (not date order) and that deleted documents are not included |

**As built (measured on the branch):** 155 table descriptors = **10** `include` (`profiles`, `plugin_connections` + the eight DE-4 tables) + **36** `planned` (DE-3: 4, DE-5: 15, DE-6: 12, DE-7: 5; DE-4: 0) + **109** `exclude` (+ `external_calendar_events`). `level`, `order`, `scope`, `snapshot` and notes are unchanged on all nine DE-4 tables (purge baseline green). `PluginConnectionRepository.listForUserDataExport` stays unpaged on purpose: one row per `(user_id, plugin_key)` (SA C-10).

**T-9 done — 2026-10-15 (SA F-3).** The "`npm run schema:reconcile` owed before merge" above is closed: TL ran the same comparison as read-only SQL on prod (DE-4 workplan §10.2): declared include ∪ excluded columns vs `information_schema.columns` for the eight included tables, **drift 0, missing 0**; `contact_documents.status` is **NOT NULL** (C-6 confirmed). Done in lieu of the script because the worktree has no DB env.

**User decisions 2026-10-15, after SA code review and QA (binding; DE-4 workplan "Post-review changes — 2026-10-15"):**

| # | Decision | Effect |
|---|---|---|
| **DE4-U1** | **The time goes in the file name, now** | `agentpilot-data-export-YYYY-MM-DD-HHmm.json`, from the route's one `exportedAt` instant (the same one written as `export_date`, UTC, and as the audit `export_timestamp`), on the **owner's clock**: `user_preferences.timezone`, read through `UserPreferencesRepository.findTimezone` (one explicit column, the session user's id). NULL (never set), blank or an invalid zone gives **UTC**, explicitly (`FALLBACK_TIMEZONE`). A failed read also gives UTC and a `warn` line: the export never fails over its name. DE-8b later swaps the `agentpilot-data-export` prefix for the business-name slug |
| **DE4-U2** | **Connected apps are dropped from the export entirely** (business data only) | `plugin_connections` is `exclude`, "user 2026-10-15: connected apps dropped from the export (business data only); see lawyer note §0.2 DX-1". The `plugin_connections` section, its reader, its `profile_data` allow-list (`accountProfile` / `ACCOUNT_PROFILE_KEYS`), the `plugin_connections.plugin_key` deny exception and the now-dead `PluginConnectionRepository.listForUserDataExport` are removed. The table is never read by the export (pinned, with token-bearing rows seeded). The DE-0a / DE-0b browser-access controls are unchanged. The DX-1 lawyer note in §0.2 now names connected apps |

**As built after DE4-U2 (measured on the branch, 2026-10-15):** 155 table descriptors = **9** `include` (`profiles` + the eight DE-4 tables) + **36** `planned` (unchanged) + **110** `exclude` (+ `plugin_connections`). The export file holds 2 account sections (`account_identity`, `user_profile`) + 8 `client_records` sections. The SA C-10 note on `listForUserDataExport` above no longer applies: the method is gone.

**User manual check DE-1 — 2026-10-15: PASS** (Danger zone Export works).

**UI-1 (new work item, folded into DE-9; recorded 2026-10-15):** the export result message does not match the system's look and feel. The Danger zone shows a small grey text line (`DangerZonePanel.tsx` `<p role="status" className="text-xs …">`), while the Business OS settings page uses a green banner with an icon (`app/business-os/settings/page.tsx` successMessage block) and other screens use `sonner` toasts. DE-9 must use the system's standard success/error notification for every export entry point (4 call sites: Business OS settings page, `DangerZonePanel`, `SecurityTab`, `SecurityTabV2`) and add a clear "too large — contact support" message for `too_large` (QA DE-4 Low 1). SA picks the standard pattern in the DE-9 workplan review. No code change for this in DE-4.

### 0.8 DE-3 status, user decisions and SA rulings (2026-10-16)

**DE-3 — Code complete on `feature/data-export-de3`; SA code-approved 2026-10-16; QA PASS 2026-10-16 (21/21 negative controls, 0 new failures); T-9 done by TL read-only SQL: 0 drift / 0 missing over 157 names; all ids uuid.** T-0 live read done 2026-10-16 (TL, prod read-only; DE-3 workplan §10.1): live column counts `profiles` 18, `user_preferences` 23, `notification_settings` 24, `business_profiles` 85 (`subdomain` is live), `business_addresses` 7; every table has an `id` primary key; `user_id` unique on the three 1:1 tables; max 1 row per user on all four; 0 cross-tenant address pointers. Workplan: [BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md) (SA approved with conditions C-1…C-9, 2026-10-16). T-9 drift check (declared vs live, all five tables, 157 names): done, 0 drift / 0 missing (DE-3 workplan §10.2).

**What it delivers:** today's JSON download (`GET /api/user/data-export`) gains four sections in the existing `account` group (AgentPilot the controller), after `user_profile`: `preferences` (`user_preferences`), `notification_settings`, `business_profile` (`business_profiles`) and `business_addresses`. Each is one table with an explicit column list and a written reason for every column left out, read through the DE-4 `BusinessDataExportRepository` (keyed on the session user's id, paged to the end, inside the Phase 1 row ceiling). The `profiles` section loses `hourly_rate_usd` and `org_id`. `format_version` stays 2 (additive). No migration, no new route, no new dependency, no flag, no new file.

**User decisions (via TL, 2026-10-16; binding, recorded by SA).** These DE-3 BC numbers are separate from DE-2's and DE-4's.

| # | Question | Decision | Effect |
|---|---|---|---|
| **BC-A** | Agent-platform settings on the account (the hourly rate behind "money saved" on agent runs; the AI model settings) | **Out** | Reason, verbatim: "user 2026-10-16: agent-platform setting, Business OS data only" (`AGENT_SETTING`). `profiles.hourly_rate_usd`; `user_preferences.default_model`, `max_tokens`, `temperature`, `auto_save_conversations`, `debug_mode`, `beta_features`; `notification_settings.email_agent_updates`, `push_agent_updates`, `desktop_agent_updates` (SA R-3) |
| **BC-B** | The bank details printed on the owner's invoices | **Out** | Reason, verbatim: "user 2026-10-16: bank details left out of the file" (`BANK_DETAILS`). `business_profiles.invoice_bank_name`, `invoice_bank_account`, `invoice_bank_routing`, and `invoice_payment_instructions` (SA R-2) |
| BC-C | The owner's answers about the business in; the assistant's website analysis, what it extracted from the bio, and the onboarding chat out | **Confirmed** | `website_analysis`, `extracted_data`, `onboarding_conversation` excluded |
| BC-D | Setup-progress markers out | **Confirmed** | `onboarding_completed`, `profile_completeness`, `setup_checklist_dismissed`, `dismissed_setup_steps`, `needs_stripe_connect` excluded (`SETUP_STATE`) |
| BC-E | Calendar-sync settings on the business profile out | **Confirmed** | `calendar_sync_enabled`, `calendar_sync_provider`, `calendar_last_synced_at` excluded (`CALENDAR_SYNC`) |
| BC-F | The list of connected apps on the business profile out | **Confirmed** | `connected_plugins` excluded (as DE4-U2) |
| BC-G | The organisation id on the profile out; the role (persona) in | **Confirmed** | `profiles.org_id` excluded (DE-2 BC-2); `profiles.role` kept |

**SA rulings recorded here (DE-3 workplan review, 2026-10-16):**

| Ruling | Change |
|---|---|
| **R-1** | `invoice_tax_id` is **in**: a tax registration number printed on every invoice by law identifies the business; it is not a bank detail |
| **R-2** | `invoice_payment_instructions` is **out** under `BANK_DETAILS`, with the suffix "(free-text payment instructions; the product treats them as the same thing as bank details: SA DE-3)". The product treats bank details and written payment instructions as the same thing (`profileReadiness.ts` `hasPaymentMethod`, `invoicePaymentOptions.ts`), so the free text often holds the IBAN. TL states this to the user as a one-line confirmation. `invoice_footer_text` stays in |
| **R-3** | `debug_mode`, `beta_features` and the three `*_agent_updates` toggles fall under BC-A. The general display and privacy switches on `user_preferences` and the other notification choices (`push_mentions`, system / security / marketing) stay **in** |
| **SA-Q1** | Moot: all four tables have an `id` primary key, so the normal keyset read works. No single-row read, no `rowKey`; `classification.ts` is not touched |
| **SA-Q2** | The four sections are group `account`, AgentPilot the controller: facts about the account holder's own business, given to us to run the account |
| **SA-Q3** | `user_code` and `subdomain` in: the business's public address, not a credential |
| **SA-Q4** | `primary_crm`, `primary_calendar`, `primary_payment`, `tools` in (the owner's answers); `connected_plugins` out (connection plumbing, DE4-U2) |
| **SA-Q5** | The jsonb columns travel whole, on the live key census: `scheduling_availability` (day keys), `address_parts` / `invoice_address` / `business_addresses.parts` (the six address parts), `theme` (design tokens, the design's `id` / `source`), `process_steps` (no object elements today). `profiles.onboarding_data` stays as DE-1 decided |
| **SA-Q6** | Moot: no jsonb and no push-subscription column on either settings table. `DENY_EXCEPTIONS` stays at one entry; no value-shape deny rule |
| **SA-Q7** | `profiles.domain` and `onboarding*` stay as DE-1 decided (the person's onboarding answers, not settings) |
| **SA-Q8** | Both timezone columns exported as held; see the DE-8b README note below |
| **SA-Q9** | Setup-progress columns out (confirmed by the user as BC-D) |

**Final column lists (as built; `columns` ∪ `excludedColumns` = the live set of each table):**

| Table → section | In | Out (reason) | Total |
|---|---|---|---|
| `profiles` → `user_profile` | `id, full_name, avatar_url, company, job_title, timezone, language, created_at, updated_at, role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data` (15) | `plan` (no plan or billing data), `org_id` (DE-2 BC-2), `hourly_rate_usd` (`AGENT_SETTING`) | 18 |
| `user_preferences` → `preferences` | `id, preferred_language, timezone, timezone_confirmed_at, preferred_currency, theme, sidebar_collapsed, compact_mode, show_timestamps, enable_sounds, keyboard_shortcuts, data_retention_days, analytics_enabled, telemetry_enabled, created_at, updated_at` (16) | `user_id` (`OWNER_ID`); `default_model, max_tokens, temperature, auto_save_conversations, debug_mode, beta_features` (`AGENT_SETTING`) | 23 |
| `notification_settings` → `notification_settings` | `id, email_enabled, email_frequency, email_system_alerts, email_security_alerts, email_marketing, push_enabled, push_system_alerts, push_mentions, desktop_enabled, desktop_system_alerts, inapp_enabled, inapp_sounds, inapp_popups, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, created_at, updated_at` (20) | `user_id` (`OWNER_ID`); `email_agent_updates, push_agent_updates, desktop_agent_updates` (`AGENT_SETTING`) | 24 |
| `business_profiles` → `business_profile` | 68 columns: the owner's answers about the business, contact details and address (incl. the bare `address_id` / `invoice_address_id`), public presence (incl. `subdomain`, `user_code`), working hours, language and currency, the invoice profile without the bank lines (incl. `invoice_tax_id`, `invoice_footer_text`), collection settings, and the automations the owner switched on or declined; `id`, `created_at`, `updated_at` | 17: `user_id` (`OWNER_ID`); `website_analysis`, `extracted_data` (`ASSISTANT_OUTPUT`); `onboarding_conversation` (activity); `connected_plugins` (`CONNECTED_APPS`); 3 × calendar sync (`CALENDAR_SYNC`); 5 × setup progress (`SETUP_STATE`); 4 × bank details (`BANK_DETAILS`) | 85 |
| `business_addresses` → `business_addresses` | `id, label, parts, is_default, created_at, updated_at` (6) | `user_id` (`OWNER_ID`) | 7 |

The exact 68 / 17 lists are the `BUSINESS_PROFILES_EXPORT` descriptor in `lib/business-os/purge/descriptors.ts`, pinned literally in `exportClassification.test.ts` (`DE3_PINS`) and byte for byte in the route characterization test.

**Tenant isolation (tenant-isolation-guard, SA approved):** the only id is the session's `getUser().id`; every DE-3 read's first filter is `.eq('user_id', <session id>)`. The addresses are read by their own `user_id`, never by following `address_id` / `invoice_address_id`, which are exported as bare uuids: even a crossed pointer would carry an id, never another tenant's address (pinned by a cross-tenant test). Read-only; no write path.

**Notes for DE-8b (binding):**

| # | Note |
|---|---|
| README: timezones (SA-Q8) | The file holds three timezone columns. `preferences.timezone` (`user_preferences.timezone`) is the **authority** for the owner's clock; `user_profile.timezone` (`profiles.timezone`) is a **mirror** of it; `notification_settings.quiet_hours_timezone` is the zone of the **quiet hours only** |
| CSV | The four sections follow the DE-4 CSV rule (header from `exportColumnsOf`; arrays and jsonb cells as JSON text in one cell). `business_profile` is one row with 68 columns |

**As built (measured on the branch, 2026-10-16):** 155 table descriptors = **13** `include` (`profiles`, the eight DE-4 tables, + `user_preferences`, `notification_settings`, `business_profiles`, `business_addresses`) + **32** `planned` (DE-5: 15, DE-6: 12, DE-7: 5; DE-3: 0) + **110** `exclude` (unchanged). `level`, `order`, `scope`, `snapshot`, `area` and notes are unchanged on the four DE-3 rows (purge suites green). The export file holds 6 `account` sections + 8 `client_records` sections. The DE-4 sections, their eight selects, order, group, role and the `clients` `source_metadata` reshaping are unchanged (SA C-2).

### 0.9 DE-5 status, user decisions and SA rulings (2026-10-16)

**DE-5 (client money): SA code-approved + QA PASS 2026-10-16 (25/25 negative controls); T-10 drift 0/0 (TL). Uncommitted on `feature/data-export-de5`; SA F-1 applied 2026-10-16.** Before that, T-0 live read done 2026-10-16 (TL, prod read-only; DE-5 workplan §11.1) and SA C-1 counts done (§11.2). The SA workplan review is approved with conditions C-1…C-9 and rulings SA-Q1…SA-Q15 (2026-10-16). T-10 drift check done (TL, 0 drift / 0 missing) and billing table names checked live (SA C-6; 13 of 14 live, `subscriptions` dropped from the test lists by F-1). Workplan: [BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md).

**What it delivers:** the JSON download (`GET /api/user/data-export`) gains ten sections. Two go in the `account` group (AgentPilot the controller), after `business_addresses`: `payment_account` (`stripe_connect_accounts`) and `payment_providers` (`payment_processors`). Eight go in the `client_records` group (AgentPilot the processor), after `time_off`: `quotes` (`proposals`), `invoices` (`payment_invoices`), `payments` (`payment_transactions`), `refunds` (`payment_refunds`), `payment_plans`, `client_payment_plans` (`payment_plan_subscriptions`), `installments` (`payment_plan_installments`) and `client_payment_methods` (`saved_payment_methods`). Each section is one table with an explicit column list and a written reason for every column left out. Each is read through the DE-4 `BusinessDataExportRepository`, keyed on the session user's id, paged to the end, inside the Phase 1 row ceiling. Child tables (refunds, instalments) are read by their own `user_id`, never by following a parent id. Five money tables are `exclude`. `format_version` stays 2. There is no migration, no new route, repository method, file, dependency or flag.

**Money paid to AgentPilot is not in the file (DX-1a).** It lives in the billing tables, never in these ten. A test pins it at route level and at classification level (SA C-6).

**User decisions (via TL, 2026-10-16; binding).** These DE-5 BC numbers are separate from the BC numbers of DE-2, DE-3 and DE-4.

| # | Question | Decision | Effect |
|---|---|---|---|
| BC-1 | Card data on saved methods and client plans | **Brand and last 4 only** | `card_brand`, `card_last4`, `brand`, `last_four` are in. `card_exp_month`, `card_exp_year`, `expiry_month`, `expiry_year` are out (`CARD_EXPIRY`). No card number is stored anywhere |
| BC-2 | Failed, cancelled, refunded and draft rows | **All in**, each with its status | No `rowFilter` on any DE-5 table (none of them soft-deletes) |
| **BC-3** | The Stripe invoice web link and PDF link | **In. This overrides the workplan default and SA-Q5, which were "out".** The user accepts that anyone holding the file can open those invoice pages | `stripe_hosted_invoice_url` and `stripe_invoice_pdf` are in `payment_invoices` columns. No deny rule matches them, so there is no exception entry |
| BC-4 | Payment reminders sent to clients | **Out** (activity) | `payment_reminders` is `exclude` |
| BC-5 | Payment event log and automatic-action history | **Out** (activity) | `payment_events` and `payment_automation_executions` are `exclude`. This meets the SA-Q14 condition |
| BC-6 | The built-in payment rules | **Out** | `payment_automation_rules` is `exclude` (platform defaults the owner cannot edit) |
| BC-7 | Private invoice notes; the owner's typed notes on manual payments | **In** | `internal_notes` is in. On `payments.metadata`, only `notes` and `source` are exported (SA-Q3). The invoice and quote sent / viewed dates are in |
| BC-8…BC-10 | Fees and net amount (each in its own currency); Stripe reference numbers | **In** | `processor_fee` and `net_amount` are exported with `fee_currency`. The Stripe / processor ids are in |
| BC-11 | Totals | **None of any kind** | `summary` keeps exactly its four keys (counts, failed sections, size, duration). Per-currency totals stay in the ledger export |
| BC-12 | Provider name and status in; keys never | **Default kept** | `payment_processors.credentials` is never selected (`SECRET`) |

`payment_methods` is `exclude` as a dead table (0 rows live, superseded by `saved_payment_methods`; SA-Q8).

**SA rulings recorded here (DE-5 workplan review, 2026-10-16):**

| Ruling | Change |
|---|---|
| SA-Q1 | `payment_account` and `payment_providers` are group `account`, AgentPilot the controller, after `business_addresses`. The other eight are `client_records`, processor |
| SA-Q2 | The section ids are as listed above (`quotes`, `client_payment_plans`, `client_payment_methods`) |
| **SA-Q3 (Dev default overruled in part)** | `payment_refunds.metadata` and `payment_plan_subscriptions.metadata` are out whole. `payment_transactions.metadata` is in through a named allow-list of exactly `notes` and `source`, strings only. This uses a new general `pickStringKeys(value, keys)`. `sourceMetadata` (DE-4) is now a one-line call to it, and its output is byte-identical |
| SA-Q4 | Refunds are exported as stored, with positive amounts. No signed column is added. DE-5 adds no total |
| SA-Q5 | The processor and Stripe ids are references, not credentials, so they are in. Invoice `id` is in. (The ruling on the two invoice links is superseded by user BC-3.) |
| **SA-Q6** | `fee_returned` and `refund_fee` are exported as stored with **no currency**. Nothing is copied from the parent payment. The pairing test lists exactly these two in a "no currency column" set. Live: 0 rows have either one set (§11.2). **DE-8b README wording:** "these two amounts have no recorded currency; for a Stripe refund they are normally in the payment's fee currency (`payments.fee_currency` on the linked payment); check your Stripe dashboard." |
| **SA-Q7 (Dev default overruled)** | `charge_account_kind` is **out**, together with `account_resolution` (`RECONCILIATION_STATE`). On live rows, `platform` only ever goes with `manual` (37 / 37, C-1). In a client-money file it would read as money paid to AgentPilot, which it is not |
| SA-Q8 | `payment_methods` is excluded (0 rows) |
| SA-Q9 | A NULL currency stays NULL and is never filled in (live: 0 rows). A NULL fee with a NULL `fee_currency` means "fee not recorded", which is not zero. The Connect currency `usd` is exported lower case, as stored |
| SA-Q10 | The amount-to-currency pairing lives in a map inside the test. No descriptor field is added |
| SA-Q11 | `card_number`, `cvc` and `cvv` are added to `SECRET_COLUMN_DENY_EXACT`. `client_secret` is not added, because `/_secret$/` already covers it (noted in a comment). There is no new hit on any existing include |
| SA-Q12 | The retry counters (`retry_count`, `last_retry_at`, `next_retry_at`) on invoices and instalments are out (`RETRY_STATE`) |
| SA-Q13 | The `stripe_connect_accounts` facts are in, including `stripe_email` (the owner's own) and `currency` (the settlement currency) |
| SA-Q14 | `payment_events` is out as activity (user BC-5) |
| SA-Q15 | `payment_refunds.initiated_by` is out (`ACTOR_ID`). `idempotency_key` and `credentials` are always out |

**Final column lists (as built; `columns` ∪ `excludedColumns` = the live set of each table):**

| Table → section | In | Out | Total |
|---|---|---|---|
| `payment_transactions` → `payments` | 28, incl. `metadata` (only `notes` and `source` exported), `processor_fee`, `net_amount`, `fee_currency` | `user_id`, `account_resolution`, `charge_account_kind` | 31 |
| `payment_refunds` → `refunds` | 20, incl. `amount_minor`, `fee_returned`, `refund_fee` | `user_id`, `idempotency_key`, `initiated_by`, `metadata` | 24 |
| `payment_invoices` → `invoices` | 35, incl. `internal_notes`, `stripe_hosted_invoice_url`, `stripe_invoice_pdf` | `user_id`, 3 × retry | 39 |
| `proposals` → `quotes` | 32 | `user_id` | 33 |
| `payment_plans` → `payment_plans` | 15 | `user_id` | 16 |
| `payment_plan_subscriptions` → `client_payment_plans` | 29, incl. `card_brand`, `card_last4` | `user_id`, 2 × card expiry, `metadata` | 33 |
| `payment_plan_installments` → `installments` | 26 | `user_id`, 3 × retry | 30 |
| `saved_payment_methods` → `client_payment_methods` | 12, incl. `brand`, `last_four` | `user_id`, 2 × expiry | 15 |
| `stripe_connect_accounts` → `payment_account` | 13, incl. `stripe_email`, `currency` | `user_id` | 14 |
| `payment_processors` → `payment_providers` | 8 | `user_id`, `credentials`, 4 × provider capability | 14 |

The exact lists are the `*_EXPORT` descriptors in `lib/business-os/purge/descriptors.ts`. They are pinned literally in `exportClassification.test.ts` (`DE5_PINS`) and byte for byte in the route characterization test.

**Currency (CLAUDE.md § Currency & Timezone):** every amount goes out as stored, next to the currency column it is denominated in. `processor_fee` and `net_amount` are paired with `fee_currency`, not with the payment's `currency`. Nothing is converted, defaulted, case-changed or summed. Tests pin this:
- an exhaustive pairing check (catalog money columns plus columns whose names look like amounts, with a planted `deposit_amount` as negative control);
- a test with live trap values: an ILS payment with USD fees, a NULL fee with a NULL fee currency, an ILS refund under a USD-fee payment, lower-case `usd`, and two currencies for one owner;
- a source scan for FX or conversion code.

**Notes for DE-8b (binding):**

| # | Note |
|---|---|
| README: refund fees (SA-Q6) | Use the wording in the SA-Q6 row above |
| README: fees | `processor_fee` / `net_amount` are in `fee_currency`, which can differ from the payment's `currency`. An empty fee means "fee not recorded", not zero (SA-Q9) |
| README: refunds | A refund row is money returned to the client, stored positive. `payments.amount` is the gross charge, so do not count refunds twice. There are no totals in the file; for totals per currency, use the ledger export (SA-Q4, BC-11) |
| README: invoice links | `stripe_hosted_invoice_url` and `stripe_invoice_pdf` open the invoice page for anyone who holds them (user BC-3) |
| CSV | The ten sections follow the DE-4 CSV rule. `payments.metadata`, `line_items`, `payment_shape`, `sessions`, `accepted_snapshot` and `client_address` go as JSON text in one cell |

**Follow-ups:**

- Purge follow-up (not DE-5): the `never('subscriptions', …)` purge descriptor names a table that is not live in prod (TL §11.3, 2026-10-16); SchemaReconciler already reports it under `missingNever`. Remove or re-point it in the purge workstream.

**As built (measured on the branch, 2026-10-16):** 155 table descriptors = **23** `include` + **17** `planned` (DE-6: 12, DE-7: 5; DE-5: 0) + **115** `exclude`. On the 15 DE-5 rows, `level`, `order`, `scope`, `snapshot`, `area` and notes are unchanged (purge suites green). The export file holds 8 `account` sections and 16 `client_records` sections. The 13 earlier selects (DE-3, DE-4, `profiles`) are byte-identical (SA C-7).

### 0.10 DE-6 status, TL defaults and SA rulings (2026-10-16)

**DE-6 (intake, leads and consent): code complete 2026-10-16; SA code-approved + QA PASS 2026-10-16; committed on `feature/data-export-de6` by RM.** T-0 live read done (TL, prod read-only; DE-6 workplan §11.1), SA-owed reads done (§11.2: Q7b, Q11, F-DE6-1 count). SA workplan review approved with conditions C-1…C-12 and rulings SA-Q1…SA-Q10 (2026-10-16). T-10 done by TL: 0 drift / 0 missing over 124 names; SA code-approved + QA PASS 2026-10-16 (28/28 negative controls). Workplan: [BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md).

**What it delivers:** the JSON download (`GET /api/user/data-export`) gains ten `client_records` sections (AgentPilot the processor; SA-Q2), after `client_payment_methods`: `intake_settings` (`user_intake_settings`), `intake_forms` (`business_intake_forms`, every version), `email_campaigns`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`, `newsletter_subscribers` (`business_subscribers`), `consent_records` (`marketing_consent_events`), `consent_settings` (`marketing_consent_settings`) and `email_unsubscribes` (the do-not-email list). Each is one table with an explicit column list and a written reason for every column left out, read through the DE-4 `BusinessDataExportRepository`, keyed on the session user's id, inside the Phase 1 row ceiling. Child tables (steps, enrollments, consent records) are read by their own `user_id`. Two tables are `exclude`: `lead_responses` (activity) and `marketing_consent_state` (derived). `format_version` stays 2. There is no migration, no new route, file, dependency or flag. Client answers to intake forms were already in the file (DE-4 `bookings.intake_responses`); DE-6 adds the forms they answer.

**Business calls: TL defaults 2026-10-16 — user may change.** The user asked for an autonomous run, so TL took these defaults, following the user's earlier decisions (activity out, tracking out, AI-generated out, everything we hold in). These DE-6 BC numbers are separate from the BC numbers of DE-2…DE-5.

| # | Question | TL default 2026-10-16 — user may change | Effect |
|---|---|---|---|
| BC-1 | Consent technical evidence (scrambled IP and its key, browser signature, visit id) | **Out** | `ip_hash`, `ip_hash_salt`, `user_agent`, `session_id` are `excludedColumns` (`VISITOR_EVIDENCE`). The wording, time, method, form and page are in. The evidence stays in AgentPilot's records (the ledger is never purged) |
| BC-2 | Automatic invitations, chases and reminders to leads (`lead_responses`) | **Out** (activity) | `lead_responses` is `exclude` |
| BC-3 | Campaign and sequence sent / opened / clicked counts | **Counts out**; the campaign, its status and sent date in | The counters are `excludedColumns` (`DELIVERY_STATS`) |
| BC-4 | Intake form drafts and old versions | **All versions in**; the AI generation details out | Every status in; `generated_from` out (`GENERATION_METADATA`) |
| BC-5 | Unconfirmed and unsubscribed newsletter sign-ups | **In**, with status | No row filter |
| BC-6 | A separate "current answer per address" list | **No** | `marketing_consent_state` is `exclude` (derived); DE-8b's README explains how to read the current answer |
| BC-7 | Consent settings (statements per language, privacy notice, postal address) | **In** | `consent_settings` section (single-row read, SA-Q1) |
| BC-8 | Consent records of people later erased | **In, as held** | Redacted rows go out with `redacted@invalid` and `redacted_at` |

**SA rulings recorded here (DE-6 workplan review, 2026-10-16):**

| Ruling | Change |
|---|---|
| **SA-Q1** | `marketing_consent_settings` has no `id` (PK `user_id`). The `include` classification gains an optional `rowKey?: 'user_id'` (that literal only). The repository reads such a table as ONE query inside `listOwnedRowsForExport`, after the E-2 scope and E-3 deny checks: `.eq('user_id', session id).limit(2)`, no order, no `gt`, no other filter; 0 rows ok-empty, 1 ok, 2 fail the section closed; the ceiling applies. CI (`tableExportProblems`): with `rowKey` it must be `'user_id'`, the scope `user_id`, `user_id` not in `columns`, no `rowFilter`. **New converse CI rule:** an `include` without `rowKey` must list `id` (it lived only at runtime before). A test pins `marketing_consent_settings` as the only `rowKey` descriptor; a second one is an SA item |
| SA-Q2 | All ten sections are `client_records` / processor, in the order above |
| SA-Q3 | `marketing_consent_state` excluded as derived (Q11: 0 key mismatches, 0 disagreements, 0 orphan state rows) |
| SA-Q4 | `questions`, `segment_filter`, `trigger_config` go out whole. `business_subscribers.attribution` goes through `SOURCE_METADATA_KEYS` (the DE-4 list, by identity). `marketing_consent_events.evidence` goes through the new `CONSENT_EVIDENCE_KEYS = ['client_statement', 'confirmed_via', 'note']`, strings only. C-5: every writer of `segment_filter` / `trigger_config` is owner-authenticated or a server constant (DE-6 workplan Dev notes) |
| SA-Q5 | Deny-list hardening: `ip_hash_salt`, `user_agent`, `session_id`, `ip_address`, `fingerprint` added to `SECRET_COLUMN_DENY_EXACT`, and `/_salt$/` to `SECRET_COLUMN_DENY_PATTERNS` ("secrets and visitor tracking"). No DE-1…DE-5 include is hit; `DENY_EXCEPTIONS` keeps its one entry |
| SA-Q6 | `email_sequence_enrollments.next_send_at` out (`QUEUE_STATE`); `current_step_number` in |
| **SA-Q7** | Page URLs lose their query string and fragment: a string is cut at the first `?` or `#` (plain slicing, never `new URL()`); scheme, host and path kept; non-strings pass through. Applied to `consent_records.source_page_url` and to the subscriber `attribution` keys `capture_page_url` / `referrer_url` (C-2). `privacy_policy_url` is kept as held (§11.2: 0 with a query string, C-3) |
| SA-Q8 | `email_normalized` out on both tables (`DERIVED_COPY`) |
| SA-Q9 | `lead_responses` excluded as activity; its purge note left as it is |
| SA-Q10 | `marketing_consent_events.recorded_by` out (`ACTOR_ID`); live 8 of 8 are the owner |

**F-DE6-1 (TL decision 2026-10-16): the one deliberate change to DE-4 output.** `crm_contacts.source_metadata.referrer_url` carries token-like parameters on 4 live contacts, and `capture_page_url` comes from the same public `page_url` (§11.2). The same strip helper now applies to the `clients` section's `source_metadata.capture_page_url` and `referrer_url`. It is a deliberate DE-4 re-pin, marked `DE-6 (F-DE6-1):` in code, with tests that seed `?token=…&sid=…#frag` and assert none of it reaches the body. A value without `?` or `#` is byte-identical to DE-4. Every other DE-1…DE-5 select, section, group and role is unchanged (C-7: the 23 earlier select strings are compared against the literals of origin/main `98735db9`).

**Final column lists (as built; `columns` ∪ `excludedColumns` = the live set of each table):**

| Table → section | In | Out | Total |
|---|---|---|---|
| `user_intake_settings` → `intake_settings` | 5 | `user_id` | 6 |
| `business_intake_forms` → `intake_forms` | 8, incl. `questions` (whole), `generated_at` | `user_id`, `generated_from` | 10 |
| `email_campaigns` → `email_campaigns` | 11, incl. `segment_filter`, `status`, `scheduled_at`, `sent_at` | `user_id`, 5 × counters | 17 |
| `email_sequences` → `email_sequences` | 8, incl. `trigger_config` | `user_id`, 3 × counters | 12 |
| `email_sequence_steps` → `email_sequence_steps` | 8 | `user_id`, 3 × counters | 12 |
| `email_sequence_enrollments` → `email_sequence_enrollments` | 7 | `user_id`, `next_send_at` | 9 |
| `business_subscribers` → `newsletter_subscribers` | 12, incl. `attribution` (allow-listed, URLs cut) | `user_id`, `email_normalized` | 14 |
| `marketing_consent_events` → `consent_records` | 17, incl. `statement_text`, `statement_locale`, `statement_version`, `privacy_policy_url`, `source_page_url` (cut), `evidence` (allow-listed), `redacted_at` | `user_id`, `email_normalized`, `ip_hash`, `ip_hash_salt`, `user_agent`, `session_id`, `recorded_by` | 24 |
| `marketing_consent_settings` → `consent_settings` | 13 (no `id` exists; `rowKey: 'user_id'`) | `user_id` | 14 |
| `email_unsubscribes` → `email_unsubscribes` | 5 | `user_id` | 6 |

The exact lists are the `*_EXPORT` descriptors in `lib/business-os/purge/descriptors.ts`, pinned literally in `exportClassification.test.ts` (`DE6_PINS`) and byte for byte in the route characterization test.

**Notes for DE-8b (binding):**

| # | Note |
|---|---|
| README: current consent | The current answer for an address is its latest consent record (a withdrawal wins a tie). For email, `email_unsubscribes` and `newsletter_subscribers.status` give it directly (BC-6) |
| README: privacy notice | Only the current hosted privacy notice text is stored (`consent_settings.privacy_policy_body`); each consent record keeps the exact sentence agreed and the notice link it was shown (R-5) |
| README: erased people | A redacted record reads `redacted@invalid` with `redacted_at` set: a decision existed and was erased (BC-8) |
| README: page addresses | Page addresses in consent records, newsletter sign-ups and client sources are shown without their query string (SA-Q7, F-DE6-1) |
| CSV | The ten sections follow the DE-4 CSV rule; `questions`, `segment_filter`, `trigger_config`, `attribution` and `evidence` go as JSON text in one cell |

**User request 2026-10-16 (for DE-10a):** DE-10a (admin export) lives in **`/admin/users`, in the business area, placed just ABOVE the Danger Zone**, and it is the **LAST Phase 1 slice**. Noted at the Phase 1 order (§0.4.1 G).

**As built (measured on the branch, 2026-10-16):** 155 table descriptors = **33** `include` + **5** `planned` (DE-7) + **117** `exclude`. On the 12 DE-6 rows, `level`, `order`, `scope`, `snapshot`, `area` and notes are unchanged (purge suites green). The export file holds 8 `account` sections and 26 `client_records` sections. The 23 earlier selects are byte-identical (SA C-7); the only earlier output change is F-DE6-1.

### 0.11 DE-7 status, TL defaults and SA rulings (2026-10-17)

**DE-7 (website and content): code complete 2026-10-17, uncommitted on `feature/data-export-de7` (merged up to origin/main `16cb2a1f`, which carries DE-6 PR #443), awaiting SA code review and QA.** T-0 live read done (TL, prod read-only; DE-7 workplan §11.1). SA workplan review approved with conditions C-1…C-10 and rulings SA-Q1…SA-Q12 (2026-10-17). **Owed:** the T-10 drift check (Q14: 84 declared names, five tables, one FULL OUTER JOIN; expect 0 rows), which TL runs as read-only SQL from the workplan. Workplan: [BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md).

**What it delivers:** the JSON download (`GET /api/user/data-export`) gains five sections in a new group, `content` (AgentPilot the processor, the account holder the controller; SA-Q3), after `email_unsubscribes`: `website_content` (the website text per section), `website_pages` (every website and landing page, every status), `website_blocks` (the content of every block on those pages, hidden ones included), `smart_links` (every link, on or off) and `images` (the `user_media` picture library RECORDS; the files themselves arrive in DE-8b's "Your files"). Each is one table with an explicit column list and a written reason for every column left out, read through the DE-4 `BusinessDataExportRepository`, keyed on the session user's id, inside the Phase 1 row ceiling. `format_version` stays 2 (additive). `export_metadata.groups` gains `content`, the only change to earlier output. There is no migration, no new route, file, dependency or flag.

**Business calls: TL defaults 2026-10-17 — user may change.** The user authorised an autonomous run, so TL took these defaults, following the user's earlier decisions (activity out, tracking out, everything we hold in). These DE-7 BC numbers are separate from the BC numbers of DE-2…DE-6.

| # | Question | Default | Effect |
|---|---|---|---|
| BC-1 | Smart-link click, sign-up and attributed-revenue totals | **Out** (activity; the revenue total is derived and has no currency of its own). TL default 2026-10-17 — user may change | `click_count`, `conversion_count` (`VISIT_STATS`) and `revenue_cents` (`ATTRIBUTED_REVENUE`) are `excludedColumns`; the link itself (short code, name, destination, campaign tags, on/off) is in |
| BC-2 | Switched-off smart links, including system-created ones | **In**, with on/off. TL default 2026-10-17 — user may change | No row filter |
| BC-3 | Draft, unpublished and archived pages | **In**, with status. TL default 2026-10-17 — user may change | No row filter |
| BC-4 | Website text the assistant drafted | **In** (the owner's published content). TL default 2026-10-17 — user may change | `content_generated_at` (a timestamp) is in; no generation inputs are stored on these tables |
| BC-5 | The picture library, descriptions included (for an assistant-made picture, the request the owner typed; also the alt text) | **In**. TL default 2026-10-17 — user may change | Every `source` (stock, generated, upload) in; `description` in |
| BC-6 | Public web addresses and short codes | **In**. TL default 2026-10-17 — user may change | `slug`, `subdomain`, `custom_domain`, `smart_links.code`, `public_url` in |
| BC-7 | Hidden blocks | **In**, marked hidden (`enabled`). TL default 2026-10-17 — user may change | No row filter |
| BC-8 | Page views and visitor data | **Out** (already decided; restated). TL default 2026-10-17 — user may change | `website_page_views` and `smart_link_clicks` stay `exclude` (visitor tracking) and are pinned never read |

**SA rulings recorded here (DE-7 workplan review, 2026-10-17):**

| Ruling | Change |
|---|---|
| **SA-Q1 (new pattern, rule 7): the parent-scoped read** | `website_blocks` has no `user_id` (a block belongs to a page, the page to the owner). It is read inside `listOwnedRowsForExport`, never by a caller-supplied id: first the owner's page ids, `website_pages.select('id').eq('user_id', session id)`, keyset paged (the ownership oracle, the same E-4 boundary as every other section); then the blocks, `.in('page_id', chunk)` as the first filter, per chunk of `EXPORT_LIMITS.VIA_PARENT_CHUNK` (100) ids, keyset paged on `id`; every returned block is then checked against its chunk (V-6), so a PostgREST or proxy that ignored `.in` fails the section instead of leaking. Rejected: a PostgREST `!inner` embed (one missing character returns every tenant's blocks), a view or `SECURITY DEFINER` RPC (breaks E-1, needs a migration), a `user_id` column on `website_blocks` (migration and five write paths; a reasonable future follow-up), excluding the table (loses the page content), one query per page |
| SA-Q1 hardening C-1…C-6 | **C-1** V-6 per chunk; `id` and `page_id` must be strings; a repeated `id` after the final sort fails the section. **C-2** final sort in code-unit order, never `localeCompare` (source pin). **C-3** `lastId` resets per chunk. **C-4** past `ROW_CEILING` parent ids the read stops `overCeiling` with no child query; parent ids never count against the row budget. **C-5** order: Zod, E-2 resolve, V-1…V-3 at request time, E-3 for the child AND the parent, then the reads; a `via` scope without the opt-in keeps the DE-4 `not_user_scoped` code; the parent is resolved from the child descriptor's own table name. **C-6** each parent id must be a canonical lowercase uuid before it joins the set; `.in()` gets a plain string array |
| **SA-Q2** | Two-key opt-in: the `include` classification gains `viaParent?: { parent, fk }`, which must deep-equal the purge `scope` (`via`). Checked in CI (`tableExportProblems` + the new `viaParentProblems`: one hop, the parent a `user_id`-scoped `include` listing `id`, no `rowKey`, no `rowFilter`; the child lists `id` and the fk) and again at request time (`viaParentOf`). A purge scope changed to `via` alone still reads nothing. Only `website_blocks` carries it (pinned); a second one, or any via-of-via, is an SA item. Repository header E-2 amended accordingly |
| SA-Q3 | New group `content`: processor, controller `account_holder`, description "Your website, landing pages, smart links and picture library. You, the account holder, are the controller of this content. AgentPilot hosts it on your behalf, as its processor." |
| SA-Q4 | Section ids `website_content`, `website_pages`, `website_blocks`, `smart_links`, `images`, in that order; the blocks after their parent |
| SA-Q5 | `user_media.storage_path` out (`DOCUMENT_STORAGE`, the DE-4 text byte for byte); `public_url` in (already public on the site and inside block content) |
| SA-Q6 | `user_media.source_ref` out (`REUSE_KEY`: a stock library id or a hash of a picture request, used only to avoid fetching or paying twice); `source` in |
| SA-Q7 | Every jsonb column out whole (Q6 key census clean); no allow-list |
| SA-Q8 | URLs kept as held (0 token-like query parameters live; the 3 `destination_url` query strings are the owner's own UTM tags); no row mapper |
| **SA-Q9: the planned flip** | Every table is now classified: 155 = 38 `include` + 0 `planned` + 117 `exclude`. `PLANNED_TABLES_ALLOWED` is now `false`, so **the CI forbids `planned` on any table** from DE-7 on. The `planned()` helper is removed from `descriptors.ts` (a new table is classified on the spot); the `planned` type variant and `PlannedTableSlice` stay, marked "forbidden on tables since DE-7", for the CI rule and its negative controls. Every control that planted on `smart_links` "because still planned" moved to `website_page_views` (excluded) with its asserted message, each shown red once. Buckets keep their own `planned` until DE-8b (`PLANNED_FILES_ALLOWED` stays `true`). The DE-2 skill rule needs no change (with the flag false, `planned` is no longer an escape hatch) |
| SA-Q10 | Chunk 100 parent ids per `.in` (about 3.7 kB of URL); rows sorted by `id` after collection, so "rows are in `id` order" holds for every section |
| SA-Q11 | Counters out per BC-1; `code` in (public, matches no deny rule) |
| SA-Q12 | `user_media.description` in (the owner's own words and the site's alt text, not system generation metadata); `website_pages.content_generated_at` in (a timestamp, as DE-6 `generated_at`) |
| C-8 | The 33 earlier select strings and all DE-1…DE-6 output are byte-identical to `6f309f39` (the characterization literals are untouched; DE-7 adds six literals: five sections and the parent `id`) |

**Final column lists (as built; `columns` ∪ `excludedColumns` = the live set of each table, 84 names):**

| Table → section | In | Out | Total |
|---|---|---|---|
| `website_content` → `website_content` | 22: `id`, the 19 jsonb sections (incl. `intake_form`), `created_at`, `updated_at` | `user_id` | 23 |
| `website_pages` → `website_pages` | 22, incl. `slug`, SEO text, `theme`, `client_flow`, `status`, `subdomain`, `custom_domain`, `content_generated_at`, `template_id` (bare id) | `user_id` | 23 |
| `website_blocks` → `website_blocks` | 9, incl. `page_id`, `content`, `styles`, `enabled`, `capability_config` (no `user_id` column; `viaParent`) | — | 9 |
| `smart_links` → `smart_links` | 13, incl. `code`, `destination_url`, the UTM tags, `is_active`, `metadata` | `user_id`, `click_count`, `conversion_count`, `revenue_cents` | 17 |
| `user_media` → `images` | 9, incl. `public_url`, `source`, `section`, `description`, `width`, `height` | `user_id`, `storage_path`, `source_ref` | 12 |

The exact lists are the `*_EXPORT` descriptors in `lib/business-os/purge/descriptors.ts`, pinned literally in `exportClassification.test.ts` (`DE7_PINS`, with the inline live set from §11.1) and byte for byte in the route characterization test.

**Notes for DE-8b:**

| # | Note |
|---|---|
| **File mapping: PROPOSAL (SA-Q5), not a DE-8b decision** | The files manifest comes from the `STORAGE_DESCRIPTORS` `include` buckets listed under `{user_id}/` (`website-images`, `contact-documents`). The zip entry is the object name with the `{user_id}/` prefix removed, under the bucket's folder. Any link column DE-8b adds to `images` / `client_documents` (for example `file_in_export`, the zip-relative path) is COMPUTED from DE-8b's own internal, non-exported read of `storage_path`, and never writes our raw storage key. **DE-8b's workplan rules the column name and whether it exists** |
| **Owed: Q10b** | DE-8b's workplan carries Q10b: `website-images` objects without a `user_media` row (logos before F-27, older uploads: still in "Your files", the bucket listing is the inventory), rows without an object, and objects outside an owner folder. Not run in DE-7 |
| README: pages | `website_content` holds only the owner's edits, merged over the block content; to rebuild a page, read `website_blocks` (the base) and `website_content` together |
| README: smart links | Click, sign-up and revenue totals are not in the file (BC-1); the payments themselves are in `payments` |
| README: subdomain | `website_pages.subdomain` is a per-page copy; `business_profile.subdomain` is the authority (one live owner differs, exported as stored) |
| README: amounts | `website_content.payment_button` keeps its own `amount` and `currency` exactly as held (CLAUDE.md § Currency) |
| CSV | The five sections follow the DE-4 CSV rule; every jsonb column goes as JSON text in one cell |

**As built (measured on the branch, 2026-10-17):** 155 table descriptors = **38** `include` + **0** `planned` + **117** `exclude`. On the 5 DE-7 rows, `level`, `order`, `scope`, `snapshot`, `area` and notes are unchanged (pinned; purge suites green). The export file holds 8 `account`, 26 `client_records` and 5 `content` sections. A run reads `website_pages` twice (its section, then the parent ids) and reads `website_blocks` only when the owner has a page. Jest time: about +2.8 s summed over the six touched suites (warm, local; in the existing required job, off the `next build` path), reported to SA under C-10.

Follow-up (QA-E3, Low): pin `ReadInputSchema` so `opts` may only ever contain `maxRows` (a schema-shape test), so a deliberately renamed caller key cannot slip past the D-10 scan.

### 0.12 DE-8a status, SA rulings, TL defaults and the PROD apply plan (2026-10-17)

**DE-8a (export foundation, Phase 1 cut): code complete 2026-10-17, uncommitted on `feature/data-export-de8a` (merged up to origin/main `fdaf90c1`, which carries DE-7 PR #446), awaiting SA code review and QA.** Nothing is applied to PROD yet. Workplan: [BUSINESS_OS_DATA_EXPORT_DE8A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE8A_WORKPLAN.md) (SA workplan review 2026-10-17: approved with C-1…C-11, rulings Q-1…Q-13). TL pre-check done on PROD read-only (workplan §9.2, §9.3): nothing exists under the new names, no storage policy of any kind, default privileges hand new public tables and functions to `anon` and `authenticated`, the live cleanup function carries stamp `789e4758d674b561` (20261047), pg_cron is not installed.

**What it delivers (no route, no cron, no UI, no zip code: those are DE-8b):**

| Piece | As built |
|---|---|
| Table `public.business_os_data_exports` | One row per export job: who (`user_id` → `auth.users` ON DELETE CASCADE; `requested_by` with **no** FK, SA Q-2; `requested_by_kind` owner / admin), status `queued` (Phase 2 only) / `running` / `ready` / `failed` / `expired`, failure reason, bytes, file and row counts, the dates, `owner_downloaded_at` (SA Q-7). Dates, counts and bytes only, never content. 11 named CHECKs; the expiry CHECK is NULL-safe and fixed at 72 hours (SA C-1, C-2). RLS on, **no policy**, every privilege revoked from PUBLIC / anon / authenticated / service_role, then service_role gets exactly SELECT, INSERT, UPDATE, DELETE (SA Q-4, C-4). No trigger. A partial unique index allows one `queued` / `running` row per account |
| Start function `public.business_os_data_export_start(uuid, uuid, text)` | **SECURITY INVOKER**, VOLATILE, `SET search_path = pg_catalog, public, pg_temp`, EXECUTE for service_role only. Order: guard the inputs (22023), per-account advisory lock, turn a `running` row older than 90 s into `failed` / `timeout`, one at a time (`in_progress`, retry at that row + 90 s), three per rolling 24 h over `running`, `ready`, `expired` (`daily_limit`, retry at the third-newest + 24 h), insert (a unique violation is answered as `in_progress`). It takes no job id; every statement is scoped `user_id = p_user_id` |
| Bucket `business-data-exports` | Private, 50 MB, `application/zip` only, no policy (asserted, not dropped). Objects at `{user_id}/{job_id}/1.zip`, built only by `exportObjectPath` from two uuids. **Stays empty until DE-8b**, which ships the writer and the 3-day sweep in one PR (SA Q-6) |
| Repository `BusinessOsDataExportJobRepository` | `startForOwner(sessionUserId)` and `startForAdmin(targetUserId, adminUserId)` (SA C-10: an owner route cannot build a mismatched call), `findById`, `findLatestForUser`, `listForUser`, `markReady`, `markFailed`, `markOwnerDownloaded`, `expireOtherReady`, `markExpired`, and the two cross-account sweep reads for the DE-8b cron, `listDueForExpiry`, `findJobsByIds`. Zod on every input (invalid input never reaches the database), Pino, `{ data, error }`, every per-account method filtered by `(id, user_id)` |
| Registrations (§0.3.3) | Purge descriptor (`level: 'purge'`, area `data_exports`, LEAF, snapshot `ids`, export `exclude`: the export itself), storage descriptor (`purge`, `{user_id}/`, `exclude`), `PurgeArea` + admin label "Data exports", `USER_OWNED_TABLES`, classification baseline 156. Classification totals now 156 = 38 include + 0 planned + 118 exclude |
| Audit event names (no emitter yet) | `DATA_EXPORT_REQUESTED` info, `DATA_EXPORT_READY` **info**, `DATA_EXPORT_FAILED` warning, `DATA_EXPORT_DOWNLOADED` info, `DATA_EXPORT_EXPIRED` info, `DATA_EXPORT_DOWNLOADED_BY_ADMIN` **critical**; audience `shared` |
| `fflate` | `0.8.3` exact as a direct dependency. The lockfile changes by one line in the root dependency list; the installed package entry is unchanged, so nothing new is downloaded |
| Scripts for TL | `scripts/precheck-business-os-data-exports.sql` (read-only, Q1…Q11, Q11 = SA C-9), `scripts/check-business-os-data-exports.sql` (read-only, 18 rows + VERDICT; FAIL before apply, PASS after both migrations), `scripts/probe-business-os-data-exports.sql` (P1…P14 as service_role, always rolled back), `scripts/rollback-business-os-data-exports.sql`, `scripts/measure-data-export-size.sql` (the M-1 text plus the new bucket) |

**SA rulings recorded here (DE-8a workplan review, 2026-10-17):**

| Ruling | Change |
|---|---|
| **Q-1: SECURITY INVOKER replaces the "SECURITY DEFINER" wording of §0.4.1 and §0.3.2 SQ-E8** | The only caller is service_role, which already holds the table privileges and bypasses RLS, so DEFINER would add owner rights nobody needs; INVOKER fails closed if a grant ever widens. The post-condition asserts `prosecdef = false`. Precedents 20261023 and SA-Q69. Wherever §0.3 or §0.4.1 says the limit RPC is SECURITY DEFINER, read SECURITY INVOKER |
| **Q-9: audit severities** | `DATA_EXPORT_READY` is **info**, not critical: critical feeds the Health "Critical audit events" tile and the 7-year class, and an ordinary self-export must not raise an operational alarm (as password changes and refunds, #157/#160). GDPR + SOC2 flags kept. `DATA_EXPORT_DOWNLOADED_BY_ADMIN` is **critical** (business call B-2). FAILED warning; REQUESTED, DOWNLOADED, EXPIRED info |
| Q-2 | `requested_by` is the admin's auth user id from the session, never `admin_users.id`; no FK. The audit row's `actor_id` is the durable link |
| Q-3, C-7, C-8 | The generated cleanup migration ships in this PR (two-migration shape below). `FUNCTION_REQUIRED_TABLES` carries `business_os_data_exports` → `20261074`, so 20261075 refuses until 20261074 is applied |
| Q-4, Q-5, Q-6, Q-7, Q-8, Q-10, Q-11, Q-13 | Service-role table with no owner policy; storage helpers in DE-8b; retention cron in DE-8b with the writer; `owner_downloaded_at` column; concurrency evidence = unique index + lock pinned in Jest + the in-transaction probe (two simultaneous sessions are not shown anywhere, PGlite is one connection too); limits as SQL literals mirrored by `EXPORT_JOB_POLICY` and pinned by the migration test; one tsc-forced label line; no `admin_users` check in the function |
| C-1…C-6, C-9, C-10 | NULL-safe 72-hour expiry CHECK; probe runs every start as service_role (`SET LOCAL ROLE`) and checks the role is restored; service_role least privilege; VOLATILE pinned; severities as Q-9; a checker FAIL row (and a pre-check query, and a post-condition) for any storage policy open to browser roles that does not name a bucket; `startForOwner` / `startForAdmin` |
| Q-12 and forward notes for DE-8b | The daily cron also turns stale `running` rows into `failed` / `timeout` (same predicate, scoped by each row's own `user_id`). The route's `maxDuration` stays at 60 s or less, below the 90 s stale rule. Uploads set `contentType: 'application/zip'`. Writer and sweep ship in one PR |

**The two-migration shape and the chaining rule with finance 4b.1.** A new table with a foreign key to `auth.users`, a new purge descriptor and a new bucket change the test-account cleanup plan, so DE-8a carries **two** hand-applied migrations: `20261074_business_os_data_exports.sql` (this slice) and `20261075_operator_test_account_cleanup_data_exports.sql`, **generated** by `scripts/generate-test-account-cleanup-sql.ts`, never hand-written (the drift test enforces it), with its generated rollback in `supabase/SQL Scripts/`. New cleanup stamp `a824848e0a538477`. Finance 4b.1 (`20261072` + `20261073`) regenerates the same function and was **not** on main when DE-8a was built, so DE-8a chains on `20261047` (now pinned as applied history). Per SA C-7, whichever lands second takes the next free number above the first one's: **if DE-8a merges first, finance 4b.1 renumbers its regenerated cleanup to 20261076 or later and chains on 20261075** (allowed: 20261073 is unapplied); if 4b.1 merges first, DE-8a re-merges, chains on 20261073, and TL applies 20261072 → 20261073 → 20261074 → 20261075 in numeric order. A lower-numbered cleanup file is never applied after a higher one, and an applied file is never renumbered or edited.

**Business calls: TL defaults 2026-10-17 — user may change** (workplan §15.1; SA accepted all three).

| # | Question | Default |
|---|---|---|
| B-1 | How long do we keep the record that an export happened (date, size, who started it, whether the owner downloaded it; never any of the data)? | **Until the account is deleted.** The file itself is always deleted after 3 days. TL default 2026-10-17 — user may change |
| B-2 | Should an admin downloading a customer's data raise a flag on the Health page and be kept 7 years? | **Yes** (the customer is not told, already decided). Implemented by the `critical` severity alone. TL default 2026-10-17 — user may change |
| B-3 | For a few minutes after release, until the database step is applied, account deletion and the test-account cleanup refuse | **Accepted** (both refuse safely; nothing is lost). TL applies right after the deploy. TL default 2026-10-17 — user may change |

**PROD apply plan (TL, by hand, after SA ✅, QA ✅ and the merge):**

| Step | What | Gate |
|---|---|---|
| 0 | Confirm finance 4b.1 has not merged first; if it has, DE-8a re-chains first (above) | — |
| 1 | Re-run `scripts/precheck-business-os-data-exports.sql` | Q1 all NULL, Q5 / Q6 / Q11 empty, Q8 false / false, Q9 still the 20261047 stamp |
| 2 | Right after the deploy, apply `supabase/migrations/20261074_business_os_data_exports.sql` | Its post-condition passes, else nothing is applied |
| 3 | Apply `supabase/migrations/20261075_operator_test_account_cleanup_data_exports.sql` | It refuses until 20261074 is applied |
| 4 | Run `scripts/check-business-os-data-exports.sql` | `VERDICT PASS 18/0` |
| 5 | Run `scripts/probe-business-os-data-exports.sql` with TL's own user id pasted | `PROBE PASS P1 to P14` (an expected error; everything rolled back) |
| 6 | `npm run schema:reconcile` (read-only) | 0 unclassified, 0 missing for the new table |
| Rollback, only if needed | First the generated `supabase/SQL Scripts/20261075_operator_test_account_cleanup_data_exports_rollback.sql`, then `scripts/rollback-business-os-data-exports.sql` (it refuses while the bucket holds files or the 20261075 function is still live; it leaves the empty bucket row for the Storage dashboard), then RM reverts the PR | — |

**PROD apply record.** 20261074 applied by TL (post-condition passed). 20261075 applied by the user in the SQL editor on 2026-10-17; TL then ran the checker: `VERDICT PASS 18/0`. Extra read-only probe: the cleanup function is SECURITY DEFINER, owned by postgres, names `business_os_data_exports` and the `business-data-exports` bucket, carries stamp `a824848e0a538477` (old `789e4758d674b561` gone), EXECUTE for service_role only.

Between the deploy and step 3 (minutes) the deployed build names a table that is not live and pins the new cleanup stamp: Reset / Purge / admin delete and the test-account cleanup refuse. Nobody deletes an account in that window (B-3).

**Evidence (Dev, 2026-10-17):** Jest only in CI (file scans and a mocked client, in the existing Tests job: no added critical-path time). Locally, the migration, the checker, the probe and the rollback were run on PGlite 0.5.8 (Postgres 18.3, one connection) with stubbed `auth.users`, `storage.buckets` / `objects` and Supabase-like roles and default privileges: checker FAIL before, `PASS 18/0` after; probe `PROBE PASS P1 to P14` with zero rows left; post-condition refused eight planted faults with nothing applied; the probe caught four planted function faults. Recorded in the workplan; scenario evidence, not concurrency evidence (SA Q-8).

### 0.13 DE-8b status, SA amendments and TL defaults (2026-10-17)

**Status:** DE-8b **code complete, uncommitted** on `feature/data-export-de8b` (worktree `neuronforge-de8b`, merged with `origin/main` after DE-8a PR #451). Awaiting SA code review, then QA. No migration, no new dependency, no entitlements import. Workplan: [BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md). The SA workplan review (2026-10-17) approved it with conditions C-1 … C-16; the amendments below are binding for Phase 1 and win over §0.3 and §0.4.1 where they differ.

**What DE-8b built.** `POST /api/business-os/data-exports` (one request, `maxDuration = 60`): auth → strict empty body → the existing `create` throttle → `startForOwner(user.id)` → pre-flight file ceiling (listing only) → bounded records pass → downloads → one zip (README en + he, `data.json`, one CSV per section, `files-index.csv`, "Your files") → finished-size and time check → upload `{user_id}/{job_id}/1.zip` → `markReady` → 120 s signed URL named per DX-10. `POST /api/business-os/data-exports/[jobId]/parts/1/download` (download again). Daily `/api/cron/data-export` at `25 5 * * *` (reap, 3-day expiry, orphan sweep, 60% size watch), in the same PR (SA DE-8a Q-6). The two file buckets are classified `include` (`client-documents`, `website-images`); `planned` is now forbidden on buckets. The JSON route `GET /api/user/data-export` and its 4 MB cap are **unchanged**; the four "Export data" buttons still call it.

**SA amendments (DE-8b workplan review, 2026-10-17):**

| # | Amends | Ruling |
|---|---|---|
| Flag | §0.4.1 B ("behind `isBusinessOsDataExportEnabled`, env, default off, until DE-9") | **No env flag.** `isBusinessOsDataExportEnabled` / `NEXT_PUBLIC_BUSINESS_OS_DATA_EXPORT_ENABLED` is not built. **The owner-facing switch is DE-9's merge**: DE-8b ships no UI, so the new routes are live but unlinked. They act only on the caller's own data, behind `getUser()`, the database limit (1 at a time, 3 a day) and the request throttle |
| Q-1 | §0.7 C-11 (body cap) | The JSON route, its 4 MB cap, `DATA_EXPORTED` and its characterization test stay byte-identical in DE-8b. **Removing the cap moves to DE-9**, the slice that switches the buttons and retires the JSON route. `ownerTimezone` moved to `ownerClock.ts` as a pure move |
| Q-3 | §0.4.1 C ("rows from `count` head queries") | **The bounded records pass is the row check.** It reads at most 100,000 rows and stops before any file download, which is "before any heavy work" |
| Q-6 | §0.4.1 A ("delete any object older than 3 days without a live job row") | **10-minute grace**: an export object is kept only if a job row has the same id **and** the same `user_id` as its folder and is `running` or `ready`; otherwise it is removed once older than 10 minutes. Only objects named exactly `{uuid}/{uuid}/1.zip` are candidates (C-10); anything else is counted and left alone |
| Q-7 | §0.4.1 C ("one aggregate over `storage.objects`") | **The size watch walks the Storage API** (no migration) and reuses **the export's own file inventory**, so a document orphan never inflates it (C-11) |
| C-7 | §0.3.2 / §0.4.1 A ("download again" as `GET`) | **Download again is `POST`** with a strict empty body: it records `owner_downloaded_at` and `DATA_EXPORT_DOWNLOADED`, and a cross-site `GET` would carry the Lax session cookie |
| C-16 | §0.4.1 E (file name `…-<YYYY-MM-DD>.zip`; ASCII fallback `data-export-<date>.zip`) | The zip name keeps the time: `<slug>-data-export-YYYY-MM-DD-HHmm.zip` (DE4-U1 extended to the zip), stamped from the job's `created_at` on the owner's clock. The no-name and ASCII fallback is `agentpilot-data-export-YYYY-MM-DD-HHmm.zip` |
| Q-8 | — (forward note, **binding on DE-10a**) | The zip route writes no `DATA_EXPORTED`; owner visibility is acceptable for every DE-8b event. **DE-10a:** an admin-started `DATA_EXPORT_REQUESTED` and `DATA_EXPORT_DOWNLOADED_BY_ADMIN` written with `entityType 'user'` against the target account would be readable by the owner, contradicting BQ-SA-2 (no notice to the owner). DE-10a must write those under an **operator-only entity type** (new type, classified in `AUDIT_ENTITY_OWNER_VISIBILITY` and the RLS policy mirror) or otherwise prove they are hidden |
| Q-12 | — | The cron reap writes `DATA_EXPORT_FAILED` with `userId` = the row's own `user_id`, `actorId: null` and `details.actor_kind: 'system'` (no "system" actor id is invented) |
| Q-13, Q-17 | DE-7 SA-Q5 proposal | Document entries are named from `contact_documents.file_name` (Hebrew survives) under `files/client-documents/<contact_id>/`; pictures keep their cleaned storage path under `files/website-images/`. `clean()` is a security control: the public intake upload stores the uploader's file name verbatim (C-4) |
| Q-15 | — | The start route uses the existing `rateLimit` rule `create` (10 per 900 s), the download route `read` |
| Q-16 | — | A truncated file inventory fails the export (`error`): "Your files" is never offered as complete when it is not |

**TL defaults 2026-10-17 (§20.1 of the workplan; autonomous run — user may change):**

| # | Business call | TL default 2026-10-17 — user may change |
|---|---|---|
| BC-1 | Spreadsheet cells that start with `= + - @` (phone numbers like `+972…` included) get a leading apostrophe; `data.json` keeps the exact value | Yes, protect |
| BC-2 | Instructions file language | Both English and Hebrew, always |
| BC-3 | Client documents in the zip | Original file names (Hebrew kept), one folder per client id |
| BC-4 | Website pictures with no picture-library record (logos, older uploads) | Included |
| BC-5 | A file that cannot be read during packaging | The export still completes; the instructions file says how many are missing |
| BC-6 | Handing over the link counts as "the owner downloaded it" (feeds the DE-10a delete warning) | Yes |
| BC-7 | The file is unreachable after 3 days and physically deleted at the next daily clean-up (up to about one more day) | Accept (daily) |
| BC-8 | The business name is visible in the download link's address (and so in browser history) | Accept (decided in DX-10) |

**Owed after merge:** T-14 on the Vercel preview (Hebrew, English and no-business accounts; the `Content-Disposition` Storage actually sends for a Hebrew name; the zip opened in Windows Explorer and macOS Archive Utility; a CSV opened in Excel). If Storage does not send a correct `filename*`, the URL switches to `download: asciiFileName` and DE-9 saves through fetch-and-blob with the Unicode `fileName` the 200 body already carries (§0.4.1 E fallback).

**Follow-ups (Low, not blocking):** SA L-1 pin listOwnerFolders to exportSweep only; L-2 a throw after markReady reports failed while the job is ready (cosmetic); L-3 explicit maxDuration on download-again; L-4 body size cap; L-5 count failed reap removals; QA edge notes 1–5 (README orphan wording, Unicode look-alike separators, trailing-space test, 413 copy for rows → DE-9, nul.tar.gz); QA c2 test gap. T-14 Preview/prod manual check owed by TL BEFORE DE-9 switches the buttons.

### 0.14 DE-9 status, SA rulings and TL defaults (2026-10-17)

**Status:** DE-9 **code complete, uncommitted** on `feature/data-export-de9` (worktree `neuronforge-de9`, merged with `origin/main` at `4e10ebba`, DE-8b PR #453). Awaiting SA code review, then QA. No migration, no new dependency, no entitlements import, no new table or bucket. Workplan: [BUSINESS_OS_DATA_EXPORT_DE9_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE9_WORKPLAN.md). SA workplan review 2026-10-17: approved with conditions C-1 … C-11.

**Merge gate (T-0b): T-14 is NOT yet recorded.** There is no env flag (§0.13), so **merging DE-9 is the owner-facing switch**. The PR must not merge until TL records the DE-8b T-14 Preview result in the DE-8b workplan. DE-9 is built in save mode A (the page navigates to the signed URL, Storage answers `Content-Disposition: attachment`). If T-14 shows a wrong `filename*`, mode A is replaced by mode B (fetch and blob with the Unicode `fileName`), about +0.5 d (SA Q9: one mode ships, never both).

**What DE-9 built.**

- **One control, `DownloadMyDataButton`** (`components/business-os/data-export/`), on all four entry points: the Business OS settings Security list (`row`), the Danger zone (`button`, inside `ErasureRequestContent`), `/settings` `SecurityTab` and `/v2/settings` `SecurityTabV2` (`button`, BC-1). Every outcome of the zip routes has its own copy in en / he / es (`downloadMyDataCopy.ts`; he and es are drafts for native review). The status line reads "Last export {date}. You can download it again until {until}. Download again".
- **One browser seam**, `lib/client/businessOsDataExport.ts`: `startDataExport`, `downloadDataExportAgain`, `fetchLastDataExport`, `saveSignedDownload`. Refusals are read from the body `code`; 401 and 429 by status; a non-JSON body (a platform 502 / 504) is `timeout`; a 75 s client timer (AbortController + setTimeout) is `client_timeout`.
- **`GET /api/business-os/data-exports`** ("Last export") on the existing route file, backed by the new `BusinessOsDataExportJobRepository.findLatestCompletedForUser` (`user_id`, `requested_by_kind = 'owner'`, status `ready` or `expired`, newest one). The query string is ignored; a job id leaves the server only while that export is downloadable; no counts; no audit; `read` throttle under `data-export-status`.
- **Retired:** `GET /api/user/data-export` and both its test files, `lib/client/downloadUserDataExport.ts` and its test, `EXPORT_LIMITS.JSON_BODY_MAX_BYTES` (the §0.7 C-11 cap), `exportFileName` and its `sections.test.ts` block (its winter-time and behind-UTC clock cases moved to `fileName.test.ts`), the five `settings.security.export_*` keys in en / he / es and the three in the Danger zone's `FALLBACK_COPY`. `app/api/user/data-export/__tests__` left `test:bos-entitlements`.
- **Kept:** `EXPORT_GDPR_ARTICLE` (written into `data.json` meta), `findForUserDataExport` (the zip builder's profile read), `AUDIT_EVENTS.DATA_EXPORTED` (historical rows carry it).
- **Support contact moved, unchanged:** `PLACEHOLDER_ERASURE_CONTACT` and its `TEMP-ERASURE-CONTACT` marker now live in `lib/business-os/supportContact.ts`, the single swap point read by both the Danger zone and the new control (SA C-3). The N2 pin is repo-wide.

**SA rulings (DE-9 workplan review, 2026-10-17):**

| # | Ruling |
|---|---|
| Q1 / UI-1 | **Option A, an inline notice inside the control** (`DataExportNotice`, in the control's folder, presentation only; no `components/ui` primitive until a second consumer and SA review). Both live regions (`role="status"`, `role="alert"`) exist from the first paint. **Nothing auto-dismisses.** The email in "too large" is wrapped in `<bdi>` so Hebrew cannot reorder it. `sonner` and the hybrid were rejected |
| Q2 | The JSON route is **deleted (404)**, not a 410 tombstone |
| Q3 + C-4 | `GET` status route + `findLatestCompletedForUser`, **owner-requested jobs only** |
| Q4 | Closing the dialog while preparing keeps the request; the file is still saved on 200 |
| Q5 + C-5 | 75 s client timeout, AbortController + setTimeout, cleared in `finally`; the one-shot 30 s status reload after a client timeout is cleared on unmount |
| Q6 | `test:bos-entitlements` drops the deleted folder only; the zip route tests run in the required Jest gate |
| Q7 | Owner audit labels for `DATA_EXPORT_*`: out of DE-9 (follow-up) |
| Q8 + C-7 | `EXPORT_GDPR_ARTICLE` and `findForUserDataExport` stay; `exportFileName` and `JSON_BODY_MAX_BYTES` go |
| Q9 | One save mode only (A), no `EXPORT_SAVE_MODE` constant |
| C-1 | Dates use explicit Intl fields (`year`, `month: 'short'`, `day`, `hour`, `minute`, `timeZoneName: 'short'`): `dateStyle` / `timeStyle` with `timeZoneName` throws. Tested with the real Intl |
| C-2 | `lib/audit/__tests__/ownerAuditReads.guard.test.ts` re-pointed at the two zip routes (they read no audit rows), negative controls kept |
| C-3 | The contact constant moved to one neutral module (above) |
| C-6 | `saveSignedDownload` follows `https:` only (`http:` only for localhost in development); anything else is a failure and never navigates |
| C-8 | In the Danger zone the control is one stacked block beside "Contact us"; no `flex-row-reverse` wrapper |
| C-9 | Live regions as in Q1; a notice stays until dismissed or replaced by the next action |
| C-10 | `{limit}` from `EXPORT_JOB_POLICY.DAILY_LIMIT`, dates through the C-1 formatter; the parity test checks every placeholder in all three languages |
| C-11 | This splice; §0.4.1 B's "flag on after QA" is superseded by §0.13 (no flag: the switch is this merge) |

**TL defaults 2026-10-17 (§10.1 of the workplan; autonomous run — user may change):**

| # | Business call | TL default 2026-10-17 — user may change |
|---|---|---|
| BC-1 | The agent-platform settings screens' own export card | The same "Download my data" button (one export everywhere) |
| BC-2 | The old JSON download | Retired (route, browser helper, 4 MB limit) |
| BC-3 | The email named in "too large, contact support" | The same contact as the Danger zone, `PLACEHOLDER_ERASURE_CONTACT`. **It is today the product owner's personal Gmail address, shown to every owner.** The code keeps one swap point (`lib/business-os/supportContact.ts`); **the user is asked to supply a support address** (accept for now and swap later is technically fine, a one-line change) |
| BC-4 | "Download my data" when an export is already ready | Always prepares a fresh one; "Download again" below hands over the existing one |
| BC-5 | Button name | "Download my data" (DX-5), he / es to match |
| BC-6 | A "what's included" line under the button | No; the README in the zip explains it |

**Supersessions (each also noted in place):**

- §0.4.1 B row DE-9, "the old GET route is retired": **done**.
- §0.7 C-11, the 4 MB body cap: **removed**.
- **FR-E14** (one export control): met by `DownloadMyDataButton` on all four entry points.
- **FR-E15** and **AC-E22** ("every export writes `DATA_EXPORTED`"; "Last exported shows the latest `DATA_EXPORTED` date"): **superseded**. The zip writes `DATA_EXPORT_REQUESTED` / `READY` / `FAILED` / `DOWNLOADED` / `EXPIRED`, and "Last export" reads the jobs table through `GET /api/business-os/data-exports`.
- **AC-E1** ("each export button downloads `GET /api/user/data-export`"): **superseded**; each entry point renders the one control, which calls the zip routes. The first half (no browser request to the four tables) still holds and is pinned by `pluginConnectionsBrowserAccess.guard.test.ts`.

**Forward notes, binding on DE-10a (from SA C-4):**

1. **Download again must answer 404 to the owner for an admin-kind job.** Today `findById` filters only by `id` and `user_id`, so an owner who learned an admin job's id could fetch it. The status route already never returns one; DE-10a closes the download route the same way.
2. **`expireOtherReady` treats owner and admin jobs alike today**: a new owner export expires a ready admin export of the same account, and the reverse. DE-10a must decide (and pin) how the two kinds replace each other, so neither silently replaces the other's export.

**Owed / follow-ups:** T-14 (merge gate, above); the manual browser check after deploy (TL list in the workplan); native review of the he / es copy; owner audit labels for `DATA_EXPORT_*` (SA Q7); a support mailbox (BC-3).

**Follow-ups (Low):** QA E-1 daily_limit refusal with no retryAt shows the in-progress text (useDownloadMyData noticeFor); E-2 focus after dismiss; E-3 stale snippet docs/CLIENT_DATA_REMOVAL_IMPLEMENTATION.md L339; E-4 --v2-border fallback on /settings; SA: when the support address is swapped also clean lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler.ts and prompt templates that send the personal email to an LLM as sample text; SA: SecurityTab.tsx direct Supabase calls (rule 1) on the parked agent-platform screen.

### 0.15 DE-10a status, SA rulings and TL defaults (2026-10-17)

**Status:** DE-10a (admin: export status, prepare, audited download) **code complete, uncommitted** on `feature/data-export-de10a` (worktree `neuronforge-de10a`; merged `origin/main` and then `origin/feature/data-export-de9` at `e7fbc24a`, by merge, never rebase). Awaiting SA code review, then QA. No migration, no env flag, no new dependency, no new table, bucket or CI job. Workplan: [BUSINESS_OS_DATA_EXPORT_DE10A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10A_WORKPLAN.md). SA workplan review 2026-10-17: approved, rulings SA-1 … SA-11, binding conditions W10-1 … W10-12.

**Depends on DE-9 (PR #454, held until T-14).** This branch carries DE-9's commit. Its PR targets `main` and merges only **after #454 is on `main`** (no stacked PR into the DE-9 branch). DE-10a is the **last Phase 1 slice** (user request 2026-10-16, §0.4.1 G).

**What DE-10a built.**

- **Three admin routes**, `requireAdmin` the first statement of each, registered in the gate oracle (`adminGate.writes`, 65 → 68 handlers): `GET /api/admin/users/[id]/data-exports` (the last 10 exports: who, when, state, sizes, owner downloaded or not; no link, no file name; not audited), `POST /api/admin/users/[id]/data-exports` `{ reason }` (prepares an export with the owner's own `runZipExport` and the target's context; counts against the account's 3 a day, DX-4; returns **no link**) and `POST …/data-exports/[jobId]/parts/1/download` `{ reason }` (the only admin link: job read scoped by the path account → **write-ahead `DATA_EXPORT_DOWNLOADED_BY_ADMIN` with `writeNow`, critical** → 503 `audit_unavailable` and nothing signed if it was not written → a 60 s link). Ids from the path and the session only; bodies `.strict()`.
- **One audit builder**, `lib/business-os/data-export/adminExportAudit.ts`: every admin-path row is admin-owned (below).
- **Owner path changes (DE-9 C-4 notes):** owner "download again" reads `findOwnerJobById` (owner-requested jobs only), so an admin job id is a 404; `markOwnerDownloaded` is owner-kind only; `expireOtherReady` replaces only older exports **of the same kind**, the kind read from the ready row; the file name rule moved, unchanged, to `lib/business-os/data-export/downloadName.ts` (both routes name the file one way).
- **Cron sweep:** the reap and retention rows of an admin-kind job (or any kind that is not exactly `owner`) are written with no user and no actor.
- **UI:** a sixth boxed section **"Data export"** in the `/admin/users` business drawer, between Activity and the Danger area (admin dark tone): the status list, "Prepare export" and "Download (audited)…" with a reason dialog, the "owner has not downloaded" warning, nothing in the Danger area disabled or hidden by it.

**SA rulings (DE-10a workplan review, 2026-10-17):**

| # | Ruling |
|---|---|
| SA-1 | **Admin-owned audit rows** satisfy DE-8b Q-8's "otherwise proven hidden" branch: `user_id = actor_id = the admin`, `entity_type 'user'`, `entity_id = the target`, `details.target_user_id`. The owner reads audit rows only where `user_id` is theirs (the one owner policy, verified on PROD by TL §13.1; every in-app owner reader filters by the session id). Covers every row about an admin job: REQUESTED, READY, FAILED, replaced EXPIRED, DOWNLOADED_BY_ADMIN. No operator entity type, no migration. Supersedes nothing (§0.3.4 already said `user_id = admin`) |
| SA-2 | Cron rows on admin-kind jobs: `userId: null`, `actorId: null`, `details.actor_kind 'system'`, `requested_by_kind 'admin'`, `target_user_id` (the invites N-6 precedent). Owner-kind rows unchanged |
| SA-3 | `AuditTrailService` untouched. D-7 is **closed for admin-path rows** by an explicit `actorId = admin` on every input; "explicit null means no actor" stays open (F-3) |
| SA-4 | `expireOtherReady(userId, keepJobId, kind)`; the kind comes from the row `markReady` returned, never a caller argument |
| SA-5 | `findOwnerJobById` for the owner route; `findById` unchanged for the admin route and the engine re-read; `markOwnerDownloaded` owner-kind only |
| SA-6 | `downloadName.ts` is a pure move; the owner file name is byte-identical (the owner route's name assertions were kept unedited) |
| SA-7 | A signing failure after a written DOWNLOADED_BY_ADMIN is a 500 with no compensating row |
| SA-8 | The status GET is not audited; REQUESTED non-blocking; READY / FAILED bounded flushes; DOWNLOADED_BY_ADMIN is the only write-ahead row |
| SA-9 | **BD-4 amended: six drawer sections, not five** (Data export between Activity and the Danger area, at the user's request); the L-12 "five groups" pins became six, the Danger area is still last |
| SA-10 | The prepare returns no link; the download route is the only admin link minter |
| SA-11 | **Changed from the workplan:** status throttled on `RATE_LIMITS.read`, prepare on `RATE_LIMITS.create`, **download on `RATE_LIMITS.write`** (every call writes a critical row and raises the Health tile) |

**TL defaults 2026-10-17 (workplan §14.1; autonomous run — user may change):**

| # | Business call | TL default 2026-10-17 — user may change |
|---|---|---|
| BC-1 | Prepare and download: one action or two? | **Two**, each with a reason; the download reason is pre-filled with the reason of the prepare the admin just made |
| BC-2 | May an admin download an export the owner made (within its 3 days)? | **Yes**, recorded the same way (DX-7) |
| BC-3 | Do an owner's and an admin's new exports replace each other? | **No**; each replaces only its own kind. An account can hold two ready files for up to 3 days |
| BC-4 | When does the box warn "the owner has not downloaded an export"? | When the owner's newest export was not downloaded by them, or they never exported. In the new box; the hidden AD-2 delete preview gets its line when AD-2 is switched on |
| BC-5 | Show the box for a login with no Business OS business? | **Yes** |
| BC-6 | May an admin use the admin path on their own account? | **No** (refused server-side; they use "Download my data") |
| BC-7 | Must an admin download appear in that business's Activity list in the drawer? | **No**: it is in the Audit trail and raises the Health "Critical audit events" tile |
| BC-8 | (DX-4 consequence) An admin-prepared export uses one of the owner's 3 per day | Noted; no new decision |

**Accepted side effect (for the user, no change):** because the 3-a-day limit is shared (DX-4), an owner whose own "Download my data" is refused with "in progress" or "daily limit" can infer that *something* used their allowance or is running. That reveals no admin identity, reason or file and is not an owner notice in the BQ-SA-2 sense.

**Follow-ups (not DE-10a scope):**

- **F-1 (Medium, pre-existing class).** Admin-owned rows live under the admin's own `user_id`, so the admin's **own** Purge "activity history" option, or a deletion of the admin's own account, would erase the record of their admin actions on other accounts. This already applies to AD-1b, AD-2a and the test-account cleanup outcome rows. Purge is inert today: **fix before Purge is enabled** (for example exclude admin-on-target rows from that scope, or store them with `user_id NULL`, `actor_id = admin`). A platform-wide decision.
- **F-2 (Low).** The admin sees these rows in their own `/monitoring` (target id and reason in details). Their own action, as AD-1b; revisit with F-1.
- **F-3.** D-7: "explicit null means no actor" across the null-actor callers (SA-3).
- **Follow-ups (Low):** QA — add `?userId=` query cases to both admin POST route tests; padded-reason trim test on prepare; daily-limit wording 'its 3 exports'; pre-existing gate-oracle KNOWN GAP (handler missing from oracle not detected). SA — write an admin FAILED row when `runZipExport` throws in prepare (today the cron reaps it null/null); count 404/410 download answers in the failure throttle bucket.

**Phase 1 status: complete in code, pending T-14 and the merges.** With DE-10a every Phase 1 slice of §0.4.1 B is built. Phase 1 is done once DE-8b T-14 is recorded, DE-9 (#454) is merged, and this slice passes SA, QA and its merge. Then the user decides the Phase 2 next steps (§0.4.1 F).

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

> **Superseded in part (user BC-5, 2026-10-15, DE-4):** the B2 row lists `external_calendar_events`. It is **out** of the export (synced copy of the owner's own outside calendar). B2 as built is `scheduling_services`, `scheduling_bookings`, `scheduling_availability_exceptions`. See [§0.7](#07-de-4-status-user-decisions-and-notes-for-de-8b-2026-10-15).

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
    *DE-9 note (2026-10-17): met by `DownloadMyDataButton` on all four entry points (§0.14).*
15. **FR-E15** Every export writes a `DATA_EXPORTED` audit row, non-blocking, with section counts and never contents. An admin-triggered send (DE-10) also writes an `operator`-class row.
    *DE-9 note (2026-10-17): superseded. The JSON route that wrote `DATA_EXPORTED` is retired; the zip writes `DATA_EXPORT_REQUESTED` / `READY` / `FAILED` / `DOWNLOADED` / `EXPIRED` (§0.13, §0.14). `DATA_EXPORTED` stays as a constant for historical rows.*
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
  *DE-9 note (2026-10-17): the second sentence is superseded. Each entry point renders the one control, which calls the zip routes (`POST /api/business-os/data-exports`, download again); the JSON route is retired (§0.14). The first sentence still holds.*
- [ ] AC-E2 A Jest guard fails if any `'use client'` file calls `.from('plugin_connections')` (negative control included).
- [ ] AC-E3 The downloaded file contains no `access_token`, `refresh_token` or other credential key (test account with a connected plugin).

**DE-0b**
- [ ] AC-E4 After the migration, `column_privileges` shows no SELECT / INSERT / UPDATE / REFERENCES for `anon` or `authenticated` on the two token columns. Signed in as an owner, reading `access_token` fails (42501).
- [ ] AC-E5 Connecting a plugin, refreshing a token and every browser feature that lists connections still work (QA manual check, named flows from the SQ-E3 inventory).
- [ ] AC-E6 The rollback script restores the previous privileges exactly, and the checker reports both states.

**DE-1**
- [ ] AC-E7 No export read uses `*` (guard). The audit section contains the owner's visible rows and none of the BD-26 hidden types (fixture with one of each).
  - **Note (2026-10-15, DE-1):** the audit half no longer applies: the audit section left the export (DX-1d, §0.3.1), and a guard proves the route reads no audit rows. See §0.5.
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
  *DE-9 note (2026-10-17): the date source is superseded. "Last export" reads the newest owner-requested `ready` or `expired` job through `GET /api/business-os/data-exports` (§0.14), not `DATA_EXPORTED`.*
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

> **User decisions 2026-10-14 for DX-1 to DX-9 are in [§0.2](#02-user-decisions-2026-10-14)** and override the recommendations above where they differ.

### 9.2 Technical questions for SA

- [ ] **SQ-E1** Where does export classification live: (i) an export map in `businessOwnedTables.ts` keyed by both lists (like `accountDeletionPolicy`), or (ii) an `export` field on the purge `descriptors.ts`, which the `SchemaReconciler` already checks against live columns (making FR-E19 almost free)? BA leans to (ii), or (i) **derived** from one source, given SA-1's "two registries" finding. How is column drift checked with no DB in CI? (raised by: BA | status: open)
- [ ] **SQ-E2** DE-0a UX: with a plain `<a href>` there is no success/error promise. Use `fetch` + blob from the server route (keeps the toasts, still no DB in the browser), or drop the toasts? BA leans to `fetch` + blob. (raised by: BA | status: open)
- [ ] **SQ-E3** DE-0b: inventory every browser read and write of `plugin_connections` (connect, OAuth callback, token refresh, connection lists, plugin tester) and confirm none touches the token columns, or move them server-side first. Also: should `anon`'s table-level privileges on `plugin_connections` go entirely? Should the 27 refresh tokens be rotated? BA's view is no forced rotation without evidence of misuse, since exposure was to each owner's own browser, but SA rules. Column-level REVOKE with table-level grants in place has a known Postgres subtlety: a table-level SELECT grant still covers every column. The migration may need to revoke at table level and re-grant the other columns. (raised by: BA | status: open)
- [ ] **SQ-E4** Serverless limits on our Vercel plan: maximum synchronous response size and duration, streaming vs buffered, and the background threshold. Does a zip need a new dependency (rule 7), or is the existing xlsx writer enough? (raised by: BA | status: open)
- [ ] **SQ-E5** Soft-deleted rows per section (the `agents` "includes deleted" precedent). (raised by: BA | status: open)
- [ ] **SQ-E6** Reuse of `lib/payments/ledgerService`: include its workbook as an extra file, or only follow its conventions? (raised by: BA | status: open)
- [ ] **SQ-E7** Classify the borderline tables: `website_page_views` (visitor IP or user agent?), `derived_metrics`, `daily_briefing_sends`, `external_calendar_events`, `business_events`, and where `email_sends` bodies are stored. (raised by: BA | status: open)
  - Note (2026-10-15, DE-4): SA ruled this in §0.3.1. The `external_calendar_events` part of that ruling ("in") is superseded by the user (BC-5): **out**. See [§0.7](#07-de-4-status-user-decisions-and-notes-for-de-8b-2026-10-15).
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
| 2026-10-14 | User decisions DX-1…DX-9 (§0.2) | New §0.2 records the decisions as a table keyed by DX id, plus a pointer under the §9.1 table and a status-update line. Changes from BA: DX-1 profile details only (no credits/billing/plan), activity out, open GDPR note for the lawyer; DX-4 one background engine, in-app export page behind sign-in reached from one email link, 3-day retention, 1 at a time / 3 per day, split into records + files; DX-6 customer export offered not required, typed acknowledgement to delete; DX-7 owner and admins, admin downloads audited. DX-9 moot. Linked the new [async evaluation](/docs/requirements/BUSINESS_OS_DATA_EXPORT_ASYNC_EVALUATION.md) |
| 2026-10-14 | SA ruling: delivery design, classification, slice plan (§0.3) | Scope rulings under DX-1 (billing/credits/activity out, `email_sends`/page views/audit out, agents kept pending BQ-SA-1, soft-deleted out, ledger conventions only). SQ-A1…A6: Pro plan, no zip streamed from a function (signed URLs only), no QStash (in-process 25 s start + 1-minute drain cron on the §8.1 pattern), part-per-zip resumable design with no assemble step, `fflate` approved (rule 7), private `business-data-exports` bucket, best-effort consistency, rate limit in the enqueue RPC, 3-day sweep incl. orphans. SQ-A6 registrations. SQ-E1: a required `export` field on purge descriptors (tsc + Jest, no added CI time), report-only column drift in `SchemaReconciler`. Admin routes (POST download, confirmed audit, 60 s URL), export-before-delete wiring. Slice plan DE-0b…DE-10b + M-1 measurement. BQ-SA-1, BQ-SA-2 raised |
| 2026-10-14 | User decisions round 2 (§0.4) | M-1 result recorded (~28 MB / 80 files in total, largest account ~14 MB). Delivery made incremental: Phase 1 = small accounts, one zip on screen; large-account parts wait for the user's decision after Phase 1. BQ-SA-1: agents and agent settings removed (Business OS only). BQ-SA-2: no owner notice. DX-10: business name in the file name, AgentPilot in the README. SA to re-cut the slice plan |
| 2026-10-14 | SA ruling: Phase 1 re-cut (§0.4.1) | Phase 1 = one request builds one zip (records + files), uploads to the private `business-data-exports` bucket (50 MB) and returns a 120 s signed URL; no queue, parts table, drain or email. Jobs table kept (rate limit in the start RPC, stale-run rule at 90 s, failed jobs not counted); one daily `/api/cron/data-export` for the 3-day sweep and a size watch. Ceiling 40 MB / 150 files / 100,000 rows / 45 MB zip / 40 s, refused before upload with a clear message and an `over_ceiling` audit; warn at 60%. BQ-SA-1 applied in DE-1/DE-2/DE-3. DX-10 file-name and controller rules. Admin "send export to owner" moved to Phase 2. Phase 1 ~14.5 d; Phase 2 list recorded, not scheduled |
| 2026-10-14 | User decisions on Phase 1 trade-offs (§0.4.1 H) | Admin "send export to owner" deferred to Phase 2; "contact support" above the Phase 1 ceiling accepted. Phase 1 plan approved for building |
| 2026-10-14 | DE-0b shipped | PR #381 merged + deployed; 20261068 applied to PROD; checker PASS 46/0; probe 42501. B-9 click-through owed |
| 2026-10-14 | DE-0b B-9 waived; DE-0 complete | The user waived the B-9 manual checks (all agent-platform flows; that app is parked). DE-0 (DE-0a + DE-0b) complete |
| 2026-10-15 | DE-1 code complete (§0.5) | Uncommitted on `feature/data-export-de1`, awaiting SA code review. Six sections out (DX-1, BQ-SA-1), section model with FR-E12 `failed`, typed payload `format_version: 2`, `logAndFlush`, Danger zone through the shared helper, file name `agentpilot-data-export-<date>.json`. Q-3 ruling recorded (`profiles.plan` removed). AC-E7 note (audit half no longer applies). C-6 notes for DE-2 (disconnected = status), DE-3 (`hourly_rate_usd` / `role` / `org_id`), DE-8b (`business_profiles.business_name` does not exist, 42703) |
| 2026-10-15 | DE-2 code complete; SA rulings and user decisions (§0.6) | Uncommitted on `feature/data-export-de2`, C-3 live read done (drift 0, missing 0) and SA code-approved the same day. Required `export` field on every purge descriptor and bucket (155 + 3); CI enforcement is the Jest runtime check `exportClassification.test.ts`: **the §0.3.6 tsc clause is superseded** (SA-Q1 declined widening `typecheck:bos-llm`). BC-1 (modules switched on) and BC-2 (organisation record) = No, both `exclude`. SA-Q4: drift surfaced by the new `npm run schema:reconcile`, not `schema:check` (supersedes §0.3.6 / FR-E19 wording); SA-Q5 `exportColumnsMissing`. SA-Q9 follow-up: `intent_examples` is user-owned without a `user_id`. SA-Q12: skill text diverges from Appendix A (points at `descriptors.ts`, names buckets and `schema:reconcile`) |
| 2026-10-15 | DE-4 code complete; user decisions BC-1…BC-7; calendar out (§0.7) | Uncommitted on `feature/data-export-de4`, awaiting SA code review; `schema:reconcile` owed before merge. Eight `client_records` sections (clients, notes and history, tasks, pipeline stages, document details, services, bookings, time off) in today's JSON export, through one read-only descriptor-driven repository (SA-Q1), keyset-paged on `id` to an empty page, deleted documents out via a descriptor `rowFilter` (SA-Q2). User decisions 2026-10-15: BC-1 internal notes in, BC-2 all history in, BC-3 archived in / deleted out, BC-4 `source_metadata` readable keys only (named allow-list), **BC-5 `external_calendar_events` out (supersedes §0.3.1 SQ-E7, §3.1 B2, §9.2 SQ-E7; notes added there)**, BC-6 sent-markers out, BC-7 `ai_suggestions` out. `DENY_EXCEPTIONS` + `crm_pipeline_stages.stage_key` (SA-Q5). Phase 1 ceiling built in today's route: 413 `export_too_large` over 100,000 rows or a 4 MB body (exact bytes), no file, no `DATA_EXPORTED`. DE-8b conditions (C-11): the files manifest drops objects whose `contact_documents` row is deleted or missing; the 4 MB body cap goes when the signed-URL zip replaces the JSON response |
| 2026-10-15 | DE-4 post-review: T-9 recorded; user decisions DE4-U1 / DE4-U2; DX-1 note extended (§0.2, §0.7) | SA F-3: T-9 done by TL's read-only SQL (§10.2 of the DE-4 workplan: drift 0, missing 0, `contact_documents.status` NOT NULL), closing "`schema:reconcile` owed before merge". DE4-U1: file name `agentpilot-data-export-YYYY-MM-DD-HHmm.json` on the owner's clock (`user_preferences.timezone`; NULL / invalid / unreadable gives UTC; never fails the export). DE4-U2: connected apps (`plugin_connections`) dropped from the export: descriptor `exclude`, section, reader, allow-list, deny exception and `listForUserDataExport` removed; totals 9 include / 36 planned / 110 exclude. §0.2 DX-1 open lawyer note now names connected apps alongside activity |
| 2026-10-15 | User manual check DE-1 PASS; UI-1 folded into DE-9 (§0.7) | Danger zone Export works. UI-1: the export result message must use the system's standard success/error notification on all 4 export entry points, plus a clear "too large — contact support" message for `too_large` (QA DE-4 Low 1); SA picks the pattern in the DE-9 workplan review. No DE-4 code change |
| 2026-10-16 | DE-3 code complete; user decisions BC-A…BC-G; SA rulings (§0.8) | Uncommitted on `feature/data-export-de3`, awaiting SA code review; T-9 drift check (157 names, five tables) owed, TL runs it as read-only SQL. Four `account` sections (preferences, notification settings, business profile, business addresses) through the DE-4 repository; `profiles` loses `hourly_rate_usd` and `org_id`, keeps `role`. BC-A agent-platform settings out (`AGENT_SETTING`, verbatim); BC-B invoice bank details out (`BANK_DETAILS`, verbatim) incl. `invoice_payment_instructions` (SA R-2); `invoice_tax_id` in (SA R-1); BC-C…BC-G confirmed. SA-Q1 single-row read dropped (all tables have `id`). DE-8b README note: three timezone columns (authority, mirror, quiet hours only). Totals 13 include / 32 planned / 110 exclude |
| 2026-10-16 | DE-5 code complete; user decisions BC-1…BC-12; SA rulings (§0.9) | Uncommitted on `feature/data-export-de5`, waiting for SA code review. T-10 drift check (249 names, ten tables) owed: TL runs it as read-only SQL. Ten money sections: 2 `account` (payment account, payment providers) and 8 `client_records` (quotes, invoices, payments, refunds, payment plans, client payment plans, instalments, client payment methods). Five money tables excluded: reminders, event log and automation runs (activity), built-in rules, and dead `payment_methods`. **BC-3: the Stripe invoice web and PDF links are IN, which overrides the workplan default and SA-Q5.** BC-1: card brand and last 4 only. BC-11: no totals. SA-Q3: `payments.metadata` limited to `notes` and `source` through the new `pickStringKeys` (DE-4 `sourceMetadata` output byte-identical). SA-Q6: refund fee columns have no currency, plus the DE-8b README wording. SA-Q7: `charge_account_kind` out. SA-Q11: `card_number`, `cvc` and `cvv` added to the deny list. Totals 23 include / 17 planned / 115 exclude |
| 2026-10-16 | DE-6 code complete; TL defaults BC-1…BC-8; SA rulings; F-DE6-1; DE-10a placement (§0.10) | T-10 done by TL: 0 drift / 0 missing over 124 names; SA code-approved + QA PASS 2026-10-16 (28/28 negative controls); committed on `feature/data-export-de6` by RM. Ten `client_records` sections (intake settings, intake forms, email campaigns, sequences, steps, enrollments, newsletter sign-ups, consent records, consent settings, do-not-email list); `lead_responses` and `marketing_consent_state` excluded. TL defaults 2026-10-16 (user may change): visitor evidence, lead messages and delivery counters out; all form versions, sign-ups and redacted consent records in. SA-Q1: `rowKey: 'user_id'` single-row read for `marketing_consent_settings`, plus the CI rule "include without rowKey lists id". SA-Q5: visitor-tracking names and `/_salt$/` on the deny list. SA-Q7: page URLs cut at the query string. **F-DE6-1: the same cut on DE-4 `clients.source_metadata` `capture_page_url` / `referrer_url`, the one deliberate change to earlier output.** User request: DE-10a in `/admin/users`, business area, just above the Danger Zone, last Phase 1 slice. Totals 33 include / 5 planned / 117 exclude |
| 2026-10-17 | DE-7 code complete; TL defaults BC-1…BC-8; SA rulings incl. the parent-scoped read; the planned flip (§0.11) | Uncommitted on `feature/data-export-de7`, awaiting SA code review and QA; T-10 drift check (Q14, 84 names, five tables) owed, TL runs it as read-only SQL. Five sections in the new `content` group (processor; the account holder the controller): website text, website and landing pages, blocks, smart links, picture library records. TL defaults 2026-10-17 (user may change): smart-link counters and attributed revenue out; switched-off links, drafts and archived pages, assistant-drafted text, every picture with its description, public addresses and hidden blocks in. **SA-Q1 (new pattern): `website_blocks` is read through the owner's own pages** (`viaParent` two-key opt-in, `.in('page_id', chunk)`, every block checked against its chunk, C-1…C-6). `storage_path` and `source_ref` out. **The planned flip: every table is classified; the CI now forbids `planned` on tables; the `planned()` helper is removed.** DE-8b file-mapping recorded as a PROPOSAL; Q10b owed to DE-8b. Totals 38 include / 0 planned / 117 exclude |
| 2026-10-17 | DE-8a code complete; SA rulings Q-1 (SECURITY INVOKER replaces the DEFINER wording) and Q-9 (severities); two-migration shape; TL defaults B-1…B-3; PROD apply plan (§0.12) | Uncommitted on `feature/data-export-de8a`, awaiting SA code review and QA; nothing applied to PROD. Jobs table `business_os_data_exports` (service role only, RLS on with no policy, NULL-safe 72-hour expiry CHECK), start function `business_os_data_export_start` (INVOKER, VOLATILE, service_role EXECUTE only; one at a time, three per rolling 24 h, failed never counts, 90 s stale rule), private 50 MB zip bucket `business-data-exports` (empty until DE-8b), repository with `startForOwner` / `startForAdmin`, registrations (156 = 38 include + 0 planned + 118 exclude), six audit names (READY info, DOWNLOADED_BY_ADMIN critical), `fflate` 0.8.3 exact. Migrations `20261074` + generated cleanup `20261075` (stamp `a824848e0a538477`, chained on 20261047; finance 4b.1 renumbers above it if DE-8a lands first, SA C-7). Pre-check, checker, probe, rollback and measure scripts; local PGlite evidence |
| 2026-10-17 | DE-8b code complete; SA workplan amendments (no env flag, Q-1, Q-3, Q-6, Q-7, C-7, C-16), DE-10a audit-visibility forward note (Q-8), Q-12; TL defaults BC-1…BC-8 (§0.13) | Uncommitted on `feature/data-export-de8b`, awaiting SA code review and QA; no migration, no dependency. One-request zip route (`POST /api/business-os/data-exports`), POST download-again route, daily `/api/cron/data-export` (`25 5 * * *`: reap, 3-day expiry, orphan sweep with 10-minute grace, 60% size watch on the export's own inventory). File buckets classified `include` (`client-documents`, `website-images`); `planned` forbidden on buckets. No env flag: the owner switch is DE-9. JSON route and 4 MB cap unchanged (cap removal moves to DE-9). File name keeps `-HHmm`; fallback `agentpilot-data-export-…zip`. T-14 Preview check owed after merge |
| 2026-10-17 | DE-9 code complete; SA rulings Q1–Q9, C-1…C-11; TL defaults BC-1…BC-6; FR-E15 / AC-E22 / AC-E1 superseded; DE-10a forward notes (§0.14) | Uncommitted on `feature/data-export-de9`, awaiting SA code review and QA; no migration, no dependency. One `DownloadMyDataButton` on all four entry points (UI-1 option A: inline notice, nothing auto-dismisses); one browser seam `lib/client/businessOsDataExport.ts` (save mode A, https-only); `GET /api/business-os/data-exports` "Last export" (owner-requested jobs only, C-4). Retired: `GET /api/user/data-export` + tests, `downloadUserDataExport`, `JSON_BODY_MAX_BYTES`, `exportFileName`, the dead `export_*` copy. `PLACEHOLDER_ERASURE_CONTACT` moved unchanged to `lib/business-os/supportContact.ts` (single swap point; the user to supply a support address, BC-3). **Merge gated on T-14** (no flag: the merge is the switch). DE-10a must 404 download-again for admin jobs and settle `expireOtherReady` owner vs admin |
| 2026-10-17 | DE-10a code complete; SA rulings SA-1…SA-11 (SA-11 changed: download on the write throttle); TL defaults BC-1…BC-8; follow-ups F-1…F-3; Phase 1 complete in code (§0.15) | Uncommitted on `feature/data-export-de10a`, carrying DE-9 (#454); the PR merges only after #454 is on `main`. No migration, flag or dependency. Three admin routes (status, prepare, audited download with a write-ahead critical `DATA_EXPORT_DOWNLOADED_BY_ADMIN`, 503 if not recorded, 60 s link), gated from birth and in the gate oracle (68). Every admin-path audit row admin-owned through one builder; admin-job cron rows with no user and no actor; owner download-again 404 on admin jobs; same-kind replacement; shared `downloadName.ts`. Sixth drawer section "Data export" above the Danger area (BD-4 → six sections). Accepted side effect: the shared 3-a-day limit lets an owner infer usage, no notice. F-1: admin-owned rows erasable by the admin's own activity purge or account deletion (also AD-1b, AD-2a, cleanup rows), fix before Purge is enabled; F-2 rows in the admin's own `/monitoring`; F-3 D-7 null actor. **Phase 1: every slice built; complete pending T-14 and the merges** |
| 2026-10-17 | 20261075 applied to PROD; checker 18/0; contents reference added | User applied the generated cleanup migration; TL checker `PASS 18/0` (§0.12). What the zip holds and how it is packaged is now documented in [BUSINESS_OS_DATA_EXPORT_CONTENTS.md](/docs/business-os/BUSINESS_OS_DATA_EXPORT_CONTENTS.md); scope review (export only owner-proprietary data) sent to Offir and Eyal for a second opinion |
