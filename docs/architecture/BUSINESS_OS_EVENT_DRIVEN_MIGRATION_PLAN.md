# Business OS — Trigger → Rule-Engine Migration Plan

> **Last Updated**: 2026-08-12
> **Status**: 🟠 Draft (v0.3) — **SA-ratified with changes** (§15, 2026-08-13); RC1–RC7 + the four deep-design answers (concurrency/ordering, event-carried state, cron model, rule-engine mechanics) folded into the body. Awaiting user review, then re-submit the revised §3–§9 for SA sign-off (M0 blocking). This is the **implementation companion** to the locked design.

## Overview

The design is already locked in **[BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md)** (the *what/why*: plugins announce normalized domain events → durable `business_events` log → config-driven distributor → fast/delayed durable queues → provider-agnostic **plugin-operation** reactions, replacing the T1–T9 Postgres triggers). That document is deliberately design-altitude and defers the *how* to "the eventual workplan."

**This document is that workplan.** It resolves the deferred implementation choices, names the components to build, and lays out the concrete, incremental, **no-double-fire** migration sequence to move each of the 9 cross-capability triggers onto the rule engine — one side-effect at a time, CRM-first.

It also surfaces the **single biggest implementation reality the design under-specifies**: *where* emission attaches, given that most internal writes today bypass the plugin executor. See [§4](#4-the-emission-point-decision-the-crux).

> **Nothing here is built yet.** Per the design's §9, v1 ships on the triggers unchanged. This plan is what turns "designed" into "sequenced and buildable." Treat the recommendations in §3–§4 as *proposed resolutions for SA/user sign-off*, not decided.

## Table of Contents

1. [Goal, scope, and non-goals](#1-goal-scope-and-non-goals)
2. [Grounded current state](#2-grounded-current-state)
3. [Resolved implementation choices (the design's deferred §8)](#3-resolved-implementation-choices)
4. [The emission-point decision (the crux)](#4-the-emission-point-decision-the-crux)
5. [Components to build](#5-components-to-build) · [5.1 Rule-engine mechanics](#51-rule-engine-mechanics-q4) · [5.2 Event payload / carried state](#52-event-payload--carried-state-q2)
6. [Migration phases](#6-migration-phases)
7. [Per-trigger cutover playbook (T1–T9)](#7-per-trigger-cutover-playbook-t1t9)
8. [Serverless execution model, runner coordination & concurrency](#8-serverless-execution-model-runner-coordination--concurrency) · [8.1 Runner coordination](#81-runner-coordination--concurrency-q1) · [8.2 Trigger sources](#82-trigger-source-options--the-retired-in-process-bus-q3)
9. [No-double-fire + idempotency discipline](#9-no-double-fire--idempotency-discipline)
10. [Testing, parity, and rollback](#10-testing-parity-and-rollback)
11. [Observability & operations](#11-observability--operations)
12. [Risks & open questions](#12-risks--open-questions)
13. [Milestones](#13-milestones)
14. [Change history](#14-change-history)

---

## 1. Goal, scope, and non-goals

**Goal.** Replace the 9 cross-capability **side-effect** Postgres triggers with an application-level, config-driven rule engine that reacts via provider-agnostic plugin operations — incrementally, with each side-effect either trigger-backed *or* event-backed at any instant (never both), so behavior is preserved throughout.

**In scope.** The 9 side-effect triggers (§2), the emission layer, the durable event log + queue, the distributor, the rules registry (system rules first), the fast/delayed lane runners, idempotency/dedupe, and per-trigger cutover + parity verification.

**Explicitly NOT in scope / not migrated.**
- The **~20 `update_*_timestamp` / `set_*_updated_at` maintenance triggers** (business_profiles, crm_contacts, website_pages, payment_transactions, etc.). These are single-table integrity, not cross-capability side-effects — they **stay as triggers**.
- Building **external providers**. This migration makes BOS external-*ready*; no external plugin is built here. (External-readiness is *why* the design chose events; it is not a deliverable of this plan.)
- **User-authored automation rules UI**. Phase-1 ships **system rules** (code-defined) that replace triggers. The user-rules table (generalizing `payment_automation_rules` / `insight_automations`) is a later phase.

---

## 2. Grounded current state

### 2.1 The 9 side-effect triggers to migrate (verified against migrations)

| # | Trigger | Defined in | Fires on → writes |
|---|---|---|---|
| T1 | `create_crm_contact_from_booking_trigger` | `20260722_create_scheduling_tables.sql:261`, **redefined** `20260728_skip_contact_for_pending_payment.sql:83` | booking INSERT → find/create+link `crm_contacts` (skips `payment_status='pending'`) |
| T2 | `log_booking_activity_trigger` | `20260722_create_scheduling_tables.sql:323` | booking INSERT / status change → `crm_activities` (only if `contact_id` present) |
| T3 | `log_payment_activity_trigger` | `20260722_create_payment_tables.sql:329` | transaction → `succeeded` → `crm_activities` (if `contact_id`) |
| T4 | `update_invoice_on_payment_trigger` | `20260722_create_payment_tables.sql:354` | transaction → `succeeded` + `invoice_id` → flip `payment_invoices` to `paid` |
| T5 | `log_email_activity_trigger` | `20260722_create_email_automation_tables.sql:411` | email_send → `sent` → `crm_activities` |
| T6 | `log_task_activity_trigger` (+ `set_task_completed_at_trigger`) | `20260722_create_crm_tasks.sql:169` (+`:125`) | task completed → `crm_activities` |
| T7 | `log_document_activity_trigger` | `20260722_create_contact_documents.sql:122` | document upload → `crm_activities` |
| T8 | `log_crm_contact_created_trigger` | `20260722_crm_contact_creation_activity.sql:49` | contact INSERT → `contact_created` `crm_activities` |
| T9 | `delete_future_bookings_on_contact_delete_trigger` | `20260727_cancel_bookings_on_contact_delete.sql:26` | contact DELETE → cancel future `scheduling_bookings` |

> **Note on T1's redefinition:** T1 exists in two migrations — the cutover must drop the *currently-effective* definition (the `20260728` one) and reproduce its `payment_status='pending'` skip condition as a rule guardrail.

Lane classification (from the design doc §5, carried forward): **Fast** → T1, T4, T9 (create/link, state-flip, integrity cascade). **Delayed** → T2, T3, T5, T6, T7, T8 (activity-timeline logging). T2 is flagged *fast-eligible* (per-rule config).

### 2.2 The event backbone — built but dark
- `business_events` table + RLS — `supabase/migrations/20260801_create_business_events.sql` (table/indexes/RLS only; **no emission triggers** — correct).
- `BusinessEventService` (`lib/business-os/insight/events/BusinessEventService.ts`): `emit` (:49), `emitBatch` (:124), `getEvents` (:210), plus query helpers. Singleton on `supabaseServer`.
- Event taxonomy (`lib/business-os/insight/events/types.ts`): 7 categories, ~40 types, `EVENT_TYPE_TO_CATEGORY` map. **Zero emitters today.** Missing types to add during migration: `task.completed`, `document.uploaded`, `contact.deleted` (T6/T7/T9).

### 2.3 Reusable partials (generalize, don't rebuild)
- `payment_automation_rules` table → the **user-rules** shape (WHEN event → DO block, conditions, delay, guardrails). *(Note: the payment automation engine is currently dormant — see the Payments phase-2 follow-ups; this migration is the natural home to revive/generalize it.)*
- `insight_automations` table → delayed-lane standing rules.
- `DETECTOR_TO_PROCESS` map → rules whose reaction is a kernel process.
- The **3 insight crons** (`insight-metrics` daily, `insight-detect` 15 min, `insight-automations` 5 min in `vercel.json`) → drain the **delayed** queue.

### 2.4 The prerequisite that just landed (and its gap)
The **repository-conformance initiative** (CRM/Scheduling/Payments/Intake/Website plugins + Payments phase-2) routed **most** internal writes through repositories — the enabling precondition for this migration, since it creates an app-level, provider-agnostic write chokepoint that did not exist a month ago.

> ⚠️ **But "most" is not "all," and the gap lands exactly on the T1–T9 entities** (SA finding, RC1). Several production paths still write the trigger source tables via **raw `supabaseServer.from()`**, bypassing both the executor **and** the repository:
> - **`app/api/website/booking/finalize/route.ts`** — the paid-booking confirmation flow (the most important cross-capability chain) — raw-writes `crm_contacts`, `payment_transactions` (`succeeded`), and `scheduling_bookings` (→`confirmed`+`contact_id`), and its own comment (`:244–246`) documents that it **deliberately relies on trigger T2 firing**. This one route is a live dependency on T2/T3/T4/T8.
> - **`app/api/payments/blocks/execute/route.ts`** `schedule_retry`/`cancel_retry` — raw `.from('payment_invoices').update(...)`.
> - **`ChatCommandExecutor`** mixes repo calls with raw `.from()` writes.
>
> **Consequence:** repo-layer emission alone would **silently zero-fire** on these paths after cutover — a parity break in the highest-value flow. So §4's chokepoint is a **goal to be achieved by remediation**, not a fact to rely on. See §4 (RC1) and §6 Phase 0.

---

## 3. Resolved implementation choices

The design's §8 left five choices to "the workplan." Proposed resolutions (for sign-off):

| # | Choice | **Proposed resolution** | Rationale |
|---|---|---|---|
| C1 | **Queue technology** | **DB-backed queue table** (`event_reactions`) in the same Postgres. Fast lane = inline drain right after emit + a frequent safety-net sweep; delayed lane = the existing insight crons. | No new infra; durable + retryable by construction; matches the shared-Postgres reality. Revisit a push queue only if fast-lane latency proves inadequate. |
| C2 | **Event durability attachment** | **At-least-once, post-write emit** — the write commits through the repo, then the event row is written; the distributor works off `event_reactions` rows. Pair with **mandatory idempotent/dedupe-keyed reactions** (C5). **⚠️ RC2 (SA):** "at-least-once" is *not yet true* — `emit()` returns an error result callers ignore, so a write-commits-but-emit-fails loses the event. Phase 0 must add an **emit-durability net**: retry the emit, and a **reconciliation sweep** that detects source rows with no corresponding event and back-emits. | A true same-transaction outbox is impractical through the Supabase client. At-least-once + idempotency is the pragmatic guarantee **once the emit sad-path is closed**. |
| C3 | **Rules registry storage** | **Hybrid.** Phase 1: **code-defined `SYSTEM_RULES`** (versioned, reviewable, not user-editable) that replace T1–T9. Later: a **user-rules table** (generalized `payment_automation_rules`), RLS-scoped. Same distributor reads both. | Platform behavior stays deterministic/testable; user automations get data-driven authorship. Split is trust/authorship, not mechanism. |
| C4 | **Emission wiring** | **Repository-layer emission for internal providers** (see §4), driven by **declarative per-operation event metadata** — not scattered `.emit()` calls. External providers emit at their executor. **⚠️ RC1 (SA):** declarative-on-the-repo only covers writes that *reach* the repo — pair with the §4 bypass remediation + a static "no `.from('<migrated_table>')` write outside the repo" assertion. | Internal coverage *once bypasses are remediated* + external-readiness. Declarative metadata honors the no-hardcoding principle. |
| C5 | **Dedupe store** | A dedicated **`processed_reactions`** table keyed by `(event_id, rule_id)` (or the reaction's `dedupe_key`). The runner checks-and-inserts before executing a non-idempotent reaction. | Cleaner and more explicit than overloading `hasRecentEvent()`; gives exactly-once *effect* on top of at-least-once *delivery*. |

---

## 4. The emission-point decision (the crux)

**The design locks emission at the plugin-executor layer** (design §3.1/§4.1) — correct for *external* providers, whose data never lands in local tables, so only their executor can announce. **But that under-specifies the internal reality this migration must handle:**

> A DB trigger fires on **any** write to its table, from **any** code path. The plugin *executor*, however, is only **one** of several internal write paths. Today bookings are created by `app/api/scheduling/bookings/route.ts`, payments by `app/api/payments/blocks/execute/route.ts`, chat writes by `ChatCommandExecutor`/`SafeExecutionLayer`, plus the plugin executors — **all of them writing through repositories.** Emitting only at the plugin executor would **miss most real writes**, so the event-backed rule would silently not fire where the trigger used to. That breaks parity.

**Proposed resolution — emit at the repository layer for internal providers:**

- The repository is now the **single internal write chokepoint** (the just-completed conformance work). A repo's state-changing methods (`create`, `markAsPaid`, `complete`, `delete`, …) are the exact app-level analog of the DB trigger's universal firing point — but provider-agnostic and external-ready.
- Emission is driven by **declarative metadata**, not hand-written `.emit()` calls: a small map (or per-repo declaration) of `repo.method → event_type + field mapping`. This keeps it no-hardcoding-friendly and centrally reviewable.
- **External providers** still emit at their executor (they have no local repo) — so the rule "emit `booking.created`" is satisfied by *the internal booking repo* OR *the external scheduling plugin's executor*, never both. Emission attaches at **"the provider's write boundary"**: repository for internal, executor for external.
- The internal plugin executor **delegates to the repo** (established guardrail), so repo-layer emission transitively covers the internal-executor path too — **no double emission**.

**SA verdict (2026-08-13): RATIFIED-WITH-CHANGES.** The repo-layer-emission *model* is endorsed as a **legitimate refinement** of the locked executor-only decision (not a contradiction) — the repo is the right app-level analog of the trigger's universal firing point, and "emit at the provider's write boundary" (repo for internal, executor for external) is sound. **The change is coverage, not model.**

**RC1 — coverage is a remediation prerequisite, not a verification step.** The premise "every internal write reaches the repo" is **false today** for the T1–T9 entities (§2.4: the `booking/finalize` route + payment-block + chat raw writes bypass both executor and repo). The failure mode this creates is **zero-fire** — the reaction silently never runs — which the no-double-fire xor discipline (§9) does **not** protect against. Therefore:

1. **Phase 0 remediates the bypasses** (§6): route every raw write to a T1–T9 source table through the emitting repo — *or* place the emission hook at a shared data-access seam the finalize route also crosses. This is a continuation of the repository-conformance work, scoped to exactly the migrated tables.
2. **Add a static assertion** (lint/test): **no `.from('<migrated_table>')` write exists outside `lib/repositories/`** — so a new bypass can't silently reintroduce zero-fire.
3. Per-trigger cutover step 1 (§7) changes from *"verify all callers go through the repo"* to *"confirm the bypass remediation for this entity has landed"* — a gate, not a hope.

This is the **#1 correctness risk** of the migration (§12 R1). Emission coverage (RC1) and the emit sad-path (RC2) together are what make "the reaction fires exactly when the trigger would have" actually true.

---

## 5. Components to build

| Component | What it is | Notes |
|---|---|---|
| **Emission hook** | A function repos call on state-changing methods → normalizes + `businessEventService.emit()`. Driven by declarative `method→event` metadata. | §4. Start with the CRM/scheduling/payment repos touched by T1–T9. |
| **Taxonomy additions** | Add `task.completed`, `document.uploaded`, `contact.deleted` to `BusinessEventType` + `EVENT_TYPE_TO_CATEGORY`. **RC5:** also add `task` + `document` to `BusinessEntityType` (missing today), and audit `SourceCapability` coverage. | Needed for T6/T7/T9 — event type alone is insufficient. |
| **Reaction-op catalog + resolution** (RC3) | Audit that every reaction is a real **plugin operation** (`crm.log_activity`, `crm.find_or_create_contact`, `payments.mark_invoice_paid`, `scheduling.cancel_future_bookings`); build any missing; specify the **interim single-provider capability→plugin resolution** so Phase-1 reactions execute *as ops via `PluginExecuterV2.execute`* (per locked §3.7), not by calling repos directly. | Config-driven selection (R7) is Phase 4, but Phase-1 reactions still need to resolve to *some* executor op today. |
| **`event_reactions` queue table** | Durable queue rows: `event_id`, `rule_id`, `lane`, `status` (pending/running/done/failed), `attempts`, `next_attempt_at`, `dedupe_key`, timestamps. RLS by `user_id`. | The DB-backed queue (C1). One row per matched rule per event. |
| **`processed_reactions` table** | Exactly-once guard for non-idempotent reactions, keyed `(event_id, rule_id)`. | C5. |
| **`SYSTEM_RULES` registry** | Code-defined array: `{ when: event_type, if?: conditions, do: {capability, operation, params_from_event}, lane, idempotent|dedupe_key, guardrails }`. | C3. Seeded per-trigger during cutover. |
| **Distributor** | Given a new event: load matching rules (system + later user), evaluate conditions, insert `event_reactions` rows in the right lane. | Runs inline after emit (fast) and/or in the sweep. |
| **Fast-lane runner** | Drains an event's fast `event_reactions` inline after emit; each reaction = `PluginExecuterV2.execute(...)`. | §8. |
| **Delayed-lane runner** | Cron-drained (reuse insight crons) fast-forwarding pending delayed reactions. | §8. |
| **Safety-net sweep** | A frequent cron that reprocesses any `pending`/`failed` reaction (fast or delayed) whose inline kick was missed. | Makes durability worker-model-independent (design §6). |
| **Reaction executor** | Maps an `event_reactions` row → resolves the capability's current plugin → `execute(op, params_from_event)`; records success/failure/attempts; honors dedupe. | Provider-agnostic; idempotent (§9). |
| **Observability** | Event volume, reaction lag, failure/retry counts, parity counters during cutover. | §11. |

### 5.1 Rule-engine mechanics (Q4)

The engine is a **small matcher over two rule sources** — the care is in *safety*, especially for user-authored rules. The existing `payment_automation_rules` + `TriggerCondition[]` + `buildActionParameters` + `evaluateCondition` is already a working prototype of this exact shape — **generalize it, don't reinvent.**

- **Two sources, one matcher.** **System rules** = typed `SYSTEM_RULES` in **code** (versioned, tested, reference real operation constants, may run typed guard *functions*). **User rules** = RLS-scoped **table rows** (JSONB conditions/params). The distributor matches both identically: match `when` on `event_type` → evaluate `if` on the event payload → enqueue a reaction with mapped params + lane.
- **Condition eval — closed operator set, never `eval()`.** Reuse the existing `evaluateCondition` shape (typed switch over `eq/neq/gt/gte/lt/lte/in/contains` on a dotpath), extended with and/or grouping + null/exists. For nested boolean logic adopt **JSONLogic** (serializable, sandboxed, closed operators). **Never** a JS-expression evaluator (CEL/JSONata/handlebars-with-helpers) — an injection surface for no-code authors.
- **One param-mapping syntax, validated.** Collapse `buildActionParameters`' current three syntaxes (`{{path}}`, `$entity_id`, passthrough) into **one** declarative form. **Validate mapped params against the target operation's Zod input schema** at author-time and execute-time; a missing/invalid mapping **fails closed → dead-letter**, never dispatches garbage to a plugin op.
- **Capability/operation allowlist for user rules (security).** User rules may target only a **whitelist of `(capability, operation)` pairs** — never a destructive/internal op (`scheduling.cancel_future_bookings`, anything that charges/refunds). System rules (code) may reference the full op set. This is a hard authorization boundary, not a convention.
- **Guardrails enforced at the runner choke point, not the distributor.** `max_per_entity` / `cooldown` / dedupe are checked *where the reaction executes* (claim/execute time), so **no path** (retry, delayed drain, manual drain) can bypass them — this is exactly the bug the current `processScheduledExecutions` has (it calls the action path directly and skips its own guardrails). Add a **per-user fan-out cap + token-bucket rate limit + circuit breaker** (auto-disable a rule after N consecutive failures or a rate breach) so one misconfigured rule on a high-frequency event (e.g. "every payment") can't flood the queue.
- **Versioning, audit, test gate.** Each `SYSTEM_RULE` has a stable `id` + `version`; stamp `rule_version` onto the `event_reactions` it produces (audit/replay + the cross-deploy concern, §5.2). User-rule create/update/enable/delete → `AuditTrailService` (a rule that auto-charges customers is a high-severity change). **Golden parity tests** are a gate: each system rule must reproduce its retired trigger's exact output.

### 5.2 Event payload — carried state (Q2)

Make the event **self-sufficient for its reactions**, but decide **per field, not per event**:

- **Always snapshot** the immutable identifying facts: `entity_id`, `user_id`, `event_type`, `occurred_at`.
- **Snapshot mutable decision-inputs** when the reaction means *"react to what was true at emit time"* (e.g. the amount paid). This is what makes the reaction (a) not race a later edit to the source row, (b) still work if the source row is deleted before a **delayed** reaction runs, (c) decoupled from our local schema (external-readiness — the reaction shouldn't have to read our tables).
- **Carry only the id (re-read) when the reaction wants *current* truth** — especially long-delayed reactions (a digest 24h later wants the invoice's *current* status; a stale snapshot there is a **correctness bug**, not just staleness). `params_from_event` declares, per rule, which fields are snapshot vs re-read.
- **Scope:** enumerated scalar fields only — never whole rows, arrays, or blobs (reference those).
- **`schema_version` on the payload (mandatory).** Reactions sit in `event_reactions` **across deploys**; a deploy that changes a `params_from_event` path or a reaction op's signature can strand/misprocess queued rows. Stamp a `schema_version`; runners tolerate N and N-1 (§12 R9).
- **PII / right-to-erasure (compliance gap).** Snapshotting `client_email`/`client_name` duplicates PII into an append-only, **service-role (RLS-bypassing)** log that GDPR/CCPA deletion must now reach — and `contact.deleted`/account erasure must **scrub or tombstone** historical event metadata. For sensitive fields, prefer a **reference the reaction re-reads** over the value. **Never `logger.info({ metadata })`** — log ids/keys, not values. (§12 R12.)

---

## 6. Migration phases

**Phase 0 — Scaffolding + the three High prerequisites (dark, no behavior change).**
Build the emission hook (§4), `event_reactions` + `processed_reactions` tables, the distributor, both lane runners, the safety-net sweep, and an empty `SYSTEM_RULES` registry. Wire emission on the CRM/scheduling/payment repos so `business_events` **starts populating** — but with **no rules active**, so nothing reacts. Verify: events land; the Insight read side (metrics/detectors) begins seeing real data (a free early payoff); no double behavior because no rules fire.

Phase 0 **must also close the three SA-High items before any cutover** — they are prerequisites, not fast-follows:
- **RC1 — bypass remediation.** Inventory every write path to each T1–T9 source table; route the raw-write bypasses (`booking/finalize`, payment-block raw updates, chat raw writes) through the emitting repo (or a shared seam); add the static "no `.from('<migrated_table>')` outside repos" assertion. **Per-entity, this must land before that entity's trigger is dropped.**
- **RC2 — emit-durability net.** Make `emit()` failures non-silent (retry) and add the reconciliation sweep (source-row-without-event detector + back-emit), so at-least-once is real.
- **RC3 — reaction-op catalog + resolution.** Confirm/build the reaction plugin ops and the interim single-provider capability→plugin resolution.

**Phase 1 — CRM-first cutover (per-trigger, no-double-fire).**
For each CRM-adjacent trigger, one at a time, do the §7 playbook: confirm the driving event emits on all write paths → add the system rule → verify parity → **drop the trigger in the same change**. Recommended order (lowest-risk first): **T8** (contact_created, pure logging, self-contained) → **T2** (booking→activity) → **T3/T5/T6/T7** (activity logging) → **T4** (invoice-paid state-flip) → **T1** (booking→contact, the fan-in) → **T9** (contact-delete cascade, most destructive, last).

> ⚠️ **Retire the legacy queue-drains as a cutover step — not just "don't copy them" (SA).** Two existing drains already implement a naïve select-then-process queue with real bugs (§12 R8): `PaymentReminderService.processDueReminders` (double-sends under overlap) and `PaymentAutomationEngine.processScheduledExecutions` (unbounded re-execution — its success path never leaves `scheduled`; also bypasses its own guardrails). They are **latent today only because their crons aren't scheduled** in `vercel.json`. **Two consequences:** (1) the payment follow-ups **`task_65f25a21`** (wire the reminder cron) and **`task_39e0280d`** (automation engine) must adopt the claim+lease+`processed_reactions` discipline from §8.1 **before** scheduling those crons — wiring them naïvely activates the bugs; and (2) if any of their behaviors migrate to this engine while the old drain is later scheduled, you get **double fires across two engines** — so retiring/disabling the old drain must be part of that behavior's cutover, not a fast-follow.

**Phase 2 — Event-log convergence (as capabilities migrate).**
Per the design §7: make `business_events` the system-of-record; write `crm_activities` as the **projection** produced by the `crm.log_activity` delayed reaction (not an independent source, honoring the §9 single-writer invariant); fold `payment_events` into `business_events` cash-flow types. Do this **as** each capability cuts over, not big-bang. **RC6:** note the pre-existing dual log — `scheduling/bookings` already emits `invoice.created` via the *old* `PaymentEventService` (`payment_events`), not `business_events`. Convergence must reconcile these so a single write doesn't drive reactions from two logs.

**Phase 3 — User-authored rules.**
Generalize `payment_automation_rules`/`insight_automations` into the user-rules table + a management surface; the distributor already reads them. (Overlaps the dormant-automation-engine follow-up `task_39e0280d`.)

**Phase 4 — External-provider readiness (future).**
When a first external provider is scoped: its executor emits the same events; config-driven capability selection (R7) routes reactions to the tenant's chosen provider. No rule changes.

---

## 7. Per-trigger cutover playbook (T1–T9)

Every trigger follows the same 6 steps (this is the core discipline):

1. **Emit the driving event on every write path — a remediation GATE (RC1), not a check.** Add the emission metadata on the repo method(s) that create the source row, **and confirm the Phase-0 bypass remediation for this entity has landed** (every raw `.from()` write to its table now goes through the emitting repo; the static assertion passes). If a bypass remains, the trigger **cannot** be dropped yet — dropping it would zero-fire that path. Add any missing taxonomy type/entity-type.
2. **Author the system rule** — `WHEN <event> → DO <capability.operation> in <lane>`, with the trigger's conditions reproduced as `if`/guardrails (e.g. T1's `payment_status != 'pending'`; T2/T3's `contact_id present`).
3. **Confirm the reaction op exists and is idempotent** — e.g. `crm.log_activity`, `payments.mark_invoice_paid`, `scheduling.cancel_future_bookings`. Add a dedupe key for non-idempotent ones.
4. **Shadow-verify parity (dark)** — with the rule active but the trigger *still on*, temporarily route the reaction to a **no-op/comparison** mode (or a separate shadow table) and assert the event-backed reaction would produce the identical row(s) the trigger produces. (Optional but recommended for the risky ones: T1, T4, T9.)
5. **Cut over atomically** — in **one change**: activate the rule for real **and** drop the DB trigger (migration `DROP TRIGGER … ; DROP FUNCTION …`). Never both live.
6. **Verify post-cutover** — parity (same `crm_activities`/invoice/booking outcomes), no double rows, reaction lag acceptable, retries clean.

Per-trigger specifics (event, reaction, lane, condition to preserve):

| # | Driving event | Reaction op | Lane | Condition/guardrail to preserve |
|---|---|---|---|---|
| T8 | `contact.created` | `crm.log_activity` (contact_created) | Delayed | none (start here — simplest) |
| T2 | `booking.created` / status | `crm.log_activity` | Delayed (fast-eligible) | only if `contact_id` present |
| T3 | `payment.completed` | `crm.log_activity` | Delayed | only if `contact_id` present |
| T5 | `email.sent` | `crm.log_activity` | Delayed | — |
| T6 | `task.completed` (new type) | `crm.log_activity` | Delayed | — (also keep `set_task_completed_at` as a maintenance trigger or move into the task repo) |
| T7 | `document.uploaded` (new type) | `crm.log_activity` | Delayed | — |
| T4 | `payment.completed` | `payments.mark_invoice_paid` | **Fast** | only if `invoice_id` present; set-status idempotent |
| T1 | `booking.created` | `crm.find_or_create_contact` (+link) | **Fast** | skip when `payment_status='pending'` (T1's `20260728` redefinition) |
| T9 | `contact.deleted` (new type) | `scheduling.cancel_future_bookings` | **Fast** | cancel-idempotent (already-cancelled = no-op) |

> **T1 nuance (two real paths — RC4/SA).** T1 has **two** live paths, and §7's row above covers only the first:
> 1. **Free/immediate bookings** — the trigger creates+links the contact on `booking INSERT`.
> 2. **Paid bookings** — the trigger *skips* (its `20260728` redefinition skips `payment_status='pending'`); the contact is created **later, in the `booking/finalize` route by raw app code** (the RC1 bypass). So the paid path already isn't trigger-driven — it must be routed through the repo and made event-source-able as part of the cutover.
> The event-backed reaction: `find_or_create_contact` returns the contact id, then a second idempotent step links it via the scheduling repo. Do T1 **after** the pure-logging cutovers.
>
> **⚠️ RC4 — inter-reaction causal ordering (T1 → T2).** T2's guardrail is "only if `contact_id` present," and **T1 is what sets it.** Today trigger order is deterministic within the booking transaction; the queue model is **not** — T1 (fast) and T2 (delayed) both key off `booking.created` across two lanes with no ordering guarantee, so T2 can observe a not-yet-linked booking and skip, **changing behavior**. Resolve before cutting over T1/T2: e.g. T2 keys off a **`booking.contact_linked`** event emitted by T1's link step (not off `booking.created`), or the T2 reaction re-reads and re-evaluates the booking's current `contact_id`. This ordering dependency must be in the risk register and the T1/T2 playbook.

---

## 8. Serverless execution model, runner coordination & concurrency

| Lane | Trigger to run | Mechanism |
|---|---|---|
| **Fast** | Right after an emit that has fast rules | **Inline drain** in the same request/invocation: after `businessEventService.emit(...)`, the distributor inserts fast `event_reactions` and immediately runs them (bounded, e.g. ≤N reactions; overflow left for the sweep). |
| **Fast (safety net)** | Every 1–2 min | A **sweep cron** reprocesses any `pending`/`failed` fast reaction whose inline kick was missed (cold start, crash, overflow). |
| **Delayed** | Existing insight crons | The delayed `event_reactions` are drained by the `insight-*` crons (5–15 min cadence). Reuse, don't add. |

Durability is worker-model-independent: every reaction is a persisted `event_reactions` row with a status, so a missed inline kick is always recoverable by the sweep (design §6). The inline kick is an *optimization* for latency, not the correctness boundary.

> **RC7 — make the persist-before-attempt ordering explicit.** The inline drain runs in the same invocation as the write, so a fast reaction's latency/failure is coupled to the originating request. Guarantee the order: **(1) persist the `event_reactions` rows as `pending` → (2) attempt the bounded inline drain → (3) return the response.** Anything the inline drain doesn't finish is already `pending` on the log, so the sweep always recovers it — never lose a reaction to the request ending.
> **Queue-table role model.** `BusinessEventService`, the inline kick, and the cron drains all run on `supabaseServer` (**service role, RLS-bypassing**). `event_reactions`/`processed_reactions` are `user_id`-scoped, but RLS won't protect service-role queries — so every runner query must carry the same explicit `.eq('user_id', event.user_id)` discipline the repositories use, and each reaction executes scoped to its event's `user_id`.

**Optimistic UI (design §3.5, locked):** for the fast-lane cases where the user might perceive the beat of latency (contact appears on the booking, invoice flips to paid), the client shows the expected outcome immediately and reconciles when the reaction completes. Identify those surfaces during the T1/T4 cutovers.

### 8.1 Runner coordination & concurrency (Q1)

Many runners drain `event_reactions` in parallel (multiple cron invocations, the inline kick, the manual drain). The **queue table itself is the coordination point** — no separate runner registry, no external broker:

- **Atomic claim via `SELECT … FOR UPDATE SKIP LOCKED`, batched, in an RPC.** A runner claims a **bounded batch** of `pending` rows (`LIMIT n … FOR UPDATE SKIP LOCKED`), flips them to `running` with `claimed_by`/`claimed_at`, and `RETURNING *` — **one round-trip**. `SKIP LOCKED` means two runners never grab the same row *and never block* each other (locked rows are skipped). The Supabase JS client can't express this, so the claim is a **Postgres function (RPC)**. Add a **partial index on `status='pending'`** (optionally per lane) — the claim is the hot path.
- **Lease = provably-dead, not guessed (the serverless gift).** Set the reaper's **lease > Vercel `maxDuration` + margin**. A function that overruns `maxDuration` is *killed*, so any row still `running` past the lease is **provably dead**, not slow — the reaper (the safety-net sweep) reclaims it to `pending` and **increments `attempts`** so a runner-crashing "poison" row eventually dead-letters instead of looping. This makes the reaper safe *by construction*, not by tuning.
- **Poison messages → dead-letter.** `attempts ≥ max_attempts` → terminal `failed` (visible for manual replay); `next_attempt_at` uses exponential backoff.
- **MVCC is isolation, not the correctness boundary.** MVCC gives clean insert/read isolation (a runner only sees committed rows; a just-inserted row is claimed on the next poll — no torn reads). But delivery is **at-least-once**, so the real correctness boundary is **idempotency + `processed_reactions`** (§9), not isolation. Keep the framing straight.
- **Tracking = the table.** "Who is doing what" is answered by `status` + `claimed_by`/`claimed_at`/`attempts` on each row; observability watches rows stuck in `running` (§11).

### 8.2 Trigger-source options & the retired in-process bus (Q3)

- **Keep the lanes' triggers separate.** **Fast-lane latency = the inline kick** (dispatch in the same invocation as the write); a cron *cannot* serve the fast lane (its floor is the cron cadence, and Vercel crons drift and overlap). The **heartbeat cron serves the delayed lane + the safety-net sweep only.**
- **Retire the in-process bus — do not extend it.** `PaymentAutomationEngine.start()` + `BusinessEventService.subscribe()` is an in-process `EventEmitter` that only works while a warm lambda lives and **silently drops events on cold start** — the app-startup/persistent-process model, already broken on Vercel. Durability comes from persisted `event_reactions` rows, never `subscribe()`. **App-startup triggering does not fit serverless.**
- **Configurable cadence = one heartbeat + per-rule due-logic, not many crons.** `vercel.json` crons are static and capped (we're on **Pro**: 8 crons today, `*/5`+`*/15`; Pro crons are best-effort — they drift/overlap, which is *why* §8.1's claim/lease is non-negotiable). Per-rule cadence lives in the **row** (`scheduled_at`/`next_attempt_at`/`delay_minutes` — the existing `insight_automations` pattern); the heartbeat just asks "what's due now?" Plus a **manual "drain now" admin endpoint** (reusing the same claim path, so it can't double-process against a concurrent cron).
- **Better heartbeat option (Supabase-native): `pg_cron` + `pg_net`.** Runs *in the database* — second-granularity, no HTTP scheduling drift — a strictly better delayed-lane/sweep driver than Vercel cron; worth evaluating in Phase 0.
- **Escape hatch if the fast lane outgrows the inline kick:** a **push queue** (Upstash QStash / SQS+lambda) that invokes a handler on enqueue — near-real-time, no persistent process (design C1 already leaves this open). **Keep the reaction executor's trigger source (inline / cron / push) swappable** so this is a config change, not a rewrite. A true always-on worker is only justified for guaranteed sub-second reactions decoupled from any request — not v1.

---

## 9. No-double-fire + idempotency discipline

- **Two distinct failure modes (SA):** the xor discipline prevents **double-fire** (duplication); it does **not** prevent **zero-fire** (silent omission when the event never emits on a bypassed path). Both must be defended: **xor** guards duplication, **RC1 emission coverage** guards omission. A cutover is only safe when *both* hold for that side-effect.
- **No-double-fire:** a side-effect is trigger-backed **xor** event-backed at every instant. The cutover change (§7 step 5) adds the rule and drops the trigger together. Any capability not yet cut over keeps its trigger and its executors keep **not** re-implementing side-effects (the existing v1 guardrail) — so nothing double-fires mid-migration.
- **`crm_activities` single-writer invariant (convergence, RC/Q5):** during Phase-2 convergence, for any capability mid-cutover `crm_activities` must have **exactly one writer** — the trigger **or** the `crm.log_activity` reaction — at every instant, mirroring the trigger xor rule. Otherwise the human timeline double-writes while the log becomes system-of-record.
- **Ordering — chain events, don't order the queue (design principle, Q1).** `SKIP LOCKED` gives **zero** ordering; two same-entity reactions can run out of order on different workers. **Do not try to order the queue** — it fights the whole model. Encode causal dependencies as **event chaining**: a dependent reaction keys off an event *emitted by the step it depends on*, not off a shared upstream event. Canonical case (RC4): **T2 keys off `booking.contact_linked` emitted by T1's link step**, not off `booking.created`. This generalizes to every future multi-step chain. Only for genuinely serial per-entity chains that can't be event-chained, use a **per-entity advisory lock** (`pg_advisory_xact_lock(hashtext(entity_id))`) so same-entity reactions serialize while different entities stay fully parallel.
- **Idempotency (mandatory):** reactions retry, so each must be safe twice. Prefer naturally-idempotent ops (`find_or_create`, `set status=paid`, `cancel` = no-op if already cancelled). Non-idempotent reactions (send email, charge) carry a `dedupe_key = f(event.id, rule.id)` and the runner check-inserts into `processed_reactions` before executing.
- **Emission-side idempotency:** if a repo write is retried (at-least-once emit), the same logical event could be emitted twice — dedupe events on a natural key (`source_entity_id` + `event_type` + a window) or an emit-side idempotency key, so the distributor doesn't fan out duplicates.

---

## 10. Testing, parity, and rollback

- **Parity harness:** for each trigger, a test that performs the source write and asserts the produced `crm_activities`/invoice/booking rows are identical whether trigger-backed or event-backed (run against both, diff). The `/test-business-os` page is the natural manual surface.
- **Unit:** distributor rule-matching; reaction param-mapping from event metadata; dedupe/idempotency; lane routing.
- **Cutover safety:** each trigger cutover is its own small change — **individually revertible**. Rollback = re-create the dropped trigger (keep the exact `CREATE FUNCTION/TRIGGER` DDL in the down-migration) and deactivate the system rule. Because it's one side-effect at a time, blast radius per step is one behavior.
- **Shadow mode** (recommended for T1/T4/T9): run the reaction into a comparison path while the trigger is still authoritative, diff for a period, then cut over.

---

## 11. Observability & operations

- **Metrics:** events emitted/min by type; `event_reactions` depth per lane; reaction latency (emit→done); failure & retry counts; dead-letter (max-attempts) count.
- **Dead-letter handling:** a reaction that exhausts attempts moves to a `failed` terminal state visible for manual replay — never silently dropped (the event stays on the log).
- **Cutover dashboards:** during each phase, a parity counter (trigger-produced vs reaction-produced rows) and a "double-fire = 0" assertion.
- **Concurrency health (Q1):** rows stuck in `running` beyond lease (reaper activity); a **"reaped a still-live worker" counter — the double-execution canary** (should be ~0 if lease > `maxDuration`; nonzero = mis-tuned lease, §12 R11); per-user reaction fan-out rate (poison-rule / storm detection, R10).
- **Backfill:** Phase 0 populates `business_events` going forward only; decide whether any historical backfill is needed for the Insight read side (likely not — detectors are forward-looking).

---

## 12. Risks & open questions

| # | Risk / question | Mitigation / owner |
|---|---|---|
| R1 | **Emission coverage — zero-fire (the crux, §4; SA-confirmed HIGH).** Raw-write bypasses (`booking/finalize`, payment-block, chat) reach T1–T9 tables without the repo, so a dropped trigger would silently stop firing there. | **Prerequisite, not a check:** Phase-0 RC1 remediation (route bypasses through the repo) + static "no `.from(migrated_table)` outside repos" assertion; per-trigger step 1 is a gate. |
| R1b | **Emit sad-path — at-most-once (RC2, HIGH).** `emit()` errors are swallowed today; write-commits-but-emit-fails loses the event → reaction never runs. | Retry emit + reconciliation sweep (source-row-without-event → back-emit). Phase-0 prerequisite. |
| R1c | **Reaction op / capability resolution (RC3, HIGH).** Reactions must run as plugin ops via `PluginExecuterV2`, but the op catalog is unverified and there's no capability→plugin registry (R7 is Phase 4). | Phase-0 op-catalog audit + build; interim single-provider resolution so Phase-1 reactions execute as ops. |
| R1d | **Inter-reaction causal ordering (RC4, MED).** T1(fast)→T2(delayed) both key off `booking.created`; T2 needs the `contact_id` T1 sets; queues give no ordering. | T2 keys off a `booking.contact_linked` event (or re-evaluates); specify in the T1/T2 cutover. |
| R2 | **Latency perception on fast lane** (contact/invoice appears a beat late). | Optimistic UI on the identified surfaces (§8); inline kick keeps it sub-second in the happy path. |
| R3 | **At-least-once double effects.** | Mandatory idempotency + `processed_reactions` dedupe (§9). |
| R4 | **T1 fan-in complexity** (create contact + link booking atomically today). | Do T1 last in Phase 1; 2-step idempotent reaction; shadow-verify. |
| R5 | **`crm_activities` as projection vs source** during convergence. | Convert per-capability *as* it migrates (design §7), never mid-capability. |
| R6 | **Dormant payment automation engine overlap.** | Phase 3 (user rules) subsumes/replaces it — coordinate with `task_39e0280d`. |
| R7 | **When is this even needed?** The whole migration is only *required* when the first external provider arrives (design §9). | Sequence deliberately: Phase 0 has standalone value (lights up Insights); Phases 1–2 can be paced; hold Phase 4 until an external provider is scoped. |
| R8 | **Legacy queue-drains — latent bugs + double-engine (SA, HIGH).** `processDueReminders` double-sends under overlap; `processScheduledExecutions` re-executes unboundedly + bypasses its guardrails. Latent only because their crons aren't scheduled. Wiring them naïvely (`task_65f25a21`/`task_39e0280d`) activates the bugs; migrating their behavior while they run double-fires across two engines. | Adopt §8.1 claim+lease+dedupe in those tasks **before** scheduling; retire/disable the old drain as part of each migrated behavior's cutover (§6). Consider fixing the live re-execution bug independently, now. |
| R9 | **In-flight reactions across deploys (MED).** Rows sit in `event_reactions` across a deploy; a changed `params_from_event` path or reaction-op signature can strand/misprocess them. | `schema_version` on the payload (§5.2) + N/N-1-tolerant runners. |
| R10 | **Fan-out storm / poison rule (MED).** One misconfigured rule on a high-frequency event (e.g. every payment) floods the queue. | Per-user fan-out cap + token-bucket rate limit + circuit breaker (auto-disable after N failures / rate breach) at the runner choke point (§5.1). |
| R11 | **Reaper mis-tune → double-execution (LOW, canary).** If the lease ≤ `maxDuration`, the reaper can reclaim a still-live worker's row and run it twice. | Set lease > `maxDuration` + margin (§8.1); the "reaped-a-live-worker" counter (§11) must stay ~0. |
| R12 | **PII / right-to-erasure on the event log (SA, compliance).** Event-carried snapshots duplicate contact PII into an append-only, RLS-bypassing log that GDPR/CCPA deletion must reach; no retention/scrub story exists. | Reference-not-value for sensitive fields; `contact.deleted`/account-erasure scrubs or tombstones event metadata; retention policy; never log metadata values (§5.2). Add to the compliance register. |

---

## 13. Milestones

1. **M0 — Ratify** the §3 resolutions + the §4 emission-point decision. *Blocking.* SA ratified-with-changes (§15, RC1–RC7 folded in above); **re-submit the revised §3/§4 for SA sign-off after user review.**
2. **M1 — Phase 0 scaffolding + the 3 High prerequisites** — the event backbone/queue/distributor/runners **plus RC1 bypass remediation, RC2 emit-durability net, and RC3 op-catalog+resolution**; `business_events` populating; Insights read side sees real data; zero rules active. (No trigger may be cut over until RC1 is landed for its entity.)
3. **M2 — First cutover (T8)** — proves the end-to-end loop on the simplest trigger.
4. **M3 — CRM activity-logging cluster** (T2/T3/T5/T6/T7) cut over.
5. **M4 — State-flip + fan-in** (T4, T1) cut over with optimistic UI.
6. **M5 — T9** (destructive cascade) cut over; all 9 triggers retired.
7. **M6 — Convergence** (`business_events` system-of-record; `crm_activities` projection).
8. **M7 — User rules** (Phase 3), when demanded.

---

## 14. Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-08-12 | Created (v0.1 draft) | First-pass migration/implementation plan companion to the locked event-driven design. Grounded the 9 side-effect triggers (T1–T9, file:line) vs the maintenance triggers that stay; proposed resolutions for the design's 5 deferred implementation choices (DB-backed queue, at-least-once post-write emit, hybrid rules storage, declarative repo-layer emission, dedicated dedupe table); surfaced the **emission-point crux** (repo-layer emission as the universal internal chokepoint enabled by the just-completed repository-conformance work, reconciled with the design's executor-layer external-readiness); defined components, a 5-phase incremental no-double-fire sequence (CRM-first, T8→…→T9), the per-trigger cutover playbook, the Vercel fast(inline+sweep)/delayed(insight-crons) execution model, idempotency discipline, parity/rollback, observability, risks, and milestones. **Draft for review — §3/§4 recommendations need SA/user ratification.** |
| 2026-08-13 | SA ratification appended (§15) | Overall verdict RATIFY-WITH-CHANGES. Grounded §4 against code; found the "repos are the single internal chokepoint" premise materially incomplete (finalize route + payment-block raw writes bypass both executor and repo for T1–T9 entities). Per-decision table (C1–C5 + §4). Flagged emit-durability gap (C2), reaction-op/capability-resolution gap, inter-reaction causal ordering (T1→T2), and taxonomy entity-type gap. |
| 2026-08-14 | v0.3 — deep-design feedback folded in | Folded SA's answers to four user design questions: **§8.1 runner coordination** (batched `FOR UPDATE SKIP LOCKED` claim in an RPC, lease > `maxDuration` = provably-dead reaper, partial index, dead-letter, MVCC-is-isolation-not-correctness); **§9 ordering-by-event-chaining** principle (T2 keys off `booking.contact_linked`) + per-entity advisory lock; **§5.2 event-carried state** (per-field snapshot-vs-reread, `schema_version`, PII/erasure); **§8.2 trigger sources** (retire the in-process `subscribe()` bus, heartbeat-cron + per-rule due-logic, `pg_cron`/`pg_net` option, push-queue escape hatch); **§5.1 rule-engine mechanics** (typed system rules + table user rules, closed-operator/JSONLogic eval never `eval()`, capability-op allowlist for user rules, guardrails at the runner choke point, fan-out cap/circuit breaker, versioning/audit/golden-parity tests). Added §6 legacy-drain retirement dependency (ties to `task_65f25a21`/`task_39e0280d`); risk register R8–R12 (legacy-drain double-engine, cross-deploy in-flight, fan-out storm, reaper mis-tune, PII/erasure); §11 concurrency-health metrics. |
| 2026-08-13 | v0.2 — RC1–RC7 folded into body | Reframed §4 emission coverage from a verify-step to a **Phase-0 remediation prerequisite** (RC1) with the `booking/finalize` bypass as the concrete counterexample + a static no-`.from()`-outside-repos assertion; added the **emit-durability net** (RC2) and **reaction-op catalog + interim capability→plugin resolution** (RC3) as Phase-0 High prerequisites; distinguished **zero-fire vs double-fire** and added the `crm_activities` single-writer convergence invariant (§9); added **T1 two-path** handling + **T1→T2 causal ordering** (RC4) to §7; added `task`/`document` **entity-type** additions (RC5), the **dual event log** reconciliation (RC6), and the **queue-table service-role scoping + persist-before-attempt ordering** (RC7). Risk register upgraded (R1/R1b/R1c/R1d). **Next: user review → re-submit revised §3/§4 for SA sign-off (M0 blocking).** |

---

## 15. SA Ratification (2026-08-13)

**Reviewed by SA.** Grounded against the 9 trigger migrations (T1/T1-redef, T2, T3, T4 spot-checked — descriptions in §2.1 are accurate), `BusinessEventService`/`types.ts`, `business_events` migration, and the real write paths behind §4 (`scheduling/bookings`, `payments/blocks/execute`, `website/booking/finalize`, `ChatCommandExecutor`, `SafeExecutionLayer`, `PaymentRepository`, `stripe/webhook`).

### Overall verdict: 🔄 **RATIFY-WITH-CHANGES**

The plan is architecturally faithful to the locked design, the CRM-first / T8→…→T9 sequence is the right risk order, the serverless model is sound, and the emission-point refinement is a **legitimate** refinement of the locked design (not a contradiction). **But it ships on one false premise that is the whole load-bearing assumption of §4:** that "nearly every internal write now goes through a repository," so repo-layer emission is a universal internal chokepoint. **That premise is materially incomplete for exactly the T1–T9 source entities.** At least one production path and several scattered raw writes bypass **both** the executor and the repository:

- **`app/api/website/booking/finalize/route.ts`** (the paid-booking confirmation flow — arguably *the* most important cross-capability chain) writes `crm_contacts` (INSERT/UPDATE), `payment_transactions` (`status='succeeded'` INSERT), and `scheduling_bookings` (UPDATE to `confirmed` + `contact_id`) **all via raw `supabaseServer.from()`**, and its own comment (lines 244–246) documents that it *deliberately relies on trigger T2 to fire* on the booking update. This single route is a live dependency on T2, T3, T4, and T8. Repo-layer emission would **not** observe any of these writes.
- **`app/api/payments/blocks/execute/route.ts`** `schedule_retry`/`cancel_retry` do raw `supabaseServer.from('payment_invoices').update(...)` (lines ~732, ~793) — outside the repo. (These don't drive T4 today, but they prove raw writes to a migrated table exist in the conformant codebase.)
- **`ChatCommandExecutor`** mixes repo calls with raw `supabaseServer.from(...)` writes.

**Consequence:** if T2/T3/T4/T8 are cut over to event-backed and their triggers dropped while emission lives only at the repo, the paid-booking finalize flow **silently stops** logging activities and flipping invoices — a parity break in the highest-value path. The plan already names this as R1 and as step 1 of the per-trigger playbook, **but understates it**: step 1 says "verify *all* callers go through that repo (they do, post-conformance — but verify)." The verification will **fail** for these paths. This must be upgraded from an assumption-to-confirm into an explicit **remediation prerequisite**. It is not a REJECT because the fix is well-scoped (route the known raw-write paths through the repo, *or* attach emission below the repo at a shared data-access seam that the finalize route also uses) and belongs exactly where the plan puts the audit — it just needs to be treated as work, not a check.

### Per-decision ratification table

| Decision | Verdict | One-line reason |
|---|---|---|
| **§4 — emission at repository layer (internal) / executor (external)** | 🔄 **RATIFIED-WITH-CHANGES** | Right analog to the trigger's universal firing point and a valid refinement of the locked executor-only decision — **but** the "repos are the single chokepoint" premise is false today for T1–T9 entities (finalize route + raw payment writes). Remediate bypasses per-entity before each cutover; add a coverage assertion, not a coverage assumption. |
| **C1 — DB-backed `event_reactions` queue** | ✅ **RATIFIED** | Durable + retryable by construction, matches shared-Postgres reality, no new infra; correct to defer a push queue until fast-lane latency proves inadequate. |
| **C2 — at-least-once post-write emit + mandatory idempotency** | 🔄 **RATIFIED-WITH-CHANGES** | Correct that a same-tx outbox is impractical via the Supabase client. **But "at-least-once" is currently aspirational:** `emit()` returns an error result that callers ignore, so a write that commits then fails to emit loses the event and the reaction never fires. Needs a real emit-durability net (retry emit, and a reconciliation sweep that detects source rows with no corresponding event) — otherwise it's at-*most*-once on the sad path. |
| **C3 — hybrid rules storage (code system-rules first)** | ✅ **RATIFIED** | Matches locked §4.2; keeps platform behavior deterministic/testable; user-rules table is correctly deferred. |
| **C4 — declarative repo-layer emission (metadata, not scattered `.emit()`)** | 🔄 **RATIFIED-WITH-CHANGES** | Declarative metadata is the no-hardcoding-correct shape. Same caveat as §4: declarative-on-the-repo only covers writes that *reach* the repo; pair with the bypass remediation. |
| **C5 — dedicated `processed_reactions` dedupe table** | ✅ **RATIFIED** | Cleaner than overloading `hasRecentEvent()`; gives exactly-once *effect* over at-least-once *delivery*, consistent with locked §3.8. |

None of C1–C5 or §4 *contradict* the design's locked decisions (two-lane §3.4, Option-B lane-not-sync §3.5, provider-agnostic reactions §3.7) — they are faithful concretizations. The only tension is coverage, not model.

### Required changes (itemized)

| # | Change | Severity |
|---|---|---|
| RC1 | **Reclassify the §4 coverage step from "verify" to "remediate."** Phase 0 must inventory every write path to each T1–T9 source table and route the raw-write bypasses (`website/booking/finalize`, payment-block raw updates, chat raw writes) through the emitting repo — *or* place the emission hook at a data-access seam the finalize route also crosses — **before** the corresponding trigger is dropped. Add a static assertion/test that no `.from('<migrated_table>')` write exists outside the repo. | **High** |
| RC2 | **Close the emit-durability gap (C2).** Define the behavior when the write commits but `emit()` fails: retry, and add a reconciliation sweep (source-row-without-event detector) so "at-least-once" is real. Today `emit()` failures are swallowed. | **High** |
| RC3 | **Confirm the reaction ops actually exist as plugin operations, and how a reaction resolves capability→plugin, in Phase 1.** §3.7 (locked) says reactions are plugin ops via `PluginExecuterV2.execute`, but there is no capability→provider registry today (R7 is Phase 4) and it is unverified that `crm.log_activity`, `crm.find_or_create_contact`, `payments.mark_invoice_paid`, `scheduling.cancel_future_bookings` all exist as executor operations. Audit the catalog in Phase 0; build the missing ops; specify the interim single-provider resolution so Phase 1 reactions can execute as ops (not by calling repos directly, which would violate §3.7). | **High** |
| RC4 | **Add inter-reaction causal ordering to the risk register and the T1/T2 playbook.** T2's guardrail is "only if `contact_id` present," and T1 is what *sets* `contact_id`. T1 (fast) and T2 (delayed) both key off `booking.created` across two lanes with no ordering guarantee — T2 can observe a not-yet-linked booking and skip, changing behavior. Today trigger ordering is deterministic within the transaction; the queue model is not. Specify how the link is made visible to T2 (e.g. T2 keys off `booking.confirmed`/`contact linked`, or re-evaluates). | **Medium** |
| RC5 | **Taxonomy additions are under-scoped.** Adding `task.completed`, `document.uploaded`, `contact.deleted` to `BusinessEventType`/`EVENT_TYPE_TO_CATEGORY` is necessary but not sufficient — `BusinessEntityType` has no `task` or `document` member either, and `SourceCapability` should be checked for coverage. List the entity-type additions explicitly in §5. | **Low** |
| RC6 | **Name the pre-existing dual event log.** `scheduling/bookings` already emits `invoice.created` via the *old* `PaymentEventService` (`payment_events`), not `business_events`. Phase-2 convergence (§Phase 2 / design §7) must reconcile these so a single write doesn't drive reactions from two logs — call it out where convergence is sequenced. | **Low** |
| RC7 | **State the queue tables' RLS/role model.** `businessEventService` runs on `supabaseServer` (service role, RLS-bypassing); the fast inline kick and cron drains will too. The plan says `event_reactions`/`processed_reactions` are "RLS by `user_id`" — fine, but note the runners use the service role and must still scope every reaction to the event's `user_id` (the same `.eq('user_id', …)` discipline), since RLS won't protect service-role queries. | **Low** |

### Answers to the specific questions

**Q3 — Phasing + per-trigger playbook (§6/§7).**
- **Risk order is correct.** T8 (self-contained pure logging) → activity cluster → T4 (idempotent state-flip) → T1 (fan-in) → T9 (destructive cascade last) is the right ascending-blast-radius sequence. CRM-first matches the locked §3.10.
- **"Add rule + drop trigger in the same change, xor at every instant" is the correct and sufficient discipline for *double-fire*** — provided emission coverage (RC1) is real. Note the failure mode the discipline does **not** cover: if the event never emits on a bypassed path, you get **zero-fire**, not double-fire. The xor discipline protects against duplication; RC1 protects against silent omission. Both are needed.
- **T1 fan-in nuance is only half-handled.** The plan treats T1 as "booking.created → find_or_create_contact + link." But per the T1 redefinition (`20260728`), contact creation is *skipped* when `payment_status='pending'`; for paid bookings the contact is created **later, in the finalize route, by raw app code — not by any trigger.** So T1 has two real paths: the trigger (free/immediate bookings) and app code (paid bookings, already event-source-able but currently a raw write). The cutover must reconcile both, and the finalize route's raw contact/booking writes are the RC1 dependency. As written, §7's T1 row covers only the free path.
- **Reaction-op existence gap:** see RC3 — at least `scheduling.cancel_future_bookings` and `crm.find_or_create_contact` as *plugin operations* (vs repo methods) are unverified; treat op-catalog completion as Phase-0 work.

**Q4 — Serverless model (§8).** Sound on Vercel. Inline kick + frequent safety-net sweep for fast, insight crons for delayed, with durability anchored to persisted `event_reactions` rows (not the ephemeral in-process `subscribe()` — correctly avoided) is the right shape and matches design §6. One correctness note: the inline kick runs in the same invocation as the write, so a fast reaction's latency and failure are coupled to the originating request's lifetime — ensure the inline drain is bounded and that anything it doesn't finish is *guaranteed* to be `pending` in `event_reactions` before the response returns, so the sweep can always recover it. That ordering (persist reaction rows → then attempt inline → return) is implied but should be explicit.

**Q5 — Missing risks / gaps.**
1. **Emission coverage on bypassing writes (RC1)** — the material gap; the finalize route is the concrete counterexample the plan's premise misses.
2. **Emit durability on the sad path (RC2)** — write-commits-but-emit-fails is unhandled; "at-least-once" isn't yet true.
3. **Inter-reaction causal ordering (RC4)** — T1→T2 dependency crosses lanes with no ordering guarantee; not in the plan.
4. **Capability→plugin resolution for Phase-1 reactions (RC3)** — R7 is deferred to Phase 4, but Phase-1 reactions still need to resolve to *some* executor op today; the resolution mechanism and op-catalog completeness are unspecified.
5. **`crm_activities`-as-projection convergence timing** — the plan (correctly, per design §7) says convert per-capability as it migrates. Add the concrete invariant: for any capability mid-cutover, `crm_activities` must have exactly one writer (trigger **or** the `crm.log_activity` reaction) at every instant, mirroring the trigger xor rule — otherwise the timeline double-writes during convergence.
6. **Pre-existing dual event log (RC6)** and **queue-table role model (RC7)** as above.

### Approval

- [ ] **Not yet approved to build.** Address RC1–RC3 (High) in the plan before M1/Phase-0 scaffolding; RC4–RC7 can be folded into the per-phase playbooks. Re-submit for SA sign-off on the revised §3/§4 (M0 remains blocking, per the plan's own Milestones).
