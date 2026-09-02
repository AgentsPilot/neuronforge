# Plugin Route Identity Hardening

> **Last Updated**: 2026-08-19

**Author:** Dev
**Status:** ✅ **QA PASSED (with notes) 2026-08-19** — SA's R1/R3/R3b/R2/R4 all fixed and verified; security invariant independently re-derived on all 12 handlers; 52 tests green; no must-fix issues. Awaiting user code review → RM. See [QA Report](#qa-report-2026-08-19).
**Parent:** [Module → Internal Plugin Roadmap](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md) § Cross-Cutting Open Issues ("Execute-route hardening").

## Overview

Four `/api/plugins/*` routes accept a **caller-supplied `userId`** and perform work as that user with **no authentication whatsoever**. The most severe, `POST /api/plugins/execute`, will run **any plugin action as any user** — including actions backed by that user's OAuth credentials (Gmail send, Drive delete, Sheets write) and every internal Business OS module operation.

The roadmap describes this as "impersonation-style". That understates it: there is no session check to bypass. `middleware.ts` performs subdomain routing and an onboarding redirect only — it is **not** an auth gate, and `/api/*` is explicitly skipped even from that. A request needs only a user's UUID.

This workplan derives identity **server-side** on all four routes, with an **admin-gated act-as override** so the internal test page keeps working.

## Table of Contents

1. [Evidence](#1-evidence)
2. [Scope](#2-scope)
3. [Decisions](#3-decisions)
4. [Tasks](#4-tasks)
5. [Tenant-isolation analysis](#5-tenant-isolation-analysis)
6. [Tests](#6-tests)
7. [Risks & questions for SA](#7-risks--questions-for-sa)
8. [Verification](#8-verification)
9. [Change History](#change-history)

---

## 1. Evidence

### The exposed routes

| Route | Identity source today | Effect of an unauthenticated call |
|---|---|---|
| `POST /api/plugins/execute` (`route.ts:16`) | `body.userId` | Executes any plugin action as that user — **including OAuth-backed external side-effects** and all internal BOS module ops |
| `POST /api/plugins/disconnect` (`route.ts:16`) | `body.userId` | **Destructive** — removes the user's plugin connection |
| `GET /api/plugins/user-status` (`route.ts:78`) | session, **falling back** to `?userId=` | Discloses which plugins a user has connected, with connection details |
| `POST /api/plugins/additional-config` (`route.ts:18`) | `body.userId` | Writes plugin connection config |

Confirmed by inspection: `execute`, `disconnect` and `additional-config` contain **no** `getUser`/`getCachedUser`/admin call at all.

### The fallback anti-pattern

`user-status` (`:69-86`) and `refresh-token` (`:24-38`) try cookie auth first and then **fall back to a caller-supplied `userId`** "for backward compatibility" — which defeats the check entirely, since an attacker simply sends no cookie.

**Why the fallbacks exist — corrected per SA C1.** The two routes are **not** the same story:

- **`user-status` — chunked-cookie miss (confirmed).** It called `getCachedUser` (`lib/cachedAuth.ts:23-31`), which reads only `sb-access-token` / `` sb-<ref>-auth-token `` and returns `null` **before ever contacting Supabase** when neither exists. This project's Supabase sessions exceed `MAX_CHUNK_SIZE`, so `@supabase/ssr` writes them **only** as `` …-auth-token.0/.1/… `` — the base name is never written (`middleware.ts:91-104` loops those chunks explicitly). Its primary check therefore failed silently for logged-in users and the fallback masked it.
- **`refresh-token` — plain legacy cruft.** It used `createAuthenticatedServerClient()`, whose cookie adapter **is** chunk-aware. Its cookie auth worked; the fallback was never load-bearing.

**The argument for D4 is therefore not "getUser handles chunks and the other doesn't" alone, but consistency:** `getUser()`/`createAuthenticatedServerClient()` is the proven path used by **137 API route files**, while `getCachedUser` had exactly **one** consumer in the entire repo — the single route carrying the insecure fallback.

### Blast radius of a fix

Every caller is a **browser page that already carries session cookies**:
- `lib/client/plugin-api-client.ts:169` (`executeAction`) ← `app/test-plugins-v2/page.tsx`, `app/test-business-os/page.tsx`
- `app/test-business-os/page.tsx:225` already sends `body.userId = user.id` — the session user, so it satisfies the new rule unchanged.
- `app/test-plugins-v2/page.tsx:786` holds a **typed / env-seeded** `userId` (`NEXT_PUBLIC_TEST_PAGE_USER_ID`) — this is the act-as workflow the override preserves.

No server-to-server, cron, or script caller of these four routes exists (searched `app`, `components`, `lib`, `scripts`).

---

## 2. Scope

**In scope** (user decision, 2026-08-19: *all four routes*, *admin-gated override*)
- A shared identity resolver used by all four routes.
- Harden `execute`, `disconnect`, `user-status`, `additional-config`.
- Remove the `refresh-token` query-param fallback (`:31-38`) — same anti-pattern, same fix.
- Audit-log every act-as call.
- Convert the touched routes' `console.*` to Pino (CLAUDE.md mandatory rule — `execute`, `disconnect` and `additional-config` log via `console.*` today).
- Tests, including the isolation invariants.

**Out of scope — tracked**

| Item | Why |
|---|---|
| `GET /api/plugins/execute` (the action-catalogue read) | Unauthenticated metadata read; already noted in `action-schema/route.ts:19`. Contains no user data. Leave, or gate in a follow-up — **SA Q1**. |
| Other routes repo-wide with body-supplied identity | This change establishes the pattern; a repo-wide sweep is a separate audit. |
| `/test-plugins-v2` defaulting its `userId` box to the session user | UX nicety, not required for correctness — see P5 / **SA Q2**. |
| ~~The chunked-cookie weakness in `getCachedUser` itself~~ | **Superseded (SA C11).** It was never "a shared helper other code depends on" — all three of its exports were dead once `user-status` moved to the resolver. `lib/cachedAuth.ts` is **deleted** in this PR; `docs/PERFORMANCE_OPTIMIZATION_PLAN.md` §4A is marked superseded so nobody rebuilds it, and a chunk-aware cache *inside the resolver* is tracked on the roadmap. |

---

## 3. Decisions

**D1 — Identity is server-derived, always.** Each route resolves the acting user from the session. A body/query `userId` is no longer an identity claim; it is at most an **act-as request**.

**D2 — Act-as is admin-gated.** A `userId` different from the session user is honoured **only** if the session user is a platform admin per `AdminAccessService.isAdminById` — the `admin_users` table, never `profiles.role` (CLAUDE.md security rule; `isAdminById` already fails closed on error). Non-admin → **403**, no session → **401**.

**D3 — Self-targeting is always allowed.** `userId === session.id` is not an act-as; it passes for any authenticated user. This keeps `/test-business-os` and any user testing their own plugins working untouched.

**D4 — Use `getUser()` (`lib/auth.ts`), not `getCachedUser()`.** `getUser` builds a `createServerClient` with `cookieStore.getAll()`, so it handles the **chunked** auth cookies this project actually sets; `getCachedUser`'s single-name lookup does not (§1). Correctness first: we are removing the fallbacks that were masking exactly this.
> Cost: one Supabase auth round-trip per call (CLAUDE.md notes 200–1880 ms). Accepted — these are interactive, low-volume routes, and `user-status` keeps its own 30 s response cache. If it bites, the right fix is to make the *shared* cache chunk-aware, not to reinstate a fallback. **SA Q3.**

**D5 — Every act-as is audited.** Non-blocking `AuditTrailService.log({ action: 'PLUGIN_ACT_AS', severity: 'warning', userId: <admin>, entityType: 'plugin', … })` carrying the admin id, the target user id, route, and plugin/action. An admin acting as another user must leave a trail.

**D6 — Distinct, honest status codes.** `401` unauthenticated · `403` authenticated but not permitted to act as the target · `400` malformed. No silent downgrade to "acting as yourself" when an override is refused — that would execute a *different* action than asked.

**D7 — Cache keys stay keyed on the resolved id.** `user-status`'s `plugin-status-${userId}` and `disconnect`'s invalidation must use the **resolved** id so an act-as call cannot poison another user's cache entry.

---

## 4. Tasks

### P1 — Shared resolver
**New file:** `lib/server/plugin-route-identity.ts`

```ts
export type IdentityResolution =
  | { ok: true; userId: string; actingAs: boolean; sessionUserId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function resolvePluginRouteIdentity(
  requestedUserId?: string | null
): Promise<IdentityResolution>
```

Logic: `getUser()` → null ⇒ `401`. No `requestedUserId`, or equal to the session id ⇒ `{ok, userId: session.id, actingAs: false}` (D3). Different ⇒ `isAdminById(session.id)`; true ⇒ `{ok, userId: requested, actingAs: true}`; false ⇒ `403` (D2).

A second helper writes the D5 audit entry so the four routes do not each re-implement it.

### P2 — `POST /api/plugins/execute`
Replace `const { userId } = body` with the resolver; pass the **resolved** id to `PluginExecuterV2.execute`. Convert the 3 `console.*` calls to Pino with a `correlationId` child logger. Keep the existing response shape (the client only reads `success`/`data`/`error`).

### P3 — `POST /api/plugins/disconnect`
Same resolver. Use the resolved id for both `disconnectPlugin` and the `pluginStatusCache.invalidate` key (D7). Convert 4 `console.*` to Pino. This route is destructive — it is the one where a silent behaviour change would be worst, so an act-as refusal must 403 loudly (D6).

### P4 — `GET /api/plugins/user-status` and `POST /api/plugins/additional-config`
Delete the `user-status` query-param fallback (`:78-86`) and route both through the resolver; keep `user-status`'s response cache but key it on the resolved id. `additional-config` also gets its `console.*`/`debug` logging converted.

### P5 — `refresh-token` fallback
Remove the `searchParams.get('userId')` fallback (`:31-38`) and use the resolver, so an admin can still refresh on behalf of a user but an anonymous caller cannot.

*(Optional, SA Q2: default `/test-plugins-v2`'s `userId` box to the session user so non-admins are not met with a 403 on first use.)*

### P6 — Tests
See §6.

---

## 5. Tenant-isolation analysis

Applying the `tenant-isolation-guard` skill. These routes are the textbook case it exists for: **service-role work driven by a caller-supplied id.**

| Vector | Before | After |
|---|---|---|
| Identity claim | `body.userId` — **unauthenticated**; the caller *is* whoever they say | Derived from the session cookie; the body value is only a request to act as someone |
| Cross-tenant execution | Any user's plugin actions, incl. OAuth side-effects | Only self, or an explicit admin act-as (audited) |
| Destructive cross-tenant write (`disconnect`) | Any user's connection | Same gate |
| Information disclosure (`user-status`) | Any user's connected plugins | Same gate |
| Cache poisoning | Keys built from the claimed id | Keys built from the resolved id (D7) |
| Fail-closed | — | `isAdminById` returns `false` on error (`AdminAccessService.ts:143-146`); no session ⇒ 401 |

The plugin executor's own tenant scoping (`connection.user_id`, `db_active`) is unchanged and remains the second layer — this fixes the layer above it, which was absent.

---

## 6. Tests

`lib/server/__tests__/plugin-route-identity.test.ts` — the resolver:

| # | Case | Expect |
|---|---|---|
| R1 | No session | `401`, admin check never called |
| R2 | Session, no `requestedUserId` | ok, session id, `actingAs:false` |
| R3 | Session, `requestedUserId === session.id` | ok, `actingAs:false`, admin check **not** required (D3) |
| R4 | Session non-admin, different `requestedUserId` | `403` |
| R5 | Session admin, different `requestedUserId` | ok, requested id, `actingAs:true` |
| R6 | Admin check throws | `403` (fails closed) |

`app/api/plugins/execute/__tests__/route.test.ts` and one per hardened route:

| # | Case | Expect |
|---|---|---|
| E1 | Unauthenticated, body carries a victim `userId` | **401**, and `PluginExecuterV2.execute` **never called** — the core regression lock |
| E2 | Authenticated, no `userId` | 200, executor receives the **session** id |
| E3 | Authenticated non-admin, foreign `userId` | **403**, executor never called |
| E4 | Authenticated admin, foreign `userId` | 200, executor receives the **foreign** id, and an audit entry was written (D5) |
| E5 | Unknown plugin/action | 404 as today (behaviour preserved) |
| D1 | `disconnect` unauthenticated | 401, `disconnectPlugin` never called |
| D2 | `disconnect` admin act-as | cache invalidated for the **resolved** id (D7) |
| U1 | `user-status` with only `?userId=`, no session | **401** (the fallback is gone) |
| A1 | `additional-config` unauthenticated | 401, no write attempted |

---

## 7. Risks & questions for SA

- **R1 — This is a real behaviour change, deliberately.** Any unauthenticated caller of these routes stops working. That is the point; the evidence says every legitimate caller is a session-bearing browser page. SA should sanity-check that inventory (§1) — a missed cron/script caller would break.
- **R2 — `/test-plugins-v2` for non-admins.** After this, a logged-in non-admin can only test **their own** plugins there. Acceptable per the user's decision; P5-optional softens the UX.
- **R3 — `getUser()` per request** costs an auth round-trip on `user-status`, the chattiest of the four. Mitigated by its existing 30 s response cache. Alternative (making `getCachedUser` chunk-aware) touches a shared helper — deliberately deferred.
- **Q1** — Should the unauthenticated `GET /api/plugins/execute` action catalogue be gated too, or is plugin metadata intentionally public (as `action-schema/route.ts:19` implies)?
- **Q2** — Include the optional P5 test-page UX change here, or keep this PR purely server-side?
- **Q3** — Endorse D4 (`getUser` over `getCachedUser`)? The chunked-cookie finding is the crux; if SA disagrees, the fallbacks cannot be safely removed until the cache is fixed first.
- **Q4** — Is `PLUGIN_ACT_AS` the right audit action name, or does an existing convention cover admin-on-behalf-of actions?

---

## 8. Verification

- `npx tsc --noEmit` — no new errors in touched files.
- `npx jest lib/server/__tests__/plugin-route-identity app/api/plugins` — green.
- `grep -rn "console\." app/api/plugins/{execute,disconnect,additional-config}/route.ts` — empty.
- `grep -rn "searchParams.get('userId')\|body.userId" app/api/plugins/` — no remaining identity-from-caller reads.
- Manual: as a logged-in non-admin, `/test-business-os` module ops still succeed (self-targeting, D3).
- QA: happy path + 401 + 403 per route.

---

## SA Review (2026-08-19)

**Reviewed by SA — 2026-08-19**
**Verdict:** 🔄 **APPROVE-WITH-CHANGES** — the diagnosis and the shape of the fix are correct and the severity claim is confirmed. Do **not** start implementation until C1–C9 are folded into the workplan; C10–C16 are required-or-justify.

All findings below were verified against live source (not the workplan's line numbers).

### Per-item confirmation

| # | Claim under review | Verdict | Evidence |
|---|---|---|---|
| 1 | `execute`, `disconnect`, `additional-config` have **no** authentication | ✅ **Confirmed** | No `getUser`/`getCachedUser`/`AdminAccessService` import in any of the three files. `execute:16` `const { userId, … } = body` → `pluginExecuter.execute(userId, …)` at `:54`. `disconnect:16` → `disconnectPlugin(userId, …)` at `:33`. `additional-config:18` → `updateAdditionalConfig(userId, …)` at `:64`. |
| 1b | `middleware.ts` is not an auth gate for `/api` | ✅ **Confirmed** | `middleware.ts:58` puts `pathname.startsWith('/api')` in `skipOnboardingCheck` → `NextResponse.next()` at `:79`. Even on non-skipped paths it only *redirects to onboarding*; it never rejects. Severity claim stands: **unauthenticated arbitrary-user plugin execution, incl. OAuth side-effects**. |
| 2 | §1's chunked-cookie inference (the crux of D4) | 🟡 **Half right — must be corrected** | See **C1**. Correct for `user-status`/`getCachedUser`; **wrong for `refresh-token`**. |
| 3 | Caller inventory ("every caller is a session-bearing browser page") | ✅ **Correct conclusion, incomplete list** | No server-to-server/cron/script caller exists: server-side plugin execution imports `PluginExecuterV2` **directly** (`lib/pilot/StepExecutor.ts`, `lib/agentkit/runAgentKit.ts`, `lib/business-os/ChatCommandExecutor.ts`, `lib/services/CalendarSyncService.ts`, `lib/notifications/emailTransport.ts`, `app/api/v6/fetch-plugin-data`, `app/api/plugins/fetch-options`) — never over HTTP. Every `/api/plugins/{execute,disconnect,additional-config,user-status,refresh-token}` fetch originates in a `'use client'` file. **Missing from §1:** `components/settings/PluginCard.tsx:74,177,209`, `components/settings/AdditionalConfigModal.tsx:95`, `components/v2/Footer.tsx:190,245,408,465`, `components/v2/PluginRefreshModal.tsx`, `components/scheduling/CalendarSyncSettings.tsx:162,215`, `components/UserProvider.tsx:40`, `app/(protected)/settings/connections/page.tsx:59,177`, `app/v2/agents/new/page.tsx`, `components/agent-creation/conversational/hooks/useConversationalFlow.ts`, `components/test-plugins/tester/FormTester.tsx:206`, `lib/client/plugin-api-client.ts:53,134,169,317`. All pass `user.id` from the live session (self-target ⇒ D3 covers them) — **except** the two test pages. |
| 4 | D2/D3 admin-gated act-as, self always allowed | 🟡 **Right policy, wrong API** | `admin_users` via `AdminAccessService` is correct per CLAUDE.md. But `isAdminById` (`AdminAccessService.ts:135`) deliberately skips the email self-heal **and** the `ADMIN_EMAILS` env bootstrap. See **C5**. Fail-closed claim ✅ confirmed (`:141-144` returns `false` on error). |
| 5 | D7 cache keys on the resolved id | ✅ Necessary, ⚠️ **not sufficient** | Other writers of the same key: `refresh-token:123,194`, `app/api/oauth/token/route.ts:73,90,107` (id parsed from the OAuth `state`), `app/api/plugin-connections/save/route.ts:51` (id from body, **unauthenticated** — see C9). Bigger finding: `user-status` returns `Cache-Control: public, max-age=30, stale-while-revalidate=60` (`:97`,`:189`) on user-specific data — see **C3**. |
| 6 | Shared resolver in `lib/server/` | ✅ **Right home** — middleware is wrong | Middleware runs on the Edge runtime, can't reach `AdminUserRepository`/service-role, and can't express per-route 401/403 semantics; it is also currently a *redirect* layer, not a *reject* layer. A plain helper matches the 137 API routes that already call `getUser()` directly, so it introduces no new pattern (CLAUDE.md rule 7). A route wrapper/HOF would be a new pattern — don't. Signature/ownership changes: **C7**, **C15**. |
| 7 | Test matrix §6 | 🟡 Core lock right, gaps | E1 is the correct regression lock. Missing cases: **C12**. |
| 8 | Q1–Q4 | Answered below | |

---

### Required changes

**C1 — High. Correct §1's inference; it is right for `user-status` and wrong for `refresh-token`. D4 survives, with better evidence.**
- ✅ `getCachedUser` (`lib/cachedAuth.ts:24-31`) reads exactly two **unchunked** cookie names and returns `null` **before ever contacting Supabase** when neither exists. With `@supabase/ssr@0.6.1`, a session larger than `MAX_CHUNK_SIZE = 3180` (`node_modules/@supabase/ssr/dist/main/utils/chunker.js:7`) is stored **only** as `…-auth-token.0/.1/…`; the base name is not written. `.env.local` project ref `jgccgkyhpwirgknnceoh` matches the chunk loop hardcoded at `middleware.ts:91-104`. So `user-status`'s primary check silently fails and the query-param fallback masks it — **Dev's inference confirmed for this route.**
- ❌ `refresh-token` does **not** use `getCachedUser`. It calls `createAuthenticatedServerClient()` (`:24`), whose deprecated `get`-style cookie adapter is chunk-aware: `cookies.js:32-49` (`getWithHints` probes `key`, `key.0`…`key.4`) + `combineChunks`. Its cookie auth therefore **works today**; its fallback is plain legacy back-compat, not a chunked-cookie workaround. Rewrite that sentence — leaving it in the doc will mislead the next reader into "fixing" a helper that isn't broken.
- Corroboration for D4 that the workplan should cite instead: `getUser()`/`createAuthenticatedServerClient()` is the proven path — **137 API route files** import `@/lib/auth`, `app/api/plugins/fetch-options/route.ts:57-66` authenticates this exact way and works in production, and every `/api/business-os/*` route the live-verified `/test-business-os` page calls uses `getUser()`. Meanwhile **`getCachedUser` has exactly one consumer in the entire repo: `user-status`** — the one route with the fallback. That is the whole argument.

**C2 — High. Zod is missing from the plan entirely. I cannot approve API-route work without it (CLAUDE.md mandatory rule 2).**
All four routes hand-roll `if (!userId || !pluginName)`. Add Zod schemas for every handler in scope: `execute` POST body + GET query, `disconnect` POST body + GET query, `additional-config` POST/PUT body + GET query, `user-status` GET query, `refresh-token` POST body (`pluginKeys?: string[]`). In-folder precedent to copy: `action-schema/route.ts` and `test-audit/route.ts` (safeParse → 400 with `details` gated on `NODE_ENV === 'development'`). `userId` must be `z.string().uuid()` — see C7.

**C3 — High. `user-status` must stop sending a shared-cache header, and this change makes it urgent.**
`:96-98` / `:187-190` emit `Cache-Control: public, max-age=30, stale-while-revalidate=60`. Today the two call shapes have different URLs (`?userId=…` vs bare). After the fallback is removed **every caller hits the identical URL `/api/plugins/user-status`**, with the response varying only by cookie — a textbook shared-cache cross-user leak on any CDN/proxy. Change to `Cache-Control: private, no-store` (the only client, `plugin-api-client.ts:56`, already fetches with `cache: 'no-store'`, so nothing regresses). Add `Vary: Cookie` if any caching is kept.

**C4 — High. Scope says "four routes" but only covers one verb on three of them.** Unauthenticated, caller-id-driven handlers left standing under the current plan:
- `disconnect` **GET** (`:72-101`) — discloses any user's connection status/expiry from `?userId=`.
- `additional-config` **GET** (`:114-147`) — returns any user's stored plugin config from `?userId=`.
- `additional-config` **PUT** (`:152-222`) — **writes** any user's plugin config from `body.userId`; it is a near-copy of POST and is what `AdditionalConfigModal.tsx:95` uses in edit mode.
Route the resolver through all of them, or the "fix" is one `curl` away from being bypassed. Update the §1 table and §8 verification greps accordingly.

**C5 — High. D2 must call `isAdmin({ id, email })`, not `isAdminById(id)`.**
`isAdminById` (`:135-146`) only checks `cache.userIds` — it skips the seeded-by-email self-heal (`:106-114`) and the `ADMIN_EMAILS` env bootstrap (`:117-122`). An operator whose `admin_users` row exists by email but is not yet bound to a `user_id`, or who is env-bootstrapped pre-seed, would get a 403 on act-as. The resolver already has the full auth user from `getUser()`, so the email is free. This also matches the only two existing gates in the repo (`app/api/admin/agents/route.ts:31`, `app/api/v2/calibrate/batch/route.ts:117`).

**C6 — High. D5's audit entry is wrong on both the action name and the identity fields.**
- There is an existing registry: `lib/audit/events.ts`. `getEventMetadata` (`:786-791`) falls back to `{severity:'info', description:'Unknown event: PLUGIN_ACT_AS'}` for unregistered strings — so a raw literal produces a low-severity, uncategorised row. Either reuse `AUDIT_EVENTS.ADMIN_IMPERSONATION_STARTED` (`:117`, already `severity: 'critical'`, `SOC2`) or **register** `PLUGIN_ACT_AS` in both `AUDIT_EVENTS` and `EVENT_METADATA` (`critical` + `SOC2`). See Q4 for my recommendation.
- The schema already models this: `AuditTrailService.buildLogEntry:107` — `user_id` = subject, `actor_id` = "who actually did it (for impersonation/admin actions)" (`lib/audit/types.ts:67`). So log `userId: <target>`, `actorId: <admin>` — **not** `userId: <admin>` as D5 states. Pass `request` so IP/UA/session context is captured (`extractRequestContext`), and keep it non-blocking with `.catch(err => logger.error(...))`.

**C7 — High. Resolver fail-closed details.**
- `getUser()` (`lib/auth.ts`) has **no** try/catch — a Supabase network error **throws**. The resolver must wrap it and return `401` (never let it become a 500, never let it fall through).
- Validate `requestedUserId` as a UUID and return **400** if malformed, *before* the admin lookup. Without this, arbitrary strings flow into `plugin-status-${userId}` cache keys, executor lookups and audit rows. Note `/test-plugins-v2`'s default body ships `userId: "test_user_123"` (`page.tsx:772`) — non-UUID; it will now be a clean 400.
- Return the whole session user (id + email) so callers/audit don't re-fetch.

**C8 — Medium. `console.*` counts are wrong and one file in scope is omitted.** Actual per-file totals: `execute` **5** (plan says 3), `disconnect` **7** (plan says 4), `additional-config` **11**, `refresh-token` **11** (plan converts none — P5 touches this file, so CLAUDE.md § Logging applies), `user-status` 0 (already Pino). Whole-file conversion, including the GET/PUT handlers, not just the lines the diff otherwise touches.

**C9 — High. There is a fifth, worse route in the same cluster: `app/api/plugin-connections/save/route.ts`.**
Unauthenticated `POST`, **service-role client**, `user_id` straight from the body, `upsert` into `plugin_connections` on `(user_id, plugin_key)` — i.e. **anyone can write `access_token`/`refresh_token`/`credentials` into any user's plugin connection**. That is credential injection, strictly worse than `execute`. It is `@deprecated` and has **zero callers repo-wide**. Delete the route in this PR (or return 410) — dead code, no blast radius, and it also writes the shared `pluginStatusCache` key (`:51`), so it belongs to this workplan's cache-integrity story. If the user prefers to keep scope tight, it must at minimum become a P0 line item in the roadmap, not a generic "repo-wide sweep later".

**C10 — Medium. A documented post-login cookie race will bite this change.**
`components/UserProvider.tsx:38-39`: *"Pass userId explicitly to avoid race condition with cookie-based auth. Cookie auth may not be ready immediately after session is established."* That is a production reason the `user-status` fallback is load-bearing. Removing it means the first post-login plugin fetch may 401 and leave `connectedPlugins` empty (Footer badges, connections page, agent-creation plugin lists). Required: on 401, retry once after the next `onAuthStateChange`/short backoff and degrade to "no plugins" rather than throwing; add an explicit QA step "log out → log in → land on dashboard → connected plugins render on first paint".

**C11 — Medium (do-or-justify). §2's reason for deferring the `getCachedUser` fix is factually wrong.**
It is not "a shared helper other code depends on" — it has exactly **one** consumer (`user-status`), which this PR is rewriting. So after P4, `lib/cachedAuth.ts` becomes dead code. Two honest options: (a) fix it chunk-aware in ~15 lines (build the cache key from `cookies().getAll()` entries whose name starts with `sb-`, then verify at most once per 30 s) and keep the 30 s auth cache on the chattiest route, or (b) delete `lib/cachedAuth.ts` and accept the round trip. Silently leaving a broken, unused auth helper in the tree invites someone to reintroduce it. Note the perf delta this decision governs: today `user-status` does **zero** auth round trips for chunked-cookie callers (the pre-check short-circuits); after D4 every call pays 200–1880 ms, and `UserProvider` + `Footer` + `/settings/connections` all call it on mount. I lean (a).

**C12 — Medium. Test matrix additions (all cheap, all guard something real):**

| # | Case | Expect |
|---|---|---|
| R7 | `getUser()` **throws** | `401`, not a 500 (C7) |
| R8 | `requestedUserId` malformed / non-UUID | `400`, admin check never called |
| R9 | Admin act-as, audit write **rejects** | resolution still `ok` (audit is non-blocking) |
| E6 | Admin act-as audit payload | `userId` = target, `actorId` = admin, registered action name (C6) |
| U2 | `user-status`: authenticated non-admin + foreign `?userId=` | `403` |
| U3 | `user-status`: admin act-as populates victim key, then the admin's own call | returns the **admin's** data (D7 cache-isolation lock) |
| U4 | `user-status` response headers | no `public` cache directive (C3) |
| A2 | `additional-config` **PUT** unauthenticated | `401`, no write (C4) |
| A3 | `additional-config` **GET** unauthenticated | `401` (C4) |
| D3t | `disconnect` **GET** unauthenticated | `401` (C4) |
| T1 | `refresh-token` unauthenticated with `?userId=` | `401`, no token refresh attempted |

Route tests follow the existing pattern in `app/api/admin/agents/__tests__/route.test.ts`.

**C13 — Medium. `/test-plugins-v2` will hard-break for its current operating mode, and P5-optional does not fix it.** The page has **no** login UI and no `useAuth` — it is used today with a typed/`NEXT_PUBLIC_TEST_PAGE_USER_ID`-seeded id and (possibly) no session at all. After this change it requires (a) a logged-in session in that browser and (b) platform-admin for any id other than your own. Add to the workplan: a visible "signed in as / not signed in" banner or at least a doc note + the P5 default-to-session-user change (see Q2), and update `docs/V2_TEST_PAGE_SCOPE.md`. `/test-business-os` is unaffected — `page.tsx:225` sends `user.id` from `useAuth`, i.e. self-target (D3), and its other calls already use `getUser()`.

**C14 — Low. `app/api/plugins/test-audit/route.ts` is itself unauthenticated** (anyone can forge `PLUGIN_TESTER_EXECUTE` audit rows for any `targetUserId`). Its header comment (`:17-24`) explicitly records "the /test-plugins-v2 surface is unauthenticated … rides the future F3 remediation cycle" — **this workplan is that cycle**. Update the comment and either gate the route with the same resolver or fold the audit into `execute` now that operator identity is verified. Track it if not done here.

**C15 — Low. Resolver ergonomics.** Name it generically (`lib/server/route-identity.ts` / `resolveActingUserIdentity`) — the roadmap's repo-wide sweep will reuse it beyond `/api/plugins`. Take an options object `{ request, requestedUserId, route, details }` rather than a bare string, and write the D5 audit **inside** the resolver when `actingAs === true`, so five call sites can't each forget it (D5's "second helper" is one `await` away from being skipped). Keep the discriminated-union return — it is good, and it makes E1/E3 trivially testable.

**C16 — Low. Cross-origin cookie risk in the shared client.** `PluginAPIClient` builds absolute URLs from `NEXT_PUBLIC_APP_URL` (`plugin-api-client.ts:13`). If that value ever differs from the browsing origin (preview deploys, the `*.agentpilot.io` subdomain rewrite in `middleware.ts:34-45`), `fetch` defaults to `credentials: 'same-origin'` and **drops the cookies** — today masked by the `userId` fallback, tomorrow a blanket 401. Make browser calls relative (`baseUrl = ''` when `typeof window !== 'undefined'`) or verify the Vercel value equals the deployed origin before shipping.

---

### Answers

**R1 — Caller inventory: endorsed, with the additions in the table above.** No cron/script/server-to-server caller exists; server-side execution never goes through HTTP. The only breakage is `/test-plugins-v2` (C13) and the post-login race (C10). Proceed.

**R2 — `/test-plugins-v2` for non-admins: accepted**, but treat C13 as part of the work, not a nicety — the page currently works with no session at all, so "non-admins can only test their own plugins" understates the change.

**R3 — Perf: accepted, but decide C11 rather than deferring it.** The claim "`user-status` keeps its own 30 s response cache" is only half a mitigation: that cache can only be consulted *after* identity is resolved, so the auth round trip is paid on every call regardless.

**Q1 — Leave `GET /api/plugins/execute` public; do not gate it here.** It is consistent with the documented metadata-only invariant in `action-schema/route.ts:15-23` (a prior SA decision) and returns no user data. Two caveats to record as follow-ups: (i) unlike `/api/plugins/available`, the catalogue does **not** apply `isPluginDiscoverable`, so it enumerates `business_os` internal modules that visibility scoping intentionally hides (`plugin-manager-v2.ts:180-186` vs `:300`) — a discovery leak, not a data leak; (ii) it should still get Zod + Pino under C2/C8 since the file is being rewritten anyway.

**Q2 — Yes, include the P5 UX change.** It is ~5 lines in a test page, it is the difference between "the harness still works" and "the harness 403s on first use", and splitting it costs another review cycle. Fold it in with C13.

**Q3 — D4 endorsed** (`getUser()` over `getCachedUser()`), on the corrected evidence in C1: 137 routes already use it, `getCachedUser` has a single consumer, and the chunk-unaware pre-check is real. Pair it with a decision on C11 so we don't leave a broken helper behind.

**Q4 — Don't invent a bare `PLUGIN_ACT_AS` string.** Preferred: add `PLUGIN_ACT_AS: 'PLUGIN_ACT_AS'` to `AUDIT_EVENTS` **and** an `EVENT_METADATA` entry (`severity: 'critical'`, `complianceFlags: ['SOC2']`, description "Admin executed a plugin route on behalf of another user") — plugin-specific granularity, correctly categorised. Acceptable alternative: reuse `AUDIT_EVENTS.ADMIN_IMPERSONATION_STARTED`. Either way, `userId` = target and `actorId` = admin (C6).

### Approval

- [ ] Workplan approved — proceed to implementation **after C1–C9 are folded in and C10–C16 are addressed or explicitly justified in the workplan.**
- Re-review by SA is **not** required for C8/C12–C16 (mechanical); ping me if C9 or C11 is resolved differently than recommended.

### SA follow-up ruling (2026-08-19) — C9 and C11

**C9 — Delete `app/api/plugin-connections/save/route.ts`: agreed, and independently re-verified.** No importer anywhere in `app`, `components`, `lib`, `hooks`, `scripts`, `e2e` or `docs`; the dependency runs one way only (the route imports `pluginStatusCache`, nothing imports the route), so deletion cannot affect the cache module. Ship it in this PR.

**C11 — Option (b) ACCEPTED: delete `lib/cachedAuth.ts`. The hybrid is rejected.**

Your security argument outranks my perf argument, and two facts found while checking it push further in your direction:

1. **All three exports are dead after P4, not just one.** `invalidateAuthCache` and `clearAuthCache` already have **zero** consumers repo-wide today; `getCachedUser`'s only consumer is `user-status`. Deleting the file removes three dead exports, not one.
2. **The perf regression is smaller than C11 claimed.** `requestDeduplicator` (`lib/utils/request-deduplication.ts`, `DEFAULT_TTL = 1000`) keys on `plugin-status-${userId}`, and `UserProvider:40`, `Footer:190/245` and `/settings/connections:59` all pass the same `user.id` — concurrent mounts collapse into **one** in-flight request. So first paint pays roughly **one** auth round trip, not three. Treat my "3× on mount" framing in C11 as corrected.

**Why not the hybrid (cache the self path, fresh `getUser()` on act-as):** it puts two different freshness semantics inside a single security boundary, which is the exact ambiguity the resolver exists to eliminate. Act-as is a rare admin path, so "cache only self" is functionally "cache ~all traffic" with an extra branch — you would carry the branch cost and the staleness window and keep a defective helper alive, for a latency win the dedup already partly delivers. Reject.

**Conditions on (b):**

| # | Condition | Why |
|---|---|---|
| C11.1 | Delete the whole file (all three exports), not just the `getCachedUser` call site | Dead code; leaving the module is the reuse hazard both of us flagged |
| C11.2 | Amend `docs/PERFORMANCE_OPTIMIZATION_PLAN.md` — the `#4A` row (`:1777`) and the still-**open** checklist at `:463-530` ("Create `lib/server/cachedAuth.ts`", "Update high-traffic API routes to use `getCachedUser()`") | That doc actively instructs the next dev to build and spread the helper you are deleting. Record: superseded — chunk-unaware pre-check, removed 2026-08-19, use `getUser()` |
| C11.3 | Instrument the resolver: log the `getUser()` duration (`logger.debug({ durationMs, route }, 'identity resolved')`) | Makes the deferred perf decision measured rather than argued. CLAUDE.md quotes 200–1880 ms; we currently have no number for this path |
| C11.4 | Add the follow-up to the roadmap's cross-cutting list: *"chunk-aware identity cache inside the route-identity resolver — requires an explicit staleness/revocation decision"* | Deferred, not dropped, and pinned to the one place it can live safely |

No re-review needed for C9 or C11 as scoped above. Everything else stands as written in this SA Review; implement C1–C16 and hand back for code review.

## Implementation notes (Dev, 2026-08-19)

**Status:** implemented; SA's C1–C16 applied, plus two findings neither the workplan nor the SA review had caught (below). User decisions folded in: admin-gated act-as; all routes in one PR; delete the deprecated `plugin-connections/save`.

### Two further exposed handlers found during implementation

Scoping said "four routes". The real cluster is **eight handlers across six files** — `app/api/plugin-connections/route.ts` was missed by both the workplan and the SA review, and contains the worst of them:

| Handler | Before | Severity |
|---|---|---|
| `GET /api/plugin-connections?plugin_key=…&user_id=…` | No auth. Read the row, called `decryptCredentials(...)`, and **returned the stored username/password in plaintext** | **Critical** — anonymous credential exfiltration |
| `POST /api/plugin-connections` | No auth. Inserted a connection with body-supplied `user_id`, `access_token` and credentials | Critical — credential injection (same class as the deleted `save` route, but with live callers) |
| `DELETE /api/plugin-connections` | Authenticated **only when `user_id` was absent**; `?user_id=<victim>` skipped the check entirely | High — destructive |

**The credential-returning GET branch was deleted, not gated.** It had zero callers repo-wide (`decryptCredentials` has no other consumer), and returning decrypted credentials over HTTP is not a primitive worth keeping even behind auth. The remaining GET branch — the authenticated "list my connections" path both live callers actually use — was kept and routed through the resolver. `POST` has zero callers but is a legitimate capability, so it was hardened rather than removed.

### What was built

| File | Change |
|---|---|
| `lib/server/route-identity.ts` | **New.** `resolveActingUserIdentity({ requestedUserId, route, request, details })` → discriminated union. Session via `getUser()` (wrapped: a throw is a 401, never a 500); self-target needs no admin check; foreign target validated as a UUID (400) then gated on `adminAccessService.isAdmin({ id, email })` (403), with the act-as audit written **inside** the resolver so no call site can skip it. Admin-check throw → 403, not 500. |
| `lib/audit/events.ts` | Registered `PLUGIN_ACT_AS` in `AUDIT_EVENTS` + `EVENT_METADATA` (`critical`, `SOC2`) so it is not degraded to `severity:'info'` as an unknown string. |
| `app/api/plugins/execute` | POST hardened. GET catalogue left public (metadata only, SA Q1) but given Zod + Pino. |
| `app/api/plugins/disconnect` | POST **and** GET hardened; cache invalidation keyed on the resolved id. |
| `app/api/plugins/user-status` | Fallback removed; `Cache-Control` changed from `public, max-age=30` to `private, no-store` + `Vary: Cookie`. |
| `app/api/plugins/additional-config` | POST, PUT **and** GET hardened. POST/PUT were near-identical copies — folded into one `writeAdditionalConfig` helper so identity, validation and audit cannot drift between verbs. PUT previously wrote config with **no audit entry at all**; both verbs are now audited. |
| `app/api/plugins/refresh-token` | Query-param fallback removed. |
| `app/api/plugins/test-audit` | Gated (SA C14). Its header comment recorded "no verified operator identity … rides the future F3 remediation cycle" — this *is* that cycle, so the note is replaced and the entry now carries `actorId`. |
| `app/api/plugin-connections/route.ts` | All three handlers hardened; credential branch deleted. |
| `app/api/plugin-connections/save/route.ts` | **Deleted** (user decision). |
| `lib/cachedAuth.ts` | **Deleted** (C11, option b — SA concurred). All three exports were dead once `user-status` moved to the resolver. |
| `lib/client/plugin-api-client.ts` | Browser calls now use relative URLs (C16) — an absolute `NEXT_PUBLIC_APP_URL` that differs from the browsing origin drops cookies under `credentials:'same-origin'`, which would have turned into blanket 401s. |
| `components/UserProvider.tsx` | Retries plugin-status once after 750 ms on failure (C10) — the documented post-login cookie race used to be absorbed by the fallback. |
| `app/test-plugins-v2/page.tsx` | Session-aware (C13): seeds the User ID box from the logged-in user, and shows a banner for not-signed-in / acting-as-yourself / acting-as-another-user (admin-only, audited). |

### Decisions worth flagging at code review

- **`user-status` self-target still sends `?userId=`.** `UserProvider`/`Footer`/connections pages pass their own id, which is a self-target and always allowed (D3), so no client rewrite was needed. Kept deliberately: fewer moving parts in a security change.
- **Audit semantics.** `userId` = the account acted upon, `actorId` = the admin who did it, per `AuditTrailService`'s schema — the opposite of what D5 originally said.
- **PUT now audits.** A behaviour addition, not a preservation. Flagged rather than silent.

### Verification

- `npx jest app/api/plugins lib/server/__tests__/route-identity.test.ts app/api/plugin-connections` → **5 suites / 43 tests pass**, including the core lock on every handler: an unauthenticated request carrying a victim's `userId` is refused **and the side-effect never runs**.
- `npx tsc --noEmit` → no errors in any touched file. (Two errors remain in `app/api/plugin-connections/disconnect/route.ts` and the generated `.next/types` entry for `user-status` — both verified pre-existing at HEAD and untouched here.)
- `grep -c "console\." ` across all six route files → **0**.
- Remaining `getCachedUser` reference in the repo is the explanatory comment in the resolver.

---

### SA code review (post-implementation, 2026-08-19)

**Reviewed by SA — 2026-08-19**
**Verdict:** 🔄 **Fix Required** — 3 small required changes (R1, R3, R3b) plus 2 doc items (R2, R4). The security core is correct: I re-derived every claim from source rather than from the implementation notes, and the resolver, the eight hardened handlers, the deletions and the cache/audit semantics all hold up. Nothing required is a redesign — two are one-liners and one is a missing test.

**Scope of my verification:** read `lib/server/route-identity.ts` and all eight handlers end to end; re-ran `npx jest lib/server/__tests__/route-identity.test.ts app/api/plugins app/api/plugin-connections` (**5 suites / 43 tests green**); ran `npx tsc --noEmit`; independently swept `app/api/plugins`, `app/api/plugin-connections`, `app/api/oauth` and `app/oauth` for remaining caller-supplied identity; traced every live caller listed in §1 Blast radius.

#### 1. The resolver — approved

| Path | Behaviour | Verdict |
|---|---|---|
| `getUser()` throws | caught → 401, logged with `{ err }` | ✅ fail-closed (C7) |
| `getUser()` → null | 401 | ✅ |
| no `requestedUserId` / `''` | self, `actingAs:false`, admin check **not** consulted | ✅ D3 |
| `requestedUserId === session.id` | self, no admin check | ✅ D3 |
| foreign, malformed | 400 **before** the admin lookup | ✅ C7 — nothing unvalidated reaches cache keys, executor or audit |
| foreign, non-admin | 403 + `logger.warn` | ✅ D2/D6 |
| foreign, `isAdmin` **throws** | 403, not 500 | ✅ correct addition beyond C7 — never depend on `AdminAccessService`'s internal fail-closed, and this doesn't |
| foreign, admin | ok + audit written **inside** the resolver | ✅ C15 — no call site can skip it |
| audit write rejects | `.catch` → resolution still `ok` | ✅ C6/D5 — audit can neither block nor deny |

The discriminated union is sound: the `ok:false` arm carries no `userId`, so a handler that forgot the `if (!identity.ok)` guard could not compile a read of `identity.userId` under strict TS. `isAdmin({ id, email })` — not `isAdminById` — confirmed (C5), so the email self-heal and `ADMIN_EMAILS` bootstrap paths stay reachable. Audit identity is `userId = target`, `actorId = admin` per `AuditLogInput` (`lib/audit/types.ts:88-97`) — the corrected D5 — and `AuditTrailService.log` is `async`, so the `.catch` also covers a synchronous throw. `PLUGIN_ACT_AS` is registered in **both** `AUDIT_EVENTS` and `EVENT_METADATA` (`critical` + `SOC2`), so it is not degraded by the unknown-event `info` fallback (C6). C11.3 instrumentation is present and sits in a `finally`, so it also logs on the throwing path.

#### 2. C1–C16 and C11.1–C11.4 — verified individually

| # | Applied? | Evidence |
|---|---|---|
| C1 | 🔄 **Code yes, doc NO** | The resolver's comment is accurate. But §1 (`:46-48`) still says `user-status` **and `refresh-token`** both fell back "after calling helpers that resolve the session from a single, unchunked cookie name" — the exact sentence C1 required rewriting (`refresh-token` used the chunk-aware `createAuthenticatedServerClient`). §2's out-of-scope row (`:78`) also still calls `getCachedUser` "a shared helper other code depends on", which C11 established was false and which this PR settled by deleting the file. See **R2**. |
| C2 | ✅ | Zod on all 8 handlers plus `execute` GET, `refresh-token` and `test-audit`; `safeParse` → 400 with `details` gated on `NODE_ENV`. Deviation noted at L4. |
| C3 | ✅ | `user-status` HIT **and** MISS both send `private, no-store` + `Vary: Cookie`; `disconnect` GET, `additional-config` GET and `plugin-connections` GET got the same treatment. |
| C4 | ✅ | `disconnect` GET, `additional-config` GET **and** PUT all resolve identity. |
| C5 | ✅ | `isAdmin({ id, email })`; locked by test R5b. |
| C6 | ✅ | Registered event, `critical`/`SOC2`, `userId`/`actorId` correct, `request` passed, non-blocking. |
| C7 | ✅ | try/catch on `getUser`, UUID-before-lookup, full session identity returned (`sessionUserId` + `sessionUserEmail`). |
| C8 | ✅ routes / 🔄 two touched client files | `console.*` count is **0** across all six route files and the resolver. But `components/UserProvider.tsx` still has **8** and this diff **adds one of them**; `app/test-plugins-v2/page.tsx` has 2. See **R1** and L7. |
| C9 | ✅ | `app/api/plugin-connections/save/route.ts` deleted. |
| C10 | 🔄 **Present but ineffective** | Retry + degrade-to-`{}` implemented, but the retry is swallowed by `requestDeduplicator`. See **R3**. |
| C11 / C11.1 | ✅ | `lib/cachedAuth.ts` deleted; repo-wide grep finds no `getCachedUser` / `invalidateAuthCache` / `clearAuthCache` outside docs. |
| C11.2 | ✅ | `PERFORMANCE_OPTIMIZATION_PLAN.md` §4A row **and** the open checklist both marked superseded/cancelled with the reason and a pointer to the resolver. This is the part such cleanups usually skip. |
| C11.3 | ✅ | `logger.debug({ route, durationMs })`. |
| C11.4 | ✅ | Roadmap cross-cutting entry added, correctly scoped ("inside the resolver, chunk-aware, explicit staleness/revocation decision"). |
| C12 | 🟡 **9 of 11** | R7/R8/R9/E6/U2/U4/A2/A3/D3t all present. **T1 (`refresh-token` unauthenticated) is missing entirely — that route has zero tests.** U3 (cache isolation across an act-as then a self call) is missing; the code is right by inspection, but the lock isn't there. See **R3b**. |
| C13 | ✅ | `/test-plugins-v2` seeds the box from `useAuth()` (root layout provides `UserProvider` — confirmed), respects operator typing via `userIdTouched`, and shows all three banner states including "requires platform admin, is audited". |
| C14 | ✅ | `test-audit` gated through the resolver; the stale "no verified operator identity … rides the future F3 cycle" comment replaced with an accurate one; the entry now carries `actorId`. |
| C15 | ✅ | Generic name and home, options object, audit inside the resolver. |
| C16 | ✅ | `baseUrl = typeof window !== 'undefined' ? '' : (NEXT_PUBLIC_APP_URL || '')`; the singleton is constructed lazily, so the browser instance always gets the relative form. |

#### 3. Independent sweep for missed handlers — one real remaining hole (out of scope, must be tracked)

Everything under `app/api/plugins/*` and `app/api/plugin-connections/*` now derives identity server-side: the only remaining reads of `searchParams.get('userId'|'user_id')` / `body.userId` feed `requestedUserId` into the resolver. `plugin-connections/disconnect` uses `supabase.auth.getUser()`; `plugins/fetch-options`, `schema-metadata` and the deprecated `/api/user/plugins` are session-authenticated; `plugins/available`, `action-schema` and `execute` GET are metadata-only (SA Q1 stands).

**But the same threat class survives one directory over, on the same table:**

`app/oauth/callback/[plugin]/route.ts` → `UserPluginConnections.handleOAuthCallback` (`lib/server/user-plugin-connections.ts:225-226`) does `JSON.parse(decodeURIComponent(state))`, takes `user_id` from it, and upserts the exchanged **OAuth tokens** into `plugin_connections` for that id. The `state` is built client-side and is **unsigned** (`:670-677` — `{ user_id, plugin_key, timestamp, random }`; no HMAC, no session binding), and the route performs **no** session check. An attacker who completes their own OAuth authorization with a crafted `state` writes tokens into another account's connection row. That is credential injection — the same class as the `save` route this PR deleted, and it is live. `app/api/oauth/token/route.ts` (v1 strategy path) derives `userId` from `state` the same way.

This is legitimately outside the agreed scope and I am **not** asking for it here. But the roadmap entry this PR rewrites now reads as though the cluster is closed, so it must not go unrecorded — see **R4**.

#### 4. Deleted credential-returning GET branch — deletion confirmed correct

Zero callers. The only live consumers of `/api/plugin-connections` are `components/business-os/ConfigurationDialog.tsx:217` (bare `GET`, reads `data.plugins`) and `:257` (`DELETE ?plugin_key=stripe`, no `user_id`), plus `components/agent-creation/SmartAgentBuilder/components/PluginRequirements.tsx:56` (bare `GET`, reads `data.plugins`). Neither ever sent `plugin_key` + `user_id` to `GET`. `decryptCredentials` now has **no production consumer at all** (only a test mock). Deleting rather than gating is right: an authenticated "hand me my plaintext password back" endpoint is a primitive with no caller and permanent blast radius. The regression lock in `plugin-connections/__tests__/route.test.ts` — "GET never returns decrypted credentials, even with plugin_key + user_id", asserting `decryptCredentials` was never called — is exactly the right shape.

#### 5. Behaviour preservation for live callers — holds

Each checked for a foreign id or a dependency on a removed fallback:

| Caller | Sends | Verdict |
|---|---|---|
| `UserProvider:48/52` | own `user.id` | self ✅ (but see R3) |
| `Footer:190/245/408`, `/settings/connections:59/177`, `PluginCard:74/177/209`, `AdditionalConfigModal:102`, `PluginRefreshModal:71`, `CalendarSyncSettings:162/215` | own `user.id` | self ✅ |
| `ConfigurationDialog:217/257`, `PluginRequirements:56` | no id at all | session ✅ |
| `/test-business-os:225`, `BosModuleTester` | session `user.id` | self ✅ |
| `/test-plugins-v2`, `FormTester:206/233` | the User ID box | now session-seeded + bannered ✅ (admin-gated if changed — intended) |
| `PluginAPIClient` (`executeAction` / `disconnectPlugin` / `getUserPluginStatus` / `getPluginConnectionStatus`) | whatever its caller passed | every caller passes its own id ✅ |

Response shapes preserved where callers parse them (`{plugins,count}`, `success`/`data`/`error`, 404 on unknown plugin/action, 207 on partial refresh). Error bodies moved from `{error}` to `{success:false,error}`; every caller branches on `response.ok` or `result.success`, so no regression.

#### 6. Findings

| # | File | Finding | Severity |
|---|---|---|---|
| **R1** | `components/UserProvider.tsx` | Touched file left non-compliant with CLAUDE.md § Logging — **8 `console.*`**, one of which (`:50` `console.warn`) is **added by this diff**. `clientLogger` (`@/lib/logger/client`) is the established client-side path and is already used by `plugin-api-client.ts`. Mandatory rule 3 required flagging and converting, not leaving it. | **High (standards)** |
| **R2** | workplan §1 `:46-48`, §2 `:78` | C1 not applied to the doc. §1 still attributes `refresh-token`'s fallback to a chunk-unaware helper (it used the chunk-aware `createAuthenticatedServerClient`); §2 still justifies deferring the `getCachedUser` fix as "a shared helper other code depends on" — a file this PR deleted. The Implementation notes assert "C1–C16 applied"; C1 is the one that isn't. Left as-is it sends the next reader to "fix" a helper that was never broken. | **Medium** |
| **R3** | `components/UserProvider.tsx:47-53` | The C10 cookie-race retry is **defeated by the deduplicator**. `getUserPluginStatus` wraps its fetch in `requestDeduplicator.deduplicate('plugin-status-<id>', …, TTL=1000)`, which caches the **promise** — including a rejected one — and only evicts at *settle + 1000 ms*. The retry fires at 750 ms, so whenever the first call fails in under ~250 ms it hits `now < expiresAt`, gets the same rejected promise back and rethrows immediately: no second HTTP request is ever made. Fix is one line — clear the dedup key (`requestDeduplicator.clear('plugin-status-' + currentUser.id)`) before retrying. Do **not** just raise the delay (trades a known race for a timing guess) and do not change the shared deduplicator's rejection semantics in this PR. | **Medium** |
| **R3b** | `app/api/plugins/refresh-token/route.ts` | **Zero tests.** C12's T1 ("unauthenticated with `?userId=` → 401, no token refresh attempted") was explicitly required and is absent — on the one hardened route whose side effect is an *external* OAuth token exchange. Add it alongside the others in `app/api/plugins/__tests__/identity-hardening.test.ts`. | **Medium** |
| **R4** | roadmap cross-cutting list | Record the §3 OAuth-callback finding: *unsigned OAuth `state` carries `user_id`; `app/oauth/callback/[plugin]` and `app/api/oauth/token` write plugin connections/tokens for a caller-named account with no session check — same class as the deleted `save` route.* Fix shape: bind `state` to the session (verify `state.user_id === getUser().id` in the callback) and/or sign it. Not for this PR, but it must not be lost now that the roadmap entry reads as if the cluster is closed. | **Medium (tracked, not fixed here)** |
| L1 | `app/api/plugin-connections/__tests__/route.test.ts:22` | New TS error introduced by this PR: `TS2556: A spread argument must either have a tuple type or be passed to a rest parameter` (the `encryptCredentials` mock is typed `() => string`). The two errors the Implementation notes attribute to HEAD are indeed pre-existing; this third one is not. Type the mock as `jest.fn((..._a: unknown[]) => 'encrypted-blob')`. | Low |
| L2 | `lib/encryptCredentials.ts` | `decryptCredentials` is now dead (no production consumer). Either delete it in the same PR that deleted its only branch, or add a one-line comment saying why it stays. | Low |
| L3 | `app/api/plugins/additional-config/route.ts:135` | The audit entry stores `config_data: additionalData` — raw values — **and PUT now writes this entry where it previously wrote none**, so the PR widens that surface. Today every `additional_config` field is `type: "text"` (only `whatsapp-business`), so nothing sensitive lands there yet; the day someone adds a password/token field it is persisted in plaintext in `audit_trail`. `additional_config_fields` (keys) is already logged and is the safer half. Recommend dropping `config_data` or redacting by field type. | Low |
| L4 | all handlers | C2 asked for `z.string().uuid()` on the id fields; the implementation uses `z.string().optional()` and does the UUID check inside the resolver. Net behaviour is equivalent (self-target compares before validating; a foreign non-UUID 400s) and centralising it is arguably better — but it is an undocumented deviation from an SA required change. Note it in the workplan; no code change needed. | Low |
| L5 | `user-status/route.ts` catch, `refresh-token/route.ts` catch | 500 bodies return `message: error.message` **outside** the `NODE_ENV === 'development'` guard, leaking internal error text in production (CLAUDE.md § Security Rules). Pre-existing, but both files were rewritten here so it was cheap to fix and wasn't. | Low |
| L6 | `app/api/plugins/__tests__/identity-hardening.test.ts` | Mocking the resolver in route tests is the right call, but no test asserts the handler **forwarded** the caller-supplied id (`expect(resolveActingUserIdentity).toHaveBeenCalledWith(expect.objectContaining({ requestedUserId: VICTIM_ID }))`). A handler that silently dropped `requestedUserId` would pass every test today. It fails *safe* (act-as degrades to self), so this is a coverage note, not a hole. Same for a positive `plugin-connections` POST/DELETE test proving the write uses the resolved id. | Low |
| L7 | `app/test-plugins-v2/page.tsx` | 2 `console.*` remain in a touched file (`:1113`, `:1115`). Unlike `UserProvider` this is a ~3,000-line page and the diff didn't add them, so converting the whole file is disproportionate here. **Flag to the user** per CLAUDE.md § Logging and let them decide; a follow-up is fine. | Low |

#### 7. What is explicitly right (do not undo in the fix pass)

- The audit write lives **inside** the resolver rather than at five call sites — the difference between a rule and a convention.
- `writeAdditionalConfig` collapsing the POST/PUT near-duplicates: identity, validation and audit now physically cannot drift between the two verbs. Better than gating both copies, and not a new pattern — a private helper inside one route file.
- PUT gaining an audit entry it never had: correct, and correctly surfaced as an addition rather than slipped in.
- Deleting the credential-returning GET branch instead of gating it.
- Both deletions (`save/route.ts`, `lib/cachedAuth.ts`) shipped with the doc corrections that stop the deleted thing being rebuilt (C11.2).
- Finding and closing `app/api/plugin-connections/route.ts`, which both the workplan and my own review missed. Widening scope and saying so was the right call.

#### 8. Required changes

1. **R1** — convert `components/UserProvider.tsx` to `clientLogger` (8 calls), or record the user's explicit decline in this workplan.
2. **R3** — clear the deduplicator key before the C10 retry so the retry actually issues a request.
3. **R3b** — add the missing `refresh-token` unauthenticated test (C12 T1).
4. **R2 / R4** — documentation only: correct workplan §1/§2 per C1, and add the OAuth-`state` finding to the roadmap cross-cutting list.

L1–L7 are optional in this PR; L1 (tsc) and L5 (prod error leak) are the two worth taking if any.

#### 9. Approval

**Code Approved for QA: No** — pending R1, R3, R3b (R2/R4 are documentation and can land in the same commit).

All four are small and self-contained. Once they are in, **no further SA re-review is needed**: TL can verify R1 with a `console.` count of 0 in `components/UserProvider.tsx`, R3 by reading the three changed lines, R3b by the suite going 43 → 44+ tests, and R2/R4 by reading the two doc paragraphs. Proceed to QA on that basis — the identity boundary itself is approved as written.

---

### Post-code-review fixes (Dev, 2026-08-19)

SA verdict was **Fix Required** (R1, R3, R3b + doc items R2/R4). All are addressed; the optional lows worth taking were taken.

| SA item | Action |
|---|---|
| **R1** — `components/UserProvider.tsx` had 8 `console.*` and this diff **added** a 9th | **FIXED.** Whole file converted to `clientLogger` (structured, `{ err }` for errors). Count is now **0**. |
| **R3** — the C10 retry was a no-op in the common case: `getUserPluginStatus` runs inside `requestDeduplicator` (TTL 1000 ms), which caches the **rejected** promise, so a retry at 750 ms replayed the same rejection | **FIXED.** The dedup key is cleared before the retry, so a real second request is issued. Sharp catch — the retry would have looked right and done nothing. |
| **R3b** — `refresh-token` had zero tests (C12 T1), on the one route whose side effect is an external OAuth token exchange | **FIXED.** Two tests added: unauthenticated → 401 with no token refresh attempted; non-admin act-as → 403. |
| **R2** — C1 was never applied to §1/§2 | **FIXED.** §1 now separates the two cases correctly (`user-status` = genuine chunked-cookie miss; `refresh-token` = plain legacy cruft, its cookie adapter *is* chunk-aware) and restates D4's real argument as consistency: 137 route files use `getUser()`, `getCachedUser` had one consumer. §2's "shared helper" claim corrected. |
| **R4** — record the OAuth-callback finding | **FIXED.** Added to the roadmap cross-cutting list as 🔴, with the fix shape (bind `state` to the session and/or sign it) and an explicit note that `/oauth/*` is **not** covered by this PR. |
| **L1** — new TS error in the new `plugin-connections` test | **FIXED** (typed the `encryptCredentials` mock). Verified: `tsc` now reports only the two errors that pre-exist at HEAD. |
| **L2** — `decryptCredentials` now has no production consumer | **FIXED** by documenting: kept (stored credentials need a decrypt path for a future *server-side* consumer) with an explicit "must never again be wired to an HTTP response body". |
| **L3** — the audit entry stored raw `config_data`, and PUT newly writes that entry | **FIXED.** Field **keys** only. Values are no longer persisted to `audit_trail`; today every field is free text, but a future token/password field would have been stored in plaintext — and this PR would have been what widened it. |
| **L5** — two rewritten catches returned `error.message` outside the dev guard | **FIXED** in `user-status` and `refresh-token`. |
| **L6** — no test asserted the handler *forwarded* the caller-supplied id | **FIXED.** A handler that silently dropped `requestedUserId` would have passed everything else (it fails safe). |
| **L4** — `z.string().optional()` + UUID check in the resolver instead of `z.string().uuid()` per handler | **Documented, no code change** (SA's own guidance). Centralising the check is deliberate: self-target compares before validating, so a non-UUID id that equals your own session id is impossible, and every handler inherits one consistent 400. |
| **L7** — 2 `console.*` remain in the ~3,000-line `test-plugins-v2` page | **Not converted** — the diff did not add them and whole-file conversion is disproportionate. **Flagged to the user** per CLAUDE.md § Logging. |

**Re-verification:** `npx jest app/api/plugins app/api/plugin-connections lib/server/__tests__/route-identity.test.ts` → **5 suites / 46 tests pass** (43 → 46). `npx tsc --noEmit` → only the two pre-existing HEAD errors. `console.*` = **0** across all six route files, the resolver and `UserProvider`.

---

## QA Report (2026-08-19)

**Tested by QA — 2026-08-19**
**Verdict:** ✅ **PASS-WITH-NOTES** — the security invariant holds on all twelve hardened handlers, independently re-derived from source rather than from the tests. No must-fix issue. Six non-blocking notes (four of them pre-existing and out of scope), plus two test-harness gaps QA closed in-session.
**Test mode:** full · **Strategy:** A + B (Jest unit + route-integration) with source inspection of every handler; no E2E (this is an API-identity change with no new UI flow beyond a banner). **Input source:** prompt keywords + workplan §6/§8.

---

### 1. Test results (actual output)

**Targeted suite** — `npx jest app/api/plugins app/api/plugin-connections lib/server/__tests__/route-identity.test.ts lib/utils/__tests__/request-deduplication.test.ts`

```
PASS lib/server/__tests__/route-identity.test.ts
PASS lib/utils/__tests__/request-deduplication.test.ts
PASS app/api/plugin-connections/__tests__/route.test.ts
PASS app/api/plugins/action-schema/__tests__/route.test.ts
PASS app/api/plugins/test-audit/__tests__/route.test.ts
PASS app/api/plugins/__tests__/identity-hardening.test.ts
Test Suites: 6 passed, 6 total
Tests:       52 passed, 52 total
```

Dev handed over 46 tests / 5 suites. QA added 6 tests and one suite (§5) → **52 tests / 6 suites**, all green.

**Wider suite (collateral-damage sweep)** — `npx jest` across all 176 test files:

```
Test Suites: 20 failed, 8 skipped, 148 passed, 168 of 176 total
Tests:       128 failed, 30 skipped, 2151 passed, 2309 total
Time:        96.578 s
```

The 20 failures are **proven pre-existing, not inherited from this PR**. Method: stashed all of `app/`, `lib/`, `components/` — the PR's entire source surface, including both deletions — re-ran the same areas at HEAD, then restored:

```
# at HEAD, with every source change stashed
Test Suites: 20 failed, 107 passed, 127 total
Tests:       128 failed, 1299 passed, 1427 total
```

Identical 20 suites, identical 128 failing tests, all in V6 pipeline / Pilot / orchestration / feature-flags (`DeclarativeCompiler-*`, `ConditionalEvaluator*`, `StructuredTransforms*`, `LogicalIRCompiler`, `IntentClassifier`, `TokenBudgetManager`, `featureFlags`, `v4-generator`, `v6-*`). None import any file this PR touches, and the only deleted library module (`lib/cachedAuth.ts`) has **zero** remaining references repo-wide. Working tree verified fully restored after the stash/pop.

**Explicit auth / plugins / UserProvider collateral check:** `app/api/admin/agents`, `lib/calibration/adminCalibrationIdentity`, `components/test-plugins/tester/*`, `hooks/useSideConsole` and `lib/effort-estimator` (the only other `AuditTrailService` consumer) all pass. The `lib/audit/events.ts` change is purely additive — one `AUDIT_EVENTS` key plus one `EVENT_METADATA` entry — so no existing event's severity or compliance flags shifted.

---

### 2. Typecheck

`npx tsc --noEmit` → **1,976 errors repo-wide**. Errors in or adjacent to touched files: **exactly 3**, and both claimed-pre-existing sources are **confirmed**:

| Error | Claim | QA verification |
|---|---|---|
| `app/api/plugin-connections/disconnect/route.ts(45,18)` and `(50,20)` — `Property 'disconnect' does not exist on type 'PluginDefinition'` | pre-existing | ✅ `git diff --stat` on that path is **empty** — the file is not touched by this PR at all. Deprecated V1-registry route, already session-authenticated via `supabase.auth.getUser()`. |
| `.next/types/app/api/plugins/user-status/route.ts(8,13)` — `OmitWithTag … does not satisfy '{ [x: string]: never; }'` | pre-existing | ✅ Caused by the non-standard `export const pluginStatusCache`, which exists at HEAD (`git show HEAD:…/user-status/route.ts` line 57). Generated, gitignored file. |

**No new errors** in `route-identity.ts`, any of the six route files, `UserProvider.tsx`, `plugin-api-client.ts`, `encryptCredentials.ts`, `audit/events.ts`, `test-plugins-v2/page.tsx`, or any test file — L1's `encryptCredentials` mock fix verified. QA's own test edits also land at 1,976 (one transient error QA introduced was caught and fixed before hand-off).

---

### 3. Security invariant, verified per handler (independent of the tests)

Invariant: *an unauthenticated request carrying a victim's userId is refused **and** the side effect never runs*. Every handler was read end to end to confirm (a) no path reaches the side effect before `resolveActingUserIdentity`, and (b) no earlier return leaks user data.

| # | Handler | Identity input | Resolver precedes every side effect? | Only earlier returns | Side effect uses resolved id | Verdict |
|---|---|---|---|---|---|---|
| 1 | `POST /api/plugins/execute` | `body.userId` | ✅ `:66`, before `PluginManagerV2.getInstance()` `:86` | Zod 400 (`details` dev-gated) | `pluginExecuter.execute(userId,…)` `:110` | ✅ |
| 2 | `POST /api/plugins/disconnect` | `body.userId` | ✅ `:60` | Zod 400 | `disconnectPlugin(userId,…)` `:80` **and** cache key `:85` | ✅ |
| 3 | `GET /api/plugins/disconnect` | `?userId=` | ✅ `:134` | Zod 400 | `getConnectionStatus(userId,…)` `:154` | ✅ |
| 4 | `GET /api/plugins/user-status` | `?userId=` | ✅ `:87`, **before the cache read** `:102` | Zod 400 | cache key + all three `pluginManager` reads | ✅ |
| 5 | `POST /api/plugins/additional-config` | `body.userId` | ✅ `:67` (shared `writeAdditionalConfig`) | Zod 400 | `updateAdditionalConfig(userId,…)` `:116` | ✅ |
| 6 | `PUT /api/plugins/additional-config` | `body.userId` | ✅ same helper — cannot drift from POST | Zod 400 | same | ✅ |
| 7 | `GET /api/plugins/additional-config` | `?userId=` | ✅ `:195` | Zod 400 | `getAdditionalConfig(userId,…)` `:211` | ✅ |
| 8 | `POST /api/plugins/refresh-token` | `body.userId` | ✅ `:50`, before `PluginManagerV2.getInstance()` `:67` | Zod 400 | `getAllActivePlugins(userId)` / `refreshToken` — the **external OAuth exchange** is never reached | ✅ |
| 9 | `POST /api/plugins/test-audit` | `body.targetUserId` | ✅ `:75` | Zod 400 / invalid-JSON 400 | audit row carries resolved `userId` + `actorId` | ✅ |
| 10 | `POST /api/plugin-connections` | `body.user_id` | ✅ `:77`, before `createServerSupabaseClient()` `:95` | Zod 400 | `insert({ user_id: userId })` — **service role**, scoped by resolved id only | ✅ |
| 11 | `DELETE /api/plugin-connections` | `?user_id=` | ✅ `:154` | Zod 400 | `.delete().eq('plugin_key').eq('user_id', userId)` | ✅ |
| 12 | `GET /api/plugin-connections` | `?user_id=` | ✅ `:213` | Zod 400 | `.select(...).eq('user_id', userId)`; credential branch **deleted** | ✅ |

**The resolver itself** (`lib/server/route-identity.ts`), re-derived rather than assumed:

- `getUser()` builds `createServerClient` over `cookieStore.getAll()` and calls `supabase.auth.getUser()` — a server-verified JWT, chunk-aware, and **not influenceable by request body or headers**. It also returns `null` rather than throwing on a Supabase error (`lib/auth.ts:34`), so both the null path and the throw path land on 401.
- Order is fail-closed and correct: `getUser` throws → 401 · null → 401 · absent/self → pass with **no** admin lookup · foreign + malformed → **400 before the lookup** · foreign + non-admin → 403 · `isAdmin` throws → 403 · foreign + admin → ok, audit written inside the resolver.
- `adminAccessService.isAdmin({ id, email })` confirmed against source (`AdminAccessService.ts:98-134`): `admin_users` table only, email self-heal and `ADMIN_EMAILS` bootstrap both reachable, `catch → return false` (`:129-133`). Never `profiles.role`. ✅ CLAUDE.md security rule.
- The discriminated union's `ok:false` arm carries no `userId`, so under strict TS a handler cannot read the id without the guard — the boundary is compiler-enforced, not conventional.

**Deleted credential branch — independently confirmed gone.** `git show HEAD:app/api/plugin-connections/route.ts` lines 151-166 is the unauthenticated `select('credentials') → decryptCredentials(...) → { credentials: decrypted }` service-role branch. Repo-wide sweep: `decryptCredentials` now has **zero** production consumers (only its own definition, the doc comment and a test mock). No route anywhere under `app/api` selects or returns the `credentials` column — the only other reader, `app/api/user/data-export/route.ts:122`, explicitly selects around it. ✅

---

### 4. Self-targeting regression check (workplan §1 blast radius)

Every live caller traced to source. All pass their **own** `user.id` or no id at all, so all are self-targets (D3) and unaffected:

| Caller | Sends | Verdict |
|---|---|---|
| `components/UserProvider.tsx:48/52` | own `user.id` | ✅ |
| `components/v2/Footer.tsx:190/245` (status), `:408` (disconnect), `:465` (refresh) | own `user.id` / no id | ✅ |
| `app/(protected)/settings/connections/page.tsx:59/177` | own `user.id` | ✅ |
| `components/settings/PluginCard.tsx:74` (config GET), `:177/:209` (disconnect), `:447` (`userId={user.id}` → modal) | own `user.id` | ✅ |
| `components/settings/AdditionalConfigModal.tsx:98` (POST **and** PUT) | `userId` prop = `user.id` | ✅ |
| `components/scheduling/CalendarSyncSettings.tsx:215`, `components/v2/PluginRefreshModal.tsx` | no id → session | ✅ |
| `components/business-os/ConfigurationDialog.tsx:217/257`, `SmartAgentBuilder/.../PluginRequirements.tsx:56` | no id → session | ✅ `{plugins,count}` shape preserved |
| `app/test-business-os/page.tsx:225`, `BosModuleTester` | session `user.id` | ✅ |
| `app/test-plugins-v2` + `FormTester:206/233` | User ID box, now session-seeded | ✅ admin gate on a foreign id is intended |

No server-to-server, cron or script caller exists — server-side plugin execution imports `PluginExecuterV2` directly, never over HTTP. Re-confirmed. The six `userId: "test_user_123"` literals still in `test-plugins-v2/page.tsx` belong to `AI_SERVICE_TEMPLATES` for **agent-creation** endpoints, not the plugin routes, so SA C7's "clean 400" note does not apply to any hardened handler.

---

### 5. Edge cases

| # | Case | Result | Evidence |
|---|---|---|---|
| E-1 | `userId` === session id | Passes, `actingAs:false`, admin check **never consulted** | R3 |
| E-2 | No `userId` at all | Session user, no admin check | R2 |
| E-3 | `userId: ""` (empty string) | Falsy → treated as self, never as a foreign target | inspected `:97` — safe |
| E-4 | Malformed / non-UUID `userId` | 400 **before** the admin lookup, so nothing unvalidated reaches cache keys, executor or audit rows | R8 |
| E-5 | Admin act-as | Resolved id used downstream; audit written inside the resolver | R5, E4, D2, plus the new refresh-token positive test |
| E-6 | Admin act-as, audit write rejects | Still `ok` — audit can neither block nor deny | R9 |
| E-7 | `isAdmin` throws / `getUser` throws | 403 / 401, never a 500 | R6, R7 |
| E-8 | **Post-login cookie-race retry — does clearing the dedup key actually cause a second request?** | ✅ **Proven in both directions.** New `lib/utils/__tests__/request-deduplication.test.ts`: without `clear()` the retry replays the cached rejection and the fetcher runs **once**; with `clear()` it runs **twice**. SA's R3 diagnosis was right and the one-line fix is correct. Key strings match exactly (`plugin-status-${userId}` in both `UserProvider` and `plugin-api-client:49`), and a 401 body (`success:false`) does throw, so the catch is reachable. | new suite, 3 tests |
| E-9 | **Act-as then self — cache isolation (SA's missing U3)** | ✅ Right by inspection **and now locked by test**: an admin act-as populates `plugin-status-<victim>`; the same admin's own call returns `X-Cache: MISS` with their own `user_id` and data | new U3 test |
| E-10 | Concurrent `user-status` calls | Each resolves identity independently; neither is served the other's payload | new concurrency test |
| E-11 | `GET ?plugin_key=…&user_id=…` — the exact old exploit shape, authenticated | Falls through to the list branch; `decryptCredentials` never called, no `credentials` key in the body | existing lock, re-read |

**QA-added tests (6):** U3 cache isolation · concurrent `user-status` · 3 × deduplicator retry contract · `refresh-token` admin act-as positive (asserts `getAllActivePlugins(VICTIM_ID)`).

**QA-fixed test-harness gaps (2) — both meant a lock was weaker than it looked:**
1. The `PluginManagerV2` mock was missing `getDisconnectedPlugins`, so **no `user-status` test had ever reached the 200 path** — every existing U-case short-circuited at 401/403.
2. `expect(refreshPluginToken).not.toHaveBeenCalled()` in T1 was **vacuous**: `refreshPluginToken` exists neither on `PluginManagerV2` nor anywhere in the route, which reaches the external OAuth exchange via `pluginManager['userConnections'].refreshToken`. Both assertions now target real methods (`getAllActivePlugins`, `refreshToken`), so T1's "no token refresh attempted" is a genuine lock rather than a tautology. (The 401 status assertion was still catching a regression, so this was a coverage weakness, not an escaped bug.)

---

### 6. CLAUDE.md standards

| Rule | Status |
|---|---|
| Zod on every handler before business logic | ✅ All 12 hardened handlers plus `execute` GET; `safeParse` → 400 with `details` gated on `NODE_ENV === 'development'` |
| Pino / `clientLogger`, zero `console.*` | ✅ **0** in all six route files, the resolver, `UserProvider.tsx` (was 8, one added by this diff) and `plugin-api-client.ts`. 2 remain in `app/test-plugins-v2/page.tsx:1113,1115` — see N-5 |
| `correlationId` child logger on API routes | ✅ every handler |
| TS strict, no new implicit `any` | ✅ no new tsc errors |
| No internal error text leaked in production | ✅ every 500 body in the touched routes dev-gates `error.message`; `user-status:212` is inside the **logger** object, not the response (L5 fix verified). Two untouched neighbours still leak — N-3 |
| Service-role RLS bypass documented | ✅ `plugin-connections/route.ts:9-11` states it, and that tenant scoping is this route's responsibility |
| `.eq('user_id', <resolved id>)` on every service-role query | ✅ all three `plugin-connections` handlers |

**Audit semantics (validation item 8) — all four confirmed:**
- `userId` = target, `actorId` = admin (`route-identity.ts:139-140`), matching `AuditTrailService.buildLogEntry:107` where `actor_id` is documented as "who actually did it".
- `PLUGIN_ACT_AS` registered in **both** `AUDIT_EVENTS` and `EVENT_METADATA` with `severity: 'critical'` and `complianceFlags: ['SOC2']`, so it escapes the unknown-event `info` fallback.
- `request` is passed, so IP / user-agent / session context is captured.
- Non-blocking `.catch`; `AuditTrailService.log` is `async`, so the `.catch` also covers a synchronous throw.
- Per-handler entries use `actorId: identity.actingAs ? identity.sessionUserId : undefined`, which correctly lets `actor_id` default to `userId` on a self-target.
- Bonus: `plugin-connections` POST/DELETE moved from a **blocking** `await auditLog` to the non-blocking pattern.

---

### 7. Issues

#### Must fix before commit

**None.** No High or Medium severity defect found. The identity boundary, the deletions, the cache keying and the audit semantics all hold.

#### Non-blocking

| # | Finding | Severity |
|---|---|---|
| N-1 | **Act-as `userId` is UUID-validated case-*insensitively* but compared to the session id case-*sensitively*.** An uppercase-cased UUID passes `UUID_RE`, so an admin act-as with `AAAA…` and `aaaa…` yields two different `plugin-status-<id>` cache entries and two differently-cased audit rows. Never a leak (Postgres `uuid` comparison is case-insensitive; a non-admin still gets 403), but it fragments the cache. One-line fix if wanted: lowercase `requestedUserId` after the regex passes. | Low |
| N-2 | **Every act-as writes a `critical`/SOC2 audit row, including read-only GETs** (`user-status`, `additional-config` GET, `disconnect` GET). Intentional per D5, but an admin browsing another user's plugin list in `/test-plugins-v2` will emit a stream of critical rows. Worth a volume check after first real admin use. | Low |
| N-3 | **Two untouched neighbours still return `error.message` in production 500 bodies:** `app/api/plugins/available/route.ts:54` and `app/api/plugins/fetch-options/route.ts:203,215`. Pre-existing and **outside this PR's file set**, unlike L5 which was correctly fixed because those files were being rewritten anyway. | Low (pre-existing) |
| N-4 | **`POST /api/plugins/suggest` is unauthenticated and calls an LLM provider** (`ProviderFactory` → OpenAI) on a caller-supplied prompt with a hardcoded `userId: 'system'` context. No user data is exposed, so it is outside this workplan's threat model, but it is an anonymous token-spend endpoint sitting in the directory just hardened. Recommend adding it to the roadmap beside the OAuth-`state` item. | Low (cost/abuse, pre-existing) |
| N-5 | **2 `console.*` remain in `app/test-plugins-v2/page.tsx:1113,1115`** (`DEBUG:` lines the diff did not add). Dev flagged these for a user decision per CLAUDE.md § Logging rather than converting a ~3,000-line page; QA concurs. **This is an open user decision, not a QA sign-off item.** | Low |
| N-6 | **`pluginStatusCache` is imported under two different specifiers** — `'../user-status/route'` (`disconnect`) versus `'@/app/api/plugins/user-status/route'` (`refresh-token`, `oauth/token`). Under Next's per-route bundling these may be distinct module instances, so cross-route invalidation can be a silent no-op. **Pre-existing and security-neutral** — keys are resolved-id based, so the worst case is 30 s of staleness, never another user's data. | Low (pre-existing) |

#### Confirmed still open, already tracked — not regressions

- **Unsigned OAuth `state` carrying `user_id`** — re-verified live: `app/api/oauth/token/route.ts:10` writes `pluginStatusCache` for a `state`-derived id, and `app/oauth/callback/[plugin]` → `handleOAuthCallback` upserts tokens for that id with no session check. Correctly recorded on the roadmap as 🔴 and explicitly excluded from this PR (SA R4). **This PR does not close the credential-injection class repo-wide** — only in `/api/plugins/*` and `/api/plugin-connections/*`. The roadmap wording already says so.
- **`GET /api/plugins/execute` catalogue stays public** and, unlike `/api/plugins/available`, does **not** apply `isPluginDiscoverable` (`:176`), so it enumerates `business_os` internal modules that visibility scoping hides. Discovery leak, no user data. Accepted under SA Q1.

---

### 8. Acceptance criteria (workplan §8 + §6 + SA C-items)

| Criterion | Tested | Result |
|---|---|---|
| `npx tsc --noEmit` — no new errors in touched files | ✅ | **Pass** — 3 nearby errors, both sources verified pre-existing at HEAD |
| `npx jest lib/server/… app/api/plugins` green | ✅ | **Pass** — 52/52 |
| `console.` count 0 in the six route files | ✅ | **Pass** (also 0 in the resolver and `UserProvider`) |
| No remaining identity-from-caller reads under `/api/plugins` | ✅ | **Pass** — the 5 remaining `searchParams.get('user*Id')` reads all feed `requestedUserId` into the resolver |
| Self-targeting still works for every live caller (D3) | ✅ | **Pass** — §4, all call sites traced to source |
| Happy path + 401 + 403 per route | ✅ | **Pass** — 401 on all 12 handlers; 403 on execute / user-status / refresh-token; happy path on execute, disconnect, additional-config, refresh-token and `plugin-connections` GET |
| D7 — cache keyed on the resolved id; act-as cannot poison another user's entry | ✅ | **Pass** — now locked by U3, which was the one gap SA flagged |
| Credential-returning GET branch gone; nothing else returns decrypted credentials | ✅ | **Pass** |
| Audit: `userId`=target, `actorId`=admin, registered event, critical/SOC2, non-blocking | ✅ | **Pass** |
| SA R1 — `UserProvider` → `clientLogger` | ✅ | **Pass** — 0 `console.*` |
| SA R3 — dedup key cleared so the retry issues a real request | ✅ | **Pass** — proven by a new contract test, both directions |
| SA R3b — `refresh-token` tests | ✅ | **Pass**, and strengthened (§5) |
| SA R2 / R4 — doc corrections + OAuth finding on the roadmap | ✅ | **Pass** — §1 now separates the `user-status` chunked-cookie miss from `refresh-token`'s legacy cruft; §2's "shared helper" claim corrected; roadmap carries the 🔴 OAuth item; `PERFORMANCE_OPTIMIZATION_PLAN.md` §4A **and** its open checklist marked superseded/cancelled with the reason and a pointer to the resolver |
| Manual: logged-in non-admin `/test-business-os` module ops still succeed | ⚠️ **Not run** | Needs a live session and a seeded non-admin account. Static verification only: `page.tsx:225` sends `user.id` from `useAuth` → self-target → D3. **Recommended as a 5-minute pre-merge smoke**, together with "log out → log in → land on dashboard → connected plugins render on first paint" (the C10 race), which QA verified only at the deduplicator-contract level. |

---

### 9. Final status

- [x] All acceptance criteria pass — **ready for commit**, subject to the two manual smokes noted in §8 and the N-5 user decision on `test-plugins-v2` logging
- [ ] Issues found that Dev must address before commit — **none**

**Verdict: PASS-WITH-NOTES.** This closes a genuinely severe hole — anonymous plugin execution against OAuth credentials, anonymous retrieval of decrypted credentials, anonymous credential injection, and anonymous destructive disconnects — and it closes it in the right place: once, at a single boundary, with the audit written inside that boundary so no call site can skip it. The six non-blocking notes are cosmetic, pre-existing, or already tracked; none of them weakens the invariant.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-19 | Created | Workplan for hardening the four `/api/plugins/*` routes that accept a caller-supplied `userId` with no authentication. Records the finding that `middleware.ts` is not an auth gate, and that the existing "backward compatibility" fallbacks are likely masking a chunked-cookie miss in `getCachedUser` (D4). User decisions: admin-gated act-as override; all four routes in scope. |
| 2026-08-19 | SA review | APPROVE-WITH-CHANGES. Confirmed the no-auth severity claim and that middleware is not an API auth gate. Corrected the chunked-cookie inference (true for user-status/getCachedUser, false for refresh-token). Added required changes: Zod on all handlers, all HTTP verbs in scope, user-status Cache-Control public leak, isAdmin over isAdminById, registered audit event + actorId, resolver fail-closed/UUID guard, unauthenticated service-role plugin-connections/save route, post-login cookie race. |
| 2026-08-19 | SA follow-up ruling | C9 delete accepted (re-verified: no importers, one-way dependency on pluginStatusCache). C11 resolved as option (b) delete lib/cachedAuth.ts; hybrid rejected (two freshness semantics inside one security boundary). Conditions C11.1-C11.4: delete all three dead exports, amend PERFORMANCE_OPTIMIZATION_PLAN.md #4A + its open checklist, instrument resolver auth duration, track chunk-aware resolver cache as a roadmap follow-up. Corrected C11 perf framing: requestDeduplicator (1s TTL, shared plugin-status key) collapses mount-time callers to ~1 auth round trip. |
| 2026-08-19 | Implemented | SA C1–C16 applied. User decisions: admin-gated act-as, one PR for everything, delete the deprecated `plugin-connections/save`. **Scope grew from 4 routes to 8 handlers across 6 files** — `app/api/plugin-connections/route.ts` was missed by both the workplan and the SA review and held the worst hole: an unauthenticated GET returning **decrypted credentials** (branch deleted, zero callers), plus unauthenticated credential-injecting POST and an auth-skipping DELETE. Shared `resolveActingUserIdentity` added; `PLUGIN_ACT_AS` registered; `lib/cachedAuth.ts` deleted per C11(b); perf-plan §4A marked superseded. 5 suites / 43 tests green; tsc clean on touched files. |
| 2026-08-19 | SA code review | 🔄 Fix Required. Resolver verified fail-closed on every path (getUser throw → 401, malformed target → 400 before the admin lookup, isAdmin throw → 403, audit non-blocking); C1–C16 + C11.1–C11.4 checked individually against source. Required: R1 UserProvider still logs via console.* (one added by this diff), R3 the C10 retry is defeated by requestDeduplicator caching the rejected promise, R3b refresh-token has zero tests (C12 T1), R2/R4 doc fixes. Independent sweep found the same threat class surviving in the OAuth callback — unsigned state carries user_id and writes tokens into a caller-named account (tracked, not in scope). Credential-branch deletion re-verified: zero callers. |
| 2026-08-19 | SA code review + fixes | SA: Fix Required (R1 UserProvider logging, R3 dedup-cached rejection made the retry a no-op, R3b missing refresh-token tests, R2/R4 docs). All fixed, plus lows L1/L2/L3/L5/L6. SA independently swept the cluster and confirmed `/api/plugins/*` + `/api/plugin-connections/*` are clean, but found the **OAuth `state` is unsigned and carries `user_id`** — same class, distinct flow, now tracked on the roadmap as out of scope here. 46 tests green. Ready for QA. |
| 2026-08-19 | QA | ✅ **PASS-WITH-NOTES.** Security invariant re-derived from source on all 12 handlers (resolver precedes every side effect; no data-leaking early return). Wider-suite sweep: the 20 failing suites / 128 failing tests are **proven pre-existing** — identical results at HEAD with the PR's whole source surface stashed. Both "pre-existing" tsc errors verified (untouched file; HEAD-era `pluginStatusCache` export). Closed SA's missing U3 cache-isolation lock, added a concurrency test, and proved SA's R3 dedup fix in both directions with a new `request-deduplication` contract suite. Fixed two harness gaps that made existing locks weaker than they looked (`getDisconnectedPlugins` missing from the mock, so no `user-status` test ever reached 200; and T1's vacuous `refreshPluginToken` assertion). 46 → 52 tests. 6 non-blocking notes, 4 of them pre-existing; no must-fix. |
| 2026-08-20 | QA PASS-WITH-NOTES + N-1 fix | QA verdict PASS-WITH-NOTES, no must-fix. QA proved the 20 wider-suite failures pre-existing by stash-and-rerun at HEAD, verified the security invariant per handler by reading the code rather than trusting the tests, and repaired two weak test locks (the `user-status` 200 path had never been reached; T1's assertion was vacuous). Dev then took QA's N-1: the resolver canonicalises the act-as target id, so an upper-case UUID cannot address a second cache entry and your own id in upper case stays a self-target rather than a 403. **54 tests / 6 suites green. Holding for user code review before RM.** |
