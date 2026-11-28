# Workplan: PROD-1c F-2, the Test Surface Admin-Only on Every Deployment

> **Last Updated**: 2026-11-28

**Developer:** Dev
**Requirement:** Follow-up F-2 to PROD-1c A-1, extended by OQ-6 (both approved by the user on 2026-11-27; quoted verbatim in section 1). Parent: [PROD-1c A-1 workplan](/docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md) §16.1, §19
**Branch:** `fix/prod-1c-f2-admin-only-test-surfaces` (created by RM from `main` at `05732d73`, the A-1 merge, PR #694; confirmed by Dev with `git branch --show-current` before writing this file)
**Baseline read:** `05732d73`. Every file:line below is from that commit, checked in this worktree
**Date:** 2026-11-27
**Status:** Code complete (section 8.1), waiting on SA code review against B-1 to B-5. B-6 (the user acknowledges C-1 / C-2) gates the merge. Nothing committed

## Overview

A-1 put one gate in front of the test surface: the two harness pages (`/test-business-os`, `/test-plugins-v2`) and the test routes T-3 to T-10. In production the gate admits admins only. Everywhere else (Vercel previews, `next dev`, a local `next start`, Jest) it returns at once, so the surface is open there. This slice makes the surface **admin-only on every deployment**, and keeps production exactly as A-1 left it.

The change is small because A-1 built it in one place. `lib/security/testSurfaceGate.ts` decides "is the surface closed here?" in one function, `isTestSurfaceClosed()`, and both gates return early when it says no (`:100`, `:126`). Removing that early return makes every deployment behave as production does today. No route or layout changes its code. The two debug routes (T-5, T-6), which another session is deleting (F-8), pick up the rule without an edit.

The rest of the slice is T-9, `POST /api/v6/test-direct-generation`:
- its own `requireAdmin` directly after the gate (as T-8 already has);
- the project error format in its catch, instead of the raw `err.message` it returns today;
- its three LLM calls attributed to the signed-in admin instead of `'system'`. **This is a small change:** `CallContext.userId` is a plain string, and the admin's id comes from the new `requireAdmin` (section 3.4).

Then the tests that assumed "open under Jest", and the comments and docs that say "off production nothing changes".

No migration, no schema change, no new route, no new pattern, no environment change, no entitlements import, no Business OS AI call.

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Design](#3-design)
4. [Decisions for SA](#4-decisions-for-sa)
5. [Consequences, stated plainly](#5-consequences-stated-plainly)
6. [Overlap with F-8 (the debugger deletion)](#6-overlap-with-f-8-the-debugger-deletion)
7. [Files to create / modify](#7-files-to-create--modify)
8. [Task list](#8-task-list)
9. [Test plan](#9-test-plan)
10. [Observed, out of scope](#10-observed-out-of-scope)
11. [Risks and rollback](#11-risks-and-rollback)
12. [SA Review Notes](#12-sa-review-notes)
13. [QA Testing Report](#13-qa-testing-report)
14. [Commit Info](#14-commit-info)
15. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

From the user, approved 2026-11-27:

> Slice F-2 (follow-up to PROD-1c A-1): require admin sign-in on `POST /api/v6/test-direct-generation` (`app/api/v6/test-direct-generation/route.ts`, called T-9 in the A-1 workplan) on every non-production deployment.
> 1. Gate the route with `requireAdmin` as the first statement after the gate (CLAUDE.md Security Rules; admin source is `admin_users`, never `profiles.role`).
> 2. Stop returning raw `err.message` to the caller: use the project error format, with details only in development.
> 3. Its LLM calls are attributed to `'system'`. Attribute them to the signed-in admin's user id instead, if the provider factory call allows it. If that is a bigger change, report it to SA instead.
> 4. Tests: an anonymous call is refused, a non-admin is refused, an admin passes the gate (mock the LLM seam; no network).
> Out of scope: the debug routes `app/api/debug/control` and `app/api/debug/stream`.

Scope extension, approved by the user 2026-11-27 as OQ-6 in the A-1 workplan:

> Besides `POST /api/v6/test-direct-generation`, make the two internal test pages **admin-only on every non-production deployment** (Preview, staging, `next dev`, local `next start`), not just in production:
> - `/test-plugins-v2`: today it is open to anyone off production.
> - `/test-business-os`: today it is open to anyone signed in off production. The payment hold still applies.
> The testers are admins only (Barak and Offir). The admin source is `admin_users` via `requireAdminPage` / `requireAdmin`. Never use `profiles.role`.
> Keep the production behaviour exactly as A-1 has it: not found, `noindex`, nothing from the tool on the page.
> The test routes A-1 lists (T-3 … T-10) should get the same rule: admin-only off production, refused in production. Also check `lib/security/__tests__/testSurfaceRoutes.test.ts`. The debug routes T-5 and T-6 are being deleted by the "Delete the broken run debugger (F-8)" session: leave them to that session and don't gate them twice.
> Tests: a non-admin is refused off production, an admin passes, and production is unchanged.

---

## 2. Analysis summary

| Area | Facts measured on `05732d73` |
|---|---|
| The gate | `lib/security/testSurfaceGate.ts` (128 lines). `isTestSurfaceClosed(vercelEnv = process.env.VERCEL_ENV, onVercel = process.env.VERCEL)` at `:70-77` (fail-closed predicate, SA D-10, N-3). `testSurfaceRouteGate` at `:99-116`: `if (!isTestSurfaceClosed()) return null` at `:100`, then `requireAdmin` with any refusal or throw mapped to the JSON 404 `{ success: false, error: 'Not found' }` (`:85-87`). `testSurfacePageGate` at `:125-128`: `if (!isTestSurfaceClosed()) return` at `:126`, then `requireAdminPage({ onRefusal: 'notFound' })` with no try/catch (SA B-2). Imports `isProductionDeployment` (`:48`) only for the predicate. Header claims "Off production it does nothing" (`:15-16`) |
| Gate callers | 9 handlers in 8 route files, each `const gate = await testSurfaceRouteGate(...); if (gate) return gate;` with the comment "A 404 in production for anyone but an admin … a no-op elsewhere": T-3 `app/api/test/analyze-prompt/route.ts:39-42`; T-4 `app/api/test/generate-agent-v5-test-wrapper/route.ts:89-92`; T-5 `app/api/debug/control/route.ts:20-23`; T-6 `app/api/debug/stream/route.ts:23-26`; T-7 `app/api/v2/debug/data-check/route.ts:22-25`; T-8 `app/api/v6/execute-test/route.ts:84-88` (POST, plus "production runs both (SA N-6)" at `:86`) and `:223-226` (OPTIONS); T-9 `app/api/v6/test-direct-generation/route.ts:674-677`; T-10 `app/api/plugins/test-audit/route.ts:47-50`. Two layouts call the page gate: `app/test-plugins-v2/layout.tsx:29`, `app/test-business-os/layout.tsx:34` (before `redirectIfAwaitingPayment()` at `:35`) |
| Layout comments | `app/test-plugins-v2/layout.tsx:5-10` ("In production … Off production it renders as before"), `:24` ("The gate reads the session on production"). `app/test-business-os/layout.tsx:7-9` ("Signed out, the page renders exactly as before (its in-app sign-in still works)"), `:11-16` ("… Off production nothing changes"), `:30` ("In production this harness renders for admins only") |
| The admin gates | `requireAdmin(logger)` (`lib/admin/requireAdminRoute.ts:63`): 401 signed out, 403 non-admin, `{ user: { id, email } }` for an admin; never throws; records `admin_api` refusals on a "no" only. `requireAdminPage(options)` (`lib/admin/requireAdminPage.ts:103`): `'notFound'` mode calls `notFound()` outside every try/catch, records `admin_page` on a "no". Both ask `AdminAccessService.isAdmin`, which reads `admin_users` (60 s cache) and also admits an address in `ADMIN_EMAILS` (`lib/services/AdminAccessService.ts:9-16`) |
| T-9 | `POST` at `:672`. Gate at `:676`. Three `CallContext` literals with `userId: 'system'` at `:721`, `:763`, `:819`, each passed to `provider.chatCompletion(...)` (`:729`, `:771`, `:827`). The outer catch (`:889-907`) returns `err?.message` twice, in `validation.issues[0].message` (`:897`) and `error` (`:901`), always with status 200 (the header contract "NEVER 500; always 200 JSON", `:27`), and logs nothing. The six inner `throw new Error('…')` (`:737-841`) carry fixed messages; a provider error or a body-parse error reaches the catch with its own text. `stableResponseEnvelope` (`:56-75`) picks fields by name, so it has no `details` field today. 0 `console.*` |
| T-9 callers | **None in the repository.** Its only caller was `public/test-direct-generation.html`, deleted by A-1 (N-1). `app/test-plugins-v2/page.tsx` builds its request path from `/api/` plus the selected service key (`:1444`) over a fixed list of service keys (`:634-746`), none of them T-9 |
| Attribution path | `ProviderFactory.getProvider(PROVIDERS.OPENAI)` returns the provider; `chatCompletion(params, context: CallContext)`. `CallContext.userId: string` (`lib/ai/providers/baseProvider.ts:7`) goes to `AIAnalyticsService.trackAICall` as `user_id` (`baseProvider.ts:134`, `:190`). `trackAICall` keeps a valid UUID and maps anything else (so `'system'` today) to `platformAccountId()` with a warning (`lib/analytics/aiAnalytics.ts:128-138`). `notifyUsage` is a no-op outside a usage scope (`lib/ai/usageScope.ts:114-117`), and T-9 opens none, so no credits are charged either way |
| Drift guard (SA N-3) | `catalogueDrift.guard.test.ts` fails on a catalogue entry that no code reads (its header, line 7). Removing the gate's reads leaves both rows read: `VERCEL` at `lib/utils/origins.ts:118`, `VERCEL_ENV` at 7 other sites in `app`, `lib`, `components`, `hooks` and `middleware.ts` |
| Tests that assume "open under Jest" | Section 5, item C-6 |
| G-9 | `lib/__tests__/envConfigHardening.guard.test.ts`: header `:24-33` ("answers 404 in production"); `TEST_SURFACE_EXEMPT` `:237-258`; describe title `:664` ("gated in production"); floor of 13 routes `:673`. Every rule is a source check (import, first `await`, client-only render entries), so none depends on the predicate |
| T-12 (exempt) | `app/api/website/analytics/test/route.ts:19-24` answers **403**, not 404, whenever `NODE_ENV !== 'development'`; in `next dev` it needs a sign-in (`:30-33`), not an admin. The A-1 inventory (§5) and the G-9 reason (`:239`) both say "404" |

Skills checked:
- `tenant-isolation-guard`: not engaged. T-9 reads no tenant data by a caller-supplied id, and no write logic changes.
- `bos-llm-call-standards`: not engaged. T-9 is not a Business OS AI call; its three calls stay where they are, with only the attributed id changing.
- `business-os-schema-check`: no column or table claim beyond what `aiAnalytics.ts` already writes.
- `business-os-entitlements`, `durable-queue-drain`, `new-api-route`, `new-repository`: not engaged.
- `env-change-protocol`: no environment change. Section 5 lists what must already be true where the surface is used (C-3, C-4), as preconditions, not changes.
- V6 (CLAUDE.md rule 8): T-9 lives under `app/api/v6/`, but no phase changes. IntentContract, CapabilityBinderV2, IntentToIRConverter and ExecutionGraphCompiler are untouched. This is route-level access, error and attribution work only.
- `console.*`: 0 in every file this slice modifies (section 7).

---

## 3. Design

### 3.1 Where the rule lives: the shared gate (F2-D1)

`isTestSurfaceClosed()` and both early returns are deleted. The gates become:

```typescript
export async function testSurfaceRouteGate(logger: AdminGateLogger): Promise<NextResponse | null> {
  try {
    const verdict = await requireAdmin(logger);
    if (verdict instanceof NextResponse) return notFoundResponse();
    return null;
  } catch (err) {
    logger.error({ err }, 'Admin check threw at the test-surface gate; refusing');
    return notFoundResponse();
  }
}

export async function testSurfacePageGate(): Promise<void> {
  await requireAdminPage({ onRefusal: 'notFound' });
}
```

The names, signatures and return shapes stay, so the 9 handlers, the 2 layouts and G-9 R2 / R3 need no change. The production path is the same code it is today: the lines that ran after `isTestSurfaceClosed()` returned true now run unconditionally.

Through the shared gate, T-5 and T-6 get the new rule without their files being edited. The approved scope says "don't gate them twice", and they are not: no line is added to either file. Their "a no-op elsewhere" comments go stale until F-8 deletes the files (section 6).

### 3.2 The refusal off production: the same as production (F2-D2)

On every deployment:
- a gated route answers a non-admin with the JSON 404 (`{ success: false, error: 'Not found' }`);
- a gated page shows a non-admin the not-found screen, with `noindex`, no harness content, at HTTP 200 (A-1's B-3 option (c), F-10).

One behaviour everywhere means no environment branch is left to drift, and the production row of every test is unchanged. A developer who is refused locally can see why in the server log: `requireAdmin` / `requireAdminPage` already log "Non-admin attempted …" with the user id.

### 3.3 `isTestSurfaceClosed()`, the fail-closed logic, and the drift guard (F2-D3, F2-D4)

`isTestSurfaceClosed()` is deleted along with its import of `isProductionDeployment`. The fail-closed reasoning (SA D-10) is satisfied more strongly than before: no `VERCEL_ENV` value, misspelled or not, can open the surface now, because nothing reads it. The ten `isTestSurfaceClosed` cases in the unit test become a table of deployments over which the gates must refuse a non-admin (section 9).

N-3 asked for literal `process.env` reads so the admin Environment page's drift guard could see them. With the reads gone there is nothing to see. The guard stays green, because `VERCEL` and `VERCEL_ENV` are still read elsewhere (section 2), so neither catalogue row becomes unreferenced. No catalogue edit.

So that an opt-out cannot be added back quietly (the D-17 "no opt-out variable" ruling), the gate's unit test gains one source assertion: `lib/security/testSurfaceGate.ts` contains no `process.env` and does not import `deploymentEnvironment`. It is in the unit test, not G-9 (N-2's "do not escalate the textual rule").

### 3.4 T-9 specifics (F2-D6, F2-D7, F2-D8)

**Own admin check.** Directly after the gate:

```typescript
const requestLogger = logger.child({ correlationId });
const gate = await testSurfaceRouteGate(requestLogger);
if (gate) return gate;
// F-2: its own check as well (as T-8, SA N-6). It also gives the admin's id for attribution.
const admin = await requireAdmin(requestLogger);
if (admin instanceof NextResponse) return admin;
```

This is the T-8 shape: two session reads for an admin, and the second admin answer comes from the 60 s cache. For a non-admin the gate refuses first, so the route's own 401/403 is reached only if the gate's contract is ever broken. That is the point of the double check. G-9 R2 still sees the gate as the first `await`. The required admin guard is not engaged: `requireAdmin` outside `app/api/admin/` is the T-8 precedent, and no `route.ts` imports `AdminAccessService`.

**Error format.** The outer catch at `:889`:
- logs `requestLogger.error({ err }, 'Direct generation failed')` (today it logs nothing);
- returns the same envelope with `error: 'Workflow generation failed'` and `validation.issues: [{ level: 'fatal', message: 'Workflow generation failed' }]`;
- adds `details: process.env.NODE_ENV === 'development' ? err?.message : undefined`. `stableResponseEnvelope` gains a `details` field passed through by name.

The status stays 200, per the route's documented "NEVER 500" contract (F2-D7). The inner `throw new Error('…')` messages reach the caller only through `details`, in development. The `enhanced_prompt is required` branch (`:684-699`) is a user-facing validation message and stays as it is.

**Attribution: small, done here, not escalated.** `userId: 'system'` becomes `userId: admin.user.id` at `:721`, `:763` and `:819`. The provider factory, `CallContext` and `AIAnalyticsService` are unchanged. What changes:
- the three rows in the LLM usage table are recorded against the admin's account instead of the platform account;
- the "Invalid user_id; recording against the platform account" warning that every call logs today stops;
- no credits are charged, before or after, because T-9 opens no usage scope.

The visible effect is section 5, C-9.

### 3.5 Comments and docs

| Where | Now says | After |
|---|---|---|
| `lib/security/testSurfaceGate.ts` header "WHAT IT DOES" (`:13-23`) | Off production it does nothing; on production it refuses | On every deployment it refuses everyone who is not an admin; the route and page refusal shapes as today. "WHAT IT GUARDS" (`:5-11`) is left for F-8 (section 6) |
| `app/test-plugins-v2/layout.tsx:5-10`, `:24` | In production … off production it renders as before; reads the session on production | On every deployment; reads the session on every request |
| `app/test-business-os/layout.tsx:7-9`, `:11-16`, `:30` | Signed out, the in-app sign-in still works; off production nothing changes | A non-admin, signed out included, gets the not-found screen on every deployment. An admin signs in through the app first. The payment hold runs second, as today |
| T-3, T-4, T-7, T-8 (×2, plus `:86`), T-9, T-10 gate comments (7 sites in 6 files) | "A 404 in production for anyone but an admin … a no-op elsewhere" | "A 404 for anyone but an admin, on every deployment". T-5 and T-6 are not touched |
| G-9 header `:24-33` and describe title `:664`; T-12 reason `:239` | "in production"; T-12 "answers 404 … stricter than the gate" | "on every deployment"; T-12 corrected (F2-D10). Floors, matchers and rules unchanged |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:267` and a Change History row | "In production … Elsewhere (local, Jest, Vercel previews) nothing changes. 'Production' fails closed …" | On every deployment; the fail-closed sentence removed (nothing reads the environment). The table rows `:271-272` are left for F-8 |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` Account Model (`:46-57`), Billing (`:288`), and a Change History row | "If you are not signed in … calls return 401"; "Signed out, and for every other account, the page behaves exactly as before"; "use a designated test account" | Admins only, on every deployment; what that means for the test-account flows (F2-D11) |
| `docs/V2_TEST_PAGE_SCOPE.md` Overview (`:11`) | "provides developers and administrators with tools" | One access note: admins only, on every deployment. That doc has no Change History; none is added (not this slice's restructure) |
| A-1 workplan §16.1 OQ-6 row, §19 F-2 row, a Change History row | OQ-6 open; F-2 "sign-in on Preview" | Pointers to this workplan |

---

## 4. Decisions for SA

| # | Fork | Options | Dev recommendation |
|---|---|---|---|
| F2-D1 | Where the rule lives | (a) The shared gate: delete the early returns in `testSurfaceGate.ts`. One file, no caller edits; T-5 / T-6 covered without an edit. (b) Per surface: `requireAdmin` / `requireAdminPage` in each of the 9 handlers and 2 layouts, G-9 rewritten, and T-5 / T-6 edited, which collides with F-8 | **(a).** The gate exists so this rule has one home |
| F2-D2 | The refusal off production | (a) The same as production: JSON 404 for routes, the not-found screen at 200 with `noindex` for pages. (b) Off production, pass `requireAdmin`'s 401/403 and the page redirect through, which is easier to debug but brings back an environment branch, with two behaviours to test and to drift | **(a).** The server log already says who was refused and why |
| F2-D3 | `isTestSurfaceClosed()` | (a) Delete it, its `isProductionDeployment` import and its ten cases; N-3 becomes moot, and the drift guard stays green (section 2). (b) Keep it as an unused export | **(a).** Dead code would invite someone to wire it back in |
| F2-D4 | Stopping a future opt-out | (a) One source assertion in `testSurfaceGate.test.ts`: no `process.env`, no `deploymentEnvironment` import. (b) A new G-9 rule. (c) Nothing | **(a).** Cheap, local, and does not grow G-9 (N-2) |
| F2-D5 | The four route suites that assumed an open gate (section 5, C-6) | (a) Mock `@/lib/security/testSurfaceGate` to admit, with a comment naming `testSurfaceRoutes.test.ts` as the gate's owner, so each suite keeps pinning its route's own layer with its assertions unchanged. (b) Mock `getUser` + `isAdmin` as an admin. That loses every "401 with no session" assertion, because an anonymous caller can no longer pass the gate | **(a).** The routes' own checks are defence in depth and stay tested. The gate is tested where it lives |
| F2-D6 | How T-9 gets the admin's id | (a) Its own `requireAdmin` after the gate, as scoped and as T-8 (N-6). (b) Have the gate return the user. That changes the `if (gate) return gate` shape at 9 handlers and in G-9 R2 | **(a)**, as approved |
| F2-D7 | T-9's status on failure | (a) Keep 200 (the route's documented "NEVER 500" contract) with the project fields `success: false`, a generic `error`, and `details` in development only. (b) Answer 500 | **(a).** The scope asks for the format, not a status change. The route has no caller to break either way |
| F2-D8 | Attribution | (a) The admin's id at the three sites, now. (b) Escalate to SA as too big | **(a).** It is a three-literal change through an existing string field. No factory change. Effects in C-9 |
| F2-D9 | Stale gate comments in route files | (a) Correct the 7 comment sites in the 6 in-scope route files (comment only). (b) Leave them | **(a).** T-5 / T-6 are left to F-8 |
| F2-D10 | T-12 (`website/analytics/test`), exempt from the gate | (a) Keep it exempt and correct its G-9 reason: 403 outside `next dev`, sign-in (not admin) in `next dev`. (b) Gate it too | **(a).** It is not in the approved T-3 to T-10 list, and on any deployed host it refuses everyone. If SA wants (b), it is one gate line plus removing the exemption |
| F2-D11 | Harness flows that run as a non-admin test account (C-2) | (a) Proceed as approved: admin-only everywhere. Record in the test-page docs that a flow needing a non-admin account runs through the product itself (Settings → Plan, onboarding), and that a test account is **never** added to `admin_users`. (b) Carve out an exception for non-admin test accounts, which is new scope and a new pattern | **(a)**, but **the user should see C-2 before the merge** (via TL). "The testers are admins only" is true. The accounts some tabs are run *as* are not |
| F2-D12 | T-9 has no caller in the repository (section 2) | (a) Build as approved, and record deleting it as a follow-up for TL. (b) Delete it instead | **(a)** in this slice. Deleting it is the user's call (follow-up FU-1). **Decided by the user (2026-11-27): delete T-9 in a later follow-up slice, not in F-2.** F-2 still builds its gate, error format and attribution, as approved |
| F2-D13 | Order against F-8 | Either merges first; the second rebases (section 6) | No ordering constraint. Section 6 lists the expected conflicts, all mechanical |

---

## 5. Consequences, stated plainly

**For people using the harness:**

- **C-1. `/test-business-os` loses its in-app sign-in on every deployment.** A signed-out visitor gets the not-found screen before the page renders, as already happens in production. An admin signs in through the app first, then opens the page. The in-app sign-in becomes unreachable everywhere (A-1 F-7, now on every deployment; removing it is not this slice).
- **C-2. Flows that run as a non-admin account stop working through the harness, including on a developer's own machine.** The Billing tab is documented to run only from a developer's `.env.local` with "a designated test account" (`docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:280`, `:288`). The Modules tab is how a new module is checked "as an active tenant" (`docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md:48`). `/test-plugins-v2`'s "Grant Free Tier to Me" grants to the signed-in account, once (`docs/V2_TEST_PAGE_SCOPE.md:484-486`). From F-2 each of these can be run only while signed in as an admin. A-1 already removed this in production; F-2 removes it in `next dev`, which is where the Billing tab actually runs. The Upgrade modal tab only links to `/business-os/upgrade-modal-demo`, which is outside the gate and still open to non-admin test accounts. F2-D11.
- **C-3. Local development needs the developer to be an admin** in the database their `.env.local` points at: a row in `admin_users`, or their address in that environment's `ADMIN_EMAILS` (the service's env fallback, which logs a warning on each uncached check).
- **C-4. A Preview needs the admin to be able to sign in on that preview's host,** and to be an admin in the database that preview uses. Where a preview host is not registered for sign-in (A-1 R-2), the harness is unusable there until it is.
- **C-5. Signed-in non-admins refused off production are now recorded** as `admin_api` / `admin_page` refused-access rows, in whatever database that deployment writes to. Anonymous callers write nothing (D-12, unchanged).

**For tests and tools:**

- **C-6. Jest now meets the gate.** Every existing test that calls a gated handler or layout, and what happens to it:

| Test file | Today | With F-2, unless changed | Change (F2-D5) |
|---|---|---|---|
| `app/api/test/analyze-prompt/__tests__/auth.test.ts` (3 cases) | `getUser` mocked; `AdminAccessService` not mocked; the gate is open | The anonymous cases get 404, not 401. The signed-in case reaches the real admin check, which tries the database. The no-network guard refuses that, so the check fails closed and the case gets a 404 | Mock the gate to admit |
| `app/api/test/generate-agent-v5-test-wrapper/__tests__/auth.test.ts` (5 cases) | The same | The same | Mock the gate to admit |
| `app/api/v6/execute-test/__tests__/auth.test.ts` (6 cases) | `getUser` and `isAdmin` mocked | "401s with no session" and "403s a non-admin" get 404; the admin cases read the session twice | Mock the gate to admit |
| `app/api/plugins/test-audit/__tests__/route.test.ts` (6 cases) | Only `resolveActingUserIdentity` mocked | The gate's real `getUser` calls `cookies()` outside a request, throws, and is refused: all 6 cases get 404 | Mock the gate to admit |
| `lib/security/__tests__/testSurfaceGate.test.ts` | Pins "open off production" | Fails by design | Rewritten (section 9) |
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | "off production the gate does nothing" block (`:214-224`) | Fails by design | Rewritten (section 9) |

  Not affected, because they are source checks or do not reach the gate: `lib/business-os/invites/__tests__/paymentHold.test.ts` (it reads the layout's first two statements, which do not change), G-9 and its self-tests, `lib/admin/__tests__/requireAdminPage.test.ts`, the admin authz guard, and `catalogueDrift`. Each is still run (section 9).
- **C-7. CLI probes off production need an admin session to see a harness.** A-1's FR-3 preview control run found the harness marker on a cookie-less preview. That row now inverts, which is what makes F-2's probe able to fail (section 9). An admin-pass live probe would need a session cookie. It is not asked for: the app is parked for click-throughs, and Jest covers the admin path.
- **C-8. The T-8 `OPTIONS` handler refuses every preflight on every deployment** (a preflight carries no cookie). The harness calls it from the same origin, where no preflight is sent, so nothing breaks (as SA accepted for production in A-1).

**For T-9:**

- **C-9. T-9's LLM cost moves from the platform account to the admin who ran it.** Its rows in the usage table carry the admin's id under feature `v6_test`. So:
  - they appear in that admin's own usage figures;
  - they leave the platform-account bucket of the admin AI cost views;
  - no credits are charged, as today.

  With no in-repository caller, this happens only when an admin calls the route by hand.
- **C-10. A failing T-9 call no longer tells the caller why outside development.** The reason goes to the server log under the request's `correlationId`.

**Production:** unchanged. The same code runs there as today. The production rows of every rewritten test keep A-1's assertions.

---

## 6. Overlap with F-8 (the debugger deletion)

F-8 is on `fix/f8-delete-run-debugger`, cut from the same `05732d73`. At the time of writing it had no changes. F-2 touches no file F-8 deletes, and no line in `app/api/debug/**`. The shared files, and how each side stays out of the other's lines:

| File | F-8 will likely change | F-2 changes | Conflict |
|---|---|---|---|
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | the `DebugSessionManager` mock (`:58-76`), `work.debugSession` (`:38`), the T-5 / T-6 imports (`:115-116`) and rows (`:127-128`) | the header wording (`:1-14`), the environment setup (`:145-159`), the describe blocks (`:161-224`). **Not** the mocks, imports or `HANDLERS` | Only if F-8 also rewords the header. Mechanical |
| `lib/__tests__/envConfigHardening.guard.test.ts` | **must** lower the G-9 R1 route floor at `:673` from 13 to 11, or G-9 fails once the two routes are gone | header `:24-33`, describe title `:664`, T-12 reason `:239`. Not `:673` | None expected (separate hunks) |
| `lib/security/testSurfaceGate.ts` | "WHAT IT GUARDS" (`:5-11`) names `app/api/debug/**` | "WHAT IT DOES" (`:13-23`) and the code | Adjacent hunks; possibly a mechanical conflict |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | the table row `:271` naming `app/api/debug/**`; a Change History row; Last Updated | the paragraph `:267`; a Change History row; Last Updated | Certain at the Change History tail and Last Updated. Mechanical: keep both rows |
| A-1 workplan | probably the §16.1 F-8 row (`:720`) and §19 F-8 row (`:763`) | §16.1 OQ-6 row (`:721`), §19 F-2 row (`:757`), Change History | `:720` and `:721` are adjacent, so a conflict is likely. Mechanical |

**Confirmed by the F-8 session (2026-11-27), relayed by TL.** In `testSurfaceRoutes.test.ts`, F-8 removes the `debugControl` / `debugStream` imports, the T-5 / T-6 `HANDLERS` rows (9 → 7), the `jest.mock` of `@/lib/debug/DebugSessionManager`, the `debugSession` counter and the debug-session header wording. F-8 does not touch `testSurfaceGate.ts` or `testSurfaceGate.test.ts`, and it lowers the G-9 R1 floor 13 → 11 itself. F-2 therefore keeps the T-5 / T-6 rows as they are on `main`, and its edits to that file are per-row and structural only: a `DEPLOYMENTS` table and a `setEnv` helper after `saved`, the environment lines dropped from the top-level `beforeEach`, `describe` turned into `describe.each(DEPLOYMENTS)` with its own `beforeEach` in the two existing blocks (whose `it.each` bodies and assertions are untouched), the "off production the gate does nothing" block removed, and "on production" changed to "on every deployment" in header lines 3 and 6 (F-8's header wording is line 8). No wholesale rewrite, so whichever session merges second can rebase cleanly.

Behaviour does not conflict. Whichever lands first, T-5 and T-6 are either admin-only through the gate (F-2 first) or gone (F-8 first). The table test keeps passing on both orders, because F-8 removes their rows together with their imports.

---

## 7. Files to create / modify

`console.*` counts are from `grep -c -E` for a `console.<method>(` call on `05732d73`. Every file this slice modifies has **0**, so there is nothing to flag or convert (CLAUDE.md § Logging).

| File | Action | Reason | `console.*` |
|---|---|---|---|
| `lib/security/testSurfaceGate.ts` | modify | Delete `isTestSurfaceClosed`, both early returns and the `isProductionDeployment` import; header "WHAT IT DOES" (3.1, 3.3) | 0 |
| `lib/security/__tests__/testSurfaceGate.test.ts` | modify (rewrite) | Deployment table; the source assertion (F2-D4) | 0 |
| `lib/security/__tests__/testSurfaceRoutes.test.ts` | modify | Every case on three deployments; the "does nothing" block removed (section 6 limits) | 0 |
| `app/api/v6/test-direct-generation/route.ts` | modify | Own `requireAdmin`; `requestLogger`; error format and log; `details` in the envelope; three ids; gate comment (3.4) | 0 |
| `app/api/v6/test-direct-generation/__tests__/auth.test.ts` | create | T-9 tests (section 9) | n/a |
| `app/test-plugins-v2/layout.tsx`, `app/test-business-os/layout.tsx` | modify (comments only) | 3.5 | 0, 0 |
| `app/api/test/analyze-prompt/route.ts`, `app/api/test/generate-agent-v5-test-wrapper/route.ts`, `app/api/v2/debug/data-check/route.ts`, `app/api/v6/execute-test/route.ts`, `app/api/plugins/test-audit/route.ts` | modify (comments only) | F2-D9 | 0 each |
| `app/api/test/analyze-prompt/__tests__/auth.test.ts`, `app/api/test/generate-agent-v5-test-wrapper/__tests__/auth.test.ts`, `app/api/v6/execute-test/__tests__/auth.test.ts`, `app/api/plugins/test-audit/__tests__/route.test.ts` | modify | Mock the gate to admit (F2-D5); assertions unchanged | 0 each |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify (wording only) | G-9 header, describe title, T-12 reason (F2-D10) | 0 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | `:267` paragraph, Last Updated, Change History | n/a |
| `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` | modify | Account Model and Billing access notes (C-1, C-2), Last Updated, Change History | n/a |
| `docs/V2_TEST_PAGE_SCOPE.md` | modify | One access note | n/a |
| `docs/workplans/prod-1c-app-url-public-host-test-gating-workplan.md` | modify (pointers only) | §16.1 OQ-6, §19 F-2, Change History | n/a |
| `docs/workplans/prod-1c-f2-admin-only-test-surfaces-workplan.md` | create | This file | n/a |

**Not touched:** `app/api/debug/**` (F-8); `lib/admin/requireAdminRoute.ts`, `lib/admin/requireAdminPage.ts` (no change needed); `lib/admin/environment/catalogue.ts`; `lib/ai/**`; `lib/analytics/**`; `middleware.ts`.

---

## 8. Task list

- ✅ 1. The gate: delete `isTestSurfaceClosed` and both early returns; header. Rewrite `testSurfaceGate.test.ts`, with the F2-D4 source assertion (N-1 allow-list)
- ✅ 2. `testSurfaceRoutes.test.ts`: three deployments; keep the mocks, imports and `HANDLERS` untouched (section 6)
- ✅ 3. The four route suites: mock the gate to admit; run each, assertions unchanged
- ✅ 4. T-9: `requestLogger`, own `requireAdmin`, three ids, error format, catch log, `details`; the new `auth.test.ts`
- ✅ 5. Comment updates: 2 layouts, 6 route files, G-9 wording, T-12 reason (N-3, N-4)
- ✅ 6. Docs: the admin doc, the two test-page docs, the A-1 workplan pointers (B-5, N-7, N-8)
- ✅ 7. Mutation proof (section 9, item 6), restoring from copies (never `git stash`); 8.1
- ✅ 8. Run the suites in section 9 plus `npm run test:authz-guard`; typecheck the touched files; `npm run build` (ship drill step 1); 8.1

### 8.1 Implementation notes (Dev, 2026-11-27)

Built on `05732d73` in this worktree. Not committed.

| Item | What was done |
|---|---|
| Gate (F2-D1, F2-D3; B-4) | `lib/security/testSurfaceGate.ts`: `isTestSurfaceClosed()`, both early returns and the `isProductionDeployment` import deleted. `testSurfaceRouteGate` keeps its try/catch and its `logger.error`; `testSurfacePageGate` is one un-wrapped `await requireAdminPage({ onRefusal: 'notFound' })`. Names, signatures and return shapes unchanged. Header "WHAT IT DOES" rewritten (every deployment, no environment branch, no opt-out); in "WHAT IT GUARDS" one clause moved to the past tense ("one spent LLM money attributed to the platform", N-3); the page gate's JSDoc no longer says "or where the surface is open" (N-3). Imports are now exactly `next/server`, `requireAdminRoute`, `requireAdminPage` |
| Gate unit test (F2-D4 with N-1) | `testSurfaceGate.test.ts`: one `DEPLOYMENTS` table of 8 shapes (local; preview; development; production; production without `VERCEL`; `Production`, `''`, `staging` on Vercel). Route gate: admin passes, 401 and 403 become the JSON 404, a throw becomes a 404 with one `logger.error`, on each. Page gate: called with `{ onRefusal: 'notFound' }`, and the not-found signal propagates, on each. Source pins: the import **allow-list** (exactly the three modules; no `require(` or `import(`), and no `process.env` / `process[`. 50 tests (19 on `main`) |
| Route table (B-1; F-8 limits) | `testSurfaceRoutes.test.ts`: per-row and structural only, as agreed with the F-8 session (section 6): a `DEPLOYMENTS` table (production, a Vercel preview, local with no Vercel variables) and a `setEnv` helper after `saved`; the environment lines dropped from the top-level `beforeEach`; the two existing `describe` blocks became `describe.each(DEPLOYMENTS)` with their own `beforeEach`, their `it.each` bodies and assertions untouched, so the production row is A-1's assertions byte for byte; the "off production the gate does nothing" block removed; "on production" → "on every deployment" in header lines 3 and 6. Imports, mocks, `work` and `HANDLERS` (T-5 / T-6 rows included) untouched. 81 tests (36 on `main`) |
| Four route suites (F2-D5) | One inline `jest.mock('@/lib/security/testSurfaceGate', () => ({ testSurfaceRouteGate: async () => null }))` plus the comment naming `testSurfaceRoutes.test.ts` as the gate's owner. Assertions unchanged: analyze-prompt 3, v5-wrapper 5, execute-test 6, test-audit 6, all green |
| T-9 (B-2, B-3) | `requestLogger = logger.child({ correlationId })` built once; the gate, then `const admin = await requireAdmin(requestLogger); if (admin instanceof NextResponse) return admin;` directly after it, before `req.json()`. `userId: adminUserId` at all three call sites. The outer catch now logs `requestLogger.error({ err }, 'Direct generation failed')`, returns `error` and `validation.issues[0].message` as the constant `'Workflow generation failed'`, and `details` only behind exactly `process.env.NODE_ENV === 'development'`. `stableResponseEnvelope` passes `details` through. HTTP 200 kept (F2-D7). `debug` still holds lengths only (commented). The `enhanced_prompt is required` branch unchanged. `catch (err: any)` became `catch (err: unknown)` (one less `any`) |
| T-9 suite (B-2, B-3) | New `app/api/v6/test-direct-generation/__tests__/auth.test.ts`, 16 tests: on production, a preview and local, anonymous (404, one session read, no LLM call), non-admin (404, `admin_api` recorded, no LLM call), admin (two session reads; **all three call sites reached through `POST`**: the plan reply `{}` fails IR validation, which triggers the IR repair, and the mocked validator answers invalid, which triggers the Pilot repair; the three contexts are `semantic_plan`, `ir_repair`, `pilot_repair`, each with `userId` equal to the admin's id, and no `'system'` anywhere), a provider failure (the distinctive string absent from the **whole serialised body**, `details` absent, `debug` numbers only; logged once as exactly `{ err }` through the request logger, with a `correlationId` child; the prompt marker in no log line), a non-JSON body (generic error, no parse text); plus development (`details` carries the message and nothing else does). No internals exported. The logger mock is built inside its `jest.mock` factory because the route calls `createLogger` at import |
| Comments (F2-D9) | 7 gate comment sites in the 6 in-scope route files ("A 404 for anyone but an admin, on every deployment"; T-8's "every deployment runs both (SA N-6)"). Both layouts' headers and inline comments. In the `/test-business-os` layout the Slice 5b sentence "the harness is open to every signed-in account" (no longer true) was rewritten. `app/api/debug/**` untouched |
| G-9 (N-4) | Wording only: the header's G-9 line, the describe title, and the T-12 reason ("403 on every built deployment …; in `next dev` it needs a sign-in, not an admin, so it is NOT stricter than the gate there"; deletion candidate). The R1 floor line is untouched (N-5, F-8's). 114 tests before and after |
| Docs (B-5, N-7, N-8) | Admin doc: the `:267` paragraph (every deployment; the fail-closed sentence removed) plus a new paragraph (admin in the deployment's database; refusals off production recorded; on a preview sharing production's database they add to the Health refused-access tile, accepted); the `:274` sentence "rendered for admins only, on every deployment; the API routes are the boundary"; Last Updated; Change History. `BUSINESS_OS_TEST_PAGE_SCOPE.md` § Account Model rewritten as B-5 lists, the payment-hold note and the Billing line corrected, Last Updated, Change History. `V2_TEST_PAGE_SCOPE.md`: one access note. A-1 workplan: "OQ-6 (open)" relabelled as decided 2026-11-27, Last Updated bumped (N-7) |
| Mutation proofs (B-3) | Each mutated in place, run, then restored from a copy and checked with `cmp` (no `git stash`). **(1)** `if (process.env.VERCEL_ENV === 'preview') return null;` in the route gate: **23 red**: the 18 preview rows of the route table (anonymous and non-admin for all 9 handlers; T-9's own `requireAdmin` still refused, with a 401 instead of the 404), 4 preview rows of the unit test (admin, 401, 403, throw), and the "reads no environment variable" pin. **(2)** The page gate's early return put back (`!== 'production'`): **13 red**: the 12 page-gate rows on the 6 non-production deployments, and the same pin. Production rows stayed green in both, as they should. **(3)** The IR-repair site back to `userId: 'system'`: **3 red**, the attribution case on all three deployments. **(4)** `err.message` put back into `error`: **7 red**, the failure and non-JSON cases on all three deployments, and the development case |
| Suites (B-4) | Rerun green after the change: `testSurfaceGate` 50, `testSurfaceRoutes` 81, T-9 16, the four route suites 20, `envConfigHardening` 114 (G-9 and self-tests; count unchanged against `main`), `paymentHold` 39, `requireAdminPage` 23, `catalogueDrift` 26: **369 / 369**. `npm run test:authz-guard`: **203 / 203** |
| Full Jest gate (B-4) | Baseline: `git archive 05732d73` into the scratchpad with a junction to the shared `node_modules`: 28 failed suites. This branch: 36 failed suites. Deduplicated by suite name, **no new failure caused by F-2.** Of the 13 names that fail only on this branch, 11 are suites in `.github/ci/jest-quarantine.json` that the baseline run excluded but this worktree's run did not (the worktree's run also picked up `tests/plugins/integration-tests/`, which skip without credentials): the gate config's ignore patterns did not take effect from this worktree's path. That is a local-environment difference, not this slice; CI is unaffected. The other 2 (`PlanSection.prefetch.render`, `AdminAreaField.search`) were 5 s timeouts while the build ran alongside, and pass alone (31 / 31). 5 failures seen only in the baseline extract do not reproduce here (A-1's QA saw the same class: the extract has no `.git`; the rest are timing). `publicEndpointsAreThrottled.guard.test.ts` fails 3 cases in both runs (Windows paths, F-9; SA's baseline note) |
| Typecheck (B-4) | Full `tsc --noEmit -p tsconfig.json`, 8 GB heap, finished with no heap or OOM message (exit 2, 1846 repo-wide errors). **0 errors in any touched or new file.** The first run found one in the new unit test (TS1501, a regex `s` flag below the target); the flag was unnecessary and was removed, and the second run is clean |
| Build (B-4) | `npm run build` with the CI placeholder environment from `.github/workflows/build.yml`: **exit 0**, no OOM; `/test-business-os`, `/test-plugins-v2` and `/api/v6/test-direct-generation` built as dynamic. A first attempt without that environment stopped at page-data collection on an unrelated route needing a Supabase URL, as expected without placeholders |
| Test cost (N-2) | Same tree, `-i`, main's three files swapped in and restored by copy: `testSurfaceRoutes` sum of test durations 0.24–0.25 s (36 cases) on `main` → 0.39–0.44 s (81 cases) with F-2, about +0.17 s, roughly 4 ms per added case; suite wall time 3.9–5.7 s → 3.8–4.3 s (no measurable increase). `envConfigHardening` edits are wording only. On this machine wall time cannot resolve a sub-second change; the first Linux CI run is the reading that counts |

**Deviations from the plan.** None in behaviour. Three small ones in form: (a) the `/test-business-os` layout's Slice 5b sentence was rewritten as well as the A-1 paragraph, because it said the harness is open to every signed-in account; (b) `catch (err: any)` in T-9 became `catch (err: unknown)`; (c) the unit test's refusal rows put the status before the environment in each tuple, so the test title prints the status.

---

## 9. Test plan

All tests mock their seams. Nothing reaches the network (`tests/jest-no-network.ts`).

**1. `lib/security/__tests__/testSurfaceGate.test.ts`** (`requireAdmin` and `requireAdminPage` mocked, as today). One `DEPLOYMENTS` table: local or Jest (no `VERCEL`, no `VERCEL_ENV`); `VERCEL=1` with `preview`, `development` or `production`; `VERCEL_ENV=production` without `VERCEL` (the local `next start` probe); and on Vercel, `Production`, `''` and `staging`. For each deployment:

| Case | Expect |
|---|---|
| Route gate, admin | `null`; `requireAdmin` called with the logger |
| Route gate, a 401 or 403 refusal | JSON 404 `{ success: false, error: 'Not found' }` |
| Route gate, the admin check throws | JSON 404; `logger.error` once |
| Page gate, admin | returns; `requireAdminPage` called with `{ onRefusal: 'notFound' }` |
| Page gate, the `notFound()` signal | propagates unchanged (SA B-2) |

Plus the source assertion (F2-D4).

**2. `lib/security/__tests__/testSurfaceRoutes.test.ts`** (the real `requireAdmin`; seams as today). The three existing cases (anonymous, signed-in non-admin, admin) run on each of three deployments: production on Vercel, a preview, and local (no Vercel variables). That is 9 handlers × 3 cases × 3 deployments.
- Anonymous and non-admin: a JSON 404, one session read, and none of the route's own work.
- Non-admin: the refusal is recorded as `admin_api`.
- Admin: not the gate's 404.

The production row is A-1's assertions unchanged ("production is unchanged"). The preview and local rows are "a non-admin is refused off production, an admin passes".

**3. `app/api/v6/test-direct-generation/__tests__/auth.test.ts`** (new). Mocks: `@/lib/auth` (`getUser`), `@/lib/services/AdminAccessService` (`isAdmin`), `@/lib/audit/recordRefusedAccess`, `@/lib/services/AuditTrailService` (`tests/helpers/silentAuditTrail`), `@/lib/server/plugin-manager-v2` (`getAvailablePlugins` → `{}`), `@/lib/agentkit/v6/compiler/WorkflowPostValidator` (controllable `validate`), and the LLM seam `@/lib/ai/providerFactory` (`getProvider` → an object whose `chatCompletion` is a `jest.fn`). Run on production, a preview and local:

| Case | Expect |
|---|---|
| Anonymous | JSON 404; `chatCompletion` never called; one session read |
| Signed-in non-admin | JSON 404; `recordRefusedAccess` once with `surface: 'admin_api'`; `chatCompletion` never called |
| Admin passes the gate and the route's own check | Two session reads. The fixture reaches all three call sites: the plan reply fails IR validation, which triggers the IR repair, and the validator mock answers invalid, which triggers the Pilot repair. `chatCompletion` is called 3 times, and every context has `userId === ADMIN.id`; none has `'system'` |
| Provider rejects with an error carrying a distinctive string | Status 200; `success: false`; `error` is the generic message. With `NODE_ENV` not `development`, the distinctive string is nowhere in the body and `details` is absent. With `NODE_ENV=development`, `details` carries it |
| A body that is not JSON | The same generic error; the parse message only in `details`, in development |

If a call site turns out to be unreachable through the route with mocked seams, Dev reports it rather than exporting internals.

**4. The four route suites** (F2-D5). Each gains the gate mock, and its assertions are unchanged: analyze-prompt 3, v5-wrapper 5, execute-test 6, test-audit 6.

**5. Unchanged, rerun and green:** `paymentHold.test.ts`, `envConfigHardening.guard.test.ts` (G-9 and self-tests; the count stays 97), `requireAdminPage.test.ts`, `catalogueDrift.guard.test.ts`, `npm run test:authz-guard`.

**6. Mutation proof** (each must go red, then be restored from a copy):
- an early `return null` added to the route gate when `VERCEL_ENV === 'preview'`: the testSurfaceGate and testSurfaceRoutes preview rows go red, and so does the F2-D4 source assertion;
- the page gate's early return restored: the page-gate rows go red;
- one T-9 id put back to `'system'`: the T-9 attribution case goes red;
- `err?.message` put back into `error`: the T-9 error case goes red.

**7. QA probe** (command line only, no click-through: the parked-app rule). `next build`, then `next start` with no session, in three modes: `VERCEL=1 VERCEL_ENV=production`, `VERCEL=1 VERCEL_ENV=preview`, and no Vercel variables.
- In every mode: both pages answer 200 with `noindex` and **without** their harness marker; T-3 and T-9 (no body) answer the JSON 404; an unknown path answers 404.
- The production mode repeats A-1's FR-3 and must match it.
- The preview mode is the row that flips against A-1's FR-3, where the marker was present. That flip is what lets this probe fail.

Record `envConfigHardening.guard.test.ts` time against `main`. It should not move: the edits are wording only.

---

## 10. Observed, out of scope

| # | Observation | Proposed owner |
|---|---|---|
| FU-1 | T-9 has no caller left in the repository (section 2). It is a candidate for deletion, like T-7 (A-1 N-9). **Decided by the user (2026-11-27): delete `app/api/v6/test-direct-generation/route.ts` in a later follow-up slice, not in F-2.** Because T-9 is being deleted, no Zod slice for it is owed (SA N-9 is settled by this decision) | Follow-up slice (TL) |
| FU-2 | T-9 hardcodes its model name in its three calls (`:730`, `:772`, `:828`) and three response labels (`:860`, `:882`, `:903`), against CLAUDE.md rule 5. It also has no Zod validation of its body (rule 2), and many untyped `any` without a comment (rule 6). All predate A-1. With FU-1, deleting the route would retire all three | With FU-1 |
| FU-3 | `/test-business-os`'s in-app sign-in is now unreachable on every deployment (A-1 F-7, widened) | Test-page owner |
| FU-4 | The A-1 inventory says T-12 answers 404 outside development. It answers 403. Only G-9's reason text is corrected here; the A-1 §5 row is left as the historical record | Recorded here |
| FU-5 | T-5 and T-6 keep their "a no-op elsewhere" comments until F-8 deletes the files. If F-8 is dropped, those comments need the F2-D9 wording | F-8 session |
| FU-6 | T-12 (`app/api/website/analytics/test/route.ts`) has no caller. It answers 403 on every built deployment, and in `next dev` it needs a sign-in, not an admin. It stays exempt from the gate (F2-D10); its G-9 reason now says this (SA N-4). A deletion candidate | TL |

---

## 11. Risks and rollback

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A tester is locked out of the harness locally or on a preview (C-2, C-3, C-4) | The admin precondition is stated in the test-page docs. F2-D11 goes to the user before the merge |
| R-2 | A test elsewhere reaches a gated handler and was not found | Section 5 C-6 is from a repository-wide search for imports of the gate module, the gated routes and the layouts. The full Jest gate is run before the hand-over |
| R-3 | Merge conflicts with F-8 | Section 6, including the F-8 session's confirmed edit list: F-2's edits to `testSurfaceRoutes.test.ts` are per-row and structural, and the T-5 / T-6 rows stay as on `main`. All mechanical |
| R-4 | Shared `node_modules` junction, shared stash list | No `npm install`, no `git stash` |

**Rollback:** revert the PR. The surface reopens off production exactly as A-1 left it. Nothing in the environment or the database changes, so nothing else needs undoing. T-9 rows already recorded against an admin's id stay as they are; they are cost records, not grants.

---

## 12. SA Review Notes

**Reviewed by SA, 2026-11-27, on `05732d73` in this worktree (workplan review; no code yet).**
**Status:** ✅ Approved with conditions. Dev may start now. Code approval needs B-1 to B-5. The merge also needs B-6, the user's acknowledgment of C-1 and C-2.

### Verification of Dev's facts

I re-read each claim against the source. Each one holds:

- **The gate.** `isTestSurfaceClosed()` is at `testSurfaceGate.ts:70-77`, with the two early returns at `:100` and `:126`. `isProductionDeployment` is imported only for the predicate. Outside the gate and its own unit test, no code or test imports the predicate. Two workplans mention it.
- **Layouts and handlers.** The layout and handler comments are as quoted. The 9 handlers and 2 layouts call the gate exactly as listed. Deleting the early returns changes no caller and no G-9 rule: R2 and R3 are source checks on the call and the first `await`, and none of them names the predicate.
- **The drift guard (A-1 N-3) stays green.** `VERCEL` is still read at `lib/utils/origins.ts:118`. `VERCEL_ENV` is still read in `app/api/run-agent/route.ts`, `lib/cron/cronAuth.ts`, `lib/cron/cronRunRecorder.ts`, `lib/utils/deploymentEnvironment.ts` and `lib/utils/origins.ts`. Neither catalogue row names the gate, and the guard pins no site in `lib/security/`. No catalogue edit is needed. I ran `catalogueDrift.guard.test.ts` on the baseline: it passes.
- **Attribution (F2-D8).**
  - `CallContext.userId` is a plain `string` (`baseProvider.ts:7`).
  - `trackAICall` keeps a valid UUID and sends anything else to `platformAccountId()` with a warning (`aiAnalytics.ts:128-138`). So `'system'` lands on the platform account today, and the admin's id from `requireAdmin` is a UUID that will be kept.
  - `notifyUsage` returns at once outside a usage scope, and T-9 opens none, so no credits are charged.
  - The only trigger on `token_usage` is the `updated_at` one.
  - One more fact Dev did not state, and it matters for C-9: the nightly Business OS credit leak check reads only rows that match `bosRowFilter()` (the `business-os` prefix plus the legacy Business OS values). `v6_test` is not one of them, so the moved rows will **not** flag the admin's account as a leak.
- **Suites that assume an open gate (C-6).** The four route suites that reach a gated handler are the ones listed, with the case counts given (3, 5, 6, 6). The failure Dev predicts for each is right. Nothing else imports a gated route or a layout, except the source checks Dev names.
- **T-9 has no caller.** The only other mention is a comment in `lib/agentkit/v6/compiler/PilotNormalizer.ts:4`.
- **T-12** answers **403** whenever `NODE_ENV !== 'development'` (`:19-24`). In `next dev` it needs a session, not an admin. Nothing calls it.
- **Newer `main`.** `origin/main` has moved past `05732d73` (#695, #696). Neither change touches a file this slice touches.
- **Baseline note for QA.** In this worktree, on `05732d73`, `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` already fails 3 cases. This slice did not cause them. Compare against `main`; do not count them as F-2 failures.

### Rule 7 (new patterns) and the admin source

- **No new pattern.** Each piece of the slice has a precedent:
  - deleting an environment branch from an existing gate;
  - a second `requireAdmin` on a test route (T-8, A-1 N-6);
  - `jest.mock` of a module seam;
  - a source assertion inside a unit test;
  - `details` behind the `NODE_ENV === 'development'` guard (the project error format).

  The only new pattern in sight is F2-D11 (b), an exception for non-admin accounts. Dev correctly declines it.
- **Admin identity comes only from `requireAdmin` / `requireAdminPage`.** Both go through `AdminAccessService` (`admin_users`, plus the established `ADMIN_EMAILS` bootstrap). I searched the gate, both layouts, T-3 to T-10 and both admin gates for `profiles.role`, `app_metadata` and role comparisons. The only hits are the "never `profiles.role`" warnings in comments, and chat-message `msg.role` styling in the plugin tester. No `route.ts` gains an `AdminAccessService` import, so the required admin guard's R2 rule is not engaged.

### Rulings per decision

| # | Ruling |
|---|---|
| F2-D1 | ✅ **(a), the shared gate.** The gate exists so this rule has one home. Option (b) would edit 9 handlers and 2 layouts, and would collide with F-8 in T-5 / T-6. Without an edit, T-5 and T-6 pick up the rule through the gate. That is not "gating them twice". |
| F2-D2 | ✅ **(a), the same refusal everywhere.** It leaves no environment branch to drift, and production's rows stay byte-identical. The server log already gives a refused developer the reason. |
| F2-D3 | ✅ **(a), delete it.** The fail-closed intent of A-1 D-10 is met more strongly: no `VERCEL_ENV` value can open the surface, because nothing reads one. N-3 becomes moot; the drift guard was checked above. |
| F2-D4 | ✅ **(a), in the unit test, not G-9**, with N-1 (an import allow-list instead of a deny-list). |
| F2-D5 | ✅ **(a), mock the gate to admit in the four route suites.** The gate's behaviour on every handler stays proven by `testSurfaceRoutes.test.ts` with the real `requireAdmin`. Its presence and its place as the first `await` stay proven by G-9 R2. The routes' own 401/403 layers stay tested. Option (b) would delete those tests. Each mock carries the one-line comment naming `testSurfaceRoutes.test.ts` as the gate's owner. |
| F2-D6 | ✅ **(a)**, as approved and as T-8. It must sit directly after the gate, before `req.json()` and before any other work (B-2). |
| F2-D7 | ✅ **(a), keep HTTP 200.** The scope asks for the format, not a status change, and the route's header contract is deliberate. The fields are `success: false`, a generic `error`, and `details` only in development. B-2 applies. |
| F2-D8 | ✅ **(a), in this slice.** It is three literals through an existing string field, with no factory change, so it is not "a bigger change". The verified effects are in C-9, plus the leak-check fact above. |
| F2-D9 | ✅ **(a).** Comments only, in the 6 files that are in scope. T-5 / T-6 stay with F-8 (FU-5). |
| F2-D10 | ✅ **(a), keep T-12 exempt.** It is not in the approved T-3 to T-10 list. The new reason text must be honest, per N-4. |
| F2-D11 | ✅ **(a)**, with the C-2 ruling below, B-5 and B-6. A test account is **never** added to `admin_users`: an admin can see across tenants, and a test account's password is shared. |
| F2-D12 | ✅ **(a).** Build as approved. TL puts FU-1 to the user together with C-2 (N-9). |
| F2-D13 | ✅ No ordering constraint. Section 6's conflicts are mechanical. N-5 applies. |

### The C-2 ruling

**C-2 is a consequence of the approved scope, not a change to it. The build does not wait for it. The merge does.**

- **Why it is not a scope change.** The user approved "admin-only on every non-production deployment (Preview, staging, `next dev`, local `next start`)" and "the testers are admins only". He named `next dev`. Nothing inside that wording keeps the test-account flows working. Keeping them would need an exception for non-admin accounts, which is new scope, a new pattern and an environment branch: exactly what F2-D2 removes. Asking him "which way?" before the build would put a technical fork to him that his approval has already settled.
- **Why he must still see it before the merge.** He probably did not see this effect. The harness's account model is "log in as the account you want to test" (`BUSINESS_OS_TEST_PAGE_SCOPE.md` § Account Model). From F-2, every session-scoped tab acts on **the signed-in admin's own account**:
  - Account setup;
  - Modules;
  - Billing, which changes the account's plan;
  - "Grant Free Tier to Me";
  - the Danger Zone's reset and purge preview.

  So the flows that need a separate test account can no longer be run through the harness. Running them as an admin changes the admin's own data. That is a real loss of capability for him and for Offir, and it can surprise someone. This is the same kind of decision as A-1 D-17 / OQ-4, which the user confirmed in the PR conversation before merge.
- **What TL does.** Now, while Dev builds, TL sends the user one plain paragraph: C-1 (the in-app sign-in is gone), C-2 (as above), and C-3 / C-4 (each admin must be an admin in the database they test against). It is not a fork. If he asks for an exception, that goes back through BA → SA as new scope, and he decides whether F-2 ships as approved first or waits. The PR does not merge without his acknowledgment (B-6).

### Blocking conditions

**Before code approval:**

- **B-1. Production is unchanged, and the tests show it.**
  - In `testSurfaceGate.test.ts` and `testSurfaceRoutes.test.ts`, the production rows keep A-1's assertions unchanged: status, body, exactly one `getUser` call, `isAdmin` not called for an anonymous caller, `recordRefusedAccess` once with `admin_api` for a non-admin, and `noWorkRan()`.
  - The preview and local rows make the same assertions. That is the case "a non-admin is refused off production".
  - QA's production-mode probe (§9 item 7) matches A-1's FR-3 row by row.
  - The preview and no-Vercel modes must show the harness marker **absent**. That flipped row is what makes the probe able to fail.
- **B-2. T-9's order and error format.**
  - `requireAdmin` runs directly after the gate, before `req.json()` and before anything else.
  - Outside development, the catch puts no error text in **any** field: `error`, `validation.issues`, `details`, and `debug` (which must keep holding only lengths).
  - `details` sits behind exactly `process.env.NODE_ENV === 'development'`.
  - The test asserts that the distinctive string is absent from the **whole serialised body**, not just from `error`.
  - The catch logs `{ err }` through `requestLogger`, which carries the `correlationId`. The prompt or body never goes into the log.
  - The `enhanced_prompt is required` branch stays as it is.
- **B-3. Attribution is proven through the route.**
  - All three call sites are reached through `POST` with the seams mocked. Every `CallContext.userId` equals the admin's id, and none is `'system'`.
  - If a call site cannot be reached that way, Dev stops and returns to SA. No internals are exported for the test.
  - The four mutation proofs in §9 item 6 are run (red, then restored from a copy, never `git stash`). Their results are written in the workplan.
- **B-4. The gate's contracts and the neighbouring suites stay intact.**
  - `testSurfacePageGate` stays un-wrapped (A-1 B-2). `testSurfaceRouteGate` keeps its try/catch and its log. Both signatures and return shapes are unchanged.
  - These suites are rerun and green: G-9 and its self-tests (test count unchanged against `main`), `npm run test:authz-guard`, `catalogueDrift`, `paymentHold`, `requireAdminPage`, the four route suites (assertions unchanged), and the new T-9 suite.
  - The full Jest gate shows no new failure against `main`, deduplicated (each FAIL prints twice).
  - Typecheck is clean for the touched files, and `npm run build` succeeds without an OOM.
- **B-5. The docs keep A-1 B-1's wording, and say what C-2 means.**
  - For the pages, the wording is "rendered for admins only, on every deployment; the API routes are the boundary". Never "the pages are admin-only".
  - In `ADMIN_IDENTIFICATION_AND_ACCESS.md`, that applies to `:274` as well as the `:267` paragraph. The fail-closed sentence goes, as Dev proposes.
  - `BUSINESS_OS_TEST_PAGE_SCOPE.md` § Account Model is rewritten:
    - the session-scoped tabs act on the signed-in admin's own account;
    - a flow that needs a test account runs through the product (Settings → Plan, onboarding);
    - a test account is never added to `admin_users`.
  - The Billing section's "use a designated test account only" line is corrected to match.

**Before merge:**

- **B-6. The user has acknowledged C-1 and C-2** (with the C-3 / C-4 preconditions) in the PR conversation, per the C-2 ruling above.

### Non-blocking conditions

- **N-1. F2-D4: an allow-list of imports, not a deny-list.** The gate's only imports are `next/server`, `@/lib/admin/requireAdminRoute` and `@/lib/admin/requireAdminPage`, and it contains no `process.env`. Forbidding only `deploymentEnvironment` would miss `origins.ts`'s `vercelEnv()` or any new helper. This assertion stays in the unit test.
- **N-2. Test cost.** `testSurfaceRoutes.test.ts` grows to 9 × 3 × 3 cases. Record its time before and after alongside the `envConfigHardening` timing (the no-added-CI-time rule). Each case should cost milliseconds. If it does not, run local and preview only for the non-admin cases and keep production in full.
- **N-3. Stale text in the gate.**
  - Update the `testSurfacePageGate` JSDoc ("or where the surface is open").
  - In the "WHAT IT GUARDS" header, the clause "one spends LLM money attributed to the platform" becomes false with F2-D8. Change that one clause to the past tense in F-2, because it is F-2's fact. A mechanical conflict with F-8 is acceptable.
- **N-4. T-12's reason text.** It must say what is now true: a 403 on every built deployment (Vercel and a local `next start` both build with `NODE_ENV=production`), and in `next dev` a sign-in but **not** an admin. So it is no longer "stricter than the gate". Also add T-12 to section 10 as a deletion candidate: nothing calls it.
- **N-5. F-8 hand-off (TL).** F-8 lowers the G-9 R1 route floor at `:673` from 13 to 11, and F-2 does not touch that line. If F-8 is dropped, T-5 / T-6 need the F2-D9 comment wording (FU-5).
- **N-6. The C-3 / C-4 preconditions, checked before merge.** A read-only check (by QA or TL) that Barak and Offir resolve as admins in each database the harness is used against. Prefer an `admin_users` row to `ADMIN_EMAILS`. If a row is missing, adding it is a data change that grants admin. It goes through DO and `env-change-protocol`, not this PR.
- **N-7. A-1 workplan pointers.** The edits at §16.1 OQ-6, §19 F-2 and the Change History are correct and pointer-only. Also:
  - relabel the row "OQ-6 (open)" as decided (2026-11-27);
  - bump that file's `Last Updated` (it still reads 2026-11-26, although it has 2026-11-27 entries).
- **N-8. C-5.** If a preview shares a database with production, developers' refusals on previews now add to the refused-access tile on the admin Health landing. Accepted. Say so in one sentence of the admin doc.
- **N-9. FU-1 / FU-2 are debt that needs a decision; this approval does not cover them.** T-9 still has no Zod validation on its body (CLAUDE.md rule 2) and hardcodes its model name (rule 5). Both predate A-1. F-2 adds no input path, and the route becomes reachable by admins only, so F-2 does not block on them. TL puts FU-1 (delete T-9) to the user together with C-2. If he keeps T-9, a Zod slice for it is owed and is not optional.

### Optimisation suggestions

- T-9 builds `requestLogger` once and passes it to both the gate and `requireAdmin`, as T-8 does. That is already in 3.4.
- In the four route suites, keep the gate mock inline (one `jest.mock` line plus the comment). A shared helper in `tests/helpers/` would add an indirection for one line.

### Approval

[x] Workplan approved. Proceed to implementation under B-1 to B-5. B-6 gates the merge.

---

**Code Review by SA, 2026-11-28, on the working tree against `05732d73` (20 modified files, plus the new T-9 suite and this workplan).**
**Status:** ✅ Code approved for QA. B-6 (the user acknowledges C-1 and C-2) still gates the merge.

### What I checked myself

- **The gate (`lib/security/testSurfaceGate.ts`).**
  - The predicate, both early returns and the `deploymentEnvironment` import are gone. No environment is read anywhere.
  - `testSurfaceRouteGate` keeps its try/catch and its `logger.error`. `testSurfacePageGate` is a single unwrapped `await requireAdminPage({ onRefusal: 'notFound' })` (A-1 B-2).
  - Names, signatures and return shapes are unchanged. The header and JSDoc were updated per N-3, and "spent" is now past tense.
- **T-9 (`app/api/v6/test-direct-generation/route.ts`).**
  - The order is `requestLogger`, then the gate, then `requireAdmin(requestLogger)` with an early return, before `const debug` and before `req.json()`.
  - `adminUserId` is used at all three `CallContext` sites.
  - The catch:
    - logs `requestLogger.error({ err }, 'Direct generation failed')`;
    - puts the constant message in both `error` and `validation.issues[0].message`;
    - sets `details` only behind exactly `process.env.NODE_ENV === 'development'`;
    - keeps HTTP 200 (F2-D7).
  - `debug` holds lengths only. The `enhanced_prompt is required` branch is unchanged. `catch (err: unknown)` removes one `any`. B-2 is met.
- **The T-9 suite.** It runs the real gate and the real `requireAdmin` on three deployments.
  - All three call sites are reached through `POST`. The three contexts carry the admin's id in the activity order `semantic_plan`, `ir_repair`, `pilot_repair`, and none says `'system'`.
  - The failure case checks the **whole serialised body** for both the failure marker and the prompt marker. It also checks that the log call's context is exactly `{ err }`, and that no log line carries the prompt.
  - The development case checks that the message appears only in `details`.
  - No internals are exported. B-3 is met.
- **`testSurfaceRoutes.test.ts`.** The changes are structural only:
  - a `DEPLOYMENTS` table plus `setEnv`;
  - the two existing blocks wrapped in `describe.each`, with their `it.each` bodies byte-identical (so the production row keeps A-1's assertions);
  - the "does nothing" block removed.

  Imports, mocks, `work` and `HANDLERS` (the T-5 / T-6 rows included) are untouched, which keeps F-8's rebase clean. B-1 is met in Jest; QA's probe covers the rest.
- **`testSurfaceGate.test.ts`.** The 8-shape deployment table covers every case, plus an import allow-list and a no-`process.env` pin (N-1 met).
- **The four route suites.** Each has one inline `jest.mock('@/lib/security/testSurfaceGate', …)` that admits, with the comment naming the gate's owner. The assertions are unchanged (F2-D5).
- **Comments.** The 7 sites in the 6 in-scope route files and both layouts are updated. `app/api/debug/**` is untouched.
- **G-9.** Only the wording changed: the header line, the describe title and an honest T-12 reason (N-4). The R1 floor line is left for F-8 (N-5).
- **Docs (B-5 met).**
  - Admin doc `:267`, the new paragraph (N-8), and `:274` all use the A-1 B-1 wording: "rendered for admins only, on every deployment; the API routes are the boundary".
  - `BUSINESS_OS_TEST_PAGE_SCOPE.md` § Account Model covers each point B-5 lists, and the Billing line is corrected.
  - The `V2_TEST_PAGE_SCOPE.md` note is in place.
  - A-1 workplan: OQ-6 is relabelled and its Last Updated is bumped (N-7).
- **Admin source.** There is no `profiles.role` and no `app_metadata`. No `route.ts` gains an `AdminAccessService` import. There are 0 `console.*` calls in the touched files.
- **Reruns.** I reran the 11 affected suites: **369 / 369**. `npm run test:authz-guard` gave **203 / 203**.
- **Dev's explanation of the full-gate failures holds.** I verified it directly. From this worktree, `jest --config jest.gate.config.js --listTests` **lists all 11 quarantined suites and 11 `tests/plugins/integration-tests/` files** that the gate config is meant to ignore. The cause is the Windows worktree path rather than F-2. The ignore patterns are `<rootDir>/…` strings. On Windows, Jest's separator conversion treats the `\.` in `…\neuronforge\.claude\worktrees\…` as an escaped dot, so the pattern no longer matches the real path. The `git archive` baseline in the scratchpad has no `.claude` segment, so it excluded them. CI runs on Linux and is unaffected. The 11 branch-only failures Dev attributes to this are exactly the 11 quarantine entries.
- **Not rerun by me:** the full `tsc` (8 GB heap) and `npm run build`. I accept Dev's report (0 errors in touched files, build exit 0, no OOM). QA's build for the probe re-confirms the build.

### Code Review Comments

None blocking.

1. `lib/security/__tests__/testSurfaceGate.test.ts`, the import allow-list pin. The regex captures single-quoted specifiers in `import … from '…'` only. A double-quoted import, a bare side-effect `import '…'`, or an `export … from` would not be checked. The no-`process.env` pin still catches a direct read in the gate, so the gap is narrow: a helper that reads the environment, imported with double quotes. Suggest matching `['"]` and adding the bare-import form. Priority: Low.
2. `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md` and `docs/V2_TEST_PAGE_SCOPE.md` callout headings ("Admins only, everywhere" / "Admins only, on every deployment"). A-1 B-1 asked never to call the pages "admin-only", and the bodies do say "rendered for admins only… the API routes are the boundary". For consistency, the headings could read "Rendered for admins only…". Priority: Low.
3. `lib/__tests__/envConfigHardening.guard.test.ts:24-25`. The rewritten G-9 header line runs well past the block's wrap width. Cosmetic. Priority: Low.
4. T-9 suite: the non-JSON body case is asserted outside development only. The development case covers the provider error, not the parse error. That is adequate, because both go through one `details` expression. Priority: Low, no action needed.

### Optimisation Suggestions

- The Windows worktree ignore-pattern finding is worth a short note in the Jest gate's docs or memory, so the next full-gate comparison run from a `.claude/worktrees/*` checkout does not misread the 11 + 11 extra suites. It belongs to the CI-tooling owner, not this slice.

### Code Approved for QA: Yes

QA runs the §9 item 7 probe (production, preview and no-Vercel modes). Before merge: N-6 (a read-only admin check of each database used) and B-6.

---

## 13. QA Testing Report

**QA, 2026-11-28, on the uncommitted working tree of `fix/prod-1c-f2-admin-only-test-surfaces` (base `05732d73`), after SA's code review and TL's three Low edits.** No source file changed after the build began; only this workplan did.
**Test mode:** full
**Strategy used:** A/B (Jest: the 11 affected suites and the required admin guard, mocked seams, no network) + C (command-line HTTP probes, no cookies, against a local `next start` of this branch **and** of the `05732d73` baseline, in all three §9 item 7 modes). The probe is what Jest cannot prove: the built pages and routes on a real server
**Focus:** security, api
**Skipped:** D (click-through). The app is parked for manual tests; the brief asked for command-line probes. An admin-session live probe was not run (C-7: it needs a session cookie); the admin path is covered in Jest. The full `tsc` and the full Jest gate were not rerun by QA (Dev ran both; SA verified the gate explanation); the build below re-confirms the build
**Input source:** prompt keywords (TL brief) + workplan §9

### TL's post-review edits (SA Low comments 1 to 3), recorded

| # | Edit | QA check |
|---|---|---|
| 1 | `lib/security/__tests__/testSurfaceGate.test.ts`: the import allow-list regex now matches either quote, a bare `import '…'`, and `export * from` / `export * as x from` / `export { … } from` | ✅ Suite green (50). Exercised the regex outside the repo against the gate's real source with one line injected each time: a double-quoted import, a bare side-effect import, `export * from`, and a double-quoted `export { … } from` all turn the allow-list **red**; the unmodified source passes. One form it does not see: `export type { … } from '…'`. That is erased at compile time and cannot read the environment at runtime, so it is not a gap in what the pin protects (no action) |
| 2 | `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md:50` "Rendered for admins only, everywhere (…)", `docs/V2_TEST_PAGE_SCOPE.md:11` "Rendered for admins only, on every deployment (…)" | ✅ Both headings read "Rendered for admins only…"; no "admin-only pages" wording left in either callout (A-1 B-1) |
| 3 | `lib/__tests__/envConfigHardening.guard.test.ts:24-27`: the G-9 header lines rewrapped | ✅ Wording only; suite green, 114 tests (count unchanged) |

### Build

`next build` with the CI placeholder env from `.github/workflows/build.yml` (`.invalid` hosts, `ci-not-a-real-key` values, `NODE_OPTIONS=--max-old-space-size=6144`). No `.env.local` in the worktree.

| Tree | Exit | Time | OOM / heap / V8 stack | Notes |
|---|---|---|---|---|
| This branch (worktree) | **0** | 430 s | none | `Compiled successfully`; route table lists `ƒ /test-business-os`, `ƒ /test-plugins-v2`, `ƒ /api/v6/test-direct-generation` as dynamic. Error-level lines are only the known `DYNAMIC_SERVER_USAGE` ones from admin pages during page-data collection |
| Baseline `05732d73` (`git archive` into the scratchpad, `node_modules` junctioned to the shared folder, junction removed afterwards with `rmdir`, shared folder checked intact) | 0 | 660 s | none | For the "before" column only |

### §9 item 7 probe: before and after

Cookie-less `curl` against `next start` on a free local port (3917 branch, 3918 baseline), with the placeholder env plus the mode's Vercel variables. Each server was started by QA, its listening PID read from `netstat`, its command line checked (`node … next start -p <port>`), stopped by that PID with `taskkill /PID`, and the port confirmed free afterwards. Never by image name.

**Markers:** each page's `<h1>`, `Business OS Testing Interface` / `Plugin System Testing Interface` (the A-1 FR-3 markers). `noindex` = the `<meta name="robots" content="noindex"` tag. "JSON 404" = 404, `application/json`, body exactly `{"success":false,"error":"Not found"}`.

| Surface | Production (`VERCEL=1 VERCEL_ENV=production`) before → after | Preview (`VERCEL=1 VERCEL_ENV=preview`) before → after | No Vercel variables before → after |
|---|---|---|---|
| `GET /test-business-os` | 200 noindex 1 marker 0 → **200 noindex 1 marker 0** | 200 noindex 0 **marker 1** → **200 noindex 1 marker 0** | 200 noindex 0 **marker 1** → **200 noindex 1 marker 0** |
| `GET /test-plugins-v2` | 200 noindex 1 marker 0 → **200 noindex 1 marker 0** | 200 noindex 0 **marker 1** → **200 noindex 1 marker 0** | 200 noindex 0 **marker 1** → **200 noindex 1 marker 0** |
| T-3 `POST /api/test/analyze-prompt` `{}` | JSON 404 → JSON 404 | 401 (its own) → **JSON 404** | 401 → **JSON 404** |
| T-4 `POST /api/test/generate-agent-v5-test-wrapper` `{}` | JSON 404 → JSON 404 | 401 → **JSON 404** | 401 → **JSON 404** |
| T-5 `POST /api/debug/control` `{}` (via the gate, file untouched) | JSON 404 → JSON 404 | 400 (its own) → **JSON 404** | 400 → **JSON 404** |
| T-6 `GET /api/debug/stream?runId=probe` (via the gate, file untouched) | JSON 404 → JSON 404 | 500 (F-8) → **JSON 404** | 500 → **JSON 404** |
| T-7 `GET /api/v2/debug/data-check` | JSON 404 → JSON 404 | 200 (its own body) → **JSON 404** | 200 → **JSON 404** |
| T-8 `POST /api/v6/execute-test` `{}` | JSON 404 → JSON 404 | 401 → **JSON 404** | 401 → **JSON 404** |
| T-8 `OPTIONS /api/v6/execute-test` | JSON 404 → JSON 404 | 200 → **JSON 404** (C-8) | 200 → **JSON 404** |
| T-9 `POST /api/v6/test-direct-generation` (no body) | JSON 404 → JSON 404 | 200 with the raw parse text in `issues[].message` → **JSON 404** | the same → **JSON 404** |
| T-10 `POST /api/plugins/test-audit` `{}` | JSON 404 → JSON 404 | 400 (its own) → **JSON 404** | 400 → **JSON 404** |
| Unknown path `GET /zz-qa-no-such-path-probe` | HTML 404 → HTML 404 | HTML 404 → HTML 404 | HTML 404 → HTML 404 |

Every page response in the "after" columns also carries the `NEXT_NOT_FOUND` digest (2 per page) and neither page's marker; the "before" preview / no-Vercel pages carry neither `noindex` nor the digest.

- **Production is unchanged:** the production column is identical before and after, and matches A-1's FR-3 row by row (A-1 workplan §21).
- **The probe could fail:** the baseline preview row reproduces A-1's FR-3 preview control (both markers present, T-3 401, T-9 failing at the parse with its own text). With F-2 every one of those rows flips to the refusal, in both off-production modes. That is C-7 / B-1's flipped row, observed on the built server, not only in Jest.
- **Not reachable locally:** a true Vercel preview host, and a request carrying an admin session (C-7). The `VERCEL` / `VERCEL_ENV` pair is what the old predicate read, so the local modes exercise the same branch a preview took; the admin path is Jest-only by design.

### Jest

| Command | Result |
|---|---|
| `npx jest --ci` on the 11 affected suites: `testSurfaceGate`, `testSurfaceRoutes`, T-9 `auth.test`, the four route suites (analyze-prompt, v5-wrapper, execute-test, test-audit), `envConfigHardening.guard`, `paymentHold`, `requireAdminPage`, `catalogueDrift.guard` | **11 / 11 suites, 369 / 369 tests**, 29.7 s (matches Dev and SA) |
| `npm run test:authz-guard` | **2 / 2 suites, 203 / 203 tests** (matches Dev and SA) |

Known noise, not F-2's: `publicEndpointsAreThrottled.guard.test.ts` fails 3 cases on `main` too (F-9). From this `.claude\worktrees` path on Windows, the gate config's ignore patterns do not apply, so quarantined and integration suites run locally (SA's §12 finding). Neither was counted.

### Test coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| T-9: anonymous refused | ✅ | Pass | Jest on 3 deployments: JSON 404, one session read, no LLM call. Probe: JSON 404 in all 3 modes |
| T-9: non-admin refused | ✅ | Pass | Jest on 3 deployments: JSON 404, `admin_api` refusal recorded, no LLM call |
| T-9: admin passes the gate and its own `requireAdmin` | ✅ | Pass | Jest: two session reads, status 200, the route's own work runs. Source: `requireAdmin` sits directly after the gate, before `req.json()` |
| T-9: no `err.message` outside development | ✅ | Pass | Jest: provider failure and non-JSON body give the constant `Workflow generation failed`, the marker absent from the whole serialised body, no `details`, `debug` numeric only; development puts the message in `details` only. Probe (before): the baseline returned the raw parse text off production, so the change is visible |
| T-9: LLM calls attributed to the admin's id | ✅ | Pass | Jest: all three call sites reached through `POST` (`semantic_plan`, `ir_repair`, `pilot_repair`), each `userId` = the admin's id, no `'system'` |
| `/test-plugins-v2`, `/test-business-os`: non-admin refused off production | ✅ | Pass | Probe: preview and no-Vercel modes, cookie-less: 200, `noindex`, not-found digest, no marker (before: marker present). Jest unit table: page gate calls `requireAdminPage({ onRefusal: 'notFound' })` and lets `notFound()` unwind on 8 deployment shapes |
| Pages: admin passes | ✅ | Pass (Jest only) | Unit table: the page gate returns for an admin on every shape. No admin-session live probe (C-7) |
| Pages: production unchanged (not-found + `noindex` + no content, HTTP 200, F-10) | ✅ | Pass | Probe production column identical before and after, and equal to A-1 FR-3 |
| Payment hold still runs after the gate on `/test-business-os` | ✅ | Pass | `paymentHold.test.ts` pins the layout's first statement `await testSurfacePageGate()` and second `await redirectIfAwaitingPayment()` (green); source read confirms |
| T-3, T-4, T-7, T-8 (POST and OPTIONS), T-9, T-10: non-admin refused off production | ✅ | Pass | Jest `testSurfaceRoutes` (real `requireAdmin`), anonymous and non-admin on preview and local, JSON 404 with no route work. Probe: JSON 404 in preview and no-Vercel modes for every one (before: each route's own answer) |
| The same routes: admin passes | ✅ | Pass (Jest only) | `testSurfaceRoutes` admin rows on all 3 deployments: not the gate's 404, no refusal recorded |
| The same routes: production unchanged (JSON 404) | ✅ | Pass | Jest production rows keep A-1's assertions; probe production column identical before and after |
| T-5, T-6 pick up the rule without an edit | ✅ | Pass | Probe: JSON 404 in all 3 modes after (before: 400 / 500 off production). `git diff` shows no change under `app/api/debug/**` |
| Happy path + at least one failure path per surface (CLAUDE.md) | ✅ | Pass | Every gated route and the page gate: admin pass + anonymous + non-admin (Jest); T-9 adds provider-failure and bad-body paths |
| No test reaches the network | ✅ | Pass | All suites green under `tests/jest-no-network.ts`; the live probes are not Jest and hit only loopback (the placeholder Supabase host is `.invalid`) |
| `npm run build` succeeds, no OOM | ✅ | Pass | 430 s, exit 0 |
| 0 `console.*` in touched files; no entitlements import | ✅ | Pass | 0 in each of the 17 touched or new `.ts`/`.tsx` files; no import from `lib/business-os/entitlements/`, so `test:bos-entitlements` is not engaged |

### Issues found

#### Bugs (must fix before commit)

None.

#### Performance issues (should fix)

None. The suites' times are in line with Dev's §8.1 figures; the CI timing reading stays the first Linux run (N-2).

#### Edge cases (nice to fix)

1. **A stale comment in a test F-2 did not touch.** `lib/business-os/invites/__tests__/paymentHold.test.ts:294-298` still says the gate "refuses (404 in production for a non-admin)" and "Off production it returns at once". Both are no longer true: it refuses on every deployment, and a page refusal is the not-found screen at 200. Comment only; the assertions are right and green. Severity: Low. One-line wording fix for Dev, or leave for the next edit of that file.
2. **The `export type { … } from` form is outside the allow-list regex** (see TL edit 1). Type-only, erased at build, so no runtime effect. No action.
3. **Observed on the baseline, now closed by F-2 and A-1:** off production, T-7 (`/api/v2/debug/data-check`) answered a cookie-less caller 200 with a fixed internal user id in its body. With F-2 it is a JSON 404 everywhere. It is already a deletion candidate (A-1 N-9); nothing to do in this slice.

### Test outputs / logs

```text
build (branch):   exit=0 secs=430   ✓ Compiled successfully   OOM lines: 0
build (05732d73): exit=0 secs=660   ✓ Compiled successfully   OOM lines: 0
before prod:      pages 200 noindex=1 marker=0 | T-3..T-10 (+T-5,T-6, T-8 OPTIONS) 404 json | unknown 404 html
before preview:   pages 200 noindex=0 marker=1 | T-3 401 T-4 401 T-5 400 T-6 500 T-7 200 T-8 401 T-8opt 200 T-9 200(parse text) T-10 400
before no-Vercel: identical to before preview
after prod:       pages 200 noindex=1 marker=0 | all gated routes 404 {"success":false,"error":"Not found"} | unknown 404 html
after preview:    identical to after prod
after no-Vercel:  identical to after prod
jest (11 suites): Test Suites: 11 passed, 11 total; Tests: 369 passed, 369 total
authz-guard:      Test Suites: 2 passed, 2 total; Tests: 203 passed, 203 total
```

### Final status

- [x] All F-2 acceptance criteria pass. No bug open; one Low comment-only edge case. Ready for commit from QA's side.
- [ ] Before merge (unchanged): B-6, the user's acknowledgment of C-1 and C-2; N-6, the read-only admin check of each database the harness is used against.

---

## 14. Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Workplan created (Dev) | Baseline `05732d73` (A-1 merged, PR #694). The rule goes in the shared gate: `isTestSurfaceClosed()` and both early returns are deleted, so every deployment behaves as production does today. T-5 / T-6 are covered without an edit. T-9 gets its own `requireAdmin`, the project error format and the admin's id at its three LLM call sites; the attribution is a three-literal change, not escalated. 13 decisions for SA; 10 consequences, including C-2 (non-admin test-account flows on the harness) for the user. No code changed |
| 2026-11-27 | SA workplan review: approved with conditions (SA) | Dev's facts re-verified on `05732d73`, including the drift guard (A-1 N-3) staying green and the attribution path; the credit leak check does not read `v6_test` rows. F2-D1 to F2-D13 approved, with N-1 (an import allow-list for F2-D4) and N-4 (honest T-12 reason). No new pattern; no `profiles.role` / `app_metadata.role`. C-2 ruled a consequence, not a scope change: the build proceeds, TL tells the user now, and the merge waits for his acknowledgment (B-6). Blocking B-1 to B-5 before code approval; non-blocking N-1 to N-9 |
| 2026-11-28 | SA code review: approved for QA (SA) | B-1 to B-5 met. 369/369 affected suites and authz-guard 203/203 rerun by SA. Dev's full-gate explanation verified: from this worktree the gate config lists all 11 quarantined suites and 11 integration files, because the ignore patterns do not match a Windows path containing `.claude`; CI is unaffected. 4 Low comments, none blocking. B-6 and N-6 still gate the merge |
| 2026-11-27 | F-8 coordination recorded (Dev, via TL) | The F-8 session's edit list for `testSurfaceRoutes.test.ts` recorded in section 6 and R-3; F-2's edits there kept per-row and structural, T-5 / T-6 rows left as on `main` |
| 2026-11-27 | FU-1 decided by the user (Dev, via TL) | T-9 is to be deleted in a later follow-up slice, not in F-2; F-2 still builds its gate, error format and attribution. Recorded in F2-D12 and FU-1. Since T-9 is being deleted, no Zod slice for it is owed (SA N-9) |
| 2026-11-28 | QA report: PASS (QA) | TL's three Low edits (SA comments 1 to 3) recorded and checked; the widened allow-list regex goes red on each injected import form. Build exit 0 (430 s, no OOM). §9 item 7 probe, cookie-less, on this branch and on the `05732d73` baseline in production, preview and no-Vercel modes: production identical before and after (= A-1 FR-3); preview and no-Vercel flip from marker present / each route's own answer to `noindex` + no marker / JSON 404 for T-3 to T-10, T-5 and T-6 included. 369 / 369 affected tests, `test:authz-guard` 203 / 203. No bug; one Low stale comment in `paymentHold.test.ts:294-298`. B-6 and N-6 still gate the merge |
| 2026-11-27 | Implementation (Dev) | Built as approved, under B-1 to B-5 and N-1 to N-4, N-7, N-8 (section 8.1). Gate: environment branch deleted, import allow-list and no-environment pins. Route table on three deployments with per-row structural edits only (coordinated with F-8; section 6). T-9: own `requireAdmin` before the body, admin id at all three call sites proven through `POST`, generic error with `details` in development only, catch logs `{ err }`. Four mutation proofs red then restored (23, 13, 3, 7). 369 / 369 affected tests, `test:authz-guard` 203 / 203, full gate no new failure, typecheck clean for touched files, build exit 0. Not committed |
