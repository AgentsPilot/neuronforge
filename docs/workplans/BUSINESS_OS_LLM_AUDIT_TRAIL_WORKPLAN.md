# Workplan: Business OS LLM — Layer 3: AI Activity Audit Trail

> **Last Updated**: 2026-09-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_AUDIT_TRAIL_REQUIREMENT.md): 28 FRs and 27 ACs. SA approved; RC-1 to RC-12 applied; user decisions D-1 to D-6. OQ-11, OQ-12 and OQ-13 are open for this review.
**Context:** [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md), and the Layer 1, 1.1 and 1.5 requirements (grouping ids per area).
**Branch:** `feature/business-os-llm-layer1-5` (worktree `neuronforge-llm-layer15`, at `main` `7646760a` — the logging clean-up, PR #50, is merged). This branch name is the user's instruction for this cycle (same folder, same branch). **Step 0 must merge and deploy before the AI-entry steps merge** (FR-21), so RM needs either two PRs from this branch or a split. See §7.
**Date:** 2026-09-18
**Status:** SA reviewed 2026-09-18. **Approved to implement**, with WC-1 to WC-12 (§10). Step 0 can start now. Steps 3 and 4 remain gated on step 0 being deployed and on the Q-4 SQL read. No code written.

## Overview

This layer does two things:
- **Step 0 secures the audit trail's own API routes.** Today they trust a user id sent by the browser and check no login.
- **It then writes one `audit_trail` entry per Business OS AI action.** Each entry summarises that action's LLM calls, gathered in-process by an `AsyncLocalStorage` accumulator that `callWithTracking` feeds. The write goes through the unchanged, queued `AuditTrailService.log()`, and is never awaited.

AI entries are hidden from every owner-scoped read.

This workplan:
- checks every file and line the requirement and SA cite against `7646760a` (§2). It found **15 mismatches or new findings, 5 of them material**;
- surveys every caller of the audit routes. There are **21 call sites of `/api/audit/log`, not 1**; six are server-to-server calls that step 0 would silently break;
- measures the live `audit_trail` schema read-only (RC-11);
- sets out the design (§3), the files and the typecheck-gate impact (§4), and a test plan per AC (§5);
- orders the work into independently shippable steps, starting with step 0 (§7).

## Table of Contents

1. [Traceability](#1-traceability)
2. [Code-Reality Check](#2-code-reality-check)
3. [Design](#3-design)
4. [Files and Gate Impact](#4-files-and-gate-impact)
5. [Test Plan](#5-test-plan)
6. [Risks](#6-risks)
7. [Steps](#7-steps)
8. [Questions for SA and the User](#8-questions-for-sa-and-the-user)
9. [Task List](#9-task-list)
10. [SA Review](#10-sa-review)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)

---

## 1. Traceability

### 1.1 Functional requirements → tasks → tests

| FR | What | Tasks (§9) | Tests (§5) |
|---|---|---|---|
| FR-21 | Step 0 first, merged and deployed before AI writes | S0 gate, T0.12 | AC-25 (release check) |
| FR-22 | Session identity, 401, no anonymous writes | T0.3, T0.4, T0.5 | T-R1, T-R2, T-W1, T-W2 |
| FR-23 | Own entries only; admin only through `AdminAccessService` | T0.3–T0.5, T0.8 (Q-3) | T-R3, T-W3, T-A1 |
| FR-24 | Zod; client cannot write `ai_action` / `BUSINESS_AI_ACTION_*`; severity and flags from metadata | T0.2, T0.4 | T-R4, T-W4, T-W5 |
| FR-25 | Every caller keeps working | T0.6, T0.7, T0.9 | T-C1, AC-24 live |
| FR-26 | No error text to clients; Pino in the three route files | T0.3–T0.5 | T-R5, code review |
| FR-1 | Exactly one entry per AI action | T2.4, T3.* | T-E1, T-AR* |
| FR-2 | The two events, `ai_action`, metadata-only severity | T2.1 | T-E2 |
| FR-3 | Account and actor; poison-pill guard | T2.4 | T-E3 |
| FR-4 | The exact field set | T2.4 | T-E4 |
| FR-5 | Never content; no `request`; no `resourceName` | T2.4 | T-E5 |
| FR-6 | Outcome rule; error code only | T2.3, T2.4 | T-E6 |
| FR-7 | No LLM call, no entry | T2.4 | T-E7 |
| FR-8 | `AsyncLocalStorage` accumulator fed by `callWithTracking` | T2.2, T2.3 | T-U1–T-U7 |
| FR-9 | Chat, plus the nested chat website operation | T3.1, T3.2 | T-AR1 |
| FR-10 | Insights, per business per run | T4.1 | T-AR2 |
| FR-11 | Briefing, with a required trigger | T4.2 | T-AR3 |
| FR-12 | Website, intake, onboarding build, dormant points | T3.3–T3.5 | T-AR4 |
| FR-13 | Leads | T4.3 | T-AR5 |
| FR-14 | Onboarding, per turn | T3.6 | T-AR6 |
| FR-15 | Images | T3.7 | T-AR7 |
| FR-16 | Never awaited; failures logged | T2.4 | T-W* (AC-15, AC-16) |
| FR-17 | Existing queued path; `AuditTrailService` unchanged | all | T-S1 (diff check) |
| FR-18 | Severity from the event name; none critical | T2.1, T2.4 | T-E2, T-E6 |
| FR-19 | Ledger unchanged | T2.2 | T-U6 |
| FR-20 | Docs | T5.1–T5.3 | AC-20 review |
| FR-27 | Owner reads exclude AI entries in the query | T0.2, T0.3, T0.10 | T-O1, AC-26 live |
| FR-28 | Direct RLS reads (OQ-11) | T1.1 (or KI-D) | AC-27 |

### 1.2 Acceptance criteria → tests

| AC | Test(s) | Kind |
|---|---|---|
| AC-1 | T-E1, T-U2, T-U4, T-U5 | unit |
| AC-2 | T-E2 | unit |
| AC-3 | T-E3 | unit |
| AC-4 | T-E4 | unit |
| AC-5 | T-E5 | unit |
| AC-6 | T-E6 | unit |
| AC-7 | T-E7, plus the no-call cases inside T-AR1, T-AR3, T-AR7 | unit |
| AC-8 | T-AR1 | unit (route, mocked) |
| AC-9 | T-AR2 | unit (cron, mocked) |
| AC-10 | T-AR3 + `@ts-expect-error` in a `*attribution*` test (gate-enforced) | unit + typecheck |
| AC-11 | T-AR4 | unit |
| AC-12 | T-AR5 | unit |
| AC-13 | T-AR6 | unit |
| AC-14 | T-AR7 | unit |
| AC-15 | T-W1 (slow `log()`), T-S1 (static: no `await` on the call, no `flush`/`shutdown`; `AuditTrailService.ts` untouched) | unit + static |
| AC-16 | T-W2 (rejecting `log()`, request path and cron) | unit |
| AC-17 | T-E6 (no critical); T-U6 (the tracker's payload is identical with a scope open and without one) | unit |
| AC-18 | Code review + the gates in §5.3 | review |
| AC-19 | L-1 (a), L-2 (b) | live, non-production |
| AC-20 | Doc review | review |
| AC-21 | T-R1, T-W1r | integration |
| AC-22 | T-R3, T-W3 | integration |
| AC-23 | T-R2, T-R4, T-W2r, T-W4, T-W5 | integration |
| AC-24 | T-C1 + live `/monitoring` check L-0 + code review | integration + live |
| AC-25 | The release record in §12 and a live query L-0b | process + live |
| AC-26 | T-O1 + live check after L-1/L-2 | integration + live |
| AC-27 | L-3 (if OQ-11 = a) or KI-D recorded and reported | live / doc |

---

## 2. Code-Reality Check

Everything below was read on `7646760a`. The live schema was measured read-only through PostgREST (§2.3).

### 2.1 Citations that hold

All of these were verified at the cited lines (± 1):

- **`AuditTrailService.ts`:** `:36-39`, `:43-44`, `:48`, `:86-102`, `:96-98`, `:112`, `:119-143`, `:182-190`, `:224-237`, `:260-282`, `:297-378`, `:383-423`, `:468-485`, `:504-506`, `:525-529`, `:537`.
- **`lib/audit`:** `events.ts:114` and `:836-841`; `types.ts:17-51`.
- **The three audit routes:** `audit/query/route.ts:11` and `:29-38`; `audit/log/route.ts:13` and `:15-18`; `audit-trail/route.ts:20`, `:59-62`, `:71` and `:106-110`.
- **The owner page and middleware:** `monitoring/page.tsx:53-57` and the CSV at `:415-435`; `(protected)/layout.tsx:612`; `middleware.ts:83`.
- **Chat and insights:** `chat-v4/route.ts:335`; `MutateExecutor.ts:811`; `insight-detect/route.ts:142`, `:205-283` and `:215`.
- **Briefing:** `BriefingStore.ts:34-56`, with the cache at `:42-49` and the narration at `:51`; `DailyBriefingDispatchService.ts:222`; `my-day/route.ts:119`.
- **Website, intake, images and onboarding:** the group-minting lines `:76`, `:91`, `:68`, `:34`, `:49`, `:67` and `:48`; `onboarding/build/route.ts:825`; `onboarding/chat/route.ts:217-218`.
- **Leads and the dormant website points:** `LeadAlertService.ts:335-338`; `WebsiteSectionService.ts:521`; `WebsiteBlockEnrichmentService.ts:271`.
- **The SQL script:** `create_audit_trail.sql:9`, `:14` and `:60-63`.

### 2.2 Mismatches and new findings

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **M-1** | **`POST /api/audit/log` has 21 call sites, not zero.** They sit in **11 client files** (15 call sites):<ul><li>`auth/callback/page.tsx:98`</li><li>`business-os/settings/page.tsx:401`</li><li>`LogoutButton.tsx:21`</li><li>`useOnboarding.ts:506`, `:542`</li><li>`useOnboarding_old.ts:333`, `:369` (no importer)</li><li>`settings/NotificationsTab.tsx:54`, `ProfileTab.tsx:282`</li><li>`SecurityTab.tsx:79`, `:152`</li><li>`v2/settings/NotificationsTabV2.tsx:46`, `ProfileTabV2.tsx:252`</li><li>`SecurityTabV2.tsx:60`, `:131`</li></ul>plus **six server-side HTTP self-calls**:<ul><li>`stripe/cancel-subscription:92`</li><li>`stripe/create-checkout:101`, `:143`</li><li>`stripe/create-portal:63`</li><li>`stripe/reactivate-subscription:100`</li><li>`onboarding/allocate-free-tier:147`</li></ul> | Repository grep (§2.4) | The client calls send the session cookie (the browser client is `@supabase/ssr` `createBrowserClient`), so a session-based route keeps them working. **The six server-side `fetch` calls send no cookie. After step 0 they would get 401 and those events would silently stop being recorded** — a regression hidden by the non-OK response they never check. → **Q-1** |
| **M-2** | **`allocate-free-tier` has never been recorded.** It posts to `${NEXT_PUBLIC_SUPABASE_URL…}/api/audit/log`, the Supabase host, not this app | `allocate-free-tier/route.ts:147` | Converting it (Q-1) would start recording `FREE_TIER_ALLOCATED` for the first time. That is a behaviour change, and it is recorded as such |
| **M-3** | **Existing callers use values that FR-24's strict validation would reject.**<ul><li>**Unregistered actions:** `USER_DATA_EXPORTED` (client), and all six server events: `FREE_TIER_ALLOCATED`, `SUBSCRIPTION_CANCELED`, `SUBSCRIPTION_CHECKOUT_INITIATED`, `BOOST_PACK_CHECKOUT_INITIATED`, `CUSTOMER_PORTAL_ACCESSED`, `SUBSCRIPTION_REACTIVATED`.</li><li>**Entity types outside the union:** `subscription`, `boost_pack`.</li><li>**A flag outside `ComplianceFlag`:** `FINANCIAL`.</li><li>`USER_LOGOUT` is in `AUDIT_EVENTS` but has **no** `EVENT_METADATA` entry (it is saved as "Unknown event").</li></ul> | `lib/audit/events.ts`; caller payloads | FR-24 "registered values only" requires registering them (T0.1), or narrowing FR-24 → **Q-2** |
| **M-4** | **`GET /api/audit-trail` is already broken and has no caller.** It calls `AuditTrail.query(filters, { limit, offset })`, which takes one argument, and then reads `events.length` on a result object (two TS errors: TS2554 at `:93`, TS2339 at `:98`). `POST /api/audit-trail` has **one** caller, `components/settings/PluginsTab.tsx:207` (body `userId`) | `tsc`; grep | GET is **removed** (FR-25 allows it). POST is kept and made to share the `/api/audit/log` handler (§3.1) |
| **M-5** | **Three admin audit reads are unauthenticated service-role reads of every account's audit rows:**<ul><li>`app/api/admin/audit-trail/route.ts` (`// TODO: Add admin role check here`, `:19`);</li><li>`app/api/admin/users/[id]/audit-logs/route.ts`;</li><li>`app/api/admin/users/[id]/login-stats/route.ts`.</li></ul>Middleware skips `/api`. They are used by `app/admin/audit-trail/page.tsx:77` and `app/admin/users/page.tsx:275` | Code read | The same class of hole as S-1, and wider: all accounts, no id needed. Once Layer 3 ships, every business's AI activity and cost is readable there by anyone. Outside FR-22's four handlers → **Q-3 (P0)** |
| **M-6** | **The SQL script defines an RLS policy keyed on user-writable metadata:** `"Admins can view all audit logs" … auth.users.raw_user_meta_data->>'role' = 'admin'`. `raw_user_meta_data` is writable by the user (`auth.updateUser({ data })`) | `create_audit_trail.sql:71-81` | **If it is live**, any signed-in user can make themselves "admin" and read **every** audit row directly. PostgREST cannot show policies, so it is unverified → **Q-4**, and it is the first thing the OQ-11 SQL check must look at |
| **M-7** | **OQ-13: the self-service GDPR export exists, and today exports no audit rows.** `app/api/user/data-export/route.ts` is linked for owners from `DangerZonePanel.tsx:145`. Its audit read (`:158-165`) filters on `timestamp`, a column that does **not** exist (verified live: `42703`). The error is discarded, so `audit_logs` is always `[]` | Live check (§2.3); code | FR-27 holds by accident today. Fixing the column would start exporting `session_id` (a credential, OI-B) and would expose AI entries → **Q-5** |
| **M-8** | **RC-11, live schema.**<ul><li>Every column the service writes exists, plus an extra `user_email text`.</li><li>`user_id` and `actor_id` are `uuid`; `entity_type` is `text`.</li><li>**No `CHECK` on `entity_type` is strongly indicated:** the latest 1,000 rows contain values outside the TS union (`stripe_connect_account`, `chat_session`, `chat`, `crm_task`, `contact_document`).</li><li>The `user_id` column comment reads *"Renamed from user_id to avoid PostgREST validation against auth.users"*, so **whether the FK to `auth.users` still exists cannot be told from PostgREST**.</li><li>58,072 rows today.</li></ul> | §2.3 | "No migration for the entity type" holds on evidence. FR-3's guard stays either way. The FK, the policies and the constraints need the SQL check in §2.3 → **Q-4** |
| **M-9** | `insight-detect/route.ts` declares **no** `runtime`. Only `daily-briefing` declares `nodejs` | grep | Harmless: route handlers default to the Node runtime, and no route in the repo declares Edge. The accumulator condition "Node only" holds |
| **M-10** | **Five** concrete providers use `callWithTracking`, not six: `anthropic`, `groq`, `kimi`, `mistral`, `openai` (chat, embeddings, images) | grep | None. Hooking the base class covers all five |
| **M-11** | `/monitoring` sends `?limit=1000&offset=0`. The query route reads `page`, not `offset` | `monitoring/page.tsx:53`; `audit/query/route.ts:26` | The Zod schema must **accept and ignore** `offset` (a strict schema would 400 the page) |
| **M-12** | The owner page displays `session_id`, `ip_address` and `user_agent` | `monitoring/page.tsx` (fields read) | OI-B, pre-existing. Not changed here |
| **M-13** | **Fire-and-forget work started inside a scope inherits the `AsyncLocalStorage` context.** The plan-cache store embedding (KI-A) would notify the chat turn's scope **after** its entry was emitted | Node semantics | The scope is **closed** at emission. Later notifications are ignored and logged at debug (§3.4) |
| **M-14** | The `new-api-route` skill's "admin-only" variation checks `user.app_metadata?.role`, which contradicts CLAUDE.md § Security Rules | `.claude/skills/new-api-route/SKILL.md` | Admin checks here use `AdminAccessService` only |
| **M-15** | Six non-compliant files are in step 0's reach:<ul><li>`console.*` in `stripe/*` (4, 3, 1, 4), `allocate-free-tier` (13), and the three admin audit routes (4, 3, 2);</li><li>the three audit routes (1, 1, 4) are already required by FR-26.</li></ul>`monitoring/page.tsx` has 6, but is **not** touched | grep | CLAUDE.md § Logging: flagged. Whether to convert depends on Q-1 and Q-3 (see Q-6) |

### 2.3 RC-11: the live schema check (read-only)

**Method.** A PostgREST OpenAPI read and zero-row selects with the service key. No row was written, no RPC was called, and no DDL was run. It was measured on 2026-09-18 against the project in the worktree's `.env.local`.

| Question | Result |
|---|---|
| Columns and types | `id uuid`, `user_id uuid`, `actor_id uuid`, `action text`, `entity_type text`, `entity_id text`, `resource_name text`, `changes jsonb`, `details jsonb`, `ip_address text`, `user_agent text`, `session_id text`, `severity text`, `compliance_flags text[]`, `hash text`, `created_at timestamptz`, **`user_email text`** (not in the script). Required: `id`, `action`, `entity_type`, `created_at` |
| `entity_type` `CHECK` | Not readable via PostgREST. **Indirect evidence says there is none:** five live values sit outside the TS union |
| `user_id` FK | Not readable. The column comment suggests it may have been renamed or re-created to avoid the `auth.users` validation |
| RLS policies | Not readable |
| `insert_audit_log` (SECURITY DEFINER, granted to `authenticated` in `SQL Scripts/20251030_create_audit_log_function.sql`) | **Not exposed:** absent from the OpenAPI paths for both the service and anon keys. Good: no RPC forgery path |
| `timestamp` column (M-7) | Does not exist (`42703`) |
| Local `SYSTEM_ADMIN_USER_ID` | Is a UUID. The production value must be checked the same way (§3.6) |

**What still needs a SQL read (Supabase SQL editor, read-only).** This needs Q-4:

```sql
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy WHERE polrelid = 'public.audit_trail'::regclass;

SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.audit_trail'::regclass;

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger WHERE tgrelid = 'public.audit_trail'::regclass AND NOT tgisinternal;
```

### 2.4 Caller survey (FR-25)

| Handler | Callers | Decision |
|---|---|---|
| `GET /api/audit/query` | `app/(protected)/monitoring/page.tsx:53` (the only one) | **Fixed.** Session identity; the owner repository read with the AI exclusion; response shape unchanged |
| `POST /api/audit/log` | The 15 client call sites in M-1: same origin, session cookie present. The 6 server self-calls in M-1 | **Fixed.** The client callers keep working unchanged: the header is ignored and the body `userId` is ignored. **The server callers are converted to in-process `AuditTrail.log()` (Q-1)** |
| `POST /api/audit-trail` | `components/settings/PluginsTab.tsx:207` | **Fixed** by delegating to the same shared write handler. The caller is unchanged |
| `GET /api/audit-trail` | none (and broken, M-4) | **Removed** |
| Anonymous writes | **No caller depends on them.** Every caller sends a user. The `'anonymous'` branch has no caller | Removed (FR-22) |
| Logout timing | `LogoutButton.tsx:15-38` logs **before** `signOut`, so the session is still valid. `business-os/settings/page.tsx:401` is to be confirmed at implementation (T0.6) | Kept |
| Scripts | No script under `scripts/` calls these routes | — |

---

## 3. Design

### 3.1 Step 0: the audit routes

**Shared pieces (new):**
- **`lib/audit/requestSchemas.ts`.** Zod schemas built from runtime lists: `AUDIT_EVENT_NAMES` (from `Object.values(AUDIT_EVENTS)`) and a new `AUDIT_ENTITY_TYPES` const array in `types.ts`, from which `EntityType` is derived so the list and the type cannot drift.
  - **Read:**
    - `limit` 1–1000 (default 50);
    - `page` ≥ 1 (default 1);
    - `action` and `severity` optional, registered values only;
    - `entityType` optional, registered values only;
    - `offset` accepted and ignored (M-11);
    - other keys stripped.
  - **Write:**
    - `action` is a registered event **and** not `BUSINESS_AI_ACTION_*`;
    - `entityType` is registered **and** not `ai_action`;
    - `entityId` is a string ≤ 200 chars, or null;
    - `resourceName` ≤ 200;
    - `details` is a plain object ≤ 8 KB serialized;
    - `before` / `after` optional objects ≤ 16 KB each;
    - `userId`, `severity` and `complianceFlags` are **accepted and ignored**, so existing callers do not 400 (FR-24: "not trusted").
- **`lib/audit/clientAuditWrite.ts`.** `handleClientAuditWrite(request)` is the single write implementation behind `POST /api/audit/log` and `POST /api/audit-trail`. It does, in order:
  1. correlation id;
  2. `getUser()` → 401;
  3. parse → 400;
  4. `generateDiff(before, after)` as today;
  5. `void AuditTrail.log({ action, entityType, entityId, resourceName, changes, details, userId: user.id, actorId: user.id, request })` with `.catch(log)`. **No severity and no flags**, so both come from `EVENT_METADATA`;
  6. respond `{ success: true, message }` as today.

  The request is still passed (IP / user agent; OI-B is unchanged, as the requirement states).

**Routes:**
- **`app/api/audit/query/route.ts`:** `getUser()` → 401; parse the query → 400; `auditTrailRepository.listOwnerEntries(user.id, filters)` (§3.2); return `{ success: true, logs, total, page, limit, hasMore }` (shape unchanged). Pino with the correlation id; the dev-only `details` guard on 500.
- **`app/api/audit/log/route.ts`, `app/api/audit-trail/route.ts` (POST):** `export const POST = (req) => handleClientAuditWrite(req)`. `GET` is removed from `audit-trail`.
- **The server callers (Q-1, recommended A):**
  - replace each `fetch(…/api/audit/log)` with `auditTrail.log({...}).catch(…)`, same action and details;
  - the entity types `subscription` and `boost_pack` are added to `AUDIT_ENTITY_TYPES`;
  - the `FINANCIAL` flag is dropped (it is not a `ComplianceFlag`), and the metadata supplies `SOC2`;
  - the six events are registered with `severity: 'info'` (what callers send today, so stored severity is unchanged).
- **The admin reads (Q-3, recommended):** `getUser()` → 401, then `adminAccessService.isAdmin(user)` → 403, in the three `app/api/admin/**audit**` and `login-stats` routes. This is the same pattern as `app/api/admin/business-os/llm-usage/route.ts`. No other change.

### 3.2 The owner read and the AI exclusion (OQ-12 → option a)

**New `lib/repositories/AuditTrailRepository.ts`**, per the `new-repository` skill. Read-only, one method:

```typescript
listOwnerEntries(userId: string, q: { action?: string; entityType?: string; severity?: AuditSeverity; page: number; limit: number })
  : Promise<RepositoryResult<{ logs: OwnerAuditRow[]; total: number; page: number; limit: number; hasMore: boolean }>>
```

- **`supabaseServer`**, documented: the route has already authenticated the caller, and the table's owner policy is being narrowed (§3.3). Scoped with `.eq('user_id', userId)` (mandatory).
- **The exclusion, in the query** (FR-27): `.neq('entity_type', 'ai_action')` **and** `.not('action', 'like', 'BUSINESS_AI_ACTION_%')`. Both columns are `NOT NULL`, so `neq` drops no ordinary row.
- **An owner asking for AI entries gets nothing:** if `q.entityType === 'ai_action'` or `q.action` starts with `BUSINESS_AI_ACTION_`, it returns `{ logs: [], total: 0, … }` without querying.
- **`count: 'exact'`**, taken from the same filtered query, so `total` excludes AI rows.
- **Explicit select** of the 13 columns the page's `AuditLogEntry` type declares, plus `user_id` and `actor_id`. The response keys are unchanged; `hash` and `user_email` are no longer sent (Q-7).
- `.order('created_at', desc)`; `.range((page-1)*limit, page*limit - 1)` (inclusive).

**`AuditTrailService` is not modified** (D-4).

### 3.3 RLS option (OQ-11)

**Option (a), recommended.** A new migration, `supabase/migrations/2026MMDD_audit_trail_owner_policy_hides_ai_actions.sql`. It is written **after** the §2.3 SQL read, so it replaces the live policy by its real name:

```sql
DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.audit_trail;
CREATE POLICY "Users can view their own audit logs"
  ON public.audit_trail FOR SELECT
  USING (auth.uid() = user_id AND entity_type <> 'ai_action');
```

- **Preconditions:**
  - no client code reads `audit_trail` under RLS (verified: every read is a server route with the service key);
  - the live policy set is known (Q-4).
- **If the metadata-based admin policy (M-6) is live,** it is a separate security fix. It should be dropped in the same migration or its own, with the user told. Replacing it with an `admin_users`-based check needs SA design.
- **Applied manually,** like every migration here (`supabase/migrations/APPLY_MIGRATIONS.md`), **before** step 3 deploys.
- **Needs SA approval** (Dev rule: no migration changes without SA).

**Option (b).** No migration. KI-D is recorded, and the user is told in business terms before release (AC-27).

### 3.4 The accumulator (`lib/ai/usageScope.ts`, new, generic)

It has no Business OS imports; only `node:async_hooks` and the logger.

```typescript
export interface UsageCallRecord {
  feature: string; component: string; model: string; provider: string;
  sessionId?: string; inputTokens: number; outputTokens: number; costUsd: number;
  success: boolean; errorCode?: string;
}
export interface UsageScopeResult { calls: UsageCallRecord[]; excluded: number; }

/** Runs fn inside a new innermost scope for groupId. Returns fn's value and the collected calls. */
export async function withUsageScope<T>(groupId: string, fn: () => Promise<T>)
  : Promise<{ value?: T; error?: unknown; usage: UsageScopeResult }>;

/** Called by BaseAIProvider.callWithTracking. Never throws. */
export function notifyUsage(call: UsageCallRecord): void;
```

- **Innermost only.** Each `withUsageScope` runs `als.run(newScope, fn)`, so a nested scope shadows its parent. The chat website operation's calls go to its own scope only (FR-9).
- **The group check.** A call whose `sessionId !== scope.groupId` is not added. `excluded++` and a **warn** log is written with `groupId`, `component` and `feature` (wiring bugs).
- **Closed after the scope ends.** `withUsageScope` marks the scope closed in `finally`. A late notification from detached work (M-13, KI-A) is dropped with a debug log.
- **Never throws into the call.** The body of `notifyUsage` is in `try/catch`, and a failure is logged at warn.
- **`withUsageScope` never swallows `fn`'s error.** It returns `{ error }`, so the Business OS wrapper can emit and then rethrow. The original behaviour (throw, or return) is preserved exactly.

**The hook, in `lib/ai/providers/baseProvider.ts` `callWithTracking`:**
- On success, after `extractMetrics`: `notifyUsage({ …, success: true })`.
- On failure: `notifyUsage({ …, success: false, errorCode: error.code || 'UNKNOWN' })`.
- Both are placed **before** the `await trackAICall(...)`, so a slow or failing tracker cannot drop the notification.
- **The tracker payload is untouched** (FR-19, T-U6). No other provider method changes.
- `createThread` / `addMessageToThread` (`openaiProvider.ts:306`, `:334`) are **not** hooked: they are agents-side, and no Business OS path uses them.

### 3.5 The Business OS wrapper and the event builder (`lib/business-os/llm/aiActionAudit.ts`, new)

It lives inside the gate's scoped directory.

```typescript
export type AiTrigger = 'user' | 'scheduled' | 'external';
export type AiActionType =
  | 'chat_turn' | 'chat_website_operation' | 'insight_run' | 'briefing_narration'
  | 'website_full_site' | 'website_landing_page' | 'website_field_regenerate' | 'website_testimonial_enhance'
  | 'website_section_field_rewrite' | 'website_block_enrichment'           // dormant, unit-tested only
  | 'intake_form_generation' | 'intake_question_inference' | 'onboarding_build'
  | 'lead_reply_recommendation' | 'onboarding_turn' | 'image_generation';

export interface AiActionSpec {
  area: BosLlmArea; actionType: AiActionType; groupId: string; trigger: AiTrigger;
  accountId?: string;            // may be set later via handle.setAccount (chat: after getUser)
  correlationId?: string;
}
export interface AiActionHandle {
  setAccount(accountId: string): void;          // actor = account for trigger 'user'
  markFailed(code: AiFailureCode): void;        // emitter-signalled failure (FR-6)
}
export async function runAiAction<T>(spec: AiActionSpec, fn: (h: AiActionHandle) => Promise<T>): Promise<T>;
```

`runAiAction`:
1. Calls `withUsageScope(spec.groupId, () => fn(handle))`.
2. Builds the summary with `summarize(usage.calls)`: counts, token sums, cost sum, distinct call names, distinct models, the areas derived from `feature` (`business-os-<area>`), and the outcome.
3. If `calls.length > 0`, calls `emitAiAuditEntry(...)` (FR-7).
4. Returns `value`, or rethrows `error`, unchanged.

The whole of step 2 and step 3 is in `try/catch`: an audit bug never changes the action's result (FR-16).

**The entry built by `buildAiAuditEntry(summary)`.** Pure; unit-tested.

| `AuditLogInput` field | Value |
|---|---|
| `action` | `BUSINESS_AI_ACTION_COMPLETED` or `BUSINESS_AI_ACTION_FAILED` |
| `entityType` | `'ai_action'` |
| `entityId` | the grouping id |
| `userId` | the business account |
| `actorId` | the owner (trigger `user`), else the platform actor (§3.6) |
| `details` | `{ schema: 1, area, areas, actionType, groupId, trigger, callCount, failedCallCount, inputTokens, outputTokens, totalTokens, estimatedCostUsd, callNames, models, outcome: 'succeeded' \| 'failed', errorCode?, correlationId? }` |
| **never set** | `severity`, `complianceFlags`, `resourceName`, `changes`, `request` (FR-2, FR-5, RC-5) |

**The emission:**

```typescript
void AuditTrail.log(entry).catch((err) => logger.error({ err, area, actionType, groupId, accountId }, 'AI audit entry could not be queued'));
```

**Never `await`ed** (RC-4). `lib/services/AuditTrailService.ts` is imported and not changed.

### 3.6 UUID validation (FR-3, RC-3)

`validateIdentities(spec, accountId)` runs before any `log()`:

| Check | On failure |
|---|---|
| `isUuid(groupId)` | No entry; an error log with `area`, `actionType`, `groupId`, `accountId` |
| `isUuid(accountId)` and `!isPlatformAccount(accountId)` | Same |
| Actor, trigger `user`: `actorId = accountId` (already checked) | — |
| Actor, `scheduled` / `external`: `platformActorId() = isUuid(platformAccountId()) ? platformAccountId() : ALL_ZERO_UUID` | Never fails |
| `accountId` never set (e.g. chat returned 401 before `getUser`, so there are no calls either) | No entry. A debug log if there are no calls, an error log if there are |

Every account comes from a server-side source: the session, the cron's account list, or the site owner resolved server-side for leads.

### 3.7 The failure mapping (FR-6, RC-6)

An action is **failed** when any of these holds, checked in this order:
1. **the emitter called `markFailed(code)`:**

   | Emitter | Code |
   |---|---|
   | Briefing, `narration.source === 'fallback'` *and* at least one call | `briefing_fallback` |
   | Website, `generated.source === 'fallback'` | `content_fallback` |
   | Image, `{ ok: false, reason: 'failed' }` after a call | `image_failed` |
   | Image, no data | `image_no_data` |
   | Image, store failed | `image_store_failed` |
2. **`fn` threw.** The code is the thrown error's `code` if it matches `/^[A-Za-z0-9_.:-]{1,64}$/`, else its `name` (`TypeError`), else `'UNKNOWN'`;
3. **per call name, the last attempt failed.** The code is that call's `errorCode`, sanitized the same way.

Otherwise the action **succeeded**, with `failedCallCount` still counting repaired failures.

**Only the code is recorded.** Never a message; the website fallback's `reason` string is **not** used. **KI-C** stands: a defaulted onboarding extraction counts as a success.

### 3.8 Where each area wraps (the per-area table, RC-7)

| Area | Change |
|---|---|
| **chat** (`chat-v4/route.ts`) | `POST` computes `turnId` (moved up from `:335`, same expression), then `return runAiAction({ area: 'chat', actionType: 'chat_turn', groupId: turnId, trigger: 'user', correlationId }, (h) => handleChatTurn(request, turnId, h))`. The existing body becomes `handleChatTurn`, unchanged except for `h.setAccount(user.id)` after `getUser()`. The existing `catch` that returns 500 calls `h.markFailed('chat_error')` |
| **chat website operation** (`MutateExecutor.ts:811`) | `runAiAction({ area: 'website', actionType: 'chat_website_operation', groupId, trigger: 'user', accountId: ctx.userId }, () => generateWebsite…)`. Nested, so innermost |
| **insights** (`insight-detect/route.ts:205-283`) | The loop body becomes `await runAiAction({ area: 'insights', actionType: 'insight_run', groupId: runId, trigger: 'scheduled', accountId: userId }, async () => { …existing try body… })` **inside** the existing `try`. A throw is emitted as failed, then rethrown to the existing `catch`, which is unchanged |
| **briefing** (`BriefingStore.getBriefing`) | New **required** fifth parameter `trigger: 'user' \| 'scheduled'`. Only the `narrateBriefing` call (`:51`) is wrapped; the cached path is unchanged. Callers: `DailyBriefingDispatchService.ts:222` passes `'scheduled'`, `my-day/route.ts:119` passes `'user'` |
| **website** (4 routes) | Wrap the generation call after each `newBosGroupId()`, with the matching `actionType`. `markFailed('content_fallback')` on a fallback result |
| **website, dormant** | `WebsiteSectionService.ts:521`, `WebsiteBlockEnrichmentService.ts:271`: same helper; unit tests only |
| **intake** (2 routes) | Wrap each generation call |
| **onboarding build** (`build/route.ts:825`) | One `runAiAction({ area: 'intake', actionType: 'onboarding_build', groupId: buildGroupId, … })` spanning **both** the intake and website generation. `areas` in the entry is derived from the calls, e.g. `['intake', 'website']` |
| **leads** (`LeadAlertService.ts:336`) | Wrap `recommendLeadReply` with `trigger: 'external'` and `accountId` = the owner. No visitor field enters the spec |
| **onboarding** (`onboarding/chat/route.ts:217`) | Wrap `processUserMessage` with `actionType: 'onboarding_turn'`, `groupId: currentState.attributionGroupId`, `accountId: user.id` |
| **images** (`media/generate/route.ts:48`) | Wrap `generateImage`. `markFailed` per §3.7. A reuse-cache hit or a cap refusal makes no call, so no entry |

### 3.9 Events and types

- **`lib/audit/events.ts`:** add `BUSINESS_AI_ACTION_COMPLETED` (`info`, `['SOC2']`, "A Business OS AI action completed") and `BUSINESS_AI_ACTION_FAILED` (`warning`, `['SOC2']`). Also add, under Q-1 / Q-2, metadata for `USER_LOGOUT`, `USER_DATA_EXPORTED` and the six server events, each at the severity its caller sends today.
- **`lib/audit/types.ts`:** `AUDIT_ENTITY_TYPES` const array (existing values plus `ai_action`, and `subscription` / `boost_pack` under Q-1), and `export type EntityType = (typeof AUDIT_ENTITY_TYPES)[number]`. This is a type-equivalent refactor.

---

## 4. Files and Gate Impact

### 4.1 Files

| File | Action | Step |
|---|---|---|
| `lib/audit/types.ts` | modify: `AUDIT_ENTITY_TYPES`, `ai_action` (+ Q-1 types) | 0 (list), 2 (`ai_action` could land in 0 too) |
| `lib/audit/events.ts` | modify: event metadata (Q-1/Q-2 in step 0; the AI pair in step 2) | 0, 2 |
| `lib/audit/requestSchemas.ts` | **create** | 0 |
| `lib/audit/clientAuditWrite.ts` | **create** | 0 |
| `lib/repositories/AuditTrailRepository.ts` | **create** | 0 |
| `app/api/audit/query/route.ts` | rewrite | 0 |
| `app/api/audit/log/route.ts` | rewrite (delegates) | 0 |
| `app/api/audit-trail/route.ts` | rewrite: POST delegates, GET removed | 0 |
| `app/api/stripe/{cancel-subscription,create-checkout,create-portal,reactivate-subscription}/route.ts`, `app/api/onboarding/allocate-free-tier/route.ts` | modify: in-process `log()` (Q-1) | 0 |
| `app/api/admin/audit-trail/route.ts`, `app/api/admin/users/[id]/audit-logs/route.ts`, `app/api/admin/users/[id]/login-stats/route.ts` | modify: auth + admin gate (Q-3) | 0 |
| `supabase/migrations/2026MMDD_audit_trail_owner_policy_hides_ai_actions.sql` | **create** (OQ-11 = a) | 1 |
| `lib/ai/usageScope.ts` | **create** | 2 |
| `lib/ai/providers/baseProvider.ts` | modify: two `notifyUsage` calls | 2 |
| `lib/business-os/llm/aiActionAudit.ts` | **create** | 2 |
| `app/api/business-os/chat-v4/route.ts`, `lib/business-os/bizql/mutate/MutateExecutor.ts`, `app/api/onboarding/chat/route.ts`, `app/api/website/media/generate/route.ts`, the 4 website routes, the 2 intake routes, `app/api/onboarding/build/route.ts`, `lib/services/WebsiteSectionService.ts`, `lib/services/WebsiteBlockEnrichmentService.ts` | modify: wrap | 3 |
| `app/api/cron/insight-detect/route.ts`, `lib/business-os/briefing/BriefingStore.ts`, `lib/services/DailyBriefingDispatchService.ts`, `app/api/business-os/my-day/route.ts`, `lib/services/LeadAlertService.ts` | modify: wrap / trigger | 4 |
| `docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md`, `docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md`, the audit-trail doc section, `docs/SYSTEM_LOGGING_GUIDELINES.md` (not needed) | docs | 5 |
| **Not changed** | `lib/services/AuditTrailService.ts` (D-4); `app/(protected)/monitoring/page.tsx` (the header becomes inert; leaving the page untouched avoids converting its 6 `console.*` calls) | — |

### 4.2 `typecheck:bos-llm` (measured on `7646760a`)

| Measure | Now | After |
|---|---|---|
| Scope | **140 files**, 30 errors, 0 new; baseline blob `8cff995b` | **~142–146.** Added: `lib/business-os/llm/aiActionAudit.ts` (core dir) and its tests under `lib/business-os/llm/__tests__/` (core dir), plus one `*attribution*.test.ts` for AC-10 |
| Emitting files | **All 18 are already in scope** (chat-v4, MutateExecutor, insight-detect, BriefingStore, my-day, DailyBriefingDispatch, the 4 website routes, the 2 intake routes, onboarding build and chat, media/generate, LeadAlertService, the 2 dormant services) | Unchanged membership |
| Out of scope and staying out | `lib/ai/usageScope.ts`, `baseProvider.ts`, `lib/audit/*`, the audit routes, `AuditTrailService.ts`, `AuditTrailRepository.ts` | — |
| Baseline | No addition expected: no in-scope file with an existing baseline error is touched in a way that moves it. **The rule stays "baseline byte-identical"**; any change is itemised with its file and code before it is accepted |

**Full `tsc`** (excluding `.next/`): **2,042** now.
- Expected after step 0: **2,040**. The two `audit-trail/route.ts` errors (TS2554 `:93`, TS2339 `:98`) disappear with the removed GET.
- If Q-1 = A, the four stripe errors (`current_period_end`, `cancel-subscription:107,118`, `reactivate-subscription:115,126`) are **not** touched and stay.
- Every step records the per-file distribution, as in the logging clean-up.

---

## 5. Test Plan

### 5.1 Unit and integration tests (Jest; no live provider)

**Step 0: routes** (`app/api/audit/**/__tests__`, `app/api/audit-trail/__tests__`). Mocks: `getUser`, the repository, `AuditTrail.log`.

| ID | Test | AC |
|---|---|---|
| T-R1 | `GET /api/audit/query` with no session returns 401, even with an `x-user-id` header; the repository is not called | AC-21 |
| T-R2 | Signed in, it returns `{ success, logs, total, page, limit, hasMore }` from `listOwnerEntries(user.id, …)`. `?limit=1000&offset=0` (the page's own request) is accepted | AC-23, AC-24 |
| T-R3 | Signed in as A with `x-user-id: B`: the repository is called with A only | AC-22 |
| T-R4 | `limit=0`, `limit=5000`, `page=0`, an unknown `action` / `entityType` / `severity` each return 400 | AC-23 |
| T-R5 | The repository fails: 500 with no `details` outside development, and a Pino error log | FR-26 |
| T-W1 / T-W1r | `POST /api/audit/log` and `POST /api/audit-trail` with no session return 401, including with a header, a body `userId` or `'anonymous'`; `log()` is not called | AC-21 |
| T-W2 / T-W2r | A valid write is recorded with `userId = actorId =` the session user; the response is unchanged | AC-23 |
| T-W3 | A body or header naming B is recorded under A | AC-22 |
| T-W4 | `entityType: 'ai_action'` or `action: 'BUSINESS_AI_ACTION_COMPLETED'` returns 400, and nothing is logged | AC-23 |
| T-W5 | A client `severity: 'critical'` or `complianceFlags` is not passed to `log()`, so the stored severity comes from metadata | AC-23 |
| T-C1 | Each of the 15 client payloads (§2.4), replayed through the handler, returns 200 (the registration from Q-2 included) | AC-24 |
| T-A1 | (Q-3) The admin audit reads: 401 without a session, 403 for a non-admin, 200 for an admin (`adminAccessService` mocked) | FR-23 |
| T-O1 | `AuditTrailRepository.listOwnerEntries` against a fake PostgREST: the query carries `user_id = A`, `entity_type <> ai_action` and `action not like BUSINESS_AI_ACTION_%`. `entityType=ai_action` or `action=BUSINESS_AI_ACTION_COMPLETED` returns empty without a query. `total` is the filtered count | AC-26 |
| T-G1 | `GET /api/audit-trail` no longer exists (405) | FR-25 |

**Step 2: the accumulator** (`lib/ai/__tests__/usageScope.test.ts`):

| ID | Test | AC |
|---|---|---|
| T-U1 | A scope collects the calls notified inside it, in order, including from `Promise.all` branches | AC-1 |
| T-U2 | Nested scopes: the inner calls go only to the inner scope | AC-8 |
| T-U3 | A call with a different `sessionId` is excluded (`excluded = 1`) with a warn log | AC-1 |
| T-U4 | A notification after the scope closed (detached promise) is dropped with a debug log | M-13 |
| T-U5 | `notifyUsage` with a broken store does not throw; `callWithTracking` still returns its result | AC-1 |
| T-U6 | `callWithTracking` sends a byte-identical `trackAICall` payload with and without an open scope, on success and on failure (snapshot) | AC-17, FR-19 |
| T-U7 | `withUsageScope` returns `fn`'s error rather than swallowing it | FR-16 |

**Step 2: the entry** (`lib/business-os/llm/__tests__/aiActionAudit.test.ts`, gate-scoped). `AuditTrail.log` is mocked, and the provider is faked through `callWithTracking`:

| ID | Test | AC |
|---|---|---|
| T-E1 | Three calls produce exactly one `log()` call, whose totals equal the three calls | AC-1 |
| T-E2 | The events and metadata are registered; `getEventMetadata` is not "Unknown"; `ai_action` type-checks; `entityId` = group | AC-2 |
| T-E3 | Account and actor per trigger. **The guard:** a non-UUID account, a platform account, a non-UUID group, or a platform env value that is not a UUID (so the actor becomes the all-zero id) → no `log()` and an error log with area, action type, group and account | AC-3 |
| T-E4 | `details` has **exactly** the keys in §3.5 (a key-set equality assertion) | AC-4 |
| T-E5 | Markers in the prompt, the owner input, the model output and the error message appear nowhere in the `log()` argument. There is no `request` and no `resourceName` | AC-5 |
| T-E6 | No `severity` or `complianceFlags` argument. Outcomes: repaired → COMPLETED with `failedCallCount` 1; last attempt failed / threw / `markFailed` → FAILED with a code only; never critical | AC-6, AC-17 |
| T-E7 | Zero calls → no `log()`. This covers the cache and failed-before-call cases | AC-7 |
| T-W1 (write) | `log()` mocked to resolve after 10 s: `runAiAction` returns immediately (fake timers) | AC-15 |
| T-W2 (write) | `log()` rejects: the action's value is returned; an error log with ids only | AC-16 |
| T-S1 | Static: `git diff --exit-code lib/services/AuditTrailService.ts`; no `await` before `AuditTrail.log(` / `auditLog(` in `aiActionAudit.ts`; no `flush(` / `shutdown(` / `auditFlush(` | AC-15 |

**Steps 3 and 4: one test per area.** These are route or service tests with the provider faked at `callWithTracking` and `AuditTrail.log` mocked:

| ID | Area | AC |
|---|---|---|
| T-AR1 | chat: planner + analysis + an embedding give one entry with 3 calls. A repair gives COMPLETED with 1 failed. A cache-only turn gives no entry. The nested website operation gives a second entry (area `website`, its own group), and the turn's totals exclude it. A 401 gives no entry | AC-8, AC-7 |
| T-AR2 | insights: two businesses give two entries sharing `runId`. A throw after an LLM call gives FAILED from the `catch` path. No detections gives no entry. `scheduled`, platform actor, info | AC-9 |
| T-AR3 | briefing: scheduled → platform actor; My Day → owner; a re-narration gives a second entry in the same group; cached gives none; a fallback after a failed call gives FAILED `briefing_fallback`; a quiet day (no call) gives none. **`@ts-expect-error` on a `getBriefing` call without a trigger**, in `briefing-trigger.attribution.test.ts` | AC-10 |
| T-AR4 | website ×4, intake ×2, dormant ×2: one entry each; a fallback gives FAILED. The onboarding build gives **one** entry with `areas: ['intake', 'website']` | AC-11 |
| T-AR5 | leads: one entry, `external`, platform actor. No visitor name, email or message anywhere in the argument (marker test) | AC-12 |
| T-AR6 | onboarding: two turns give two entries sharing the conversation group, each with only its own calls; a turn with no call gives none | AC-13 |
| T-AR7 | images: success gives COMPLETED (0 tokens, per-image cost); a provider failure gives FAILED; a billed empty response gives an entry; reuse / cap gives none | AC-14 |

### 5.2 Live verification (non-production)

| ID | What | AC |
|---|---|---|
| L-0 | After step 0 deploys: a signed-in owner opens `/monitoring`; the entries load, the charts render and the CSV downloads. An unauthenticated `curl` of each kept handler returns 401. A settings save, a logout and a Stripe portal open still produce their rows (direct query) | AC-24, AC-21 |
| L-0b | Before step 3 merges, in every environment: `SELECT count(*) FROM audit_trail WHERE action LIKE 'BUSINESS_AI_ACTION_%'` = 0 | AC-25 |
| **L-1 (a) Long-lived server** (`next start` or `npm run dev`, kept running) | Run one action per area: a chat question, `insight-detect` (cron route with `CRON_SECRET`), a briefing (My Day, and the `daily-briefing` cron), a website generation, an intake generation, an enquiry through the contact form, an onboarding conversation, an image. **Wait ≥ 10 s with the server still running.** Then, by direct query, list every distinct `session_id` in `token_usage` for the test business in the window and join each to `audit_trail` (`entity_type = 'ai_action'`, `entity_id = session_id`, `user_id` = the business). **Every expected entry must be present; any miss is a defect.** For each entry: totals = the sum of its ledger rows (except KI-A), the fields = FR-4, no prompt or owner text (a grep for the test's own input phrases) | AC-19(a) |
| **L-2 (b) Deployed preview** | The same actions on a Vercel preview. Look 1 at **+10 s**; look 2 after **one unrelated request to the same deployment**, and again at **+1 h**. Entries found only in look 2 are **delayed**; entries still missing are **lost** and recorded as KI-B occurrences (group id, time), not as defects. The expected / found@10s / found@later / delayed / lost counts go into §11 as the first KI-B measurement | AC-19(b) |
| L-3 | If OQ-11 = a: signed in as the test owner, query `audit_trail` with the anon key and the owner's JWT. No `ai_action` rows come back, and other rows still do | AC-27 |
| L-4 | Restate the volume table with measured rows per action type for the QA window (FR volume recommendation) | Volume |

### 5.3 Gates after every step

| Gate | Rule |
|---|---|
| G1 `npm run typecheck:bos-llm` | 0 new; baseline JSON byte-identical. The scope count is recorded with `--list` and explained |
| G2 full `tsc` (excluding `.next/`) | 2,042 → the per-step expectation in §4.2. The per-file distribution is diffed |
| G3 NUL bytes | 0 in changed files |
| G4 usage-route snapshot | `app/api/business-os/usage/__tests__/__snapshots__/route.test.ts.snap` untouched and passing |
| G5 static | No `console.*` in new or touched files (Q-6); `AuditTrailService.ts` unchanged (T-S1) |
| G6 Jest, touched area | All new tests pass. The known pre-existing failures (OI-10, OI-11) are unchanged |

---

## 6. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | Step 0 breaks a caller not found by the grep (dynamic URL, external script) | Low | The survey greps every `.ts/.tsx/.js/.sh/.py/.sql`; L-0 checks settings, logout and Stripe live; 401s are logged at info with the route name for a week after deploy |
| R-2 | Server-side audit calls silently stop (M-1) if Q-1 is not done | **High without Q-1** | Q-1 A; T-C1; L-0 |
| R-3 | Wrapping chat-v4's 1,688-line `POST` changes its behaviour | Medium | A mechanical extract to `handleChatTurn` with no logic change; the existing chat-v4 suites must pass unedited; `runAiAction` returns or rethrows exactly |
| R-4 | ALS context leaks into detached work (KI-A) | Known | Scope closed at emission (T-U4) |
| R-5 | A notification bug breaks every LLM call in the product (the hook is in the base provider) | Low, **high impact** | `notifyUsage` is `try/catch`-wrapped (T-U5); T-U6 byte-identical tracker payload; the existing provider suites must pass unedited |
| R-6 | A poison-pill entry loses a shared batch (S-3) | Low | The §3.6 guard (T-E3). The residual risk (an account deleted mid-run) belongs to OI-A |
| R-7 | The RLS migration is applied out of order, or the live policy name differs | Medium | Written only after the §2.3 SQL read; applied before step 3; L-3 |
| R-8 | M-5 / M-6 stay open, so AI entries and costs are readable by anyone (M-5), or by any self-promoted user (M-6) | **High impact** | Q-3, Q-4 before step 3 releases |
| R-9 | KI-B losses are higher than assumed on Vercel | Unknown | L-2 measures it; OI-D / OI-A are the remedies |
| R-10 | The volume of new rows (up to ~0.73M a year at 1,000 businesses) with no retention job (OI-C) | Known | Informational; L-4 measures it |

---

## 7. Steps

Each step is independently shippable and leaves the product working. **Step 0 merges and deploys first; steps 3 and 4 must not merge before it is deployed** (FR-21, AC-25). Because this cycle uses one branch, **RM needs either a PR containing only step 0, merged and deployed, followed by a second PR for steps 1 to 5; or the equivalent split by commit** (Q-9).

| Step | Content | Ships | Depends on |
|---|---|---|---|
| **0** | Audit routes secured; owner read through `AuditTrailRepository` with the AI exclusion (inert until AI rows exist); callers converted (Q-1); admin reads gated (Q-3); schemas; event and entity registration for existing callers | Alone. **Merge and deploy first** | — |
| **1** | RLS migration (OQ-11 = a). SQL written after the Q-4 read; applied manually | Alone. Applied before step 3 deploys | SA approval |
| **2** | `usageScope.ts`, the `baseProvider` hook, `aiActionAudit.ts`, the two events and `ai_action`. **No call site yet**, so no AI entry can be written | Alone (inert) | — |
| **3** | Request-path wiring: chat (+ nested website), website ×4 (+ dormant), intake ×2, onboarding build, onboarding chat, images | After step 0 is deployed (and step 1 applied, or KI-D reported) | 0, 2 |
| **4** | Background and detached wiring: insights, briefing (required trigger), leads | Same | 0, 2 |
| **5** | Docs (FR-20); QA live L-1/L-2/L-3/L-4 | Last | 3, 4 |

---

## 8. Questions for SA and the User

| # | Question | Dev recommendation | Who |
|---|---|---|---|
| **OQ-11** | Change the owner RLS policy? | **(a)**, after the Q-4 SQL read. It is a one-policy migration | SA |
| **OQ-12** | Where the owner exclusion lives | **(a)** `AuditTrailRepository.listOwnerEntries` (§3.2); `AuditTrailService` untouched | SA |
| **OQ-13** | GDPR export | See Q-5 | SA → TL/user |
| **Q-1** | M-1: six server-side self-calls to `/api/audit/log` break under step 0. **A:** convert them to in-process `AuditTrail.log()`, registering their six events and the `subscription` / `boost_pack` entity types, and dropping the non-existent `FINANCIAL` flag (this also starts recording `FREE_TIER_ALLOCATED`, which never worked, M-2). **B:** accept the regression and record it | **A.** It is the requirement's own suggestion ("written server-side, where it happens") and it adds five route files to step 0 | SA |
| **Q-2** | M-3: FR-24's "registered values only" rejects `USER_DATA_EXPORTED` (client) and the Q-1 events. Register them (with today's severities), or relax FR-24 to "known format" for `action`? | Register them. `USER_LOGOUT` also gets metadata | SA |
| **Q-3** | **M-5 (P0):** the three admin audit reads are open to anyone. Gate them with `AdminAccessService` in step 0? | **Yes.** It is the same hole class as S-1, wider, and Layer 3 would add AI costs to it. It is tiny (auth + `isAdmin` check) and has two admin-page callers | SA; user informed |
| **Q-4** | **M-6 / RC-11:** someone with SQL access runs the three read-only queries in §2.3 (policies, constraints, triggers). If the `raw_user_meta_data` admin policy is live, it must be dropped (a user-writable admin flag) | Run them before step 1 is written. If the policy is live, treat it as P0 and tell the user in business terms: "any signed-in user could make themselves able to read every business's activity log" | User / SA (needs DB access) |
| **Q-5** | **OQ-13 / M-7:** the owner self-service export reads audit rows through a non-existent column and exports none today. **(i)** leave it and record that it exports no audit rows (FR-27 holds); **(ii)** fix it now through `listOwnerEntries`, which would start exporting `session_id` (a credential, OI-B) | **(i)**, plus a one-line comment in the route and a known issue. Fix it together with OI-B | SA → TL/user |
| **Q-6** | CLAUDE.md § Logging: the extra step-0 files carry `console.*`: stripe (4 / 3 / 1 / 4), `allocate-free-tier` (13), and the admin audit routes (4 / 3 / 2). Convert them in the same step? | Convert the files step 0 touches, as the rule requires, in a **separate commit** inside step 0. `monitoring/page.tsx` (6) is not touched | User (approve) |
| **Q-7** | The owner read's explicit select drops `hash` and `user_email` from the response (the page does not read them) | Accept | SA |
| **Q-8** | The chat route is wrapped by extracting its body into `handleChatTurn`: a large mechanical diff in a 1,688-line file | Accept, as a mechanical commit inside step 3 | SA |
| **Q-9** | Release mechanics for FR-21 on a single branch | Two PRs: step 0 alone first, then the rest | RM / TL |

---

## 9. Task List

**Step 0: secure the audit routes**
- [ ] **T0.0** Record the baselines (G1 `--list`, G2 per-file) on the step's base
- [ ] **T0.1** `types.ts`: add `AUDIT_ENTITY_TYPES` and derive `EntityType`. `events.ts`: add metadata for `USER_LOGOUT`, plus `USER_DATA_EXPORTED` and the six server events (Q-1/Q-2)
- [ ] **T0.2** `lib/audit/requestSchemas.ts` and `lib/repositories/AuditTrailRepository.ts` (the owner read with the AI exclusion)
- [ ] **T0.3** Rewrite `app/api/audit/query/route.ts` (session, Zod, repository, Pino, dev-only details)
- [ ] **T0.4** `lib/audit/clientAuditWrite.ts`; `app/api/audit/log/route.ts` delegates
- [ ] **T0.5** `app/api/audit-trail/route.ts`: POST delegates, GET removed
- [ ] **T0.6** Confirm the logout order at `business-os/settings/page.tsx:401` (log before `signOut`)
- [ ] **T0.7** (Q-1) Convert the six server self-calls to in-process `log()`
- [ ] **T0.8** (Q-3) Gate the three admin audit reads with `AdminAccessService`
- [ ] **T0.9** (Q-6) Separate commit: convert `console.*` → Pino in the step-0 files
- [ ] **T0.10** Tests T-R*, T-W*, T-C1, T-A1, T-O1, T-G1; gates G1–G6
- [ ] **T0.11** SA code review, then QA (L-0), then the user, then RM merges and deploys **step 0 alone**
- [ ] **T0.12** Record the step-0 commit and deploy in §12; run L-0b

**Step 1: RLS (if OQ-11 = a)**
- [ ] **T1.0** (Q-4) Obtain the live policy, constraint and trigger read
- [ ] **T1.1** Write the migration; SA approves; applied manually before step 3 deploys; L-3

**Step 2: the accumulator and entry (inert)**
- [ ] **T2.1** `events.ts`: `BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`. `types.ts`: `ai_action`
- [ ] **T2.2** `lib/ai/usageScope.ts`
- [ ] **T2.3** The `baseProvider.callWithTracking` hook (two lines, placed before `trackAICall`)
- [ ] **T2.4** `lib/business-os/llm/aiActionAudit.ts`: `runAiAction`, `buildAiAuditEntry`, `validateIdentities`, the failure mapping
- [ ] **T2.5** Tests T-U1–T-U7, T-E1–T-E7, T-W1/2 (write), T-S1; gates

**Step 3: request-path wiring**
- [ ] **T3.1** Chat: mechanical extract to `handleChatTurn` (its own commit), then the wrap
- [ ] **T3.2** The `MutateExecutor` nested website operation
- [ ] **T3.3** Website ×4
- [ ] **T3.4** Intake ×2
- [ ] **T3.5** Onboarding build; the dormant `WebsiteSectionService` / `WebsiteBlockEnrichmentService`
- [ ] **T3.6** Onboarding chat
- [ ] **T3.7** Images
- [ ] **T3.8** Tests T-AR1, T-AR4, T-AR6, T-AR7; gates

**Step 4: background and detached wiring**
- [ ] **T4.1** Insights, per business
- [ ] **T4.2** Briefing: the required trigger; the two callers
- [ ] **T4.3** Leads
- [ ] **T4.4** Tests T-AR2, T-AR3 (+ the `@ts-expect-error` attribution test), T-AR5; gates

**Step 5: docs and live verification**
- [ ] **T5.1** Investigation doc: Q4 resolved; Layer 3; D-1 to D-6; KI-B; OI-D (Change History)
- [ ] **T5.2** Layer 1 requirement roadmap lists Layer 3 (Change History)
- [ ] **T5.3** Audit-trail documentation: the two events, KI-B, the owner-visibility rule
- [ ] **T5.4** QA: L-1, L-2, L-3, L-4; results into §11

---

## 10. SA Review

**Reviewed by SA — 2026-09-18**
**Status:** ✅ **Approved to implement, conditional on WC-1 to WC-12.** Step 0 can start now.
- Steps 3 and 4 stay gated on two things: step 0 **deployed** (FR-21), and the Q-4 SQL read with its consequence applied.
- One new **P0 finding (S-6)** is outside this layer and goes to the user now.

The code-reality check is thorough: fifteen findings, each with evidence. I re-verified M-1, M-2, M-4, M-5, M-11, M-13, the chat route's structure, `callWithTracking`, and `getBriefing`'s signature against `7646760a`. The accumulator design meets every condition from my requirement review:
- generic and in `lib/ai`;
- innermost scope only;
- a group check;
- the scope closes after emission;
- it never throws, and it never swallows `fn`'s error.

`runAiAction` / `buildAiAuditEntry` / `validateIdentities` apply RC-3 to RC-6 faithfully. The per-area table matches RC-7.

### New finding

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **S-6 (P0, outside this layer)** | **`POST /api/onboarding/allocate-free-tier` grants free credits to any account, unauthenticated.** It takes `userId` from the request **body** and writes `user_subscriptions` with the service role. It does this **every time it is called**: `balance: existing + raw_tokens`, and it also sets `account_frozen: false`. There is no session check and no once-only guard. Callers: `useOnboarding.ts:415`, `test-plugins-v2/page.tsx:2231` | `app/api/onboarding/allocate-free-tier/route.ts:4-7`, `:16-17`, `:78-131` | Anyone can top up any account's credits without limit, and unfreeze a frozen account. **It also changes Q-1:** converting its audit call to an in-process `log({ userId })` would write audit entries under a **body-supplied** account, the exact forgery step 0 removes → WC-2 |

### Rulings

- **M-1 / Q-1 — option A, except `allocate-free-tier`.**
  - Convert the **four Stripe routes** to in-process `auditTrail.log(...)`, not awaited, with `.catch`. All four already call `supabase.auth.getUser()` (`cancel-subscription:42`, `create-checkout:26`, `create-portal:26`, `reactivate-subscription:42`), so the account is the session user.
  - **Leave `allocate-free-tier`'s audit call as it is** (M-2: it posts to the Supabase host and has never recorded anything). Report the route itself as S-6. Its audit entry is recorded when that route is fixed and authenticated, not before.
- **M-2 — see above.** Starting to record `FREE_TIER_ALLOCATED` from an unauthenticated route would record attacker-chosen accounts.
- **M-3 / Q-2 — register them, in step 0 (T0.1), before validation is switched on.**
  - Register `USER_LOGOUT`, `USER_DATA_EXPORTED`, the Stripe events and the entity types `subscription` / `boost_pack`.
  - Preserve the **stored data**:
    - each event's metadata carries the severity its caller sends today;
    - for the in-process Stripe calls, keep today's `FINANCIAL` flag by adding it to `ComplianceFlag`, rather than silently changing what is stored.

    RC-5's "metadata only" rule is about AI entries and client writes, not server code.
  - T-C1, which replays the 15 client payloads, is the proof.
- **M-4 — agreed.** Remove `GET /api/audit-trail`; G2 goes 2,042 → 2,040. POST delegates to the shared handler.
- **M-5 / Q-3 — yes, in step 0, whatever the separate queue does.**
  - These three routes read **every** account's audit rows with no session. Step 3 would put AI activity and cost into exactly those rows, so they gate this layer's data.
  - Use `getUser()` → 401, then `AdminAccessService.isAdmin` → 403 (never `app_metadata.role`; M-14 is right to ignore the skill).
  - **Overlap:** record in §2.2 and tell the TL that the queued "unauthenticated admin routes" task must **exclude** these three files once step 0 merges, so the two do not collide. S-6 belongs in that queue too, and it is the most urgent item in it.
- **M-6 / Q-4 — if the `raw_user_meta_data` policy is live: a separate, immediate fix, not this layer's migration.**
  - Drop the policy **by itself**, in its own migration applied as soon as it is confirmed. Do not wait for step 1.
  - **Do not replace it.** Every admin read of `audit_trail` goes through service-role server routes (the three gated by Q-3), so no RLS admin policy is needed.
  - Tell the user in business terms. It is worse than it first looks: any signed-in user could read every business's audit rows, **including the `session_id` values the service copies from auth cookies (OI-B)**.
  - If the query shows it is **not** live, record that in §2.3 and proceed.
  - Either way, step 1's migration is written only after the read.
- **M-7 / Q-5 — option (i).** Leave the export exporting no audit rows. Add the one-line comment and a known issue. When it is fixed (with OI-B), it must read through `listOwnerEntries`, which excludes AI rows and uses an explicit column list without `session_id`, `ip_address` or `hash`. That condition goes in the known issue's text.
- **OQ-11 — option (a) approved,** conditional on the Q-4 read. The migration uses the **live** policy name. It is applied **before step 3 deploys**, and L-3 proves it. It is belt and braces: today no client reads `audit_trail` under RLS.
- **OQ-12 — approved.** `AuditTrailRepository.listOwnerEntries` uses `supabaseServer`, `.eq('user_id', userId)` and an explicit select. The exclusion is in the query, and asking for AI entries short-circuits to empty. `AuditTrailService` stays unchanged.
- **Q-6 — the user's call.** Technical risk is low: logging-only, mechanical, separate commit.
  - The four Stripe routes are money paths, but their `console.*` lines are diagnostic only.
  - `allocate-free-tier` (13 calls): do **not** convert it in step 0, because it is not otherwise touched after the Q-1 ruling. Its conversion belongs to its S-6 fix.
  - FR-26 already requires converting the three audit routes, whatever the user answers.
- **Q-7 — accepted.** Nothing reads `hash` or `user_email` on the owner side. Dropping `hash` also stops leaking the tamper hash to owners.
- **Q-8 — accepted, as a *rename*, not an extract.**
  - Rename the existing `POST` in place to `handleChatTurn(request, turnId, h)`, and add a new thin `POST` that computes `turnId` (the moved `:331-335` lines) and calls `runAiAction`.
  - The body must not move or be re-indented. Its diff is then only: the signature, the removed `turnId` line, `h.setAccount(user.id)`, and `h.markFailed('chat_error')` in the 500 path.
  - Review with `git diff -w --color-moved`.
  - The route does not stream (no `ReadableStream` / `new Response(`), so every LLM call finishes inside the scope.
- **Q-9 — agreed.** A PR with step 0 only, merged and deployed, then L-0 and L-0b. Then a second PR for steps 1 to 5. RM records the deploy in §12 before the second PR merges (AC-25).
- **Minor points.**
  - **M-13 (detached work):** correct; the scope closes in `finally`, and T-U4 covers it.
  - **M-11 (`offset`):** accepted and ignored; T-R2 covers it.
  - **M-10:** five providers. Correction noted; hooking the base class covers them.
  - **Live schema:** 58,072 rows; `user_email` column; no `entity_type` check on the evidence. Recorded; no migration for the entity type.

### Required changes (WC-n)

1. **WC-1 (§3.4, T2.3) — one notification per call.** In `callWithTracking`, the success-branch `await this.analytics.trackAICall(…)` is **inside** the `try` (`baseProvider.ts:87-111`). If it ever threw (a missing `analytics`, a bug), the `catch` would write a failure row and rethrow, and a success notification placed before it would be followed by a failure notification: one call counted twice. Guard with a per-call `notified` flag, or notify only after the tracker returns plus once in the `catch`. Add a T-U case with a throwing tracker.
2. **WC-2 (Q-1, T0.7, §4.1) — take `allocate-free-tier` out of step 0.**
   - Four Stripe conversions only.
   - Add S-6 to §2.2 and R-list.
   - Remove its `console.*` count from Q-6's step-0 list.
3. **WC-3 (T4.2) — `getBriefing`'s trigger cannot be a fifth positional parameter.** `businessType` is already optional (`BriefingStore.ts:38`), and a required parameter cannot follow an optional one. Put `trigger` **before** `businessType` as a required positional parameter (it has only two callers), and keep the `@ts-expect-error` test.
4. **WC-4 (§3.5) — define `area` for multi-area actions.** For `onboarding_build`, `details.area` would say `'intake'` while the calls span two areas. State that `details.areas` (derived from the calls, in catalog order) is authoritative, and that `details.area` is the action's declared primary area. Assert both in T-AR4.
5. **WC-5 (L-1, T-U3) — the group-check exclusions must be zero live.** A warn from the group check means a call reached a scope with a different grouping id: a wiring bug, or a call site passing no `sessionId` (chat's `GroupIdFor` allows it). L-1 records the count of "excluded call" warnings per area, and **any non-zero count is a defect** to fix before release, not a KI.
6. **WC-6 (§3.1, T-R4) — the read schema is not the security boundary, so do not reject historic values.** The live table already holds entity types outside the TS union (`stripe_connect_account`, `chat_session`, `chat`, `crm_task`, `contact_document`, M-8). Read-side `action` / `entityType` filters accept a slug pattern (`/^[a-z0-9_]{1,64}$/i`), not "registered only". The repository enforces the AI exclusion either way. Write-side validation stays strict. T-R4 is amended accordingly.
7. **WC-7 (T-O1) — prove the exclusion filter's syntax, not only its presence.** `.not('action', 'like', 'BUSINESS_AI_ACTION_%')` is URL-encoded by supabase-js, and a fake PostgREST may accept what the real one would not. Add it to L-0: with one `ai_action` row seeded in non-production (or the step-3 run), the owner query must not return it. `entity_type <> 'ai_action'` alone is the primary guard, and the `action` filter is defence in depth.
8. **WC-8 (§3.8, T4.1) — insight emission on the `catch` path must not double-report.** `runAiAction` emits FAILED and rethrows to the existing per-business `catch`, which logs and continues. Assert in T-AR2 that one failing business yields exactly one FAILED entry and that the loop continues to the next business with its own entry.
9. **WC-9 (§3.6) — resolve the platform actor once per process, not per call.** It is pure and cheap either way. But log **once**, at warn, if `SYSTEM_ADMIN_USER_ID` is set and is not a UUID, so the fallback to the all-zero actor is visible. Add a production check to T0.0/L-0: `SYSTEM_ADMIN_USER_ID` is a UUID in production (§2.3 checked local only).
10. **WC-10 (§5.2 L-0) — measure step 0's 401s for a week.** R-1 already mentions this. Make it concrete: the three audit handlers log a 401 at **info** with the route name and whether a legacy `x-user-id` header or body `userId` was present (not its value). QA checks the count after a week. A non-zero "legacy caller" count means a caller the grep missed.
11. **WC-11 (§2.2) — record S-6 and the Q-3 overlap** as described in the rulings, and add S-6 to "For the user".
12. **WC-12 (T0.1, Q-2) — keep stored data unchanged for the registered events.** Metadata severity equals what callers send today, and the Stripe events keep `FINANCIAL`. A unit test compares the metadata for each newly registered event with the literal severity and flags its caller sent before step 0.

### What else was checked

- **Validation before `log()`, and no await.**
  - §3.6 checks the group, the account (a UUID, not a platform account) and the actor (a UUID, or the all-zero id).
  - §3.5 emits with `void AuditTrail.log(entry).catch(…)`.
  - T-S1 statically forbids `await`, `flush(`, `shutdown(` and `auditFlush(`, and asserts `AuditTrailService.ts` is unchanged.
- **`EVENT_METADATA`:** the pair is registered with info / warning and `['SOC2']`. The emitter never passes `severity` or flags (T-E6).
- **Privacy and tenancy.**
  - `details` is exactly the key set in §3.5 (T-E4, a key-set equality check).
  - Markers placed in prompts, input, output and errors never appear in the entry (T-E5).
  - No `request` and no `resourceName`.
  - The failure mapping records sanitized codes only; the website fallback `reason` is excluded.
- **Owner filter:** in SQL, count-consistent, and short-circuited for AI filters (T-O1), with WC-6 and WC-7.
- **AC-19 split:** L-1 (long-lived server: any miss is a defect) and L-2 (preview: +10 s, then after an unrelated request, then at +1 h, separating delayed from lost) implement RC-9 exactly.
- **Test strength:** good.
  - Byte-identical tracker payload with and without a scope (T-U6).
  - Innermost scopes, closed scopes, exclusions and error pass-through are all covered.
  - Per-area tests assert exact entry counts and group sharing.
  - Additions: WC-1, WC-5, WC-8 and WC-12.
- **Sequencing:** step 0 alone → deploy → step 1 (after Q-4) → step 2 (inert) → steps 3 and 4 → step 5. Each step ships alone, and no AI entry can be written before step 3.
- **Gates:** G1–G6 as in the logging clean-up. G2 2,042 → 2,040 after step 0, then unchanged. The four pre-existing Stripe errors stay (not touched).
- **Scope:** proportionate. Step 0's extra work (Stripe conversions, admin gates, registrations) is exactly what "secure the routes without breaking callers" requires. Nothing beyond it: no service change, no UI, no retention job.

### What SA needs from the user (business terms)

1. **Urgent, separate from this project (S-6):** a web address used during onboarding lets **anyone add free AI credits to any account, as many times as they like, and unfreeze frozen accounts**. It is not protected by a login. It should be fixed as soon as possible, ahead of this layer.
2. **Q-4: someone with database access runs three read-only queries** (they're in §2.3 of the workplan). They tell us whether a setting exists that would let **any signed-in user read every business's activity log** by editing their own profile. If it exists, it gets switched off immediately, as its own fix.
3. **Q-6: approve tidying the logging** in the four subscription-payment routes and the three admin audit routes this work touches. It changes only how those routes write their diagnostic logs, not what they do. It is a small, low-risk, separate change.
4. **For information (Q-3):** three admin screens that list activity logs are currently open to anyone. They get locked to admins in the first step of this work, before any AI activity is written.

## 11. QA Testing Report

*(QA to populate. L-2 records the first KI-B measurement.)*

## 12. Commit Info

*(RM to populate. FR-21 / AC-25: record the step-0 commit and deploy **before** the step-3 merge.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-18 | Created | Dev workplan for Layer 3. Traceability for 28 FRs / 27 ACs. Code-reality check on `7646760a`: citations hold. **15 mismatches or findings**, material: M-1 (21 `/api/audit/log` call sites, six server-side self-calls that step 0 would silently break), M-3 (unregistered events and types used by live callers), M-5 (three unauthenticated admin audit reads), M-6 (a script-defined RLS admin policy on user-writable metadata, unverified live), M-7 (the self-service export reads a non-existent column and exports no audit rows). The RC-11 live schema was read through PostgREST (read-only): no `entity_type` CHECK on the evidence; the FK, policies and triggers need SQL. Design for step 0, the owner read, the RLS option, `usageScope` + the `callWithTracking` hook, `runAiAction` + the entry builder, UUID validation and the failure mapping. Gate scope 140 (predicted ~142–146, baseline unchanged); full `tsc` 2,042 → 2,040 after step 0. Six steps, 36 tasks, questions OQ-11 to OQ-13 and Q-1 to Q-9 |
| 2026-09-18 | SA review — approved with required changes | M-1 to M-15 verified. New **S-6 (P0, outside this layer)**: `allocate-free-tier` grants credits to any body-supplied account, unauthenticated and repeatable, and unfreezes frozen accounts, so it is excluded from Q-1 (WC-2) and raised to the user. Rulings: Q-1 A for the four Stripe routes only; Q-2 register first, preserving stored severity and flags; M-4 remove GET; Q-3 gate the three admin reads in step 0, with the overlap noted for the queued task; Q-4 if the metadata admin policy is live, drop it alone and immediately, do not replace it; Q-5 (i); OQ-11 (a) after the read; OQ-12 approved; Q-7 accepted; Q-8 as a rename, not a move; Q-9 two PRs. WC-1 to WC-12: one notification per call; `getBriefing` trigger position; multi-area `area`; zero group-check exclusions live; lenient read filters; live proof of the exclusion filter; insight catch path; platform actor check; 401 telemetry; S-6 recorded; stored data unchanged for registered events. User asks: S-6 urgent fix, the Q-4 SQL read, the Q-6 approval |
