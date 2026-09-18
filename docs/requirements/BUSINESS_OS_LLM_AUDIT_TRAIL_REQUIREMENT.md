# Requirement: Business OS LLM — Layer 3: AI Activity Audit Trail

> **Last Updated**: 2026-09-18

**Created by:** BA
**Date:** 2026-09-18
**Status:** SA approved — changes applied, ready for Dev workplan. SA review 2026-09-18: RC-1 to RC-12 applied ([SA Review](#sa-review)). User decisions D-1 to D-6 recorded (D-5: fix the audit routes as step 0 of this layer; D-6: hide AI entries from owners). New SA questions OQ-11 to OQ-13 (how owners are kept from reading AI entries) are for the workplan review.

## Overview

This layer delivers the user's Business OS LLM standard **#3: "every LLM call is recorded in the audit trail"**. Layers 1, 1.1 and 1.5 made every Business OS LLM call land in the usage ledger (`token_usage`) under the right business, with an area, a call name and a **grouping id** for the user action or background job that caused it. Nothing Business OS does with AI appears in the compliance audit trail (`audit_trail`) today.

Layer 3 writes **one audit entry per AI action** — a chat question, one insight run for one business, one website generation, one image request, and so on — summarising that action's LLM calls: who, which area, which action, how many calls, how many tokens, the estimated cost, and whether it succeeded. The entry links to the per-call ledger rows through the grouping id, the same way the agents side links its per-run and per-step audit events to `token_usage` through `agent_id` / `execution_id` (investigation §G).

**It never records prompts, owner text or AI output.** It changes nothing about what anyone is charged, and it leaves the audit service exactly as it is (D-4): AI audit entries use the same queued write path as every other audit event, so **some may occasionally be delayed or lost** — a known, accepted risk of this layer ([KI-B](#known-issues-and-open-items)), with a recommendation to fix it later ([OI-D](#known-issues-and-open-items)).

**Two additions from the SA review and the user (D-5, D-6):**
- **Step 0 — secure the audit routes.** The audit trail's own API routes trust a user id sent by the browser and check no login, so anyone can read or forge any business's audit log. They are fixed first, inside this layer, before any AI entry is written.
- **AI entries are operator-only.** They do not appear on the owner's activity page (`/monitoring`), in its CSV export, or in any owner-scoped audit read, until the charging decision.

**Evidence and context:**
- [LLM_CREDIT_AND_AUDIT_TRACKING.md](/docs/investigations/LLM_CREDIT_AND_AUDIT_TRACKING.md) — §B (the audit trail), §G (the agents-side pattern), open question **Q4** (audit granularity — resolved by D-1).
- [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) — the grouping ids per area (FR-8, FR-10, grouping table).
- [BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_LAYER1_5_REQUIREMENT.md) — the onboarding and image areas and their grouping ids.
- `lib/services/AuditTrailService.ts`, `lib/audit/events.ts`, `lib/audit/types.ts`, the three audit routes and `app/(protected)/monitoring/page.tsx` — read for this requirement on 2026-09-18 (worktree at `main` 7646760a).

---

## Table of Contents

- [User Decisions](#user-decisions)
- [Findings from the Code](#findings-from-the-code)
- [User Stories](#user-stories)
- [Scope](#scope)
- [What One Audit Entry Is, Per Area](#what-one-audit-entry-is-per-area)
- [Functional Requirements](#functional-requirements)
- [Non-Functional Requirements](#non-functional-requirements)
- [Volume and Retention Estimate](#volume-and-retention-estimate)
- [Acceptance Criteria](#acceptance-criteria)
- [Out of Scope / Future Roadmap](#out-of-scope--future-roadmap)
- [Known Issues and Open Items](#known-issues-and-open-items)
- [Open Questions](#open-questions)
- [Notes on Integration Points](#notes-on-integration-points)
- [SA Review](#sa-review)
- [Change History](#change-history)

---

## User Decisions

D-1 to D-4 were put to the user as BD-1 to BD-4 with BA recommendations. D-5 and D-6 answer the SA review's OI-E and UD-1. **All answered 2026-09-18**, relayed through the coordinator.

| # | Decision | What the user decided |
|---|---|---|
| **D-1** | **Granularity** (was BD-1; **resolves investigation Q4**) | **Agreed: one audit entry per user action or background job**, linked to its calls through the grouping id. Not one per LLM call — the per-call record stays the usage ledger. Matches the agents side (per run, per step) |
| **D-2** | **What is recorded** (was BD-2) | **Agreed, including the AI call names and model names.** Each entry records who, area, action type, grouping id, number of LLM calls and how many failed, tokens, estimated cost, success or failure, the call names and the model names. **The never-recorded list stays as written** ([FR-5](#functional-requirements)): no prompts, no owner text, no AI output, no error message text, no business name, no request metadata |
| **D-3** | **Background jobs** (was BD-3) | **Agreed: one entry per business per insight run and per briefing narration, at info severity, marked as scheduled, with the platform as the actor** |
| **D-4** | **Reliability** (was BD-4) | **Not changed now.** The user wants the audit service **kept exactly as it is**. AI audit entries use the existing queued `AuditTrailService.log()` path like everything else, with the non-blocking `.catch`. The current behaviour is documented as a **known risk** of this layer ([KI-B](#known-issues-and-open-items)): some AI audit entries may occasionally be lost. A **recommendation to change it later** is recorded as open item [OI-D](#known-issues-and-open-items); the service-wide fix stays separate ([OI-A](#known-issues-and-open-items)) |
| **D-5** | **Audit route security** (SA RC-1 / OI-E; **option 1A**) | **Fix the audit routes as step 0 of this layer**, not as a separate task. `app/api/audit/query/route.ts`, `app/api/audit/log/route.ts` and `app/api/audit-trail/route.ts` take the user from the logged-in session, reject unauthenticated calls, read and write only the caller's own entries, and validate their input. **This lands before any AI entry is written** ([FR-21 to FR-26](#0-step-0--secure-the-audit-routes-d-5)) |
| **D-6** | **Owner visibility** (SA RC-2 / UD-1; **option 2A**) | **Hide AI entries from owners for now.** AI audit entries do not appear on the owner-facing `/monitoring` page, in its CSV export, or in any owner-scoped audit read. They are operator-visible only until the charging decision — matching the earlier decision to keep AI cost operator-only (Layer 1.5 KI-A) ([FR-27, FR-28](#e-owner-visibility-d-6)) |

---

## Findings from the Code

Read on 2026-09-18 against `main` 7646760a. F-1 to F-3 are why D-4 carries a known risk. The SA review added S-1 to S-5 ([SA Review](#new-findings)); F-9 to F-11 were found while applying D-5 and D-6.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **F-1** | **Entries wait in memory, then are written in a batch every 5 seconds or at 100 entries.** `log()` returns as soon as the entry is queued, not when it is written | `AuditTrailService.ts:86-102` (queue + `ensureFlushTimer`), `:44` (`batchIntervalMs: 5000`), `:43` (`batchSize: 100`) | Callers' `.catch` (the CLAUDE.md pattern) never sees a **write** failure — only a failure to *queue*. Write failures surface only as an error log |
| **F-2** | **A failed write loses its whole batch.** The queue is emptied *before* the insert; on error the entries are not put back | `AuditTrailService.ts:224-237` (and the comment at `:241-248` says so explicitly) | Any database hiccup loses up to 100 entries, from every product, at once. One bad row is enough (S-3) |
| **F-3** | **Nothing forces the queue to be written before the process stops.** The flush timer is `unref`'d; the only safety net is Node's `beforeExit`, which does not fire when a serverless function is frozen after its response. The framework is **Next.js 14.2.35**, which has no `after()` API, and `@vercel/functions` (`waitUntil`) is **not installed**. The business purge, which writes a *critical* event, does not await a flush either | `AuditTrailService.ts:260-282`, `:525-529`; `node_modules/next/package.json` (14.2.35); `package.json` (no `@vercel/functions`); `lib/business-os/purge/ResetService.ts:100-119`, `:231-253` | **Confirmed repository-wide by SA (OQ-8):** nothing outside the service flushes, and `auditFlush` has no caller. A frozen instance's timer fires when it thaws, so most at-risk entries are **delayed** until that instance's next request; they are **lost** only if the instance is recycled first |
| **F-4** | **Passing the HTTP request to the audit service stores an auth credential.** When `request` is given, the entry's `session_id` column is filled from the `sb-access-token` / `sb-refresh-token` cookie value, or the first 32 characters of the `Authorization` header | `AuditTrailService.ts:112`, `:182-190` | (1) The audit `session_id` column **cannot** carry our grouping id when `request` is passed; (2) AI audit entries must **not** pass `request`. The credential-in-audit-log issue is pre-existing and wider — [OI-B](#known-issues-and-open-items) |
| **F-5** | **An unregistered event is still saved, but as "Unknown event" at "info" severity** | `lib/audit/events.ts:836-841` (`getEventMetadata`); the comment at `:811-813` records that refunds were logged this way until fixed | Every new AI event must be registered with its own metadata |
| **F-6** | **The entity-type list is a closed union** with no value for an AI action | `lib/audit/types.ts:17-51` | New entity type `ai_action` (OQ-3) |
| **F-7** | **An entry with no user falls back to the platform account** and is flagged `system_action` | `AuditTrailService.ts:119-143` | Background entries must pass the **business** as the user explicitly — the same trap Layer 1 fixed for the ledger |
| **F-8** | **Retention is defined but nothing runs it.** `applyRetentionPolicy()` deletes non-critical entries older than 365 days, but none of the scheduled jobs in `vercel.json` calls it (confirmed by SA, OQ-10). Its `criticalEventsDays` setting is never used, so critical entries would never be deleted at all | `AuditTrailService.ts:468-485`; `vercel.json` crons | Audit entries are kept indefinitely today — [OI-C](#known-issues-and-open-items) |
| **F-9** | **The audit-trail read route also trusts the caller.** Besides the three handlers in SA's S-1, `GET /api/audit-trail` reads the user id from the **query string** (`?userId=`) and returns that user's entries, with no login check. It also returns internal error text to the client (`message: error.message`) | `app/api/audit-trail/route.ts:68-110` (userId `:71`; error text `:59-62`, `:106-110`) | Four handlers, not three, are in step 0 (FR-22) |
| **F-10** | **The owner read path goes through the service-role audit service, which has no way to exclude a type.** `/api/audit/query` calls `AuditTrail.query()`, which filters by `user_id`, action, entity type, severity and dates, and returns every column (`select('*')`), but cannot exclude an entity type | `AuditTrailService.ts:297-378`; `app/api/audit/query/route.ts:29-38` | Hiding AI entries (D-6) needs a read-side change: either a new repository read or an addition to the service D-4 keeps unchanged (OQ-12) |
| **F-11** | **The owner page builds its CSV export from the same data.** `/monitoring` loads up to 1,000 entries from `/api/audit/query` (sending an `x-user-id` header), then filters, charts and exports them in the browser | `app/(protected)/monitoring/page.tsx:53-62`, `:420-435` | Filtering the owner read path in the database query covers the page, its counts and its CSV export in one place (FR-27) |

---

## User Stories

- As a **platform operator**, I want every AI action a business triggers — or that runs for it in the background — to appear in the audit trail, so that AI activity is traceable in the same place as every other important action.
- As a **platform operator**, I want each AI audit entry to say how many AI calls it made, how many tokens and roughly what it cost, and whether it succeeded, so that I can answer "what did this cost and did it work?" without querying the usage ledger.
- As a **platform operator**, I want each entry to carry the grouping id, so that I can go from the audit entry to the exact AI calls behind it — and, if an entry is ever missing, still find the calls in the usage ledger.
- As a **business owner**, I want nobody else to be able to read my activity log or add fake entries to it.
- As a **business owner**, I want my activity page to keep working exactly as before.
- As a **platform operator**, I want AI activity and its cost to us to stay operator-only until we decide how AI is charged.
- As a **compliance reviewer**, I want AI audit entries never to contain prompts, the owner's words or the AI's output, so that the audit trail does not become a second copy of business content.
- As a **business owner**, I want nothing I do to fail or slow down because an audit entry could not be written.

---

## Scope

### In scope

- **(0) Step 0 — secure the audit routes** (D-5): session identity, own entries only, input validation, callers kept working (FR-21 to FR-26). **Delivered first.**
- **(a) The entry** — its name, registration, fields and privacy rules (FR-1 to FR-8).
- **(b) Coverage** — one entry per AI action in every Business OS area with LLM calls: chat, insights, briefing, website, intake, leads, onboarding, images (FR-9 to FR-15).
- **(c) Write path and failure behaviour** — the existing queued path, non-blocking, never awaited (FR-16 to FR-19).
- **(d) Documentation** (FR-20).
- **(e) Owner visibility** (D-6): AI entries excluded from every owner-scoped read (FR-27, FR-28).

### Out of scope

| Item | Why |
|---|---|
| One audit entry per individual LLM call | D-1 (per action). The per-call record is the usage ledger |
| **Any change to the audit service's write path** — awaited or immediate writes, flushing before the response, retrying failed batches — for AI entries or anything else | **D-4: kept exactly as it is.** The resulting risk is KI-B; the recommended AI-entry change is OI-D; the service-wide fix is OI-A |
| Removing the auth credential that the audit service stores in `session_id` when a request is passed | Pre-existing, wider security item — OI-B. This layer only avoids it for AI entries; the two write routes fixed in step 0 still pass the request and are not changed in that respect |
| Scheduling the 365-day retention job | OI-C |
| Registering the three unregistered **agents-side** events (`AGENT_EXECUTED`, `PILOT_STEP_EXECUTED`, `TOKEN_DISCREPANCY_DETECTED`) | **SA decision (OQ-6): later, as a separate item** owned by the agents product — registering them changes its stored severities |
| Showing audit entries in the Layer 1.1 **LLM Usage** tab | **SA confirmed (OQ-9).** QA proves this layer by direct query (AC-19). A later "is every group audited?" check is F-A |
| Showing AI entries to owners, in any form | **D-6** — operator-only until the charging decision |
| An admin UI for browsing AI audit entries | Later layer |
| Excluded or broken AI calls (chat v2/v1, story, WebsiteAnalyzer, service generator) | They make no working LLM calls in the catalog |
| Audit entries for AI actions that made **no** LLM call (a chat answer served from the plan cache, an image served from the reuse cache, a refused image request, a briefing served from cache) | Nothing for standard #3 to track (FR-7) |
| Charging, deduction, model configuration | Other layers (OQ-7 of Layer 1.5 stays parked; Layer 2) |
| Any change to what the usage ledger records | Layers 1–1.5 own it |

---

## What One Audit Entry Is, Per Area

An **AI action** is one invocation of the function that performs it. One entry is written per AI action that made **at least one** LLM call.

**Emission rule (SA RC-7):** *the function whose single invocation is one AI action opens that action's accumulator scope, and emits the entry when the action ends — on both the success and the failure path.* The action can be narrower than its group: the onboarding group spans many turns, and the briefing group spans same-day re-narrations. A nested action that mints **its own** group opens a nested scope and emits its own entry.

| Area | One AI action is… | Grouping id (Layer 1 / 1.5) | Actor | Trigger | Emits at (SA-verified) |
|---|---|---|---|---|---|
| chat | One chat turn (question → answer), including repair attempts and embeddings | the turn id (may be the client's correlation id — FR-4) | the owner | user | `app/api/business-os/chat-v4/route.ts` `POST`, around the turn (turn id `:335`) |
| chat's website operation | One website operation requested from chat — a **nested** action with its own group | the operation's UUID | the owner | user | `lib/business-os/bizql/mutate/MutateExecutor.ts:811`, nested scope, area `website` |
| insights | One scheduled insight run **for one business** (insight content, correlated insights and the health summary together) | the cron `runId` (shared across businesses; the key is account + grouping id) | the platform | scheduled | `app/api/cron/insight-detect/route.ts`, per-business loop body (`:205-283`), in both the `try` and the `catch`; `runId` `:142` |
| briefing | One narration of one business's daily briefing (a same-day re-narration after the facts change is a second action in the same group) | UUID v5 of (account, briefing date) | the platform, or the owner when requested from the My Day screen | scheduled, or user — passed in by the caller (FR-11) | `lib/business-os/briefing/BriefingStore.ts` `getBriefing`, around `narrateBriefing` (`:51`); callers `DailyBriefingDispatchService.ts:222` (scheduled), `my-day/route.ts:119` (user) |
| website | One owner request: full site, landing page, field regeneration, testimonial enhancement | the request's UUID | the owner | user | `generate-from-profile` `:76`, `landing-pages/generate` `:91`, `blocks/[blockId]/regenerate` `:68`, `enhance-testimonial` `:34` |
| website (dormant) | Block content through `WebsiteSectionService` (always fails before any call, Layer 1 KI-1) or `WebsiteBlockEnrichmentService` (no production trigger, Layer 1 KI-3) | as Layer 1 | the owner | user | same helper, `:521`, `:271` — **unit tests only** |
| intake | One form generation, or one question inference | the request's UUID | the owner | user | `intake/form/generate` `:49`, `intake/form/infer-question` `:67` |
| onboarding build | One build: intake and website generation under **one** grouping id — one owner action, spanning two areas, **one entry** | the build's UUID | the owner | user | `app/api/onboarding/build/route.ts:825`, one scope spanning both |
| leads | One incoming enquiry's reply recommendation | a UUID per enquiry | the platform (the trigger is an outside visitor, not the owner) | external | `lib/services/LeadAlertService.ts:336`, around `recommendLeadReply`. Runs **detached** from the contact-form response (`forms/contact/route.ts:247`), so it is the most KI-B-exposed area |
| onboarding | One owner turn in the onboarding conversation that made at least one LLM call (all turns of a conversation share the conversation's grouping id) | the conversation's `attributionGroupId` | the owner | user | `app/api/onboarding/chat/route.ts:216-221`, around `processUserMessage`, per turn |
| images | One image generation request that reached the provider (success, failure, or a billed empty response) | the route's UUID | the owner | user | `app/api/website/media/generate/route.ts:48` |

---

## Functional Requirements

### (0) Step 0 — secure the audit routes (D-5)

*SA's S-1 and OI-E; the user moved the fix into this layer (D-5). FR numbers continue from the earlier draft so that existing references stay valid.*

21. **FR-21 — Step 0 comes first.** The audit-route fix (FR-22 to FR-26) is the first delivery step of this layer. It must be **merged and deployed before any code that writes an AI audit entry is merged**, and it gates the release of everything else in this layer (SA RC-1).
22. **FR-22 — Identity from the session only.** Each of the **four** handlers — `GET /api/audit/query`, `POST /api/audit/log`, `POST /api/audit-trail` and `GET /api/audit-trail` (F-9) — takes the user from the authenticated session (`getUser()`).
    - A user id sent by the client is **never** used: not the `x-user-id` header (`audit/query/route.ts:11`, `audit/log/route.ts:13`), not a body `userId` (`audit-trail/route.ts:20`), not a query-string `userId` (`audit-trail/route.ts:71`).
    - An unauthenticated call returns **401** with the standard error shape.
    - The anonymous write path in `/api/audit/log` (`:15-18`, which stores `userId: null`, commented "for certain events like failed logins") is removed: an unauthenticated write is a 401. If the caller survey (FR-25) finds a caller that depends on anonymous writes, SA decides how it is handled in the workplan. *BA suggestion:* such an event should be written server-side, where it happens, not through a public route.
23. **FR-23 — Own entries only.** Reads return only entries whose `user_id` is the session user. Writes are always recorded with `userId` = the session user. No handler reads or writes another account's entries.
    - An admin-wide read or write is added **only** if the caller survey shows one is needed, and then only behind `AdminAccessService` (`admin_users`) — **never `profiles.role`**. *BA expectation:* none is needed; operators use direct queries.
24. **FR-24 — Validated input (Zod), before any logic.**
    - **Reads:** `limit` is an integer from 1 to 1,000 (the `/monitoring` page asks for 1,000); `page` is an integer ≥ 1; `action`, `entityType` and `severity` must be registered values. Invalid input returns **400**.
    - **Writes:** `action` must be a registered event (`AUDIT_EVENTS`); `entityType` must be a known entity type; `entityId`, `resourceName` and `details` are bounded in size and type. Invalid input returns **400**.
    - **A client can never write an AI entry:** entity type `ai_action` and the `BUSINESS_AI_ACTION_*` events are rejected with 400. Otherwise an owner could forge "AI activity" indistinguishable from real entries (S-1).
    - Client-supplied `severity` and `complianceFlags` are not trusted; severity and flags come from `EVENT_METADATA`, as for AI entries (RC-5). *BA proposal — SA may narrow it in the workplan if a caller needs otherwise.*
25. **FR-25 — Every caller keeps working.** The workplan lists every caller of the four handlers from a repository-wide search (BA had no search tool; SA to confirm the list).
    - **Known caller:** the owner `/monitoring` page (`app/(protected)/monitoring/page.tsx:53-57`), linked from the protected layout (`app/(protected)/layout.tsx:612`). It calls `GET /api/audit/query?limit=1000&offset=0` with an `x-user-id` header and reads `data.logs`. After the fix the header is ignored, the owner is identified from the session cookie (the page's same-origin `fetch` sends it), and the response shape (`logs`, `total`, `page`, `limit`, `hasMore`) is unchanged, so the page, its charts and its CSV export keep working. Removing the now-useless header from the page is optional.
    - **No other caller is known to BA.** Candidates the survey must check: any client code posting to `/api/audit/log` or `/api/audit-trail`, and any script or page reading `GET /api/audit-trail`.
    - A handler with **no caller** may be **removed** instead of fixed (SA RC-1 allowed "authenticated, admin-only or removed"). The workplan records which handlers were fixed and which removed.
26. **FR-26 — Errors and logging on these routes.**
    - No internal error text reaches the client in production (today both `/api/audit-trail` handlers return `error.message`); use the CLAUDE.md `NODE_ENV === 'development'` guard.
    - Pino with a correlation id replaces the six `console.*` calls in the three files (1 in `audit/query`, 1 in `audit/log`, 4 in `audit-trail`), as CLAUDE.md requires for touched files.
    - Nothing from `details`, the request body or the headers is logged.

### (a) The entry

1. **FR-1 — One entry per AI action (D-1).** Every AI action defined in [the table above](#what-one-audit-entry-is-per-area) **queues exactly one** audit entry when it finishes, covering every LLM call it made. No per-call audit entries are written. *(Whether a queued entry reaches the database is subject to KI-B.)*
2. **FR-2 — Registered events (OQ-2, OQ-3, RC-5).**
   - Two events are added to `AUDIT_EVENTS` in `lib/audit/events.ts`: **`BUSINESS_AI_ACTION_COMPLETED`** (severity **info**) and **`BUSINESS_AI_ACTION_FAILED`** (severity **warning**). Each has an `EVENT_METADATA` entry with `complianceFlags: ['SOC2']` and a description, so neither is ever saved as "Unknown event" (F-5). The prefix follows the existing Business OS events (`BUSINESS_DATA_PURGED`).
   - A new entity type **`ai_action`** is added to `lib/audit/types.ts` (F-6). The `entity_id` is the **grouping id**. The entity is the group, and entries are occurrences of it: an insight `runId` is unique only together with the account, and onboarding turns and briefing re-narrations produce several entries per entity — both by design.
   - **Severity and compliance flags come only from `EVENT_METADATA`.** The emitter never passes `severity` or `complianceFlags` (`log()` uses `input.severity || metadata.severity`).
3. **FR-3 — Who (D-3), with the poison-pill guard (RC-3, S-3).**
   - `userId` is **always the business account** the action ran for — passed explicitly, never left to the platform-account fallback (F-7). It comes from the same server-side source Layer 1 uses for the ledger.
   - `actorId` is the **owner** for user-triggered actions and the **platform account** for scheduled and external triggers.
   - The trigger is recorded as `user`, `scheduled` or `external`.
   - **Before calling `log()`**, the emitter checks that `userId` is a UUID and is **not** a platform account (the catalog's `isUuid` / `isPlatformAccount`), and that `actorId` is a UUID. For background jobs the platform id is used as `actorId` only when it is a UUID, otherwise the all-zero id: `platformAccountId()` returns a non-UUID environment value verbatim, so it cannot be used as is.
   - **If a check fails, no entry is written**, and an error-level log names the area, action type, grouping id and account. *Why:* `audit_trail.user_id` references `auth.users` and both id columns are UUIDs, so one bad row fails its whole batch — and, because the queue is cleared first (F-2), loses up to 99 other entries from every product.
4. **FR-4 — What is recorded (D-2).** Each entry records, and only records:
   - the **area** (or, for the onboarding build, every area the action touched);
   - the **action type** — a stable label for what the owner or job did (e.g. chat turn, insight run, full-site generation). The label list is fixed in the workplan;
   - the **grouping id**, as the entry's entity id and in its details. *Chat (RC-10, S-5):* the turn id may be the client's `x-correlation-id` when it is a valid UUID (`chat-v4/route.ts:335`). It is used **only** to link the entry to its ledger rows — never to read anything back, and never trusted for anything else;
   - the **number of LLM calls** and the **number that failed**;
   - **input, output and total tokens**;
   - the **total estimated cost** in USD, as recorded in the ledger (for images, the per-image cost; Layer 1.5 D-7);
   - the **catalog call names** involved (distinct) and the **model names** used;
   - the **outcome** — succeeded or failed (FR-6), and on failure the **error code** only;
   - the **trigger** (FR-3), and the request's correlation id where the action has one.
5. **FR-5 — Privacy: never content (D-2).** An AI audit entry must never contain:
   - a prompt, a system prompt, or any part of one;
   - anything the owner typed, or any business data sent to the model;
   - anything the model returned;
   - an error message text (an error may quote a prompt) — only the tracked call's `error.code` (FR-6);
   - the business name or any other owner-entered text: `resourceName` is left unset;
   - request metadata: **the HTTP request is never passed to the audit service** for these entries, so no IP address, user agent or session cookie is stored (F-4).

   This matches the Layer 1.1 rule (no prompts, payloads or metadata in the ledger report) and the logging clean-up (PR #50, OI-7 / OI-8).
6. **FR-6 — Outcome (RC-6).** The action is **failed** if:
   - the emitter signals it — e.g. the briefing returned `source: 'fallback'`, website generation returned fallback content, an image came back with no data or could not be stored; or
   - the action threw; or
   - for any call name, the **last** attempt failed.

   Otherwise it **succeeded**. A chat planner that failed once and was repaired therefore stays succeeded, with a failed-call count of 1. The only failure detail recorded is the tracked call's `error.code`. An action that failed **before** making any LLM call writes no entry (FR-7). *Limitation:* a model response the service could not parse and silently replaced with defaults is recorded as succeeded ([KI-C](#known-issues-and-open-items)).
7. **FR-7 — No LLM call, no entry.** An action that made no LLM call writes no AI audit entry: a chat answer served entirely from the plan cache, an image served from the reuse cache, a request refused by the daily image cap, a briefing served from its cache. (The chat cache-hit ledger row is not an LLM call — Layer 1 FR-15.)
8. **FR-8 — The totals come from an in-process accumulator and match the ledger (OQ-4).**
   - The emitting function (FR-9 to FR-15) opens an **`AsyncLocalStorage` scope** for the action. `BaseAIProvider.callWithTracking` (`lib/ai/providers/baseProvider.ts`), which every Business OS LLM call already goes through, notifies the innermost open scope from its success and failure branches with the area, call name, model, tokens, `cost_usd`, success and error code. The entry's totals are the scope's sums.
   - No call-site changes, no database read, no added latency. Totals are exact per action, including repairs and failures.
   - **Read-back from the ledger by grouping id is not used:** it would re-sum earlier turns for onboarding, double-count same-day re-narrations for briefing, and trust a client-supplied id for chat (S-5).
   - **Conditions (a new pattern, approved by SA under CLAUDE.md rule 7):**
     - it is a generic module (proposed `lib/ai/usageScope.ts`) with no Business OS concepts, so the provider layer stays product-agnostic;
     - only the innermost scope is notified;
     - the notification can never throw into the call;
     - a call whose `sessionId` differs from the scope's group is left out of the entry and logged at warn (this catches wiring bugs);
     - Node runtime only (no touched route declares Edge; the two crons declare `nodejs`).
   - For every entry, the call count, token totals and estimated cost therefore equal the sum of that action's `token_usage` rows. The only permitted differences are a ledger row written fire-and-forget after the action finished (the plan-cache store embedding, KI-A) and a ledger insert that failed (the tracker swallows it).

### (b) Coverage, per area

*Emission points are in [the per-area table](#what-one-audit-entry-is-per-area) (SA-verified, RC-7).*

9. **FR-9 — Chat.** One entry per chat turn that made at least one LLM call, grouped by the turn id, actor the owner, emitted by the chat route. Repairs and embeddings are counted in the same entry. A **website operation requested from chat** opens a nested scope in `MutateExecutor` and writes its own entry (area `website`, its own group, trigger `user`); its calls are not counted in the chat turn's entry.
10. **FR-10 — Insights (D-3).** One entry **per business per insight run**, covering that business's insight content, correlated insight and health summary calls, grouped by the run's `runId`, actor the platform, trigger `scheduled`, severity info. It is emitted from the cron's per-business loop, on both the success and the failure path. A business for which the run made no LLM call writes no entry.
11. **FR-11 — Briefing (D-3, RC-8).** One entry per briefing narration that made an LLM call, grouped by the briefing's UUID v5, severity info, emitted in `BriefingStore.getBriefing` around the narration. A cached briefing writes none.
    - `getBriefing` takes a **required trigger argument**, so the scheduled path and the My Day path cannot be confused: `DailyBriefingDispatchService` passes `scheduled` (actor the platform), `my-day/route.ts` passes `user` (actor the owner).
12. **FR-12 — Website, intake and the onboarding build (OQ-5).**
    - One entry per owner request at each entry point: full-site generation, landing-page generation, field regeneration, testimonial enhancement, intake form generation, question inference.
    - The onboarding build writes **one** entry, listing both areas, from one scope spanning intake and website generation.
    - The dormant `WebsiteSectionService` and `WebsiteBlockEnrichmentService` points use the same helper and are covered by unit tests only (Layer 1 KI-1, KI-3).
13. **FR-13 — Leads.** One entry per incoming enquiry whose reply recommendation made an LLM call, grouped by the enquiry's UUID, actor the platform, trigger `external`, emitted in `LeadAlertService` around `recommendLeadReply`. The **visitor's** details are never recorded.
14. **FR-14 — Onboarding (OQ-5).** One entry per onboarding **turn** that made at least one LLM call, all sharing the conversation's grouping id, actor the owner, emitted by the onboarding chat route. *Confirmed by SA:* a per-conversation entry would miss abandoned conversations, and with the accumulator the per-turn totals are exact.
15. **FR-15 — Images.** One entry per image generation request that reached the provider — succeeded, failed at the provider, or billed with no image data — grouped by the route's UUID, with zero tokens and the per-image estimated cost (Layer 1.5 FR-9, FR-13).

### (c) Write path and failure behaviour

16. **FR-16 — An audit failure never breaks or slows the action (RC-4, S-4).**
    - Writing the AI audit entry must never fail, change or delay the owner's action or the background job.
    - **`log()` is never awaited.** The call is written as `void auditTrail.log(entry).catch(…)`. *Why:* `log()` awaits a database insert when its entry is the 100th in the queue (`AuditTrailService.ts:96-98`), so an awaited call can make the owner wait on a 100-row insert on exactly the busiest instances. (89 of the repo's ~140 `log()` call sites await it, and CLAUDE.md's own example does; AI entries must not copy that.)
    - A failure to queue, and a failed FR-3 check, are logged at **error** level with the area, action type, grouping id and account — never with content.
17. **FR-17 — The existing queued write path, unchanged (D-4).**
    - AI audit entries are written **only** through the existing `AuditTrailService.log()`, exactly like every other audit event: queued in memory and flushed in batches by the service (F-1).
    - No AI-specific awaited write, forced flush, retry or time limit is added, and **`AuditTrailService` is not modified**.
    - The consequence — an entry can be delayed, or lost if its batch fails to insert or the serverless instance is recycled before the batch is flushed (F-2, F-3) — is accepted for this layer as [KI-B](#known-issues-and-open-items). A lost entry is recoverable in substance: its calls are still in the usage ledger under the same account and grouping id.
18. **FR-18 — Severity from the event name (RC-5).** A succeeded AI action uses `BUSINESS_AI_ACTION_COMPLETED` (info); a failed one uses `BUSINESS_AI_ACTION_FAILED` (warning). The severity follows from the event's metadata, not from an argument. Background entries follow the same rule (D-3: info when they succeed). No AI entry is **critical** (critical entries are meant to be kept seven years, `AuditTrailService.ts:48`).
19. **FR-19 — No change to the per-call ledger.** Layer 3 reads what Layers 1–1.5 write; it does not change what `token_usage` records, when, or under which labels.

### (d) Documentation

20. **FR-20 — Docs.** The investigation doc resolves Q4 and records this layer and its decisions (D-1 to D-6); the Layer 1 requirement's roadmap lists Layer 3; the audit events are described where the audit trail is documented, including the KI-B risk and the owner-visibility rule (D-6). Each carries a Change History row.

### (e) Owner visibility (D-6)

27. **FR-27 — AI entries are hidden from owners.** Until the charging decision, AI audit entries (entity type `ai_action`; events `BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`) are **operator-only**.
    - Every owner-scoped read of the audit trail excludes them **in the database query**, not in the browser. This covers `GET /api/audit/query`, and `GET /api/audit-trail` if it is kept (FR-25), so the `/monitoring` page, its counts and charts, and its CSV export never contain one (F-11).
    - An owner filter that asks for them (`entityType=ai_action`, or an `action` of `BUSINESS_AI_ACTION_*`) returns nothing, and the returned `total` excludes them.
    - The same exclusion applies to any other owner-scoped audit read the caller survey finds (the GDPR export is OQ-13).
    - Where the exclusion lives is SA's call (OQ-12); `AuditTrailService.query()` cannot exclude a type today (F-10).
    - Operators keep reading AI entries through service-role queries.
28. **FR-28 — Direct database reads by the owner.** Owners can read their own `audit_trail` rows directly with their own login, through the RLS policy "Users can view their own audit logs" (S-2). An API filter alone therefore does not make AI entries unreadable to an owner who queries the database directly. How this is closed is **SA's call (OQ-11)**. If SA decides not to change the policy, the remaining exposure is recorded as known issue [KI-D](#known-issues-and-open-items) and reported to the user in business terms before release.

---

## Non-Functional Requirements

- **Security (step 0):** the audit routes trust only the session; no user id from a header, body or query string; 401 without a session; own entries only; admin access, if ever needed, only through `AdminAccessService`, never `profiles.role` (FR-22, FR-23).
- **Privacy:** FR-5 is absolute. Every field in the entry is an identifier, a count, a platform label or a number. Code review checks the entry builder against the FR-5 list; a unit test asserts that a prompt, owner text and a model response passed through a mocked action appear nowhere in the entry.
- **Owner visibility:** AI entries appear in no owner-scoped read (FR-27, FR-28).
- **Non-blocking:** an audit failure never fails the action, and writing the entry adds **no wait** to the action — it is queued, never awaited (FR-16, FR-17).
- **Reliability (accepted limit):** entries are **best-effort**, as for every other audit event today. Occasional delay or loss is the documented known risk KI-B (D-4); the recommended future change is OI-D.
- **Volume:** at most one entry per AI action (FR-1); background jobs add at most two entries per business per day plus re-narrations (FR-10, FR-11). See [Volume and Retention Estimate](#volume-and-retention-estimate).
- **Performance:** gathering the totals adds no LLM call, no database read and no measurable latency (FR-8).
- **Repository pattern:** any new database read — including the owner read path, if SA chooses a repository method (OQ-12) — goes through `lib/repositories/` with the account filter; the audit write goes through `AuditTrailService`.
- **Logging:** Pino only, with the correlation id on request paths; no content in any log line (FR-5). The three audit routes are converted from `console.*` (FR-26); other touched files that still log through `console.*` are flagged per CLAUDE.md.
- **Type safety and CI:** new files that import the catalog fall under `npm run typecheck:bos-llm`; no new diagnostic.
- **Testability:** the entry builder, the accumulator, the outcome rule, the no-call rule, the FR-3 guard, the privacy rule and the step 0 routes are testable without a live provider.
- **Tenancy:** every account comes from the same server-side sources Layer 1 uses. The only client-influenced value is the chat grouping id (FR-4), used for linking only.

---

## Volume and Retention Estimate

**Baseline:** the Layer 1.5 QA window recorded about **638 `token_usage` rows in 7 days** (figure supplied by the coordinator from the Layer 1.5 QA run; test and early-use traffic, not production).

| Source | Entries | Basis |
|---|---|---|
| Owner-triggered actions | **fewer than ledger rows** — about a third to a half of them | A chat turn writes 2–4 ledger rows (planner, analysis, embeddings) but one entry; a website generation or image request writes one row and one entry |
| Insight run | **at most 1 per business per day** — only for a business with detections that day | `vercel.json`: `insight-detect` runs daily at 03:30. The LLM is called only when `detections.length > 0` (`insight-detect/route.ts:215`) |
| Daily briefing | **at most 1 per business per day**, plus same-day re-narrations — only for narrations not served from cache | `vercel.json`: `daily-briefing` runs hourly and narrates per business-local day; a cached briefing makes no call (`BriefingStore.ts:43-51`) |

**Worked estimate — upper bounds (RC-12):**
- at today's baseline, owner-triggered entries are **at most ~640 a week**, i.e. under ~35,000 a year even if every ledger row were its own action;
- background entries are **at most** about 2 × businesses × 365 a year: **up to ~73,000 a year for 100 businesses**, **up to ~730,000 a year for 1,000 businesses**. The real figure is lower: insight entries exist only for businesses with detections, and briefing entries only for narrations that were not cached.

These are upper bounds on what is *queued*; KI-B means slightly fewer may be stored.

**Retention:** AI entries are info or warning, so the default **365 days** applies (`AuditTrailService.ts:47`); none is critical. **However, nothing schedules the retention job** (F-8, OI-C, confirmed by SA), so today they would accumulate indefinitely — at most about 0.73M rows a year at 1,000 businesses.

*Recommendation:* the workplan measures the real row count after the QA run and restates this table with measured numbers.

---

## Acceptance Criteria

**(0) Step 0 — the audit routes (integration tests, plus one live check):**

- [ ] **AC-21** (FR-22) — **Unauthenticated → 401.** Each of the four handlers (or each one kept, FR-25) returns 401 with no session — including when an `x-user-id` header, a body `userId` or a query-string `userId` is supplied — and reads or writes nothing.
- [ ] **AC-22** (FR-22, FR-23) — **Cross-account denial.** Signed in as owner A, a read that names owner B (in the header, body or query string) returns only A's entries, never B's; a write that names B is recorded under A, never under B.
- [ ] **AC-23** (FR-22 to FR-24) — **Happy path and validation.** Signed in, an owner reads their own entries with the unchanged response shape, and a valid write is recorded under them. Invalid input returns 400 (e.g. `limit` 0 or 5,000, an unknown `action` or `entityType`). A write with entity type `ai_action` or a `BUSINESS_AI_ACTION_*` event returns 400 and writes nothing. A client-supplied severity does not change the stored severity.
- [ ] **AC-24** (FR-25, FR-26) — **Callers keep working.** The workplan lists every caller of the four handlers and which handlers were fixed or removed. Live, a signed-in owner opens `/monitoring`: the page loads their entries, the charts render, and the CSV export downloads. Code review: no `console.*` left in the three route files, and no internal error text returned outside development.
- [ ] **AC-25** (FR-21) — **Order.** The step 0 change is merged and deployed before the change that writes AI entries is merged; the workplan records both commits. No `BUSINESS_AI_ACTION_*` row exists in any environment that does not yet have step 0.

**(a) The entry (unit tests, provider and audit service mocked):**

- [ ] **AC-1** (FR-1, FR-8) — A mocked chat turn that makes three LLM calls calls `AuditTrailService.log()` **exactly once**, with a call count, token totals and estimated cost equal to the three calls recorded by the accumulator (and so to the three ledger rows for that account and turn id). A call made inside the scope with a different `sessionId` is left out of the totals and logged at warn. A notification that throws inside the accumulator does not fail the call.
- [ ] **AC-2** (FR-2) — `BUSINESS_AI_ACTION_COMPLETED` and `BUSINESS_AI_ACTION_FAILED` are in `AUDIT_EVENTS` with `EVENT_METADATA` entries (info and warning, `SOC2`); `getEventMetadata` never returns "Unknown event" for them. Entity type `ai_action` type-checks, and the entry's `entity_id` is the grouping id.
- [ ] **AC-3** (FR-3) — A user-triggered entry has `userId` = the business account and `actorId` = the owner; a scheduled entry has `userId` = the business account, `actorId` = the platform account (or the all-zero id when the platform id is not a UUID) and trigger `scheduled`; no AI entry relies on the `system_action` fallback. **Guard:** with a non-UUID `userId`, a platform-account `userId`, or a non-UUID `actorId`, `log()` is **not** called and an error-level log names area, action type, grouping id and account.
- [ ] **AC-4** (FR-4) — The entry carries exactly the FR-4 fields: area(s), action type, grouping id (as entity id and in details), call count, failed-call count, input / output / total tokens, estimated cost, distinct call names, model names, outcome (with the error code on failure), trigger, and correlation id where present.
- [ ] **AC-5** (FR-5) — With a mocked action whose prompt, owner input, model output and error message each contain a unique marker string, **no marker appears anywhere in the audit entry**; `resourceName` is unset; and `log()` is called **without** the HTTP request.
- [ ] **AC-6** (FR-6, FR-18) — **The event name, not a severity argument, decides severity:** `log()` receives neither `severity` nor `complianceFlags`. Outcome: an action whose one failed call was repaired uses `BUSINESS_AI_ACTION_COMPLETED` with a failed-call count of 1; an action whose last attempt of a call name failed, or that threw after an LLM call, or that the emitter marked as fallback (briefing `source: 'fallback'`, website fallback content, image with no data or a failed store), uses `BUSINESS_AI_ACTION_FAILED`, recording only the error code.
- [ ] **AC-7** (FR-7) — `log()` is not called for: a chat turn served entirely from the plan cache, an image served from the reuse cache, an image refused by the daily cap, a cached briefing, and an action that failed before any LLM call.

**(b) Coverage (unit or integration tests, one per area, audit service mocked):**

- [ ] **AC-8** (FR-9) — Chat: one `log()` call per turn, grouped by the turn id, repairs and embeddings counted. A chat website operation makes its own `log()` call (area `website`, its own group), and its calls are not in the turn's totals.
- [ ] **AC-9** (FR-10) — Insights: a run over two businesses makes **two** `log()` calls, one per business, sharing the `runId` and differing by account, each counting that business's insight, correlated-insight and health-summary calls, at info with trigger `scheduled` and the platform as actor; a business whose processing throws after an LLM call still gets its entry (from the `catch`); a business with no LLM call in the run gets none.
- [ ] **AC-10** (FR-11) — Briefing: `getBriefing` does not compile without a trigger argument. A scheduled narration makes one `log()` call with the platform as actor, trigger `scheduled`, info; a My Day narration makes one with the owner as actor and trigger `user`; a same-day re-narration makes a second call in the same group; a cached briefing makes none.
- [ ] **AC-11** (FR-12) — Website and intake: one `log()` call per request at each entry point; the onboarding build makes one call listing both areas.
- [ ] **AC-12** (FR-13) — Leads: one `log()` call per enquiry, actor the platform, trigger `external`, and nothing about the visitor.
- [ ] **AC-13** (FR-14) — Onboarding: one `log()` call per turn that made an LLM call, all turns of one conversation sharing its grouping id, each with only that turn's totals; a turn with no LLM call makes none.
- [ ] **AC-14** (FR-15) — Images: one `log()` call for a successful generation (zero tokens, the per-image cost), one **failed** call for a provider failure, one call for a billed empty response; none for a reuse-cache hit.

**(c) Write path (unit tests, code review):**

- [ ] **AC-15** (FR-16, FR-17) — The AI audit entry is written only through `AuditTrailService.log()`, as `void auditTrail.log(…).catch(…)`: **there is no `await` on the call**; nothing awaits a flush, calls `flush()` / `shutdown()`, or adds a time limit; `lib/services/AuditTrailService.ts` is unchanged in the diff. With `log()` mocked to take a long time, the owner's action still returns without waiting for it.
- [ ] **AC-16** (FR-16) — With `log()` forced to reject, the owner's action and a background job both complete normally, and an error-level log names area, action type, grouping id and account, with no content.
- [ ] **AC-17** (FR-18, FR-19) — No AI entry is critical. The `token_usage` rows written for an action are identical with Layer 3 on and off.

**(d) Code review, CI and live verification:**

- [ ] **AC-18** (NFRs) — Code review finds: the entry built only from identifiers, counts, labels and numbers; no `request`, `changes`, `resourceName`, `severity` or `complianceFlags` passed to the audit service for AI entries; the accumulator module has no Business OS imports; no new direct Supabase call outside `lib/repositories/`; no `console.*` introduced. `npm run typecheck:bos-llm` passes with no new diagnostic.
- [ ] **AC-19** (all, live, non-production; RC-9) — QA runs one action per area (a chat question, an insight run, a briefing, a website generation, an intake generation, an enquiry, an onboarding conversation, an image request), then by direct query lists every grouping id in `token_usage` for the test business in the window and the AI audit entries found for each. For every entry found: its totals match its ledger rows (FR-8), its fields match FR-4, and it contains no prompt or owner text. Then, by environment:
  - **(a) Long-lived server** (`next start` or dev), waiting at least 10 seconds after the last action while the server keeps running: **every expected entry must be present — any missing entry is a defect.**
  - **(b) Deployed preview:** record the entries found at **+10 seconds**, and again **after a later unrelated request** to the same deployment or **after +1 hour**. An entry that appears only in the second look is **delayed**; one still missing is **lost** and is recorded as a KI-B occurrence (grouping id, time), not a defect.
  - The counts expected, found at each look, delayed and lost are written into the workplan, as the first real measurement of KI-B.
- [ ] **AC-20** (FR-20) — The investigation doc resolves Q4 and records Layer 3, D-1 to D-6, KI-B and OI-D; the Layer 1 roadmap lists Layer 3; both carry a Change History row.

**(e) Owner visibility (integration test, plus one live check):**

- [ ] **AC-26** (FR-27) — With one AI entry and one ordinary entry for the same owner, the owner read path returns only the ordinary entry, and its `total` counts one; asking for `entityType=ai_action` or `action=BUSINESS_AI_ACTION_COMPLETED` returns nothing. Live, after the AC-19 run, the test owner's `/monitoring` page and its CSV export contain **no** AI entry, while an operator's direct query shows them.
- [ ] **AC-27** (FR-28) — Per SA's OQ-11 decision: **if** the RLS policy is changed, a query of `audit_trail` made with the owner's own session returns no `ai_action` row while still returning their other rows; **otherwise**, KI-D is recorded in this document and the user has been told in business terms before release.

*AC numbering is kept stable from the SA-reviewed draft; AC-21 to AC-27 were added when D-5 and D-6 were applied.*

---

## Out of Scope / Future Roadmap

| Item | Where it goes |
|---|---|
| Write AI audit entries immediately and await them, with a short time limit | **OI-D** — recommended future change (D-4) |
| Durable audit writes for every product | **OI-A** — separate decision (SA note: the cheapest platform-wide fix is `waitUntil(auditFlush())` plus per-row fallback on a failed batch) |
| Stop storing the auth credential in `audit_trail.session_id` | OI-B — separate security fix |
| Schedule the 365-day retention job, and decide what happens to critical entries | OI-C |
| Register `AGENT_EXECUTED`, `PILOT_STEP_EXECUTED`, `TOKEN_DISCREPANCY_DETECTED` | **Later, separate item** for the agents product (SA OQ-6) |
| **F-A** — a Layer 1.1 tab check "every AI group has its audit entry" | Later, if the live measurement (AC-19) shows KI-B is frequent |
| Showing AI activity, or its cost, to owners | Revisited with the charging decision (D-6) |
| Admin UI for AI audit entries | Later layer |
| Per-call audit entries | Rejected (D-1) |
| Charging for AI, including images (Layer 1.5 OQ-7), credits remaining (OI-1), onboarding spend (UD-1) | Deduction layer |
| Per-call model configuration | Layer 2 |

---

## Known Issues and Open Items

| Id | Description | Status |
|---|---|---|
| **OI-E** | **The audit API routes were unauthenticated.** Anyone could read any business's audit log, or add fake entries to it, by sending that business's account id — which is public in its AI image web addresses (S-1, F-9) | **In scope as step 0 of this layer** (D-5; FR-21 to FR-26). Gates this layer's release |
| **KI-A** | The plan-cache store embedding is written fire-and-forget after the chat turn (Layer 1 KI-2), so it can land after the turn's audit entry is queued; that entry's totals may be a few tens of tokens short | Accepted; FR-8's stated exception |
| **KI-B** | **Known risk of this layer: some AI audit entries may be delayed, and occasionally lost** (D-4). AI entries use the existing queued audit path: they are held in memory and written in batches every 5 seconds or at 100 entries (F-1); the queue is cleared before the insert, so a failed insert loses the whole batch (F-2); and nothing forces a write before a serverless function is frozen after its response — Next.js 14.2.35 has no `after()`, and `@vercel/functions` / `waitUntil` isn't installed (F-3).<br>**SA sizing (OQ-8):** a frozen instance's timer fires when it thaws, so most request-path entries are **delayed until that instance's next request**; they are **lost** only when the instance is recycled before it is reused. Exposure is highest for low-traffic routes (onboarding, images), detached work (lead replies) and the last ≤ 5 seconds of a cron run.<br>**Second loss mode (S-3):** one bad row fails its whole batch. FR-3's guard stops AI entries from being that row, but an account **deleted mid-run** can still fail the foreign key and lose a batch — that residual risk belongs to OI-A.<br>**Mitigation:** every AI call is still in the usage ledger (written by the provider layer), under the same account and grouping id, so a missing entry can be reconstructed. AC-19(b) takes the first measurement | **Accepted for this layer by the user, 2026-09-18.** Change recommended as OI-D |
| **KI-C** | **A silently defaulted AI response counts as a success.** When a model returns a 200 response that the service cannot parse and silently replaces with defaults (the onboarding extractors), the action is recorded as succeeded. Threading that signal out of the onboarding manager is not worth it in this layer (SA RC-6) | Accepted for this layer |
| **KI-D** | *(Conditional on OQ-11.)* **An owner could still read their own AI entries by querying the database directly** with their own login, because the RLS policy lets owners read all their own audit rows (S-2). The product never shows them (FR-27) | Recorded only if SA decides not to change the RLS policy; then reported to the user before release (FR-28, AC-27) |
| **OI-D** | **Recommendation: change it later for AI entries.** Write AI audit entries **immediately** (not through the batch queue) and **await confirmation with a short time limit — about 1–2 seconds** — so an owner's action is never held up by more than that, and a slow or failed write is logged rather than silently dropped. Background jobs are unaffected (they already run for seconds per business). This closes KI-B for AI entries without touching any other product | **Open — recommended, not scheduled** (D-4). BA suggestion: revisit once AC-19 and early production show how often KI-B occurs, or together with OI-A |
| **OI-A** | **Every product's audit entries can be delayed or silently lost** (F-1 to F-3, S-3) — agents, payments and the business purge's *critical* events, not only AI | **Open — separate, service-wide decision.** SA note: the cheapest fix is `@vercel/functions` `waitUntil(auditFlush())` at the end of each route and cron, plus a per-row fallback on a failed batch, which also removes S-3's amplification. If done, it closes KI-B and makes OI-D unnecessary |
| **OI-B** | **The audit service stores an auth credential.** When a request is passed, `session_id` is filled from the `sb-access-token` / `sb-refresh-token` cookie or the start of the `Authorization` header (`AuditTrailService.ts:182-190`). The two write routes fixed in step 0 still pass the request | **Open — security fix, separate from this layer.** Layer 3 never passes the request for AI entries (FR-5) |
| **OI-C** | **No scheduled job runs the 365-day retention** (`applyRetentionPolicy`, `AuditTrailService.ts:468`; no caller, no cron in `vercel.json` — confirmed by SA). Also, `criticalEventsDays` is never used, so critical entries would never be deleted | **Open** — schedule it, or record that audit entries are kept indefinitely. AI entries keep the 365-day default once it runs |
| Parked | Layer 1.5 OQ-7, OI-1, UD-1 | Unchanged — deduction layer |

---

## Open Questions

### For the user (business decisions) — all resolved 2026-09-18

- [x] **D-1 (was BD-1) — Granularity.** Resolved: **one entry per user action or background job**, linked by the grouping id. Resolves investigation **Q4**.
- [x] **D-2 (was BD-2) — What is recorded.** Resolved: the agreed list **plus call names and model names**; the never-recorded list stays as written.
- [x] **D-3 (was BD-3) — Background jobs.** Resolved: **yes** — one entry per business per insight run and per briefing, info, scheduled, platform as actor.
- [x] **D-4 (was BD-4) — Reliability.** Resolved: **not changed now** — the existing queued path is used; the loss is the known risk KI-B; the change is recommended for later as OI-D.
- [x] **D-5 (SA OI-E) — Audit route security.** Resolved: **option 1A** — fixed as step 0 of this layer, before any AI entry is written.
- [x] **D-6 (SA UD-1) — Owner visibility.** Resolved: **option 2A** — AI entries hidden from owners, operator-only until the charging decision.

### For SA — decided in the SA review (2026-09-18)

- [x] **OQ-1 — Where each entry is emitted.** Decided: the emission rule and the verified per-area points ([table](#what-one-audit-entry-is-per-area), RC-7).
- [x] **OQ-2 — Event names.** Decided: the pair `BUSINESS_AI_ACTION_COMPLETED` (info) / `BUSINESS_AI_ACTION_FAILED` (warning), `SOC2`; severity from metadata only (FR-2, FR-18, RC-5).
- [x] **OQ-3 — Entity type and id.** Decided: `ai_action`, `entity_id` = the grouping id; `resourceName` unset. "No migration" holds only if the production schema confirms it (RC-11).
- [x] **OQ-4 — How the totals are gathered.** Decided: an `AsyncLocalStorage` accumulator fed by `callWithTracking`; read-back rejected (FR-8).
- [x] **OQ-5 — Multi-area and multi-turn actions.** Decided: one entry per onboarding build, listing both areas; one entry per onboarding turn (FR-12, FR-14).
- [x] **OQ-6 — The three agents-side events.** Decided: later, as a separate item for the agents product.
- [x] **OQ-7 — The durability mechanism.** *Withdrawn 2026-09-18:* not needed — D-4 keeps the existing queued path. Carried into **OI-D**.
- [x] **OQ-8 — Verify F-3 repository-wide.** Confirmed: nothing outside the service flushes; most at-risk entries are delayed rather than lost (KI-B).
- [x] **OQ-9 — The Layer 1.1 LLM Usage tab.** Confirmed out of scope; F-A stays a later option.
- [x] **OQ-10 — Retention.** Confirmed: nothing runs it, and `criticalEventsDays` is unused (OI-C). AI entries keep the 365-day default.

### For SA — new, from D-5 and D-6 (for the workplan review)

- [ ] **OQ-11 — Owners reading AI entries directly (FR-28).** (raised by: BA | status: open, for SA.) The RLS policy "Users can view their own audit logs" (`create_audit_trail.sql:60-63`) lets an owner read all their own rows with their own login, so the API filter does not stop a direct query. Options:
  - **(a)** Change the policy to `auth.uid() = user_id AND entity_type <> 'ai_action'` — a one-line policy migration, so this layer would no longer be "no migration" (check the production policy first with the `business-os-schema-check` skill, and confirm no client code reads `audit_trail` directly under RLS);
  - **(b)** Leave RLS as it is and record KI-D.

  *BA suggestion:* **(a)**. The user asked that AI entries appear in no owner-scoped read, and (a) closes it with one line.
- [ ] **OQ-12 — Where the owner exclusion lives (FR-27).** (raised by: BA | status: open, for SA.) `AuditTrailService.query()` cannot exclude an entity type (F-10), and D-4 keeps the service unchanged. Options:
  - **(a)** The step 0 owner read goes through a new repository method (e.g. an owner-scoped read in `lib/repositories/`) with `.eq('user_id', userId)` and `.neq('entity_type', 'ai_action')`, leaving `AuditTrailService` untouched and applying the mandatory repository rule to the fixed routes;
  - **(b)** Add an optional exclusion parameter to `query()` — read-side only, but it changes the file D-4 keeps unchanged, and AC-15 would need rewording and the user's agreement.

  *BA suggestion:* **(a)**. It keeps D-4 exactly as the user decided.
- [ ] **OQ-13 — The GDPR export.** (raised by: BA | status: open, for SA.) `AuditTrailService.exportUserData()` (`:383-423`) returns every audit row for a user, for a GDPR data-portability export. BA could not confirm whether any route exposes it to owners. If one does: should AI entries be left out? *BA suggestion:* leave them out of any self-service owner export, consistent with D-6; a formal data-subject request handled by operators may include them. If a self-service route exists, SA confirms and the TL takes the question to the user.

---

## Notes on Integration Points

| Area | Files |
|---|---|
| **Step 0 — audit routes** | `app/api/audit/query/route.ts`, `app/api/audit/log/route.ts`, `app/api/audit-trail/route.ts` (fix or remove; Zod; Pino); `app/(protected)/monitoring/page.tsx` (known caller; unchanged, or the useless header removed); `lib/auth` (`getUser()`); `AdminAccessService` only if an admin path is needed |
| **Owner visibility** | The owner read path (a new repository method if OQ-12 = a); the RLS policy in `audit_trail` if OQ-11 = a |
| Audit infrastructure | `lib/services/AuditTrailService.ts` (**not modified**, D-4; `log()` is the write path), `lib/audit/events.ts` (the two events + metadata), `lib/audit/types.ts` (entity type `ai_action`) |
| Accumulator (new pattern, SA-approved) | `lib/ai/usageScope.ts` (proposed; generic, no Business OS concepts), `lib/ai/providers/baseProvider.ts` (`callWithTracking` notifies the innermost scope) |
| Catalog | `lib/business-os/llm/callCatalog.ts` (areas, call names, `isUuid`, `isPlatformAccount` — read only); `lib/platformAccount.ts` (actor for background jobs, with the UUID check of FR-3) |
| Chat | `app/api/business-os/chat-v4/route.ts`, `lib/business-os/bizql/mutate/MutateExecutor.ts` (nested website scope) |
| Insights | `app/api/cron/insight-detect/route.ts` |
| Briefing | `lib/business-os/briefing/BriefingStore.ts` (`getBriefing` gains a required trigger), `app/api/business-os/my-day/route.ts`, `DailyBriefingDispatchService.ts` |
| Website / intake | `app/api/website/generate-from-profile/route.ts`, `app/api/website/landing-pages/generate/route.ts`, `app/api/website/blocks/[blockId]/regenerate/route.ts`, `app/api/website/enhance-testimonial/route.ts`, `app/api/intake/form/generate/route.ts`, `app/api/intake/form/infer-question/route.ts`, `app/api/onboarding/build/route.ts`; dormant: `WebsiteSectionService.ts`, `WebsiteBlockEnrichmentService.ts` |
| Leads | `lib/services/LeadAlertService.ts` |
| Onboarding | `app/api/onboarding/chat/route.ts` |
| Images | `app/api/website/media/generate/route.ts` |
| DB | `audit_trail` (writes, through the existing queue; owner reads). **No migration expected, subject to two checks:** (1) **RC-11** — the claim rests on `supabase/SQL Scripts/create_audit_trail.sql`, a script, not a migration, so the workplan verifies the production columns and constraints with the `business-os-schema-check` skill: `entity_type` has no `CHECK`, `user_id` has a foreign key to `auth.users`, `actor_id` has none; (2) OQ-11 — option (a) adds one RLS policy migration. `token_usage` is not read |

---

## SA Review

**Reviewed by SA — 2026-09-18**
**Status:** 🔄 **Revision Required. The requirement is approved in substance, conditional on RC-1 to RC-12.** *(BA applied RC-1 to RC-12 and the user's D-5 and D-6 on 2026-09-18 — see [Approval](#approval).)*
- **RC-1 is a release prerequisite, not a workplan blocker.** The audit trail's own API routes are unauthenticated, so this layer must not ship until at least the read route is fixed.
- **RC-2 needs a user decision:** owners can see their own audit rows, including AI costs.

The BA's findings F-1 to F-8 are all confirmed at `main` 7646760a. D-1 to D-4 are sound and implementable, and the per-area table is right in substance. The review below adds three things the code shows and the draft does not:
- a security hole in the audit routes (RC-1);
- owner visibility of audit rows (RC-2);
- a "poison pill" amplification of F-2 (RC-3).

It also replaces the read-back option with an in-process accumulator (OQ-4).

### New findings

| # | Finding | Evidence |
|---|---|---|
| **S-1** | **The audit API routes are unauthenticated, and they use the service role.** None of the three routes checks a session, and middleware does not set `x-user-id`: `/api` is only skipped by its onboarding check (`middleware.ts:83`). `AuditTrailService` uses the service-role client (`AuditTrailService.ts:36-39`).<ul><li>`GET /api/audit/query` reads the user id from the `x-user-id` **request header** and returns that user's audit log (`app/api/audit/query/route.ts:11-38`).</li><li>`POST /api/audit/log` takes the user from the same header.</li><li>`POST /api/audit-trail` takes `userId` from the **body** (`app/api/audit-trail/route.ts:14-27`).</li></ul>**Exploit chain:** a business's user id is public. Every generated website image is stored at `${userId}/generated/…` in a public bucket, and its URL is on the business's site (`GeneratedImageService.ts`, path build before `getPublicUrl`). | Anyone can **read** any business's audit trail, and **forge** entries in it. Pre-existing and wider than this layer, but Layer 3 adds every business's AI activity, cadence, model names and costs to what can be read, and makes forged "AI activity" indistinguishable from real → **RC-1** |
| **S-2** | **Owners can see their own audit rows.**<ul><li>RLS `"Users can view their own audit logs"` grants `SELECT` where `auth.uid() = user_id` (`supabase/SQL Scripts/create_audit_trail.sql:60-63`).</li><li>The `/monitoring` page (linked from `app/(protected)/layout.tsx:612`) lists the user's audit log from `/api/audit/query` and exports it as CSV (`app/(protected)/monitoring/page.tsx:53-57`, `:434`).</li></ul> | AI entries written with `userId` = the business become **owner-visible**: background jobs, token counts, model names and the **estimated USD cost**. That contradicts the stance that dollars are "our cost, not the user's" (`app/api/business-os/usage/route.ts` header) and Layer 1.5 KI-A (image spend operator-only) → **RC-2** |
| **S-3** | **One bad row loses its whole batch, from every product.** `audit_trail.user_id` is `REFERENCES auth.users(id)` (`create_audit_trail.sql:9`), and `user_id` / `actor_id` are `UUID` columns. A single entry with a non-existent account, or a non-UUID value, fails the batch insert. Because the queue is cleared first (F-2), that loses up to 99 other entries, which can include critical purge or payment events queued in the same process | Layer 3 adds a new, high-volume writer to shared batches → **RC-3** |
| **S-4** | **An awaited `log()` can make the caller wait for a database insert.** `log()` awaits `flush()` when its entry is the 100th in the queue (`AuditTrailService.ts:96-98`). 89 of the repo's ~140 `log()` call sites use `await`. CLAUDE.md's own Audit Trail example awaits it | Breaks FR-16's "no wait" on exactly the busiest instances → **RC-4** |
| **S-5** | **The chat turn id can come from the client.** `turnId = isUuid(incomingCorrelationId) ? incomingCorrelationId : crypto.randomUUID()` (`app/api/business-os/chat-v4/route.ts:335`), where the correlation id is the request's `x-correlation-id` header | A reused id would merge turns in any **read-back** by grouping id. This is one reason OQ-4 rejects read-back. It is harmless for the accumulator, and the entry's `userId` stays server-side |

### Open-question decisions

- **OQ-1 — where each entry is emitted.**
  - **The rule, restated (RC-7):** *the function whose single invocation is one AI action opens that action's accumulator scope, and emits the entry when the action ends — on both the success and the failure path.* "The function that mints the group" is not quite right: the onboarding group spans many turns and the briefing group spans same-day re-narrations, so their actions are narrower than their groups. A nested action that mints **its own** group opens a nested scope and emits its own entry.
  - **Emission points, verified:**

    | Area | Emits at | Evidence |
    |---|---|---|
    | chat | `app/api/business-os/chat-v4/route.ts` `POST`, around the turn | turn id at `:335` |
    | chat's website operation | `lib/business-os/bizql/mutate/MutateExecutor.ts` (own group), in a nested scope; area `website`, trigger `user` | `:811` |
    | insights | `app/api/cron/insight-detect/route.ts`, the per-business loop body, in both the `try` and the `catch`; key = account + `runId`; trigger `scheduled` | loop `:205-283`, `runId` `:142` |
    | briefing | `lib/business-os/briefing/BriefingStore.ts` `getBriefing`, around `narrateBriefing`. The cached path makes no LLM call, so it writes no entry (FR-7). The trigger comes from the caller (RC-8): `DailyBriefingDispatchService` → `scheduled`, `my-day/route.ts` → `user` | `:51` (callers `DailyBriefingDispatchService.ts:222`, `my-day/route.ts:119`) |
    | website / images | The five routes that mint a group: `generate-from-profile`, `landing-pages/generate`, `blocks/[blockId]/regenerate`, `enhance-testimonial`, `media/generate` | `:76`, `:91`, `:68`, `:34`, `:48` |
    | website (dormant) | `WebsiteSectionService` and `WebsiteBlockEnrichmentService` use the same helper. The first always throws before any call (Layer 1 KI-1); the second has no production trigger (Layer 1 KI-3). Covered by unit tests only | `:521`, `:271` |
    | intake | `intake/form/generate`, `intake/form/infer-question` | `:49`, `:67` |
    | onboarding build | `app/api/onboarding/build/route.ts`: one scope spanning intake and website, one entry | `:825` |
    | leads | `lib/services/LeadAlertService.ts`, around `recommendLeadReply`; trigger `external`, actor the platform. It runs **detached** from the contact-form response (`app/api/website/forms/contact/route.ts:247`, `.catch` without `await`), so it is the most KI-B-exposed area | `:336` |
    | onboarding | `app/api/onboarding/chat/route.ts`, around `processUserMessage`, per turn, with `currentState.attributionGroupId` | `:216-221` |

- **OQ-2 — event names: a pair,** `BUSINESS_AI_ACTION_COMPLETED` (info) and `BUSINESS_AI_ACTION_FAILED` (warning).
  - Both carry `complianceFlags: ['SOC2']` and a description, registered in `EVENT_METADATA`.
  - The prefix follows the existing Business OS events (`BUSINESS_DATA_PURGED`, `events.ts:114`).
  - One name per area is rejected: the area is a field, and per-area names would multiply the metadata for no query benefit.
  - The emitter **never** passes `severity` or `complianceFlags`, so the metadata is the single source (`log()` uses `input.severity || metadata.severity`) → RC-5.
- **OQ-3 — entity type `ai_action`, `entity_id` = the grouping id.**
  - The entity is the *group*, and entries are occurrences of it. An insight `runId` is unique only together with `user_id`. Onboarding turns and briefing re-narrations produce several entries per entity. Both are by design.
  - `resourceName` is left unset (FR-5).
  - **No migration**, provided that `entity_type` is `TEXT` with no `CHECK` (`create_audit_trail.sql:14`). That file is a SQL script, not a migration, so the workplan must verify the production schema → RC-11.
- **OQ-4 — how the totals are gathered: an in-process accumulator, not a read-back.**
  - **Read-back by grouping id is wrong for three areas:**
    - onboarding: one group spans every turn, so each per-turn entry would re-sum all earlier turns;
    - briefing: a same-day re-narration shares its UUID v5 group, so it would double-count;
    - chat: the turn id can be client-supplied (S-5).

    It would also add a database read to every owner action.
  - **The mechanism:** an `AsyncLocalStorage` scope opened by the emitting function (OQ-1), fed from `BaseAIProvider.callWithTracking`'s success and failure branches (`baseProvider.ts`).
    - Every Business OS LLM call already goes through `callWithTracking`, and all six providers use it. The only other `trackAICall` on a Business OS path is the chat cache-hit row, which FR-7 excludes anyway.
    - Each notification carries the feature (area), component (call name), model, tokens, `cost_usd`, success and the error **code**.
    - It needs zero call-site changes, zero database reads and zero added latency. It is exact per action, including repairs and failures.
  - **Conditions (a new pattern, approved here under CLAUDE.md rule 7):**
    - it is a generic module (e.g. `lib/ai/usageScope.ts`) with no Business OS concepts, so the provider layer stays product-agnostic;
    - only the innermost scope is notified;
    - the notification can never throw into the call;
    - calls whose `sessionId` differs from the scope's group are excluded from the entry and logged at warn, which catches wiring bugs;
    - it runs on the Node runtime only (no touched route declares Edge; the two crons declare `nodejs`).
  - **FR-8** then holds by construction. The only differences are KI-A, and a ledger insert that failed (the tracker swallows it).
- **OQ-5 — one entry per build, listing both areas; onboarding stays one entry per turn** (FR-14 confirmed). A per-conversation entry would miss abandoned conversations, and with the accumulator the per-turn totals are exact.
- **OQ-6 — later, as a separate item.** Registering `AGENT_EXECUTED`, `PILOT_STEP_EXECUTED` and `TOKEN_DISCREPANCY_DETECTED` changes the agents product's stored severities. That is its owner's call, not a Business OS change.
- **OQ-8 — confirmed: nothing flushes.**
  - The only calls to `flush()` / `shutdown()` are inside the service itself (`AuditTrailService.ts:97`, `:264`, `:506`, `:527`). `auditFlush` (`:537`) has **no caller** anywhere in `app/` or `lib/`.
  - **Sizing:** a frozen serverless instance keeps its interval, and it fires on thaw. So most request-path entries are **delayed until that instance's next request**, rather than lost. Entries are lost when an instance is recycled before it is reused.
  - Exposure is therefore highest for:
    - low-traffic routes (onboarding, images);
    - detached work (lead replies);
    - the last ≤ 5 seconds of a cron run. Crons otherwise flush every 5 seconds while they run.
  - S-3 adds a second loss mode: one bad row loses its batch.
- **OQ-9 — confirmed:** the LLM Usage tab stays out of scope. F-A stays a later option.
- **OQ-10 — confirmed:** nothing calls `applyRetentionPolicy` (defined at `AuditTrailService.ts:468`; no caller; no cron in `vercel.json`). AI entries keep the 365-day default once OI-C schedules it. Also note: `criticalEventsDays` is never used, so critical entries are never deleted at all. This belongs to OI-C, not this layer.

### Required changes (RC-n)

1. **RC-1 (Scope, KI table; release prerequisite): add OI-E.** "The audit API routes are unauthenticated" (S-1). Layer 3 **must not be released** until `/api/audit/query` takes the user from the session (`getUser()`) and `/api/audit/log` and `/api/audit-trail` are authenticated, admin-only or removed. The fix is outside this layer, like OI-B, but it gates this layer's release. Implementation can proceed in parallel. — **Applied 2026-09-18, widened by user decision D-5 (option 1A):** the fix is **inside** this layer as step 0 — FR-21 to FR-26, AC-21 to AC-25, OI-E row, Scope (0), Integration Points. It covers a fourth handler, `GET /api/audit-trail` (F-9), and must land before any AI entry is written.
2. **RC-2 (new user decision UD-1): owner visibility (S-2).** Record that AI entries will be readable by the owner: through RLS, and on the `/monitoring` page and its CSV export. Present the choice (see "For the user" below). Whatever is chosen, background entries must read as scheduled platform work (FR-3 already provides the fields). — **Applied 2026-09-18:** user decision **D-6 (option 2A)**, AI entries hidden from owners — FR-27, FR-28, AC-26, AC-27, KI-D (conditional), and new SA questions OQ-11 (RLS), OQ-12 (where the exclusion lives) and OQ-13 (GDPR export).
3. **RC-3 (FR-3, FR-16): the poison-pill guard.**
   - Before calling `log()`, the emitter checks that `userId` is a UUID and is **not** a platform account (the catalog's `isUuid` / `isPlatformAccount`).
   - `actorId` must be a UUID. For background jobs, use the platform id only when it is a UUID, else the all-zero id. `platformAccountId()` returns a non-UUID env value verbatim, so it cannot be used as is.
   - On failure: write no entry, and log at error with area, action type, group and account.
   - Add to KI-B that an account deleted mid-run can still fail the FK and lose a batch. That residual risk belongs to OI-A.

   — **Applied 2026-09-18:** FR-3, FR-16, AC-3, KI-B.
4. **RC-4 (FR-16, AC-15): `log()` is never awaited.** Write `void auditTrail.log(entry).catch(…)`. State why (S-4). AC-15 asserts there is no `await` on the call. — **Applied 2026-09-18:** FR-16, AC-15.
5. **RC-5 (FR-2, FR-18): severity and compliance flags come only from `EVENT_METADATA`.** The emitter passes neither. AC-6 asserts that the event name, not a severity argument, decides the severity. — **Applied 2026-09-18:** FR-2, FR-18, AC-6, AC-18.
6. **RC-6 (FR-6): make the outcome rule implementable.**
   - The action **failed** if the emitter signals it (briefing `source: 'fallback'`, website fallback content, an image with no data or a failed store) or the action threw.
   - Otherwise, it failed if any call name's **last** attempt failed. A repaired chat planner therefore stays succeeded.
   - Only the tracked call's `error.code` is recorded as the category.
   - Add **KI-C:** a 200 response that the service could not parse and silently replaced with defaults (the onboarding extractors) is recorded as **succeeded**. Threading that signal out of the manager is not worth it in this layer.

   — **Applied 2026-09-18:** FR-4, FR-5, FR-6, AC-6, KI-C.
7. **RC-7 (OQ-1, FR-9 to FR-15): the emission rule and the table above.** This includes the chat website operation's nested entry and the dormant `WebsiteSectionService` / `WebsiteBlockEnrichmentService` points. — **Applied 2026-09-18:** emission rule and an "Emits at" column in the per-area table (with rows for the chat website operation and the dormant points), FR-8 (accumulator), FR-9 to FR-14, AC-1, AC-8, AC-9, Integration Points.
8. **RC-8 (FR-11): briefing trigger.** `getBriefing` takes a **required** trigger argument, so the scheduled path and the My Day path cannot be confused. — **Applied 2026-09-18:** FR-11, AC-10, Integration Points.
9. **RC-9 (AC-19): split the live check by environment.**
   - **(a) A long-lived server** (`next start` or dev), where the flush timer runs: every expected entry must be present, and any miss is a **defect**.
   - **(b) A deployed preview:** record entries found at +10 s, and again after a later unrelated request or +1 hour. This separates *delayed* from *lost*.

   As written, AC-19 would misreport delayed entries on Vercel as KI-B losses. — **Applied 2026-09-18:** AC-19 rewritten as (a) and (b).
10. **RC-10 (FR-4, S-5): note the chat entity id's origin.** The chat entry's grouping id may be the client's correlation id. It is never used to read anything back, and never trusted for anything but linking. — **Applied 2026-09-18:** FR-4, per-area table, NFR Tenancy.
11. **RC-11 (Notes on Integration Points): verify the production schema.** The "no migration" claim rests on `supabase/SQL Scripts/create_audit_trail.sql`. The workplan checks the production columns and constraints with the `business-os-schema-check` skill: `entity_type` has no `CHECK`, `user_id` has an FK, `actor_id` has none. — **Applied 2026-09-18:** Integration Points (DB row), OQ-3.
12. **RC-12 (Volume):** 73k a year at 100 businesses is an upper bound. Insight entries exist only for businesses with detections, because the LLM is called only when `detections.length > 0` (`insight-detect/route.ts:215`). Briefing entries exist only for narrations that were not cached (`BriefingStore.ts:43-51`). Say so. — **Applied 2026-09-18:** Volume and Retention Estimate.

### Checks passed

- **Tenancy:** every account in the table is server-side (session user, cron-iterated account, owner resolved from the site for leads). Background entries carry `actorId` = platform and trigger `scheduled` / `external` (FR-3), so they do not look like owner actions.
- **Privacy:** the FR-4 fields are ids, counts, platform labels (areas, catalog call names, model names) and numbers. No `request`, `changes` or `resourceName` is passed. Error text is excluded, and only `error.code` is kept.
- **Non-blocking:** satisfied with RC-4. `log()` never rejects in practice (`silent: true`), so the `.catch` is a belt-and-braces measure, and AC-16 is testable with a mock.
- **Scope:** proportionate. No charging, no service change, no migration, no UI.

### Follow-ups

| # | Item |
|---|---|
| OI-E | Authenticate or remove the audit API routes (RC-1). **P0 security, separate task, gates Layer 3's release** — *moved into this layer as step 0 by user decision D-5* |
| OI-A (note) | The cheapest platform-wide fix is `@vercel/functions` `waitUntil(auditFlush())` at the end of each route and cron, plus per-row fallback on a failed batch, which removes S-3's amplification. For the OI-A decision only |
| OI-C (note) | `criticalEventsDays` is unused, so critical entries are never deleted |
| OQ-6 | Register the three agents-side events. Agents owner, separate item |

### For the user (business terms)

- **Security: needs attention now, independent of this layer (OI-E).** The system's activity log can be read by anyone who knows a business's internal account number, and fake entries can be added to it. That account number appears in the web address of every AI image on a business's public website. This must be fixed before the AI audit trail is switched on, because otherwise this layer would add every business's AI activity and costs to what can be read. — *Answered: D-5, fixed as step 0 of this layer.*
- **UD-1: should business owners see their AI activity, and its cost to us, in their own activity log?** The existing `/monitoring` page already shows an owner their own activity log and lets them download it. Once this layer ships, every AI action for their business (including the nightly background work) will appear there, with its estimated dollar cost unless we choose otherwise. The options:
  - **(a)** Hide AI entries from the owner's activity page. They stay available to operators. The owner could still technically read their own rows, but nothing would show them.
  - **(b)** Show them, including the cost.
  - **(c)** Show them, but leave the dollar cost out of the entry. That changes the earlier decision to record the cost (D-2).

  *SA recommendation:* **(a)**. It matches the earlier decision that AI costs are operator information until charging is decided (Layer 1.5 KI-A). — *Answered: D-6, option (a) ("2A"), and not in any owner-scoped read — the residual direct read is OQ-11.*

### Approval

- [x] Requirement approved in substance, **conditional on** BA applying RC-1 to RC-12 and the user answering OI-E and UD-1.
- [x] Conditions met 2026-09-18: RC-1 to RC-12 applied by BA; the user answered D-5 (option 1A) and D-6 (option 2A). **Ready for Dev workplan.**
- [ ] New SA questions OQ-11 to OQ-13 (from D-5 / D-6) to be settled at the workplan review. They decide *how* owners are kept from AI entries, not *whether*.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-18 | Created (Draft) | Layer 3 requirement for standard #3 ("every LLM call is recorded in the audit trail"), written after Layers 1, 1.1, 1.5 and the logging clean-up (PR #50) merged. Proposed decisions BD-1 (one event per AI action or job, linked to the ledger by the grouping id — resolves investigation Q4, pending confirmation) and BD-2 (the recorded fields; never prompts, owner text or AI output); open business decisions BD-3 (background jobs — BA recommends yes, one per business per run) and BD-4 (reliability — BA recommends making these events durable now). Code findings F-1 to F-8: in-memory 5-second batching, a failed write drops its batch, no `after()` / `waitUntil` available (Next.js 14.2.35, no `@vercel/functions`) so queued entries can be lost when a serverless function freezes, an auth credential stored in `session_id` when a request is passed, unregistered events saved as "Unknown event", a closed entity-type union, the platform-account fallback, and no scheduled retention job. 20 FRs, 20 ACs; 10 SA open questions; open items OI-A to OI-C |
| 2026-09-18 | User decisions D-1 to D-4 recorded | **D-1** granularity agreed (one entry per action or job, linked by the grouping id) — **resolves investigation Q4**. **D-2** recorded fields agreed, including call names and model names; the never-recorded list unchanged. **D-3** background jobs agreed: one entry per business per insight run and per briefing, info, scheduled, platform as actor. **D-4 reliability not changed:** the audit service stays exactly as it is; AI entries use the existing queued `log()` path with a non-blocking `.catch`. The loss risk is documented as **KI-B** (known risk of this layer, rate unknown, mitigated by the ledger); the recommended later change — write AI entries immediately and await with a ~1–2 s cap — is new open item **OI-D**; the service-wide fix stays **OI-A**. FR-1 now says "queues exactly one"; **FR-17 rewritten** from "durable, awaited" to "the existing queued path, unchanged"; FR-16 "never slows the action"; NFRs gain "no wait" and "best-effort (accepted)"; **AC-15 rewritten** (only `log()` + `.catch`, no flush, service unchanged, action never waits); **AC-19 rewritten** to wait ≥10 s, record a missing entry as a KI-B occurrence rather than a defect, and report expected / found / missing counts; unit-level ACs now assert `log()` calls rather than stored rows. **OQ-7 withdrawn** (carried into OI-D); OQ-4 and OQ-8 wording updated. BD-1..BD-4 renamed D-1..D-4. Status: pending SA review only. Counts unchanged: **20 FRs, 20 ACs** |
| 2026-09-18 | SA review — revision required | F-1 to F-8 confirmed. New findings: **S-1** the audit API routes are unauthenticated and service-role (`/api/audit/query` reads any user's log from an `x-user-id` header; two write routes accept any user), and a business's account id is public in its image URLs, so this is **OI-E, a release prerequisite (RC-1)**; **S-2** owners can see their own audit rows (RLS and the `/monitoring` page), so AI costs would become owner-visible, which is new user decision **UD-1 (RC-2)**; **S-3** one bad row fails its whole shared batch (user_id FK), so a poison-pill guard is needed (RC-3); **S-4** an awaited `log()` can wait on a 100-row insert, so it is never awaited (RC-4); **S-5** the chat turn id can be client-supplied. OQ decisions: emission rule and per-area points (OQ-1); `BUSINESS_AI_ACTION_COMPLETED` / `_FAILED` pair, severity from metadata only (OQ-2, RC-5); entity `ai_action`, id = group (OQ-3); **accumulator via AsyncLocalStorage fed by `callWithTracking`**, read-back rejected (OQ-4); one entry per build, per onboarding turn (OQ-5); agents events later (OQ-6); no caller flushes, most losses are delays on Vercel (OQ-8); tab out of scope (OQ-9); retention never runs (OQ-10). RC-6 outcome rule and KI-C; RC-8 briefing trigger; RC-9 AC-19 split by environment; RC-11 verify the production schema; RC-12 volume is an upper bound |
| 2026-09-18 | User decisions D-5, D-6 recorded; RC-1 to RC-12 applied — SA approved, ready for Dev workplan | **D-5 (option 1A):** the audit-route fix moves **into** this layer as **step 0**, landing before any AI entry is written — new FR-21 to FR-26 (order; session identity and 401; own entries only, admin only via `AdminAccessService`; Zod, with client writes of `ai_action` / `BUSINESS_AI_ACTION_*` rejected; callers kept working — known caller the `/monitoring` page, full survey in the workplan, uncalled handlers may be removed; no error text to clients, Pino) and AC-21 to AC-25. New finding **F-9**: `GET /api/audit-trail` also trusts a query-string `userId`, so four handlers are in step 0. **D-6 (option 2A):** AI entries hidden from owners — FR-27 (excluded in the database query of every owner read, so `/monitoring`, its counts and its CSV export never show them; F-10, F-11), FR-28 (direct reads under RLS), AC-26, AC-27, conditional **KI-D**, and new SA questions **OQ-11** (change the RLS policy — BA suggests yes), **OQ-12** (a repository read, keeping `AuditTrailService` unchanged — BA suggests yes) and **OQ-13** (the GDPR export). **RC-3** poison-pill guard (FR-3, AC-3, KI-B); **RC-4** `log()` never awaited (FR-16, AC-15); **RC-5** severity and flags from metadata only (FR-2, FR-18, AC-6); **RC-6** outcome rule, error code only, **KI-C** (FR-6); **RC-7** emission rule and an "Emits at" column, nested chat website entry, dormant points, and the `AsyncLocalStorage` accumulator in `callWithTracking` replacing read-back (FR-8 to FR-14); **RC-8** required briefing trigger (FR-11, AC-10); **RC-9** AC-19 split into long-lived server (a miss is a defect) and deployed preview (delayed vs lost); **RC-10** chat grouping id may come from the client (FR-4); **RC-11** verify the production schema before "no migration"; **RC-12** volume stated as upper bounds. OQ-1 to OQ-10 recorded as decided; F-3 and KI-B updated with SA's OQ-8 sizing (mostly delayed, not lost); OI-C gains the unused `criticalEventsDays`; OI-E marked in scope. Each RC marked applied. Counts: **28 FRs, 27 ACs** |
