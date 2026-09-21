# Workplan: API Identity-Hardening Sweep

> **Last Updated**: 2026-09-21

## Overview

Three cycles have now fixed the same defect class one route at a time: an API route derives the
caller's identity from a request-supplied value (an `x-user-id` header, a body `userId`, a query
`?userId=`) instead of from the session, and frequently reads or writes another user's data through
a service-role client. Fixed so far: `analyze-prompt-clarity`, `enhance-prompt`,
`generate-clarification-questions`, `GET /api/plugins/execute`, `GET /api/plugins/action-schema`,
`help-bot-v2` and its `feedback` sibling.

SA's ruling at the end of the last cycle
([security-followups-workplan.md](/docs/workplans/security-followups-workplan.md) § *Architectural
recommendation for TL*) was to stop fixing them one at a time:

> Commission a single **legacy `x-user-id` sweep**: enumerate every `app/api/**` route that derives
> identity from a body field or header, classify each as (a) user-scoped read/write → must gate,
> (b) attribution only → replace with the session id, (c) genuinely public → document; then add a
> guard test in the shape of `admin-authz-surface.guard.test.ts` so the next one cannot land.
> **The guard is what makes it stick.**

This workplan is that sweep. It covers the full inventory, a per-route classification, the fixes,
a repo-wide guard test, and the CI job that runs it (plus two existing guards that today run only
under a local full `npm test`).

**Developer:** Dev · **Reviewer:** SA · **Date:** 2026-09-21
**Branch:** `fix/identity-sweep` (worktree `C:\Users\Barak\My Projects\AgentsPilot\neuronforge-identity-sweep`, originally cut from `origin/main` 461a3fbc; **rebased onto `origin/main` cddc1916** on 2026-09-21, which adds PRs #83, #84 and #85)
**Requirement:** none — this is SA's recorded architectural recommendation, carried as F15/F16 follow-on work
**Status:** Planning — **not yet SA-reviewed, no code written**

---

## Table of Contents

- [Scope and non-goals](#scope-and-non-goals)
- [Method](#method)
- [Inventory](#inventory)
- [Classification](#classification)
- [Counts](#counts)
- [The established fix shape](#the-established-fix-shape)
- [Proposed slicing](#proposed-slicing)
- [Guard design](#guard-design)
- [CI design](#ci-design)
- [Files to create / modify](#files-to-create--modify)
- [Task list](#task-list)
- [Test plan](#test-plan)
- [Risk and rollback](#risk-and-rollback)
- [Open questions for SA](#open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [Slice 0 Implementation (Dev)](#slice-0-implementation-dev--2026-09-21)
- [SA Code Review — Slice 0](#sa-code-review--slice-0)
- [Slice 0 — RF1 and Rebase (Dev)](#slice-0--rf1-and-rebase-dev--2026-09-21)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Scope and non-goals

**In scope:** every `route.ts` under `app/api/**` (387 files) whose handler takes a user identity
from the request rather than the session; the local helpers that implement that pattern; a guard
test; a CI job.

**Explicitly NOT in scope** (per the standing instruction for this branch):

| Not doing | Why |
|---|---|
| Converting `console.*` to Pino | Tracked separately as **F17** (108 calls across four legacy prompt routes, plus 33 + 4 + 9 in the `help-bot-v2` family). Several files this branch touches are non-compliant — see [Open questions for SA](#open-questions-for-sa) Q6, which surfaces them per CLAUDE.md § Logging rather than silently leaving them. |
| Refactoring, Zod conversion, repository-pattern migration | Enlarges the review surface of a security branch for no security gain. Each is recorded as a follow-up where found. |
| Unrelated lint or `tsc` errors | The baseline is already red (~2,035 `tsc` errors, ~10k lint problems on `main`). The bar is **no new errors**, measured against `461a3fbc`. |
| Client components that *send* `x-user-id` (8 files) | The server ignoring the header is the invariant. PR #80 and #82 both left their client sends in place for the same reason: a same-origin browser `fetch` sends the session cookie anyway, so the header is inert, and removing it is a second, independently-revertable change. |
| IDOR by *resource* id (e.g. an `agentId` read without `.eq('user_id')`) | A different defect class. Where the sweep incidentally found one it is recorded as a follow-up, not fixed here — see Q8. |

---

## Method

Four passes, because a single grep under-counts in one direction and over-counts in the other:

1. **String pass** — `grep -rl "x-user-id" --include=route.ts app/api` → **20** files. This is the
   figure the brief quotes as "19". It over-counts: only **12** contain an actual
   `headers.get('x-user-id')` call; the other 8 are explanatory comments left by the previous three
   cycles, one CORS `Access-Control-Allow-Headers` string, and one `headers.has(...)` telemetry
   counter. **The over-count is itself a finding** — it is exactly the false positive the guard has
   to be designed against.
2. **Shape pass** — a script over all 387 `route.ts` files matching four request-sourced identity
   shapes (`headers.get('x-user-id')`, `searchParams.get('user_id'|'userId')`,
   `<bodyish>.user_id|userId`, destructuring `userId` out of `await request.json()`), recording for
   each file whether a session source and/or a service-role client is present → **31** candidate
   files.
3. **Loose pass** — a deliberately noisier regex to catch shapes the shape pass would miss
   (two-step destructuring, `params.id` targets) → **29** candidates, 6 of them new.
4. **Read pass** — every candidate from 2 and 3 read by hand, including what the value flows into
   and which client calls the route. This is where the grep-level assumptions broke: three
   "matches" were `pageResult.data.user_id` (a DB row field, not caller input), and one
   (`app/api/agents/[id]/route.ts`) defines the vulnerable helper but **never calls it**.

The brief's two named ambiguities were both checked by reading, and both resolved against the
guess a grep would have produced — see rows A-1 and E-40 below.

---

## Inventory

Every route file where a user identity enters from the request. `Session?` = the file references
`getUser()` / `auth.getUser()` / `requireAdmin` / `resolveActingUserIdentity` /
`createAuthenticatedServerClient`. `SR?` = a service-role (RLS-bypassing) client is in play.

| # | Route file | Handler | Identity enters via | Flows into | Session? | SR? | Class |
|---|---|---|---|---|---|---|---|
| 1 | `app/api/agents/route.ts` | GET | `x-user-id` (local `getUserIdFromRequest`) | `agentRepository.findAllByUser(userId)` — every agent name, prompt, schedule, status | ❌ | ❌ | **Gate** |
| 2 | `app/api/agents/[id]/duplicate/route.ts` | POST | `x-user-id` (local helper) | duplicates an agent **into** that account | ❌ | ❌ | **Gate** |
| 3 | `app/api/agents/[id]/executions/route.ts` | GET | `x-user-id` (local helper) | execution history + per-execution token usage via `supabaseServer` | ❌ | ✅ | **Gate** |
| 4 | `app/api/agents/[id]/intensity/route.ts` | GET | `x-user-id` (local helper) | intensity metrics; module-level service-role client (`:26`) | ❌ | ✅ | **Gate** |
| 5 | `app/api/agents/[id]/memory/count/route.ts` | GET | `x-user-id` (local helper) | `agent_memory` count via `createServerSupabaseClient` | ❌ | ✅ | **Gate** |
| 6 | `app/api/agents/[id]/metrics/route.ts` | GET | `x-user-id` (local helper) | agent metrics | ❌ | ❌ | **Gate** |
| 7 | `app/api/agents/[id]/status/route.ts` | POST | `x-user-id` (local helper) | **activates / deactivates** an agent | ❌ | ❌ | **Gate** |
| 8 | `app/api/shared-agents/route.ts` | POST | `x-user-id` (local helper) | publishes one of that user's agents to the community | ❌ | ❌ | **Gate** |
| 9 | `app/api/shared-agents/exists/route.ts` | GET | `x-user-id` (local helper) | shared-status probe for an agent id | ❌ | ❌ | **Gate** |
| 10 | `app/api/approvals/[id]/respond/route.ts` | POST | `body.userId` (`:23`) | **the authorization decision itself** — `approvalRequest.approvers.includes(userId)` (`:68`), then records an approve/reject | ❌ | ❌ | **Gate** |
| 11 | `app/api/v6/generate-ir-intent-contract/route.ts` | POST | `x-user-id` (`:43`) | vocabulary extraction, user memory context, failure patterns, intent examples, capability binding — all via `supabaseServer` | ❌ | ✅ | **Gate** |
| 12 | `app/api/v6/fetch-plugin-data/route.ts` | POST | `body.userId` (`:39`) | `pluginExecuter.execute(userId, pluginName, actionName, parameters)` — **runs a plugin action with the victim's stored OAuth credentials** | ❌ | via executor | **Gate** |
| 13 | `app/api/v6/execute-test/route.ts` | POST | `body.user_id` (`:76-106`), UUID **or email** | resolves an email to a UUID via `auth.admin.listUsers()`, then executes a workflow as that user | ❌ | ✅ | **Gate** |
| 14 | `app/api/test/analyze-prompt/route.ts` | POST | `body.userId` (`:11`) | `analyzePromptDirectAgentKit(userId, …)` → `convertPluginsToTools` + `getPluginContextPrompt` put the victim's connected-plugin inventory into an LLM answer | ❌ | via plugin layer | **Gate** |
| 15 | `app/api/analyze-workflow/route.ts` | POST | `body.userId \|\| x-user-id \|\| 'anonymous'` (`:40`) | AI-analytics attribution only (`:72`) — **SA finding F16** | ❌ | ✅ | **Attribution** |
| 16 | `app/api/generate/input-schema/route.ts` | POST | `body.userId` (`:19`) | AI-analytics attribution only (`:59`, `userId \|\| 'anonymous'`) | ❌ | ❌ | **Attribution** |
| 17 | `app/api/v6/compile-workflow/route.ts` | POST | `body.userId` (`:130`) | passed to the compiler as `user_id` and embedded in the emitted workflow; no read | ❌ | ❌ | **Ambiguous** |
| 18 | `app/api/v6/generate-semantic-grounded/route.ts` | POST | `body.userId` (`:208`) | **required, validated, then never used** | ❌ | ❌ | **Ambiguous** |
| 19 | `app/api/website/booking/intake/route.ts` | POST | `body.userId` or `subdomain` (`:188`) | `supabaseServer` booking lookup scoped by `(bookingId, userId)`, then the flow is unconditionally refused (retired) | ❌ | ✅ | **Ambiguous** |
| 20 | `app/api/website/booking/intake/route.ts` | GET | `?userId=` / `?subdomain=` (`:50`) | the **business owner being viewed** on a public booking page — a target, not a claim | ❌ | ✅ | **Public** |
| 21 | `app/api/website/public/[subdomain]/route.ts` | GET | none — `pageResult.data.user_id` (`:134`) | owner derived server-side from the subdomain. Shape-pass false positive | ❌ | ✅ | **Public** |
| 22 | `app/api/website/analytics/track/route.ts` | POST | `subdomain` (public) or `page_id` (auth'd) | anonymous branch derives the owner from the page (`:81`); the `page_id` branch 401s without a session (`:63`) | ✅ | ✅ | **Public** |
| 23 | `app/api/stripe/webhook/route.ts` | POST | `userId` from Stripe event metadata | subscription/payment processing | ❌ | ✅ | **Public** |
| 24 | `app/api/cron/process-queue/route.ts` | POST | `body.user_id` from the QStash job payload (`:165`) | agent execution | ❌ | ✅ | **Public** |
| 25 | `app/api/plugins/additional-config/route.ts` | POST, GET | `userId` → `resolveActingUserIdentity` | act-as, admin-only, audited | ✅ | ❌ | **Safe** |
| 26 | `app/api/plugins/disconnect/route.ts` | POST, GET | same | same | ✅ | ❌ | **Safe** |
| 27 | `app/api/plugins/user-status/route.ts` | GET | same | same | ✅ | ❌ | **Safe** |
| 28 | `app/api/plugins/refresh-token/route.ts` | POST | same | same | ✅ | ❌ | **Safe** |
| 29 | `app/api/plugins/execute/route.ts` | POST, GET | same (PR #73 / F10) | same | ✅ | ❌ | **Safe** |
| 30 | `app/api/plugins/test-audit/route.ts` | POST | same | same | ✅ | ❌ | **Safe** |
| 31 | `app/api/plugin-connections/route.ts` | POST, DELETE, GET | same | same | ✅ | ✅ | **Safe** |
| 32 | `app/api/llm/context/route.ts` | GET | `?userId=` accepted, logged, **discarded** (`:69-76`) | session id only | ✅ | ❌ | **Safe** |
| 33 | `app/api/onboarding/allocate-free-tier/route.ts` | POST | `body.userId` must equal the session id (`:73-79`) | session id only | ✅ | ❌ | **Safe** |
| 34 | `app/api/website/generate-from-profile/route.ts` | POST | `body.userId`, 401 on mismatch (`:69`) | session id | ✅ | ❌ | **Safe** |
| 35 | `app/api/audit/query/route.ts` | GET | `headers.has('x-user-id')` — a **boolean counter only** (`:33`), temporary, dated for removal | nothing | ✅ | ❌ | **Safe** |
| 36 | `app/api/audit/log/route.ts` | POST | header and body `userId` documented as ignored | session id | ✅ (via `handleClientAuditWrite`) | ❌ | **Safe** |
| 37 | `app/api/admin/chat-usage/route.ts` | GET | `?userId=` as an **admin target filter** | admin-scoped read | ✅ | ❌ | **Safe** |
| 38 | `app/api/admin/users/[id]/{audit-logs,login-stats,stats}/route.ts` | GET | `params.id` as an admin target | admin-scoped read | ✅ | ✅ | **Safe** |
| 39 | `app/api/admin/settings/admin-users/route.ts` | POST | `body.userId` as an admin target | admin write | ✅ | ✅ | **Safe** |
| 40 | `app/api/agents/[id]/route.ts` | GET, PUT, DELETE | defines `getUserIdFromRequest` at `:16-29` — **never called** | all three handlers use `createAuthenticatedServerClient().auth.getUser()` | ✅ | ✅ | **Safe** (dead helper) |

---

## Classification

### A. Gate — 14 routes

Identity drives access to user-scoped data or a state change. Fix: `getUser()` + 401 before any
other work, session id only, header/body id never read.

Ordered by what an anonymous caller can actually do today, which is also the proposed fix order:

| Severity | Route | What an anonymous caller can do right now |
|---|---|---|
| 🔴 **Critical** | `v6/fetch-plugin-data` (12) | POST a victim's UUID plus any plugin/action and have the server **execute it with their stored OAuth tokens** — read their Gmail, write their Drive, send on their behalf. No authentication of any kind. |
| 🔴 **Critical** | `v6/execute-test` (13) | Same, one level up: execute a whole workflow as any user, and supply an **email address** instead of a UUID — the route resolves it through `auth.admin.listUsers()`, which is also a user-enumeration oracle. |
| 🔴 **High** | `approvals/[id]/respond` (10) | Approve or reject any pending human-in-the-loop approval by naming an approver. The body `userId` **is** the authorization check, so supplying a valid approver id passes it. Unblocks or kills another user's paused workflow run. |
| 🔴 **High** | `v6/generate-ir-intent-contract` (11) | Read a victim's learned vocabulary, memory context, failure patterns and stored intent examples — all through `supabaseServer`, all reflected into the response. Same class as F15 but a richer payload. |
| 🟠 **Medium** | `agents` GET (1), `agents/[id]/{executions,intensity,memory/count,metrics}` (3–6), `shared-agents/exists` (9) | Enumerate a victim's agents and their execution history, token spend and memory counts, given a user id. Rows 3–5 do it through a service-role client. |
| 🟠 **Medium** | `agents/[id]/status` POST (7), `agents/[id]/duplicate` POST (2), `shared-agents` POST (8) | **Writes.** Deactivate a victim's scheduled agent, duplicate one into their account, or publish one of their agents to the community feed. |
| 🟠 **Medium** | `test/analyze-prompt` (14) | Get a victim's connected-plugin inventory and action catalogue summarised back by an LLM. Zero in-repo callers — see Q3. |

**Why gating is safe for all 14.** Every in-repo caller is a browser `fetch` from a signed-in page:
rows 1–9 via `lib/client/agent-api.ts` (`getAuthHeaders` at `:62-71`) and `components/v2/**`,
row 10 from `app/(protected)/approvals/[id]/page.tsx:71`, row 11 from `app/v2/agents/new/page.tsx:1315`,
row 13 only from `scripts/qa-v6-execution-layer.ts`, rows 12 and 14 from nothing at all. A
same-origin browser `fetch` sends the session cookie by default, so **no client change is needed
and none is proposed** — the same conclusion PR #80 and #82 reached and verified.

### B. Attribution — 2 routes

The caller-supplied id is only used to label an AI-analytics row. No user-scoped read.

| Route | Finding | Proposed |
|---|---|---|
| `analyze-workflow` (15) | **SA's F16**, recorded Low: spoofable attribution, not a disclosure | Attribution switched to the session id **and** the route gated — see below |
| `generate/input-schema` (16) | Not previously recorded. Identical shape (`userId \|\| 'anonymous'` into `AIAnalyticsService`) | Same |

**Recommendation — gate these too, and the reasoning is not mine but SA's own.** The brief says
attribution cases should switch to the session id and *not* be gated. That is right for the
attribution defect in isolation, but both routes are also **unauthenticated `gpt-4o` endpoints**
(`analyze-workflow`: 2,000 max tokens per call; `input-schema`: a JSON-mode completion per call),
and that is precisely the argument SA accepted and QA verified one cycle ago for `help-bot-v2`:

> Gating only `searchAgents` would close the enumeration and leave an unauthenticated cost-burn and
> shared-cache-poisoning endpoint behind.
> — [help-bot-v2-auth-workplan.md](/docs/workplans/help-bot-v2-auth-workplan.md) § Decision

The only caller of each is a signed-in wizard step (`components/wizard/workflowAnalysis.ts:81`,
`components/wizard/Step4Schemas.tsx:276`), so gating costs no real user anything. Raised as **Q1**
rather than assumed, because it deviates from the brief's instruction.

### C. Ambiguous — 3 routes, SA decision needed

| Route | Why it is not obvious | Proposed |
|---|---|---|
| `v6/compile-workflow` (17) | `body.userId` is stamped into the compiled workflow's `user_id` and returned to the caller. Nothing is read, so there is no disclosure — but the emitted artefact carries an unverified owner id, and if that workflow is later saved or executed the id becomes load-bearing somewhere else. No in-repo caller. | Gate, and take `user_id` from the session. **Q2** |
| `v6/generate-semantic-grounded` (18) | `body.userId` is required and validated at `:208-211` and then **never used**. Not a vulnerability. But the route is an unauthenticated multi-phase LLM pipeline with no in-repo caller. | Delete the unused field and gate the route, or delete the route. **Q2 / Q3** |
| `website/booking/intake` POST (19) | Takes `userId` (or resolves it from a subdomain), does a `supabaseServer` read of `scheduling_bookings` scoped by `(bookingId, userId)` — **then refuses the request unconditionally**, because the in-flow intake was retired. The read still happens first, so a 404-vs-refusal difference is a weak existence oracle for (booking, owner) pairs. | Move the refusal above the lookup — a 3-line change, no behaviour change for any caller. **Q4** |

### D. Legitimately public — 5 routes

Each keeps its current behaviour; the change is a route-header comment stating *why* it is public
and what is provably unreachable, plus an entry in the guard's reviewed allow-list.

| Route | Why public, and why no user data is reachable |
|---|---|
| `website/booking/intake` GET (20) | A public booking page. The `userId`/`subdomain` names the **business owner being viewed**, not the caller. Returns the owner's published intake template only. The equivalent of a public profile URL. |
| `website/public/[subdomain]` (21) | Owner id is derived **server-side** from the subdomain (`pageResult.data.user_id`), never supplied. Serves published page content, active services, plans and branding — all owner-published-public by definition. Shape-pass false positive. |
| `website/analytics/track` (22) | Two branches, both already correct: `page_id` (preview) 401s without a session and scopes the lookup to `user.id`; `subdomain` (visitor) derives the owner from the page. Already has `getUser()`. |
| `stripe/webhook` (23) | `userId` comes from Stripe event metadata on a payload verified by `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET` (`:2288-2305`). The signature *is* the authentication. |
| `cron/process-queue` (24) | `user_id` comes from a QStash job body wrapped in `verifySignatureAppRouter` in production (`:429-431`). Machine-to-machine. **Note:** unsigned in non-production by design — worth a one-line comment saying so. |

### E. Already safe — 18 routes, do not churn

| Group | Routes | Why safe |
|---|---|---|
| Plugin family on the canonical resolver (25–31) | `plugins/{additional-config,disconnect,user-status,refresh-token,execute,test-audit}`, `plugin-connections` | All 7 route through `resolveActingUserIdentity` (`lib/server/route-identity.ts`), which fails closed: no session → 401, bad UUID → 400, non-admin act-as → 403, and audits every admin act-as. A supplied `userId` is only ever logged as `requestedUserId`. |
| Session-verified with a legacy field (32–34) | `llm/context`, `onboarding/allocate-free-tier`, `website/generate-from-profile` | Each accepts a legacy `userId` for backward compatibility and either discards it or 401s on mismatch. All three carry a comment explaining the decision. |
| Audit (35–36) | `audit/query`, `audit/log` | Hardened in the Layer 3 step-0 work. `audit/query` only calls `headers.has('x-user-id')` to *count* rejected legacy callers — a boolean can never be an identity. Dated for removal after 2026-09-25 by its own comment; not this branch's business. |
| Admin target ids (37–39) | `admin/chat-usage`, `admin/users/[id]/{audit-logs,login-stats,stats}`, `admin/settings/admin-users` | The supplied id is the **subject** of an admin action, which is the point of an admin route. All sit behind `requireAdmin` or an equivalent `AdminAccessService` check, which the admin-authz guard already enforces. |
| Dead helper (40) | `agents/[id]/route.ts` | **The brief's first named ambiguity, resolved by reading.** The file defines `getUserIdFromRequest` at `:16-29`, but **no handler calls it** — GET (`:41`), PUT (`:152`) and DELETE (`:459`) each build `createAuthenticatedServerClient()` and use `auth.getUser()`. It is neither a bypass nor a fallback: it is dead code that makes the file grep as vulnerable. Proposed change: **delete the 14-line helper, nothing else.** |

**Business OS confirmed, as the brief asked.** All **38** `route.ts` files under `app/api/business-os/**`
reference `getUser()`, `requireAdmin` or `resolveActingUserIdentity` — **zero** missing. None appears
in the inventory. They stay in the guard's scan scope so the 39th inherits the invariant.

**The brief's second named ambiguity — `shared-agents`.** The helper does return the header value
when present, and it *is* a straight bypass: `getUserIdFromRequest` is the only identity source in
either file and neither calls `getUser()`. But the routes are **not** part of a public flow. `POST
/api/shared-agents` publishes *the caller's own* agent (`agentRepository.findById(agentId, userId)`
is scoped to the claimed owner), and `GET /exists` probes share status for an agent id. Neither
lists nor serves the community feed — that is `app/api/agents/import-shared/route.ts`, a different
file that does not appear in this inventory. So both are Gate, and gating does not touch
shareability.

---

## Counts

| Classification | Route files | Handlers |
|---|---|---|
| **A. Gate** — must fix | 14 | 14 |
| **B. Attribution** — use the session id | 2 | 2 |
| **C. Ambiguous** — SA decision | 3 | 3 |
| **D. Legitimately public** — document only | 5 | 6 |
| **E. Already safe** — do not churn | 18 | 28 |
| **Total with request-sourced identity** | **40** (of 387 `app/api` route files) | 53 |

Of the 20 files whose text contains `x-user-id`: **11** trust it as identity (rows 1–9, 11, 15),
**1** defines a helper that reads it but is never called (row 40), **1** counts it as a boolean
(row 35), **1** lists it in a CORS header string (row 18), and **6** mention it only in comments
left by the previous three cycles.

---

## The established fix shape

Two shapes are already in the codebase. **No third shape is introduced.**

**Shape 1 — plain gate** (PR #80, PR #82 — `analyze-prompt-clarity`, `enhance-prompt`,
`generate-clarification-questions`, `help-bot-v2`, `help-bot-v2/feedback`). The default for all 14
Gate routes.

**Reference file:** `app/api/help-bot-v2/route.ts` (merged)

- `getUser()` as the first statement in the `try`, **before `request.json()`** — so a malformed body
  cannot reach a parser and an early-returning branch cannot skip the gate (QA verified this exact
  case with a non-JSON body → 401, not 400).
- 401 in the route's **own existing envelope**. Most routes here use CLAUDE.md's
  `{ success: false, error: 'Unauthorized' }`; the `help-bot-v2` family deliberately uses bare
  `{ error }` because its clients branch on `data.error`. Per-route check, not a blanket rewrite —
  SA recorded the consequence of getting this backwards (a refusal that renders as a successful
  empty answer).
- `userId` becomes `user.id`. The request-sourced value is not read at all, not even as a fallback.
- The local `getUserIdFromRequest` helper is **deleted**, not left unused — nine copies of it is how
  this pattern spread, and a dead copy is how row 40 ended up grepping as vulnerable.

**Shape 2 — act-as resolver** (`lib/server/route-identity.ts`, PR #73). Used where an admin
legitimately needs to act for another user. Applies to **none** of the 14 Gate routes — none has an
admin-act-as use case today. Noted so the guard accepts it as a session source and so a future route
does not invent a third way.

---

## Proposed slicing

The sweep is bigger than one reviewable change: 19 route files edited, ~19 new test suites, a
~700-line guard and a CI workflow. **Proposed as two PRs on this one branch, in this order** —
which inverts the brief's suggested order, deliberately:

| Slice | Contents | Size |
|---|---|---|
| **A — guard + CI + the four criticals** | The guard test, `test:security-guards`, `security-guards.yml`. Guard ships **red-by-allow-list**: all 16 open routes listed as dated `PARKED` exemptions stating what an anonymous caller can do. Then gate the four 🔴 routes (10, 11, 12, 13), delete their exemptions and lower the caps in the same commit. | ~1,000 lines, 4 route edits, 4 test suites |
| **B — the remaining ten Gate routes, the Attribution pair, the ambiguous three** | Rows 1–9 and 14, plus 15–16, plus whatever SA rules on 17–19. Each exemption deleted with the cap lowered by the same number. Ends with both allow-lists empty except the 5 documented-public entries. | 15 route edits, 15 test suites |

**Why the guard goes first, not last.** The brief suggested "gate-cases first, guard+CI second". The
admin-authz programme did the opposite on purpose and recorded why:

> The guard shipped WITH the first security slice, not after the last one, and it shipped
> RED-BY-ALLOW-LIST. The alternative — "introduce the gate once the repo is clean" — is the standard
> way this kind of programme loses its only structural guarantee: the gate becomes the cheapest thing
> to cut once the urgency is gone.
> — `lib/admin/__tests__/admin-authz-surface.guard.test.ts`

That programme has six parked slices and the guard still stands, which is the evidence. Guard-first
also means every commit in slice B *proves* the ratchet works, and the four criticals in slice A give
the first PR real security value rather than being pure tooling. Raised as **Q5** — TL/SA may prefer
the brief's order, and a single combined PR is also viable if SA would rather review it once.

---

## Guard design

**File:** `app/api/__tests__/identity-surface.guard.test.ts` (new)

Modelled directly on `lib/admin/__tests__/admin-authz-surface.guard.test.ts`: static scan of the
repo's source text, allow-list never deny-list, every exemption dated with a written reason,
asserted **caps** so removing an exemption forces lowering the cap in the same commit (the ratchet),
input-floor assertions so an emptied scan fails rather than passes, and a `PARKED` / `PERMANENT`
split so "not yet done" never reads as "architecturally fine".

### Rules

| Rule | Scans | Fails when | Expected exemptions after the sweep |
|---|---|---|---|
| **I1** | every `route.ts` repo-wide | a **call** of the form `headers.get('x-user-id')` appears in code | **0** |
| **I2** | every `route.ts` under `app/api/**` | a caller-supplied user id is read (query `userId`/`user_id`, or a `userId` resolved from `await request.json()` / a Zod parse of the request) **and** the file references no session source | 5 — the documented-public routes (D) |
| **I3** | every `route.ts` repo-wide | a function is declared whose body reads an identity header or body `userId` and returns it as a value (the `getUserIdFromRequest` / `extractIdFromRequest` shape) | **0** |
| **I4** | — | *(inverted rule: "every non-public route must reference a session source at all")* | **PARKED, not built** — see below |

**Session sources accepted by I2:** `getUser(`, `auth.getUser(`, `requireAdmin`,
`resolveActingUserIdentity`, `createAuthenticatedServerClient`, plus the two signature-verified
machine paths (`constructEvent`, `verifySignatureAppRouter`) which are authentication of a different
kind.

**Why I4 is parked rather than built** — the same reasoning that parked R7 in the admin guard, and it
applies harder here: 387 route files, many legitimately session-free (OAuth callbacks, webhooks,
crons, public website surfaces, health checks). A repo-wide "must have a session" rule would need
dozens of exemptions on day one, and *a false positive on a required status check is the single
thing most likely to get the check switched off*. I1–I3 catch the realistic recurrence: the
recurrence is always someone reading an id from the request, never someone forgetting `getUser()` in
the abstract. Recorded as a known gap in the guard's own header, with the revisit condition.

### False-positive story

Five shapes in the current tree would trip a naive implementation. Each is designed against, and
each gets its own fixture test:

| # | Shape | Live example | Handling |
|---|---|---|---|
| 1 | `x-user-id` **in a comment** | 6 files, all comments written by the last three cycles explaining that the header is now ignored | Comments stripped before matching. The stripper is **unit-tested against those exact files** — a mangling stripper is the precedent guard's own past bug, and it fails silently in the permissive direction. |
| 2 | `x-user-id` in a **CORS allow-list string** | `v6/generate-semantic-grounded:560` — `'Content-Type, Authorization, x-user-id'` | I1 matches the **call shape** `headers.get('x-user-id')`, never the bare string. Fixture asserts that exact line does not trip it. |
| 3 | `headers.has('x-user-id')` | `audit/query:33`, a rejected-caller counter | `.has()` returns a boolean and can never be an identity. Only `.get()` matches. **No exemption needed**, which is better than an exemption. |
| 4 | `<row>.user_id` from a **DB result** | `website/analytics/track:81`, `website/public/[subdomain]:134`, `website/booking/intake:56` — all `pageResult.data.user_id` | I2 resolves **one level of local variables back to a request source** (`await request.json()`, `searchParams`, `schema.parse(body)`). A value whose origin is a repository call is not caller input. This is the same one-level-resolution technique SA recommended as CR2/F14 for the egress guard — a known idea, not a new invention. |
| 5 | Admin **target** ids | `admin/chat-usage?userId=`, `admin/users/[id]/*` | `requireAdmin` / `AdminAccessService` count as session sources, so these pass I2 without an exemption. |

Clients that *send* `x-user-id` (8 `.tsx` files) are out of scope by construction: the guard reads
`route.ts` files only.

### Proving it can fail

Three levels, because the previous cycle showed the first one alone is not enough — QA's note on the
F9 egress guard was that in-suite synthetic **strings** do not prove the corpus scan is wired to real
files:

1. **In-suite fixtures** — a bad snippet per rule, asserted to be flagged; a good snippet per rule and
   each of the five FP shapes above, asserted **not** to be flagged.
2. **Corpus negative control** — a real throwaway file written to `app/api/__guard_negative_control__/route.ts`
   within the test (created in `beforeAll`, removed in `afterAll`), proving the scan reads the actual
   tree. Required for I1, I2 and I3 independently.
3. **Mutation control, run by hand and recorded in this workplan** — revert each fixed route's gate and
   confirm both its own auth suite and the guard go red, then restore and confirm `md5` is unchanged
   (the procedure QA used in PR #82).

### What a pass does and does not mean

Stated in the guard's own header, in the wording discipline SA imposed as CR1 on the F9 guard: a
green run means **no known-bad shape was found**, not that no identity hole is possible. I4 is named
there as the known gap.

---

## CI design

**File:** `.github/workflows/security-guards.yml` (new), modelled on `.github/workflows/admin-authz-guard.yml`.

**File:** `package.json` — one added script:

```json
"test:security-guards": "jest app/api/__tests__/identity-surface.guard.test.ts app/api/plugins/__tests__/plugin-definition-egress.guard.test.ts app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts --ci"
```

The two existing guards are pulled in as the brief requires: today they run **only** under a local
full `npm test`, which nothing in CI executes (`build.yml` builds, `plugin-tests.yml` runs
`tests/plugins/`, `bos-llm-typecheck.yml` runs a scoped `tsc`, `react-hooks-guard.yml` runs a scoped
eslint, `admin-authz-guard.yml` runs one file). So the F9 egress guard — written specifically to stop
the P0 `auth_config` leak recurring — has never once run in CI. That is worth stating plainly in the
workflow header.

| Element | Choice | Why |
|---|---|---|
| Triggers | `push: [main]`, `pull_request: [main]`, `workflow_dispatch` | Same as the admin guard. |
| `paths:` filter | **None** | SA's rule, and the mechanism is identical: a new `app/api/whatever/route.ts` matches no plugin/BOS path filter, so a filtered guard **is defeated by the change it guards** — it goes green by not running. The workflow header will say this at the top, as `admin-authz-guard.yml` does. |
| Scope step | Reuse `.github/ci/non-deploying-change.sh` | Not a paths filter: the job still runs and still reports a conclusion on every PR, so it stays requireable. Only docs/scripts/`.claude` changes skip the install, and a new route can never classify as skippable. Fails open. |
| Job name | `Security guards` | Required-status-check matching uses the **job** name, not the workflow name. The header carries the same rename warning the admin guard carries, since renaming it silently un-gates `main`. |
| Permissions | `contents: read` | Read-only. |
| Concurrency | cancel-in-progress per ref | Same as the admin guard. |
| Node | 18, `npm ci`, `cache: npm` | Same. |
| Timeout | 15 min | Same. |

**Stated honestly in the header, as the admin guard does:** a red workflow blocks nothing until the
repo owner makes `Security guards` a required status check in branch protection — a GitHub setting,
not a file in any diff — and then *proves* it by opening a throwaway PR with a bad route and
confirming the merge is **blocked**, not merely red. This is a user action; it is listed as **Q7** so
it is not silently assumed.

---

## Files to create / modify

| File | Action | Reason |
|---|---|---|
| `app/api/agents/route.ts` | modify | Gate (1); delete local helper |
| `app/api/agents/[id]/duplicate/route.ts` | modify | Gate (2); delete local helper |
| `app/api/agents/[id]/executions/route.ts` | modify | Gate (3); delete local helper |
| `app/api/agents/[id]/intensity/route.ts` | modify | Gate (4); delete local helper |
| `app/api/agents/[id]/memory/count/route.ts` | modify | Gate (5); delete local helper |
| `app/api/agents/[id]/metrics/route.ts` | modify | Gate (6); delete local helper |
| `app/api/agents/[id]/status/route.ts` | modify | Gate (7); delete local helper |
| `app/api/agents/[id]/route.ts` | modify | Delete the dead helper (`:16-29`) — no behaviour change |
| `app/api/shared-agents/route.ts` | modify | Gate (8); delete local helper |
| `app/api/shared-agents/exists/route.ts` | modify | Gate (9); delete local helper |
| `app/api/approvals/[id]/respond/route.ts` | modify | Gate (10); the authz check becomes `approvers.includes(user.id)` |
| `app/api/v6/generate-ir-intent-contract/route.ts` | modify | Gate (11) |
| `app/api/v6/fetch-plugin-data/route.ts` | modify | Gate (12) — or delete, pending Q3 |
| `app/api/v6/execute-test/route.ts` | modify | Gate (13) — or delete, pending Q3 |
| `app/api/test/analyze-prompt/route.ts` | modify | Gate (14) — or delete, pending Q3 |
| `app/api/analyze-workflow/route.ts` | modify | Attribution (15) → session id; gate pending Q1 |
| `app/api/generate/input-schema/route.ts` | modify | Attribution (16) → session id; gate pending Q1 |
| `app/api/v6/compile-workflow/route.ts` | modify | Ambiguous (17), pending Q2 |
| `app/api/v6/generate-semantic-grounded/route.ts` | modify | Ambiguous (18), pending Q2/Q3 |
| `app/api/website/booking/intake/route.ts` | modify | Ambiguous (19) — move the refusal above the lookup; document GET as public, pending Q4 |
| `app/api/website/public/[subdomain]/route.ts` | modify | Comment only — document why public |
| `app/api/stripe/webhook/route.ts` | modify | Comment only — document that the signature is the authentication |
| `app/api/cron/process-queue/route.ts` | modify | Comment only — document the QStash signature and the non-prod gap |
| `app/api/**/__tests__/auth.test.ts` (×16–19) | create | One identity-lock suite per fixed route, in the shape of `app/api/help-bot-v2/__tests__/auth.test.ts` |
| `app/api/__tests__/identity-surface.guard.test.ts` | create | The guard |
| `.github/workflows/security-guards.yml` | create | CI |
| `package.json` | modify | `test:security-guards` script (one line; no other key touched) |
| `docs/workplans/IDENTITY_SWEEP_WORKPLAN.md` | create | This document |
| `docs/workplans/security-followups-workplan.md` | modify | Mark F16 resolved, cross-link this sweep |

---

## Task list

### Slice A — guard, CI, and the four critical gates

- [ ] A1. Write `app/api/__tests__/identity-surface.guard.test.ts` (rules I1–I3, PARKED/PERMANENT lists, caps, input floors, comment strippers)
- [ ] A2. Populate the allow-list with all 16 open routes, each dated, each stating what an anonymous caller can do
- [ ] A3. Write the five false-positive fixture tests (comment, CORS string, `.has()`, DB-row `user_id`, admin target)
- [ ] A4. Write the corpus negative control for I1, I2 and I3 (real throwaway file, created and removed in the test)
- [ ] A5. Add `test:security-guards` to `package.json`; confirm the two existing guards run under it
- [ ] A6. Write `.github/workflows/security-guards.yml` — no `paths:` filter, scope step, `Security guards` job name, header documenting all of it
- [ ] A7. Gate `v6/fetch-plugin-data` (12) + auth test
- [ ] A8. Gate `v6/execute-test` (13) + auth test
- [ ] A9. Gate `approvals/[id]/respond` (10) + auth test — authz becomes `approvers.includes(user.id)`
- [ ] A10. Gate `v6/generate-ir-intent-contract` (11) + auth test
- [ ] A11. Delete those four exemptions; lower the caps by 4 **in the same commit** (the ratchet)
- [ ] A12. Verify: new suites green, guard green, full `npm test` failure set identical to `461a3fbc`, `tsc` no new errors, eslint no new errors on changed lines, `next build` exit 0

### Slice B — the remaining gates, attribution and ambiguous

- [ ] B1. Gate rows 1–9 (the `agents` family ×7 and `shared-agents` ×2); delete all nine local `getUserIdFromRequest` copies + 9 auth tests
- [ ] B2. Delete the dead helper in `agents/[id]/route.ts` (row 40) — verify no behaviour change
- [ ] B3. Gate `test/analyze-prompt` (14), or delete the route per Q3
- [ ] B4. `analyze-workflow` (15) + `generate/input-schema` (16) — session-id attribution, plus gate per Q1
- [ ] B5. Resolve rows 17–19 per Q2/Q4
- [ ] B6. Add the route-header comments to the five documented-public routes (D)
- [ ] B7. Delete the remaining exemptions; lower the caps in the same commits
- [ ] B8. Mark **F16** resolved in `security-followups-workplan.md`, cross-link this sweep
- [ ] B9. Re-run the full verification matrix from A12

---

## Test plan

### Per-route identity-lock suites

Shape copied from `app/api/help-bot-v2/__tests__/auth.test.ts` (4 tests) and
`app/api/enhance-prompt/__tests__/auth.test.ts`. Each fixed route gets:

1. **No session + victim id in the header** → 401, **and the data layer is never called** (asserted
   on the repository/Supabase mock, not just the status code).
2. **No session + victim id in the body/query** → 401, same assertion.
3. **Session present + a victim id supplied** → the downstream query is scoped to the **session**
   user id, and the victim value appears in **no** `.eq()` and no executor call. This is the positive
   control — the test that fails if someone reinstates the header as a "fallback".
4. **Write routes only** (rows 2, 7, 8, 10, 12, 13): the write is asserted **not to have happened**
   on the 401 path — the lesson from PR #82's CR1, where a read hole was closed and a write hole one
   path over was nearly left open.

### Guard tests

Per [Proving it can fail](#proving-it-can-fail): in-suite fixtures, corpus negative control, and a
hand-run mutation control per fixed route recorded in this workplan.

### Regression

| Check | Baseline | Bar |
|---|---|---|
| `npm test` | `461a3fbc`, measured before the first edit | Failure **counts identical**; the whole delta is new suites. (The ~21 suites / 129 tests failing on `main` are the known unrelated `DeclarativeCompiler` module-resolution class.) |
| `npx tsc --noEmit` | `461a3fbc` (~2,035 errors), measured with the same `.next/` present | **No new errors** |
| `npx eslint` on changed files | — | 0 new errors; pre-existing warnings recorded, none on a changed line |
| `next build` | — | Exit 0 |
| `npm run test:security-guards` | — | Green, and red when any single fix is reverted |

### Manual, needs a signed-in session (for QA / the user)

1. `/v2/agent-list` and `/v2/dashboard` still list agents; `/v2/agents/[id]` still shows intensity,
   metrics, execution history and memory count.
2. Activate/deactivate an agent; duplicate an agent; share an agent to the community and confirm the
   "already shared" badge.
3. `/(protected)/approvals/[id]` — approve and reject still work for a legitimate approver; a
   signed-in **non**-approver still gets 403.
4. `/v2/agents/new` — full creation flow through `v6/generate-ir-intent-contract`.
5. Wizard steps that call `analyze-workflow` and `generate/input-schema` still produce schemas.
6. Signed **out**, `curl` each fixed route with a victim `x-user-id` and a body `userId` → 401 with
   no data in the body, and — for rows 2, 7, 8, 10 — confirm in the DB that nothing was written.

---

## Risk and rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| A signed-in UI surface breaks because a caller relied on the header **instead of** a cookie | Low | Every in-repo caller enumerated in [A. Gate](#a-gate--14-routes): all are same-origin browser `fetch` from signed-in pages, which send the cookie by default. PR #80 and #82 verified this empirically on the same client layer. |
| A **non-browser** caller exists that this sweep did not find (external script, Postman collection, partner integration) | Low–Medium | `scripts/qa-v6-execution-layer.ts` is the only one found, and it targets `v6/execute-test`. Q3 asks SA whether that script should keep working. `/test-plugins-v2` sends `x-user-id: test_user_123`, already inert after PR #73 and cosmetic. |
| A `/v2/*` page loads anonymously (they are page-guarded, not middleware-guarded) and now shows an error instead of an empty state | Low | The documented, accepted degradation from PR #82. Pages that already render nothing for an anonymous visitor will now surface a 401 instead of a silent empty state. |
| Guard false positive turns a required check red on an unrelated PR | Medium | The single risk most likely to get the check switched off. Five known FP shapes designed against with fixtures; the inverted rule I4 is parked rather than shipped; the failing message names the rule, prints both cap numbers and carries the ratchet instruction. |
| Guard false **negative** — a pass read as "no identity hole possible" | Certain if unstated | The guard's header states plainly that a pass means "no **known-bad shape** found", not "no hole possible", and names I4 as the known gap. Same wording discipline as CR1 on the F9 egress guard. |
| 19 route edits in one cycle is too large to review well | Medium | The [proposed slicing](#proposed-slicing), plus one commit per logical group so any regression is bisectable. |

**Rollback.** Every route fix is an independent ~10-line addition; reverting one file restores the
prior behaviour with no schema, client or config dependency. The guard and the workflow are
additive: deleting the two new files and the one `package.json` line removes them completely. No
migration, no feature flag, no data change anywhere in this branch.

---

## Open questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| **Q1** | The brief says Attribution cases should switch to the session id and **not** be gated. But `analyze-workflow` and `generate/input-schema` are also unauthenticated `gpt-4o` endpoints, and SA's own `help-bot-v2` ruling one cycle ago gated a route specifically because anonymous LLM spend is a hole in its own right. Gate them too? | **Yes, gate.** The only callers are signed-in wizard steps, so it costs no user anything, and it is the precedent SA set. |
| **Q2** | Rows 17 (`v6/compile-workflow`, an unverified `user_id` stamped into the emitted workflow) and 18 (`v6/generate-semantic-grounded`, a required-but-unused `userId`) are not disclosures. Fix, or record and leave? | **Fix — gate both, take `user_id` from the session in 17, delete the unused field in 18.** Both are unauthenticated LLM pipelines; leaving a required-but-unused identity field is how the next author reinstates it as real. |
| **Q3** | Four routes have **no in-repo caller**: `v6/fetch-plugin-data`, `v6/generate-semantic-grounded`, `test/analyze-prompt` (zero callers), `v6/execute-test` (one QA script). `dead-plugin-routes-removed.guard.test.ts` is the precedent for **deleting** dead routes rather than gating them. Delete or gate? | **Gate `v6/execute-test`** (the QA script is real and can send a cookie or go behind an admin gate); **propose deleting `test/analyze-prompt` and `v6/fetch-plugin-data`** — a deleted route cannot regress, and both are the most dangerous items on the list. SA's call; deletion is outside the brief's scope so it is not assumed. |
| **Q4** | Row 19 (`website/booking/intake` POST) reads `scheduling_bookings` by `(bookingId, userId)` and *then* refuses unconditionally, leaving a weak existence oracle. Three lines to move the refusal above the lookup. In scope? | **Yes** — three lines, zero behaviour change for any caller, same file the sweep is already documenting. Same reasoning SA used to rule CR1 in scope on PR #82. |
| **Q5** | [Slicing](#proposed-slicing) inverts the brief's suggested order (guard first, red-by-allow-list, rather than fixes first). Accept the inversion, or land the fixes first? | **Guard first.** The admin-authz guard's own header records why, and six parked slices later it is still standing. |
| **Q6** | **CLAUDE.md § Logging, surfaced not assumed.** Files this branch will modify that still log via `console.*`: `agents/[id]/route.ts` (~40), `v6/execute-test` (~15), `v6/compile-workflow` (~12), `analyze-workflow` (12), `v6/fetch-plugin-data` (~10), `agents/route.ts` (3). Converting them is **F17**'s job and is excluded by this branch's scope instruction. Re-confirm the deferral with the user? | **Defer again, and say so out loud** — this is the third deferral, which is exactly the condition SA attached to F17 ("re-confirmed by the user each time one of these files is touched"). Converting logging inside a security branch enlarges the review surface for no security gain. |
| **Q7** | The CI job blocks nothing until `Security guards` is added as a required status check in branch protection **and proved** with a throwaway bad-route PR. That is a repo-owner action. Confirm it is on the user, and that the same step is still outstanding for `Admin authz surface guard`? | Record it as a user action in the release notes, as the admin guard's header does. |
| **Q8** | The sweep found one adjacent class it did **not** fix: routes that take a **resource** id (`agentId`, `cacheId`) and read it without owner scoping. Separate ticket, or fold in? | **Separate ticket.** Different defect class, different guard rule, and folding it in doubles a branch already at the size limit. |

---

## SA Review Notes

**Reviewed by SA — 2026-09-21**
**Status:** 🔄 **Revision Required** — with a carve-out: **Slice 0 (below) is approved to start immediately**, because six of the holes it closes are live on `main` and anonymously exploitable.

The classification is the deliverable and the classification is good. I re-derived the inventory
independently rather than reading it: 387 `app/api` route files (confirmed), 20 files containing the
string `x-user-id` (confirmed), **12** containing an actual `headers.get('x-user-id')` call
(confirmed — the same 12 files), 38/38 Business OS routes carrying a session source (confirmed, zero
missing), `resolveActingUserIdentity` fails closed at every step (confirmed,
`lib/server/route-identity.ts:75-130`), and the dead helper in `agents/[id]/route.ts` is genuinely
dead (declared `:16`, **zero** call sites). Every row I spot-read matched its classification. Rows
15–19 in particular were classified against what the code does rather than what the filename suggests.

The revision is not because rows are wrong. It is because the **filter** that produced the rows —
"a request-supplied value that looks like a user id, inside `app/api/**`" — has two structural blind
spots, and there are live routes in both. On a security sweep the filter is part of the deliverable.

---

### Comments

#### 1. The three named criticals — all confirmed, each worse than its one-line summary

**1a. `app/api/v6/fetch-plugin-data/route.ts` — CONFIRMED. Severity: 🔴 Critical / P0.**
`:38-59` destructures `userId` from the body and passes it straight to
`pluginExecuter.execute(userId, pluginName, actionName, parameters)`. No `getUser()`, no Zod, no auth
of any kind — and `middleware.ts` does **not** authenticate `/api/*` (verified: it does subdomain
rewriting and onboarding redirects, and explicitly skips `/api`). The executor resolves the
**victim's** connection through `AccessStrategyResolver` and calls the third-party API with their
stored OAuth tokens. So an anonymous HTTP POST reads a named user's Gmail, writes their Drive and
sends as them, bounded only by which actions their connected plugins expose. Dev's severity wording
is accurate and not overstated.

The one apparent mitigation — "the attacker still needs the victim's UUID" — **does not exist**. See
comment 2a: another route hands out user UUIDs to anonymous callers in bulk. Do not plan around UUID
secrecy; a user id is not a credential anywhere in this system.

**1b. `app/api/v6/execute-test/route.ts` — CONFIRMED. Severity: 🔴 Critical / P0, and strictly worse than 1a.**
`:55-140` — anonymous POST, `body.workflow` (attacker-authored DSL) executed through `WorkflowPilot`
with `createServerSupabaseClient()` (service role) as `body.user_id`. 1a gives an attacker one plugin
call; this gives them an arbitrary **multi-step program** of plugin calls, LLM steps and control flow,
run by the platform's own engine, attributed to the victim, writing execution rows under the victim's
id. That is a remote-execution surface, not only a disclosure one.

Two corrections to the workplan's description:

- The email branch (`:85`, `auth.admin.listUsers()` with **no pagination arguments**) reads only the
  first page — supabase-js defaults to 50 users. It is therefore a *weak* enumeration oracle and is
  functionally broken past 50 accounts: unresolved emails fall through to
  `00000000-0000-0000-0000-000000000000` (`:99`). Soften the enumeration framing; the UUID path is
  the real hole and it is fully functional.
- Because a failed lookup falls back to a zero UUID instead of refusing, the route **still executes
  the workflow**. That is its own bug and it survives any fix that only changes the identity source.

**1c. `app/api/approvals/[id]/respond/route.ts` — CONFIRMED. Severity: 🔴 High.**
`:23` `const { userId, decision, comment } = await request.json()` → `:68`
`if (!approvalRequest.approvers.includes(userId))`. The caller-supplied value **is** the authorization
check, so naming a valid approver passes it. Two things Dev did not state, both of which change how
this gets tested:

- The route builds an **anon + cookie** `createServerClient` (`:44-54`), not a service-role client.
  So RLS on `workflow_approval_requests` is the only thing between an anonymous caller and the 403
  check — and there is **no migration for that table anywhere in the repo** (grepped `supabase/` and
  `SQL Scripts/`); it was created in the dashboard, so its RLS state is unknown. **Measure it, do not
  assume it.** If anon SELECT is permitted this is fully anonymous approval forgery; if RLS blocks
  anon it degrades to *any signed-in user* forging any other user's approval. Both are High and both
  take the same fix, so this does not block the work — but the workplan must not assert a severity it
  has not measured.
- `auditLog({ … userId … })` at `:98-100` records the **spoofed** id, so a forged approval is
  attributed to the victim in the audit trail. The fix must move audit attribution to `user.id` too,
  not only the authz check.

**Should they be split out and shipped ahead of the rest? Yes** — see the Q5 ruling, Slice 0.

---

#### 2. Two live holes the sweep missed, and one it should have cross-linked

These are not write-up nitpicks. They are routes an anonymous caller can hit today, found by running
the sweep's own question through a wider filter.

**2a. `app/api/agent-executions/stats/route.ts` — NEW FINDING. Severity: 🔴 Critical / P0.**
Anonymous `GET`. Builds `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` inline
(`:46-49`), selects `agent_executions` `*` for the last 24 hours `.limit(1000)` with **no `user_id`
filter at all**, and returns up to **50 full rows per status** — `user_id`, `agent_id`,
`error_message` and the `result` payload of other tenants' agent runs — plus platform-wide metrics.
Its only caller is `app/admin/queues/page.tsx:58`: it is an admin route that forgot to be one.

Why it belongs in *this* sweep rather than a later one: it is the **UUID dispenser that arms 1a and
1b**. Anonymous GET here → harvest `user_id` values → anonymous POST to `fetch-plugin-data` → read
that user's mailbox. Neither route needs anything the other does not supply. Fix: `requireAdmin`
(`lib/admin/requireAdminRoute.ts`), which is what the existing admin-authz guard already expects of
admin-capability routes.

**2b. `app/api/check-user-status/route.ts` — NEW FINDING. Severity: 🟠 Medium.**
Anonymous POST, `{ email }` from the body, service-role client built inline (`:29-38`),
`auth.admin.listUsers()`, returns `{ exists, onboardingCompleted }`. A purpose-built account-existence
oracle for arbitrary email addresses. **Zero in-repo callers** (grepped `app`, `components`, `lib`,
`hooks`, `scripts`, `docs`). Also broken in the same way as 1b — unpaginated `listUsers()` sees only
the first 50 accounts, so it answers `exists: false` for most real users. Dead, wrong, and an oracle.
**Delete it.**

**2c. Unsigned OAuth `state` carrying `user_id` — NOT new; the sweep failed to cross-link it.**
`app/oauth/callback/[plugin]/route.ts`, `app/oauth/token/route.ts` and
`app/api/oauth/token/route.ts:51-60` each parse an identity out of an **unsigned** `state` parameter;
via `gmailPluginStrategy.handleOAuthCallback` the exchanged tokens are upserted into
`plugin_connections` with `onConflict: 'user_id,plugin_key'` — so an attacker who completes their own
OAuth consent with a crafted `state` **overwrites the victim's existing connection with
attacker-controlled tokens**, and the victim's agents then read and write the attacker's mailbox.

This is already the authoritative open item **R4** in
[BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md](/docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md)
§3 / R4, rated Medium there. Per the single-source-of-truth principle this sweep must **not**
re-diagnose it — but it must cross-reference it, because it is the same defect class and because it
is the evidence behind guard condition **G5**. Three asks:

- Cross-link R4 from the Classification section as "same class, tracked elsewhere, not fixed here".
- `app/api/oauth/token/route.ts` has **zero in-repo callers** and rides the deprecated V1 strategy
  layer. It is free to delete and this sweep is the cheapest place to do it — see Q3.
- I disagree with R4's Medium rating (an attacker-controlled mailbox silently substituted into a
  victim's automations is High), but the re-rating belongs in R4's own document, not here.

**Root cause of all three — fix the Method section, not just the inventory.** Two structural blind
spots:

1. **Scope.** The scan covered `app/api/**`. There are **4** route handlers under `app/` outside
   `app/api` (`app/go/[code]`, `app/oauth/callback/[plugin]`, `app/oauth/token`,
   `app/oauth/[plugin]/start`) and **two of them are 2c**. This is the precedent guard's own lesson:
   *"a guard scoped to files we already know about is structurally incapable of finding the sixth."*
2. **Shape.** "Identity supplied as a value that looks like a user id" misses (a) identity smuggled
   inside an opaque parameter (2c) and (b) routes that need **no** identity because they return
   everyone's data (2a). My cross-check — every `app/api` route with no session source that
   nevertheless touches a service-role client, `PluginExecuterV2` or `WorkflowPilot` — returns **39
   files**. I triaged five for this review; the other 34 are untriaged and are the next sweep (Q8).

---

#### 3. Corrections to the inventory itself

| # | Row | Correction |
|---|---|---|
| 3a | 15 `analyze-workflow` | **Reclassify Attribution → Gate, 🔴 High, and move into Slice 0.** `:30` takes **`systemPrompt` *and* `userMessage`** from the body and passes both to `gpt-4o`, `max_tokens: 2000`, on `process.env.OPENAI_API_KEY`. That is not "spoofable attribution", and it is more than cost-burn: it is a fully controllable open LLM proxy — arbitrary system prompt, arbitrary content, our key, our bill, our egress. F16's Low rating predates visibility of the system-prompt pass-through; supersede it. |
| 3b | 16 `generate/input-schema` | Stays Attribution-plus-gate. The prompt is wrapped in `PromptLoader(aiAgentPromptTemplate)`, so the caller does not control the system prompt. Unauthenticated LLM endpoint, normal priority. |
| 3c | 15 & 16 | Both call `new OpenAIProvider(...)` / `OpenAIProvider.getInstance(...)` directly with a hardcoded `'gpt-4o'` — violations of CLAUDE.md § AI Provider Factory and Mandatory Rule 5. **Record as a follow-up; do not fix in a security branch.** |
| 3d | 13 `v6/execute-test` | The `listUsers()` oracle is weaker than stated, and the zero-UUID fallback executes anyway (comment 1b). |
| 3e | 10 `approvals/respond` | Anon+cookie client, RLS unverified; audit row carries the spoofed id (comment 1c). |
| 3f | Counts table | Needs re-deriving once 2a/2b are added and row 15 moves to Gate. Do not hand-patch the totals — re-run the passes. |

---

### Decisions on the open questions

| # | Ruling |
|---|---|
| **Q1** | **Gate both — approved, and on stronger grounds than Dev's.** `analyze-workflow` is not an attribution defect with a cost side-effect; it is an unauthenticated **arbitrary-system-prompt** proxy to `gpt-4o` (comment 3a). The binding precedent is not only help-bot-v2: `/api/plugins/suggest` was **deleted** for exactly this shape — *"unauthenticated, unvalidated… called GPT-4o on arbitrary anonymous input (an open LLM-spend proxy)"* (`dead-plugin-routes-removed.guard.test.ts:15-17`). It has a live caller, so it is gated rather than deleted, and it moves to **Slice 0**. `generate/input-schema`: gate, normal priority. Attribution switches to `user.id` in both. |
| **Q2** | **Fix both as proposed. Do not delete either.** Row 17 `compile-workflow`: gate, and take `user_id` from the session — the stamped id is load-bearing precisely because `execute-test` executes the emitted artefact. Row 18 `generate-semantic-grounded`: delete the required-but-unused field **and** gate. Deletion is wrong for these two (unlike Q3's) because both are documented as the review-mode split-flow API in `V6_API_REFERENCE.md` / `V6_DEVELOPER_GUIDE.md` and referenced from `lib/utils/featureFlags.ts:63`. |
| **Q3** | **Per route, as asked:**<br>• `v6/fetch-plugin-data` → **DELETE.** Zero callers in any `.ts/.tsx/.json` (verified); only four V6 docs mention it. Most dangerous route in the repo, and the `dead-plugin-routes-removed` precedent is exact. Add it to that **existing** guard's `REMOVED_FILES` + `FORBIDDEN_LITERALS` — do **not** create a second dead-route guard — and update the four V6 docs in the same commit.<br>• `test/analyze-prompt` → **DELETE.** Zero callers; it is a harness for `analyzePromptDirectAgentKit`, which is a Jest test's job, not a public HTTP endpoint's.<br>• `v6/execute-test` → **GATE, and require *admin*, not merely a session.** A plain session gate converts "anyone on the internet" into "anyone who signed up", and arbitrary caller-authored DSL executed server-side by any signed-up user is still a remote-execution surface. `scripts/qa-v6-execution-layer.ts` is ours, so an admin gate costs nothing. **Also delete the entire email-resolution branch** (`:80-102`) and the zero-UUID fallback — both are dead once identity comes from the session, and leaving them leaves the oracle.<br>• `v6/generate-semantic-grounded` → **GATE** (per Q2).<br>• **Added by this review:** `app/api/oauth/token` → **DELETE** (zero callers, deprecated V1 strategy path, comment 2c); `app/api/check-user-status` → **DELETE** (zero callers, comment 2b). |
| **Q4** | **Yes, in scope.** Three lines, no behaviour change for any caller, same file the sweep is already documenting. One condition: the reordering must be **asserted in that route's auth test** (refusal reached with the `supabaseServer` mock never called), or it silently reverts the first time someone tidies the handler. |
| **Q5** | **Neither order as proposed — three slices.** See below. |
| **Q6** | **User's call. My recommendation: defer once more, with two conditions.** See below. |
| **Q7** | **Confirmed: a user action, and it must be *proved*, not merely enabled.** Neither `Security guards` nor the existing `Admin authz surface guard` is demonstrably blocking today. Record as a release-notes item: (i) add **both** job names as required checks on `main`; (ii) open a throwaway PR containing a deliberately bad route and confirm the **merge button is blocked**, not merely that the check is red; (iii) record that PR number in this workplan. **Until (ii) is recorded, no document may claim this class "cannot recur"** — the only supportable claim is "is detected, locally and in CI". |
| **Q8** | **Separate ticket — agreed, with the scope corrected upward.** It is not just "resource id read without owner scoping": comment 2a proves there are unauthenticated service-role routes that take **no identity at all** and return cross-tenant data. Open it as **"unauthenticated service-role read surfaces"**, seeded with the 39-file list from comment 2 (no session source × service-role client / `PluginExecuterV2` / `WorkflowPilot`), noting 5 triaged here and 34 not. That ticket is also the precondition for un-parking guard rule I4 (G6). |

#### Q5 in full — the slicing ruling

Dev's guard-first argument is **accepted on its own terms**: shipping the guard last is how a
programme loses its only structural guarantee, and the admin-authz precedent says exactly that in its
own header. I am not overruling it.

But the inversion answers the wrong question. The real question is whether **six** live,
anonymously-exploitable holes should wait behind a ~1,000-line tooling review. They should not. Note
also what the quoted precedent actually says: the guard shipped *with the first security slice* — not
*before the first security fix*.

**Ruling — three slices:**

| Slice | Contents | Why |
|---|---|---|
| **0 — hotfix, first, deliberately boring** | **Delete:** `v6/fetch-plugin-data`, `test/analyze-prompt`, `api/oauth/token`, `check-user-status`. **Gate:** `v6/execute-test` (admin), `approvals/[id]/respond`, `v6/generate-ir-intent-contract`, `agent-executions/stats` (admin), `analyze-workflow`. One auth test per gated route; `dead-plugin-routes-removed.guard.test.ts` extended for the four deletions. **No new guard, no CI workflow, no `package.json` change.** | ~9 files, reviewable in one sitting, revertable per file, and it takes the entire 🔴 set off `main` today. |
| **A — guard + CI** | Exactly as designed, red-by-allow-list, subject to G1–G8 below. Fewer exemptions than planned, because Slice 0 already emptied the dangerous end of the list. | The guard still lands **before** the long tail, so the structural guarantee is not deferred — which is the thing the admin-authz precedent actually protects. |
| **B — the remainder** | Rows 1–9, 16, 17, 18, 19, the row-40 dead helper, the five public-route comments, F16 closure. Each exemption deleted with the cap lowered in the same commit. | Unchanged from Dev's Slice B, minus what moved to Slice 0. |

#### Q6 in full — recommendation only; the user decides

**Recommend deferring F17 one final time, conditionally.** Slice 0 is the single place where a small
diff matters most — it is a hotfix for live holes and must be reviewable at a glance; ~92 `console.*`
conversions across six files would triple it for no security gain.

But this is the third deferral, and my own F17 condition was that each one be re-confirmed. So the
recommendation carries two conditions:

1. **The deferral must shrink the backlog, not grow it.** Four of the six non-compliant files
   (`fetch-plugin-data` ~10 calls, `test/analyze-prompt`, `api/oauth/token`, `check-user-status`) are
   now **deletions** under Q3 — their `console.*` calls leave the repo with them in Slice 0. Count
   that as F17 progress and re-measure the remaining total before quoting "108 + 33 + 4 + 9" again.
2. **F17 gets a named, scheduled slice before any further security work touches these files.** A
   fourth deferral should be refused.

Also flag, since Dev did not: fixing `approvals/[id]/respond` may require touching
`lib/pilot/ApprovalTracker.ts`, which logs via `console.warn`/`console.log`. If Dev edits that file,
CLAUDE.md § Logging applies to it too and it must be surfaced to the user at that moment.

---

### Guard design review

The overall shape is **approved**: allow-list never deny-list, dated exemptions with written reasons,
asserted caps so removing an exemption forces lowering the cap in the same commit, input floors so an
emptied scan fails rather than passes, the `PARKED`/`PERMANENT` split, and the honesty discipline in
the header. That is the right pattern, and it matches the precedent that is actually holding.

The five false-positive shapes are the right five — all five exist in the tree, and the arithmetic
checks out (of 20 `x-user-id` files, 12 are call shapes; the other 8 are comments, the CORS string and
the `.has()` counter). `.has()` passing **without** an exemption is genuinely better than an
exemption. The three-level proof is the right standard, and the corpus negative control is the part
that earns it.

**Is it conservative enough for a required check?** Mostly yes, and deliberately so: I2 fails only
when a caller-supplied id is read **and** the file mentions no session source anywhere. That biases
hard toward false negatives, which is the correct bias for a check that blocks merges. G1–G5 and G7
are blocking; the rest are conditions on documentation and running.

| # | Condition | Blocking? |
|---|---|---|
| **G1** | **I2 must scan every `route.ts` repo-wide, like I1 and I3 — not `app/api/**`.** Evidence: `app/oauth/callback/[plugin]/route.ts` and `app/oauth/token/route.ts` are route handlers outside `app/api` and **both consume a caller-supplied identity** (comment 2c). There are 4 such files; triage all 4. A rule scoped to the folder we already searched cannot find the fifth. | ✅ Blocking |
| **G2** | **Do not write a second comment stripper.** `stripComments` already exists, is exported and is unit-tested at `lib/admin/__tests__/admin-authz-surface.guard.test.ts:414`. Extract it and the file-walk into a shared helper (e.g. `lib/testing/guard-source-scan.ts`) and have both guards import it — as its **own commit**, with the admin guard suite proven green immediately before and after. A second stripper is a second copy of a bug that fails **silently in the permissive direction**, and per Mandatory Rule 7 a duplicated pattern needs SA sign-off, which this does not get. *Fallback if TL judges refactoring a required-check file too risky inside a security branch:* duplicate, but add a test asserting both strippers produce byte-identical output on the six real comment-bearing files. | ✅ Blocking |
| **G3** | **Widen I1 from the literal to the shape:** match `headers.get(<string matching /user[-_ ]?id/i>)`, not the exact `'x-user-id'`. Today's cost is zero — the same 12 files match either way — and it closes the trivial escape (`x-actor-id`, `x-uid`, `x-user_id`). A header whose name contains "user id", read inside a route handler, is identity often enough that the rare exception is cheaper as an allow-list entry than as a blind spot. | ✅ Blocking |
| **G4** | **Name the file-level-session false negative in the header, in the same paragraph as I4.** I2 passes any file that mentions a session source *anywhere*, so a route file with a gated `GET` and a `body.userId` `POST` is invisible to it. That is now the **most probable** recurrence shape, precisely because the obvious one is being removed. The design choice is right; leaving it unwritten is not. | ✅ Blocking |
| **G5** | **Name the opaque-parameter gap, with the OAuth `state` as the worked example** (comment 2c, tracked as R4). No text-shape rule can see an identity that arrives base64-JSON-encoded inside `state`. Say so explicitly, or the guard's green will be read as covering a class it structurally cannot cover. | ✅ Blocking |
| **G6** | **Parking I4 is correct — approved.** My cross-check found 39 `app/api` routes with no session source that still touch a service-role client, so an I4 shipped today would need dozens of day-one exemptions, and a false positive on a required check is the failure mode that gets the check switched off. Record the **revisit condition**: un-park I4 once the Q8 ticket has produced a triaged list — that ticket generates exactly the allow-list I4 needs. | Approved as proposed |
| **G7** | **Add a fourth, cheap proof: assert the suites actually ran.** Before the run, `npx jest --listTests <the three paths>` must return exactly **3** files, and the script must **never** carry `--passWithNoTests`. Otherwise renaming or moving a guard file turns the required check green by matching nothing — the same "defeated by the change it guards" failure the `paths:`-filter decision correctly avoids. Dev must verify jest's no-tests-found exit behaviour under the exact script rather than assuming it. | ✅ Blocking |
| **G8** | The hand-run **mutation control must be recorded with the command and the observed failure message per route**, not as a ticked box. QA independently re-runs at least two of them. | Condition on QA sign-off |
| **G9** | **CI design approved as written** — no `paths:` filter (with the reason in the header), `non-deploying-change.sh` as a scope step rather than a filter, `Security guards` as the job name with the rename warning, `contents: read`, concurrency, Node 18, 15-minute timeout. It matches `admin-authz-guard.yml` and introduces no new pattern. Stating in the header that the F9 egress guard has never once run in CI is correct and should stay. | Approved |

---

### Adjusted items

- **Task list** — re-cut into Slice 0 / A / B per the Q5 ruling. A7–A10 move to Slice 0, joined by
  `agent-executions/stats`, `analyze-workflow` and the four deletions. A1–A6 and A11–A12 become
  Slice A.
- **Inventory** — add `agent-executions/stats` (Gate, 🔴 Critical) and `check-user-status`
  (Gate/Delete, 🟠 Medium); reclassify row 15 `analyze-workflow` Attribution → **Gate, 🔴 High**;
  cross-link R4 for the OAuth-`state` class; re-derive the Counts table by re-running the passes.
- **Method** — add a fifth pass covering both blind spots: (a) `route.ts` outside `app/api`, (b) no
  session source × service-role client; record that it returned 39 candidates, 5 triaged here.
- **Files to create / modify** — `v6/fetch-plugin-data`, `test/analyze-prompt`, `api/oauth/token`,
  `check-user-status` change from *modify* to **delete**; add
  `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` (*modify* — extend the removed
  list); add `app/api/agent-executions/stats/route.ts` (*modify* — `requireAdmin`); add the shared
  guard-scan helper from G2.
- **Risk table** — add *"a route handler outside `app/api` is missed"* (mitigation: G1) and
  *"identity arrives inside an opaque parameter"* (mitigation: G5, tracked as R4).

---

### Optimisation suggestions (non-blocking)

- The guard's home, `app/api/__tests__/identity-surface.guard.test.ts`, implies `app/api` scope while
  I1/I3 — and, under G1, I2 — are repo-wide. `lib/__tests__/` or `lib/security/__tests__/` reads
  truer. Cosmetic; pick one and move on.
- Q3's deletions will leave stale references in `V6_API_REFERENCE.md`, `V6_DEVELOPER_GUIDE.md`,
  `V6_PRODUCTION_METADATA_INJECTION.md`, `V6_SCHEMA_BASED_GROUNDING.md` and
  `RETRY_AND_USER_FEEDBACK.md`. Update them in the deleting commit, not afterwards.
- `agent-executions/stats` and `check-user-status` each build a Supabase client inline from
  `process.env` rather than importing `supabaseServer`, and query tables directly instead of going
  through a repository — pre-existing Mandatory Rule 1 violations. Note as follow-ups; a security
  branch is not where they get refactored (and `check-user-status` is being deleted anyway).

---

### Things the user must decide or do

1. **Q6 — the third F17 logging deferral.** My recommendation and its two conditions are above; the
   decision is the user's.
2. **Q7 — branch protection.** Add `Security guards` **and** `Admin authz surface guard` as required
   checks on `main`, then prove blocking with a throwaway bad-route PR. Nothing in any diff can do
   this.
3. **RLS on `workflow_approval_requests`** (comment 1c) — needs a read-only measurement against prod
   before the approvals hole's severity can be stated. The table has no migration in this repo.
4. **Disclosure judgement.** `fetch-plugin-data`, `execute-test` and `agent-executions/stats` have
   been anonymously exploitable on a public deployment, from a repo that was public with a committed
   service-role key (per the environments memo). Whether that triggers any notification or
   key-rotation obligation is the user's call, not SA's — but it should be made consciously rather
   than by default.

---

### Approval

- [ ] Workplan approved as written — **no**
- [x] **Slice 0 approved to proceed immediately** (the six gates/deletions above, auth tests, extended
      dead-route guard). It needs no further SA sign-off to start.
- [ ] Slices A and B approved **once** the workplan is revised for: the two new findings and the R4
      cross-link, the row-15 reclassification, the Method fifth pass, the re-cut slicing, and guard
      conditions G1–G5 and G7. Re-submit for a second SA pass — this is a re-review, not a re-plan;
      the classification work itself stands.

---

## Slice 0 Implementation (Dev) — 2026-09-21

SA's Slice 0, implemented on `fix/identity-sweep` (worktree `neuronforge-identity-sweep`, base
`461a3fbc`). **Nothing staged, committed or pushed.** SA's review text above is untouched.

Scope as ruled, with **two deviations** recorded in § Deviations: one deletion became a gate because
the "callerless" premise was false, and the user overrode SA's Q6 recommendation on logging.

### Per-route change

| # | Route | Action | Change |
|---|---|---|---|
| 1 | `app/api/v6/fetch-plugin-data/route.ts` | **DELETED** | Anonymous plugin execution with the victim's OAuth tokens. Verified callerless (below). |
| 2 | `app/api/oauth/token/route.ts` | **DELETED** | Unsigned-`state` identity on the deprecated V1 strategy path. Verified callerless. The parent `app/api/oauth/` directory is now empty and gone too. |
| 3 | `app/api/check-user-status/route.ts` | **DELETED** | Anonymous email to service-role `listUsers()` account-existence oracle. Verified callerless. |
| 4 | `app/api/test/analyze-prompt/route.ts` | **GATED** (not deleted — see D1) | `getUser()` + 401 before the body is parsed; `analyzePromptDirectAgentKit` now runs against `user.id`; the body `userId` is not read. |
| 5 | `app/api/v6/execute-test/route.ts` | **GATED — `requireAdmin`** | Gate before `request.json()`. `body.user_id` removed in every form; the workflow always runs as the calling admin. **The whole email-resolution branch (`listUsers()`) and the `00000000-…-0000` fallback are deleted** — that fallback meant a failed lookup executed the workflow anyway. |
| 6 | `app/api/approvals/[id]/respond/route.ts` | **GATED — POST and GET** | POST: `getUser()` + 401 before the body is read; `approvers.includes(...)` **and** the `auditLog` `userId` now take the session id, so a forged decision can no longer be attributed to the victim. GET: gated too, and returns **404** (not 403) to a signed-in non-approver so a stranger cannot confirm the id exists. `lib/pilot/ApprovalTracker.ts` needed **no change** — `recordApprovalResponse(approvalId, approverId, …)` already took the id as a parameter. |
| 7 | `app/api/agent-executions/stats/route.ts` | **GATED — `requireAdmin`** + query scoped | Gate before the service-role client is built. `select('*')` replaced with an explicit `EXECUTION_COLUMNS` allow-list, so a column added to `agent_executions` later does not automatically start flowing cross-tenant. Its only caller, `app/admin/queues/page.tsx:58`, already sits behind `app/admin/layout.tsx` → `requireAdminPage()`. |
| 8 | `app/api/analyze-workflow/route.ts` | **GATED** (reclassified Attribution → Gate per SA 3a) | `getUser()` + 401 before the body is read, closing the open `gpt-4o` proxy; analytics attribution switched from `userId \|\| x-user-id \|\| 'anonymous'` to `user.id`. |
| 9 | `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts` | **EXTENDED** | The three deletions added to `REMOVED_FILES` + `FORBIDDEN_LITERALS`; a new `REMOVED_DIRS` list replaces the two hand-written directory assertions; a per-literal "can actually fail" fixture; and a test asserting the OAuth routes that were **not** deleted still exist. No second guard was created. |
| 10 | `docs/v6/V6_API_REFERENCE.md`, `V6_DEVELOPER_GUIDE.md`, `V6_PRODUCTION_METADATA_INJECTION.md`, `V6_SCHEMA_BASED_GROUNDING.md` | modified | Stale `fetch-plugin-data` references replaced with the removal note plus the server-side `PluginExecuterV2` / `POST /api/plugins/execute` alternative, per SA's optimisation note. |

No client component was changed. Every caller is a same-origin browser `fetch` that already sends the
session cookie, so the `x-user-id` headers they still send are simply inert — the same decision
PR #80 and #82 made and verified.

### Deletions — the callerless evidence

Verified against `git ls-files` (tracked files only, so `node_modules` / `.next` cannot mask a hit),
searching `*.ts *.tsx *.js *.mjs *.json`:

| Deleted route | Code references found | Verdict |
|---|---|---|
| `app/api/v6/fetch-plugin-data/route.ts` | **1** — the file itself | Callerless. 4 V6 docs mentioned it; all updated. |
| `app/api/oauth/token/route.ts` | **1** — the file itself | Callerless. Redirect URIs checked separately: every live V1 strategy builds `${baseUrl}/oauth/callback/<plugin>` (`gmailPluginStrategy.ts:39,174`, `googleDrivePluginStrategy.ts:43,187`, `slackPluginStrategy.ts:140,159`), so no provider console can be pointing at this path either. |
| `app/api/check-user-status/route.ts` | **1** — the file itself | Callerless. |

### Deviations from SA's ruling

**D1 — `app/api/test/analyze-prompt` is NOT callerless, so it was gated instead of deleted.**
SA's Q3 ruling ("DELETE. Zero callers") rests on a premise that does not hold.
`app/test-plugins-v2/page.tsx` drives this route as a selectable AI service:

| Evidence | Line |
|---|---|
| Request template keyed by the endpoint name | `app/test-plugins-v2/page.tsx:682` |
| Provider/model selector rendered only for it | `:3116` |
| Plugin-context loader rendered only for it | `:3182` |
| Provider/model injected into its request body | `:1436` |
| Dispatch | `:1444` — ``fetch(`/api/${selectedAIService}`)`` |

The endpoint name only ever appears as a **value**, never as a fetch literal, which is exactly why a
path grep reports zero callers. Deleting it would have silently broken an internal tool, and removing
the ~100 lines of test-page UI that drive it is a scope increase Slice 0 should not absorb. It is
therefore gated (`getUser()` + 401, analysis runs against `user.id`), which closes the same hole.
**Whether to delete the route and its UI is SA's call, in Slice B.** This is the one place the brief's
"verify each is callerless before deleting" instruction changed the outcome.

**D2 — logging: the user overrode SA's Q6 recommendation.** SA recommended a third F17 deferral; the
user's ruling was to convert the `console.*` in the files this slice touches. Done — see below.

### `console.*` conversion (user's Q6 ruling)

SA's condition 1 held: four of the six files SA listed left the repo as deletions, so the real
conversion scope shrank. Measured, not estimated:

| File | `console.*` before | Action |
|---|---|---|
| `app/api/v6/fetch-plugin-data/route.ts` | 11 | **Left with the file** (deleted) |
| `app/api/oauth/token/route.ts` | 5 | **Left with the file** (deleted) |
| `app/api/check-user-status/route.ts` | 4 | **Left with the file** (deleted) |
| `app/api/v6/execute-test/route.ts` | 16 | **Converted** (several also removed with the email branch) |
| `app/api/analyze-workflow/route.ts` | 12 | **Converted** |
| `app/api/agent-executions/stats/route.ts` | 2 | **Converted** |
| `app/api/approvals/[id]/respond/route.ts` | 2 | **Converted** |
| `app/api/test/analyze-prompt/route.ts` | 0 | Had no logging at all; `createLogger` added |
| `app/api/v6/generate-ir-intent-contract/route.ts` | 0 | Already compliant |
| `lib/pilot/ApprovalTracker.ts` | 12 | **Not touched** — the fix needed no change to this file, so under CLAUDE.md § Logging it is not a file "I touched". Flagged for F17. |

**Converted: 32 calls across 4 files. Removed with deleted files: 20. Net F17 reduction: 52 calls.**

Treated as a hygiene pass, not a `sed`. The level decisions, and — more importantly — the **three
places user content was being logged and now is not**:

| Was | Now |
|---|---|
| `analyze-workflow:109` — `console.error('No JSON found in OpenAI response:', content)` logged the **model's full reply**, derived from a caller-supplied system prompt | `logger.error({ contentLength }, …)` — size only |
| `analyze-workflow:130` — `console.error('Invalid analysis structure:', analysis)` logged the **parsed model output** about the user's workflow | `logger.error({ receivedKeys: Object.keys(analysis) }, …)` — keys only |
| `execute-test` — request logging printed `body.workflow` and `plugins_required` contents | counts and ids only; `input_variables` and the workflow body are never logged |

Levels: request-received and completion → `info`; **token usage → `info`** (it is the cost signal, and
demoting it would lose spend visibility); internal step chatter ("making tracked AI call", "parsed
successfully") → `debug`; every failure → `error` with `{ err }`. Every line carries `correlationId`
and, where an identity exists, `userId` — never an email.

### Also fixed, because the handler was open anyway

Four 500-paths returned raw internal error text to the client, which CLAUDE.md § Error Response Format
forbids. Dev-guarded in the same edits (`agent-executions/stats`, `approvals` POST and GET,
`analyze-workflow`, `test/analyze-prompt`), matching the F4/F13 treatment in PR #80. **Not** done in
`v6/generate-ir-intent-contract`, whose catch block this slice did not otherwise rewrite — recorded as
a follow-up rather than widened into.

### Tests added

One identity-lock suite per gated route, in the merged `app/api/help-bot-v2/__tests__/auth.test.ts` /
`app/api/enhance-prompt/__tests__/auth.test.ts` shape. **6 suites, 28 tests.** Every suite asserts the
*data layer was never reached*, not merely the status code:

| Suite | Tests | What it locks beyond the 401 |
|---|---|---|
| `app/api/agent-executions/stats/__tests__/auth.test.ts` | 4 | 401 anon / **403 signed-in non-admin** / **403 when the admin check throws** (fail-closed) / `from()` never called on any refusal / the projection is not `'*'` |
| `app/api/v6/execute-test/__tests__/auth.test.ts` | 6 | `WorkflowPilot.execute` never called on refusal; gate precedes `request.json()` (malformed body → 401, not 400); runs as the session admin with the victim id absent from the entire call; **`listUsers()` never called**; **never falls back to the zero UUID** |
| `app/api/approvals/[id]/respond/__tests__/auth.test.ts` | 7 | The forgery case explicitly — signed-in outsider naming a real approver → 403; `recordApprovalResponse` **and** `auditLog` never called on refusal, and neither carries the body id on success; GET 401 anon, 404 for a signed-in non-approver, with no approver id in the refusal body |
| `app/api/analyze-workflow/__tests__/auth.test.ts` | 4 | `chatCompletion` **never called** without a session (the open-LLM-proxy half); attribution is the session id and never `'anonymous'` |
| `app/api/test/analyze-prompt/__tests__/auth.test.ts` | 3 | `analyzePromptDirectAgentKit` never called on refusal; called with the session id on success |
| `app/api/v6/generate-ir-intent-contract/__tests__/auth.test.ts` | 4 | Vocabulary extraction and memory build never called on refusal; **401 replaces the old 400 `'x-user-id header required'`**, which told an anonymous caller exactly what to send next; gate precedes the body parse |

### Mutation control — per route, with the observed result

Each gate was replaced with its **pre-fix identity shape**, the suite re-run, then restored from a
byte-level backup. Command in every case: `npx jest <path> --ci`.

| Route | Mutation applied | Result |
|---|---|---|
| `agent-executions/stats` | `requireAdmin` → `const user = { id: 'anon' }` | **3 of 4 failed** — the 401, the 403 and the fail-closed tests. The 4th (projection ≠ `'*'`) correctly still passes: it is a data-minimisation control, not a gate assertion. |
| `v6/execute-test` | `requireAdmin` → `const user = { id: '00000000-…-0000' }` | **6 of 6 failed** |
| `approvals/[id]/respond` | POST → `const { userId, … } = await request.json()`; GET → `const user = { id: 'anon' }` | **6 of 7 failed**. The 1 pass is the legitimate-approver happy path, which is the no-regression control. |
| `analyze-workflow` | gate removed → `body.userId \|\| x-user-id \|\| 'anonymous'` | **4 of 4 failed** |
| `test/analyze-prompt` | gate removed → `const user = { id: body.userId }` | **3 of 3 failed** |
| `v6/generate-ir-intent-contract` | gate removed → `const userId = request.headers.get('x-user-id') \|\| ''` | **4 of 4 failed** |
| **All six mutated at once** | — | **26 of 28 failed**, the 2 passes being the two controls named above |

Restored from backup: **all six md5 sums are byte-identical to the pre-mutation values**
(`6d10eab9…` analyze-workflow, `b9bcc948…` approvals, `6dca0498…` stats, `697a35a4…` execute-test,
`90d57bbc…` intent-contract, `ed24ea54…` analyze-prompt), and all six suites plus the four
`app/api/plugins/__tests__` suites are green again: **10 suites / 77 tests pass**.

### The dead-route guard caught its first real hit — mine

On the first run, `dead-plugin-routes-removed.guard.test.ts` went **red on the new `analyze-workflow`
route header**, because that header cited the deleted plugin-suggestion endpoint **by path** as the
precedent for gating-versus-deleting, and the guard's rule is that no source file may mention a
removed route.

Fixed by **rewording the comment, not by adding an exemption** — the guard's contract is exactly that
literal absence, and exempting a comment would weaken it for a cosmetic reason. The comment now names
the guard file instead of the path, and says why. Recorded because it is live evidence that the
deny-literal scan reads real files rather than only its own fixtures.

### Results

| Check | Baseline `461a3fbc` | Branch |
|---|---|---|
| New suites | n/a (all 6 are new) | **6 suites / 28 tests pass** |
| Targeted run incl. the 4 `app/api/plugins/__tests__` suites | — | **10 suites / 77 tests pass** |
| `npx jest --ci` (full) | 21 suites / 129 tests failed (the documented `main` baseline, unchanged since `ae902874`) | **21 suites / 129 tests failed**, 8 skipped, **372 suites / 5901 passed** (393 of 401 suites, 178 s). **Failure counts identical.** All 21 are pre-existing `lib/` suites (the `DeclarativeCompiler` / `ConditionalEvaluator` / `StructuredTransforms` families); **no `app/api/` suite fails, and no Slice 0 path appears in the failing set.** The entire delta is the 6 new suites. |
| `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=8192`) | not separately re-measured — see the reasoning in the cell to the right | **2,031 errors, and zero of them in any Slice 0 file** (grepped by path). First pass showed 2,033: both extras were mine, in `agent-executions/stats/__tests__/auth.test.ts`, where an untyped `jest.fn(() => …)` infers a zero-length argument tuple so `mock.calls[0][0]` does not compile. Fixed by typing the mock (`jest.fn((columns: string) => …)`) rather than casting it away. **Stated precisely, because "identical to baseline" would be a claim I did not measure:** the changed files now contribute 0 errors and the deleted files can contribute none, so the branch total is at most the baseline and cannot exceed it. No new error was introduced. |
| `eslint` on all 13 changed files | — | **0 errors**, 13 warnings — every one a pre-existing shape carried over verbatim (`catch (error: any)` signatures ×4, interface `any`s ×4, the unused `OPTIONS(request)` param, and 4 in untouched regions of `generate-ir-intent-contract`). **No warning sits on a line this slice authored.** |
| `next build` | — | **Exit 0, "Compiled successfully".** All six gated routes emit as dynamic (ƒ); none of the three deleted routes appears in the route manifest. |

### Not done, deliberately

- **No new guard, no CI workflow, no `package.json` change** — those are Slice A, per SA's ruling.
- **No `app/api/oauth/callback/[plugin]` or `app/oauth/*` change.** The unsigned-`state` class (R4) is
  **not** closed by deleting `api/oauth/token`; the sibling callbacks still parse it. A test in the
  extended guard asserts those two files still exist, so this deletion cannot be misread later as
  "the OAuth surface was handled".
- `lib/pilot/ApprovalTracker.ts` — not needed by the fix, so not touched (and its 12 `console.*` are
  therefore F17's, not this slice's).
- The inline service-role clients and direct table queries in `agent-executions/stats` — SA ruled
  these follow-ups, not security-branch work. Recorded in the route header.
- `new OpenAIProvider(…)` with a hardcoded `'gpt-4o'` in `analyze-workflow` (SA 3c) — recorded in the
  route header as a follow-up, not fixed.
- No staging, no commit, no push. No other worktree touched.

### Open for SA

1. **D1 — `test/analyze-prompt` was gated, not deleted**, because the Q3 premise was wrong. Confirm
   gating is acceptable, or schedule the route **and its `/test-plugins-v2` UI** for deletion in
   Slice B.
2. **`approvals` GET now 404s a signed-in non-approver.** Previously any caller could read any
   approval. If some flow legitimately needs a read-only view for a non-approver (an admin, the
   execution's owner), that is a requirement this slice did not know about — please confirm.
3. **`v6/execute-test` OPTIONS still sends `Access-Control-Allow-Origin: *`.** Left as-is: it grants
   nothing once the route requires a cookie-bearing admin session, and changing CORS is a separate
   decision with its own blast radius. Flagged rather than silently changed.
4. **The `agent_executions` projection is now an allow-list.** It drops no column the admin page
   renders, but it does mean a new column needs an explicit addition. That is the intent; confirm it
   is the intent.
5. **RLS on `workflow_approval_requests` is still unmeasured** (SA comment 1c). The gate makes the
   question moot for this route but does not answer it; it remains on the user's list.

---

## SA Code Review — Slice 0

**Code Review by SA — 2026-09-21**
**Status:** 🔄 **Fix Required** — one required fix (RF1), everything else approved. RF1 is a ~10-line
gate on a route found by applying Dev's own D1 lesson; once it lands, this goes to QA without a third
SA pass.

**Code Approved for QA:** Yes, conditional on RF1.

I verified rather than read. What I ran myself:

| Check | Result |
|---|---|
| The 6 new auth suites + the extended dead-route guard | **7 suites / 36 tests pass** |
| **Independent mutation control** — I re-broke two gates myself (`generate-ir-intent-contract` back to `headers.get('x-user-id')`; `test/analyze-prompt` back to `body.userId \|\| user.id`) | **4 relevant tests failed**, then both files restored and **md5 confirmed byte-identical** (`90d57bbc…`, `ed24ea54…`) |
| Gate ordering, per file | Confirmed by reading: the gate is the first statement in every `try`, **before** `request.json()` and before any client construction |
| Any caller-supplied identity left in the six | **None.** Every `userId` is `user.id`; `body.userId` / `x-user-id` survive only inside explanatory comments |
| Deletion reachability, including non-literal dispatch | Confirmed — see RV2 |
| Scope | `git status` shows 9 route files, 6 new test dirs, 1 guard, 4 V6 docs, this workplan. **Nothing outside Slice 0.** |

The work is of a high standard. The route headers explain *why* rather than *what*, the tests assert
the data layer was never reached rather than only the status code, the mutation-control table is the
evidence discipline I asked for, and D1 is exactly the kind of pushback I want: Dev checked my ruling,
found its premise false, and did not execute it. That single decision prevented breaking an internal
tool.

---

### Required fix

**RF1 — `app/api/test/generate-agent-v5-test-wrapper/route.ts` is the same hole, in the same harness, and is still open. Severity 🟠 Medium.**

I found this by applying D1's own lesson to the rest of `AI_SERVICE_TEMPLATES`. The harness's service
list (`app/test-plugins-v2/page.tsx:633`) has nine entries; `test/analyze-prompt` is one, and
`test/generate-agent-v5-test-wrapper` is another. That route:

- has **no** `getUser()` and no `requireAdmin` — zero session references in the file;
- documents the defect as intent in its own header: *"This is a TEST API - no authentication
  required. Accepts userId directly in the request body"* (`:7-8`);
- takes `userId` from the body (`:70`) and calls `pluginManager.getAllActivePluginKeys(userId)`
  (`:220`) — **the victim's connected-plugin inventory**, the identical disclosure that put
  `test/analyze-prompt` on the Gate list as row 14;
- additionally takes caller-chosen `provider` **and** `model` (`:75, :249`) and runs a V5 generation
  with them — an unauthenticated LLM endpoint where the caller picks the model, i.e. picks the price.

Why it is required *in Slice 0* rather than deferred: Slice 0's entire rationale is "live, anonymous,
close it today", this is the same defect behind the same UI as a route already in this diff, and the
fix is the `test/analyze-prompt` gate copied verbatim with its test file adapted (~10 lines + ~80 test
lines). Accepting D1 — which says the harness drives routes a grep cannot see — while leaving the
sibling it drives wide open would make the slice internally inconsistent.

*If TL insists on a frozen diff:* it lands as its **own immediate commit before Slice A**, never
Slice B. It is not eligible for the long tail.

**Why both of us missed it, which matters more than the miss.** The file destructures across multiple
lines:

```ts
const {
  enhancedPrompt,
  technicalWorkflow,
  userId,
  …
} = body;
```

Dev's shape pass and my own cross-check both used single-line `{…} =` patterns and both skipped it.
**This is a Slice A guard requirement, not just a note:** rule I2's "a `userId` resolved from
`await request.json()`" matcher must match multi-line destructuring, and this file must become one of
its fixtures. Add it to the workplan's guard section alongside the five false-positive shapes — it is
the first documented *false-negative* shape, and it has a real victim.

---

### Rulings on Dev's five open items

**1. D1 — `test/analyze-prompt` gated, not deleted. CONFIRMED; my Q3 ruling was wrong and is withdrawn.**
I verified the dispatch independently: `AI_SERVICE_TEMPLATES` (`:633`) contains the key
`"test/analyze-prompt"`, the `<select>` is built from `Object.keys(AI_SERVICE_TEMPLATES)` (`:3100`),
and the call is ``fetch(`/api/${selectedAIService}`)`` (`:1444`). The route name exists only as a
value. Gating was the correct call and Dev was right to refuse the delete.

Deleting the route **and** its harness UI is a reasonable future cleanup, but it is **not** Slice B
work — that slice's job is the identity sweep, and removing a working internal tool is a product
decision. Record it as a standalone follow-up ("retire the `/test-plugins-v2` AI-service panel or
keep it and gate the rest"), with RF1 folded in.

**Recorded as a method finding, as asked:** *"no in-repo caller"* established by a path grep is
**not** evidence of deadness wherever a dispatcher builds the path from a variable. The repo has
exactly one such dispatcher today (I grepped for `fetch(\`/api/${`, axios/apiClient wrappers and
`url = \`/api/${` — one hit, the test page). The rule for any future deletion: *grep the path, then
grep for dynamic dispatchers, then grep the deleted route's final path segment as a bare value.* This
belongs in the workplan's Method section and in the Slice A guard's header, because the same blind
spot applies to "this route is unused so it needs no gate".

**2. `approvals` GET now 404s a signed-in non-approver — keep it. No known flow breaks; one to verify.**
I traced every entry point. `components/approvals/UserPendingApprovals.tsx:32` queries
`.contains('approvers', [userId])`, so the dashboard list only ever shows approvals where the viewer
**is** an approver — consistent with the new behaviour. `NotificationService.ts:342` emails the link
to the approvers. The one path that is not obviously safe is
`components/dashboard/RunningExecutionsCard.tsx:200`, which routes the **execution's owner** to
`/approvals/{id}`; `approvers` comes straight from the DSL step (`WorkflowPilot.ts:2240` →
`step.approvers`) with nothing guaranteeing the owner is in it. I found **no** concrete `approvers`
value anywhere in the repo (no fixture, no generated DSL, no sample), which suggests `human_approval`
is effectively unused in production today — so this is a latent edge, not a live regression.

Ruling: **404 stays** — reading another user's approval (title, execution id, approver list, every
response) is a disclosure, and 404-over-403 is the right choice. Add a QA case: *an execution owner
who is not a named approver clicks through from the running-executions card.* If it reproduces, the
fix is "approver **or** the owner of the execution", which needs a scoped join and is a follow-up, not
a hotfix widening.

**3. `v6/execute-test` OPTIONS keeps `Access-Control-Allow-Origin: *` — accepted, and the reasoning in the comment is correct.**
A browser will not attach cookies to a cross-origin request under a wildcard origin, so a cross-site
caller cannot satisfy `requireAdmin()`; the header grants nothing now that the gate exists. Changing
CORS is a separate decision with its own blast radius, and flagging beats silently editing. Two
conditions: the comment must not be read later as "CORS here is fine" — it says "retained, grants
nothing *because of the gate*", which is the right framing and should stay exactly as worded — and
the wildcard belongs on the Q8 follow-up ticket as a housekeeping item.

**4. The `agent_executions` projection allow-list — confirmed, that is the intent.**
I checked it against the consumer: `app/admin/queues/page.tsx` renders `progress` (`:179`),
`execution_type` (`:183`), `execution_duration_ms` (`:188`), the three timestamps (`:202-213`),
`error_message` (`:227`) and `result` as a JSON dump (`:233-240`). The allow-list drops nothing the
page uses and adds nothing it does not. An explicit projection on a cross-tenant service-role read is
exactly right: the next migration cannot start streaming a new column to a browser by default.

One observation, **not** a change request for this slice: `result` is the highest-value field in that
list — it is other tenants' agent output, which can contain content pulled from their mailboxes and
drives — and the page dumps it verbatim. It now reaches verified admins only, which is a legitimate
admin-dashboard posture. Follow-up worth opening: put `result` behind an explicit per-row "reveal"
fetch rather than shipping it in the list payload.

**5. RLS on `workflow_approval_requests` — still unmeasured, still owed, and correctly not claimed.**
Dev did the right thing: the route header states the gate makes the question moot *for this route* and
does not answer it. It stays on the user's list (item 3 of my workplan review). **QA must not record
this slice as "the approvals hole is fully closed"** — what is closed is the route. If that table is
anon-readable, other readers of it are still exposed.

---

### Code review comments

| # | Location | Comment | Priority |
|---|---|---|---|
| CR1 | `dead-plugin-routes-removed.guard.test.ts` — `FORBIDDEN_LITERALS` now contains `/api/oauth/token` | Substring match on a path fragment that also appears inside third-party OAuth token URLs. Today it is safe — the scan is `.ts`/`.tsx` only, and the two in-repo token URLs (`api.notion.com/v1/oauth/token`, `connect.stripe.com/oauth/token`) do not contain `/api/oauth/token` — but a future provider whose token endpoint is `https://host/api/oauth/token`, hard-coded in a `.ts` executor, would turn this guard red on an unrelated plugin PR. That is precisely the false-positive-on-a-required-check failure mode. Cheap fix: match the quote-delimited form, or exclude hits preceded by `://`. Do it in Slice A when this guard joins `test:security-guards`, not now. | Medium |
| CR2 | `analyze-workflow/route.ts` header | The rewording after the guard caught the real hit is correct, and **"fixed the comment, not the guard"** is the right instinct — an exemption for a comment would have hollowed out the literal rule for cosmetics. Keep the incident in the workplan: it is the best evidence anyone has that this scan reads real files. | Praise |
| CR3 | `v6/generate-ir-intent-contract` catch block | The only one of the six that still returns a raw internal message on its 500 path, deliberately, because the slice did not otherwise rewrite that block. Correct call for a hotfix — but it must be in the follow-up list, not only in a prose paragraph. Add it as a named row. | Low |
| CR4 | `agent-executions/stats/route.ts:~120` | `as unknown as AgentExecution[]` for the string projection. Justified in a comment, and the alternative (a generated row type) is out of scope. Acceptable; no action. | Low |
| CR5 | Logging conversions | Spot-checked all three content-suppression claims and they hold: the model's full reply became `contentLength`, the parsed analysis became `Object.keys(...)`, the workflow body became counts. This is the substantive half of the Q6 work — it removed user content from the log stream, not just changed the call shape. `ApprovalTracker.ts` being left untouched is correct: the fix genuinely did not need to modify it, so CLAUDE.md § Logging does not bite. | Praise |
| CR6 | `execute-test` header | "A plain session gate would only have converted 'anyone on the internet' into 'anyone who signed up'" — the reasoning is recorded in the file where the next maintainer will find it, rather than only in a workplan. This is the standard. | Praise |

---

### Notes for QA

1. **RF1 must be in the build you test.** If it is not, say so in the QA report — do not test around it.
2. **Re-run at least two mutation controls independently.** Mine were `generate-ir-intent-contract`
   and `test/analyze-prompt`; take two different ones (`approvals` POST and `agent-executions/stats`
   are the highest value) and verify the md5 restore yourself.
3. **Signed-out `curl`, against the real dev server, not only Jest:** each of the six gated routes
   with a victim `x-user-id` **and** a body `userId` → 401/403, empty data. For `approvals` also
   confirm nothing was written to `workflow_approval_responses`.
4. **The two admin gates** (`execute-test`, `agent-executions/stats`) need a *signed-in non-admin*
   session, not just anonymous — 403, and the admin dashboard at `/admin/queues` still renders for a
   real admin.
5. **The deletions:** confirm 404 on `/api/v6/fetch-plugin-data`, `/api/oauth/token`,
   `/api/check-user-status`, and — the one that matters — **connect a plugin end-to-end** (Gmail or
   Slack) to prove the OAuth flow never used the deleted path.
6. **`/test-plugins-v2`**: `test/analyze-prompt` still works signed in (D1's whole point), and — after
   RF1 — `test/generate-agent-v5-test-wrapper` too.
7. **The approvals owner edge** (ruling 2): owner-who-is-not-an-approver clicking through from the
   dashboard running-executions card.
8. **Do not record "the approvals hole is fully closed"** — see ruling 5.
9. The V6 agent-creation flow through `generate-ir-intent-contract` from `/v2/agents/new`, and the
   wizard step that calls `analyze-workflow`, both signed in. These are the two live UI paths in this
   slice.

---

### For the user

1. **RLS on `workflow_approval_requests`** — still unmeasured; read-only check still owed.
2. **Q6 outcome, for the record:** the user's override produced a better result than my
   recommendation. 32 calls converted, 20 more deleted with their files, net 52 off F17 — and three
   sites that were logging user-derived content stopped. My deferral would have kept all three
   logging. Noted so the precedent is the user's, not mine.
3. **Disclosure judgement** (unchanged from the workplan review): three of these routes were
   anonymously exploitable in production. Still the user's call.

---

### Verdict

- [x] **🔄 Fix Required — RF1 only.** Everything else in Slice 0 is approved as written.
- [x] **Code approved for QA once RF1 lands.** No third SA pass needed: re-run the six (seven) suites
      and hand to QA.
- [ ] Slice A remains blocked on the workplan revision from the first review, now plus the
      multi-line-destructure fixture (RF1) and CR1.

---

## Slice 0 — RF1 and Rebase (Dev) — 2026-09-21

Addendum to § Slice 0 Implementation, covering SA's required fix and the rebase the user asked for
before anything is committed. **Still nothing staged, committed or pushed.**

### RF1 — `app/api/test/generate-agent-v5-test-wrapper/route.ts` gated

SA's finding confirmed on reading: zero session references in the file, `userId` destructured from
the body (`:70`) into `pluginManager.getAllActivePluginKeys(userId)` (`:220`) — the victim's connected
plugin inventory — plus caller-chosen `provider` and `model` driving a V5 generation. The id was used
**twice**: once for the plugin lookup and once when constructing `V5WorkflowGenerator({ …, userId })`
(`:242`), so both sites had to move.

Fix, as instructed — the `test/analyze-prompt` gate copied verbatim:

| Change | Detail |
|---|---|
| Gate | `getUser()` + 401 as the first statement in the `try`, **before `req.json()`** |
| Identity | `const userId = user.id`; the body value is not read |
| Type | `userId` **removed from `V5TestWrapperRequest`** — not merely ignored. A field that is no longer an input should not stay in the request type, or the next author will wire it back up |
| Validation | `if (!userId) missingFields.push('userId')` deleted — it cannot be missing once it comes from the session, and a 400 naming `userId` would have told an anonymous caller what to send |
| Header comment | **Corrected.** It previously read *"This is a TEST API - no authentication required. Accepts userId directly in the request body"* — a defect documented as a design decision. The new header states what that actually meant, and that `/api/test/*` ships to production like any other route |
| 500 path | `error.message` was returned raw; now dev-guarded, matching the other Slice 0 500-paths. (The `stack` was already guarded.) |

**`console.*`: none to convert — the file was already on Pino** (`createLogger` at `:24`, 0 `console.*`).
The user's standing Q6 decision was applied and found nothing to do here, so the Slice 0 conversion
total is unchanged at 32.

### RF1 tests and mutation control

`app/api/test/generate-agent-v5-test-wrapper/__tests__/auth.test.ts` — **5 tests**, same shape as the
sibling:

1. 401 anonymously with a victim `userId` in the body — and **neither** `getAllActivePluginKeys`
   **nor** `generateWorkflow` is called (the disclosure and the LLM spend, asserted separately).
2. 401 with only an `x-user-id` header.
3. Gate precedes `req.json()` — malformed body returns 401, not 400/500.
4. Signed in with a victim id in the body and header: the plugin lookup is called with the **session**
   id, the generator is **constructed** with the session id, and the victim value appears in neither.
   This is the test that catches fixing only one of the two id sites.
5. A signed-in caller who omits `userId` entirely now succeeds instead of getting a 400 naming it.

**Mutation control** — `npx jest app/api/test/generate-agent-v5-test-wrapper --ci`, gate replaced with
the pre-fix shape (`const { …, userId, … } = body as any`): **4 of 5 failed**. The 1 pass is test 5,
which is the no-regression control rather than a gate assertion. Restored from backup, **md5
`64570a1f2bc1f362bed59b25559a9d55` byte-identical**, suite green again (5/5).

### The harness, swept rather than spot-fixed

SA found RF1 by applying D1's lesson to `AI_SERVICE_TEMPLATES`. Rather than fix the one route named,
the same lesson was applied to **all nine** entries — the key list extracted from the object literal
by brace-matching, then each mapped to its route file and checked for a session reference:

| Harness service | Session gate? |
|---|---|
| `analyze-prompt-clarity` | ✅ (PR #80, F4) |
| `enhance-prompt` | ✅ (PR #80, F13) |
| `generate-clarification-questions` | ✅ (PR #80, F13) |
| `test/analyze-prompt` | ✅ Slice 0 (D1) |
| `test/generate-agent-v5-test-wrapper` | ✅ Slice 0 (RF1) |
| `generate-agent-v2` | ✅ pre-existing |
| `generate-agent-v3` | ✅ pre-existing |
| `generate-agent-v4` | ✅ pre-existing |
| `generate/input-schema` | ❌ — **already tracked as sweep row 16**, Slice B |

So the harness is fully swept and the one remaining gap is already on the plan, not a new find. Both
routes under `app/api/test/**` now carry a gate.

### Slice A guard requirement — the first documented FALSE-NEGATIVE shape

Recorded as SA instructed, to sit alongside the five false-positive shapes in § Guard design.

**Shape: multi-line object destructuring of the request body.**

```ts
const {
  enhancedPrompt,
  technicalWorkflow,
  userId,          // <- identity, invisible to a single-line pattern
  provider,
} = body;
```

Both the sweep's shape pass and SA's independent cross-check used single-line `{…} =` patterns, and
**both missed this file**. It is the first false negative found in this programme, and unlike the
false positives it had a real victim: an anonymously reachable cross-user disclosure survived two
passes.

**Requirement on rule I2:** its "a `userId` resolved from `await request.json()`" matcher must match
multi-line destructuring, and `app/api/test/generate-agent-v5-test-wrapper/route.ts` (at its pre-fix
content, captured in this workplan) must be one of its fixtures. A guard that only matches the
one-line form would have shipped green over this exact hole.

**Related Method requirement**, also from SA's ruling on D1 — for any future deletion or
"unused, so it needs no gate" judgement: *grep the path, then grep for dynamic dispatchers
(`` fetch(`/api/${ ``, url-building wrappers), then grep the route's final path segment as a bare
value.* The repo has exactly one such dispatcher today (`/test-plugins-v2`), and it hid two routes.

### Follow-ups recorded, not fixed (SA CR1, CR3)

| # | Item | Where it lands | Severity |
|---|---|---|---|
| **CR1** | `FORBIDDEN_LITERALS` matches `/api/oauth/token` as a bare substring. Safe today — the scan is `.ts`/`.tsx` only and the two in-repo provider token URLs (`api.notion.com/v1/oauth/token`, `connect.stripe.com/oauth/token`) do not contain it — but a future provider whose token endpoint is `https://host/api/oauth/token`, hard-coded in a `.ts` executor, would redden this guard on an unrelated plugin PR. That is the false-positive-on-a-required-check failure mode the whole design is trying to avoid. Fix: match the quote-delimited form, or exclude hits preceded by `://`. | **Slice A**, when this guard joins `test:security-guards` — not before, since it is only a required check from that point | Medium |
| **CR3** | `app/api/v6/generate-ir-intent-contract/route.ts:397` still returns `error?.message` raw on its 500 path — the only one of the seven not dev-guarded, because Slice 0 did not otherwise rewrite that catch block. | **Slice B** (named row, not prose) | Low |
| **CR4** | `as unknown as AgentExecution[]` in `agent-executions/stats` — accepted by SA, no action. | — | — |
| **SA ruling 2 follow-up** | `approvals` GET: if an execution owner who is not a named approver legitimately needs to read, the fix is "approver **or** execution owner", needing a scoped join. QA case added below. | Follow-up if QA reproduces | Low |
| **SA ruling 4 follow-up** | Put `agent_executions.result` behind a per-row "reveal" fetch rather than shipping it in the list payload. | Q8 ticket | Low |
| **SA ruling 3 follow-up** | `v6/execute-test` OPTIONS wildcard CORS → housekeeping item on the Q8 ticket. | Q8 ticket | Low |
| **Harness retirement** | Retire the `/test-plugins-v2` AI-service panel, or keep it and gate the rest — SA ruled this a standalone product decision, **not** Slice B. RF1 is folded in. | Standalone | — |

### Rebase onto the latest `origin/main`

Done before any commit, as the user asked.

| Step | Result |
|---|---|
| `git fetch origin main` | `origin/main` had moved **461a3fbc → cddc1916**, 12 commits: PR #83 (payment tables write-lockdown + migration), PR #84 (its docs), **PR #85 (Business OS LLM Layer 2 Step 2**, 8 feature commits across insights / briefing / leads / intake / onboarding / website**)** |
| Mechanics | The branch had **no commits** — all Slice 0 work is uncommitted in the working tree — so there was nothing for `git rebase` to replay. The equivalent and safer operation: `git stash -u` → `git merge --ff-only origin/main` → `git stash pop`. A full file-level backup was taken first |
| Conflicts | **None.** The stash popped clean |
| **Overlap check** | **Zero.** `git diff --name-only 461a3fbc origin/main` lists 32 files — all under `lib/business-os/**`, `lib/services/**`, `app/api/{onboarding,website,intake,cron}/**`, two workplans and one migration. **Not one of them is a Slice 0 file**, checked path-by-path against all 16. Nobody fixed any of these routes in parallel, so nothing of ours needed dropping (the QA-1 lesson did not bite this time) |
| Integrity | Content verified byte-for-byte against the backup. Seven files' md5 changed — **line endings only**: git normalised LF→CRLF on stash/pop for the files written fresh. Confirmed with `diff <(tr -d '\r' …)` across every changed and new file: **no content difference anywhere** |
| Deletions | All three deleted route directories confirmed still absent after the pop |

### Fresh verification on the new base `cddc1916`

**The old baseline was discarded, not reused.** A clean baseline was measured by stashing the work,
confirming the tree was clean `origin/main`, and running the full suite there.

| Check | Fresh baseline `cddc1916` | Branch on `cddc1916` |
|---|---|---|
| `npx jest --ci` | **21 suites / 129 tests failed**, 8 skipped, 370 suites / 5936 passed (391 of 399) | **21 suites / 129 tests failed**, 8 skipped, **377 suites / 5971 passed** (398 of 406) |
| Failing-suite **set** | — | **Identical — verified with `diff` on the sorted FAIL lists, not by comparing counts.** Counts can coincide while the membership changes; the set does not |
| Delta | — | **+7 suites / +35 tests**, exactly the new work: 7 new auth suites (33 tests) + 2 tests added to the existing dead-route guard |
| `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=8192`) | **2,035 errors** — measured on the stashed clean tree, not carried over | **2,035 errors — identical**, and **zero in any Slice 0 file** (grepped by path). Unlike the first pass this baseline was measured rather than inferred, so "no new errors" is now a comparison and not an argument. (The old base gave 2,031; the +4 arrived with `origin/main`, not with this work.) |
| `eslint` on all 15 changed files | — | **0 errors**, 14 warnings — the 13 from the first pass plus one more, all pre-existing shapes (`catch (error: any)` ×5, interface `any`s, the unused `OPTIONS(request)` param). RF1's single warning is the pre-existing `catch (error: any)` at what is now `:331`, confirmed present at `:298` in `git show HEAD:…`. **No warning sits on a line this slice authored** |
| `next build` | — | **Exit 0, "Compiled successfully".** All **seven** gated routes emit as dynamic (ƒ), including `/api/test/generate-agent-v5-test-wrapper`; none of the three deleted routes appears in the manifest. The `DYNAMIC_SERVER_USAGE` prerender logs are pre-existing noise from unrelated admin/cron routes |

### Final state

- **HEAD `cddc1916`** (latest `origin/main`), branch `fix/identity-sweep`.
- **Nothing staged, nothing committed, nothing pushed.** 23 working-tree entries: 12 modified, 3
  deleted, 7 new test directories, 1 new workplan.
- No other worktree touched.
- Slice 0 now covers **9 routes**: 3 deleted, 6 gated (2 of them admin-only), plus the extended
  dead-route guard, **7 auth suites / 33 tests**, and 4 V6 docs.

---



## QA Testing Report

**QA — 2026-09-21**
**Test mode:** full (Slice 0 only — Slices A and B are not in the tree)
**Strategy used:** **C + B + E** — (C) a live signed-out exercise of every route in the slice against the running dev server on `http://localhost:3007`, because the central claim ("an anonymous HTTP caller can do X") is only provable over HTTP; (B) the branch's own Jest suites plus two independent mutation controls; (E) source reading for everything that needs a session, an admin session or a DB read that QA cannot produce. **No Playwright** — it is not installed (CLAUDE.md § Testing).
**Focus:** security (identity gating), api, logging, regression
**Skipped:** every signed-in path — see [Pending](#pending--requires-the-user). No destructive call was made: every live request used a synthetic victim id (`11111111-…-1111`) and a non-existent approval/agent id, so nothing was written anywhere.
**Input source:** prompt keywords + SA's § Notes for QA (items 1–9) + Dev's § Slice 0 — RF1 and Rebase
**Build tested:** `fix/identity-sweep` working tree at HEAD `cddc1916`, **RF1 present** (`app/api/test/generate-agent-v5-test-wrapper/route.ts` gated — SA's Notes-for-QA item 1 satisfied, not tested around). Nothing staged, committed or pushed by QA; the worktree was left byte-identical to how it was found (proof below).

---

### Verdict

**✅ PASS for the Slice 0 diff.** All 9 routes behave as specified against a live, cookie-less caller; the regression set is provably unchanged; both independent mutation controls reddened and restored byte-exactly. **No bug was found in the Slice 0 change itself.**

Three findings are recorded below. **None is a defect in this diff** — one is a pre-existing route of the same *capability* class that this slice did not cover (QA-1), one is a consistency gap created by SA's new 404 ruling (QA-2), one is an ordering nit on an adjacent route (QA-3). QA-1 is the only one that changes what may be *claimed* about this slice.

**Two claims QA explicitly does NOT make**, per SA ruling 5 and the evidence available:

1. **Not** "the approvals hole is fully closed" — RLS on `workflow_approval_requests` remains **unmeasured**. What is closed is this route.
2. **Not** "anonymous execution-with-someone-else's-credentials is eliminated from the repo" — see **QA-1**.

---

### Test coverage

| # | Acceptance criterion (SA Notes for QA / prompt tasks) | Tested? | Result | Evidence |
|---|---|---|---|---|
| 1 | Signed-out `curl`, victim `userId` in the body **and** `x-user-id` header → 401/403, no data, on every gated route | ✅ | **Pass** | 8 handlers, all 401. Bodies verbatim below — no user data, no plugin data, no execution rows, no agent ids, no approver ids |
| 2 | The gate precedes `request.json()` **live** (not just in Jest) | ✅ | **Pass** | Malformed body `NOT{JSON` anonymously → **401** on all 6 POST routes, never 400/500 |
| 3 | Deleted routes 404 on GET **and** POST | ✅ | **Pass** | 6/6 → 404. Directories absent; all three verified **present** in the `cddc1916` baseline export, so the deletions are real and were live on `main` |
| 4 | `fetch-plugin-data`'s capability (execute a plugin as a named user, anonymously) is gone, and no sibling offers it | ⚠️ | **Partial — see QA-1** | Route 404s. No remaining `app/api/v6/**` route executes a plugin/workflow with a caller-supplied user id. `plugins/execute` 401s, `channel-insights/connect` 401s. **But** `POST /api/sentinel/webhook/{agentId}` still executes a workflow anonymously via an agent id |
| 5 | `agent-executions/stats` returns nothing anonymously | ✅ | **Pass** | `{"success":false,"error":"Unauthorized"}`, zero rows |
| 6 | The column allow-list drops payload fields it should not return | ⚠️ | **Pass with a correction** | It provably drops 6 cross-tenant columns; it deliberately **keeps** `user_id`. See [Note on the projection](#note-on-the-projection) — the claim needs rewording, the code is right |
| 7 | Regression: failing-suite **set** identical to a fresh `cddc1916` baseline, diffed as sorted lists | ✅ | **Pass** | QA measured its own baseline. Both sorted FAIL lists hash to `6551bc651fd7106262d658179e6ae1bc` |
| 8 | The 7 new auth suites pass | ✅ | **Pass** | All 7 `PASS` inside the full run, plus the extended dead-route guard |
| 9 | Mutation control, two routes, re-run independently, restored byte-exactly | ✅ | **Pass** | `agent-executions/stats` 3/4 red, `approvals` POST 4/7 red (the 3 GET tests stayed green — a clean discrimination result); both md5s restored |
| 10 | The three sites that stopped logging user content really do not | ✅ | **Pass** | Verified by reading all three; plus `systemPrompt`/`userMessage` are logged as **lengths** |
| 11 | No `console.*` left in the changed files | ✅ | **Pass** | 0 across all 8 changed/new `.ts` route files and the new test dirs |
| 12 | `approvals` GET 404 for a signed-in non-approver + the execution-owner edge | ⚠️ | **Assessed from code — live check PENDING** | The edge is **real and latent**, exactly as SA described |
| 13 | Admin routes 403 (not 401) for a signed-in non-admin | ⏸️ | **PENDING** | QA cannot mint a session. Jest proves it (incl. fail-closed); live proof is owed |
| 14 | Signed-in UI paths still work (`/v2/agents/new`, wizard, `/test-plugins-v2`, `/admin/queues`, approve/reject) | ⏸️ | **PENDING** | Requires the user |
| 15 | Nothing written to `workflow_approval_responses` on the refused calls | ⚠️ | **Inferred, not measured** | The 401 is returned before `ApprovalTracker` is constructed (read the handler), and Jest asserts `recordApprovalResponse` and `auditLog` are never called. A DB confirmation is still owed |

---

### Live evidence — signed out, on `http://localhost:3007`

Every request carried **both** `x-user-id: 11111111-1111-1111-1111-111111111111` and a body/query `userId` of the same value.

```
POST /api/approvals/aaaaaaaa-.../respond            401  {"error":"Unauthorized"}
GET  /api/approvals/aaaaaaaa-.../respond?userId=…   401  {"error":"Unauthorized"}
POST /api/v6/generate-ir-intent-contract            401  {"success":false,"error":"Unauthorized"}
POST /api/analyze-workflow                          401  {"success":false,"error":"Unauthorized"}
POST /api/test/analyze-prompt                       401  {"success":false,"error":"Unauthorized"}
POST /api/test/generate-agent-v5-test-wrapper       401  {"success":false,"error":"Unauthorized"}
POST /api/v6/execute-test            (uuid form)    401  {"success":false,"error":"Unauthorized"}
POST /api/v6/execute-test            (email form)   401  {"success":false,"error":"Unauthorized"}
GET  /api/agent-executions/stats?userId=…           401  {"success":false,"error":"Unauthorized"}

gate-before-parse, body = `NOT{JSON`, anonymous:
  analyze-workflow 401 · generate-ir-intent-contract 401 · test/analyze-prompt 401
  generate-agent-v5-test-wrapper 401 · v6/execute-test 401 · approvals respond 401

deletions:
  GET/POST /api/v6/fetch-plugin-data   404 / 404
  GET/POST /api/oauth/token            404 / 404
  GET/POST /api/check-user-status      404 / 404
```

Three details worth recording:

- **The refusal bodies carry nothing.** Two envelopes are in use (`{error}` for approvals, `{success,error}` elsewhere) — both are the route's own pre-existing envelope, which is the shape SA required, and neither echoes the supplied id.
- **The email form of `execute-test` is refused identically to the UUID form**, so the `listUsers()` enumeration oracle is not reachable even as a timing difference. Source-confirmed: `listUsers` and `00000000-…-0000` survive only inside the route's explanatory header comment; there is no live call left.
- `POST /api/plugins/execute` → 401 and `GET /api/plugins/execute?userId=…` → 401 (PR #73 still holding), `POST /api/business-os/channel-insights/connect` → 401.

---

### The critical claim, tested hardest (prompt task 3)

**`fetch-plugin-data` is gone** — 404 on both verbs, directory absent, present in the `cddc1916` export so the deletion is genuine, and locked by `dead-plugin-routes-removed.guard.test.ts` (`REMOVED_FILES` + `REMOVED_DIRS` + `FORBIDDEN_LITERALS`), which also asserts the two **not**-deleted OAuth routes still exist so the deletion cannot later be misread as "the OAuth surface was handled". That guard test passes.

**Sibling sweep.** Every `route.ts` under `app/api/v6/**` (20 files) was scored for a session source, a caller-supplied identity and a plugin/workflow executor. **No remaining V6 route executes anything with a caller-supplied user id.** Two residues, both already on the plan:

| Route | State | Where it is tracked |
|---|---|---|
| `v6/generate-semantic-grounded` | requires `body.userId`, **never uses it**; no session | sweep row 18, Slice B (Q2: delete the field + gate) |
| `v6/compile-workflow` | stamps `body.userId` into the emitted workflow; no session | sweep row 17, Slice B |
| `v6/test-direct-generation` | ungated LLM pipeline, but identity is the hardcoded literal `'system'` — not caller input | Q8 class |

Repo-wide, only three `route.ts` files touch `PluginExecuterV2` (`plugins/execute`, `plugins/fetch-options`, `business-os/channel-insights/connect`) and all three reference a session source; the first and third 401 anonymously (live).

**But the capability is not extinct** — see **QA-1**.

---

### Issues found

#### Bugs in the Slice 0 diff

**None.**

#### New finding — not this diff, but it bounds what may be claimed

**QA-1 — `POST /api/sentinel/webhook/{agentId}` is an anonymous, service-role, workflow-execution surface. Severity: High. Pre-existing on `main`; NOT introduced by Slice 0; does NOT block it.**

The file documents it as intent: *"Use service role client for webhook access (no authentication required)"* (`:8`) and *"Accept POST requests only (no authentication)"* (`:23`). There is **no** shared secret, signature or token check anywhere in the handler — grepped and read. It takes `agentId` from the path, reads the agent with a service-role client, and — if `agent.mode === 'triggered'` — executes that agent through `WorkflowPilot` / `runAgentKit` as `agent.user_id`, i.e. **with the owner's stored plugin credentials**, writing execution rows under the owner's id.

Live-confirmed reachable anonymously: `POST /api/sentinel/webhook/deadbeef-…` → `404 {"error":"Agent not found"}`, which is the *database lookup* answering — nothing refused the caller first. (A random id was used deliberately; no real agent was triggered.)

Why it matters here and not merely on a backlog:

- It is the same **capability** as the deleted `fetch-plugin-data` — anonymous execution using a victim's credentials — reached through a **resource** id instead of a user id. The sweep's filter ("a request-supplied value that looks like a *user* id") is structurally blind to it, which is the same root cause SA already diagnosed in § 2 comment 2 and ruled into **Q8**.
- Slice 0 **materially reduced** its exploitability without targeting it: `agent-executions/stats` was the anonymous dispenser of `agent_id` values, and it is now admin-only. The remaining prerequisite is knowing an agent UUID and the agent being in `triggered` mode.
- It is milder than `execute-test` in one respect — the attacker controls the webhook *payload*, not the workflow definition.

**Action:** file on the Q8 ticket ("unauthenticated service-role surfaces") **by name**, flagged as *execution*, not *read* — the 39-file seed list SA produced was framed as read surfaces, and this one is worse than that framing implies. Until it is closed, no document should say the anonymous-execution class is eliminated.

#### Edge cases (nice to fix)

**QA-2 — the approvals existence oracle moved from GET to POST. Severity: Low. Slice B.**
SA ruled GET must 404 a signed-in non-approver so that "a stranger cannot confirm the id exists", and the code does exactly that. But POST still distinguishes, for any signed-in caller: `404` (no such approval) · `403 "User not authorized to respond to this approval"` (exists, you are not an approver) · `400 "Approval request is no longer pending"` plus `status` (exists, and here is its state). So the reconnaissance the GET-404 was chosen to prevent is still available one verb over, to anyone with an account. Not a regression — the 403 predates this slice — but the 404 decision is new, so the inconsistency is new. Suggested fix: 404 the non-approver on POST too, keeping 403 only where it cannot leak (it has no legitimate consumer — the approvals page renders "You are not authorized to respond to this approval request" from any non-OK response).

**QA-3 — `app/api/plugins/fetch-options` validates before it authenticates. Severity: Low. Informational.**
Anonymous `POST` returns `400 {"success":false,"error":"Missing required fields: plugin, action, parameter"}` (`:43`, `:53`) **before** `auth.getUser()` at `:59`. Identity is session-derived, so there is no IDOR and no data leak — but it does pre-auth work and hands an anonymous caller a field-name oracle, which is the opposite of the "gate first, before `request.json()`" shape this sweep is standardising. Not in the inventory (it reads no caller-supplied identity, so its absence there is correct), but it is a candidate for the Slice A guard's *ordering* discussion and a one-line Slice B fix.

#### Note on the projection

**The `EXECUTION_COLUMNS` allow-list does not drop `user_id` — and should not be described as doing so.** It keeps `user_id`, `agent_id`, `error_message` and the full `result` payload, deliberately, because the route is admin-only and cross-tenant by design (SA ruling 4 confirms the list matches what `app/admin/queues/page.tsx` renders).

What it **does** drop is real and verifiable: `agent_executions` carries at least six columns beyond the list — `total_cost_usd`, `primary_model`, `primary_provider`, `models_used`, `routing_tier`, `complexity_score` (`supabase/migrations/20260629_execution_model_tracking.sql:6-20`). `select('*')` was streaming every tenant's **model and spend** data to an anonymous caller; the allow-list ends that and would have prevented it. So the data-minimisation claim holds — it is just a claim about *future and unrendered* columns, not about `user_id`.

Two optional follow-ups, neither blocking: `user_id` is declared in the page's `ExecutionData` interface but **never rendered** (only `agent_id` is, at `:116` and `:464`), so it could come out of the projection as well; and SA's own suggestion to put `result` behind a per-row reveal still stands.

---

### Regression — measured against an independently built baseline

QA did **not** reuse Dev's recorded baseline. The constraint was "no staging, no commits", so `git stash` was not an option; instead a clean `cddc1916` tree was produced **outside every worktree** with `git archive cddc1916 | tar -x -C <scratchpad>/baseline` and given the branch's `node_modules` via a directory junction. No worktree was modified to obtain it. The three deleted routes were confirmed **present** in that export, which independently corroborates that they were live on `main`.

| Run | Test Suites | Tests |
|---|---|---|
| **Baseline `cddc1916`** (QA-measured) | 21 failed, 8 skipped, 370 passed, 391 of 399 | 129 failed, 59 skipped, 5935 passed, 6123 total |
| **Branch** (`MSYS_NO_PATHCONV=1 npx jest --ci`) | 21 failed, 8 skipped, 377 passed, 398 of 406 | 129 failed, 58 skipped, 5971 passed, 6158 total |

**Failing-suite SET: identical — proved by `diff` on the sorted lists, not by comparing counts.** Both files hash to `6551bc651fd7106262d658179e6ae1bc`. A `comm` on the sorted PASS lists shows the delta is exactly the **7 new auth suites** and **zero** suites disappeared:

```
app/api/agent-executions/stats/__tests__/auth.test.ts
app/api/analyze-workflow/__tests__/auth.test.ts
app/api/approvals/[id]/respond/__tests__/auth.test.ts
app/api/test/analyze-prompt/__tests__/auth.test.ts
app/api/test/generate-agent-v5-test-wrapper/__tests__/auth.test.ts
app/api/v6/execute-test/__tests__/auth.test.ts
app/api/v6/generate-ir-intent-contract/__tests__/auth.test.ts
```

All 21 failures are the documented pre-existing `lib/` families (`DeclarativeCompiler` ×5, `ConditionalEvaluator` ×2, `StructuredTransforms` ×3, v6 generation/compiler ×4, orchestration ×2, `v4-generator`, `featureFlags`, `archetypes`, `v6-integration`). **No `app/api/` suite fails, and no Slice 0 path appears in the failing set.**

**One benign anomaly, recorded rather than smoothed over:** skipped tests went 59 → 58 while passed went +36 against +35 new tests, i.e. one *pre-existing* test moved skipped → passed. It is not in a Slice 0 path: the repo's conditional skips are all environment- or fixture-gated, and the only non-fixture one is `lib/business-os/catalog/__tests__/enum-drift.test.ts:37` (`CONNECTED ? describe : describe.skip`, keyed on `NEXT_PUBLIC_SUPABASE_URL`), whose skip state depends on ambient env rather than on this diff. Fixture files were confirmed byte-identical in both trees. Failure counts and the failure set are unaffected either way.

---

### Mutation controls — re-run independently by QA

SA's own controls were `generate-ir-intent-contract` and `test/analyze-prompt`; per SA's Notes-for-QA item 2, QA took the **two different, highest-value** ones. Command in both cases: `MSYS_NO_PATHCONV=1 npx jest <path> --ci`.

| Route | Mutation applied | Observed |
|---|---|---|
| `agent-executions/stats` | `requireAdmin(...)` + `if (gate instanceof NextResponse) return gate;` + `const { user } = gate;` → `const user = { id: 'anon-qa-mutation' };` | **3 of 4 failed** — `401s with no session…`, `403s a signed-in non-admin…`, `fails closed when the admin check throws`. The 4th (`projects columns explicitly rather than select(*)`) correctly still passed: it is a data-minimisation control, not a gate assertion. **Reproduces Dev's recorded 3/4 exactly.** |
| `approvals/[id]/respond` **POST only** | the `getUser()` gate and `const userId = user.id;` → `const { userId, decision, comment } = await request.json();` | **4 of 7 failed** — all four POST tests (`401s with no session, and records nothing`; `refuses before parsing the body`; `403s a signed-in non-approver who names a real approver in the body`; `records a real approver against the SESSION id, and audits the same id`). **The 3 GET tests stayed green**, which is the discrimination result: mutating one handler reddens only that handler's assertions |

**Restore verified byte-exactly**, not merely "looks fine":

```
agent-executions/stats/route.ts   6dca0498c4b6b12040e4c78254183e9c  (== pre-mutation)
approvals/[id]/respond/route.ts   b9bcc948e58b318c3eebf0c2d894a9c2  (== pre-mutation)
grep -c 'anon-qa-mutation' → 0 ; both suites green again (4/4 and 7/7)
```

**Worktree integrity.** md5 of all **seven** gated route files was captured before any QA action and re-diffed after: **identical**. `git status --porcelain` sorted before/after: **identical** (23 entries — 12 modified, 3 deleted, 7 new test dirs, 1 workplan). Nothing was staged, committed, stashed or pushed; no other worktree was touched; no server was started or stopped. *(Note: two of the seven md5s — `analyze-workflow` `d939947d…` and `execute-test` `63132a82…` — differ from the values Dev recorded in § Slice 0 Implementation. That is expected: those values predate the rebase, and Dev recorded that seven files' line endings were normalised LF→CRLF during the stash/pop with content verified unchanged. The four files Dev re-recorded after RF1 and the rebase — stats, approvals, intent-contract, generate-agent-v5 — match QA's measurements exactly.)*

---

### Logging check

**All three content-suppression claims verified by reading the live code, and they hold.**

| Site | Verified |
|---|---|
| `analyze-workflow:164-172` | `requestLogger.error({ userId, contentLength: content.length }, 'No JSON object found in the model response')` — **size only**, the model's full reply is gone |
| `analyze-workflow:192-198` | `requestLogger.error({ userId, receivedKeys: Object.keys(analysis ?? {}) }, …)` — **keys only**, no values |
| `v6/execute-test:99-103` | `{ …, stepCount: body.workflow?.length, pluginCount: body.plugins_required?.length }` — counts only. The route has exactly **four** logging calls in total (`:81` child, `:99`, `:155`, `:196`); none references `body.workflow`, `input_variables` or any step content |

Two more, not claimed by Dev but worth recording: `analyze-workflow:101-110` logs `userMessageLength` / `systemPromptLength` rather than the caller-supplied prompt text (this route's whole defect was arbitrary caller-authored system prompts, so logging them would have re-created the exposure in the log stream); and the JSON-parse failure path at `:178-190` logs `{ err }` **without** `jsonMatch[0]`, which is the obvious place a "helpful" log line would reintroduce model output.

**`console.*` in the changed files: 0.** Grepped across all seven gated routes, `agent-executions/stats`, the extended guard and the seven new `__tests__` directories — no `console.log/warn/error/debug/info` anywhere. `lib/pilot/ApprovalTracker.ts` (12 calls) was correctly not touched: the fix genuinely required no change there, so CLAUDE.md § Logging does not bite; it remains F17's.

---

### SA's QA cases — assessed from code

**The approvals owner edge (SA ruling 2) — CONFIRMED as a real latent edge. Live check PENDING.**

The chain is intact and reproduces SA's reading exactly:

| Step | Code |
|---|---|
| The card is scoped to the viewer's **own** executions | `RunningExecutionsCard({ userId })`, `.eq('user_id', userId)` (`:55`, `:109`) — so the clicker is the execution **owner** |
| Clicking routes them to the approval | `handleExecutionClick` → `router.push('/approvals/' + execution.approval_id)` (`:197-202`) |
| The page reads via the gated GET | `fetch('/api/approvals/' + approvalId + '/respond')` (`app/(protected)/approvals/[id]/page.tsx:46`) |
| A non-OK response becomes a page-level error | `throw new Error(data.error …)` → `setError(err.message)` (`:48-57`) |
| `approvers` has **no owner fallback** | `WorkflowPilot.ts:2240` passes `approvers: step.approvers` straight from the DSL into `createApprovalRequest` |

So **if** a `human_approval` step's `approvers` omits the execution owner, that owner now sees *"Approval request not found"* where they previously saw the approval. They could never have *responded* (POST has always checked `approvers`), so the loss is read-only — but it is a dead end in the UI rather than a message explaining it.

Confirming SA's mitigating evidence: QA found **no concrete `approvers` value anywhere in the repo** — no fixture, no generated DSL, no sample — so `human_approval` appears unused in practice and this is latent, not a live regression. **404 should stay.** If it ever reproduces, the fix is "named approver **or** the execution's owner", which needs a scoped join and is a follow-up, not a hotfix widening. **Marked PENDING** — it needs a signed-in owner and a real approval row, which QA cannot create.

**RLS on `workflow_approval_requests` — NOT claimed, NOT measured.** Per SA ruling 5 this report records only that the *route* is closed. The table still has no migration in this repo and its anon-SELECT posture is unknown; any other reader of it is unaffected by this slice.

---

### Pending — requires the user

Everything here needs a real session, an admin session, or a DB read. None of it blocks the correctness of the diff; all of it is needed before the slice can be called *verified in use*.

| # | Check | Why QA could not do it |
|---|---|---|
| P1 | **403** (not 401) for a signed-in **non-admin** on `v6/execute-test` and `agent-executions/stats` | No session can be minted from a shell. Jest proves the 403 and the fail-closed-on-throw path; the live half is owed |
| P2 | `/admin/queues` still renders for a real admin (the allow-list drops nothing the page needs) | Needs an admin session |
| P3 | `/test-plugins-v2` → `test/analyze-prompt` **and** `test/generate-agent-v5-test-wrapper` still work signed in (D1's and RF1's whole point) | Needs a session |
| P4 | `/v2/agents/new` full creation through `generate-ir-intent-contract`; the wizard step that calls `analyze-workflow` | Needs a session |
| P5 | Approve **and** reject as a legitimate approver; signed-in non-approver still refused | Needs a session and a real approval row |
| P6 | **The owner-not-approver edge** (SA ruling 2, assessed above) | Needs a `human_approval` execution |
| P7 | DB confirmation that the refused POSTs wrote nothing to `workflow_approval_responses` | Inferred from the handler order and the Jest mocks; not measured |
| P8 | **Connect a plugin end-to-end** (Gmail or Slack) to prove the OAuth flow never used the deleted `/api/oauth/token` | Needs an OAuth consent. Static evidence is strong: every V1 strategy builds `${baseUrl}/oauth/callback/<plugin>`, and `app/oauth/token` (the non-`api` sibling) still exists and still answers — live-checked, `GET /oauth/token` → 400, i.e. reachable and unaffected by the deletion |
| P9 | **RLS on `workflow_approval_requests`** — the read-only measurement SA has now asked for three times | Needs prod DB access |
| P10 | **Disclosure judgement** — `fetch-plugin-data`, `execute-test` and `agent-executions/stats` were anonymously exploitable on a public deployment | SA's call-out; the user's decision, not QA's |

---

### Final status

- [x] **Slice 0's acceptance criteria pass for everything testable without a session — ready for commit from QA's side.** No High or Medium bug is open **in this diff**.
- [x] Conditions carried forward: **QA-1 must be filed on the Q8 ticket by name** before the anonymous-execution class is described as closed; **QA-2** and **QA-3** to Slice B; the projection claim to be worded as in [Note on the projection](#note-on-the-projection).
- [ ] P1–P10 pending the user. P1 and P3 are the two worth doing before the PR merges; the rest can follow.

---

## Commit Info

_(RM)_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-21 | Created | Full inventory (40 routes with request-sourced identity across 387 `app/api` route files), classification into Gate 14 / Attribution 2 / Ambiguous 3 / Public 5 / Safe 18, guard + CI design, two-slice proposal, 8 open questions for SA. No code written. |
| 2026-09-21 | SA workplan review | Verdict **Revision Required**, with **Slice 0 approved to start now**. Three named criticals confirmed independently (fetch-plugin-data P0, execute-test P0 and worse, approvals/respond High with unverified RLS). Two live holes added that the sweep missed (agent-executions/stats — anonymous service-role cross-tenant read that supplies the UUIDs the plugin hole needs; check-user-status — dead enumeration oracle) plus an R4 cross-link for the unsigned-OAuth-state class. Row 15 analyze-workflow reclassified Attribution to Gate/High. Q1-Q8 ruled; slicing re-cut into three. Guard conditions G1-G5 and G7 blocking.
| 2026-09-21 | Slice 0 implemented | 3 routes deleted (fetch-plugin-data, api/oauth/token, check-user-status — each verified callerless against `git ls-files`), 5 gated (execute-test + agent-executions/stats behind `requireAdmin`; approvals POST **and** GET; generate-ir-intent-contract; analyze-workflow), dead-route guard extended, 6 auth suites / 28 tests added and mutation-proved. **Deviation D1:** `test/analyze-prompt` was GATED not deleted — it has a caller (`/test-plugins-v2` dispatches it dynamically), so SA's callerless premise was false. **D2:** per the user's Q6 override, 32 `console.*` converted to Pino across 4 files (+20 removed with deletions = 52 off F17), including 3 sites that were logging model output derived from user prompts. |
| 2026-09-21 | SA code review of Slice 0 | Verdict **Fix Required (RF1 only)**, code approved for QA once it lands. Verified independently: 7 suites/36 tests green, my own mutation control on two gates went red and both files restored byte-identical, gate ordering and deletion reachability re-checked. **RF1 = `app/api/test/generate-agent-v5-test-wrapper` — unauthenticated, body `userId` into `getAllActivePluginKeys(userId)`, caller-chosen provider/model; found by applying D1's lesson to the rest of the harness; missed by both Dev and SA because of a multi-line destructure, which becomes a Slice A guard fixture.** D1 confirmed and my Q3 delete ruling withdrawn; approvals GET 404 upheld with a QA edge case; CORS and the column allow-list accepted; RLS still owed.
| 2026-09-21 | SA code review of Slice 0 | Approved with one required fix (RF1). All five of Dev's open items ruled on: D1 upheld and SA's delete ruling withdrawn; `approvals` GET 404 stays; CORS wildcard accepted as flagged; the `agent_executions` column allow-list confirmed; the `workflow_approval_requests` RLS question still unmeasured and correctly not claimed. CR1 and CR3 recorded as follow-ups. |
| 2026-09-21 | RF1 + rebase | `test/generate-agent-v5-test-wrapper` gated (same hole, same harness) with 5 tests, mutation-proved 4/5; its header comment, which documented the defect as intent, corrected; all **nine** harness services then swept — only `generate/input-schema` remains and it is already sweep row 16. **Multi-line destructuring recorded as the first false-NEGATIVE guard shape**, a blocking Slice A requirement on rule I2 with this file as its fixture. Rebased 461a3fbc → **cddc1916** (PRs #83/#84/#85): no conflicts, **zero overlap** with Slice 0 files, nothing of ours dropped. **Fresh baselines measured on the new base** (jest 21/129 failed, tsc 2,035): branch matches both exactly, failing-suite set identical by `diff`; eslint 0 errors; `next build` exit 0. |
| 2026-09-21 | QA of Slice 0 | Verdict **PASS for the diff; no bug found in Slice 0**. Live cookie-less on :3007: all 8 gated handlers 401 with a victim id in BOTH the body and `x-user-id`, all 6 POST routes 401 on a malformed body (gate precedes the parse), all 3 deletions 404 on GET and POST. Regression proved against a **QA-built** `cddc1916` baseline (`git archive` outside every worktree, no stash): failing-suite SET identical by `diff` on sorted lists (both hash `6551bc65…`), delta = exactly the 7 new suites. Two independent mutation controls (stats 3/4 red, approvals POST 4/7 red with the 3 GET tests staying green) restored byte-exactly; worktree md5s and `git status` unchanged. **QA-1 (new, High, pre-existing, NOT this diff): `POST /api/sentinel/webhook/{agentId}` still executes a workflow anonymously with the owner's credentials — same capability as the deleted `fetch-plugin-data`, keyed on an agent id; file on the Q8 ticket by name.** QA-2 (Low): the approvals existence oracle moved from GET to POST. QA-3 (Low): `plugins/fetch-options` 400s before it authenticates. The `EXECUTION_COLUMNS` note corrected — it keeps `user_id` by design and drops the six model/cost columns. 10 items PENDING the user (every signed-in path, the DB write check, the plugin-connect proof, and the still-unmeasured `workflow_approval_requests` RLS — explicitly NOT claimed closed). |
