# Business OS — Event-Driven Architecture (Cross-Capability Reactions)

> **Last Updated**: 2026-08-05

> **Scope banner — READ FIRST.** This is **Step 3 of the CRM-first plugin plan**. It is **designed now, but OUT of the CRM-pilot v1 scope, and built later.** v1 ships on the existing Postgres triggers unchanged (see [SA Feasibility Review §2.4](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#24-recommendation)). This document captures the **locked** target architecture so the eventual trigger→event migration is an incremental switch, not a rewrite. It is design altitude — architecture, locked decisions, and concrete shapes — **not** an implementation workplan.
>
> 📘 **Implementation companion:** the *how* (phased migration, resolved implementation choices, per-trigger cutover playbook) lives in **[BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md)** (draft). It notably refines the emission-point question — repo-layer emission as the universal internal chokepoint enabled by the completed repository-conformance work.

## Overview

Today, cross-capability behavior in Business OS (BOS) is enforced by **SECURITY DEFINER Postgres triggers** on a shared database (booking INSERT → create/link contact + log activity; payment succeeded → log activity + flip invoice; etc.). That mechanism is correct and atomic **only while every capability is served by an internal provider that writes to the same Postgres.** The moment a capability is served by an **external plugin** (e.g. a customer's own HubSpot CRM), the trigger web tears — the data isn't in local tables, so triggers either fail to fire or fire against a phantom local row (full analysis: [SA Feasibility Review §2.2](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#22-why-it-breaks-at-the-external-boundary--and-why-v1-is-safe)).

The locked model replaces the trigger web with an **application-level, event-driven reaction system**: plugin operations **announce** normalized domain events, every announcement is **persisted durably**, and a **config-driven distributor** routes each reaction to a **fast** or **delayed** durable queue, where reactions are themselves **plugin operations** — so they hit whichever provider (internal or external) currently serves the target capability. This is the design that makes BOS external-ready, and it simultaneously lights up the Insight metrics/detectors and the automations loop with one mechanism.

## Table of Contents

1. [Where This Sits](#1-where-this-sits)
2. [Current State of the Substrate](#2-current-state-of-the-substrate)
3. [The Locked Model](#3-the-locked-model)
4. [Concrete Shapes](#4-concrete-shapes)
5. [T1–T9 Trigger → Lane Classification](#5-t1t9-trigger--lane-classification)
6. [Serverless Constraints (Vercel)](#6-serverless-constraints-vercel)
7. [Event-Log Fragmentation — Convergence Recommendation](#7-event-log-fragmentation--convergence-recommendation)
8. [Open Implementation Choices (Deliberately Deferred)](#8-open-implementation-choices-deliberately-deferred)
9. [Relation to CRM-Pilot v1 (What Is / Isn't Built Now)](#9-relation-to-crm-pilot-v1-what-is--isnt-built-now)
10. [Change History](#10-change-history)

---

## 1. Where This Sits

| Doc | Relationship |
|---|---|
| [BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md) | This is **Step 3** of that requirement's plan. Q5 there ("cross-capability side-effects across the plugin boundary") is realized here. |
| [BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md §2 / Q5](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md#2-deep-dive--cross-capability-side-effects-q5) | This doc **realizes the seam** that review recommended (candidate (iii)→(i): staged, single provider-agnostic mechanism). |
| [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md) | Source of the **T1–T9 trigger inventory** re-classified in §5. |
| [INSIGHT_SYSTEM_PLAN.md](/docs/INSIGHT_SYSTEM_PLAN.md) | Supplies the adopted **event taxonomy** (`business_events`, categories, `BusinessEventService`). ⚠️ **This doc overrides its Section 1** — see below. |

> ⚠️ **Override of INSIGHT_SYSTEM_PLAN.md §1.** The Insight plan proposed emitting `business_events` via **DB triggers** (`CREATE FUNCTION emit_contact_stage_changed() … CREATE TRIGGER …`). **We reject DB-trigger emission.** Emitting from triggers re-entrenches exactly the shared-DB coupling this architecture removes, and it cannot observe writes made by an **external** provider (whose data never lands in a local table). **Emission is application-level at the plugin/executor layer.** The Insight plan's *table, taxonomy, and `BusinessEventService`* are adopted as-is; only its *emission mechanism* is superseded.

---

## 2. Current State of the Substrate

Verified against the code (2026-08-05):

| Asset | State | Evidence |
|---|---|---|
| `business_events` table | **Created, unpopulated.** Migration is **table + indexes + RLS only — no emission triggers/functions.** | `supabase/migrations/20260801_create_business_events.sql` (65 lines; no `CREATE TRIGGER`/`CREATE FUNCTION`) |
| `BusinessEventService` | **Fully built and merged.** Singleton bound to `supabaseServer`. API: `emit`, `emitBatch`, `subscribe`, `getEvents` (+ `getEventsForContact/Entity/Category`, `getEventCountsByCategory/Type`, `getRecentEventsByTypes`, `hasRecentEvent`, `getTotalValue`). | `lib/business-os/insight/events/BusinessEventService.ts` |
| Event taxonomy | **Fully typed and merged.** 7 categories, ~40 event types, `EVENT_TYPE_TO_CATEGORY` validation map. **Adopt this vocabulary as-is.** | `lib/business-os/insight/events/types.ts` |
| Emitters (writers) | **NONE.** Zero callers of `emit`/`emitBatch`/`emitBusinessEvent` anywhere in `lib/`, `app/`, `components/`. **`business_events` is written by nothing today.** | grep: no callers outside the service itself |
| Consumers (readers) | `MetricsComputeService` reads via `getEvents` — i.e. the **read side is wired to an empty table**, so metrics/detectors currently compute over nothing. | `lib/business-os/insight/metrics/MetricsComputeService.ts` |

**Plainly stated:** the durable event backbone (table + service + taxonomy) is **already built but dark**. No DB trigger emits into it and no capability code calls `.emit()`. **The plugin-emission layer is the single missing piece that lights this up** — which is why Step 3 attaches emission to the plugin execution path rather than building anything new for storage.

**One caveat on the existing service:** `BusinessEventService.subscribe()` is an **in-process array** (`eventSubscribers`) — ephemeral, lost on serverless cold start, not durable. It is fine as a same-request hook but **must not** be the reaction transport. Durability comes from the persisted event log + queue (§3), not from `subscribe()`.

**Three "baby versions" of this pattern already exist** and should generalize into the one rules layer described here (§3.6):

| Existing partial | What it is | Generalizes to |
|---|---|---|
| `payment_automation_rules` table | User-configurable "trigger_event → action_block" rows (payments only) | The **rules registry** shape (§4.2) |
| `DETECTOR_TO_PROCESS` map (`insight/kernel/TriggerableProcesses.ts`) | Hardcoded detector→kernel-process map | Rules whose reaction is a kernel process |
| `insight_automations` table | Standing automations the kernel scheduler reads | Delayed-lane rules with standing schedules |

---

## 3. The Locked Model

### 3.1 Plugins announce (application-level emission — not DB triggers)

Every meaningful plugin operation emits a **normalized domain event** at the **executor layer**, on success: `booking.created`, `payment.completed`, `contact.stage_changed`, etc. Emission lives in the plugin execution path (see §4.1), **not** in a database trigger. This is the decision that makes external providers first-class: an external CRM's executor emits `contact.stage_changed` the same way the internal one does, even though its data lives in HubSpot.

### 3.2 One durable event backbone — reuse what exists

Announcements are written to the **existing `business_events` table via the existing `BusinessEventService`**. No new store, no new taxonomy. Step 3 wires emission into `.emit()` / `.emitBatch()`; everything downstream (the table, indexes, RLS, query API) already exists.

### 3.3 All announcements are persisted durably — no exceptions

The event log **is** the durability boundary. Nothing meaningful vanishes: the operation persists its event before (or atomically with) returning success, and **reactions are retried off that log, outbox-style**. A dropped reaction is recoverable because its triggering event is still on the log with a processing state; a crashed worker re-reads unprocessed events. (The transactional-attachment detail — same-transaction outbox row vs. post-commit write — is an §8 implementation choice, but "the event is durable before we depend on a reaction" is locked.)

### 3.4 Two-lane queue model

Every reaction goes through a **queue**. There is no synchronous/in-transaction reaction path. The two lanes differ **only in eagerness**, and both are durable and retryable:

| Lane | Eagerness | Typical reactions |
|---|---|---|
| **Fast lane** (default) | Near-real-time | Create/link entities, state-flips, integrity cascades — anything the user expects reflected "now" |
| **Delayed lane** | Periodic / subscriber | Activity-timeline logging, metrics recompute, advisor/detector runs, digest emails |

The specific queue **technology** (a DB-backed queue table vs. a third-party queue) is deliberately **not decided** here — see §8.

### 3.5 Instant vs delayed = which lane, not queue-vs-sync — **DECISION: Option B (locked)**

The **fast lane is the default everywhere.** We do **not** offer a fully-synchronous, in-transaction reaction path. The rare case where a user would perceive a gap (the event is saved instantly, but its reaction lands a beat later) is smoothed with **optimistic UI** — the client shows the expected outcome immediately and reconciles when the reaction completes.

**Why not synchronous reactions?** In-transaction reactions only work while **everything is internal and co-located in one Postgres** — precisely the coupling that breaks the instant an external provider is involved (you cannot enlist HubSpot in a Postgres transaction). Choosing synchronous reactions would rebuild the exact wall we are tearing down. Optimistic UI absorbs the perceived latency without re-coupling the data layer. **This is the core trade-off, locked: a small, UI-absorbable latency in exchange for provider-agnostic reactions.**

### 3.6 Config-driven rules + an announcement distributor

The hardcoded DB triggers are replaced by two pieces:

1. A **rules registry** — declarative rows/entries of the form **WHEN `[event_type]` → DO `[reaction]` in `[lane]`** (with optional conditions/guardrails).
2. An **announcement distributor** (dispatcher) — for each incoming announcement, it looks up all matching rules and routes each reaction onto the fast or delayed queue.

Adding a cross-capability behavior becomes **adding a rule (data)**, not **writing a trigger (code)** — honoring the platform's no-hardcoding principle. Whether the registry is a **table** or **code config** is discussed in §4.2 (recommendation: code-defined system rules for platform behaviors + the existing `payment_automation_rules`-shaped **table** for user-authored rules).

### 3.7 Reactions are plugin operations → provider-agnostic

A rule's reaction ("log an activity in CRM", "mark the invoice paid") is expressed as a **plugin operation** (`crm.log_activity`, `payments.mark_invoice_paid`), executed through the same `PluginExecuterV2.execute()` path as any other operation. It therefore hits **whichever plugin currently serves that capability** for the tenant — internal or external. **This is the payoff:** the same rule works whether CRM is our internal plugin or the customer's HubSpot, with zero rule change.

### 3.8 Idempotency is mandatory

Because reactions **retry**, every reaction must be **safe to run twice**:

- Prefer naturally-idempotent operations: **find-or-create** contact (not create), **set** invoice status = paid (not increment), **upsert** links.
- For non-idempotent reactions (e.g. **send email**, **charge card**), the reaction must carry a **dedupe key** (derived from `event.id` + rule id) and the executor/queue must drop a duplicate delivery of the same key.
- This is a **design rule for the rules registry**: every rule declares whether its reaction is naturally idempotent or requires a dedupe key.

### 3.9 One mechanism, three payoffs

The same event backbone serves all three of BOS's cross-cutting needs — collapsing three "baby versions" (§2) into one layer:

1. **Replaces** the T1–T9 cross-capability triggers (provider-agnostic reactions).
2. **Feeds** the Insight `business_events` → metrics → detectors pipeline (which is built but starved of data today).
3. **Powers** the automations / kernel-trigger loop (standing automations become delayed-lane rules).

### 3.10 Incremental, no-double-fire migration

T1–T9 are **live today** and must not double-fire with their event-backed replacements. Migration is **per capability, CRM first**:

1. Wire CRM plugin operations to **emit** events → `business_events` starts populating.
2. Stand up the distributor + fast/delayed lanes reading that log (initially with **no active rules that duplicate a live trigger**).
3. Move each CRM-related side-effect from **trigger-backed → event-backed one at a time**: add the event-backed rule **and drop the corresponding DB trigger in the same change**, so a given side-effect is **either** trigger-backed **or** event-backed at any instant — **never both.** (This is the no-double-fire discipline from Feasibility Review §2.3 option (iii).)

---

## 4. Concrete Shapes

*Illustrative shapes at design altitude — exact signatures are for the eventual workplan.*

### 4.1 Emission point (executor layer)

Emission attaches to the plugin execution path **after** the operation succeeds, so it observes real state changes for **any** provider:

```
PluginExecuterV2.execute(userId, plugin, action, params)
  └─ BasePluginExecutor.executeAction(...)
       └─ executeSpecificAction(...)  → success
            └─ [NEW] emit normalized event(s) via businessEventService.emit(userId, {...})
```

Two viable placements (an §8 choice): (a) a thin **post-success emission hook** in `BasePluginExecutor` driven by per-action event metadata in the plugin definition (most no-hardcoding-friendly — the definition declares "this action emits `booking.created`"), or (b) explicit `.emit()` calls inside each executor. Recommendation leans (a): the plugin definition already is the single source of truth for operations, so it is the natural home for "what does this operation announce."

### 4.2 Rules registry shape (WHEN → DO → lane)

Precedent to reuse: **`payment_automation_rules`** (`trigger_event` TEXT, `trigger_conditions` JSONB, `action_block` TEXT, `action_parameters` JSONB, `delay_minutes`, `is_active`, guardrail columns). Generalize its shape cross-capability:

```jsonc
// Illustrative rule
{
  "when": { "event_type": "booking.created" },
  "if":   { /* optional conditions on event.metadata */ },
  "do":   { "capability": "crm", "operation": "find_or_create_contact",
            "params_from_event": { "email": "metadata.client_email", "name": "metadata.client_name" } },
  "lane": "fast",
  "idempotent": true,          // or: "dedupe_key": "event.id + rule.id"
  "guardrails": ["max_1_per_entity_per_day"]
}
```

**Table vs. code — recommendation:** a **hybrid**.
- **System rules** (the platform's built-in cross-capability behaviors that replace T1–T9) are **code-defined config** — versioned with the code, reviewable, not user-editable. This keeps platform behavior deterministic and testable.
- **User-authored rules** (owner automations, "when X, do Y for me") live in a **table**, the generalized descendant of `payment_automation_rules` + `insight_automations`. RLS-scoped per tenant.

Both are read by the same distributor; the split is *authorship/trust*, not *mechanism*.

### 4.3 Distributor flow

```
business_events (durable log)
      │  new event: booking.created
      ▼
┌─────────────────────────────────────────────┐
│  ANNOUNCEMENT DISTRIBUTOR                    │
│  1. load matching rules (system + user)      │
│  2. evaluate optional conditions             │
│  3. route each reaction to its lane          │
└───────────────┬───────────────┬─────────────┘
                │ fast          │ delayed
                ▼               ▼
        ┌───────────────┐  ┌────────────────────┐
        │ FAST QUEUE    │  │ DELAYED QUEUE      │
        │ (near-RT)     │  │ (periodic/cron)    │
        └──────┬────────┘  └─────────┬──────────┘
               ▼ reaction = plugin op ▼
        PluginExecuterV2.execute(...)  ← provider-agnostic, idempotent, retryable
```

One announcement (`booking.created`) can fan out to **multiple** rules across **both** lanes — e.g. fast: `crm.find_or_create_contact`; delayed: `crm.log_activity`, `metrics.recompute`. That fan-out is exactly what §5 classifies.

---

## 5. T1–T9 Trigger → Lane Classification

The most useful concrete output: each existing Postgres trigger, the event that will drive it, its target reaction (as a plugin operation), and its lane. **Classification rule:** *entity creation/linking, state-flips, and integrity cascades → **fast** (user expects it reflected now); pure activity-timeline logging and analytics → **delayed** (a record, not a decision point).* This matches the whiteboard examples (booking→contact = fast; payment→activity = delayed).

| # | Trigger (today) | Driving event | Reaction (plugin op) | Lane | Idempotency |
|---|---|---|---|---|---|
| T1 | `create_crm_contact_from_booking_trigger` (booking INSERT → create/link `crm_contacts`) | `booking.created` | `crm.find_or_create_contact` | **Fast** | find-or-create (natural) |
| T2 | `log_booking_activity_trigger` (booking INSERT / status → `crm_activities`) | `booking.created`, `booking.completed`/`no_show`/`cancelled` | `crm.log_activity` | **Delayed** ⚠️ (fast-eligible) | dedupe on `event.id` |
| T3 | `log_payment_activity` (payment succeeded → `crm_activities`) | `payment.completed` | `crm.log_activity` | **Delayed** | dedupe on `event.id` |
| T4 | `update_invoice_on_payment` (payment succeeded → flip `payment_invoices` to paid) | `payment.completed` | `payments.mark_invoice_paid` | **Fast** | set-status (natural) |
| T5 | `log_email_activity` (email sent → `crm_activities`) | `email.sent` | `crm.log_activity` | **Delayed** | dedupe on `event.id` |
| T6 | `log_task_activity` / `set_task_completed_at` (task completed → `crm_activities`) | `task.completed` † | `crm.log_activity` | **Delayed** | dedupe on `event.id` |
| T7 | `log_document_activity_trigger` (document upload → `crm_activities`) | `document.uploaded` † | `crm.log_activity` | **Delayed** | dedupe on `event.id` |
| T8 | `log_crm_contact_created_trigger` (contact INSERT → `contact_created` activity) | `contact.created` | `crm.log_activity` | **Delayed** | dedupe on `event.id` |
| T9 | `delete_future_bookings_on_contact_delete_trigger` (contact DELETE → cancel future bookings) | `contact.deleted` † | `scheduling.cancel_future_bookings` | **Fast** | cancel-idempotent (already-cancelled = no-op) |

† `task.completed`, `document.uploaded`, `contact.deleted` are **not** in the current `business_events` taxonomy (`types.ts`) — they must be **added** to the taxonomy when their capability is migrated. `booking.*`, `payment.completed`, `contact.created`, `contact.stage_changed` already exist in the taxonomy.

**Net fast/delayed split:** **Fast → T1, T4, T9** (create/link, state-flip, integrity cascade). **Delayed → T2, T3, T5, T6, T7, T8** (all activity-timeline logging).

**Genuinely ambiguous — flagged, not silently decided:**
- **T2 (booking → log activity)** is the one real borderline. It is timeline logging (→ delayed by the rule), but because a booking's activity is something a user may expect to see the instant they open the freshly-booked contact, it is **fast-eligible**. Because lane is a **per-rule config value**, this is a **tunable product choice, not a hard architectural call** — start delayed, promote to fast if UX demands. T3/T5 share the same tolerance but lean more comfortably delayed (payment/email confirmations are less tied to an immediate next action).
- **Net-new event `contact.stage_changed`** has **no legacy trigger** (it was only ever an Insight-plan proposal). It should be emitted by the CRM plugin regardless (feeds conversion metrics/detectors) — **delayed** lane, analytics-only, no user-visible reaction.

---

## 6. Serverless Constraints (Vercel)

The two lanes have different infrastructure needs, and Vercel's no-persistent-worker model shapes both:

| Lane | Constraint | Design implication |
|---|---|---|
| **Fast** | **Cannot** be an every-few-minutes cron — the whole point is near-real-time (invoice-paid flip, contact creation). | Needs an **inline kick** right after the operation (dispatch within the same request/invocation) **or** a **push-style queue** (e.g. a queue that invokes a handler function on enqueue). A polling cron is too slow for this lane. |
| **Delayed** | Latency-tolerant (timeline logs, metrics, digests). | **Reuse the existing Insight cron cadence** (`INSIGHT_SYSTEM_PLAN.md §9`: metrics daily, detectors every 15 min, automations every 5 min). The delayed queue can be drained by these existing crons. |

Durability does not depend on the worker model: because every reaction is anchored to a persisted `business_events` row with a processing state, a missed inline kick is still recoverable by a sweep (a delayed-lane cron can also act as the fast-lane **safety net** that reprocesses any event whose fast reaction never completed).

---

## 7. Event-Log Fragmentation — Convergence Recommendation

BOS currently has **three overlapping event/activity logs**, which this architecture should converge (follow-on, not v1):

| Log | Purpose today | Tension |
|---|---|---|
| `crm_activities` | Human-facing contact timeline | Written by triggers T2/T3/T5/T6/T7/T8 — the very side-effects being migrated |
| `payment_events` | Payment event log "for AI" | Overlaps `business_events` cash-flow category |
| `business_events` | Unified analytics event log (Insight) | The intended single backbone — currently empty |

**Recommendation:** make `business_events` the **single system-of-record event log**, and treat `crm_activities` as a **projection** (a human-readable timeline **materialized from** events, written by the `crm.log_activity` delayed-lane reaction) rather than an independent source. Retire `payment_events` into `business_events` cash-flow types. This removes the "which log is truth?" ambiguity and ensures the timeline and the analytics layer can never disagree. **Sequencing:** do this **as** each capability migrates (CRM first), not as a separate big-bang — otherwise the timeline and events diverge mid-migration.

---

## 8. Open Implementation Choices (Deliberately Deferred)

These are **not** decided here; they are recorded so the workplan owns them:

| Choice | Options | Note |
|---|---|---|
| **Queue technology** | DB-backed queue table (fits shared-Postgres, no new infra) vs. third-party push queue (better fast-lane latency) | Locked model requires only "durable + retryable + two lanes," not a specific tech. |
| **Event durability attachment** | Same-transaction outbox row vs. post-commit emit | Affects exactly-once guarantees; both satisfy "event durable before reaction depends on it." |
| **Rules registry storage** | Code-defined system rules + `payment_automation_rules`-shaped user table (recommended hybrid, §4.2) vs. all-in-table | Trust/authorship split, not mechanism. |
| **Emission wiring** | Definition-declared per-action events (recommended) vs. explicit `.emit()` in executors | (a) is more no-hardcoding-aligned. |
| **Dedupe-key store** | Reuse `BusinessEventService.hasRecentEvent()` vs. a dedicated processed-reactions table | For non-idempotent reactions (§3.8). |

---

## 9. Relation to CRM-Pilot v1 (What Is / Isn't Built Now)

| | v1 (CRM pilot) | Step 3 (this doc) |
|---|---|---|
| Cross-capability side-effects | **DB triggers T1–T9, unchanged** | Migrated to event-backed reactions |
| Event emission | None required | Plugin operations announce to `business_events` |
| Provider scope | Internal-only (external out of scope) | The reason the design is external-ready |
| Guardrail carried into v1 | Internal CRM executors **delegate to repositories and let existing triggers own all side-effects — they must not re-implement activity/contact logging** (prevents double-fire when Step 3 lands). See Feasibility Review §2.5. | — |

**In one line:** v1 changes nothing about side-effects; Step 3 is designed now so that when external providers arrive, the switch is an incremental, no-double-fire migration onto a backbone that is **already built and merely needs to be lit up**.

---

## 10. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-05 | Initial design | Captured the locked Step-3 event-driven architecture: application-level plugin emission (overriding INSIGHT_SYSTEM_PLAN §1 DB-trigger emission), reuse of the built-but-unpopulated `business_events` + `BusinessEventService`, durable event log with two-lane (fast/delayed) durable queues, Option-B lane-not-sync decision with optimistic UI, config-driven rules registry + distributor with provider-agnostic plugin-op reactions, mandatory idempotency, and the incremental no-double-fire trigger→event migration (CRM first). Included the T1–T9 → lane classification (fast: T1/T4/T9; delayed: T2/T3/T5/T6/T7/T8; T2 flagged fast-eligible), Vercel fast/delayed infra constraints, and an event-log convergence recommendation (`business_events` as system-of-record; `crm_activities` as a projection). Confirmed against code: zero emitters today; migration creates table+indexes+RLS only, no emission triggers. |
