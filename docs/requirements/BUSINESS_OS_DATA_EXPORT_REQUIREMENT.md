# Requirement: Business OS — Export My Data

> **Last Updated**: 2026-10-15

**Created by:** BA
**Date:** 2026-10-05
**Status:** Draft, **PARKED until the admin delete (AD-2, AD-3, AD-4) is finished** — the whole export scope, **including DE-0 (token exposure)**, runs LAST (user decisions 2026-10-05, DX-11 = no). Open business questions DX-1 to DX-10 and DX-12 are asked when the work resumes, then SA review (§9.2). **Re-baseline §1 against main first** (PR #218 merged 2026-10-05; see SQ-E10).
**Status update (2026-10-14):** the user decided DX-1 to DX-9 (see [§0.2](#02-user-decisions-2026-10-14)). Where §0.2 differs from the BA recommendations in §9.1 or from §3 / §5 / §6 / §8, **§0.2 wins**. DX-10 and DX-12 stay open.
**Status update (2026-10-15):** **DE-0 is complete** (DE-0a + DE-0b shipped; the user waived DE-0b's B-9 manual checks on 2026-10-14, see §0.1.4). **DE-1 is code complete**, uncommitted, on `feature/data-export-de1`, awaiting SA code review (see [§0.5](#05-de-1-status-and-notes-for-later-slices-2026-10-15)).

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
