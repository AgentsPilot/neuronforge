# Business OS — Payment Queue-Drain Fixes (Reminders + Automation Engine)

> **Last Updated**: 2026-08-16
> **Module**: Payments (#4) — follow-on to the phase-2 repo-conformance work ([BUSINESS_OS_PAYMENTS_PHASE2_REPOS_WORKPLAN.md](/docs/workplans/BUSINESS_OS_PAYMENTS_PHASE2_REPOS_WORKPLAN.md) §5, follow-ups F1/F2/F3).
> **Status**: 🟢 **SA code review APPROVE (§11.2) → QA PASS-WITH-NOTES (§12) → 2 of 5 QA notes fixed (§6.6)** — holding for user code review before RM. RM held. QA notes #1 (double-seed race) + #5 (RuleExecution type) fixed; #2/#3/#4 deferred to a Phase-0-convergent follow-up.
> **Branch**: `fix/business-os-payment-queue-drain` (fresh off `main` @ `bc8a5c1`). RM held until user code review.
> **Companion to**: [BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md) §8.1 (canonical durable-queue claim pattern). This is the **first, small application** of that pattern; both queues here must adopt the same claim/lease/dead-letter shape so Phase 0 reuses them cleanly.

## Overview

Two Business OS payment cron drains are **latent-buggy select-then-process queues**, dormant only because their crons aren't registered in `vercel.json`. Scheduling them naïvely activates the bugs (§8.1 R8). This cycle fixes both on the **durable-queue claim pattern** (batched `SELECT … FOR UPDATE SKIP LOCKED` in an RPC → flip to a claimed state with `claimed_by`/`claimed_at`/`attempts`; lease > Vercel `maxDuration` = provably-dead reaper; dead-letter on max attempts; exactly-once *effect* via the queue row's terminal status as the dedupe marker), then wires the crons.

Two follow-up decisions were put to the user (2026-08-14):
- **Task B build-vs-remove** → **FIX IT** (keep payment automation as a near-term feature).
- **Task B authoring surface** → **DEFAULTS ONLY** (seed the 3 coded default rules on payments activation; no CRUD API, no UI this cycle).

## Table of Contents

1. [Scope](#1-scope)
2. [The shared §8.1 claim pattern (applied twice)](#2-the-shared-81-claim-pattern-applied-twice)
3. [Task A — Reminders drain](#3-task-a--reminders-drain)
4. [Task B — Automation engine](#4-task-b--automation-engine)
5. [Task C — payment_methods DROP (F3)](#5-task-c--payment_methods-drop-f3)
6. [Migrations](#6-migrations)
7. [Cron wiring (gated — last)](#7-cron-wiring-gated--last)
8. [Tests](#8-tests)
9. [Guardrails & standards](#9-guardrails--standards)
10. [Risks & open questions for SA](#10-risks--open-questions-for-sa)
11. [SA review](#11-sa-review)
12. [QA report](#12-qa-report)
13. [Post-QA fixes](#13-post-qa-fixes-dev-2026-08-16)
14. [Local dev harness](#14-local-dev-harness)
15. [Rollout — commit + DB apply order](#15-rollout--commit--db-apply-order)

---

## 1. Scope

| Task | What | Decision |
|---|---|---|
| **A** | Rewrite `PaymentReminderService.processDueReminders` to claim rows atomically before dispatch; idempotent send; wire `/api/cron/payment-reminders`. | Clear fix (no decision). |
| **B** | Fix `PaymentAutomationEngine`: durable emit→enqueue (retire the in-process bus), claim-based execution drain, guardrails at the runner choke point, `trigger_event_id` migration + status-vocab reconcile, seed default rules on activation, wire `/api/cron/payment-retry`. | **FIX IT + DEFAULTS ONLY** (user, 2026-08-14). |
| **C** | Confirm `payment_methods` is dead (no prod rows) and add a DROP migration. | Clear (F3). |

### Out of scope (this cycle)
- **Rule-management CRUD API / dashboard UI** for payment automation — deferred (user chose "defaults only"). The engine's `createRule/updateRule/deleteRule/getUserRules` methods stay but are unexposed.
- **Real email/SMS delivery** — the reminder channel senders remain simulated (`return true` TODOs); this cycle fixes the *queue discipline*, not the delivery integration.
- **Retiring the whole in-process `subscribe()` bus platform-wide** — we retire it *on the payment path only*; the generalized `event_reactions` / `processed_reactions` tables are Phase 0.
- Wrapping the reminder/retry services' `payment_invoices` / `payment_plan_installments` / `business_profiles` direct reads (phase-2 §5 out-of-scope, unchanged).

---

## 2. The shared §8.1 claim pattern (applied twice)

Both `payment_reminders` (Task A) and `payment_automation_executions` (Task B) become durable queues with the **same shape**:

**Queue-row columns** (added by migration where missing):
- `status` — the lifecycle state (per-table vocab reconciled below).
- `claimed_by UUID NULL` — the runner instance id that holds the lease.
- `claimed_at TIMESTAMPTZ NULL` — when claimed (lease clock).
- `attempts INT NOT NULL DEFAULT 0` — incremented on each claim; drives dead-letter.
- `next_attempt_at TIMESTAMPTZ NULL` — exponential-backoff gate for retries (nullable = eligible now).

**Claim RPC** (one per table, `SECURITY DEFINER`, service-role only): 
```
SELECT … WHERE status = 'pending' AND due AND (next_attempt_at IS NULL OR next_attempt_at <= now())
ORDER BY scheduled_at
LIMIT p_batch
FOR UPDATE SKIP LOCKED
→ UPDATE those rows SET status='running', claimed_by=p_runner, claimed_at=now(), attempts=attempts+1
RETURNING *;
```
Backed by the existing partial index on `status='pending'` (reminders already has `idx_payment_reminders_scheduled`; executions has `idx_payment_automation_executions_scheduled`). `SKIP LOCKED` ⇒ two overlapping cron runs never grab the same row and never block.

> **[SA correction, 2026-08-14]** The reminders half is correct (`idx_payment_reminders_scheduled` is `… WHERE status='pending'`, mig2:315). The **executions half is wrong**: `idx_payment_automation_executions_scheduled` is partial `… WHERE status='scheduled'` (mig2:279), and Task B (§4b) enqueues/claims on `status='pending'`. That index therefore does **not** back the executions claim. The migration must **add a new partial index `WHERE status='pending'`** (and retire the now-dead `status='scheduled'` one). See SA review M1.

**Reaper (safety-net sweep)** — a second RPC (or a guarded query at drain start): rows still `running` past **lease = maxDuration(60s) + margin** are provably dead → reclaim to `pending` and bump `attempts` (already bumped at claim; the reaper just flips status back and clears `claimed_*`). `attempts >= max_attempts` → terminal `failed` (dead-letter, visible for manual replay) with `next_attempt_at` unset.

**Exactly-once effect** — the queue row's **terminal status is the dedupe marker**: the claim only ever selects `status='pending'`, so a row that reached `sent`/`completed`/`failed` is never re-dispatched. Duplicate effects are bounded to genuine crash-then-reap of a `running` row (at-least-once). *(The generalized `processed_reactions` dedupe table is Phase 0; here the row itself suffices because each queue row maps 1:1 to one effect.)*

**Runner id** — `claimed_by` = a per-invocation UUID (`crypto.randomUUID()`), passed into the RPC. Lease constant lives beside the cron's `export const maxDuration`.

> **SA question (§10 Q1):** confirm the lease margin (proposing lease = 90s vs `maxDuration = 60s`) and whether the reaper should be its own RPC vs folded into the claim call's preamble.

---

## 3. Task A — Reminders drain

### Bug (SA-confirmed)
`processDueReminders`: `findDue` (pending, `scheduled_at<=now`) → loop → `sendReminder` → `deleteById`. **No claim between select and dispatch** → two overlapping runs both send. Secondary smell: `sendReminder` *creates a second reminder row* then the cron *deletes the original*, so each scheduled reminder churns two rows.

### Fix
1. **Migration** adds the claim columns (§2) to `payment_reminders` + `'processing'` to the status vocab (`pending|processing|sent|failed|cancelled`) + a `claim_due_payment_reminders(p_runner uuid, p_batch int)` RPC + reaper.
2. **Rewrite `processDueReminders`** to: call the claim RPC (replaces `findDue`) → for each claimed row, **dispatch on that same row** (extract the contact-lookup + entity-details + channel-send from `sendReminder` into a private `dispatchReminderRow(row)` helper) → `updateStatus` to `sent`/`failed` on that row. **Remove the create-new-then-`deleteById` dance** — the claimed row is the unit of work and of idempotency.
3. **`sendReminder` (public, ad-hoc path) is unchanged in contract** — it still creates+sends its own record for direct callers; it just shares the extracted `dispatchReminderRow` internals. Behavior-preserving for non-cron callers.
4. `PaymentReminderRepository`: add `claimDue(runnerId, batch)` (wraps the RPC via `.rpc()`), `reapStale(...)`; keep `findDue`/`deleteById` only if still referenced (expect `deleteById` drops out). All new cron methods stay **⟨unscoped-by-design⟩** with the existing doc-comment convention.
5. `processOverdueItems` is untouched (it schedules, doesn't dispatch — no double-send risk).

**Idempotency check:** with the claim, a reminder is dispatched by exactly one runner; a crash mid-dispatch leaves it `running` → reaped → retried (attempts bumped) → dead-letters at max. Since the channel senders are currently simulated no-ops, no external dedupe key is needed yet; when real delivery lands, add `dedupe_key = f(reminder.id)` at the send call (noted in code).

---

## 4. Task B — Automation engine

**Decision: FIX IT, DEFAULTS ONLY** (user, 2026-08-14).

### Confirmed defects
1. **Unbounded re-execution** — `processScheduledExecutions` → `executeRuleAction` creates a *new* execution row (status `executing`→`completed`) but **never moves the original `scheduled` row out of `scheduled`**, so every tick re-runs it forever.
2. **Guardrails bypassed** — the scheduled path calls `executeRuleAction`→`callBlockExecutor` directly; the `max_executions_per_entity`/`cooldown` checks live only in `evaluateAndExecuteRule`, which the cron never calls.
3. **Phantom `trigger_event_id`** — written by `createExecution` (`:676`) and read by the cron (`:807`), but **absent from the schema** (mig `:260–273`) → `createExecution` insert fails at runtime.
4. **Status-vocab mismatch** — code uses `executing`/`completed`; schema comment says `executed`; no CHECK constraint (writes succeed but vocab is incoherent).
5. **Broken pub/sub** — `PaymentEventService.subscribe()` pushes to a **module-level** array; `engine.start()` is **never called anywhere**, and a warm-lambda `EventEmitter` drops events on cold start (§8.2). Nothing ever reaches the engine today.
6. **Dormant** — no rule-management API/UI; `createDefaultRules` never called ⇒ zero rules exist even if events flowed.

### Fix design

**(a) Durable emit→enqueue (retire the bus on the payment path).** Replace the fire-and-forget `notifySubscribers` link with a **durable enqueue at the emit boundary**: when a payment event is persisted, evaluate the user's active matching rules (the existing `evaluateAndExecuteRule` condition/limit/cooldown logic) and **INSERT execution rows** into `payment_automation_executions` (the queue) as `status='pending'`, `scheduled_at = now()+delay_minutes`, `trigger_event_id = event.id`. **No dispatch at emit time** — the cron drains. Delete `subscribe()`/`notifySubscribers`/`start()`/`stop()` from the payment path. 
> This is the §8.2-correct fix, **not** the "use the global singleton" option (which §8.2 explicitly rejects as still cold-start-lossy). Flagged for SA (§10 Q2) — I'm deliberately departing from the F2 note's "or use the global singleton" wording because the ratified plan forbids it.
> **Placement question (SA Q2):** enqueue inside `PaymentEventService.emit` (couples emit→engine) vs a thin `paymentAutomationEngine.onEvent(event)` called by `emit` after persist. Proposing the latter — keeps `PaymentEventService` free of engine deps, one call site.

**(b) Claim-based execution drain.** Migration adds the §2 claim columns + `trigger_event_id UUID` + reconciled status vocab (`pending|running|completed|failed|cancelled|dead_letter`) + `claim_due_payment_automation_executions(...)` RPC + reaper. Rewrite `processScheduledExecutions` to: claim due `pending` rows via the RPC → for each, load rule+event (unscoped cron reads, already via repo) → **enforce guardrails at this choke point** → execute the block → set the **claimed row** to `completed`/`failed` (fixes defect 1 — the drained row itself is updated, no phantom second row).

**(c) Guardrails at the runner choke point (fixes defect 2).** Move `max_executions_per_entity` + `cooldown_hours` + a per-entity dedupe check into the drain path, immediately before `callBlockExecutor`, so **no path** (immediate, delayed, manual) can bypass them (§8.1 principle). The enqueue side may pre-filter, but the choke point is authoritative.

**(d) `PaymentAutomationExecutionRepository`** (the phase-2-deferred repo) — new class in `lib/repositories/PaymentAutomationRepository.ts` (same file as the rule repo): `enqueue(row)`, `claimDue(runnerId, batch)` (RPC), `reapStale(...)`, `complete(id)`, `fail(id, msg, opts)`, `countForEntity(...)`, `hasRecentForEntity(...)`, ⟨unscoped⟩ cron reads. All the engine's direct `payment_automation_executions` `.from()` calls route through it (closes the phase-2 §5 deferral). `user_id`-scoped except the flagged cron methods.

**(e) Seed defaults on activation.** Call `createDefaultRules(userId)` when the **payments capability is activated** (idempotent — guard on "rules already exist for user"). Locate the activation hook during implementation (business-os capability activation path); if none cleanly exists, fall back to seeding lazily on first payment event per user (guarded). **SA Q3:** confirm the activation seam.

**(f) Wire the cron** — see §7.

---

## 5. Task C — payment_methods DROP (F3)

`payment_methods` has **zero** `.from('payment_methods')` refs (verified: all `payment_methods` string hits are Stripe-API `paymentMethods` or the live `saved_payment_methods` table). 
1. **Confirm no prod rows first** (SELECT count via a read-only check / ask user to confirm against prod) — **gate the DROP on this**.
2. Add `supabase/migrations/<date>_drop_payment_methods.sql`: `DROP TABLE IF EXISTS payment_methods;` with a commented down-migration note (recreate DDL from `20260722_create_payment_tables.sql` if rollback needed).
3. No code changes (dead table).

---

## 6. Migrations

| File | Contents |
|---|---|
| `<date>_payment_reminders_claim.sql` | Add `claimed_by`/`claimed_at`/`attempts`/`next_attempt_at` + `'processing'` status; `claim_due_payment_reminders` RPC + reaper; partial-index confirm. |
| `<date>_payment_automation_executions_claim.sql` | Add `trigger_event_id UUID` + claim columns; reconcile status vocab; `claim_due_payment_automation_executions` RPC + reaper; index confirm. |
| `<date>_drop_payment_methods.sql` | Task C (gated on no-prod-rows). |

All RPCs `SECURITY DEFINER`, revoke from `anon`/`authenticated`, callable by service role only (the crons use `supabaseServer`). Each migration carries a down-migration comment block (§8.1/§10 rollback discipline). Follow `supabase/migrations/APPLY_MIGRATIONS.md`.

---

## 7. Cron wiring (gated — last)

**Only after the claim/idempotency fixes land + tests pass** (naïve scheduling activates the bugs — explicit user instruction):
- Add to `vercel.json` crons: `/api/cron/payment-reminders` (proposed `0 8 * * *` — daily 08:00) and `/api/cron/payment-retry` (proposed `0 * * * *` — hourly). 
- We're on **Vercel Pro** (8 crons today → 10 after). Confirm the plan cron cap accommodates +2 (SA Q4).
- **Auth gating** already present in both routes (`verifyCronSecret` → `CRON_SECRET` Bearer). Harden the dev bypass note; ensure `CRON_SECRET` is set in the Vercel project (ops note, not code).
- Both routes set `export const maxDuration = 60` (align lease to it) and `export const runtime = 'nodejs'` — add if missing.

---

## 8. Tests

**Core assertion (both queues): the claim prevents double-processing.**
- **Reminders claim test** — simulate two concurrent drains over the same due batch (mock the RPC to model `SKIP LOCKED`: second caller gets the rows the first didn't claim) → assert each reminder dispatched exactly once; assert a `running` row past lease is reaped + `attempts` bumped; assert `attempts>=max` → dead-letter (`failed`), never re-dispatched.
- **Automation drain test** — assert a claimed execution moves `pending→running→completed` (the *same* row; regression test for defect 1: the drained row leaves `scheduled/pending`); assert re-running the cron does **not** re-execute a completed row.
- **Guardrail-at-choke-point test** — an execution whose entity already hit `max_executions_per_entity` (or within `cooldown_hours`) is **skipped at drain time**, proving the delayed path can't bypass guardrails (defect 2).
- **trigger_event_id** — `enqueue` writes it and the drain reads it without a schema error (defect 3 regression).
- **Repo unit tests** — `PaymentAutomationExecutionRepository` (`user_id` scoping on scoped methods; ⟨unscoped⟩ set = exactly the cron methods; `{data,error}` shape) mirroring the phase-2 repo tests.
- **Enqueue-on-emit test** — emitting a matching payment event inserts a `pending` execution row (durable), and emitting with no matching rule inserts none.
- **Task C** — n/a (migration only); manual verify DROP idempotent (`IF EXISTS`).

Jest + mocked Supabase builder (+ mocked `.rpc()`), matching the phase-2 repo test style. No live dev server (queue-discipline logic is unit-testable; the reminder/automation crons have no browser surface).

---

## 9. Guardrails & standards
- **Repository pattern** — all new `payment_automation_executions` access via `PaymentAutomationExecutionRepository`; no direct `.from()` on the queue tables outside `lib/repositories/`. `user_id` scoping on every method except the flagged ⟨unscoped-by-design⟩ cron methods (each doc-commented, `PluginConnectionRepository` precedent).
- **Pino only** — touched files are already Pino-clean; keep them so (`process-queue/route.ts` uses `console.error` but is **not** touched here — leave it).
- **Zod** — cron routes have no user input to validate (auth-gated GET); the enqueue path validates rule action params against the block's schema at the choke point (fail-closed → dead-letter, §5.1 principle).
- **No hardcoding** — no plugin-specific logic in the engine; rules reference blocks by id via `getBlock`.
- **TypeScript strict** — no new `any`; reconcile the `RuleExecution.status` union with the new vocab.

---

## 10. Risks & open questions for SA
- **Q1 — lease/reaper shape.** Lease = 90s vs `maxDuration` 60s OK? Reaper as its own RPC vs claim-preamble?
- **Q2 — emit→enqueue placement + bus retirement.** Confirm departing from F2's "or use the global singleton" in favor of durable enqueue (§8.2 forbids the bus). Enqueue via `engine.onEvent(event)` called from `emit`, not inside `PaymentEventService`?
- **Q3 — default-rules activation seam.** Where is payments-capability activation? Acceptable fallback = lazy guarded seed on first event?
- **Q4 — Vercel Pro cron cap** for +2 crons (8→10).
- **Q5 — scope check.** Is the emit→enqueue kick within "fix the engine," or does it stray toward Phase 0? (I read it as the minimal durable replacement for the dead bus, required for the engine to function at all — but flagging.)
- **Q6 — reminders row-model change.** OK to drop the create-new-then-delete dance and dispatch on the claimed row (one row per reminder), or must `processDueReminders` preserve the two-row behavior for any downstream reader? (I found none.)

---

## 6.5 Implementation notes (Dev)

**Implemented by Dev — 2026-08-14. Status: Code Complete (pending SA re-review + QA).**

### Files created

| File | Purpose |
|---|---|
| `supabase/migrations/2026-08-14_payment_reminders_claim.sql` | Reminders claim columns + `claim_due_payment_reminders` / `reap_stale_payment_reminders` RPCs (SECURITY DEFINER, REVOKEd from anon/authenticated), status-vocab header, down-migration. |
| `supabase/migrations/2026-08-14_payment_automation_executions_claim.sql` | Executions `trigger_event_id` + claim columns, **M4** legacy-status remap, **M1** drop `…_scheduled` / create `…_pending` partial index, `claim_due_…` / `reap_stale_…` RPCs, down-migration. |
| `supabase/migrations/2026-08-14_drop_payment_methods.sql` | **M7** gated DROP with `-- GATE:` no-prod-rows comment + full CREATE TABLE down-migration. |
| `lib/payments/ruleEvaluation.ts` | Pure, dependency-free (type-only imports): `evaluateConditions`/`getValueFromContext`/`evaluateCondition`/`buildActionParameters`/`getEventValue`. Shared by engine + enqueuer. |
| `lib/payments/defaultPaymentRules.ts` | `DEFAULT_PAYMENT_RULES` + idempotent guarded `ensureDefaultPaymentRules(userId, ruleRepo)`. |
| `lib/payments/paymentReactionEnqueuer.ts` | **M2** repo-only emit→enqueue seam (imports only repos + pure helpers + seed; no engine, no PaymentEventService). |
| `lib/repositories/__tests__/PaymentAutomationExecutionRepository.test.ts` | Repo unit tests. |
| `lib/payments/__tests__/paymentReactionEnqueuer.test.ts` | Enqueue-on-emit tests. |
| `lib/services/__tests__/PaymentReminderService.drain.test.ts` | Reminder claim-drain test (SKIP LOCKED model). |
| `lib/services/__tests__/PaymentAutomationEngine.drain.test.ts` | Automation claim-drain test (defect-1 + choke-point regressions). |

### Files modified

| File | Change |
|---|---|
| `lib/repositories/PaymentAutomationRepository.ts` | **M6** added `PaymentAutomationExecutionRepository` (grouped-multi-class) + singleton `paymentAutomationExecutionRepository`; header rewritten. |
| `lib/repositories/PaymentReminderRepository.ts` | Added `claimDue`/`reapStale`; removed now-dead `findDue`/`deleteById`/`markFailedById`. |
| `lib/services/PaymentEventService.ts` | Retired `subscribe`/`notifySubscribers`/`eventSubscribers`/`EventCallback`; `emit`/`emitBatch` now call `enqueuePaymentReactions(...)` non-blocking. |
| `lib/services/PaymentAutomationEngine.ts` | Removed the dead bus + immediate/scheduled create paths; rewrote `processScheduledExecutions` as the reap→claim→guardrail→execute→terminal drain; constants `LEASE_SECONDS=90`/`MAX_ATTEMPTS=5`/`BATCH=100`; `RuleExecution.status` reconciled; `createDefaultRules` delegates to `ensureDefaultPaymentRules`. |
| `lib/services/PaymentReminderService.ts` | Extracted `dispatchReminderRow`; rewrote `processDueReminders` to reap→claim→dispatch-on-claimed-row→updateStatus (no create-then-delete); added `processing` to `ReminderStatus`; constants. |
| `app/api/cron/payment-reminders/route.ts`, `app/api/cron/payment-retry/route.ts` | Added `export const runtime='nodejs'` + `maxDuration=60`. |
| `vercel.json` | Added the two cron entries (`payment-reminders` `0 8 * * *`, `payment-retry` `0 * * * *`) — 8→10 crons. |

### How M1–M9 + Q1–Q6 were handled

- **M1** — executions migration drops `idx_payment_automation_executions_scheduled` and creates `idx_payment_automation_executions_pending … WHERE status='pending'`.
- **M2** — enqueue lives in `paymentReactionEnqueuer.ts` importing ONLY repositories + pure helpers + the seed; `PaymentEventService.emit` calls it. No `engine.onEvent`; the engine no longer constructs `PaymentEventService` (field removed) — cycle broken.
- **M3** — `countCompletedForEntity(…, excludeId)` counts prior **terminal `completed`** rows with `.neq('id', excludeId)`; `hasRecentForEntity(…, excludeId)` excludes self. Both run at the drain choke point immediately before `callBlockExecutor`; a self-block is impossible (regression-tested).
- **M4** — new vocab `pending|running|completed|failed|cancelled|dead_letter`; migration defensively remaps legacy `scheduled→pending`, `executed→completed`, `executing→running`; `RuleExecution.status` union updated; no CHECK added.
- **M5** — reminders use `processing`, executions use `running`; each table's vocab is documented in its migration header and used consistently in code.
- **M6** — `PaymentAutomationExecutionRepository` conforms (supabaseServer default, `PaymentRepositoryResult`, module Pino, singleton, `.eq('user_id')` on `enqueue`; the 6 cron methods carry the ⟨unscoped-by-design⟩ doc-comment with the PluginConnectionRepository precedent). Scope grep for `from('payment_automation_executions')` outside `lib/repositories/` is empty.
- **M7** — DROP migration carries the `-- GATE:` no-prod-rows comment (cannot verify prod from the repo) + full CREATE TABLE down-migration.
- **M8** — informational; no code change. Batch stays `LIMIT 100`.
- **M9** — forward-compat note carried in the engine file header + migration companion reference; retire this drain during the rule-engine cutover.
- **Q1** — `LEASE_SECONDS=90` (> `maxDuration=60`); reaper is its **own RPC**, run before the claim.
- **Q2** — durable repo-only enqueue (bus retired), per M2.
- **Q3** — no activation seam exists; lazy guarded seed via `ensureDefaultPaymentRules` on first event, inside the enqueuer.
- **Q4** — 8→10 crons; within Vercel Pro's cap (ops must confirm the account tier + `CRON_SECRET` before merge).
- **Q5** — enqueue kept payment-local (existing queue table); no generalized `event_reactions` infra.
- **Q6** — reminders dispatch on the claimed row; create-then-delete dance removed.

### Verification

- **Tests:** 5 new suites (26 tests) pass; full payment suite **9 suites / 61 tests pass**.
- **tsc:** `npx tsc --noEmit` → **zero NEW errors on touched files** (pre-existing errors remain in untouched files: `app/api/payments/*` Stripe-version/EntityType, `EntityResolver.ts`, `scripts/check-invoice-proration.ts`).
- **Grep 1:** `from('payment_automation_executions')` outside `lib/repositories/` → empty ✓
- **Grep 2:** `subscribe|notifySubscribers|eventSubscribers` in the two services → empty (code) ✓

### Notes for SA/QA
- Migrations are **not applied** (no prod access). SA/ops must apply the 3 migrations and confirm the M7 no-prod-rows gate before the crons run.
- Crons are wired in `vercel.json` per the workplan, but the fixes they depend on are all in place and green (per the "don't wire before compile+tests" constraint — satisfied).
- `callBlockExecutor` remains a placeholder (out of scope, per §4).
- RM held — no commit made.

---

## 11. SA review

**Reviewed by SA — 2026-08-14**
**Status:** 🔄 **APPROVE-WITH-CHANGES** — the diagnoses and the §8.1 pattern application are sound; fold M1–M3 (blocking) into the design before coding, and address M4–M9 (non-blocking) during implementation. No re-review required before coding; SA verifies M1–M3 at the code-review pass.

### Verification performed (against live source + migrations)

Every load-bearing claim was checked file:line. All are **accurate** except one index claim (M1):

1. **Reminders double-send + two-row churn (§3 bug) — confirmed.** `processDueReminders` (`PaymentReminderService:593`) calls `findDue` (pending, `scheduled_at<=now`, no status flip) then loops → `sendReminder(reminder.user_id, …)` which **inserts a fresh reminder row** (`:349`) and afterwards the cron **`deleteById(reminder.id)`** deletes the original (`:617–619`). Two overlapping runs both select the same pending rows and both dispatch (no claim); each scheduled reminder churns two rows. Both smells real.
2. **Automation unbounded re-execution (defect 1) — confirmed.** The immediate path `executeRuleAction` (`:315`) creates a **new** execution row `executing→completed`; the scheduled path `scheduleExecution` (`:375`) creates a `scheduled` row, and `processScheduledExecutions` (`:795`→`getScheduledExecutionsDue` filters `status='scheduled'`, `:778`) never moves that row out of `scheduled`, so every drain re-runs it. Confirmed.
3. **Guardrails bypassed (defect 2) — confirmed.** `max_executions_per_entity`/`cooldown` live only in `evaluateAndExecuteRule` (`:204–238`); the cron enters at `processScheduledExecutions`→`executeRuleAction` (`:831`) which **skips** them.
4. **Phantom `trigger_event_id` (defect 3) — confirmed.** Written by `createExecution` (`:676`) and read by the cron (`:807`); **absent** from `payment_automation_executions` (mig2:260–273). `createExecution`'s insert fails at runtime → the scheduled-automation path is already broken (matches phase-2 §5 deferral basis).
5. **Status-vocab mismatch (defect 4) — confirmed.** Code uses `executing`/`completed`; schema comment says `executed` (mig2:267); **no CHECK constraint** exists, so writes succeed but the vocab is incoherent. (Note: the *absence* of a CHECK makes the reconcile safe — see M4.)
6. **Dead bus (defect 5) — confirmed with grep.** `eventSubscribers` is a **module-level** array (`PaymentEventService:122`); `subscribe()` is only called inside `engine.start()` (`:127`), and **`start()` has zero callers anywhere** (`grep`). The cron only calls `processScheduledExecutions`. So nothing reaches the engine today. `emit()` → `notifySubscribers` (`:167`) fans out to an empty array. Confirmed dead.
7. **Dormant / no rules (defect 6) — confirmed.** `createDefaultRules` (`:583`) has **zero callers** (`grep`); no rule-management route exists. Even if events flowed, no rules exist.
8. **Task C — confirmed safe.** No app `.from('payment_methods')` (only the two DDL migrations); **no inbound FK** `REFERENCES payment_methods` anywhere (`grep`). DROP is FK-safe.
9. **Cron routes — confirmed.** Neither `payment-reminders` nor `payment-retry` sets `maxDuration`/`runtime` (`grep` empty) — must be added (§7). `verifyCronSecret` (Bearer `CRON_SECRET`, dev-bypass, unprotected-if-unset) present in both.
10. **`vercel.json` — confirmed 8 crons** (run-scheduled-agents, cleanup-incomplete, update-template-scores, memory-consolidation, calendar-sync, insight-metrics, insight-detect, insight-automations). +2 → 10.

### Fidelity of the §2 claim pattern to migration-plan §8.1 — endorsed

The shape is faithful to §8.1: batched `SELECT … FOR UPDATE SKIP LOCKED` in a `SECURITY DEFINER` RPC; claim flips `pending→running`/`processing` with `claimed_by`/`claimed_at` and bumps `attempts`; **lease > `maxDuration` = provably-dead reaper** (R11) reclaims to pending / dead-letters at `attempts>=max`; **terminal status as the 1:1 dedupe marker** (§8.1's "the row itself suffices because each queue row maps 1:1 to one effect"). At-least-once effect bounded to crash-then-reap. No divergence from the ratified pattern. The one index assertion is wrong (M1); everything else in §2 is correct.

### Answers to Q1–Q6

- **Q1 (lease/reaper).** Lease = 90s vs `maxDuration` 60s is **acceptable** (30s margin over a hard kill). Since the reaper only runs at drain start on hourly/daily cadences, the margin isn't latency-critical — either 90s or a more generous 120s is fine; keep it a **named constant beside `export const maxDuration`** in each route and pass it into the reaper. **Prefer the reaper as its own RPC (or a guarded `UPDATE` run before the claim)**, not folded into the claim preamble — it keeps the claim single-purpose and independently testable, and matches the §8.1 "safety-net sweep" framing.
- **Q2 (emit→enqueue placement + bus retirement). Departing from F2's "or use the global singleton" is CORRECT** — §8.2 forbids the in-process bus; durable enqueue is the ratified replacement. **But the proposed `PaymentEventService.emit → paymentAutomationEngine.onEvent(event)` wiring does NOT "keep PaymentEventService free of engine deps" — it introduces a circular import** (`PaymentAutomationEngine` constructs `new PaymentEventService(...)` at `:106`; making `PaymentEventService` import the engine singleton creates a module-eval cycle → TDZ/`undefined` at the `paymentAutomationEngine = new …` top-level, a real cold-start crash risk). **Required (M2):** put the enqueue logic in a small **repo-only seam** (evaluate rules via `PaymentAutomationRuleRepository` → INSERT `pending` rows via the new executions repo) that imports **only repositories**, and call it from `emit()` after persist. That breaks the cycle (emit → enqueuer → repos; no back-import of `PaymentEventService` or the engine) and genuinely keeps `PaymentEventService` engine-free. The engine keeps only the **drain** (`processScheduledExecutions` rewrite). One call site, no cycle.
- **Q3 (activation seam). Searched the codebase: there is NO application-level write path that activates a capability.** Every `user_capabilities` reference is a `.select` read (`UserCapabilityRepository`, `/api/capabilities`, `/api/business-os/stats`); no `insert`/`upsert`/activation route exists (rows are seeded outside app code — onboarding/DB seed `20260722_create_capability_building_blocks.sql`). **Therefore the "seed on payments-capability activation" hook does not exist to hang off.** Adopt the workplan's fallback as the **primary** approach: **lazily seed `createDefaultRules(userId)` on the first payment event per user, guarded on "rules already exist for this user"** (a `list(userId,{limit:1})` check, or an idempotent upsert on a natural key). Put the guarded seed in the same emit-time enqueuer seam (M2) so it runs exactly where events first appear. Do **not** invent a new activation table this cycle.
- **Q4 (Vercel Pro cron cap).** Confirmed 8 crons today → 10 after. Vercel Pro's documented cap is **40 cron jobs** (Hobby = 2, daily-only/best-effort), so +2 is comfortably within — and the **hourly** `payment-retry` cadence *requires* Pro (Hobby can't run sub-daily). The plan **tier itself is an account fact not verifiable from the repo** — confirm with ops before merge; the count claim is correct.
- **Q5 (scope of the emit→enqueue kick).** **In scope, not scope-creep.** The engine cannot function without *some* event→execution path, and the bus is dead. A payments-table-scoped durable enqueue into the **existing** `payment_automation_executions` queue is the minimal "fix the engine" change. It must **not** build the generalized `event_reactions`/`processed_reactions` infra (that is Phase 0) — keep it payment-local so Phase 0/3 can later subsume it. **Forward-compat (M9):** when the event-driven migration later moves payment reactions onto the rule engine, **this drain must be retired as part of that cutover** to avoid double-fire across two engines (migration-plan R8).
- **Q6 (reminders row-model change). Approved — dispatch on the claimed row; drop the create-new-then-delete dance.** No downstream reader depends on the two-row behavior: reminder consumers are `list`/`getReminders` (history views) and the overdue-dedup `findRecentBy*` (keys on `invoice_id`/`installment_id`+type+window, not on row count). One row per reminder transitioning `pending→processing→sent/failed` is strictly cleaner and is the unit of idempotency. Keep the public `sendReminder` contract intact via the extracted `dispatchReminderRow(row)` helper (good design).

### Required changes (itemized)

| # | Change | Severity | Blocking |
|---|---|---|---|
| **M1** | **Executions claim needs a `WHERE status='pending'` partial index.** §2's assertion that `idx_payment_automation_executions_scheduled` backs the executions claim is **false** — that index is partial on `status='scheduled'` (mig2:279) while Task B claims on `pending`. The `<date>_payment_automation_executions_claim.sql` migration must **CREATE a new partial index on `(scheduled_at) WHERE status='pending'`** (optionally also on `next_attempt_at`) and drop/replace the now-dead `status='scheduled'` one. "index confirm" (§6) is insufficient — this is a create, not a confirm. (Reminders index is fine as-is.) | **Medium** | **Yes** |
| **M2** | **Emit→enqueue seam must be repo-only, not `engine.onEvent`.** As written it creates a `PaymentEventService ↔ PaymentAutomationEngine` circular import (engine constructs `PaymentEventService` at `:106`) → module-eval crash risk. Extract the enqueue (rule-eval + INSERT `pending`) into a seam depending only on `PaymentAutomationRuleRepository` + the new executions repo, called from `emit()` after persist. Retire `subscribe()`/`notifySubscribers`/`start()`/`stop()` on the payment path. | **Medium-High** | **Yes** |
| **M3** | **Define choke-point guardrail semantics so a drained row can't block itself.** Today `getExecutionCountForEntity` (`:714`) counts `['completed','executing','scheduled']` and is checked *before* the row exists. In the new model the row is INSERTed at emit and is `running` at drain, so a naïve re-count **includes self** → with `max_executions_per_entity=1` the first execution self-blocks. Specify that the choke-point guardrail counts **prior terminal `completed` executions excluding the current row** (and cooldown excludes self), and update the count/cooldown status filters to the new vocab. | **Medium** | **Yes** |
| **M4** | **Reconcile the executions status vocab end-to-end.** New vocab `pending\|running\|completed\|failed\|cancelled\|dead_letter`: update `RuleExecution.status` union (drop `scheduled`/`executing`), `getExecutionCountForEntity`/`hasRecentExecution` `.in(...)` filters, and delete the dead `getScheduledExecutionsDue` (`status='scheduled'`) path (replaced by `claimDue`). If you add a CHECK constraint, **defensively remap any legacy `scheduled`/`executing`/`executed` rows first** (table is effectively dark, so low risk). | **Low-Medium** | No |
| **M5** | **Keep the per-table status term internally consistent.** Reminders use `processing` (§3.1), executions use `running` (§4b) — fine to differ across tables, but each table's claim/reaper/complete paths and the drain code must use its own term consistently. Enumerate each table's final vocab in the migration header. | **Low** | No |
| **M6** | **`PaymentAutomationExecutionRepository` conformance.** New class in `PaymentAutomationRepository.ts` (grouped-multi-class precedent — matches `PaymentProcessorRepository.ts`). Constructor `= supabaseServer` default, `{data,error}`/`PaymentRepositoryResult<T>`, module-level Pino, singleton, direct-path import, **`.eq('user_id', userId)` on every method except the flagged ⟨unscoped-by-design⟩ cron methods** (`claimDue`/`reapStale`/`complete`/`fail` operate cross-user by row id — doc-comment each with the `PluginConnectionRepository` precedent, exactly as the phase-2 repos do). Route **all** engine `payment_automation_executions` `.from()` calls (`:670/701/721/750/776`) through it — closes the phase-2 §5 deferral; a scope grep for `.from('payment_automation_executions')` outside `lib/repositories/` must return zero. | **Low** | No |
| **M7** | **Task C DROP safety.** Gate on the no-prod-rows check (already planned) — FK-safe confirmed (no inbound `REFERENCES payment_methods`). Keep the full `CREATE TABLE` DDL from `20260722_create_payment_tables.sql` in the down-migration comment. | **Low** | No |
| **M8** | **Backlog/scale note (informational).** Daily reminders cron + `LIMIT 100` claim drains ≤100/day; a backlog >100 bleeds over multiple days. Fine at SMB volume — note it; raising the batch or cadence is a later lever, not this cycle. | **Low** | No |
| **M9** | **Forward-compat with the event-driven migration.** Add a one-line note that this drain is a **payment-local** stopgap; when the rule-engine migration migrates payment reactions, retire/disable this drain in the same cutover to avoid double-fire (R8). | **Low** | No |

### Optimisation suggestions (non-blocking)
- Make `claimDue` return the claimed rows via the RPC's `RETURNING *` in one round-trip (as §2 states) — don't claim-then-reselect.
- Consider a `dead_letter`-only partial index if you build a manual-replay view later; not needed now.
- When real delivery lands (out of scope), add the `dedupe_key = f(reminder.id)` at the send call as the workplan already notes — the claimed-row model makes that a clean drop-in.

### Approval
[x] Workplan approved to proceed to implementation, **conditional on folding M1–M3 before/into coding** and addressing M4–M9 during implementation. Re-review not required before coding; SA will verify M1–M3 (index, seam-not-cycle, self-count guardrail) plus repo conformance (M6) at the code-review pass.

---

### 11.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-14** (branch `fix/business-os-payment-queue-drain`, diff `main...HEAD`)
**Status:** ✅ **APPROVE** — all 9 required changes (M1–M9) and Q1–Q6 verified against the diff. Tests green, zero new tsc errors on touched files.

#### Blocking-item verification (M1–M3 + claim/reaper + bus retirement + repo conformance)

| Check | Evidence (file:line) | Verdict |
|---|---|---|
| **M1** — drop `…_scheduled`, create `WHERE status='pending'` index backing the claim | `…_payment_automation_executions_claim.sql:50–52` `DROP INDEX …_scheduled` + `CREATE INDEX …_pending ON (scheduled_at) WHERE status = 'pending'`; claim filters `status='pending'` (`:73`) | ✅ |
| **M2** — enqueuer imports ONLY repos + pure helpers (no `PaymentEventService`, no engine); no cycle | `paymentReactionEnqueuer.ts:18–26` imports `createLogger`, the two repos, `evaluateConditions`, `ensureDefaultPaymentRules`, and **type-only** (`import type`) `PaymentEvent`/`RuleEvaluationContext` (erased). `PaymentEventService.ts:16` imports the enqueuer (one-way). Engine no longer constructs `PaymentEventService` — constructor builds only `ruleRepo`+`eventRepo` (`PaymentAutomationEngine.ts:110–113`). Import graph: emit → enqueuer → repos; drain: engine → repos + pure helpers. **No runtime cycle.** | ✅ |
| **M3** — choke-point counts prior terminal `completed`, excludes self | `PaymentAutomationRepository.ts:237–251` `countCompletedForEntity(...excludeId)` filters `.eq('status','completed').neq('id', excludeId)`; called with `execution.id` at the choke point (`PaymentAutomationEngine.ts:328–333`); cooldown `hasRecentForEntity` also `.neq('id', excludeId)` (`:283`). A just-claimed `running` row with `max=1` cannot self-block (regression-tested `PaymentAutomationEngine.drain.test.ts:110–119`). | ✅ |
| **Claim RPC** — `FOR UPDATE SKIP LOCKED`, batched, single-round-trip `RETURNING *`, `SECURITY DEFINER`, REVOKEd | executions `…_claim.sql:57–82,123`; reminders `…_reminders_claim.sql:42–67,109`. `claimDue` wraps the RPC, no reselect (`PaymentAutomationRepository.ts:302–315`). | ✅ |
| **Reaper** — own RPC, lease>maxDuration, dead-letters at max attempts, runs before claim | executions reaper `…_claim.sql:88–118` (dead_letter at `attempts>=max`, else back to pending w/ backoff); `LEASE_SECONDS=90 > maxDuration=60` (`PaymentAutomationEngine.ts:34`, route `:26`); drain calls `reapStale` then `claimDue` (`:287–301`). Reminders identical, dead-letter → `failed`. | ✅ |
| **Bus retirement** — `subscribe`/`notifySubscribers`/`eventSubscribers`/`start`/`stop` gone | grep on both services returns only a doc-comment mention (`PaymentAutomationEngine.ts:10`); no live symbols. `emit`/`emitBatch` call `enqueuePaymentReactions` non-blocking (`PaymentEventService.ts:164,204`). | ✅ |
| **Defect-1 regression** — claimed row moves pending→running→completed (same row, no phantom) | `PaymentAutomationEngine.ts:359` `complete(execution.id, …)`; test asserts `complete` called once on `exec-1`, second drain no-ops (`PaymentAutomationEngine.drain.test.ts:94–108`). Reminders: no create-then-delete; dispatch on claimed row + `updateStatus` (`PaymentReminderService.ts:632–646`); `findDue`/`deleteById` removed from repo. | ✅ |
| **M6** — `PaymentAutomationExecutionRepository` conformance | `PaymentAutomationRepository.ts:198` ctor `= supabaseServer`; `PaymentRepositoryResult<T>` throughout; module Pino (`:26`); singleton (`:387`); direct-path import; `enqueue` embeds `user_id` (`:210`); 6 cron methods each carry the ⟨unscoped-by-design⟩ + PluginConnectionRepository precedent doc-comment. Grep: zero `.from('payment_automation_executions')` outside `lib/repositories/`. | ✅ |

#### Non-blocking items

| Item | Verdict | Evidence |
|---|---|---|
| **M4** — status vocab reconciled end-to-end | ✅ | Union `pending\|running\|completed\|failed\|cancelled\|dead_letter` (`PaymentAutomationEngine.ts:83`); migration legacy remap `scheduled→pending`/`executed→completed`/`executing→running` (`…_claim.sql:41–43`); `.in(...)`/`.eq('status',…)` filters use new vocab; no CHECK (deliberate, documented). |
| **M5** — per-table term consistency | ✅ | Reminders `processing`, executions `running`; each migration header enumerates its vocab. |
| **M7** — Task C DROP gated + down-migration DDL | ✅ | `…_drop_payment_methods.sql:13–17` `-- GATE:` no-prod-rows note; full `CREATE TABLE` + indexes + RLS in down-migration comment (`:25–67`). |
| **M8/M9** — backlog note / forward-compat | ✅ | Engine header + `§6.5` notes; `BATCH=100`. |
| **Standards** — no console.* in touched files; TS strict; Zod n/a (auth-gated GET, no user input) | ✅ | grep clean; `npx tsc --noEmit` → zero errors on touched payment queue-drain files. |
| **Cron wiring** | ✅ | `runtime='nodejs'`+`maxDuration=60` on both routes; `vercel.json` 8→10 crons (`payment-reminders 0 8 * * *`, `payment-retry 0 * * * *`). |

#### Tests
`npx jest` payment suite → **9 suites / 61 tests pass**; the 4 queue-drain suites (15 tests) assert the SKIP-LOCKED model, exactly-once dispatch, defect-1 same-row completion, and the M3 self-exclusion guardrail. Genuine assertions, not vacuous.

#### Optimisation suggestions (non-blocking, do NOT block QA)
1. **Same-batch entity dedup.** `max_executions_per_entity` counts only prior **`completed`** rows; two `pending` rows for the same (rule, entity) claimed in one batch both see count 0 and both execute. The cooldown check (`hasRecentForEntity` includes `running`, excludes self) covers this only when `cooldown_hours` is set — which all three default rules set, so no live gap today. Worth a one-line note if a future default rule omits cooldown; matches the M3 spec exactly, so non-blocking.
2. `ensureDefaultPaymentRules` runs a guarded `list(userId,{limit:1})` on every emit (one extra read/event). Fine at SMB volume; a per-process seeded-user cache is a later lever.

#### Operational gate (carried, not a code defect)
Migrations are **not applied** (no prod access). Ops must apply the 3 migrations and confirm the M7 no-prod-rows gate (`SELECT count(*) FROM payment_methods = 0`) and `CRON_SECRET` before the crons run. This is the only thing standing between merge and live drain.

### Code Approved for QA: **Yes**

---

## 12. QA report

**QA — 2026-08-16**
**Test mode:** full
**Strategy used:** B (Jest unit/integration) + static source audit + tsc baseline diff. No dev server — the crons have no browser surface; queue-discipline logic is unit-testable and the RPC concurrency guarantee (SKIP LOCKED) lives in SQL that can only be read, not applied (no DB).
**Focus:** api (crons) / security (RLS-scoping + SECURITY DEFINER lockdown) / schema (status vocab) / performance (per-emit seed)
**Skipped:** e2e (no UI); live migration apply (no DB access — see Not-verifiable below)
**Input source:** prompt keywords (QA full) + workplan §8 test scope

### Test & typecheck results

| Check | Result |
|---|---|
| `npx jest lib/repositories/__tests__/Payment lib/payments lib/services/__tests__/Payment` | **9 suites / 61 tests — all pass** (25.3s) |
| New suites (5): `paymentReactionEnqueuer` (3), `PaymentAutomationEngine.drain` (3), `PaymentReminderService.drain` (2), `PaymentAutomationExecutionRepository` (8), `PaymentReminderRepository` (modified) | pass |
| `npx tsc --noEmit` — with changes | 1983 errors (all pre-existing, repo-wide) |
| tsc baseline via `git stash push -u` | 1983 errors — **identical** |
| **New tsc errors introduced** (`comm -13 base with`) | **0** |
| tsc errors on any touched file | **0** |
| Grep 1: `from('payment_automation_executions')` outside `lib/repositories/` | empty ✓ |
| Grep 2: `subscribe`/`notifySubscribers`/`eventSubscribers` in the two services | only doc-comment mentions; no code ✓ |
| Grep 3: legacy `'scheduled'`/`'executing'`/`getScheduledExecutionsDue` in engine/repo | empty ✓ |
| Grep 4: stray callers of removed methods (`findDue`/`deleteById`/`start`/`stop`/`scheduleExecution` on payment path) | none (remaining `createExecution`/`subscribe` hits are unrelated `agentExecutionEngine`/`DebugSessionManager`) ✓ |

### Acceptance-criteria walk

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Double-processing prevention (both queues) | ✅ | Pass* | Claim RPCs select `status='pending'` only, `FOR UPDATE SKIP LOCKED`, flip to running/processing + bump attempts atomically (verified in both SQL files). Terminal rows are never re-selected. Drain tests model SKIP LOCKED (second concurrent drain gets a disjoint empty batch) and assert exactly one dispatch/complete per row. *The true cross-process guarantee lives in the un-unit-testable RPC — read and correct, but cannot be exercised without a DB (see Not-verifiable). |
| Defect-1 (automation same-row transition) | ✅ | Pass | `PaymentAutomationEngine.drain` asserts `complete()` is called with the **claimed row's** id (`exec-1`); no phantom second row; a second empty claim does not re-execute the completed row. Drain calls `complete(execution.id)` on the claimed row. |
| Defect-2 (guardrail at drain choke point) | ✅ | Pass | M3 `countCompletedForEntity` counts only terminal `status='completed'` with `.neq('id', excludeId)`; enforced immediately before `callBlockExecutor`. Test asserts skip when count≥max and that self is excluded (`countCompletedForEntity('rule-1','invoice','inv-1','exec-1')`), so a freshly-claimed row cannot self-block. |
| Reminders churn removed / dispatch on claimed row / `sendReminder` contract | ✅ | Pass | create-new-then-`deleteById` dance gone; `processDueReminders` reap→claim→`dispatchReminderRow(row)`→`updateStatus` on the same row. Public `sendReminder` preserved (still returns `{ sent, reminderId }`, shares the extracted helper). |
| `trigger_event_id` (defect-3) | ✅ | Pass | Migration adds `trigger_event_id UUID REFERENCES payment_events(id)`. `enqueue` writes it (repo insert + test assertion); drain reads `execution.trigger_event_id` → `eventRepo.findByIdUnscoped`. Enqueuer test asserts the row carries `trigger_event_id: 'evt-1'`. |
| Bus retired | ✅ | Pass | Grep 2 confirms `subscribe`/`notifySubscribers`/`eventSubscribers` are gone from both services (comment references only). `emit`/`emitBatch` call `enqueuePaymentReactions(...)` non-blocking via `.catch()`. |
| Scope grep (repo-only queue access) | ✅ | Pass | Grep 1 empty. |
| Migrations: RPC `SECURITY DEFINER` + REVOKE anon/authenticated; M1 index swap; Task C gated DROP `IF EXISTS` + down-migration | ✅ (read) | Pass | Both claim/reaper RPCs are `SECURITY DEFINER SET search_path=public` and `REVOKE ALL … FROM anon, authenticated`. Executions migration drops `…_scheduled` and creates `…_pending … WHERE status='pending'` (M1) + defensively remaps legacy vocab (M4). Task C is `DROP TABLE IF EXISTS` behind a `-- GATE:` no-prod-rows comment with full CREATE-TABLE down-migration (M7). |

### Edge cases (reasoned + where possible tested)

| Edge case | Verdict | Notes |
|---|---|---|
| Empty claim batch | PASS | Reminders return `{0,0,0}` and log "No due reminders"; automation returns early. |
| Reaper reclaims stale `running`/`processing` → dead-letter at max | PASS (read) | Both reapers dead-letter poison first (`attempts >= max` → `failed`/`dead_letter`, clears claim, unsets `next_attempt_at`), then reclaim the rest to `pending` with exp-backoff `least(3600, 60*2^attempts)`. |
| Enqueuer never throws into `emit` | PASS | Whole body + per-rule loop wrapped in try/catch; called via `.catch()` at both emit sites. Test covers no-rule and non-matching paths. |
| Lazy default-rule seed idempotent | PASS (with note) | `ensureDefaultPaymentRules` guards on `list(limit:1)`; no-ops if ≥1 rule. See Edge-1 for the per-emit cost + concurrent-first-event race. |
| Reminder with missing contact | PASS | `dispatchReminderRow` returns `{ sent:false, errorMessage:'Contact not found' }` → row marked `failed`. Covered by the "marks failed when not sent" test. |

### Issues Found

#### Bugs (must fix before commit)
_None._ No High/Medium severity defects found. All acceptance criteria pass; zero new tsc errors; no stray references to retired methods.

#### Edge-cases / minor (nice to fix — non-blocking, recommend tracking as follow-ups)
1. **Per-emit default-rule seed cost + double-seed race** — Severity: Low — File: `lib/payments/paymentReactionEnqueuer.ts` / `lib/payments/defaultPaymentRules.ts`. `ensureDefaultPaymentRules` runs a `list(limit:1)` read on **every** payment emit, not just the first. It's idempotent, but (a) adds one read per event, and (b) two concurrent first-events for a new user can both pass the "no rules yet" guard and seed 6 rules (no unique/natural-key constraint). SMB volume makes this low-impact; a natural-key upsert or a one-time flag would close it.
2. **`failed` overloads guardrail-skip / not-found with genuine failure** — Severity: Low — File: `lib/services/PaymentAutomationEngine.ts` (drain) + repo `fail()`. Guardrail skips (`max executions reached`, `cooldown active`) and `rule/event not found` are written as `status='failed'`, same terminal state as a real dispatch failure. Harmless to correctness, but pollutes any future failure-alerting/replay view. Consider a distinct `skipped` state (or metadata reason) when the rule-engine cutover lands.
3. **Caught per-row dispatch error is terminal (no retry/backoff)** — Severity: Low — File: `lib/services/PaymentReminderService.ts` `processDueReminders` catch. A transient error surfacing outside `dispatchReminderRow` marks the row `failed` immediately; only crash-then-reap of a `processing` row gets the backoff retry. Acceptable while senders are simulated no-ops; revisit when real delivery lands.
4. **Cooldown recency keyed on `created_at`, not execution time** — Severity: Low — File: `lib/repositories/PaymentAutomationRepository.ts` `hasRecentForEntity`. The cooldown window filters `.gte('created_at', since)` (enqueue time) rather than `executed_at`. With `delay_minutes=0` (all three default rules) this is equivalent; any future rule with a non-trivial delay would drift the cooldown boundary. Note-only.
5. **`RuleExecution` TS interface omits the new claim columns** — Severity: Low — File: `lib/services/PaymentAutomationEngine.ts`. `claimed_by`/`claimed_at`/`attempts`/`next_attempt_at` exist in the migration but not the TS type (drain casts RPC output). Harmless (drain doesn't reference them in TS); add for completeness.

### Not verifiable in this session (stated for the record)
- **Migrations are not applied** (no DB access). The SKIP-LOCKED double-claim guarantee, the reaper's lease arithmetic, `SECURITY DEFINER`/REVOKE effect, the M1 index swap, and the Task C `payment_methods` no-prod-rows GATE were verified **by reading the SQL only**. SA/ops must apply all three migrations and confirm the M7 gate (`SELECT count(*) FROM payment_methods;` = 0) before the crons run.
- `callBlockExecutor` remains a placeholder (explicitly out of scope, §4) — the drain's terminal transition and guardrails are exercised, but no real block effect is executed.
- Vercel Pro cron-cap (+2 → 10) and `CRON_SECRET` presence are account facts (ops confirmation), not repo-verifiable.

### Final Status
- [x] **All acceptance criteria pass — ready for commit** (pending the standing user code-review + RM gate). No blocking bugs. 5 low-severity edge-case follow-ups recommended for tracking, none gating.
- [ ] Issues found — Dev must address before commit

**Verdict: PASS-WITH-NOTES** — core claim/idempotency, defect-1/2/3 regressions, bus retirement, repo scoping, and status-vocab reconcile all verified; 5 low-severity, non-blocking follow-ups noted. The one thing QA could not exercise (SKIP-LOCKED concurrency + migration apply) is a DB-availability limitation, not a code gap — the SQL was read and is faithful to §8.1.

---

## 13. Post-QA fixes (Dev, 2026-08-16)

Two of QA's five low-severity notes fixed on user request; the other three deferred as they are semantic refinements that converge with the Phase-0 generalized queue.

- **QA #1 — double-seed race (FIXED).** New migration `2026-08-14_payment_automation_rules_unique_name.sql` adds a unique index on `payment_automation_rules(user_id, name)`. `PaymentAutomationRuleRepository.insertDefaultsIgnoringDuplicates` performs an `ON CONFLICT DO NOTHING` upsert; `ensureDefaultPaymentRules` now inserts through it (keeping the `list(limit:1)` empty-check as the common-case fast path). Two concurrent first-emit seeders can no longer produce 6 rules — the loser's rows are ignored. New suite `lib/payments/__tests__/defaultPaymentRules.test.ts` (3 tests) locks fast-path skip, race-safe seed, and graceful skip on a failed existence check. *(The per-emit `list` read remains by design — lazy-seed cost, acceptable at SMB emit volume.)*
- **QA #5 — `RuleExecution` type (FIXED).** Added `claimed_by`/`claimed_at`/`attempts`/`next_attempt_at` to the `RuleExecution` interface (`PaymentAutomationEngine.ts`) to match the migration columns.
- **Security hardening — cron auth now fails CLOSED (user request, 2026-08-16).** Both cron routes' `verifyCronSecret` previously returned `true` (allow) when `CRON_SECRET` was unset in production, logging only a warning — a fail-open footgun (one missing env var → the public `/api/cron/payment-*` URLs run the drains for any caller). Changed to **return `false` (refuse) + `logger.error`** when the secret is missing in production. Dev bypass (`NODE_ENV==='development'`) unchanged. Consequence: if ops does not set `CRON_SECRET`, the crons now **refuse (401)** rather than run unprotected — so setting `CRON_SECRET` is a hard prerequisite for the crons to function, not just a recommendation. (Blast radius even pre-hardening was bounded by the claim/idempotency design — an unauthorized hit can't double-send or corrupt, only force due work early / hammer the DB — but fail-closed removes the exposure entirely.)
- **QA #2 / #3 / #4 — DEFERRED.** Distinct `skipped` state vs `failed`; retry/backoff for caught (non-crash) dispatch errors; cooldown keyed on `executed_at` vs `created_at`. All Low, all no-op today (default rules use `delay_minutes=0`; senders are simulated). They fold naturally into the event-driven migration's generalized retry/dead-letter/`processed_reactions` work (R8) — tracked there rather than pre-built here.

**Verification:** touched-file `tsc --noEmit` clean; `jest` on the affected suites = 4 suites / 17 tests green (incl. the new seed suite). Full payment suite unaffected.

---

## 14. Local dev harness

Vercel cron does **not** run locally (`next dev`/`vercel dev` never fire `vercel.json` crons). To exercise the full flow on a dev DB, `scripts/dev-payment-queue.ts` plays the scheduler's role: it seeds work, fires the drain endpoints over HTTP **twice concurrently** (the double-processing stress test), and prints the resulting row states. **Dev-only** — it writes real rows and refuses to run when `NODE_ENV=production`.

**Prereqs**
1. A dev DB with the 3 queue-drain migrations applied (`supabase start && supabase db push`) — the `claim_due_*` / `reap_stale_*` RPCs must exist.
2. `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` pointing at that DB.
3. `npm run dev` running (dev bypass → no `CRON_SECRET` needed locally).
4. `HARNESS_USER_ID` = a real auth user id in the dev DB (optional `HARNESS_CONTACT_ID` for the reminder happy-path `sent`; without it the reminder resolves to `failed`/Contact-not-found — the claim/exactly-once behaviour is identical either way).

**Usage**
```bash
HARNESS_USER_ID=<uuid> npx tsx scripts/dev-payment-queue.ts --reminders
HARNESS_USER_ID=<uuid> npx tsx scripts/dev-payment-queue.ts --automation
HARNESS_USER_ID=<uuid> npx tsx scripts/dev-payment-queue.ts --all
HARNESS_USER_ID=<uuid> npx tsx scripts/dev-payment-queue.ts --cleanup
```

**What it proves.** Reminders: a due row goes `pending→processing→sent/failed` with `attempts=1` despite two concurrent drains (claim works). Automation: the real `enqueuePaymentReactions` seam runs in-process (default-rule seed + rule match + enqueue writing `trigger_event_id`), then the HTTP drain moves the execution `pending→running→completed` on the same row (defect-1), exactly once.

**Faithfulness / limits.** Drains run over real HTTP against the running route (prod-faithful). The automation *emit* is a direct event insert + an awaited `enqueuePaymentReactions` call (deterministic; prod persists via `emit()` which fires the enqueuer non-blocking). The true cross-process `SKIP LOCKED` guarantee is a Postgres property — running against a real local Supabase exercises it for real, which the mocked unit tests can only model (that's the option-3 integration test, still a recommended follow-up). `callBlockExecutor` remains a placeholder, so no real block effect executes.

---

## 15. Rollout — commit + DB apply order

**Task C gate satisfied:** user confirmed `payment_methods` has **0 rows** (2026-08-16) → the `2026-08-14_drop_payment_methods.sql` DROP is cleared to apply.

**Order matters** — apply the migrations *before* the deploy that schedules the crons. On deploy the crons begin firing immediately; if the `claim_due_*` RPCs don't exist yet the drains error-and-no-op (fails safe — no double-send — but reminders won't send until the RPCs land).

1. **Set `CRON_SECRET`** in the Vercel project (now a hard prerequisite — fail-closed auth refuses without it) and confirm the **Vercel Pro** tier (8→10 crons).
2. **Apply the 4 migrations** to prod Supabase, in filename order:
   - `2026-08-14_payment_reminders_claim.sql`
   - `2026-08-14_payment_automation_executions_claim.sql`
   - `2026-08-14_payment_automation_rules_unique_name.sql`
   - `2026-08-14_drop_payment_methods.sql`  *(gate satisfied — 0 rows)*
3. **Merge + deploy** the branch (RM) — this is what activates the two new `vercel.json` crons.
4. **Post-deploy check:** confirm the first cron runs return 200 (with the bearer) and, on a test user, a due reminder sends exactly once.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-14 | Created (draft) | Workplan for the two payment queue-drain fixes (F1 reminders, F2 automation engine) + F3 payment_methods drop, all on the §8.1 claim pattern. Task-B decisions captured: FIX IT + DEFAULTS ONLY (user, 2026-08-14). Awaiting SA workplan review before implementation. |
| 2026-08-14 | SA review → implement → SA code review → QA | SA APPROVE-WITH-CHANGES (workplan, M1–M9) → Dev implemented (§6.5) → SA code review APPROVE (§11.2) → QA PASS-WITH-NOTES (§12, no blocking bugs). |
| 2026-08-16 | Post-QA fixes (§13) | Fixed QA notes #1 (double-seed race → unique index + ignore-duplicates seed) and #5 (RuleExecution type). #2/#3/#4 deferred to the event-driven migration. Holding for user code review before RM. |
| 2026-08-16 | Security hardening (§13) | Cron auth `verifyCronSecret` now **fails closed** in both payment cron routes — a missing `CRON_SECRET` in prod refuses (401) instead of running unprotected. Per user request. `CRON_SECRET` is now a hard prerequisite for the crons to run. |
| 2026-08-16 | Dev harness (§14) + rollout (§15) | Added `scripts/dev-payment-queue.ts` (dev-only, seeds → fires drains ×2 concurrently → prints row states). Documented commit + DB apply order. Task C DROP gate satisfied — user confirmed `payment_methods` has 0 rows. |
