# Workplan: Sentinel Webhook Authentication (QA-1)

**Developer:** Dev
**Branch:** `fix/sentinel-webhook-auth` (worktree `neuronforge-sentinel`, from `origin/main` 59d7c357)
**Requirement:** QA-1 in [IDENTITY_SWEEP_WORKPLAN.md](/docs/workplans/IDENTITY_SWEEP_WORKPLAN.md)
**Date:** 2026-09-21
**Status:** **SA-approved 2026-09-21 — implement option (d) under conditions D1-D6.** See SA Review Notes.

## Overview

`POST /api/sentinel/webhook/[agentId]` (355 lines, one commit ever: `6a00cae8`, 2025-11-25) authenticates nobody, uses a module-level service-role client, and executes the agent via `WorkflowPilot` / `runAgentKit` **as `agent.user_id` with the owner's plugin credentials**. Same capability as the `v6/fetch-plugin-data` route PR #86 deleted, but keyed on a resource id, so the user-id-shaped sweep missed it.

---

## Step 1 — Usage evidence

### Q1: Can a user obtain a webhook URL today through any live UI or doc? **No.**

| Check | Result | Strength |
|---|---|---|
| `grep -rni "sentinel"` across `*.ts(x)/*.md/*.json/*.sql` | The only hits naming this endpoint are **the route file itself** and the QA-1 entry in `IDENTITY_SWEEP_WORKPLAN.md`. Everything else is the unrelated test-fixture sense of the word ("sentinel string") | **Strong** |
| `grep` for `api/sentinel`, `webhookUrl`, `webhook_url` | No UI, service, or doc builds this URL. `AgentSandBox/types.ts` (a field-name list) and `lib/pilot/NotificationService.ts` (outbound Slack/Teams posts) are unrelated | **Strong** |
| Who can set `mode = 'triggered'` | The wizard chain `components/AgentWizard.tsx` to `wizard/Step4ExecutionMode.tsx` is the only UI offering it, and **`AgentWizard` has zero importers** — dead code. The live `agents/[id]` page and `templates/page.tsx` only *render a label* for the mode; neither sets it | **Strong** |
| API path to arm it | `PATCH /api/agents/[id]` passes `agentData.mode` straight through (lines 289-290), so an **authenticated owner** could set `'triggered'` with a hand-crafted request. No UI does | **Caveat — see risk note** |

### Q2: Live database — read-only counts (Supabase REST, service key from worktree `.env.local`, GET only)

| Query | Result |
|---|---|
| `agents` total | **86** |
| `agents` where `mode = 'triggered'` | **0** |
| Mode distribution | 81 `on_demand`, 3 `scheduled`, 0 `triggered` |
| `agent_executions` total | **1,328** |
| `agent_executions` where `trigger_type = 'webhook'` | **Query impossible — `column agent_executions.trigger_type does not exist` (Postgres 42703)** |

**The missing column is itself evidence.** The route's `logExecution()` inserts `input`, `output`, `execution_time_ms`, and `trigger_type`; the live table has `result`, `execution_duration_ms`, and no `trigger_type` at all. **That insert has always failed**, and the failure is caught and swallowed (`// Don't throw`). So:

- the route has never successfully recorded an execution, and
- **absence of webhook rows cannot be used as proof of non-use** — there would be no row either way. The load-bearing evidence is the `mode = 'triggered'` count of 0, which is a *precondition* the route enforces at line 81.

### Q3: Referenced in any external-facing doc? **No.**

Zero hits across `/docs/` other than the QA-1 finding that produced this branch.

### Combined verdict

**The route is unused with high confidence, and currently unexploitable — but latently, not structurally.** With 0 agents in `triggered` mode, every anonymous call dies at the mode check with a 400. The hole **arms itself the moment any agent's mode becomes `'triggered'`**, and from that instant anyone who knows or guesses the id runs that agent against the owner's connected accounts. Reachability is already proven: a random id returns `404 {"error":"Agent not found"}` — the database answering, with nothing having refused the caller.

**What this evidence cannot cover:** an external system (a customer CRM, a Zapier/Make scenario, or a "Sentinel" product surface) already configured against the production URL would appear in neither this repo nor this database. See "What would make me wrong".

---

## Step 2 — Fix options

| # | Option | Cost | Breaks | Migration | UI |
|---|---|---|---|---|---|
| **a** | **Delete the route** (whole `app/api/sentinel/` tree) | One file removed plus a guard test that the path 404s. Smallest diff, fully reversible from git | Only an undiscovered external caller. Nothing in-repo | **No** | **No** |
| b | Per-agent secret (URL segment or `X-Webhook-Secret` header) stored on the agent row, shown once | New column, generation, rotation/revocation, constant-time compare, and a UI surface to reveal it once. Proper multi-tenant isolation | Nothing existing (no callers) | **Yes** | **Yes** |
| c | HMAC signature over the raw body with a per-agent secret plus timestamp/replay window | Everything in (b), plus raw-body handling, a documented signing scheme, and **sender-side work by whoever calls it**. Strongest | Nothing existing; raises the bar for any future integrator | **Yes** | **Yes (+ integrator docs)** |
| d | Global shared secret (`SENTINEL_WEBHOOK_SECRET`, the `CRON_SECRET` pattern) | ~10 lines, fail-closed when unset | Nothing existing | **No** | No |

**On (d):** it stops the anonymous internet but is **one secret for all users and all agents** — any holder can trigger *any* user's agent. That is a deployment gate, not tenant isolation. It also inherits the live `CRON_SECRET` problem already on record: a secret that must be set on Vercel by someone with admin access the user does not have, so it silently fails closed until then.

**Scope note:** options **(b) and (c) each need a new column and a UI surface** — that is a feature, not the small security fix this branch was opened for. They should become a BA requirement of their own, not be smuggled into this fix.

---

## Recommendation: **(a) delete the route.**

> **SUPERSEDED 2026-09-21.** The user's binding decision is that Sentinel is planned, so the route is **not** deleted. Ship option **(d)** under SA conditions D1-D6. This section is retained as the reasoning record only — **do not implement it**. See [SA Review Notes](#sa-review-notes).

We do not secure a door to a room nobody built. There is no producer, no consumer, no documentation, no UI, no arming path a user could stumble into, zero agents in the mode it requires, and a logging insert that has never once succeeded against the live schema. Adding auth per (b)/(c) means designing a webhook *product* — secret lifecycle, rotation, revocation, reveal-once UI, integrator docs — on speculation, while leaving the executes-as-owner service-role path alive the whole time. Deleting removes the capability outright and costs one `git revert` to undo if a real webhook feature is ever specced, at which point it should be built deliberately as (c).

**If SA wants the capability preserved:** ship **(d) now** as a fail-closed stopgap and file (b)/(c) as a separate BA requirement. Do not ship (b)/(c) on this branch.

### What would make me wrong

Any **one** of these flips the recommendation to (d)-now-(b)-later:

1. An external system is already POSTing to the production URL. Not visible from repo or DB; only the user or the Vercel/Supabase request logs can settle it. **Cheapest check: Vercel logs filtered on `/api/sentinel/` — any 400 "Invalid agent mode" or 404 from a non-QA source is a live caller.**
2. "Sentinel" is a named product commitment (a customer integration, a demo, a sales promise) rather than abandoned scaffolding. The name appears nowhere else in the repo, but that is absence of evidence.
3. A webhook/trigger feature is already on the near-term roadmap, making deletion churn.

---

## What SA must decide

1. **Which option** — (a) delete, or (d) stopgap with (b)/(c) deferred to a BA requirement.
2. **Whether to accept the residual risk of (d)** — one global secret means any holder triggers any tenant's agent, which is weaker than the per-user isolation the rest of the platform enforces.
3. **Who answers "is anything calling it in production"** — this needs the user or Vercel logs; Dev cannot close it from the repo or the database.
4. **Scope confirmation** — that a new column and UI are out of scope for `fix/sentinel-webhook-auth`.

---

## Noted, not fixed (flagged per standing rules, deliberately out of scope)

| Item | Detail |
|---|---|
| **Logging standard** | The route has **25 `console.*` calls** and no `createLogger`. Per CLAUDE.md § Logging I would normally propose converting the whole file — **moot if option (a) is chosen** (the file disappears). If SA picks (d), the Pino conversion should ride along in the same diff. `console.log('Sentinel: Webhook payload:', ...)` also **dumps the entire untrusted request body into the logs**. |
| **Body validation** | **None.** The body is `await request.json()` into `webhookPayload: any`, then `JSON.stringify`'d straight into the agent's `userInput` — no Zod anywhere, violating the mandatory API-boundary rule. Attacker-controlled text reaching an LLM prompt unvalidated is a prompt-injection surface on top of the auth hole. |
| **Broken execution logging** | `logExecution()` writes four columns that do not exist on `agent_executions` (`input`, `output`, `execution_time_ms`, `trigger_type`) and the error is swallowed. Only worth fixing under (d). |
| **Service-role + repository bypass** | Module-level `createClient(...SERVICE_ROLE_KEY)` with direct `.from('agents')` queries bypasses RLS and the repository layer. Resolved for free by (a). |

---

## Files to Create / Modify

**Under option (d)** (see SA Review Notes for binding conditions): modify `app/api/sentinel/webhook/[agentId]/route.ts` (auth gate, Zod body guard, Pino conversion, `logExecution()` repair via `lib/database/executionHelpers.ts`), add tests T1-T9 under `app/api/sentinel/webhook/[agentId]/__tests__/`, document `SENTINEL_WEBHOOK_SECRET`, and update the QA-1 entry in `IDENTITY_SWEEP_WORKPLAN.md` as **mitigated (deployment gate)**, not fixed. ~~Anticipated under (a):~~ delete `app/api/sentinel/webhook/[agentId]/route.ts` (and the then-empty `app/api/sentinel/` tree), add a route-removed guard test, update the QA-1 entry in `IDENTITY_SWEEP_WORKPLAN.md`.

## Task List

- [x] Confirm branch `fix/sentinel-webhook-auth` and read the route
- [x] Prove in-repo usage (UI, docs, `triggered` mode writers)
- [x] Live read-only DB counts (agents by mode, executions)
- [x] Draft options + recommendation
- [x] **SA decision on option** — **(d)**, conditions D1-D6 (see SA Review Notes)
- [x] Implement — gate (D1-D6), Zod + size cap, Pino, `logExecution()` repair
- [x] Tests — 9/9 pass, 3 mutation controls, no regression vs 59d7c357
- [x] QA — full run: live gate verification on :3007, regression vs 59d7c357, 3 mutation controls. **PASS** with 2 Low findings

## SA Review Notes

**Reviewed by SA — 2026-09-21**
**Status:** ✅ Approved with conditions — implement option **(d)** exactly as specified below. Do not implement (a), (b) or (c) on this branch.

### Verification of Dev's evidence

Load-bearing claims independently re-checked before deciding:

| Claim | Verdict |
|---|---|
| No in-repo producer of the URL; `AgentWizard` chain is dead | Accepted as re-verified by Dev; not load-bearing for this decision |
| `PATCH /api/agents/[id]` passes `mode` through, so an owner can arm their own agent | **Confirmed** — `app/api/agents/[id]/route.ts` lines 288-291 assign `updateData.mode` verbatim when provided. The "arms itself" risk is real |
| 0 of 86 agents are `mode='triggered'` | Accepted (live read-only count) |
| `logExecution()` writes columns that do not exist | **Confirmed, and worse than reported** — see the ruling on item 3 |

### 1. Decision: option (d), global shared secret

**This is a deployment gate, not tenant isolation.** One secret covers every user and every agent: any holder of `SENTINEL_WEBHOOK_SECRET` can trigger *any* user's agent, executing as that user with their connected plugin credentials. It stops the anonymous internet and nothing more. It does **not** satisfy the `tenant-isolation-guard` standard, and QA-1 must be recorded as **mitigated (deployment gate)**, not *fixed*. The real fix is the per-agent secret (b) / HMAC (c), which is a separate BA requirement — new column, generation, rotation, reveal-once UI — and is explicitly **not** this branch.

**Exact shape — all six points are conditions of approval:**

| # | Decision | Rationale |
|---|---|---|
| D1 | **Env var `SENTINEL_WEBHOOK_SECRET`.** Do **not** reuse `CRON_SECRET` | Separate blast radius. `CRON_SECRET` is held by Vercel's cron infrastructure; this one would eventually be handed to external CRM integrators. Sharing them means an integrator can call every cron endpoint. A distinct var also makes setting it the deliberate act of arming this route |
| D2 | **Header only: `Authorization: Bearer <secret>`.** No query-parameter fallback, no second accepted header | Query strings land in access logs, Vercel request logs, referrers and browser history. Matches the house cron pattern (`app/api/cron/payment-reminders/route.ts`). There are zero integrators today, so "some CRM can't set a header" is YAGNI |
| D3 | **Constant-time comparison** via `crypto.timingSafeEqual` over `Buffer`s. Guard the length first — `timingSafeEqual` **throws** on unequal lengths — and return `false` rather than letting it throw. Requires `export const runtime = 'nodejs'` | Cheap, correct. **Scope fence:** this is a local improvement for a route that executes agents with live credentials. It is **not** a mandate to refactor the ~12 cron routes that use `===`. Do not touch them |
| D4 | **Fail closed when unset — in every environment, including development.** No `NODE_ENV === 'development'` bypass | Deliberate deviation from the cron pattern. This route runs arbitrary users' agents against their real plugin accounts; a dev bypass is one `NODE_ENV` mistake away from production. Local testing sets the var in `.env.local`. It also makes the test matrix unconditional |
| D5 | **Failure response: `401` with body `{ success: false, error: 'Unauthorized' }` and nothing else.** Byte-identical for missing header, malformed header, wrong secret and unset secret | An unauthenticated caller must learn nothing about the agent. `401` not `403`, consistent with the 401/403 split in `requireAdmin` (no valid credential presented) |
| D6 | **The gate is the first statement in the handler** — before `await params`, before `request.json()`, before any Supabase call, before any logging of request content | This is what actually closes the enumeration oracle. Today a random id returns `404 {"error":"Agent not found"}` and a real id returns `400 Invalid agent mode`, so an anonymous attacker can currently confirm an agent id exists and read its mode out of the error message. A gate that is merely *present* but runs after the DB lookup leaves that oracle open. Gate present ≠ gate first (the OI-20 lesson from the admin-authz work) |

Log rejections with `logger.warn` and a `correlationId`. **Never** log the secret, the header, or the request body.

**On the known `CRON_SECRET` deployment problem:** the user does not have Vercel admin, so with `SENTINEL_WEBHOOK_SECRET` unset the route is **dormant in production — every call 401s**. That is **accepted and correct**: 0 of 86 agents are in `triggered` mode, so the route has no legitimate caller to break, and dormancy is strictly safer than today's anonymous-execution state. **Shipping this requires no Vercel admin action.** Setting the variable later is the deliberate arming step when Sentinel is actually built. Do not block the branch on it, and do not weaken D4 to avoid it.

### 2. Scope rulings on the three adjacent items

| Item | Ruling | Conditions |
|---|---|---|
| **(i) Zod on the body** | **IN — minimal** | Mandatory rule 2; this is an API boundary feeding an LLM prompt. But the body is an arbitrary third-party CRM payload, so a schema that rejects unknown keys would break the only use case. Required shape: assert the parsed body is a **JSON object** (reject array / string / number / `null`) with **unknown keys passed through**, plus a **serialized size cap** (pick 64-128 KB, document the number). Reject with `400` — that is after the auth gate, so a caller-visible 400 is fine. **State honestly in the code comment that this does not prevent prompt injection**: the untrusted body still reaches the LLM. It bounds the payload and satisfies the boundary rule. Do not invent a CRM field contract |
| **(ii) `console.log` of the whole body (line 61)** | **IN — non-negotiable** | A data-exposure bug in its own right: an untrusted third-party payload, potentially containing customer PII from a CRM, written verbatim to logs. Subsumed by (iii) |
| **(iii) 25 `console.*` → Pino** | **IN** | Mandatory rule 3 plus the user's standing decision this session to convert files we touch. Use `createLogger({ module: 'SentinelWebhookAPI' })` and a `correlationId` child logger per the CLAUDE.md API route pattern; errors as `{ err }`. **Scope fence: convert logging only.** No control-flow refactor, no renaming, no restructuring of `executeAgentAsync`, no touching `WorkflowPilot` / `runAgentKit`. Fold the emoji prefixes into structured fields. Never log the payload; a derived size / key-count at `debug` is the most that may be recorded |

**Explicitly OUT of scope** (do not do these on this branch): deleting the route; per-agent secrets or HMAC; any migration; any UI; replacing the module-level service-role client with the repository layer; refactoring the cron routes' `===` comparisons; typing `agent: any` / `executionResult: any` out of `executeAgentAsync`.

### 3. Ruling on the broken `logExecution()` — **IN scope, and cheaper than the workplan assumes**

Dev's finding is confirmed and understates the breakage. `agent_executions` has **no** `input`, `output`, `execution_time_ms` or `trigger_type` column. Two further defects in the same insert:

1. **`scheduled_at` is required and has no database default** — so even after renaming every column the hand-rolled insert would still fail. A second, independent reason it has never succeeded.
2. **`execution_type` is being given `'pilot' | 'agentkit'`**, which are not legal values for that column (`manual | scheduled | triggered`).

**Why it is still in scope:** an auth gate with no record that the gate was passed is a weak control, and `lib/database/executionHelpers.ts` already exposes `createExecution({ execution_type: 'triggered' })`, `completeExecution` and `failExecution` against the correct live columns — already used by `app/api/agents/[id]/execution-status/route.ts`. So the fix is **delete the hand-rolled insert and call the existing helpers**. No new pattern, no new repository method, no migration.

Conditions:

- Use `execution_type: 'triggered'`. Drop `input` / `output` / `trigger_type` entirely — **do not persist the raw webhook body** (untrusted third-party data, and there is no column for it). The outcome goes in `result`, failures in `error_message`.
- **The `executionId` returned in the 200 response must be the id of the row actually written.** `createExecution` generates its own id; reconcile by returning the helper's id rather than the local `uuidv4()`. If that needs more than a few lines, stop and flag it — do not redesign the id flow.
- Keep the failure swallowed (a logging failure must not kill an execution) but log it through Pino at `error` with `{ err }`, so the next silent failure is visible.
- **Repository-pattern note, so this is not read as a precedent:** the standing rule is that *new* DB writes go through `lib/repositories/`. This is not a new write — it is repairing an existing broken one to use the codebase's existing writer for this table. `ExecutionRepository` currently has **no** `create` method, so doing it "properly" means extending the repository, which is exactly the drift this branch must avoid. Record as follow-up debt: *`agent_executions` inserts live in `lib/database/executionHelpers.ts` on a service-role client, not in `ExecutionRepository`.*

### 4. Required tests

The four proposed are necessary but do not prove the property that matters. Required in full:

| # | Test | Proves |
|---|---|---|
| T1 | Secret **unset** → `401` | Fail-closed |
| T2 | **Wrong** secret → `401` | Gate rejects |
| T3 | Correct secret + **non-`triggered`** agent → behaviour unchanged (`400`) | No regression |
| T4 | Correct secret + `triggered` agent → executes (`runAgentKit` / `WorkflowPilot` mocked) | Gate does not break the happy path |
| **T5** | Unauthenticated request with a **real existing** agent id and with a **random non-existent** id return **byte-identical** status and body | **Closes the enumeration oracle** — the actual security property. Without this, D5/D6 are unverified |
| **T6** | On a `401`, assert the Supabase client, `WorkflowPilot` and `runAgentKit` mocks were **never called** | Gate is *first*, not merely present. Present-but-late is the failure mode that keeps recurring here |
| **T7** | Secret supplied as a **query parameter** (`?secret=…`) → `401` | Locks in D2 so nobody "helpfully" adds a fallback later |
| **T8** | Authenticated + non-object body (array / string) → `400`; oversized body → `400`; **no execution triggered** in either case | Zod boundary actually enforced |
| **T9** | `NODE_ENV='development'` with the secret unset → still `401` | Guards against someone copying the cron routes' dev bypass in later |

Not required: any test that really runs an agent, and any live-DB test. The route has no existing tests — co-locate under `app/api/sentinel/webhook/[agentId]/__tests__/` and confirm the Jest config picks the path up.

### Approval

- [x] Option decided: **(d)**, conditions D1-D6 binding
- [x] Scope: (i), (ii), (iii) and the `logExecution()` repair are **in**; everything under "explicitly OUT" is **out**
- [x] Proceed to implementation — no second workplan review needed. Back to SA for **code review** before QA

### Needs the user (does not block implementation)

1. **Shipping (d) fail-closed will start 401-ing any undiscovered external caller.** With 0 `triggered` agents every such call is already failing at the mode check, so nothing functional is lost. Recommend shipping without waiting for the Vercel log check.
2. **Confirm dormancy is acceptable** — the route stays off in production until someone with Vercel admin sets `SENTINEL_WEBHOOK_SECRET`.
3. **The real fix needs a BA requirement** — per-agent secret (b) or HMAC (c). (d) leaves every tenant reachable by any secret holder.

## Dev Implementation

**Status:** Code complete — back to SA for code review. Not staged, not committed.
**Diff:** `app/api/sentinel/webhook/[agentId]/route.ts` +251/-108 (one file), plus a new 288-line test suite. No migration, no UI, no new dependency.

### D1-D6 as built

| # | Built as |
|---|---|
| D1 | `SENTINEL_WEBHOOK_SECRET`. `CRON_SECRET` is untouched and unreferenced by this route |
| D2 | `Authorization: Bearer <secret>` only. No query fallback, no second header. T7 locks this in |
| D3 | `crypto.timingSafeEqual` over `Buffer`s, with the length compared first (it throws on a length mismatch) and `false` returned rather than the throw escaping. `export const runtime = 'nodejs'` added. The cron routes' `===` comparisons were not touched |
| D4 | Fails closed in every environment. There is no `NODE_ENV` branch anywhere in the gate. T9 asserts a dev-mode request with the secret unset still 401s |
| D5 | `401 {"success":false,"error":"Unauthorized"}` from a single `unauthorized()` helper, so missing / malformed / wrong / unset all return the same bytes. T5 asserts byte equality |
| D6 | **The gate is literally the first statement of `POST`.** The correlationId for the rejection log is derived inside the rejection branch so that nothing precedes the gate. `await params`, `request.text()` and every Supabase call sit below it |

Rejections log at `warn` with a `correlationId` and nothing else — no secret, no header, no body.

### The three adjacent items

- **Zod:** `z.record(z.string(), z.unknown())` — verified against zod 3.25 that this rejects arrays, strings, numbers and `null` while passing unknown keys through, so no `refine` was needed. Size cap **128 KB**, measured with `Buffer.byteLength` on the **raw text before `JSON.parse`**, so an oversized body never reaches the parser. Both rejections are `400`, after the gate. The code comment states plainly that this does not prevent prompt injection — the body still reaches the LLM; it bounds size and shape only.
- **Body-dumping log:** removed. The most that is now recorded is `payloadBytes` and `payloadKeyCount`, at `debug`.
- **Pino:** **25 `console.*` → 0.** `createLogger({ module: 'SentinelWebhookAPI' })`, a `correlationId` child logger per request, and a second child in `executeAgentAsync` carrying `correlationId` + `executionId` + `agentId`. Errors pass `{ err }`. Emoji prefixes became structured fields. Control flow was not touched: no renames, no restructuring, no changes to `WorkflowPilot` / `runAgentKit`, and the `any` types were left in place per the scope fence.

### `logExecution()` repair — and the `executionId` trap

The hand-rolled insert is deleted. The route now calls `createExecution({ execution_type: 'triggered' })` / `completeExecution` / `failExecution`.

**The id reconciles in a few lines, so no redesign was needed.** The execution row is created *before* the 200 is returned, and the row's own id becomes both the response `executionId` and the `sessionId` passed into the engine. T4 asserts the returned id is the id `createExecution` wrote, and that the same id reaches `runAgentKit` as the session id.

**One judgment call, flagged for SA:** if `createExecution` itself fails, there is no row, so there is no real id to return. Rather than return a fake id or kill the run (SA: a bookkeeping failure must not cancel an execution), the failure is logged at `error` with `{ err }`, the agent still executes with a locally generated session id, and the response carries `executionId: null`. `completeExecution` / `failExecution` are then skipped. Six lines. If SA prefers a 500 there instead, it is a one-line change.

Also as ruled: `execution_type` is `'triggered'` (not `'pilot' | 'agentkit'` — which engine ran is recorded inside `result` as `executionPath`); `scheduled_at` is supplied by the helper's own default; and the raw webhook body is **not** persisted.

### Verification

| Check | Result |
|---|---|
| New suite | **9/9 pass** (T1-T9) |
| **Mutation control — fail-closed broken** (`if (!expected) return true`) | **T1 + T9 fail** |
| **Mutation control — query fallback added** | **T7 fails** |
| **Mutation control — gate PRESENT but moved after the agent lookup** | **T1, T2, T5, T6, T7, T9 fail (6 of 9)** — T5 and T6 are the ones that prove the suite tests *gate-first*, not *gate-present*. Route restored byte-exactly after each mutation (md5 verified) |
| `npm test` vs a pristine `59d7c357` baseline | **No regression.** Baseline 21 failed / 380 passed suites / 6,091 passing tests; after 21 failed / **381** passed / **6,100** passing. Failing-suite set **identical** (21, compared as a normalized sorted set). Delta = exactly my +1 suite / +9 tests. Baseline built in-place by restoring the route from `HEAD` and removing the new test dir, then restoring |
| `tsc --noEmit` | **0 errors in the changed files.** The repo's 2,030 pre-existing error lines are in unrelated files |
| ESLint on changed files | **0 errors.** Warnings went **10 → 7** (all `no-explicit-any` on the pre-existing `any`s that SA ruled out of scope) |
| `next build` | **Compiled successfully**; route present in `routes-manifest.json` |

### Follow-up debt recorded

- `agent_executions` inserts live in `lib/database/executionHelpers.ts` on a service-role client, not in `ExecutionRepository` (which has no `create`). Per SA, repairing the existing writer here is not a precedent for new writes.
- QA-1 is **mitigated (deployment gate)**, not fixed. Any `SENTINEL_WEBHOOK_SECRET` holder can still trigger any tenant's agent. The per-agent secret / HMAC requirement remains open.
- The route is **dormant in production** until someone with Vercel admin sets `SENTINEL_WEBHOOK_SECRET`. With 0 of 86 agents in `triggered` mode, nothing functional is lost.


---

**Code Review by SA — 2026-09-21**
**Status:** ✅ Code Approved — no required fixes. Proceed to QA.

### What I verified myself (not taken from the Dev report)

| Claim | How checked | Result |
|---|---|---|
| Gate precedes every side effect, including `await params` | Read `route.ts` lines 100-118 | **Holds.** `isAuthorizedSentinelRequest` is the first statement in `POST`. `await params`, `request.text()` and the `agents` lookup are all inside the `try` below it. The rejection-branch log derives its own `correlationId` inline, so even that does not execute before the gate |
| Four rejection causes are byte-identical | Read the code path + ran T5 | **Holds.** Unset secret, absent header, non-`Bearer` header and wrong secret all `return unauthorized()`, a single helper returning `{success:false,error:'Unauthorized'}` / 401. T5 compares `await res.text()` on a real vs. a non-existent agent id — a genuine byte comparison, not a shape assertion |
| `timingSafeEqual` cannot throw | Read lines 74-80 | **Holds.** Length compared on the Buffers *before* the call, returning `false` on mismatch. `!expected` is rejected earlier, so a zero-length expected secret can never reach it |
| `z.record(z.string(), z.unknown())` really rejects arrays in the installed zod | Executed against the installed package (zod **3.25.76**) | **Holds.** `[1,2]`, `'str'`, `42`, `null`, `true`, `undefined` → all `false`; `{}` and `{a:1}` → `true`. Dev's decision to skip a `refine` is correct, not an assumption |
| Payload cap is on raw bytes | Read lines 135-147 | **Holds.** `await request.text()` → `Buffer.byteLength(rawBody,'utf8')` → cap check → **only then** `JSON.parse`. An oversized body never reaches the parser |
| Execution row is created before the 200 and its id is the one returned | Read lines 225-273 + ran T4 | **Holds.** `createExecution` is awaited before `executeAgentAsync` is fired and before the response. `executionId = execution?.id`, and the same value is the `sessionId` and the `completeExecution` target. T4 asserts the response id, the `runAgentKit` session arg and the `completeExecution` arg are all the written row id |
| Column repair is correct against the live schema | Read the new calls vs `lib/database/executionHelpers.ts` | **Holds.** `createExecution` supplies the required `scheduled_at` (no DB default — the second reason the old insert always failed) and legal `execution_type: 'triggered'`. `execution_duration_ms` comes from `completeExecution`. `input`/`output`/`trigger_type` are gone; which engine ran is kept inside `result`, not in `execution_type` |
| `console.*` eliminated, logging only | `grep -c 'console\.'` → **0**; read the diff | **Holds.** `createLogger({module:'SentinelWebhookAPI'})` + `correlationId` child logger, errors as `{ err }`. Control flow, engine selection and the `agent_configurations` lookups are untouched |
| Body no longer logged | Read every `logger.*` call | **Holds.** The line-61 dump is gone; the debug line carries `payloadBytes` + `payloadKeyCount` only. The JSON-parse failure path logs `{ err, agentId, payloadBytes }` and explicitly not the body |
| Nothing outside the fence changed | `git status --porcelain` | **Holds.** Exactly three paths: the route (modified), the new `__tests__/` directory, and this workplan. No migration, no UI, no dependency, no cron-route edits, no repository changes |
| The tests actually bite | Ran the suite (9/9 green), then **ran my own mutation**: flipped `if (!expected) return false` → `return true` | **Holds.** T1 and T9 went red, the other seven stayed green — exactly the predicted signature. File restored and verified byte-identical to the pre-mutation state (`diff` clean) |

Jest picks up `app/api/sentinel/webhook/[agentId]/__tests__/` without config changes.

### Ruling: `createExecution` failure → execute anyway with `executionId: null` (Dev's judgment call)

**Approved as written. Do not change it to a 500.**

The determining argument is consistency with an existing mandatory rule rather than taste. This codebase treats execution bookkeeping as non-blocking everywhere — CLAUDE.md lists "blocking audit logging" as an anti-pattern and requires `.catch()` on every audit write. Making a row insert a hard precondition of running the agent would invert that for this one route: a transient `agent_executions` outage would take the whole webhook feature down, and the feature's entire purpose is to run the agent. The failure is in the record of the work, not the work.

The usual counter-argument — "a 500 lets the sender retry" — actively hurts here. Webhook senders retry on 5xx, and a 500 returned once execution has been fired would run the owner's agent twice against their real third-party accounts. Dev's ordering avoids that by keeping the only 5xx on the pre-execution path.

Two non-blocking conditions:
1. The `executionId: null` case is a **response contract**, not just an internal detail. Add it to the endpoint's JSDoc response shape so the future Sentinel integrator knows the field is nullable and must not be used as a polling key unconditionally. *(Priority: Low — documentation only.)*
2. The `'Failed to create execution record (non-blocking)'` error log is the only signal this happened. Leave it at `error` level so it is alertable. *(Already correct — no change.)*

### Code Review Comments

None at High or Medium. Nothing blocks QA.

### Optimisation Suggestions (all optional, none blocking, all deferrable past this branch)

1. `route.ts:110` / `route.ts:118` — the `x-correlation-id` fallback expression is written twice, once inside the rejection branch and once after it. Harmless duplication that exists precisely because the gate must not be preceded by anything; leaving it is the right trade. *(Low)*
2. `route.ts:77` — comparing Buffer lengths leaks the secret's length to a timing observer. This is the pattern the Node documentation itself recommends, and hashing both sides to equalise length is not worth the change on a dormant route. Recorded for the per-agent-secret work, **not** for this branch. *(Low)*
3. The service-role client and the direct `.from('agents')` query remain, as fenced. Already recorded as follow-up debt alongside the missing `ExecutionRepository.create`. *(Low)*

### Notes for QA

1. **The property under test is "the gate is first", not "a gate exists".** T5 and T6 are the load-bearing cases. If either is weakened during QA, the change is a regression regardless of what the other seven do.
2. **Expect the route to be dormant in production.** With `SENTINEL_WEBHOOK_SECRET` unset, every call returns 401 — that is the designed, approved state, not a defect. To exercise the happy path, set the variable in `.env.local`; there is no `NODE_ENV` bypass by design (T9 guards this).
3. **Do not report the authenticated 400s as an information leak.** A secret holder can still enumerate agent ids and read `Current mode: "…"` out of the mode-check message. That is inherent to option (d) — one shared secret, no tenant isolation — and is the reason (b)/(c) is a separate requirement. It is only an oracle for *unauthenticated* callers, which T5 closes.
4. `GET`/`PUT`/`DELETE` return 405 without consulting the secret. Acceptable: they reveal only that the path exists, which the URL already tells you, and they touch no data.
5. **QA-1 must be closed as "mitigated (deployment gate)", not "fixed".** Any secret holder can still trigger any user's agent as that user with their plugin credentials.
6. Suggested manual check beyond the suite: confirm no log line anywhere in a full request cycle contains the request body or the secret. The suite asserts the code path; a visual scan of the emitted Pino output is a cheap independent confirmation (it was clean in my run).

### Code Approved for QA: **Yes**

### QA follow-up fixes (2026-09-21)

Both QA findings were in lines this branch added. Both fixed; nothing else touched.

**QA-1 — the JSON-parse error log echoed a 10-byte prefix of the body.** Confirmed: V8 embeds a verbatim prefix of the input in a `SyntaxError`'s `message` **and** `stack`, so `{ err }` on that path re-opened the leak the body-dump removal was meant to close — directly under a comment promising the opposite. Now logs `{ errName: (error as Error).name, agentId, payloadBytes }`. The comment explains *why* the error object itself is unsafe here, so nobody "restores" it later.

**Audit of the route's other seven `{ err }` sites, as QA asked.** Only one catch handles an error *derived from parsing request content*, and that is the one fixed:

| Site | Error source | Can it embed body bytes? |
|---|---|---|
| L194 `Agent not found` | PostgREST error on the `agents` lookup | No — derived from the URL id, never the body |
| L248 `createExecution` failed | PostgREST insert error; the row carries only `agent_id` / `user_id` / `execution_type` / `scheduled_at` | No |
| L267, L283 outer `POST` catches | `await params`, `request.text()`, the Supabase calls — `JSON.parse` has its own catch | No |
| L463, L479 record-outcome failures | PostgREST update errors | No |
| **L371, L432, L470 engine catches** | `WorkflowPilot` / `runAgentKit`, which receive `JSON.stringify(webhookPayload)` as user input | **Theoretically yes — left as-is, flagged** |

The three engine catches are **pre-existing behaviour** (baseline `console.error('…', error)` logged the same object; the Pino conversion changed the format, not the content), and SA's own `logExecution()` ruling **deliberately persists that same `error.message`** into `agent_executions.error_message` via `failExecution`. Stripping the message from the log while still writing it to the database would be incoherent, and would remove the only diagnostic for a failed run. Recorded as a residual for SA rather than changed unilaterally — it is a different (and broader) question from the one QA raised.

**QA-2 — D5 byte-identity was pinned for only 2 of 4 causes.** T2 is now a table over **six** rejection inputs (missing header, three malformed schemes, wrong secret, same-length wrong secret) plus the unset-secret cause, each asserted against a shared `UNAUTHORIZED_BODY` constant via `await res.text()`. Assertions are labelled so a failure names the diverging cause. T1, T5 and T9 now pin the same literal bytes through the same constant.

| Check | Result |
|---|---|
| Suite after the fixes | **9/9 pass** |
| **QA's mutation B2 re-created** (malformed scheme → `Malformed Authorization header`; wrong secret → `{"error":"Invalid secret","hint":"check your token"}`) | **T1, T2, T5, T9 red — was 9/9 green for QA.** The gap is closed. Diff shown by Jest is exactly the `hint` divergence. Route restored byte-exactly afterwards (md5 `a630720b8bcf88b61e71907fe236f0dc`) |
| Full `npm test` | 21 failed / 381 passed suites, **6,100 passing tests** — unchanged from the pre-fix branch run, still +1 suite / +9 tests over baseline |
| `tsc --noEmit` | 0 errors in the changed files |
| ESLint | 0 errors, 7 warnings (unchanged; all pre-existing `any`s) |
| `next build` | Compiled successfully |

QA's three edge cases (a test for the `createExecution`-fails path, the `executionId: null` JSDoc note, and whether an engine result echoes the payload into `agent_executions.result`) are **not** addressed here — they are additions beyond the two findings, and the instruction was to fix the findings only.


## QA Testing Report

**QA — 2026-09-21**
**Test mode:** full
**Strategy used:** **C (live black-box against the running dev server on :3007)** for the security property, **A/B (Jest, full-suite regression vs a rebuilt 59d7c357 baseline)** for no-regression, **mutation controls** to prove the suite bites, and **E (log analysis)** of the route's real Pino output captured out of the Jest run. Live black-box was chosen because the load-bearing claim — *the gate runs first* — is a statement about what the process does, not about what a mocked handler returns; the unit tests assert it against mocks, so an independent channel was required.
**Focus:** security (gate-first, enumeration oracle, fail-closed), api, logging
**Skipped:** Playwright E2E (not installed in this repo — see CLAUDE.md § Testing). Direct Supabase REST reads were **blocked by this session's sandbox** (production-read denial), so the "no execution row was written" claim is carried by black-box response evidence and code-path reasoning rather than a row count — recorded as PENDING P4 rather than asserted.
**Input source:** prompt keywords (`full`, security focus) + § SA Code Review "Notes for QA"

---

### 1. Live probes with `SENTINEL_WEBHOOK_SECRET` unset (approved dormant state)

13 probes against `http://localhost:3007/api/sentinel/webhook/…`. `.env.local` verified to contain no `SENTINEL_WEBHOOK_SECRET` (md5 `67d66142c5682c459f47520ee7562b89`).

| # | Probe | Status | Raw body md5 | Bytes |
|---|---|---|---|---|
| A | No `Authorization` header, well-formed UUID | 401 | `aa95ad29c374abfc43dafa7672468861` | 40 |
| B | Wrong Bearer token | 401 | `aa95ad29…` | 40 |
| C | Secret as `?secret=` query parameter | 401 | `aa95ad29…` | 40 |
| D | Random (non-existent) UUID | 401 | `aa95ad29…` | 40 |
| E | Malformed, non-UUID agent id (`not-a-uuid-at-all`) | 401 | `aa95ad29…` | 40 |
| F | `Authorization: <secret>` (no scheme) | 401 | `aa95ad29…` | 40 |
| G | `Authorization: Basic <secret>` | 401 | `aa95ad29…` | 40 |
| H | `Authorization: Bearer ` (empty) | 401 | `aa95ad29…` | 40 |
| I | 300 KB body | 401 | `aa95ad29…` | 40 |
| J | Malformed JSON body | 401 | `aa95ad29…` | 40 |
| K | Array body | 401 | `aa95ad29…` | 40 |
| L | No body at all | 401 | `aa95ad29…` | 40 |
| **M** | **A real production agent id** (`08eb9918-…`, taken from `archive/check-agent-production-status.js`; later confirmed live to exist with `mode='scheduled'`) | 401 | `aa95ad29…` | 40 |

**All 13 bodies are byte-identical** (one md5, 40 bytes: `{"success":false,"error":"Unauthorized"}`). **Response headers are identical too** — normalised (Date/Connection/Keep-Alive stripped) they hash to a single value `85dd16625af476e14c644de035af8c9d` across all 13. `Transfer-Encoding: chunked`, so there is not even a `Content-Length` side channel, and no `Set-Cookie` / `x-*` differentiator.

Probe M is the decisive pair with probe D: those same two ids, **once authenticated**, answer differently (400 `Invalid agent mode … "scheduled"` vs 404 `Agent not found`). Unauthenticated they are indistinguishable down to the byte. **The enumeration oracle described in D6 is closed on the live route, not merely in mocks.**

### 2. "The gate runs FIRST" — verified independently of the unit tests

The dev server's stdout is not captured to a file in this environment, so instead of reading its console I used probes whose *downstream* behaviour would be observable if any downstream stage had run. Each asks a different question, and all answered "nothing ran":

| Evidence | What it rules out |
|---|---|
| Probe **I**: 300 KB body → 401, **not** 400 `Payload too large` | `request.text()` / the byte cap never ran → **the body was never read** |
| Probe **J**: `{not json` → 401, **not** 400 `Invalid JSON payload` | `JSON.parse` never ran |
| Probe **K**: `[1,2,3]` → 401, **not** 400 `must be a JSON object` | The Zod check never ran |
| Probe **E**: non-UUID agent id → 401, **not** 404/500 | The `agents` lookup never ran (a non-UUID reaches Postgres as `22P02`, which this route surfaces as 404 — it did not) |
| Probe **M vs D**: real vs non-existent id, identical bytes | No `agents` row was read, or the 404/400 split would have surfaced |
| **Latency, same id, same server, warm**: unauthenticated `d_randomid` **0.147 s** vs authenticated `p_auth_rand` **0.404 s** (n=12 unauthenticated samples, range 0.130–0.175 s, all below the DB-hitting sample) | A Supabase round-trip is ~2.7× the 401 path; the 401 path has no round-trip in it |
| Captured Pino output (§7): the rejection line carries **only** `correlationId` + msg — no `agentId`, which is first logged at line 133 *below* the gate | Nothing downstream, including the first log statement, executed |
| Source read: `isAuthorizedSentinelRequest(request)` is the first statement of `POST`; `await params`, `request.text()` and both `supabaseAdmin` calls are inside the `try` below it; the rejection branch derives its own `correlationId` inline so nothing precedes the gate | — |

**No DB read, no execution row, no plugin call and no body read on any rejected request.**

### 3. Happy path (`SENTINEL_WEBHOOK_SECRET` set, then restored)

`.env.local` was backed up, one line appended, and afterwards **restored from the backup and verified byte-identical** (md5 `67d66142c5682c459f47520ee7562b89` before **and** after; `diff` clean; `SENTINEL_WEBHOOK_SECRET` grep count back to 0). The Next dev server picked the variable up on the first poll and dropped it again on the first poll after restoration (confirmed by a 401 on a request bearing the now-removed secret).

| Probe | Result |
|---|---|
| Correct secret + real **non-triggered** agent (`mode='scheduled'`) | **400** `{"success":false,"error":"Invalid agent mode","message":"Agent must be in \"triggered\" mode. Current mode: \"scheduled\""}` — the pre-existing behaviour, unchanged (T3 live). Returns before `createExecution`, so no row and no execution |
| Correct secret + random id | 404 `Agent not found` (pre-existing) |
| **Wrong** secret while the secret **is** set | **401**, md5 `aa95ad29…` — identical to the dormant-state bytes |
| Same-length wrong secret (exercises `timingSafeEqual`, not the length guard) | **401**, md5 `aa95ad29…` |
| `?secret=<correct>` in the query string while the secret is set | **401**, md5 `aa95ad29…` — D2 holds live |
| No header while the secret is set | **401**, md5 `aa95ad29…` |

**No real agent was executed.** The real agent probed is `scheduled`, so it is refused at the mode check; no agent was armed to `triggered` and no `PATCH` was issued.

### 4. Payload bounds (authenticated)

| Body | Result |
|---|---|
| `[1,2,3]` | 400 `Webhook payload must be a JSON object` |
| `"just a string"` | 400 `Webhook payload must be a JSON object` |
| `null` | 400 `Webhook payload must be a JSON object` |
| `42` | 400 `Webhook payload must be a JSON object` |
| `{not json` | 400 `Invalid JSON payload` |
| 300 KB (`204,811` bytes as counted by the route, > the `131,072` cap) | 400 `Payload too large` |

**Bounded before the agent lookup, proven black-box:** the same bad bodies sent to a **non-existent** agent id return 400 (`must be a JSON object` / `Payload too large`), **not** 404. The body is therefore rejected before the `agents` query, hence before `createExecution` and before either engine. Captured Pino confirms: the oversized request logged `payloadBytes: 204811, maxBytes: 131072` and then stopped — no "Found agent", no "Starting execution".

### 5. Regression — full suite, branch vs a rebuilt 59d7c357 baseline

Baseline rebuilt in place (`git checkout --` on the route → 25 `console.*` restored; the new `__tests__/` moved out of the tree), run, then both restored and **md5-verified** (`route.ts` → `de1ff6ebc723828b8ae3787625706ef6`, `route.test.ts` → `feedc2e38f7bedaf2c7647f74ed3439b`). Both runs `MSYS_NO_PATHCONV=1 npm test`.

| | Baseline 59d7c357 | Branch |
|---|---|---|
| Test Suites | 21 failed, 8 skipped, **380** passed, 401 of 409 | 21 failed, 8 skipped, **381** passed, 402 of 410 |
| Tests | **129 failed**, 58 skipped, **6091** passed, 6278 | **129 failed**, 58 skipped, **6100** passed, 6287 |
| Sorted FAIL-suite list | 21 entries | 21 entries — **`diff` clean, sets identical** |
| Sorted failing-test-title list | 130 entries | 130 entries — **`diff` clean, identical** |

Compared as sorted sets, not counts. The delta is exactly Dev's +1 suite / +9 tests. `PASS app/api/sentinel/webhook/[agentId]/__tests__/route.test.ts`; run alone: **9 passed, 9 total**.

### 6. Negative controls — three new weakenings (none of the four SA/Dev already ran)

Each applied to `route.ts`, suite run, then the file restored from a pre-mutation copy and **md5-verified back to `de1ff6eb…`**.

| # | Weakening | Predicted | Actual |
|---|---|---|---|
| **A** | **Break the comparison itself**: `return timingSafeEqual(presented, expected)` → `return true`, so any token of the right *length* is accepted (the classic broken constant-time compare) | T2 red | **T2 red, 8 green.** Exactly the predicted signature — T2 is the only test that presents a same-length wrong secret |
| **B** | **Cause-specific 401 body** for the *missing-header* cause (`{"success":false,"error":"Missing Authorization header"}`), gate still first | uncertain | **T5 red.** T5 pins the literal bytes, not just real-vs-random equality, so it catches this |
| **B2** | **Cause-specific 401 bodies for the other two causes** — malformed scheme → `Malformed Authorization header`, wrong secret → `{"error":"Invalid secret","hint":"check your token"}` (extra field, distinguishable bytes) | should be red | **9/9 GREEN — not caught.** See QA-2 |

Control A confirms the suite defends the comparison. B2 is the gap: a real D5 violation that ships green.

### 7. Logging

| Check | Result |
|---|---|
| `console.*` in the route | **0** (baseline `59d7c357`: **25**). 0 anywhere under `app/api/sentinel/` |
| Body/secret referenced in any `logger.*` call | **None** — grep for `webhookPayload` / `rawBody` / `parsedBody` / `authHeader` / `expected` / `presented` / `SENTINEL_WEBHOOK_SECRET` inside log calls returns nothing |
| Real Pino output (34 lines emitted by the route, captured out of the Jest run) | The rejection line is `{level:40, module:"SentinelWebhookAPI", correlationId, msg:"Rejected unauthorized sentinel webhook request"}` and **nothing else** — no secret, no header, no agentId, no body. The accepted path logs `agentId`, `payloadBytes`, `payloadKeyCount`, `agentName`, `mode`, `executionId` only |
| Test-fixture body value (`contact.created`) in the route's log lines | **0 occurrences** (the 8 hits in the 3 MB run log belong to a different module's fixture) |
| Test secret (`sentinel-test-secret-value`) anywhere in the run log | **0 occurrences** |
| Body content in the logs **for my probes** | None |
| Body content in the logs **in general** | **One path leaks — see QA-1** |

---

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| **D1** — env var `SENTINEL_WEBHOOK_SECRET`, `CRON_SECRET` untouched | ✅ | **Pass** | No `CRON_SECRET` reference in the route; setting `SENTINEL_WEBHOOK_SECRET` alone armed it live |
| **D2** — Bearer header only, no query fallback, no second header | ✅ | **Pass** | Live `?secret=` → 401 both dormant and armed; no `searchParams` / `nextUrl` / `x-api-key` reference in the file; T7 |
| **D3** — `timingSafeEqual` over Buffers, length guarded first, cannot throw; `runtime='nodejs'` | ✅ | **Pass** | Same-length wrong secret → 401 (no 500, so no throw escaped); empty Bearer → 401; mutation A proves the call is load-bearing |
| **D4** — fail closed in every environment, no dev bypass | ✅ | **Pass** | The dev server runs `NODE_ENV=development` and 401s with the secret unset (13/13 probes). The only `NODE_ENV` reference in the file is the pre-existing 500 `details` guard, not in the gate. T9 |
| **D5** — 401 with a single body, byte-identical for all four causes | ✅ | **Pass (behaviour)** / ⚠️ **(guard)** | All four causes verified live — identical body **and** headers. But only 2 of the 4 causes are byte-pinned by the suite — **QA-2** |
| **D6** — gate is the first statement; nothing downstream runs | ✅ | **Pass** | §2 — seven independent lines of evidence: black-box, source, and captured logs |
| **(i)** Zod object check + documented byte cap, 400, unknown keys through | ✅ | **Pass** | §4; 128 KB documented in code; object bodies pass, array/string/null/number rejected |
| **(ii)** Body-dumping `console.log` removed | ✅ | **Pass** | The line-61 dump is gone; `payloadBytes` / `payloadKeyCount` at `debug` only |
| **(iii)** 25 `console.*` → Pino, logging-only change | ✅ | **Pass** | 25 → 0; control flow, engine selection and the `agent_configurations` lookups are unchanged in the diff |
| **`logExecution()` repair** — helpers, `execution_type:'triggered'`, returned id is the written row's id | ⚠️ | **Partial — unit only** | T4 asserts the response id, the engine session id and the `completeExecution` target are all the `createExecution` row id, and the helper itself supplies the required `scheduled_at` and a legal `execution_type`. **No live insert was performed** (PENDING P1/P4) |
| **T1–T9 present and passing** | ✅ | **Pass** | 9/9, and they bite (mutations A and B) |
| **No regression vs 59d7c357** | ✅ | **Pass** | §5 — identical FAIL sets and identical failing-test titles, +9 tests |
| **Scope fence honoured** | ✅ | **Pass** | `git status` is exactly three paths: the route, the new `__tests__/`, this workplan. No migration, no UI, no dependency, no cron-route edits |
| **QA-1 status recorded as *mitigated*, not fixed** | ✅ | **Pass** | Per SA: one shared secret, no tenant isolation — any holder can trigger any tenant's agent as that tenant |

### Issues Found

#### Bugs (Dev should address; neither blocks commit)

1. **QA-1 — the JSON-parse failure path echoes the first 10 bytes of the untrusted body into the logs, contradicting the comment directly above it** — File: `app/api/sentinel/webhook/[agentId]/route.ts:154-156` — Severity: **Low**
   - Lines 154-155 state: *"Never log the body itself — it is untrusted third-party data that may carry customer PII"*. Line 156 then logs `{ err: error, … }` where `error` is the `SyntaxError` from `JSON.parse`. On Node 22 that error's `message` **embeds a verbatim prefix of the input** whenever the body does not start with `{` or `[`.
   - Steps to reproduce (through the real route with the real logger; I used a throwaway Jest probe, since deleted): authenticate, POST the body `email=alice@example.com&ssn=123-45-6789`.
   - Expected: no body bytes in the log line.
   - Actual: `{"level":40,…,"err":{"type":"SyntaxError","message":"Unexpected token 'e', \"email=alic\"... is not valid JSON","stack":"SyntaxError: Unexpected token 'e', \"email=alic\"... is not valid JSON\n    at JSON.parse …"}}` — the prefix appears in **both** `message` and `stack`.
   - Bounded: Node truncates at 10 characters (the full `alice@example.com` did **not** appear), the path requires the shared secret, and it only fires on malformed JSON. But 10 bytes is enough for a key prefix (`sk_live_51`) or the start of an address, and the code's own stated invariant is violated.
   - Suggested fix (one line): log `{ errName: (error as Error).name, agentId, payloadBytes }` instead of `{ err: error }`, or keep `err` and drop the message. Do **not** widen it.

2. **QA-2 — D5's byte-identity is pinned by the suite for only 2 of the 4 rejection causes** — File: `app/api/sentinel/webhook/[agentId]/__tests__/route.test.ts` — Severity: **Low** (test-guard gap; the shipped behaviour is correct)
   - T1/T9 pin the exact bytes for *unset secret*; T5 pins them for *missing header*. T2, T6 and T7 assert **status only**, so the *malformed-scheme* and *wrong-secret* causes have no byte assertion anywhere.
   - Proven, not inferred: mutation **B2** returned `Malformed Authorization header` for one cause and `{"error":"Invalid secret","hint":"check your token"}` for another — exactly the "helpful error message" refactor D5 exists to forbid — and the suite was **9/9 green**.
   - Same shape as the lesson SA cites for D6: *present ≠ first*; here, *identical today ≠ pinned by a test*.
   - Suggested fix (a few lines in T2): capture `await res.text()` for the wrong-secret, no-header, malformed-scheme and unset cases and assert all four equal `JSON.stringify({ success: false, error: 'Unauthorized' })`.

#### Performance Issues

None. The 401 path is ~0.14 s in dev with no I/O in it; the gate adds one env read and one buffer compare.

#### Edge cases (nice to fix, none blocking)

1. **The `createExecution`-fails path has no test.** SA explicitly ruled on this behaviour (execute anyway, `executionId: null`, skip `completeExecution` / `failExecution`) and approved it — but every test stubs `createExecution` as succeeding, so the ruling is unguarded. One test (`createExecution` → `{ data: null, error }`; assert 200 with `executionId: null`, `runAgentKit` still called once, `completeExecution` **not** called) would lock the approved semantics in.
2. **SA's non-blocking condition 1 from the code review is not yet done** — the `executionId: null` response contract is not in the endpoint JSDoc (lines 85-100 do not mention it). Documentation only.
3. **`completeExecution(id, { success, executionPath, result: executionResult }, …)` may persist the webhook body indirectly.** The raw body is correctly never persisted by the route, but if an engine's result object echoes its `userInput` (which is `JSON.stringify(webhookPayload)`), it lands in `agent_executions.result`. Unverified — needs a live triggered execution (PENDING P1). Worth one look when the per-agent-secret work lands.
4. `GET` / `PUT` / `DELETE` → 405 without consulting the secret. Confirmed live (GET 405). Accepted per SA note 4: it reveals only that the path exists, and touches no data.

### Pending (cannot be closed in this session)

| # | Item | Why it is pending |
|---|---|---|
| **P1** | **True end-to-end execution of a `triggered` agent (T4 live)** | 0 of 86 live agents are `mode='triggered'` (Dev's count; the one real agent I probed is `scheduled`). Arming a real user's agent would execute it against their connected plugin accounts, so it was **not** done and is **not** reported as passing. T4 covers it against mocks only. Close it on the first genuine Sentinel integration |
| **P2** | **Production behaviour after deploy** | The route ships dormant (401 everywhere) until someone with Vercel admin sets `SENTINEL_WEBHOOK_SECRET`. Approved state, unverifiable from here |
| **P3** | **Whether an undiscovered external caller exists** | Only Vercel request logs can settle it (SA "Needs the user" item 1). Not repo- or DB-visible |
| **P4** | **DB-side confirmation that my probes wrote no `agent_executions` row** | Direct Supabase REST reads were blocked by this session's sandbox (production-read denial). Substituted: the response evidence in §2 and §4, which shows control never reached `createExecution`. A row count before/after would make it airtight |

### Final Status

- [x] **All acceptance criteria pass — ready for commit**, with two **Low** items (QA-1, the body prefix in the JSON-parse error log; QA-2, the D5 test-guard gap) recorded for Dev. Neither is High or Medium; neither weakens the shipped security property; both are one-to-few-line fixes a reviewer may reasonably want folded into this diff rather than deferred.
- [ ] No High severity bug is open.

**QA-1 (the identity-sweep finding) is closed as *mitigated (deployment gate)*, not *fixed*.** The anonymous-internet hole is shut and verified shut on a live server. Tenant isolation is **not** achieved: any holder of `SENTINEL_WEBHOOK_SECRET` can still trigger **any** user's agent, executing as that user with their connected plugin credentials. The per-agent secret / HMAC requirement (options b/c) remains open and is the real fix.

As instructed by SA and re-confirmed by testing, the **authenticated** 400 that echoes `Current mode: "scheduled"` is **not** reported as an information leak — it is inherent to one shared secret and is precisely why (b)/(c) is a separate requirement. It is an oracle only for *unauthenticated* callers, and that oracle is closed (§1, probe M vs D).

**Environment restored:** `.env.local` md5 `67d66142c5682c459f47520ee7562b89` (unchanged from before QA, `diff` clean, no `SENTINEL_WEBHOOK_SECRET` line); `route.ts` md5 `de1ff6ebc723828b8ae3787625706ef6`; `route.test.ts` md5 `feedc2e38f7bedaf2c7647f74ed3439b`; `git status` shows the same three paths as before QA; nothing staged, nothing committed; no server started or stopped.

## Commit Info

_RM to populate._

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-21 | Created | Investigation + options for QA-1; no implementation |
| 2026-09-21 | SA decision | Option (d) approved with conditions D1-D6; Zod + Pino + body-logging + logExecution() repair ruled IN scope; delete / per-agent secret / HMAC / migration / UI ruled OUT; 9 required tests (T5-T9 added) |
| 2026-09-21 | SA code review | ✅ Code Approved, no required fixes. Verified independently: gate-first, byte-identical 401s, timingSafeEqual non-throwing, zod 3.25.76 record rejects arrays, byte-based cap, row id returned, 0 console.*, scope fence intact. Own mutation run (fail-open) reproduced T1+T9 red. Ruled Dev's createExecution-failure path (execute anyway, executionId null) correct — not a 500 |
| 2026-09-21 | Dev implementation | Option (d) built: gate-first shared secret (D1-D6), minimal Zod + 128 KB cap, 25 console.* to Pino, logExecution repaired onto executionHelpers; 9 tests + 3 mutation controls; no regression vs 59d7c357 |
| 2026-09-21 | QA | Full QA: 13 live probes on :3007 (all four rejection causes byte-identical in body AND headers; real vs random agent id indistinguishable), gate-first proven black-box (body never read, no DB round-trip, 0.147s vs 0.404s), happy path exercised with the secret set then .env.local restored md5-identical, payload bounds enforced pre-lookup, full-suite regression vs a rebuilt 59d7c357 baseline with identical FAIL sets (+9 tests), three new mutation controls. Verdict PASS; QA-1 recorded as mitigated (deployment gate). Two Low findings: the JSON-parse error echoes 10 body bytes into the logs; D5 byte-identity is pinned for only 2 of 4 causes (mutation B2 ships green). 4 PENDING items |
| 2026-09-21 | Dev QA fixes | QA-1: JSON-parse catch logs `errName` not `{ err }` (V8 embeds a body prefix in message+stack); other seven err-sites audited, three engine catches flagged as pre-existing residual. QA-2: T2 now pins the 401 bytes across all four rejection causes — QA's B2 mutation goes red |
