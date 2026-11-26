# Workplan: GET /api/system-config hardening

> **Last Updated**: 2026-11-25

## Overview

`GET /api/system-config` is the customer-facing read of platform settings stored in
`system_settings_config`. This workplan brings it up to the current API route standard
(`new-api-route` skill): the route will require a signed-in user, validate its query string
with Zod, and return only an explicit allow-list of keys that the browser legitimately needs.
Error responses move to the standard `{ success: false, error, details }` envelope, logging
gains a correlation id, and the open item that tracks this route (OI-15 in
[admin-authz-unification.md](/docs/workplans/admin-authz-unification.md)) is closed.

No database change, no migration, no change to any caller.

| Field | Value |
|---|---|
| **Developer** | Dev |
| **Requirement** | TL brief, 2026-11-25 (no separate requirement MD). Tracked item: OI-15 / N-4 in [admin-authz-unification.md](/docs/workplans/admin-authz-unification.md) |
| **Branch** | `fix/system-config-route-auth` (created by RM off `origin/main`) |
| **Date** | 2026-11-25 |
| **Status** | Code Complete (awaiting SA code review) |

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Scope](#scope)
3. [Design Decisions](#design-decisions)
4. [Files to Create / Modify](#files-to-create--modify)
5. [Task List](#task-list)
6. [Test Matrix](#test-matrix)
7. [Verification Steps](#verification-steps)
8. [Rollback](#rollback)
9. [Follow-ups (out of scope)](#follow-ups-out-of-scope)
10. [SA Review Notes](#sa-review-notes)
11. [QA Testing Report](#qa-testing-report)
12. [Commit Info](#commit-info)
13. [Change History](#change-history)

---

## Analysis Summary

### Current route

**File:** `app/api/system-config/route.ts` (unchanged since it was created in `f75c6d63`)

| Aspect | Today |
|---|---|
| Auth | None. `middleware.ts` passes every `/api/*` path straight through, so nothing upstream authenticates it either |
| Input | `category` or comma-separated `keys` from the query string, unvalidated |
| Data access | `systemConfigRepository.getByCategoryAsMap(category)` / `getByKeys(keys)`. The repository defaults to `supabaseServer` (service role), so table RLS does not apply to these reads |
| Output (success) | Flat `{ [key]: value }` map |
| Output (neither param) | `200 {}` |
| Output (error) | `{ error }` with no `success: false` |
| Logging | `createLogger`, no correlation id; the debug line logs the raw `keys` param and the returned key names |
| Types | `Record<string, any>` without a justifying comment (CLAUDE.md rule 6) |

### Callers (whole-repo grep, re-checked on this branch)

| # | Caller | Request | Reads | Signed in? |
|---|---|---|---|---|
| 1 | `app/v2/agents/new/page.tsx:534` | `?category=agent_creation` | the FLAT body: `config.agent_creation_ai_provider`, `config.agent_creation_ai_model`; defaults on `!res.ok` or a thrown fetch | Yes (protected page, same-origin fetch sends the session cookie) |
| 2 | `lib/client/agent-api.ts` `systemConfigApi.getByKeys`, used once by `app/v2/agents/[id]/page.tsx:339` | `?keys=tokens_per_pilot_credit` | `data.data` | Yes |

Caller 2 already yields nothing today, for two independent reasons: the key does not live in
`system_settings_config` (it is in `ais_system_config`), and the client reads `data.data` while
the route returns a flat map. The page falls back to its default. `systemConfigApi.getByCategory`
and `getNumber` have no callers. No server-side caller of the route exists.

`systemConfigApi.getByKeys` treats `!response.ok || data.error` as failure, so the new error
envelope (`{ success: false, error }`) is still recognised as a failure by it.

### Skills consulted

| Skill | Applies? | Note |
|---|---|---|
| `new-api-route` | Yes | Source of truth for the route shape (auth, Zod, Pino + correlationId, error format, test minimum) |
| `tenant-isolation-guard` | Considered | The route acts on caller-supplied identifiers (`keys`) over a service-role client. The table is platform-wide (no `user_id` column), so there is no tenant to scope to; the allow-list is the guard that narrows what a caller-supplied identifier can reach. No writes |
| `business-os-schema-check` | Yes, light | Column names used (`key`, `value`, `category`) are as already established for `system_settings_config`; the repository is unchanged |
| `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain` | No | Nothing imported from those areas, no LLM call, no queue |

### Data export / descriptors

No new table, bucket or column — no export classification change.

---

## Scope

**In scope**

1. `app/api/system-config/route.ts` — rewrite the GET handler: `getUser()` gate, Zod query
   schema, allow-list filter, single `getByKeys` code path, standard error envelope, Pino child
   logger with correlation id, no `any`.
2. `app/api/system-config/__tests__/route.test.ts` — new integration test (fully mocked).
3. `app/api/rewards/agent-sharing/route.ts` — refresh the header comment that describes this
   endpoint (comment only, no code change).
4. `docs/workplans/admin-authz-unification.md` — mark OI-15 (and the N-4 row's pointer) resolved,
   add a Change History row, bump Last Updated.
5. `docs/REPOSITORY_STRATEGY.md:746` — the route table row names `getByCategory()`; update to
   `getByKeys()` so the doc matches. **SA to confirm** (one-cell edit).
6. `docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md:332` and `:450` —
   both list this route as a tracked follow-up. Append a short "resolved by
   `fix/system-config-route-auth`" note. **SA to confirm** (two small edits).

**Out of scope** (see [Follow-ups](#follow-ups-out-of-scope))

- Any database, RLS or migration change.
- `lib/client/agent-api.ts`, `app/v2/agents/new/page.tsx`, `app/v2/agents/[id]/page.tsx`.
- `SystemConfigRepository` (no method added or changed).

---

## Design Decisions

### D-1. Auth: `getUser()`, not `requireAdmin`

Both remaining callers are customer pages, so the gate is "signed in", not "admin". `getUser()`
from `@/lib/auth` is the first awaited call inside the `try`; `null` → `401
{ success: false, error: 'Unauthorized' }` before any query-string parsing or repository call.
If `getUser()` itself throws, the `catch` returns the generic 500 and the repository is still
never reached.

### D-2. The allow-list: one map, both lists derived from it

TL proposed two constants (a key list and a category enum). I propose **one** module-level map
from which both are derived, so the two can never drift (a key allowed in category mode but not
in keys mode, or the reverse):

**File:** `app/api/system-config/route.ts`

```typescript
/**
 * The only settings this browser-facing route will ever return, grouped by the
 * category a caller may ask for. Adding a key here is a deliberate decision to
 * expose it to every signed-in user — anything not listed is never returned,
 * whatever the table holds.
 */
const CLIENT_READABLE_SYSTEM_CONFIG = {
  agent_creation: ['agent_creation_ai_provider', 'agent_creation_ai_model'],
} as const;

type ClientReadableCategory = keyof typeof CLIENT_READABLE_SYSTEM_CONFIG;

const CLIENT_READABLE_CATEGORIES = Object.keys(
  CLIENT_READABLE_SYSTEM_CONFIG,
) as [ClientReadableCategory, ...ClientReadableCategory[]];

const CLIENT_READABLE_KEYS: ReadonlySet<string> = new Set(
  Object.values(CLIENT_READABLE_SYSTEM_CONFIG).flat(),
);
```

**The exact allow-list:**

| Category | Keys |
|---|---|
| `agent_creation` | `agent_creation_ai_provider`, `agent_creation_ai_model` |

Not included, deliberately: `agent_generation_ai_provider` and `agent_generation_ai_model`
(same category in the table, no browser reader) and `tokens_per_pilot_credit` (not in this
table at all). Neither value in the list is a secret — they are a provider name and a model
name that the page already sends back to `init-thread` in its request body.

Whether the constants are exported (for the test's invariant check) or kept module-private and
the invariants tested through the handler is a Next.js constraint: a `route.ts` may only export
route handlers and route segment config. **Decision:** keep them module-private in `route.ts`;
the invariant test (T15) exercises them through the handler. If SA prefers a direct import, the
map moves to `app/api/system-config/clientReadableConfig.ts` — say so in review.

### D-3. Query validation (TL point 3)

Zod schema over `{ category, keys }` taken from `request.nextUrl.searchParams.get(...)`
(`null` → `undefined`):

| Field | Rule |
|---|---|
| `category` | `z.enum(CLIENT_READABLE_CATEGORIES)` — anything else is **400** |
| `keys` | raw string, max 2,100 chars (bounds work before splitting); split on `,`, each segment trimmed; each segment must match `^[a-z0-9_]{1,100}$` (an empty segment fails); 1–20 segments; de-duplicated |
| combination | **exactly one** of the two (`.superRefine`) |

**Neither param → 400, and both params → 400** (today: neither → `200 {}`, both → category
silently wins). Justification:

- No caller sends neither or both, so nothing observable changes for the app.
- `200 {}` for a request that asked for nothing is a silent no-op that hides a caller bug; a
  400 names it. It also lets "exactly one of" be a single Zod rule instead of a special case
  above the schema.
- Keeping "both" ambiguous (category wins) would be an undocumented precedence rule.

`?category=` and `?keys=` (present but empty) are 400 too — an empty string is not a valid
category or key.

### D-4. Filtering and the single code path (TL point 4)

Both modes resolve to a list of allowed keys, then share one repository call:

| Mode | Keys queried |
|---|---|
| `category` | `CLIENT_READABLE_SYSTEM_CONFIG[category]` — the allow-listed keys of that category |
| `keys` | requested keys ∩ `CLIENT_READABLE_KEYS`; non-allowed keys are dropped silently (absent from the response, **not** a 400) |

- If the resolved list is empty (e.g. caller 2's `tokens_per_pilot_credit`), return `200 {}`
  **without calling the repository** — also avoids an `.in('key', [])` query. Caller 2 sees
  exactly what it sees today.
- Otherwise `systemConfigRepository.getByKeys(resolvedKeys)`, then build the response map from
  the returned rows, **keeping only rows whose `key` is in the resolved list**. This second
  filter is belt-and-braces: the response can never contain a key outside the allow-list even if
  the repository returns more than it was asked for (tested, T5).
- `getByCategoryAsMap` is no longer called by this route. A key later added to
  `agent_creation` in the table (as the two `agent_generation_*` keys are today) is never
  returned unless it is also added to the allow-list.

Why silent-drop for `keys` but 400 for `category`: the `keys` mode has a live caller that asks
for a non-allowed key, and making it a 400 would add error noise for no gain. The `category`
mode's only caller uses the allowed category, and an unknown category can only be a mistake.

Why 400 rather than silent `{}` for an unknown category is not a disclosure concern: the
allow-list is in this public repository anyway.

### D-5. Response shape — the asymmetry (TL point 5)

| Outcome | Body | Why |
|---|---|---|
| 200 | **flat** `{ [key]: value }` — unchanged | Caller 1 reads `config.agent_creation_ai_provider` directly off the body. Wrapping it in `{ success, data }` would break it, and fixing caller 1 is out of scope |
| 400 / 401 / 500 | `{ success: false, error, details }` — `details` only when `NODE_ENV === 'development'` | CLAUDE.md Error Response Format |

**This asymmetry is deliberate and is called out for SA.** It is safe only because no
allow-listed key can collide with an envelope field. Invariant (tested, T15): no allow-listed
key is `success`, `error`, `details` or `data`. A later move to `{ success: true, data }` would
need caller 1 changed in the same commit, and would incidentally make caller 2's `data.data`
read start working — that is the follow-up FU-2, not this change.

**400 `details`:** the `new-api-route` template returns `error.flatten()` unconditionally on a
Zod failure. I am guarding it with `NODE_ENV === 'development'` like every other error here,
because no caller reads it and an enum failure message lists the allowed categories. SA: if you
prefer the skill template verbatim, it is a one-line change.

### D-6. Logging, and why no audit (TL point 6)

- `const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();`
  `const requestLogger = logger.child({ correlationId });`
- Module logger: `createLogger({ module: 'SystemConfigAPI' })` (was `{ module: 'API', route }`).
  SA: if the existing `route` field is used by any log query, keep it — otherwise this matches
  the skill template.
- Logged fields: `userId`, `mode` (`category` | `keys`), `category` (an allow-listed enum value
  only — never the raw input), `requestedCount`, `allowedCount`, `returnedCount`, `durationMs`.
  **Never** a config value, never the raw `keys` string.

| Event | Level |
|---|---|
| Success | `debug` — today's level; this is a read on every mount of the agent creation page |
| 400 | `warn`, with `issueCount` only |
| 401 | not logged (skill template; a signed-out request is not an anomaly) |
| Repository error / thrown error | `error`, with `{ err }` |

**No audit entry.** The skill: "No audit log unless the read itself is sensitive." This is a
read of two non-secret, platform-wide settings, with no state change, on every page mount.
Auditing it would add one audit row per page view and no investigative value.

### D-7. Types and runtime

- No `any`: the response map is `Record<string, unknown>` (the repository's row type carries
  `value` as jsonb).
- `export const dynamic = 'force-dynamic';` (SA C-2): an auth-gated, per-user response must
  never become cacheable through a later refactor. Precedent: `app/api/rewards/agent-sharing/route.ts`.
  No `Cache-Control` header is added (no route in the repo sets one for a
  signed-in read; adding it would be a new pattern — SA to say if wanted).
- Import stays `import { systemConfigRepository } from '@/lib/repositories';` (the repository
  singleton, as today).

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/system-config/route.ts` | modify (rewrite GET) | D-1 … D-7 |
| `app/api/system-config/__tests__/route.test.ts` | create | Test matrix below |
| `app/api/rewards/agent-sharing/route.ts` | modify (comment lines 19-22 only) | The comment describes the old behaviour. New wording, neutral: the endpoint is not used for reward data because it serves platform settings, not reward facts (domain), and returns only an explicit allow-list of keys to signed-in users — adding reward data would mean widening that list |
| `docs/workplans/admin-authz-unification.md` | modify (small Edit) | Strike OI-15 and append "**RESOLVED 2026-11-25** by `fix/system-config-route-auth`: the route now requires a signed-in user and returns only an explicit allow-list of keys — see [system-config-route-auth-workplan.md](/docs/workplans/system-config-route-auth-workplan.md)", following the OI-8 / OI-11 strike-through precedent; one-line pointer on the N-4 row; Change History row (newest first, OI-18 precedent); bump Last Updated |
| `docs/REPOSITORY_STRATEGY.md` | modify (one cell) — SA to confirm | Route table row says `getByCategory()`; becomes `getByKeys()` |
| `docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md` | modify (two lines) — SA to confirm | Lines 332 and 450 list this route as a tracked follow-up; mark resolved with a pointer |
| `docs/workplans/system-config-route-auth-workplan.md` | create (this file) | Audit trail |

All edits are made with the Edit tool (never a whole-file rewrite of an existing doc).

Touched code files currently contain **0** `console.*` calls, so no logging conversion is owed.
`app/v2/agents/new/page.tsx` does contain `console.*` calls, but it is not touched by this change
(recorded as FU-5).

---

## Task List

| # | Task | Status |
|---|---|---|
| 1 | Write this workplan | ✅ |
| 2 | SA reviews the workplan; address every point below in [SA Review Notes](#sa-review-notes) | ✅ Approved with changes. C-1 (FU-3 removed), C-2 (`force-dynamic` added, D-7 updated), C-3 (GET JSDoc states the contract), C-4 (cast commented), C-5 (FU-1 reworded), C-6 (neutral wording in every doc edit) all addressed |
| 3 | Write `app/api/system-config/__tests__/route.test.ts` first, run it, confirm the new cases fail against the current route (proves the tests can fail) | ✅ 30 tests; against the old route 29 failed, 1 passed |
| 4 | Rewrite `app/api/system-config/route.ts` GET: allow-list map + derived lists (D-2), Zod schema (D-3), `getUser` gate (D-1), resolve keys → `getByKeys` → filter (D-4), envelope (D-5), logging (D-6), JSDoc updated to describe the allow-list contract | ✅ |
| 5 | Run the test file until green | ✅ 30/30 |
| 6 | Update the comment in `app/api/rewards/agent-sharing/route.ts` (neutral wording) | ✅ comment only |
| 7 | Mark OI-15 resolved in `docs/workplans/admin-authz-unification.md` (+ N-4 pointer, Change History row, Last Updated) | ✅ |
| 8 | If SA confirms: `docs/REPOSITORY_STRATEGY.md` row, Layer 2 requirement lines 332 / 450 | ✅ SA confirmed; single cell + two append-only notes |
| 9 | Verification steps 1-6 below, results recorded in this workplan | ✅ see [Verification Results](#verification-results-2026-11-25) |
| 10 | Status → Code Complete; notify TL for SA code review | ✅ |

---

## Test Matrix

**File:** `app/api/system-config/__tests__/route.test.ts`

Mocks (no network — `tests/jest-no-network.ts` refuses any non-loopback connection):

- `jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }))` — pattern from
  `app/api/agent-executions/stats/__tests__/auth.test.ts`.
- `jest.mock('@/lib/repositories', () => ({ systemConfigRepository: { getByKeys: (...a) =>
  getByKeys(...a), getByCategoryAsMap: (...a) => getByCategoryAsMap(...a) } }))` — mocking the
  barrel means no real repository (and no `supabaseServer`) is ever constructed.
- `jest.mock('@/lib/logger', …)` with a child logger whose methods are spies — for T16.
- Requests built with `new NextRequest('http://localhost/api/system-config?…')`.
- `NODE_ENV` switched with `jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'development' })`
  (or equivalent) and restored after — assigning to `process.env.NODE_ENV` directly is a TS
  error under Next's types.

| ID | Case | Expect |
|---|---|---|
| T1 | Signed in, `?category=agent_creation`, repo returns both rows | 200, flat `{ agent_creation_ai_provider, agent_creation_ai_model }`; `getByKeys` called once with exactly the two allowed keys; `getByCategoryAsMap` never called |
| T2 | Signed in, `?keys=agent_creation_ai_model` | 200 `{ agent_creation_ai_model }`; `getByKeys(['agent_creation_ai_model'])` |
| T3 | Signed in, `?keys=agent_creation_ai_model,tokens_per_pilot_credit,agent_generation_ai_model` | 200, only `agent_creation_ai_model`; `getByKeys` called with only the allowed key |
| T4 | Signed in, `?keys=tokens_per_pilot_credit` (caller 2's real request) | 200 `{}`; repository **not** called |
| T5 | Signed in, `?category=agent_creation`, repo returns the two allowed rows **plus** an `agent_generation_ai_model` row and a row from another category | 200; extra rows stripped — response keys are exactly the two allowed |
| T6 | `getUser` → `null` (both modes) | 401 `{ success: false, error: 'Unauthorized' }`; `getByKeys` and `getByCategoryAsMap` **not** called |
| T7 | Signed in, `?category=admin` (and `?category=`) | 400 `{ success: false, error: 'Invalid input' }`; repository not called |
| T8 | Signed in, malformed `keys`: uppercase, `a;b`, `a,,b`, trailing comma, a 101-char segment, 21 segments, raw string over the cap | 400 each; repository not called |
| T9 | Signed in, no params | 400; repository not called |
| T10 | Signed in, both `category` and `keys` | 400; repository not called |
| T11 | Signed in, repo resolves `{ data: null, error }`, `NODE_ENV` not development | 500 `{ success: false, error: 'Failed to fetch configuration' }`, `details` undefined; error message absent from body |
| T12 | Same as T11 with `NODE_ENV=development` | 500, `details` present |
| T13 | Signed in, repo throws | 500 `{ success: false, error: 'Internal server error' }`, no internal detail outside development |
| T14 | `getUser` throws | 500; repository not called |
| T15 | Allow-list invariants, through the handler: every allowed key round-trips via `?keys=` (proves each matches the key regex); `?category=agent_creation` queries exactly the keys that `?keys=` accepts; no allowed key is `success` / `error` / `details` / `data` (asserted on the T1 response keys) | pass |
| T16 | Logging hygiene: across T1 and T3, no logger call argument contains a config value string or the raw `keys` param; the success line carries `userId` and counts | pass |
| T17 | Duplicate keys `?keys=agent_creation_ai_model,agent_creation_ai_model` | 200; `getByKeys` called with the key once |

Minimum required by CLAUDE.md (happy path + auth failure + invalid input): T1/T2, T6, T7-T10.

---

## Verification Steps

Run from the worktree root. **Never run `npm install`** — `node_modules` is a junction to a
shared folder.

| # | Step | Command | Pass when |
|---|---|---|---|
| 1 | Route tests | `npx jest app/api/system-config` | All green; T3 step confirmed the new cases were red before the rewrite |
| 2 | Neighbouring suites | `npx jest app/api/rewards app/api/admin/system-config` | Green (comment-only change to agent-sharing; admin system-config suites unaffected) |
| 3 | Admin authz guard | `npm run test:authz-guard` | Green. `.github/workflows/admin-authz-guard.yml` runs `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, which walks every `route.ts` under `app/`. **R1** (`requireAdmin`) applies only to `app/api/admin/**`, so not to this route. **R2** (direct `AdminAccessService` import) and **R4** (access decision keyed on a `role` value) do scan this file — the new code uses neither, and comments must not introduce a role comparison. No other route-guard test was found that scans `app/api/system-config` (grep of `*.test.ts` that walk `route.ts` files) |
| 4 | Typecheck, filtered | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json > <scratchpad>/tsc.txt 2>&1; echo "exit=$?"` then `grep -E "app/api/system-config\|app/api/rewards/agent-sharing" <scratchpad>/tsc.txt` | Exit code is 0, 1 or 2 (1 or 2 = pre-existing errors reported); a V8 stack trace or any other code is a crash and the run does not count. The output must show the semantic pass ran — it contains `TS2xxx` diagnostics from elsewhere and no `TS1xxx` parse errors that would make tsc skip semantic checking. Zero lines for the touched files |
| 5 | Lint, touched files | `npx eslint app/api/system-config app/api/rewards/agent-sharing/route.ts` | 0 errors, 0 warnings |
| 6 | Caller re-grep | `git grep -n "api/system-config" -- app lib components hooks \| grep -v api/admin/system-config` | Still exactly the two callers above; no new server-side caller |

### Verification Results (2026-11-25)

| # | Result |
|---|---|
| 1 | `npx jest app/api/system-config` — **30/30 passed** (1 suite). Before the rewrite the same file was 29 failed / 1 passed. Beyond the matrix: T5b (keys mode also strips unrequested rows), T7b (400 `details` present in development), and T6 runs for four queries including an invalid one and no params (auth runs before validation) |
| 2 | `npx jest app/api/rewards app/api/admin/system-config` — 3 suites, **49/49 passed** |
| 3 | `npm run test:authz-guard` — 2 suites, **203/203 passed**, exit 0 |
| 4 | `tsc --noEmit` (8 GB heap) — **exit 2** (completed; pre-existing errors elsewhere). Semantic pass ran: 1,416 `TS2xxx` and 161 `TS18xxx` diagnostics elsewhere; the only `TS1xxx` are 2 × TS1501 (regex-flag target check in an unrelated test), not parse errors. **0 lines** for `app/api/system-config/**` or `app/api/rewards/agent-sharing/route.ts` |
| 5 | `npx eslint app/api/system-config app/api/rewards/agent-sharing/route.ts --max-warnings 0` — exit 0, no findings |
| 6 | Caller re-grep — unchanged: the two callers listed in the Analysis Summary |

`npm run build` is not required at the Dev stage for a single-route change; it is step 1 of the
ship drill before RM commits.

**Manual check for QA** (no E2E tooling): signed in, open `/v2/agents/new` with a prompt — the
network tab shows `GET /api/system-config?category=agent_creation` → 200 with exactly the two
keys, and the thread starts. Signed out, the same URL returns 401 JSON. `/v2/agents/[id]` loads
as before.

---

## Rollback

A single revert of the commit restores the previous route. No migration, no data, no caller
change to undo. Both callers already fall back to defaults on any non-200 response, so even a
partial failure of this change degrades to default provider/model on the creation page rather
than an error screen.

---

## Follow-ups (out of scope)

| ID | Follow-up | Note |
|---|---|---|
| FU-1 | **Database-level read access.** Database-level read access to `system_settings_config` is unchanged by this route change. It was set deliberately in migration `20260920a`, and a tightening is already planned as TH-2b (see `lib/design-system-v2/server/readV2CustomTokens.ts`), which needs its own migration and caller analysis | Belongs to TH-2b |
| FU-2 | **Client helper mismatch.** `systemConfigApi.getByCategory` / `getByKeys` in `lib/client/agent-api.ts` read `data.data` while the route returns a flat map, and the one live use asks for `tokens_per_pilot_credit`, which lives in `ais_system_config`, not this table. The page's value therefore always comes from its default. Fix: read that value from its real source, then either delete the unused helpers or move the route to `{ success, data }` with caller 1 in the same commit | Behaviour today is unchanged by this workplan |
| FU-4 | **Retire the route.** The creation page reads the two allow-listed keys only to send them back in its `init-thread` request body; the server can already resolve them itself (`SystemConfigRepository.getAgentCreationConfig()`). Resolving them server-side would leave this route with no caller | Separate change; touches the creation flow (`agent-creation-flow` skill) |
| FU-5 | `app/v2/agents/new/page.tsx` contains `console.*` calls (flag per CLAUDE.md § Logging). Not touched here; convert when that file is next modified | — |

---

## SA Review Notes

*(SA review follows the Dev points below.)*

Points raised for SA by Dev:

1. D-2 — one map with derived lists instead of two constants; module-private in `route.ts`
   vs. a sibling module.
2. D-3 — neither / both params now 400 (was `200 {}` / category wins).
3. D-5 — flat success body vs. enveloped errors; 400 `details` dev-only (deviation from the
   skill template's unconditional `flatten()`).
4. D-6 — logger module name change; success at `debug`; no audit.
5. Scope items 5 and 6 — the two optional doc edits.
6. Existing text in `docs/workplans/admin-authz-unification.md` (OI-15 / N-4 / slice 3 review)
   describes the old route in stronger terms than this repository's wording rule now allows.
   This workplan only appends a neutral "resolved" note and does not rewrite historical review
   text. SA to rule whether those sentences should also be neutralised now that the item is
   closed.

**Reviewed by SA — 2026-11-25**
**Status:** ✅ Approved with changes (C-1 … C-6 below; none needs a re-review of the plan — SA checks them at code review)

### What SA verified against the code (on this branch, which equals `origin/main` at `aa4c1310`)

| Claim | Verified |
|---|---|
| Route has no auth, no Zod, `Record<string, any>`, `{ error }` bodies, neither param → `200 {}`, debug line logs the raw `keys` | ✅ `app/api/system-config/route.ts` |
| Repository defaults to the service-role client; `getByKeys` is a single `.in('key', keys)` select | ✅ `lib/repositories/SystemConfigRepository.ts:5`, `:218`; exported singleton from `lib/repositories/index.ts:14` |
| `middleware.ts` skips `/api/*` | ✅ `middleware.ts:156` (onboarding-check skip) |
| Caller 1 reads the flat body, falls back on `!res.ok` and on a throw | ✅ `app/v2/agents/new/page.tsx:534` |
| Caller 2 reads `data.data`, treats `!ok \|\| data.error` as failure; the page checks `configResult.success && configResult.data` | ✅ `lib/client/agent-api.ts:313-320`, `app/v2/agents/[id]/page.tsx:339`, `:367` |
| No other live caller | ✅ whole-repo grep; the only other hits are `*.backup-*` page copies (not routed) and historical docs |
| `getUser()` returns `null` with no auth cookie | ✅ `lib/auth.ts:120` |
| Authz guard: R1 is `app/api/admin/**` only; R2 / R4 scan every `route.ts`; `adminGate.writes.test.ts` covers `app/api/admin/system-config` only | ✅ |
| `getAgentCreationConfig()` exists (FU-4) | ✅ `SystemConfigRepository.ts:505` |
| Logger module `SystemConfigAPI` unused elsewhere; nothing in the repo queries the old `route` field | ✅ (admin route is `AdminSystemConfigAPI`) |

### Rulings on the Dev points

1. **D-2 — one map, module-private in `route.ts`: ✅ approved.** One map with both lists derived is
   the right call (no drift between modes). Keep it private: Next's route type-check rejects
   non-handler exports from `route.ts`, and a sibling module is justified only when a second
   consumer exists. Testing the invariants through the handler (T15) is sufficient. See C-4 for
   the tuple cast.
2. **D-3 — neither / both → 400: ✅ approved, safe.** Caller 1 always sends exactly one
   `category`; caller 2's only use sends exactly one fixed key; `getByCategory` / `getNumber` have
   no callers. Both helpers already treat any non-OK status as "use the default", so even a
   caller this review missed degrades to defaults, not to an error screen. Auth runs before Zod,
   so a signed-out request with bad params is 401, which is correct. The key regex, the length
   cap, the segment cap and de-duplication are proportionate (cheap, and they keep the log fields
   bounded). `searchParams.get()` takes the first of a repeated param; that is acceptable and
   needs no test.
3. **D-4 — single `getByKeys` path, silent drop of non-allowed keys: ✅ approved.** The
   reasoning for drop-in-keys-mode vs 400-in-category-mode is sound (live caller asks for a
   non-allowed key). The post-filter on returned rows is correct belt-and-braces and T5 proves it.
   Not checking `row.category` in category mode is fine: the allow-list is the contract, keys are
   unique. The early `200 {}` without a repository call is approved.
4. **D-5 — flat success, enveloped errors: ✅ approved**, as a documented, tested exception
   forced by caller 1; FU-2 is the place to unify. **400 `details` dev-only: ✅ approved** — it is
   stricter than the template, satisfies the skill's own checklist line ("Error response uses
   `NODE_ENV === 'development'` guard for details") and CLAUDE.md § Security Rules. Do not edit
   the skill in this PR. See C-3.
5. **D-6 — ✅ approved as written.** Module `SystemConfigAPI`; success at `debug`; 400 at `warn`
   with `issueCount` only; 401 not logged; errors at `error` with `{ err }`. No audit: correct
   (non-sensitive read, no state change, per-mount call). The repository also logs its own error
   line; the route-level line is still wanted because it carries `correlationId` and `userId`.
6. **D-7 — ✅ approved**, plus C-2. No `Cache-Control` header (would be a new pattern for no gain).
7. **Scope item 5 (`docs/REPOSITORY_STRATEGY.md:746`): ✅ approved.** One cell:
   `systemConfigRepository.getByKeys()`; purpose may become "Get allow-listed system config
   (signed-in)". Nothing else in that doc.
8. **Scope item 6 (Layer 2 requirement `:332`, `:450`): ✅ approved**, append-only, neutral, e.g.
   "Resolved by `fix/system-config-route-auth`: the route now requires a signed-in user and
   returns only an explicit allow-list of keys; the area rows are not on it." Do not delete the
   original row text.
9. **Point 6 (older wording in `admin-authz-unification.md`): do NOT neutralise it in this PR.**
   It is a dated review record, it is already in git history (rewriting it hides nothing), and
   touching the ~8 places it appears would multiply the diff. Once OI-15 is struck through and
   carries the RESOLVED pointer, those sentences describe a closed item. The new text this PR adds
   to that doc (OI-15 note, N-4 pointer, Change History row) must be neutral: the proposed
   RESOLVED sentence in § Files is approved verbatim. No wording sweep follow-up is requested.
10. **`app/api/rewards/agent-sharing/route.ts` comment: ✅ approved** with the proposed neutral
    wording (platform settings, not reward facts; an explicit allow-list; reward data would mean
    widening it). Drop "known hole" / "oracle" language from that block; a pointer to this
    workplan is fine. Comment-only. (The guard strips comments before its R2 / R4 scans, so a
    comment cannot trip them; the new route code itself must still use neither.)

### Required changes

- **C-1. Remove FU-3 from this tracked workplan.** It is out of scope for a route change and is
  tracked outside this document. Renumber or leave the gap — either is fine.
- **C-2. Add `export const dynamic = 'force-dynamic';`** to the route. Today dynamic rendering is
  only implied by `getUser()` calling `cookies()` and by reading the search params; an auth-gated
  per-user response must never become cacheable through a later refactor. Precedent in the file
  this PR already touches (`app/api/rewards/agent-sharing/route.ts`), so it is not a new pattern.
  Remove the D-7 sentence saying it is not needed.
- **C-3. The GET JSDoc must state the contract and the asymmetry** in two or three lines: signed
  in only; only allow-listed keys are ever returned; the success body is a flat map (not
  `{ success, data }`) because of caller 1, guarded by the T15 invariant, and changing it means
  changing caller 1 in the same commit (FU-2). This stops a later "fix" from breaking the page.
- **C-4. Comment the `as [ClientReadableCategory, ...ClientReadableCategory[]]` cast** in one line
  (`z.enum` needs a non-empty tuple; `Object.keys` is typed `string[]`). CLAUDE.md rule 6 asks for
  a reason on every escape from the type checker.
- **C-5. Reword FU-1 neutrally**, e.g.: "Database-level read access to `system_settings_config`
  is unchanged by this route change. It was set deliberately in migration `20260920a` and a
  tightening is already planned as TH-2b; that needs its own migration and caller analysis." Keep
  the TH-2b pointer; drop "open to all roles".
- **C-6. Tracked-text hygiene for every doc edit in this PR** (this workplan included): describe
  the route's *current* behaviour, never how the old behaviour could be used; no ids, project
  refs, key values or config values. The Analysis Summary's "Today" table is factual and may stay.

### Process reminders (from the user's standing rules)

No commit, no `git stash`, no PR until the user has approved the diff. Never run `npm install`
in this worktree (shared `node_modules`).

### Approval
[x] Workplan approved with changes C-1 … C-6 — proceed to implementation (tests first, Task 3)

### SA Code Review

**Code Review by SA — 2026-11-25**
**Status:** ✅ Code Approved with one docs change (R-1). R-1 is docs-only and does not need a
second SA pass; QA may start in parallel.

#### Workplan changes C-1 … C-6

| # | Satisfied | Where |
|---|---|---|
| C-1 | ✅ | FU-3 is gone from Follow-ups; no other reference to it remains (the only mentions are the Task 2 row and the C-1 ruling itself) |
| C-2 | ✅ | `export const dynamic = 'force-dynamic'` in `route.ts`, with a one-line reason; D-7 updated |
| C-3 | ✅ | GET JSDoc states signed-in only, allow-list only, the flat success body and why, the T15 guard and "change the page in the same commit (FU-2)" |
| C-4 | ✅ | The tuple cast carries a two-line reason |
| C-5 | ✅ | FU-1 reworded neutrally; TH-2b pointer kept |
| C-6 | ✅ | Every new sentence in this PR describes current behaviour only. No ids, project refs, key values or config values in any tracked text. The pre-existing wording in `admin-authz-unification.md` is untouched, per ruling 9 |

#### Route (`app/api/system-config/route.ts`)

| Check | Result |
|---|---|
| Auth first | ✅ `getUser()` is the first awaited call; only the correlation id and child logger precede it. No parse and no repository call before the 401 (T6 runs four queries, including an invalid one and none) |
| Zod edge cases | ✅ empty `category` / `keys` → 400; empty segment and trailing comma → 400 (empty string fails the regex); segments trimmed before the regex, so whitespace cannot carry a key past it; uppercase fails the regex and the enum; raw length capped before split (20 × 100 + 19 commas fits under the cap); de-dup after validation; neither / both → 400; JS `$` without `m` anchors at end of input, and trim removes trailing newlines anyway |
| Allow-list bypass | ✅ none found. Category mode indexes the map only with an enum-validated value (`__proto__` / `constructor` rejected by the enum); keys mode intersects with a `Set` (`constructor` etc. pass the regex but `Set.has` is false); the repository is called only with the intersection; the response is filtered again on the returned rows. Repeated params take the first value (accepted at plan review) |
| Logging | ✅ `userId`, mode, enum `category`, counts, duration. No value, no raw `keys`, no requested key names. 400 logs `issueCount` only; 401 not logged; errors as `{ err }` |
| Error details | ✅ dev-only on 400, on the repository-error 500 and on the catch-all 500. `error.message` is typed (`AgentRepositoryResult.error` is `Error \| null`) |
| Types | ✅ no `any`; `Record<string, unknown>`; the `catch` narrows with `instanceof Error` |
| Standards | ✅ 0 `console.*`; repository access only; `new-api-route` final checklist walked — the `user_id` item does not apply (platform-wide table, no tenant column; the allow-list is the narrowing guard, as recorded under `tenant-isolation-guard`); no audit, correctly; no new table/column so no export classification. No import from `lib/business-os/entitlements/` |

#### Tests (`app/api/system-config/__tests__/route.test.ts`)

Re-run by SA: `npx jest app/api/system-config` — **30/30 passed**, 1 suite.

- Every seam is mocked (`@/lib/auth`, the `@/lib/repositories` barrel, `@/lib/logger`); the route
  imports nothing else that could open a connection. No network.
- Every 401 and 400 case asserts both repository methods were **not** called; so do T4 and T14.
- The tests can fail for the right reasons: dropping the intersection fails T3, dropping the
  post-filter fails T5, moving auth below the parse fails T6 (`?category=bogus` would be 400),
  removing the dev guard fails T11 / the 400 table. T11 running after T7b also proves
  `jest.replaceProperty` is restored by `restoreAllMocks` (Jest 30).

#### Doc edits

| File | Result |
|---|---|
| `app/api/rewards/agent-sharing/route.ts` | ✅ comment only, neutral, approved wording; `force-dynamic` there is unchanged |
| `docs/workplans/admin-authz-unification.md` | ✅ Last Updated, OI-15 struck with the approved RESOLVED sentence, N-4 pointer, Change History row (newest first). Minimal and neutral |
| `docs/REPOSITORY_STRATEGY.md` | ✅ one cell, as ruled. No Change History row required for a catalogue-cell correction (ruling 7) |
| `docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md` | ✅ two append-only notes, original text kept, neutral — but see R-1 |

#### Required change

- **R-1 (Low, docs).** `BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md` is a living doc
  with its own Change History, and its own rule is that every changed doc gets a row. Add one row
  (newest last, matching that table's order) — e.g. `2026-11-25 | Out-of-scope follow-up resolved |
  The GET /api/system-config row in Out of Scope and the matching Follow-ups bullet are marked
  resolved by fix/system-config-route-auth.` — and bump `Last Updated` to 2026-11-25. Edit tool
  only; nothing else in that doc.

#### Optimisation suggestions (non-blocking)

- T15 iterates only `agent_creation`. When a second category is added, loop T15 over every
  category so the reserved-name and round-trip invariants cover it too (a comment in T15 saying
  so would be enough now).
- A one-line guard `expect(route.dynamic).toBe('force-dynamic')` would stop C-2 being removed
  silently.
- A positive whitespace case (`?keys=%20agent_creation_ai_model%20` → queried as the trimmed key)
  would pin the trim, which today is exercised only by the length-cap case.

### Code Approved for QA: Yes (R-1 to be applied before RM; it does not affect QA's scope)

---

## QA Testing Report

**QA — 2026-11-25**
**Test mode:** full
**Strategy used:** B (Jest integration with every seam mocked — the route is an API handler) plus an in-memory adversarial probe of the handler (C, as a temporary Jest file inside the repo, deleted after the run), and code reasoning for the two callers (no browser click-through, per the TL brief)
**Focus:** api, security, schema
**Skipped:** D (manual browser check) — the brief asked for code reasoning plus handler output instead
**Input source:** prompt keywords (TL brief)

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Signed-in only; 401 before any parse or repository call | ✅ | Pass | T6 (4 queries) + probe: every one of 32 adversarial queries signed out → 401, repository never called |
| `getUser` throwing → 500, repository untouched, no internal detail | ✅ | Pass | T14 + probe (an `Error` and a non-`Error` rejection) |
| Zod validation: invalid input → 400 `{ success: false, error, details }`, details dev-only | ✅ | Pass | T7–T10, T7b + probe (see table below) |
| Only allow-listed keys reach the repository | ✅ | Pass | Probe asserts on every `getByKeys` call across all cases; `getByCategoryAsMap` never called |
| No response carries a non-allow-listed key, whatever the repository returns | ✅ | Pass | T5, T5b + probe: repository returning extra keys incl. `__proto__`, `constructor`, `hasOwnProperty`, `success` and another category → only the two allowed keys returned; `Object.prototype` not polluted |
| Repository `{ data: null, error: null }` | ✅ | Pass | Probe → 200 `{}` |
| Repository error / throw → generic 500 | ✅ | Pass | T11–T13 |
| Logging hygiene (no value, no raw `keys`) | ✅ | Pass | T16 |
| Caller 1 (`app/v2/agents/new/page.tsx`) unchanged | ✅ | Pass | Code reasoning: same-origin fetch sends the session cookie; 200 flat map with both keys (T1); reads `config.agent_creation_ai_provider` / `_model` off the body as before; any non-OK or throw → defaults |
| Caller 2 (`systemConfigApi.getByKeys(['tokens_per_pilot_credit'])`, `app/v2/agents/[id]/page.tsx:339`) unchanged | ✅ | Pass | Probe: `?keys=tokens_per_pilot_credit` → 200 `{}`, repository not called. Helper returns `{ success: true, data: undefined }` (it reads `data.data`), the page's `configResult.success && configResult.data` is false, default kept — identical to before |
| CLAUDE.md / `new-api-route` minimum: happy path + 401 + 400 | ✅ | Pass | T1/T2, T6, T7–T10 present |
| Entitlements registration | n/a | — | No import from `lib/business-os/entitlements/`; `test:bos-entitlements` not required |

**Adversarial probe results** (handler in memory, signed in, repository mock returning extra rows):

| Input | Status | Repository called with |
|---|---|---|
| `?keys=agent_creation_ai_model&keys=agent_creation_ai_provider` | 200, model key only | the first value only (first-wins, accepted at SA plan review) |
| `?keys=BAD&keys=<allowed>` | 400 | not called |
| `?category=agent_creation&category=x` | 200, both keys | the two allowed keys |
| `?category=x&category=agent_creation` | 400 | not called |
| `%2C` encoded comma between two allowed keys | 200, both | both allowed keys |
| `%20`, `%09` / `%0A`, `+` around an allowed key | 200 | the trimmed key |
| a space inside a key | 400 | not called |
| allowed + three unlisted keys | 200, allowed key only | the allowed key only |
| uppercase key; uppercase category | 400 | not called |
| `__proto__`, `constructor`, `hasownproperty` as keys | 200 `{}` | not called |
| `hasOwnProperty` as key (uppercase fails the regex) | 400 | not called |
| `__proto__,<allowed>` | 200, allowed key only | the allowed key only |
| `__proto__`, `constructor`, `hasOwnProperty`, `toString` as category | 400 | not called |
| `keys=`, trailing comma, 21 keys, a 101-char key, a Cyrillic lookalike, `%00` | 400 | not called |
| 20 keys incl. one allowed; a 100-char unlisted key | 200 | allowed key only / not called |
| `category=` ; `category=agent_creation&keys=` ; no params | 400 | not called |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. An unlisted-only request returns without a repository call.

#### Edge Cases (nice to fix)

1. **Verification step 4's pass rule names the wrong exit code** — docs only, Low. Step 4 says "Exit code is 0 or 2 … anything else … is a crash", and Verification Results row 4 records exit 2. Under `--noEmit`, tsc reports pre-existing diagnostics with **exit 1** (outputs skipped); QA's run exited 1 with the same diagnostic counts Dev recorded (1,416 TS2xxx, 161 TS18xxx, 2 × TS1501, no V8 trace). The run is valid; the rule should read "0, 1 or 2, with no V8 stack trace" so the next reader does not discard a good run.
2. The three non-blocking test suggestions from SA code review (loop T15 over every category, pin `dynamic`, a positive whitespace case) are still open; the probe confirmed the trim behaviour, so this is coverage-pinning only.

### Test Outputs / Logs

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/api/system-config` | 1 suite, **30/30 passed**, exit 0 |
| 2 | `npx jest app/api/rewards app/api/admin/system-config` | 3 suites, **49/49 passed**, exit 0 |
| 3 | `npm run test:authz-guard` | 2 suites, **203/203 passed**, exit 0 |
| 4 | Adversarial probe (temporary Jest file, deleted afterwards; `git status` confirms only `route.test.ts` remains in `__tests__/`) | 1 suite, **38/38 passed**, exit 0 |
| 5 | `npx eslint app/api/system-config app/api/rewards/agent-sharing/route.ts --max-warnings 0` | exit 0, no findings |
| 6 | `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | exit 1 (completed; pre-existing diagnostics elsewhere). 2,732 output lines; 1,416 TS2xxx and 161 TS18xxx diagnostics elsewhere, so the semantic pass ran; the only TS1xxx are 2 × TS1501 in two unrelated test files; no heap / V8 trace. **0 lines** for `app/api/system-config/**` or `app/api/rewards/agent-sharing/route.ts` |
| 7 | Caller re-grep (`git grep -n "api/system-config" -- app lib components hooks`, admin excluded) | unchanged: caller 1, `lib/client/agent-api.ts` (`getByCategory` unused, `getByKeys` one use), the route's own JSDoc and the agent-sharing comment |

`app/api/rewards/agent-sharing/route.ts` diff confirmed comment-only.

### Final Status
- [x] All acceptance criteria pass — ready for commit (after SA's R-1 docs change; Edge Case 1 is optional)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-11-25 | QA | PASS. Route 30/30, neighbours 49/49, authz guard 203/203, adversarial probe 38/38; eslint clean; tsc 0 lines for touched files. No bugs; one docs edge case (step 4 exit-code rule) |
| 2026-11-25 | SA code review | Code approved for QA. C-1 … C-6 satisfied; tests re-run 30/30. One docs change R-1 (Layer 2 requirement Change History row + Last Updated); three non-blocking test suggestions |
| 2026-11-25 | Implemented (Dev) | Tests first (red 29/30 on the old route), then the route; C-1 … C-6 applied; agent-sharing comment, OI-15, `REPOSITORY_STRATEGY.md` row and Layer 2 notes updated. Verification 1-6 green for touched files. Status → Code Complete |
| 2026-11-25 | SA workplan review | Approved with changes C-1 … C-6. D-2 … D-7 approved as written; scope items 5 and 6 approved (append-only, neutral); older wording in `admin-authz-unification.md` left as is |
| 2026-11-25 | Workplan created (Dev) | Planning only, no code. Design from the TL brief; Dev decisions D-2 (single derived allow-list), D-3 (neither/both → 400), D-4 (single `getByKeys` path + post-filter), D-5 (flat success, enveloped errors, dev-only details) raised for SA |
