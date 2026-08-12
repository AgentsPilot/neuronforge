# Business OS — Payments Phase-2: Repositories for the Unowned Tables

> **Last Updated**: 2026-08-12
> **Module**: Payments (#4) — **phase-2 follow-on** to the shipped Payments plugin (repo-layer conformance; NOT a plugin-op change).
> **Status**: 🟢 **Implemented → SA code-review APPROVE (§7.2) → QA PASS-WITH-NOTES (§8), no bugs** (QA's lone coverage note closed: added the 2 `create` tests → 43 repo tests). Awaiting user code review before RM.
> **RM**: Held (same "hold RM until user reviews code" gate).

## Overview

The Payments plugin v1 deferred 7 tables that are owned by **service classes doing direct DB access** (or orphaned). This phase adds conformant repositories for the **clean** ones and routes their services through them, so no direct `.from()` on those tables remains outside `lib/repositories/`. **Extending the Payments plugin op surface is OUT of scope** — this is repo-layer + service-routing only.

Follow the `new-repository` skill / `docs/REPOSITORY_STRATEGY.md` and mirror the phase-1 `lib/repositories/PaymentRepository.ts` (grouped multi-class file) / `PaymentPlanRepository.ts`: each repo is a class with `constructor(supabase: SupabaseClient = supabaseServer)` (DI, **with the `= supabaseServer` default** — the services lack it, the repos should have it), returns `{ data, error }` (`RepositoryResult<T>`), module-level Pino `createLogger` (never `console.*`), scopes **every** query with `.eq('user_id', userId)` except the explicitly-flagged cron methods, and exports a singleton. Import by **direct path** (`@/lib/repositories/PaymentXRepository`) — the `index.ts` barrel isn't used for payment repos.

**All 7 tables have a `user_id NOT NULL` column** — there is no website_blocks/G3 ownership problem; every repo scopes by `user_id`.

## Table of Contents

1. [Scope](#1-scope)
2. [The repos](#2-the-repos)
3. [Bug fixes folded in](#3-bug-fixes-folded-in)
4. [Guardrails](#4-guardrails)
5. [Deferred / out of scope](#5-deferred--out-of-scope)
6. [Tests](#6-tests)
7. [SA review](#7-sa-review)
8. [QA report](#8-qa-report)

---

## 1. Scope

### In scope — repos for 5 tables (4 files) + service routing

| Table | Repo (class) | File | Owning service to reroute |
|---|---|---|---|
| `payment_processors` | `PaymentProcessorRepository` | `lib/repositories/PaymentProcessorRepository.ts` | `PaymentProcessorService` |
| `saved_payment_methods` | `SavedPaymentMethodRepository` (same file) | ↑ | `PaymentProcessorService` |
| `payment_events` | `PaymentEventRepository` | `lib/repositories/PaymentEventRepository.ts` | `PaymentEventService` (+ 1 engine read) |
| `payment_reminders` | `PaymentReminderRepository` | `lib/repositories/PaymentReminderRepository.ts` | `PaymentReminderService` + `app/api/payments/blocks/execute/route.ts` |
| `payment_automation_rules` | `PaymentAutomationRuleRepository` | `lib/repositories/PaymentAutomationRepository.ts` | `PaymentAutomationEngine` (rule sites only) |

### Out of scope (this phase)

- **`payment_automation_executions`** — DEFERRED (user decision). Its `trigger_event_id` is a **phantom column** written+read by `PaymentAutomationEngine` (`:710`/`:844`) → the delayed-automation path likely fails at runtime today; wrapping a broken path is not behavior-preserving. Leave the engine's `payment_automation_executions` `.from()` calls as-is; needs its own investigation (fix-via-migration vs rework). Note: this means the automation engine will use the rule repo for rules but keep direct-DB for executions this phase — acceptable, documented.
- **`payment_methods`** — confirmed dead (0 `.from()` refs; only false-positive Stripe-API `paymentMethods.list` hits). No repo. Recommend a **separate DROP migration** (out of scope). **M6:** fix the 2 stale docs claiming `PaymentRepository` owns it (`docs/architecture/BUSINESS_OS_DATA_MODEL.md:55`, `docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md:71`) as part of this phase's doc hygiene.
- **M4 (note, not a gap):** `getScheduledExecutionsDue` (engine `:811`) reads `payment_automation_rules` via a PostgREST embed (`.select('*, payment_automation_rules(*)')`) inside the deferred executions query — this is not a `.from('payment_automation_rules')`, so it's not a missed owner; it stays with the deferred executions work.
- **M5:** new repos use `constructor(supabase: SupabaseClient = supabaseServer)` (the PaymentRepository form **with** default) — do NOT copy `PaymentPlanRepository`'s no-default form. Also remove the phantom `updated_at` from the `PaymentReminder`/`PaymentEvent` TS interfaces (they don't exist in the DB).
- **Plugin op surface** — not extended. **Adjacent `payment_plan_installments` / `business_profiles` direct reads** in the reminder/retry services — noted, not this phase (installments already has `PaymentPlanRepository`; `business_profiles` has a repo now but wrapping those reads is a wider cleanup).

---

## 2. The repos

Method surfaces derived from the assessment's per-service call-site inventory (file:line → repo method). Cron/batch methods that are intentionally **cross-user** are marked **⟨unscoped-by-design⟩** and must carry a clear doc comment (precedent: `PluginConnectionRepository.markExpired`/`findActiveByProfileData`).

### 2.1 `PaymentProcessorRepository.ts` — 🟢 low risk (2 classes)
**`PaymentProcessorRepository`** (`payment_processors`): `findConnected(userId)`, `findDefault(userId)`, `findByType(userId, type)`, `create(row)`, `update(id, userId, patch)`, `updateByType(userId, type, patch)`, `clearDefault(userId)`, `setDefaultByType(userId, type)`. Keeps manual `updated_at` on updates (no trigger; column exists). Reroute `PaymentProcessorService` sites 191/213/227/254/285/304/342/371/378.
> **M1 (not-found semantics — required):** `findByType` and `findDefault` must return `{ data: null, error: null }` on no-row (use `.maybeSingle()` or swallow `PGRST116`), **never throw** — `PaymentProcessorService.getProcessor`/`getDefaultProcessor` treat "no processor" as a graceful `null`; throwing regresses connect/charge/refund. Document in the method doc-comments.
> **M2 (findDefault contract):** fold the service's full "default row → else any-connected fallback" logic (sites ~213 + ~227) into a single `findDefault(userId)` (option a) so the repo call matches the service method's contract.
**`SavedPaymentMethodRepository`** (`saved_payment_methods`): `findById(id, userId)`, `findValidByContact(userId, contactId)`, `clearContactDefaults(userId, contactId)`, `create(row)`, `invalidate(id, userId)`. Reroute sites 448/532/615/623/676.

### 2.2 `PaymentEventRepository.ts` — 🟢 low risk (append-only, no `updated_at`)
`create(userId, row)`, `createMany(userId, rows)`, `list(userId, options)`, `listEventTypes(userId, range)` (counts), `findRecentByTypes(userId, types, limit)`, `existsRecent(userId, …)`, + **⟨unscoped-by-design⟩** `findByIdUnscoped(id)` (for the engine read at `:842`). Reroute `PaymentEventService` sites 153/205/269/327/394/424 + engine `:842`.

### 2.3 `PaymentReminderRepository.ts` — 🟡 medium (2 correctness fixes, see §3)
`create(row)`, `updateStatus(id, userId, patch)` **(now user-scoped — fix)**, `cancel(id, userId)`, `cancelByInvoice(invoiceId, userId)`, `cancelByInstallment(installmentId, userId)`, `list(userId, options)`, + **⟨unscoped-by-design⟩** `findDue(now, limit)`, `deleteById(id)`, `markFailedById(id, msg)`, `findRecentByInvoice(invoiceId, type, since)`, `findRecentByInstallment(installmentId, type, since)`. Reroute `PaymentReminderService` sites 126/351/405/517/552/582/621/652/668/722/776/912 **and** `app/api/payments/blocks/execute/route.ts` 638/689.

### 2.4 `PaymentAutomationRepository.ts` — 🟢 low risk (RULES only this phase)
**`PaymentAutomationRuleRepository`** (`payment_automation_rules`): `findActiveForEvent(userId, eventType)`, `list(userId, options)`, `create(userId, row)`, `update(id, userId, patch)`, `delete(id, userId)`, + **⟨unscoped-by-design⟩** `findByIdUnscoped(id)` (cron, `:858`). Keeps manual `updated_at`. Reroute `PaymentAutomationEngine` rule sites 473/499/537/573/599/858. **Do NOT** add the executions class this phase.

---

## 3. Bug fixes folded in (PaymentReminderRepository)

- **B1 (cross-tenant, security):** `PaymentReminderService:405` `sendReminder` status update is scoped by `.eq('id')` **only**. The repo's `updateStatus(id, userId, …)` must add `.eq('user_id', userId)`. Add a unit test. **M3:** keep the `sendReminder` status update **non-fatal** — today the update result is ignored; after rerouting, a returned `error` must **log-and-continue** (the reminder was already dispatched), not abort the flow.
- **B2 (phantom column):** `payment_reminders` has **no `updated_at` column**, yet the service writes it at `:408/411/521/553/583/669` (and the blocks route at `:691`). The repo methods must **omit `updated_at`** from these updates (schema-matching; no reader depends on it). This makes the reminder updates actually succeed (they'd be rejected by PostgREST today).

> These are the reminder-repo analog of the Insights `total_amount`/`scheduling_availability` phantom fixes. Flag both clearly for QA as intended behavior changes (reminder updates go from failing → succeeding).

---

## 4. Guardrails

- **`user_id` scoping** on every method except the flagged **⟨unscoped-by-design⟩** cron methods, each with a doc comment explaining why (cross-user batch job). Never take `user_id` from caller data where an authenticated id is available.
- **No `updated_at` trigger** on any of these 5 tables → repos keep setting `updated_at` manually where the column EXISTS (`payment_processors`, `saved_payment_methods`, `payment_automation_rules`) and must NOT write it where it doesn't (`payment_events`, `payment_reminders`).
- **No cross-capability triggers** on any of the 5 tables (verified) → nothing to delegate-avoid. (The CRM-activity / invoice-paid triggers live on `payment_transactions`, already wrapped in phase 1.)
- **Behavior-preserving** service routing: same queries, same filters (except the B1/B2 fixes) — the services keep their public method signatures; only their internal `.from()` bodies delegate to the new repos.
- **Console standard:** the services are already Pino-clean; if any touched file has `console.*`, convert per CLAUDE.md (none expected).

---

## 5. Deferred / out of scope + open follow-ups

### Liveness of the wrapped tables (finding, 2026-08-12)
Traced during review — the 5 wrapped tables split into three tiers:
- **Live:** `payment_events`, `payment_processors`, `saved_payment_methods` — exercised by the payment UI blocks (`collect_payment` / `record_manual_payment` / `refund_*` → `POST /api/payments/blocks/execute`) and by booking creation (`scheduling/bookings` emits events + schedules reminders).
- **Half-dark:** `payment_reminders` — rows are created live (bookings + `schedule_reminder` block), **but never sent** (see follow-up F1).
- **Fully dark:** `payment_automation_rules` / `payment_automation_executions` (see follow-up F2).

### Open follow-ups (spawned as tasks + in the roadmap Payments section)
- **F1 ⬜ Wire the dormant payment crons** — `task_65f25a21`. `app/api/cron/payment-reminders/route.ts` + `payment-retry/route.ts` exist but are **NOT registered in `vercel.json`**, so scheduled reminders never send and retries never run. Add cron entries + verify auth gating. (B2 already stopped the reminder status writes from silently failing; sending still needs this cron.)
- **F2 ⬜ Decide + fix the dormant automation engine** — `task_39e0280d`. No rule-management API/UI, no scheduled execution cron, broken in-process pub/sub (engine subscribes on its own `PaymentEventService` instance vs the global singleton), and the phantom `payment_automation_executions.trigger_event_id` (written `:710`, read `:844`, absent from schema) → `createExecution` fails at runtime. **This is where the deferred `PaymentAutomationExecutionRepository` + the `trigger_event_id` migration + status-vocab reconciliation + pub/sub fix live.** Build-vs-remove decision first; overlaps Step-3 event-driven architecture.
- **F3 ⬜ `payment_methods` DROP migration** — dead table (0 `.from()` refs); confirm no prod rows first.

### Out of scope (this phase, no task)
- Wrapping the reminder/retry services' `payment_plan_installments` / `business_profiles` direct reads (installments already has `PaymentPlanRepository`; a wider cleanup).
- Semi-dead `payment_automation_rules` columns (`processor_filter`/`execution_count`/`last_executed_at`) — leave as-is.

---

## 6. Tests (lean)

- Unit tests per new repo (mocked Supabase builder): assert `user_id` scoping on the scoped methods, the key filters, `{data,error}` shape, and that the **⟨unscoped-by-design⟩** methods are the only ones without a `user_id` filter.
- **B1 test:** `PaymentReminderRepository.updateStatus` includes `.eq('user_id', userId)`.
- **B2 test:** the reminder update methods do NOT send `updated_at`.
- Service routing = behavior-preserving; where a service method is cheaply unit-testable with a mocked repo, assert it delegates (not `.from()`). Otherwise QA-manual. No heavy integration tests.

---

## 6.5 Implementation notes (Dev)

**Implemented on** branch `docs/business-os-event-driven-architecture` (RM held — no commit). All items below map 1:1 to §§1–6 + the SA M1–M6 / B1–B2 changes.

### Files created (4 repos / 6 classes)

| File | Classes | Methods |
|---|---|---|
| `lib/repositories/PaymentProcessorRepository.ts` | `PaymentProcessorRepository`, `SavedPaymentMethodRepository` | Processor: `findConnected`, `findDefault`, `findByType`, `create`, `update`, `updateByType`, `clearDefault`, `setDefaultByType`. Saved: `findById`, `findValidByContact`, `clearContactDefaults`, `create`, `invalidate`. |
| `lib/repositories/PaymentEventRepository.ts` | `PaymentEventRepository` | `create`, `createMany`, `list`, `listEventTypes`, `findRecentByTypes`, `existsRecent`, ⟨unscoped⟩ `findByIdUnscoped` |
| `lib/repositories/PaymentReminderRepository.ts` | `PaymentReminderRepository` | `create`, `updateStatus`, `cancel`, `cancelByInvoice`, `cancelByInstallment`, `list`, ⟨unscoped⟩ `findDue`, `deleteById`, `markFailedById`, `findRecentByInvoice`, `findRecentByInstallment` |
| `lib/repositories/PaymentAutomationRepository.ts` | `PaymentAutomationRuleRepository` | `findActiveForEvent`, `list`, `create`, `update`, `delete`, ⟨unscoped⟩ `findByIdUnscoped` |

All mirror the phase-1 `PaymentRepository` conventions: `constructor(supabase: SupabaseClient = supabaseServer)` (**M5**), module-level Pino `createLogger`, `{ data, error }` results (reusing `PaymentRepositoryResult<T>` imported from `PaymentRepository` — SA optimisation suggestion), singleton exports, direct-path imports (no barrel). Repos never throw to callers.

### Test files created (41 tests, all passing)

`lib/repositories/__tests__/PaymentProcessorRepository.test.ts` (18), `PaymentEventRepository.test.ts` (9), `PaymentReminderRepository.test.ts` (12 incl. explicit **B1** + **B2** cases), `PaymentAutomationRepository.test.ts` (7). Each uses a mocked Supabase builder and asserts user_id scoping on scoped methods, key filters, `{data,error}` shape, and that the ⟨unscoped⟩ methods are the only ones with no `user_id` filter.

### Call sites rerouted per service (all `.from()` on the 5 tables replaced)

- **`PaymentProcessorService`** (constructs repos from its injected client): `getConnectedProcessors`→`findConnected`; `getDefaultProcessor`→`findDefault` (M2 fold); `getProcessor`→`findByType`; `connectProcessor` update→`update`, insert→`create`; `disconnectProcessor`→`updateByType`; `setDefaultProcessor`→`clearDefault`+`setDefaultByType`; `chargeWithSavedMethod` lookup→`savedMethodRepo.findById`; `getSavedPaymentMethods`→`findValidByContact`; `savePaymentMethod`→`clearContactDefaults`+`create`; `invalidatePaymentMethod`→`invalidate`. (9 processor + 5 saved-method sites.)
- **`PaymentEventService`**: `emit`→`create`; `emitBatch`→`createMany`; `getEvents`→`list`; `getEventCounts`→`listEventTypes` (JS counting kept in service); `getRecentEventsByTypes`→`findRecentByTypes`; `hasRecentEvent`→`existsRecent`. (6 sites.)
- **`PaymentReminderService`**: `scheduleReminder`→`create`; `sendReminder` create→`create`, status update→`updateStatus`; `cancelReminder`→`cancel`; `cancelInvoiceReminders`→`cancelByInvoice`; `cancelInstallmentReminders`→`cancelByInstallment`; `processDueReminders`→`findDue`+`deleteById`+`markFailedById`; `processOverdueItems`→`findRecentByInvoice`+`findRecentByInstallment`; `getReminders`→`list`. (12 sites.)
- **`PaymentAutomationEngine`** (rules only): `getActiveRulesForEvent`→`findActiveForEvent`; `getUserRules`→`list`; `createRule`→`create`; `updateRule`→`update`; `deleteRule`→`delete`; `processScheduledExecutions` rule read→`ruleRepo.findByIdUnscoped`, event read→`eventRepo.findByIdUnscoped`. Executions `.from()` calls (`createExecution`/`updateExecution`/`getExecutionCountForEntity`/`hasRecentExecution`/`getScheduledExecutionsDue`) left untouched (deferred per §5). (6 rule sites.)
- **`app/api/payments/blocks/execute/route.ts`**: `schedule_reminder` insert→`paymentReminderRepository.create`; `cancel_reminder`→`cancel`/`cancelByInvoice`/`cancelByInstallment` (drops phantom `updated_at`). (2 sites.)

### M1–M6 / B1–B2 handling

- **M1** — `findByType` + `findDefault` use `.maybeSingle()` and return `{data:null,error:null}` on no-row; documented in method doc-comments. The service `getProcessor`/`getDefaultProcessor` simplified to pass the null through.
- **M2** — chose option (a): `findDefault(userId)` folds the full "default row → else any-connected" fallback; service is one call.
- **M3** — `sendReminder` status write is non-fatal: a returned error is logged (`…reminder already dispatched`) and the flow continues.
- **M4** — no code change (informational). `getScheduledExecutionsDue` embed read left as-is inside the deferred executions query.
- **M5** — constructors use the `= supabaseServer` default form. Removed the phantom `updated_at` from the `PaymentReminder` interface. Note: `PaymentEvent` (PaymentEventService) had **no** `updated_at` field already — nothing to remove there.
- **M6** — corrected both stale docs: `docs/architecture/BUSINESS_OS_DATA_MODEL.md` (`payment_methods` → none/dead) and `docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md` (Payments row rewritten to the real per-repo ownership; `payment_methods` marked dead, `payment_automation_executions` marked deferred).
- **B1** — `updateStatus(id, userId, patch)` scopes by BOTH `id` AND `user_id`; unit-tested.
- **B2** — no reminder update method (`updateStatus`, `cancel*`, `markFailedById`) or the route cancel writes `updated_at`; unit-tested. Reminder updates now succeed instead of being rejected by PostgREST (intended behavior change — flag for QA).

### Verification

- `npx tsc --noEmit`: **0 new errors** in touched files. The only 2 errors on a touched file (`app/api/payments/blocks/execute/route.ts` — `entityId` `{}`-vs-string at the `reminder.cancelled` emit, and `entityType: 'payment_block'` in the audit call) are **pre-existing baseline** — confirmed identical (at the pre-shift line numbers 714 / 960) with the changes stashed. Not authored by this phase; left untouched.
- New repo tests: **41 passed / 41** across the 4 files.

### Could-not-cleanly-map / left as-is (by design)

- The reminder/retry services' `payment_invoices`, `payment_plan_installments`, and `business_profiles` direct reads/writes — out of scope (§5); left as direct `.from()`.
- The engine's `payment_automation_executions` `.from()` calls — deferred (§5, phantom `trigger_event_id`); left as direct `.from()`.
- `this.supabase` remains on `PaymentProcessorService`/`PaymentEventService` (still passed to the repo constructors / used by out-of-scope reads) — retained intentionally.

## 7. SA review

**Reviewed by SA — 2026-08-12**
**Status:** ✅ APPROVE-WITH-CHANGES (all items below are Low/Medium implementation notes — none block the start of code)

### Verification performed (against migrations + live source)

Every load-bearing claim in the workplan was checked against `20260722_create_payment_tables.sql`, `20260723_enhance_payments.sql`, and the five owning source files. Results:

1. **`user_id NOT NULL` — all 5 in-scope tables confirmed.** `payment_processors` (mig2:15), `payment_events` (mig2:183), `payment_automation_rules` (mig2:214), `payment_reminders` (mig2:295), `saved_payment_methods` (mig2:331). Every repo scoping by `user_id` is valid.
2. **`updated_at` presence — B2 basis confirmed exactly as stated.**
   - NO `updated_at`: `payment_events` (mig2:181–191, `created_at` only) and `payment_reminders` (mig2:293–308, `created_at` only). Confirmed by full-tree grep — no later `ALTER … ADD COLUMN updated_at` on either. So the current writes really are phantom and (because `.update()` on a nonexistent column errors under PostgREST) currently **fail**. At `PaymentReminderService:404` the update result isn't even error-checked, so today reminder status transitions silently never persist — B2 is a genuine correctness fix, not cosmetic.
   - HAS `updated_at`: `payment_processors` (mig2:34), `saved_payment_methods` (mig2:348), `payment_automation_rules` (mig2:241). Repos must keep setting it manually — correct.
3. **No triggers on any of the 5 tables — confirmed.** The only triggers in mig1 are on `payment_transactions` / `payment_invoices` / `stripe_connect_accounts` (already phase-1). `update_overdue_installments()` (mig2:406) is a plain function on `payment_plan_installments`, not a trigger on any in-scope table. Nothing to delegate-avoid.
4. **B1 (cross-tenant) — confirmed real and the fix is safe.** `PaymentReminderService:404–412` scopes the status update by `.eq('id', reminder.id)` **only**. Adding `.eq('user_id', userId)` in `updateStatus(id, userId, …)` is safe: the sole callers are (a) `sendReminder`, where the row was just inserted with `user_id: userId`, and (b) the cron `processDueReminders`, which calls `sendReminder(reminder.user_id, …)` — so `userId` always equals the row owner. No legitimate cross-user update exists. Cron mutation paths use the separate ⟨unscoped⟩ `deleteById`/`markFailedById`, so they are unaffected.
5. **B2 completeness — confirmed complete.** All phantom-`updated_at` write sites accounted for: reminder service `:410` (sendReminder), `:520` (cancel), `:554` (cancelByInvoice), `:584` (cancelByInstallment), `:672` (markFailed); route `:691` (cancel). No reader anywhere depends on `payment_reminders.updated_at` (grep: zero `reminder.updated_at` / UI consumers). The in-code `PaymentReminder.updated_at` type field (service:43) is presently a lie the DB rejects; dropping the writes is strictly correct. Recommend also removing `updated_at` from that TS interface for honesty (Low).
6. **Complete owner inventory — nothing missed.** Full-tree `.from()` grep matches the workplan's site list 1:1 (workplan line refs are off-by-one vs the `.from(` line — immaterial). The `blocks/execute` route is a genuine 2nd owner of `payment_reminders`: insert `:638` (clean — no `updated_at`, maps to `create`) and cancel `:690` (flexible `reminder_id`|`invoice_id`|`installment_id`, writes phantom `updated_at` → maps to `cancel`/`cancelByInvoice`/`cancelByInstallment`). In-scope-correct.
7. **⟨unscoped-by-design⟩ category — correctly and minimally applied.** The only unscoped methods are the cron reads/mutations: reminders `findDue`/`deleteById`/`markFailedById`/`findRecentByInvoice`/`findRecentByInstallment` (all inside `processDueReminders`/`processOverdueItems`, which iterate all users), events `findByIdUnscoped` (engine `:842`), rules `findByIdUnscoped` (engine `:858`). Both engine unscoped reads live in `processScheduledExecutions`, fed by the cross-user `getScheduledExecutionsDue()` cron — the precedent (`PluginConnectionRepository.markExpired`) applies. Every other method is `user_id`-scoped. Correct.
8. **Rules-only automation scope — safe.** Verified there is **no atomic transaction** spanning `payment_automation_rules` and `payment_automation_executions`; the engine issues independent awaited `.from()` calls. Wrapping rules while leaving executions direct-DB is behavior-preserving. Deferral basis is real: `trigger_event_id` (written `:710`, read `:844`) is absent from the `payment_automation_executions` schema (mig2:260–273) — `createExecution` currently fails, so the scheduled-automation path is already broken; wrapping it would not be behavior-preserving. Correct to defer.
9. **Scope discipline — clean.** No migration, no plugin-op, no `payment_automation_executions` repo, no `payment_methods` repo. `payment_methods` confirmed dead (no `.from()` refs). Grouping (4 files / 6 classes), `{data,error}` result, module-level Pino `createLogger`, singleton export, direct-path import (no barrel), and DI-with-default constructor all match the **phase-1 `PaymentRepository`** precedent. (Note: this precedent intentionally deviates from `REPOSITORY_STRATEGY.md`'s barrel/types.ts guidance and from `PaymentPlanRepository`'s no-default constructor — the workplan follows the correct one.)

### Required changes (itemized)

- **M1 (Medium) — preserve not-found semantics in the processor repo.** `PaymentProcessorService.getProcessor` (`:253–260`) and `getDefaultProcessor` (`:213–238`) treat "no row" as `null` (they tolerate `PGRST116`, they do **not** throw). The new `findByType(userId,type)` and `findDefault(userId)` must replicate this — use `.maybeSingle()` or swallow `PGRST116` and return `{ data: null, error: null }`. If they throw on not-found, the connect/charge/refund flows regress from "no processor → graceful" to "hard error." Call out explicitly in the repo method doc-comments.
- **M2 (Low) — disambiguate the `getDefaultProcessor` fallback (site ~228).** The method surface lists one `findDefault(userId)` but the service has two queries (default row, then any-connected fallback). Decide one: either (a) fold the full "default-else-any-connected" logic into `findDefault(userId)` (cleanest — one repo call, matches the service method's contract), or (b) map `:228` to `findConnected(userId)` and take `[0]` in the service. Prefer (a). State the choice in §2.1 so QA can assert it.
- **M3 (Low) — keep `sendReminder` status update non-fatal.** Today `:404` ignores the update result. After rerouting to `updateStatus`, do **not** let a returned `error` abort the send flow — log-and-continue (the reminder was already dispatched). Add the planned B1 unit test asserting `.eq('user_id', userId)` is present.
- **M4 (Low, informational) — residual embedded rules read.** `getScheduledExecutionsDue` (engine `:811`) reads `payment_automation_rules` via a PostgREST embed (`.select('*, payment_automation_rules(*)')`). It is **not** a `.from('payment_automation_rules')` so the "no direct owner outside repos" goal is still met, but it is a residual join-read that stays because it lives inside the deferred executions query. Note it against the executions deferral so it isn't later mistaken for a missed owner.
- **M5 (Low) — constructor form.** New repos must use `constructor(supabase: SupabaseClient = supabaseServer)` (PaymentRepository style, **with** the default). Do **not** copy `PaymentPlanRepository`'s no-default form. The workplan already says this; reinforcing because both precedents are in the tree.
- **M6 (Low) — stale docs.** `docs/architecture/BUSINESS_OS_DATA_MODEL.md:55` and `docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md:71` still claim `PaymentRepository` owns `payment_methods`. These are one-line edits — either fix them in this phase's doc hygiene or add an explicit deferral line. Don't leave them silently wrong.

### Optimisation suggestions (non-blocking)

- Remove `updated_at` from the `PaymentReminder` and `PaymentEvent` TS interfaces (they don't exist in the DB) so the type stops advertising a field readers might trust.
- Consider a single shared `PaymentRepositoryResult<T>` type reused across the new files rather than re-declaring a per-file result alias, matching phase-1's shared `PaymentRepositoryResult<T>`.

### Approval

[x] Workplan approved to proceed to implementation, conditional on folding M1–M3 into the repo design and acknowledging M4–M6. Re-review not required before coding; SA will verify M1–M3 in the code-review pass.

### 7.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-12**
**Status:** ✅ **APPROVE** — code approved for QA. All required items (M1–M6, B1, B2) are implemented correctly; only Low/informational notes below, none blocking.

**Verification method:** read all 4 repo files + the reminder test file in full; `git diff` on all 5 rerouted source files + 3 M6 docs; grep for residual `.from()`; `npx tsc --noEmit` (baseline confirmed via `git stash`); ran the 4 new test files.

#### Conformance (all 6 classes) — ✅
Constructor `constructor(supabase: SupabaseClient = supabaseServer)` **with default** present on all 6 (M5). `{ data, error }` results reusing the shared `PaymentRepositoryResult<T>` (SA opt applied). Module-level Pino `createLogger({ service })` — **zero `console.*`** in any touched file. Singleton exports present. Direct-path import of the shared result type from `PaymentRepository` (no barrel). Repos swallow and return errors — never throw to callers. Matches phase-1 `PaymentRepository` precedent 1:1.

#### M1 — not-found semantics — ✅
`PaymentProcessorRepository.findByType` (`:129–147`) and `findDefault` (`:91–121`) both use `.maybeSingle()` and return `{ data: null, error: null }` on no-row; documented in doc-comments. Rerouted `PaymentProcessorService.getProcessor` and `getDefaultProcessor` pass the null through (they only branch on `error`), so "no processor → graceful null" is preserved for connect/charge/refund.

#### M2 — findDefault fallback fold — ✅
`findDefault` (`:91–121`) folds both original service queries: default-flag row first, then any-connected (`.limit(1).maybeSingle()`) fallback. Service reduced to a single call. Filters (`is_active`, `connection_status='connected'`) preserved on both branches.

#### B1 — cross-tenant — ✅
`updateStatus(id, userId, patch)` (`PaymentReminderRepository:97–115`) scopes by **both** `.eq('id')` and `.eq('user_id')`. Caller correctness confirmed on both paths: `sendReminder` passes its own `userId` (the row was just inserted with that id); the cron `processDueReminders` calls `this.sendReminder(reminder.user_id, …)` (`PaymentReminderService:604`), so `userId` always equals the row owner. B1 test (`PaymentReminderRepository.test.ts:77–85`) asserts the `user_id` filter is present.

#### B2 — phantom `updated_at` — ✅
None of `updateStatus`/`cancel`/`cancelByInvoice`/`cancelByInstallment`/`markFailedById` write `updated_at`; the `blocks/execute` cancel reroute (`:683–703`) drops it too. B2 tests assert `.not.toHaveProperty('updated_at')` on every update method (`:88–96, 108, 121, 133, 177`). Column-absence re-confirmed against migration `20260723_enhance_payments.sql`: `payment_reminders` (`:293–308`) and `payment_events` (`:181–191`) are `created_at`-only. Tables that DO have `updated_at` (`payment_processors:34`, `saved_payment_methods:348`, `payment_automation_rules:241`) keep manual `updated_at` on every update method — correct (no triggers).

#### M3 — sendReminder non-fatal — ✅
`PaymentReminderService:398–408` captures `statusError` from `updateStatus` and log-and-continues ("non-fatal — reminder already dispatched"); the send flow is not aborted.

#### user_id scoping discipline — ✅
Every scoped method carries `.eq('user_id', userId)` (or embeds `user_id` on insert). The ONLY unscoped methods are the flagged cron ones — reminders `findDue`/`deleteById`/`markFailedById`/`findRecentByInvoice`/`findRecentByInstallment`, events `findByIdUnscoped`, rules `findByIdUnscoped` — each carrying an explicit `⟨unscoped-by-design⟩` doc comment citing the `PluginConnectionRepository` precedent. No scoped method is missing its filter; no unscoped method should have been scoped. The reminder test asserts the unscoped set is exactly the cron methods.

#### Behavior-preservation of reroutes (spot-checked) — ✅
- `getEventCounts`→`listEventTypes`: same `select('event_type')` + date range; JS counting kept in service.
- `processDueReminders`→`findDue`(status=pending, `lte scheduled_at`, asc, limit 100) + `deleteById` + `markFailedById` — identical filters/order.
- `processOverdueItems`→`findRecentByInvoice`/`findRecentByInstallment` (`select('id')`, type, `gte created_at`, limit 1) — identical.
- `setDefaultProcessor`→`clearDefault` then `setDefaultByType` — same two-step, same filters.
- `hasRecentEvent`→`existsRecent` returns bool; service simplified `(data?.length||0)>0` to `!!data` — equivalent.
No semantic drift found.

#### Scope discipline — ✅
No `payment_automation_executions` repo/class; no `payment_methods` repo; engine executions `.from()` calls untouched; no migration; no plugin-op change. **Grep confirms zero direct `.from()` on the 5 tables outside `lib/repositories/`.** M6 docs corrected in all 3 files (data-model, repo-layer requirement, roadmap).

#### tsc + tests
- `npx tsc --noEmit`: **0 new errors** in touched files. The 2 errors on `app/api/payments/blocks/execute/route.ts` (`706` entityId `{}`→string; `952` `entityType:'payment_block'`) are **pre-existing baseline** — confirmed via `git stash` (identical errors at pre-shift lines `714`/`960`). Not authored by this phase.
- Tests: **41 passed / 41** across the 4 new files.

#### Optimisation suggestions (non-blocking, Low)
1. `findDefault` uses `.maybeSingle()` (no `.limit`) on the default-flag branch. If a user ever held two `is_default=true` rows, `maybeSingle()` returns an error where the old `.single()` swallowed it and fell through. The invariant is protected (`clearDefault` runs before `setDefaultByType`), so this is only a pathological edge — optionally add `.limit(1)` to the default branch for total parity. No action required.
2. `PaymentReminderInsert.contact_id` is typed `string` (required) though the DB column is nullable (`ON DELETE SET NULL`). All current callers supply it and the route casts, so it's harmless; consider `string | null` for schema-honesty. Optional.

### Code Approved for QA: **Yes**

---

## 8. QA report

**QA — 2026-08-12**
**Test mode:** full
**Strategy used:** A (Jest unit — mocked Supabase builder) + static source audit + scope grep + `tsc` baseline diff via `git stash`. No dev server (repo-layer/service-routing change; behavior verified at source, not runtime).
**Focus:** api / security (repo layer, user_id scoping, B1/B2)
**Skipped:** live execution (E) — not applicable to a repo-conformance phase; behavior-preservation verified by old-vs-new source read.
**Input source:** prompt keywords (verify at source) + workplan §§1–7.

**Verdict: ✅ PASS-WITH-NOTES** — all acceptance items (M1–M6, B1, B2, scope discipline) verified correct at source; 41/41 tests pass; 0 new typecheck errors. One Low test-coverage gap (2 `create` methods untested). No code bugs found.

### Test + typecheck results
- **Jest:** `4 passed, 4 total` suites — **41 passed / 41 total** (matches the reported ~41). Reminder file explicitly covers B1 (`updateStatus` `.eq('user_id')`) and B2 (`.not.toHaveProperty('updated_at')` on every update method) plus the exact ⟨unscoped⟩ cron set.
- **tsc `--noEmit`:** the ONLY errors on any touched file are the 2 pre-existing baseline errors in `app/api/payments/blocks/execute/route.ts` — `(706,7)` entityId `{}`→string and `(952,7)` `entityType:'payment_block'`. **Verified pre-existing** via `git stash` of the 5 modified source files: baseline reproduces the identical two errors at pre-shift lines `714`/`960`. **0 new errors** in touched files.

### user_id-scoping walk (all 6 classes, every method)
Every scoped method carries `.eq('user_id', userId)` (or embeds `user_id` on insert); the unscoped set is EXACTLY the flagged cron methods, each with a `⟨unscoped-by-design⟩` doc comment citing the `PluginConnectionRepository` precedent. No scoped method missing its filter; no unscoped method that should be scoped.

| Class | Scoped (user_id ✓) | ⟨unscoped-by-design⟩ (doc-commented ✓) |
|---|---|---|
| `PaymentProcessorRepository` | findConnected, findDefault (both branches), findByType, create (insert), update, updateByType, clearDefault, setDefaultByType | — |
| `SavedPaymentMethodRepository` | findById, findValidByContact, clearContactDefaults, create (insert), invalidate | — |
| `PaymentEventRepository` | create, createMany, list, listEventTypes, findRecentByTypes, existsRecent | findByIdUnscoped |
| `PaymentReminderRepository` | create, updateStatus, cancel, cancelByInvoice, cancelByInstallment, list | findDue, deleteById, markFailedById, findRecentByInvoice, findRecentByInstallment |
| `PaymentAutomationRuleRepository` | findActiveForEvent, list, create, update, delete | findByIdUnscoped |

Unscoped set = reminders {findDue, deleteById, markFailedById, findRecentByInvoice, findRecentByInstallment} + events {findByIdUnscoped} + rules {findByIdUnscoped} — matches the sanctioned list **exactly**. ✅

### B1 (cross-tenant) — ✅ confirmed
`PaymentReminderRepository.updateStatus(id, userId, patch)` (`:97–115`) scopes by BOTH `.eq('id')` AND `.eq('user_id')`. The `sendReminder` reroute (`PaymentReminderService:401`) passes the **row owner's** `userId` (from the just-inserted row / from `sendReminder(reminder.user_id, …)` on the cron path — `:604`), never a caller-supplied id. A cross-tenant status update is now impossible: with `.eq('user_id')`, a mismatched user yields 0 matched rows (no error, no-op) rather than mutating another tenant's row. Cron mutations use the separate ⟨unscoped⟩ `deleteById`/`markFailedById`, unaffected. Unit-tested (`PaymentReminderRepository.test.ts:77–85`).

### B2 (phantom `updated_at`) — ✅ confirmed
Grep of the reminder repo + blocks route: **ZERO** `updated_at` writes on `payment_reminders` (`updateStatus`, `cancel`, `cancelByInvoice`, `cancelByInstallment`, `markFailedById` all omit it; route cancel reroute `:686–696` delegates to the repo). Migration `20260723_enhance_payments.sql` confirms `payment_reminders` (`CREATE TABLE :293`) and `payment_events` (`:181`) are `created_at`-only (next `updated_at` at `:348`/`:241` belong to `saved_payment_methods`/`payment_automation_rules`). The 2 residual `updated_at` writes in the blocks route (`:733`, `:794`) are on **`payment_invoices`** — an out-of-scope table that legitimately HAS the column. Not a B2 concern. Unit-tested on every update method.

### M1 / M3 — ✅ confirmed
- **M1:** `findByType` (`:129`) and `findDefault` (`:91`) use `.maybeSingle()` and return `{ data: null, error: null }` on no-row (never throw). `PaymentProcessorService.getProcessor`/`getDefaultProcessor` (`:223`/`:209`) branch only on `error` and pass the null through — "no processor → graceful null" preserved for connect/charge/refund.
- **M3:** `sendReminder` (`PaymentReminderService:398–411`) captures `statusError` from `updateStatus`, logs it non-fatal ("reminder already dispatched"), and does NOT abort the send flow.

### Scope grep — ✅ clean
Zero direct `.from('payment_processors'|'saved_payment_methods'|'payment_events'|'payment_reminders'|'payment_automation_rules')` outside `lib/repositories/`. The engine's `payment_automation_executions` `.from()` calls remain (5 sites: `:670/701/721/750/776`) — UNCHANGED/deferred as intended. No `payment_methods` repo added (`ls lib/repositories | grep payment_methods` → none). Engine rule sites all rerouted through `ruleRepo` (`findActiveForEvent/list/create/update/delete`) + `ruleRepo.findByIdUnscoped`/`eventRepo.findByIdUnscoped` for the cron reads.

### Behavior-preservation spot-check
| Method | Verdict | Notes |
|---|---|---|
| `PaymentEventService.getEventCounts` → `listEventTypes` | ✅ PASS | Same `select('event_type')` + `gte/lte created_at` date range; JS counting kept in the service. |
| `PaymentReminderService.processDueReminders` → `findDue`+`deleteById`+`markFailedById` | ✅ PASS | `findDue`: status=pending, `lte scheduled_at now`, asc, limit 100. `deleteById` on success path, `markFailedById` in catch — same as pre-reroute cron. |
| `PaymentReminderService.processOverdueItems` → `findRecentByInvoice`/`findRecentByInstallment` | ✅ PASS | `select('id')`, `eq reminder_type`, `gte created_at` (24h window), limit 1; dedupe still `!existing || length===0`. |
| `PaymentProcessorService.setDefaultProcessor` → `clearDefault`+`setDefaultByType` | ✅ PASS | Same two-step clear-then-set, same filters. |
| `PaymentProcessorService.getDefaultProcessor` → `findDefault` (M2 fold) | ✅ PASS | Repo folds "default row → else any-connected (`limit(1).maybeSingle()`)" fallback into one call; both branches keep `is_active`+`connection_status='connected'`. |

### Edge cases (PASS/CONCERN, no fix)
- **`findValidByContact` with no methods:** ✅ PASS — returns `{ data: [], error: null }` (`data || []`), not an error.
- **`existsRecent` / `hasRecentEvent` boolean semantics:** ✅ PASS — repo returns `(data?.length||0)>0`; service simplification (`!!data` / bool) is equivalent to the old `(data?.length||0)>0`.
- **`createMany` with empty array:** ✅ PASS — early `return { data: [], error: null }` (`:84`), no insert issued.
- **`updateStatus` for a reminder owned by another user (B1):** ✅ PASS — `.eq('user_id')` yields 0 matched rows; returns `{ data: null, error: null }` (no-op / not-found), does NOT update.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Edge Cases / test-coverage gap (nice to fix — Low)
1. **`PaymentProcessorRepository.create` and `SavedPaymentMethodRepository.create` have no unit test.** — File: `lib/repositories/__tests__/PaymentProcessorRepository.test.ts`. The `new-repository` skill asks for a test per method; every other repo's `create` IS tested (`PaymentEventRepository.create`, `PaymentReminderRepository.create`, `PaymentAutomationRuleRepository.create`), and these two `create` bodies are identical trivial `insert().select().single()` inserts, so risk is Low — but the coverage gap should be noted for Dev. Severity: Low. Not blocking.

### Final Status
- [x] All acceptance criteria (M1–M6, B1, B2, scope discipline, behavior preservation) pass — code is ready for commit.
- [x] One Low test-coverage note (2 `create` methods untested) — optional to address; does not block.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-12 | Created | Drafted from the phase-2 read-only assessment. 5 clean tables → 4 repo files + service routing + 2 reminder bug fixes (B1 cross-tenant, B2 phantom `updated_at`). Deferred: `payment_automation_executions` (phantom `trigger_event_id`/broken engine, user decision), `payment_methods` (dead → drop migration). Plugin-op surface untouched. |
