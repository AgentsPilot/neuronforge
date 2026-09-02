# Business OS — Payments Internal Plugin Workplan

> **Last Updated**: 2026-08-10
> **Module**: Payments (#4 in the [module roadmap](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md))
> **Status**: 🟢 **Implemented → SA code-review APPROVE (§9.2) → QA PASS-WITH-NOTES (§10), no bugs.** Awaiting user code review before RM (RM held — reviewing Scheduling + Payments together per user).
> **RM**: Held (Scheduling code review pending; Payments follows the same "hold RM until user reviews code" gate).

## Overview

Convert the Business OS **Payments** module into an internal, repository-backed V2 plugin, following the exact pattern proven on **CRM** (PR #18/#19) and **Scheduling** (implemented, QA PASS): a repository-delegating executor extending `BasePluginExecutor`, `access_strategy: db_active` (fail-closed on no `business_profiles` row / lookup error), `visibility: business_os` (hidden from general discovery), `isSystem: true`, registered in `corePluginFiles` + `executorRegistry`, and surfaced automatically in the `/test-business-os` **Modules** tab.

Payments is the **highest-risk** module (money + the external Stripe Connect path). The governing principle for v1:

> **The internal plugin never moves money.** It performs **database-record operations only** (invoices, payment plans, and *recording* transactions that happened externally or manually). All actual charging, checkout, refunds-to-card, and Stripe Connect calls stay **external leaves** behind the existing Stripe flow and are **out of the internal op contract**. `record_manual_payment` is a bookkeeping entry (cash/check/offline), not a fund transfer.

## Table of Contents

1. [Scope](#1-scope)
2. [Assessment findings (Step 0 baseline)](#2-assessment-findings-step-0-baseline)
3. [Step 0 — Remediation](#3-step-0--remediation)
4. [Step 2 — Build the internal plugin](#4-step-2--build-the-internal-plugin)
5. [Guardrails](#5-guardrails)
6. [test-business-os Modules tab](#6-test-business-os-modules-tab)
7. [Open issues seeded to the roadmap](#7-open-issues-seeded-to-the-roadmap)
8. [Lean-test policy](#8-lean-test-policy)
9. [SA review](#9-sa-review)
10. [QA report](#10-qa-report)

---

## 1. Scope

### In scope (v1 — pure repo delegation, no network)

Wraps **4 of the 12 payment tables** across the two data-record repos. (`PaymentRepository` also owns a 5th table, `stripe_connect_accounts` via `StripeConnectRepository` — that is **intentionally a leaf**: Connect onboarding is a money-movement path, out of the internal op contract. So v1 wraps 4 tables, not 5. — M7)

| Repo | Tables wrapped | v1 ops |
|---|---|---|
| `PaymentInvoiceRepository` | `payment_invoices` | create, list, get, update, send, cancel, mark_paid, count |
| `PaymentTransactionRepository` | `payment_transactions` | list, get, record_manual_payment, create_refund_record, get_revenue |
| `PaymentPlanRepository` | `payment_plans`, `payment_plan_installments` | create_plan, list_plans, get_plan, update_plan, deactivate_plan, create_installments, list_installments, mark_installment_paid, cancel_installments, get_plan_summary |

**SA-confirmed:** **no `delete_invoice` op in v1** (M-endorsed §9.7). Invoices are financial records — expose `cancel_invoice` (status→cancelled) only; hard-deleting a financial record is an audit hazard. (`PaymentInvoiceRepository.delete` exists and hard-deletes; leave it unwired.)

**Revenue-accounting model (M2 — must be explicit to callers/agents):** `record_manual_payment` is the **canonical "payment received" path** — it writes a `payment_transactions` row, which fires T4 (invoice→`paid`) and T3 (CRM activity) and **counts toward `get_revenue`**. `mark_invoice_paid` is a **status-only reconciliation/override** (`markAsPaid`, no transaction row) that does **NOT** count toward revenue and fires no trigger. Callers must use `record_manual_payment` for real payments; `mark_invoice_paid` is only for correcting invoice status. `mark_installment_paid` is in the same status-only family (no transaction → no revenue).

### Out of scope (v1)

- **External Stripe leaves** — Stripe Connect (`app/api/payments/stripe-connect/**`), checkout/payment-intent (`app/api/payments/create-checkout`, `app/api/website/checkout`, `app/api/website/payment-intent`), the `IPaymentProcessorExecutor` charge/refund/checkout interface, the platform-billing `StripePluginExecutor` (`'stripe'` key — SaaS subscriptions, unrelated), and the `app/api/stripe/webhook` handler. The webhook remains the **legitimate producer** of `succeeded` transactions that fires T3/T4 — the plugin must not duplicate that write.
- **7 unowned tables** — `payment_processors`, `saved_payment_methods`, `payment_events`, `payment_reminders`, `payment_automation_rules`, `payment_automation_executions` are service-owned automation/processor infra (no repos); **deferred to a later phase** (would need new repos). `payment_methods` (legacy Stripe) is an **orphan** table — confirm dead, flag for drop.

---

## 2. Assessment findings (Step 0 baseline)

Read-only assessment, 2026-08-10. Full detail seeded into the roadmap Payments section.

- **Repos:** 5/12 tables repo-backed and `user_id`-scoped, Pino, `{data,error}`. **Conformance gaps:** `PaymentRepository`'s three classes hardcode `private supabase = supabaseServer` instead of constructor DI (`PaymentRepository.ts:94,372,727`) — diverges from `PaymentPlanRepository`/Scheduling/CRM DI. `PaymentInvoiceRepository.delete` is a **hard delete** (`:492`); `PaymentTransactionRepository` has **no delete** (transactions immutable — correct).
- **Triggers (both on `payment_transactions`, `supabase/migrations/20260722_create_payment_tables.sql`):**
  - **T3 `log_payment_activity` (`:287-332`)** — on first transition into `status='succeeded'`, inserts a `crm_activities` `payment` row **only if `contact_id IS NOT NULL`**.
  - **T4 `update_invoice_on_payment` (`:337-357`)** — on `succeeded` with `invoice_id NOT NULL`, sets `payment_invoices.status='paid', paid_at=…`.
  - **No active double-log.** The only app-side payment-activity writer, `CRMActivityRepository.logPayment` (`:255`), is **dead (zero callers)** — a latent footgun. The website finalize path already delegates the CRM activity to the trigger (`app/api/website/booking/finalize/route.ts:243-246`).
- **No phantom columns** on the payments path (verified `scheduling_bookings.payment_id` and all T3 `crm_activities` columns exist).
- **Rogue live callers bypassing repos:** `ChatCommandExecutor.ts:3226` (direct `payment_invoices` INSERT) and `:3466` (direct `payment_transactions` INSERT with `status:'succeeded'` — fires T3/T4). `CapabilityEngine.ts:508` calls `paymentInvoiceRepository.create(this.userId, {…})` with **wrong arity** (repo takes a single `invoice` arg) — `userId` is passed as the invoice object, payload dropped, NOT-NULL `user_id`/`invoice_number` omitted → **this call cannot succeed** (latent bug).
- **Capability declared AND wired** (better than Email): `capabilities-schema.ts:529` declares `payments` (`invoices` full CRUD; `transactions` read-only). `SafeExecutionLayer` already routes invoices + revenue through the repos (`:247/347/940/1314/1916`). So there is a real caller on the repo already; the win is **consolidating the two rogue callers** onto the plugin.

---

## 3. Step 0 — Remediation

Mirrors the CRM/Scheduling Step-0 pass: fix the pre-existing data-integrity issues **before** wrapping, so the plugin wraps a clean surface.

| # | Item | Action | Risk |
|---|---|---|---|
| **P0.1** | `CapabilityEngine.ts:508` broken invoice create (arity + missing `user_id`/`invoice_number`) | Re-point at `paymentInvoiceRepository.create(...)` with the correct single-arg payload incl. `user_id` and `getNextInvoiceNumber()`; or route via the plugin once built. Add a guard test. | 🔴 Live bug — invoice creation via this path fails today. |
| **P0.2** | `ChatCommandExecutor.ts:3226` direct `payment_invoices` INSERT (invoice.create) | Route through `pluginExecuter.execute(userId, PAYMENTS_PLUGIN_KEY, 'create_invoice', {...})` (P4 real-caller wiring). | 🟡 Bypasses repo; duplicates `create`+`getNextInvoiceNumber`. |
| **P0.3** | `ChatCommandExecutor.ts:3466` direct `payment_transactions` INSERT `succeeded` (payment.record) | Route through `record_manual_payment`. Keeps T3/T4 as the sole side-effect owner. | 🟡 Bypasses repo. |
| **P0.4** | `CRMActivityRepository.logPayment:255` dead double-log vector | Confirm zero callers; recommend **delete** (or leave uncalled + comment). Executor must never wire it. | 🟡 Footgun if ever called alongside T3. |
| **P0.5** | `PaymentRepository` DI inconsistency | Convert the three classes to constructor injection (match `PaymentPlanRepository`), keeping the singleton exports **byte-compatible** (`new X(supabaseServer)`, as `PaymentPlanRepository.ts:752`). **Consistency refactor only, NOT a test prerequisite** — the executor tests `jest.mock` the repository singleton module (as Scheduling did), so no DI is needed for mocking. (M8) | 🟢 Refactor. |
| **P0.6** | Invoice delete semantics | SA-confirmed: keep hard-delete on the repo but **do not expose** a delete op; plugin exposes `cancel_invoice` only. | 🟢 Policy. |
| **P0.7** | `PaymentInvoiceRepository` has no `count` method (M3) | Add `count(userId, { status? })` → `.select('*', { count: 'exact', head: true }).eq('user_id', userId)` (+ optional status filter). Backs the `count_invoices` op — no op ships without a delegate. | 🟢 Repo method. |

> **Commit discipline (M8):** **P0.1** (the `CapabilityEngine.ts:508` live bug) and any other repo/route bug-fix commit **independently of the plugin** — a repo bug-fix and the plugin must never entangle (Scheduling lesson). P0.2/P0.3 (rogue-caller rerouting) land **with** the plugin, since they depend on it (P4 wiring).

> **Console-logging standard:** any file touched in P0.1–P0.5 that still uses `console.*` for logging will be flagged and converted to Pino per CLAUDE.md before the change lands.

> **Pre-existing adjacent TS error (do not regress):** `ChatCommandExecutor.ts:2530` (`company` not on `CRMContactInsert`) and `:1084` (`is_free` on `SchedulingServiceInsert`) are pre-existing model/schema-drift errors tied to the missing `@/types/database` cross-cutting item — not introduced here, tracked separately. P0.2/P0.3 edits must not add new TS errors.

---

## 4. Step 2 — Build the internal plugin

### 4.1 Definition — `lib/plugins/definitions/payments-plugin-v2.json`

- `key: "payments"`, `isSystem: true`, `visibility: "business_os"`, `access_strategy: { type: "db_active" }`, internal `auth_config` stub (mirrors `crm`/`scheduling`).
- **`domain: "payments"`** (M4) — the value already exists in the V6 `Domain` enum (`lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts:40`). No enum change, no SA sign-off needed.
- Actions (~23): `create_invoice, list_invoices, get_invoice, update_invoice, send_invoice, cancel_invoice, mark_invoice_paid, count_invoices, list_transactions, get_transaction, record_manual_payment, create_refund_record, get_revenue, create_plan, list_plans, get_plan, update_plan, deactivate_plan, create_installments, list_installments, mark_installment_paid, cancel_installments, get_plan_summary`.
- **Each action must carry `description`, `parameters`, AND `output_guidance`** (M5a) — `validatePluginDefinition` (`plugin-manager-v2.ts:762`) requires all three or plugin load throws. Use `output_guidance` (as Scheduling did), **not** `output_schema`. Validate: `db_active ⇒ isSystem` (enforced `plugin-manager-v2.ts:753`).

### 4.2 Executor — `lib/server/payments-plugin-executor.ts`

- `PaymentsPluginExecutor extends BasePluginExecutor`; `executeSpecificAction(connection, actionName, parameters)` reads `userId = connection?.user_id` (throw `access_denied` if missing).
- Import **only** the payment repos (`paymentInvoiceRepository`, `paymentTransactionRepository`, `paymentPlanRepository`) + `businessProfileRepository`. **No CRM repo import** (delegate-only guardrail — T3 owns the CRM activity).
- **🔴 M1 — cross-tenant ownership guard on `record_manual_payment` (load-bearing).** T4 (`migration:341-346`) runs `UPDATE payment_invoices … WHERE id = NEW.invoice_id` with **no `user_id` scope**, and `recordManualPayment` (`PaymentRepository.ts:316-367`) trusts a caller-supplied `invoiceId` with no ownership check. Without a guard, a caller could pass **another tenant's** invoice UUID and flip that victim's invoice to `paid` (their own transaction fires the unscoped trigger). **Before delegating**, when `invoice_id` is present, verify `paymentInvoiceRepository.findById(invoiceId, userId)` returns a row — else throw `access_denied`. Apply the same pre-check to a supplied `contact_id` (defense-in-depth against a dangling cross-tenant `crm_activities` reference from T3). This is the exact class as Scheduling M2 (`count_bookings`).
- **Delegate-only:** `record_manual_payment` calls `recordManualPayment(...)` (after the M1 guard) and **returns** — it must NOT also insert `crm_activities` or flip the invoice to `paid` (T3/T4 own both).
- **Accounting divergence (M2):** `record_manual_payment` is the canonical **revenue-bearing** "payment received" op (writes a transaction → T3/T4 → counts in `get_revenue`). `mark_invoice_paid` (`markAsPaid`) is **status-only** — no transaction, no trigger, **not** counted in `get_revenue`; use only for status reconciliation. `mark_installment_paid` is the same status-only family. Encode this in each op's `output_guidance` so agents don't under-report revenue by choosing `mark_invoice_paid`.
- `create_invoice` **must generate `invoice_number` internally** via `getNextInvoiceNumber(userId)` before calling `create(...)` (the repo's `invoice_number` is NOT NULL) — mirror `SafeExecutionLayer.ts:1948`. (M5b)
- `create_refund_record` writes the DB refund record only (`createRefund`) — no processor call. **Trigger note (M6):** a **partial** refund keeps `status:'succeeded'` in the SET list (`PaymentRepository.ts:233`), so `AFTER UPDATE OF status` re-fires T4 and harmlessly re-marks the already-paid invoice `paid` (idempotent); a **full** refund sets `status:'refunded'`, firing neither T3 (only on transition *into* `succeeded`) nor T4. Document so QA doesn't file a false bug.

### 4.3 Register

- Add `'payments-plugin-v2.json'` to `corePluginFiles` (`plugin-manager-v2.ts`).
- Add `'payments': PaymentsPluginExecutor` to `executorRegistry` (`plugin-executer-v2.ts`).

### 4.4 P4 — real-caller wiring

Re-point `ChatCommandExecutor` invoice.create / payment.record (P0.2/P0.3) at the plugin. `SafeExecutionLayer` already uses the repos directly (acceptable — same repo, no double-path); optionally note it as a future consolidation, not required for v1.

### 4.5 Tests (lean — see §8)

`lib/server/payments-plugin-executor.test.ts` — fast pure unit tests with `jest.mock`ed repo singletons + `businessProfileRepository`: dispatch table, `user_id` scoping, delegate-only guardrail (record_manual_payment does **not** touch CRM repo / invoice status), `create_refund_record` writes DB only, missing-`user_id` throws, param guards. **M1 test (required):** `record_manual_payment` with a foreign `invoice_id` (findById returns null) throws `access_denied` **before** any `recordManualPayment` insert; same for a foreign `contact_id`. **The T3/T4 fan-out (exactly one `crm_activities` row + one invoice flip) is a DB-backed assertion → QA-manual, not in-build.**

---

## 5. Guardrails

- **No money movement.** The plugin performs DB-record ops only. Charging/checkout/refund-to-card/Connect stay external leaves behind the existing Stripe flow — never invoked from the executor. (Aligns with the platform safety rule against initiating financial transfers.)
- **🔴 Tenant-ownership pre-check (M1).** Any op that accepts a caller-supplied `invoice_id`/`contact_id` bound for an unscoped trigger (`record_manual_payment`) must verify ownership (`findById(id, userId)`) before delegating — T4's UPDATE is not `user_id`-scoped, so the executor is the isolation boundary.
- **Triggers own side-effects.** T3 (CRM activity, `contact_id`-conditional) and T4 (invoice→paid) are the sole owners on the `succeeded`-transaction path. The executor **delegates and returns**; it never re-emits `crm_activities` or manually sets invoice `paid` when recording a `succeeded` transaction.
- **db_active fail-closed** — no `business_profiles` row OR lookup error → `access_denied` (via `AccessStrategyResolver`).
- **business_os visibility** — plugin hidden from the 5 discovery sites; still resolvable by key for the V6 compiler (`getAvailablePlugins()` unfiltered).

---

## 6. test-business-os Modules tab

No new work — the Modules tab auto-lists any `visibility: business_os` plugin via `/api/plugins/available?includeBusinessOs=true` and reuses the shared action-schema + execute path (Option A). **Verification** (QA / user manual, needs dev-server restart to clear the cold-start plugin cache): Payments appears in the Modules tab; `create_invoice` → `list_invoices` round-trips; `record_manual_payment` on an invoice flips it to paid (T4) and logs one CRM activity when a `contact_id` is present (T3).

---

## 7. Open issues seeded to the roadmap

Recorded in the roadmap Payments section (struck through as fixed):

1. 🔴 `CapabilityEngine.ts:508` broken invoice create (P0.1).
2. 🟡 Two rogue direct-DB callers `ChatCommandExecutor.ts:3226/3466` (P0.2/P0.3).
3. 🟡 Dead `CRMActivityRepository.logPayment:255` double-log vector (P0.4).
4. 🟢 `PaymentRepository` DI inconsistency (P0.5).
5. ⬜ 7 unowned tables (automation/processor infra) — deferred; need repos for a later phase.
6. ⬜ `payment_methods` orphan table — confirm dead, flag for drop.
7. ⬜ Insight G2 direct-DB reads of payment tables — overlaps this module, tracked under Insights.

---

## 8. Lean-test policy

Only fast **pure mocked unit tests** run in-build (executor dispatch/guardrails). DB-backed behaviour (T3/T4 fan-out, invoice-paid transitions, real repo round-trips) is **QA-manual** to keep the build fast — same policy as CRM/Scheduling.

---

## 9. SA review

**Reviewed by SA — 2026-08-10**
**Status:** 🔄 Revision Required — **APPROVE-WITH-CHANGES.** Architecturally sound: it reuses the shipped `db_active` + `visibility: business_os` substrate with **no new access logic**, the "internal plugin never moves money" boundary is drawn correctly, and the delegate-only (triggers-own-side-effects) principle is right. But there is **one High-severity tenant-isolation gap** (M1) the plan misses — the exact analog of Scheduling's M2 — plus a revenue-accounting divergence (M2) and a missing repo method (M3). Fold in M1–M8 below; no fundamental rework, no TL escalation. A diff of the amended plan against M1–M8 suffices — no second full review.

### Verification performed (against live code, not docs)

| Claim in the plan | Verdict | Evidence |
|---|---|---|
| 5 repo-backed tables; `user_id`-scoped, Pino, `{data,error}` | ✅ Confirmed | `PaymentRepository.ts` (invoices/transactions/stripe_connect) + `PaymentPlanRepository.ts` (plans/installments). Note scope-count nuance in **M7**. |
| T3 `log_payment_activity` — on transition INTO `succeeded`, inserts `crm_activities` **only if `contact_id IS NOT NULL`** | ✅ Confirmed | `20260722_create_payment_tables.sql:294,299` (fires `AFTER INSERT OR UPDATE OF status`, :330) |
| T4 `update_invoice_on_payment` — on `succeeded` + `invoice_id NOT NULL`, sets invoice `paid` | ✅ Confirmed, **with a security nuance (M1)** | `:341-346` — the UPDATE is `WHERE id = NEW.invoice_id` with **NO `user_id` scope** |
| `CapabilityEngine.ts:508` broken invoice create (wrong arity + missing NOT-NULL fields) | ✅ Real live bug | `lib/business-os/chat/CapabilityEngine.ts:508` calls `create(this.userId, {…})`; repo `create` takes a **single** `invoice` arg (`PaymentRepository.ts:374`); payload lacks `user_id` + `invoice_number` (both NOT NULL, `migration:9,13`). Correct reference caller = `SafeExecutionLayer.ts:1948` (single object incl. `user_id` + `getNextInvoiceNumber`). |
| Two rogue direct-DB callers | ✅ Confirmed | `ChatCommandExecutor.ts:3226` (`payment_invoices` INSERT), `:3466` (`payment_transactions` `status:'succeeded'` INSERT — fires T3/T4) |
| Dead `CRMActivityRepository.logPayment` | ✅ Confirmed | `lib/repositories/CRMActivityRepository.ts:255`, zero callers found |
| Substrate shipped, no new access logic | ✅ Confirmed | `access-strategy.ts:138` (`resolveDbActive` fail-closed), `plugin-executer-v2.ts:65-66` (`crm`/`scheduling` registered; `'stripe'` is the **unrelated** platform-billing executor — Payments' `'payments'` key is distinct) |
| Domain enum lacks `payments`/`finance` | ❌ **Incorrect — `payments` EXISTS** | `lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts:40` — resolved in **M4** |

### Answers to the review questions

1. **Scope cut → ENDORSE.** Limiting v1 to invoices/transactions/plans/installments and treating the 7 unowned tables + all Stripe/Connect/checkout/webhook paths as leaves is the right cut. The webhook stays the legitimate producer of `succeeded` transactions (fires T3/T4); the plugin must not duplicate that write. One correction in **M7** (the 5th repo-backed table, `stripe_connect_accounts`, is a leaf — the plan wraps 4 tables, not 5).
2. **"Never moves money" guardrail → drawn correctly.** `record_manual_payment` (bookkeeping, `processor_type:'manual'`, no processor call) and `create_refund_record` (DB record via `createRefund`, no processor call) are both correctly internal. **But `record_manual_payment` needs an extra guard — see M1** (a tenant-isolation issue, not a money-movement one).
3. **Delegate-only vs T3/T4 → CONFIRMED, and the "choose one path" note is NOT sufficient — see M2.** The executor must NOT insert `crm_activities` and must NOT flip invoice→`paid` on a succeeded transaction (T3/T4 own both). The real conflict the plan under-states is the *opposite direction*: `mark_invoice_paid` writes **no transaction**, so it never contributes to `get_revenue` — a semantic divergence that must be documented, not just "pick one."
4. **Step-0 ordering → correct, with M8.** Fixing `CapabilityEngine.ts:508` first is a valid prerequisite (it is a standalone live bug and should be committed **independently** of the plugin, mirroring the Scheduling discipline). Nothing over-scoped except the P0.5 justification (M8).
5. **Domain enum → use `domain: "payments"` (M4).** It already exists (`intent-schema-types.ts:40`). No SA sign-off for a new value is needed — drop the "pick closest / flag to SA" hedge.
6. **No new patterns / standards → HELD.** Repository pattern, no direct Supabase outside repos (the 3 rogue callers are exactly what Step 0 removes), `db_active` fail-closed, visibility gating only at the 5 sites (`getAvailablePlugins()` stays unfiltered), lean-test policy — all consistent with CRM/Scheduling. No new pattern introduced.
7. **"No `delete_invoice`, cancel only" → ENDORSE.** `PaymentInvoiceRepository.delete` (`:492`) hard-deletes a financial record — an audit hazard. Expose `cancel_invoice` (update `status='cancelled'`) only and leave `delete` unwired. Correct.

### Must-fix (fold into the plan before coding)

- **M1 — [HIGH · security] `record_manual_payment` is a cross-tenant invoice-write vector.** T4 (`migration:341-346`) runs `UPDATE payment_invoices SET status='paid' … WHERE id = NEW.invoice_id` with **no `user_id` filter**, and `recordManualPayment` (`PaymentRepository.ts:316-367`) inserts the transaction with a **caller-supplied `invoiceId` and no ownership check**. Exposed as a standalone plugin op, a caller can pass another tenant's invoice UUID and flip that victim's invoice to `paid` (their own transaction row fires the unscoped trigger). This is the exact class as Scheduling **M2** (`count_bookings`). **Fix:** in the executor, before delegating `record_manual_payment` when an `invoice_id` is present, verify ownership via `paymentInvoiceRepository.findById(invoiceId, userId)` and throw `access_denied` if not found. Apply the same ownership pre-check for a supplied `contact_id` (defense-in-depth against a dangling cross-tenant `crm_activities` reference from T3 — lower severity, same guard). Add a unit test asserting a foreign `invoice_id` is rejected before any insert.
- **M2 — [MEDIUM] Document the `mark_invoice_paid` vs `record_manual_payment` accounting divergence; "choose one, never both" is insufficient.** `mark_invoice_paid` → `markAsPaid` (`PaymentRepository.ts:535`) sets invoice `status='paid'` but writes **no `payment_transactions` row**, so the payment never appears in `get_revenue`/`getTotalRevenue` (`:187`) and fires no T3 activity. `record_manual_payment` creates the transaction (→ T4 flips the invoice + T3 logs). State in §4.2/§5 that **`record_manual_payment` is the canonical "payment received" path** (revenue-bearing) and `mark_invoice_paid` is a status-only reconciliation/override that does **not** count toward revenue. Guidance for callers/agents must make this explicit or revenue will be under-reported.
- **M3 — [MEDIUM] `count_invoices` has no backing repo method.** `PaymentInvoiceRepository` exposes no `count`. Either add `count(userId, { status? })` to the repo in Step 0 (preferred — `.select('*', { count: 'exact', head: true }).eq('user_id', userId)`) or drop `count_invoices` from the op set. Do not ship an op with no delegate.
- **M4 — [LOW] Domain is `"payments"` (resolved).** `intent-schema-types.ts:40` already contains `payments`. Amend §4.1 to state `domain: "payments"` and remove the "if absent, pick the closest / flag to SA" language. No enum change.
- **M5 — [LOW] Definition + `create_invoice` mechanics.** (a) `validatePluginDefinition` (`plugin-manager-v2.ts:762`) requires each action to carry `description`, `parameters`, **and `output_guidance`** — use `output_guidance` (as Scheduling did), not `output_schema`, or plugin load throws. (b) `create_invoice` must generate `invoice_number` internally via `getNextInvoiceNumber(userId)` before calling `create(...)` (repo `create` requires the NOT-NULL `invoice_number`) — mirror `SafeExecutionLayer.ts:1948`. State this in §4.2.
- **M6 — [LOW] `create_refund_record` trigger interaction — endorse as internal, but note the re-fire.** A **partial** refund keeps `status:'succeeded'` in the SET list (`PaymentRepository.ts:233`), so `AFTER UPDATE OF status` re-fires T4 and re-marks the (already-paid) invoice `paid` — idempotent/harmless. A **full** refund sets `status:'refunded'`, which fires neither T3 (only fires on transition *into* `succeeded`) nor T4. Document this in §4.2/§5 so QA doesn't file a false bug; the op stays correctly internal.
- **M7 — [LOW] Scope-count wording.** The plan says v1 "wraps the two repo-backed table groups (5 of the 12 payment tables)", but the op set covers **4** tables (`payment_invoices`, `payment_transactions`, `payment_plans`, `payment_plan_installments`). The 5th repo-backed table, `stripe_connect_accounts` (`StripeConnectRepository`), is intentionally a **leaf** (Connect onboarding = money-movement path). Clarify in §1 so the count is unambiguous.
- **M8 — [LOW] P0.5 justification is overstated + commit-independence.** The Scheduling executor tests `jest.mock` the repository **singleton module** — no constructor DI was needed for mocking. So converting `PaymentRepository`'s 3 classes to DI is a **consistency refactor**, not a test prerequisite; reframe P0.5's rationale accordingly and keep the singleton exports byte-compatible (`new X(supabaseServer)`, as `PaymentPlanRepository.ts:752` does). Also commit **P0.1** (and any route/repo bug-fixes) **independently of the plugin**, per the Scheduling lesson (a repo bug-fix and a plugin bug must never entangle).

### Nice-to-have (non-blocking)

- Routing `ChatCommandExecutor.ts:3466` → `record_manual_payment` is a slight behavior *improvement*: the rogue insert omits `paid_at`, so T4 currently sets the invoice's `paid_at = NULL`; `recordManualPayment` sets it properly. Flag for QA behavior-preservation, not a blocker.
- `send_invoice` is status-only (`status='sent'`, no email dispatch — matches `CapabilityEngine.sendInvoice:529`). Note that any actual email delivery is a leaf, so agents don't expect a send side-effect.
- `getNextInvoiceNumber` (`PaymentRepository.ts:509`) is read-max-then-increment (non-atomic); the `UNIQUE(user_id, invoice_number)` constraint (`migration:36`) will throw on a concurrent collision. Pre-existing; out of scope, worth a one-line note.
- `mark_installment_paid` similarly writes no transaction (revenue not affected) — same family as M2; a one-liner in §4.2 keeps the accounting model coherent.

### Approval

[ ] Workplan approved — proceed to implementation
[x] **Revision required — fold in M1–M8, then cleared for implementation** (no second full review; a diff against M1–M8 + the §-answers above suffices). M1 is the load-bearing one: do not ship `record_manual_payment` without the invoice-ownership guard.

## 9.1 Implementation notes (Dev)

**Date:** 2026-08-10 · **Branch:** `docs/business-os-event-driven-architecture` (current; RM held — no commit)
**Status:** Code complete — typecheck clean on all touched/new files, 24/24 unit tests pass.

### Files created
| File | Purpose |
|---|---|
| `lib/plugins/definitions/payments-plugin-v2.json` | Plugin definition — key `payments`, `isSystem:true`, `visibility:"business_os"`, `access_strategy:{type:"db_active"}`, internal `auth_config` stub, **23 actions** each with `description`+`parameters`+`output_guidance` (M5a). `domain:"payments"` per action (M4). M2 accounting divergence encoded in `output_guidance` for `record_manual_payment` (revenue-bearing) vs `mark_invoice_paid`/`mark_installment_paid` (status-only). |
| `lib/server/payments-plugin-executor.ts` | `PaymentsPluginExecutor` — delegates all 23 ops to the payment repos; M1 ownership guard; delegate-only (no CRM write / no manual invoice flip). |
| `lib/server/payments-plugin-executor.test.ts` | 24 pure mocked unit tests. |

### Files modified
| File | Change |
|---|---|
| `lib/business-os/chat/CapabilityEngine.ts` | **P0.1** — re-pointed `createInvoice` at `paymentInvoiceRepository.create({...})` single-arg payload incl. `user_id` + `getNextInvoiceNumber(userId)` (mirrors `SafeExecutionLayer:1948`). Removed the latent TS2554 arity error (verified: 20→19 file errors). Self-contained — independently committable (M8). |
| `lib/repositories/CRMActivityRepository.ts` | **P0.4** — deleted the dead `logPayment` method (verdict: **zero callers**, confirmed by grep across `lib/ app/ components/`); left an explanatory comment. |
| `lib/repositories/PaymentRepository.ts` | **P0.5** — converted all 3 classes (`PaymentTransactionRepository`/`PaymentInvoiceRepository`/`StripeConnectRepository`) to `constructor(supabase: SupabaseClient = supabaseServer)`; singleton exports unchanged (byte-compatible). **P0.7** — added `count(userId, {status?})` to `PaymentInvoiceRepository` (head-only exact count). Query logic otherwise untouched. |
| `lib/business-os/ChatCommandExecutor.ts` | **P0.2/P0.3** — added `PAYMENTS_PLUGIN_KEY`; rerouted invoice.create (`create_invoice`) and payment.record (`record_manual_payment`) through `pluginExecuter.execute(...)`, mirroring the Scheduling `SCHEDULING_PLUGIN_KEY` pattern. Removed both direct-DB writes. |
| `lib/server/plugin-manager-v2.ts` | Added `'payments-plugin-v2.json'` to `corePluginFiles`. |
| `lib/server/plugin-executer-v2.ts` | Imported + registered `'payments': PaymentsPluginExecutor`. |

### M1–M8 handling
- **M1 (HIGH)** — `record_manual_payment` verifies `paymentInvoiceRepository.findById(invoice_id, userId)` returns a row **before** delegating (not-found OR lookup-error → `access_denied`); same pre-check for a supplied `contact_id`. Required unit tests present (foreign invoice_id null, foreign invoice_id error, foreign contact_id) — all assert `recordManualPayment` is never called.
- **M2** — encoded in `output_guidance`: `record_manual_payment` = canonical revenue-bearing path; `mark_invoice_paid`/`mark_installment_paid` = status-only, not counted in revenue.
- **M3/P0.7** — `count()` added; backs `count_invoices`.
- **M4** — `domain:"payments"` (confirmed present in the V6 `Domain` enum; no enum change).
- **M5** — every action carries `output_guidance` (not `output_schema`); `create_invoice` self-generates `invoice_number` via `getNextInvoiceNumber`.
- **M6** — partial/full refund trigger re-fire documented in the executor `create_refund_record` comment.
- **M7** — 4 tables wrapped; `stripe_connect_accounts` left a leaf (`StripeConnectRepository` unwired).
- **M8** — P0.5 done as a pure consistency refactor; P0.1 kept self-contained for independent commit.

### Deviation (contact_id ownership check vs "no CRM repo import")
The plan's delegate-only guardrail says "No CRM repo import". M1 also requires a `contact_id` ownership pre-check. A raw Supabase query would violate the mandatory repository pattern (stronger rule). Resolution: import `crmContactRepository` for a **read-only** `findById` ownership check only — the guardrail's intent (never **write** `crm_activities`; T3 owns that) is fully preserved because the executor performs no CRM writes. Documented inline at the import site.

### Verification
- `npx tsc --noEmit`: new files (`payments-plugin-executor.ts`, test, JSON) + `PaymentRepository.ts`, `CRMActivityRepository.ts`, `plugin-manager-v2.ts`, `plugin-executer-v2.ts` all clean (0 errors). `ChatCommandExecutor.ts` shows only the two pre-existing known errors (`is_free` :1088, `company` :2495) — no new errors. `CapabilityEngine.ts` error count **dropped** 20→19 (P0.1 removed the arity error; remaining are the pre-existing systemic `as Record<string, unknown>` casts).
- `npx jest lib/server/payments-plugin-executor.test.ts`: **24/24 pass**.

### Task list
- [x] P0.1 — CapabilityEngine invoice-create fix (self-contained)
- [x] P0.4 — logPayment dead-code verdict + deletion
- [x] P0.5 — PaymentRepository DI refactor
- [x] P0.7 — PaymentInvoiceRepository.count
- [x] Step 2 — payments-plugin-v2.json (23 actions, M2/M5 guidance)
- [x] Step 2 — PaymentsPluginExecutor (M1 guard, delegate-only, refund DB-only)
- [x] Register in corePluginFiles + executorRegistry
- [x] P0.2/P0.3 — reroute ChatCommandExecutor invoice.create + payment.record
- [x] Tests — payments-plugin-executor.test.ts (24 tests)
- [x] Typecheck + test verification

### 9.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-10**
**Status:** ✅ **APPROVE** — cleared for QA. Highest-risk (money) module reviewed line-by-line against M1–M8; the load-bearing M1 tenant-isolation guard is correctly implemented and defended in depth, delegate-only is honoured, and the Step-0 remediations (P0.1/P0.4/P0.5/P0.7) are behaviour-preserving. No blocking findings. Independent verification (typecheck + tests) run by SA, results below.

#### Priority-by-priority verdict

**1. M1 cross-tenant ownership guard (HIGH, load-bearing) — ✅ PASS.**
- `payments-plugin-executor.ts:296-301` — `record_manual_payment` calls `paymentInvoiceRepository.findById(invoice_id, userId)` and throws `access_denied` on **error OR not-found** (`if (invoice.error || !invoice.data)`), **before** the `recordManualPayment` insert (`:310`). Same for `contact_id` (`:303-308`).
- **No bypass on the missing/empty-invoice_id path.** The guard is gated on truthy `invoice_id`; when absent the executor passes `invoiceId: undefined` and the repo coerces `invoiceId || null` (`PaymentRepository.ts:348`), so T4 (fires only on `invoice_id NOT NULL`) never touches a foreign row. An empty-string `''` is likewise neutralised to `null` by the same coercion — a `''` UUID could never match another tenant's invoice. The transaction itself is always `user_id`-scoped (`PaymentRepository.ts:346`). Guard cannot be bypassed to write a cross-tenant row.
- **Tests genuinely assert the insert is NOT reached.** `payments-plugin-executor.test.ts:176-198` — all three M1 cases (`invoice_id`→null, `invoice_id`→error, `contact_id`→null) assert `expect(transactionRepo.recordManualPayment).not.toHaveBeenCalled()` in addition to `rejects.toThrow(/access_denied/)`. Not merely "it throws."

**2. Delegate-only vs T3/T4 — ✅ PASS.** The executor never inserts `crm_activities` and never flips an invoice→`paid` on a succeeded transaction — `record_manual_payment` delegates and returns (`:310-321`). The **only** CRM import is the read-only `crmContactRepository.findById` ownership check (`:22`, `:304`), documented at the import site as the M1 deviation. Grep confirms no `crm_activities` write and no `markAsPaid`/`update` call inside `record_manual_payment` (asserted by `test:172-173`). Deviation is architecturally justified (raw Supabase would violate the stronger repository-pattern rule) and preserves the guardrail's intent (executor performs zero CRM writes).

**3. P0.1 CapabilityEngine fix — ✅ PASS.** `CapabilityEngine.ts:508-545` now calls `paymentInvoiceRepository.create({...})` with a single correct payload incl. `user_id`, generated `invoice_number` (`getNextInvoiceNumber`, error-guarded), and `status:'draft'`; mirrors the SafeExecutionLayer reference. Introduces **no** new TS error — SA independently confirmed the file's error count dropped **20 → 19** (the TS2554 arity error is gone; the remaining 19 are the pre-existing systemic `as Record<string, unknown>` casts + unrelated scheduling/CRM schema-drift errors, none in the P0.1 block).

**4. P0.5 DI refactor — ✅ PASS.** All 3 classes (`PaymentTransactionRepository:94`, `PaymentInvoiceRepository:378`, `StripeConnectRepository:762`) converted to `constructor(supabase: SupabaseClient = supabaseServer)`; singleton exports pass `supabaseServer` (byte-compatible). Query logic unchanged; no `user_id` scoping lost. Pure consistency refactor as M8 framed it.

**5. P0.7 count() — ✅ PASS.** `PaymentRepository.ts:545-565` — `.select('*', { count: 'exact', head: true }).eq('user_id', userId)` + optional `.eq('status', ...)`, returns `{ data: count || 0, error }` and logs errors via Pino. Backs `count_invoices` (`executor:136-137`, `test:117-122` asserts `count(userId, {status})` and returns the scalar).

**6. P0.2/P0.3 reroute — ✅ PASS.** `ChatCommandExecutor` invoice.create + payment.record now route through `pluginExecuter.execute(userId, 'payments', op, params)` (`create_invoice` / `record_manual_payment`); both direct-DB writes removed. Behaviour preserved incl. the improvement flagged in §9 nice-to-haves: `record_manual_payment` sets `paid_at` (`PaymentRepository.ts:355`) which the old rogue insert omitted. `invoiceResult.data` is the unwrapped invoice object (base executor wraps as `{success, data:result}`, `base-plugin-executor.ts:135-137`), so `.invoice_number` read is valid. Typecheck shows **only** the 2 known pre-existing errors: `ChatCommandExecutor.ts:1088` (`is_free`) and `:2495` (`company`). No new errors.

**7. Definition validity — ✅ PASS.** 23 actions, each carrying `description` + `parameters` + `output_guidance` (satisfies `validatePluginDefinition:764`, avoids the load-throw). `db_active ⇒ isSystem:true` holds (`:9-12`); every action `domain:"payments"`; `visibility:"business_os"`. Registered in `corePluginFiles` (`plugin-manager-v2.ts`) **and** `executorRegistry` (`plugin-executer-v2.ts:67`). M2 accounting divergence is explicitly encoded in the `mark_invoice_paid` / `record_manual_payment` / `mark_installment_paid` / `get_revenue` `output_guidance` — agents are steered to the revenue-bearing path.

**8. Standards — ✅ PASS.** Repository pattern throughout (no direct Supabase in the new/changed executor or CapabilityEngine paths); zero `console.*` in the touched files; no hardcoded model names; `user_id` scoping on every op. New files are TS-strict clean. The executor's `any` on `connection`/`parameters` matches the `BasePluginExecutor.executeSpecificAction` abstract contract and the shipped CRM/Scheduling precedent — not a new pattern.

#### Independent verification (run by SA)

| Check | Result |
|---|---|
| `npx jest lib/server/payments-plugin-executor.test.ts` | **24/24 pass** |
| `npx tsc --noEmit` — new files (`payments-plugin-executor.ts`, test, JSON) + `PaymentRepository.ts`, `CRMActivityRepository.ts`, `plugin-manager-v2.ts`, `plugin-executer-v2.ts` | **0 errors** |
| `ChatCommandExecutor.ts` | only the **2 known pre-existing** errors (`:1088` `is_free`, `:2495` `company`) — no new errors |
| `CapabilityEngine.ts` error count (stash-diff) | **20 → 19** (P0.1 removed the arity error, added none) |

#### Findings (non-blocking)

1. `payments-plugin-executor.ts:59-62` — `connection`/`parameters` typed `any` — Low. Matches the base-class abstract signature and CRM/Scheduling precedent; acceptable, no change required.
2. `PaymentRepository.getNextInvoiceNumber` is read-max-then-increment (non-atomic); the `UNIQUE(user_id, invoice_number)` constraint throws on a concurrent collision — Low, **pre-existing**, already logged in §9 nice-to-haves. Out of scope.
3. **Commit discipline (M8) reminder — not a code defect.** The working tree currently bundles the Payments changes together with the separate **Scheduling** module reroutes in `ChatCommandExecutor.ts` (booking create/query/cancel repo migration) and the scheduling plugin files. Per M8, **P0.1 (`CapabilityEngine.ts`) should be committed independently of the plugin**, and Payments must not entangle with Scheduling. Flagged for RM/commit staging — no code action for Dev.

#### Code Approved for QA: **Yes**

---

## 10. QA report

**QA — 2026-08-10**
**Test mode:** full (correctness of guardrails prioritised — highest-risk money module)
**Strategy used:** A (Jest unit run) + static/source guardrail audit + JSON-definition validation. No dev server required; the Modules-tab live round-trip (§6) remains a user-manual step.
**Focus:** api / schema / security (M1 tenant isolation, delegate-only)
**Skipped:** live DB round-trip (T3/T4 fan-out) — lean-test policy §8, QA-manual by design.
**Input source:** prompt keywords + workplan §§1–5/§9.

### Verdict: **PASS-WITH-NOTES**

The load-bearing M1 tenant-ownership guard is correctly implemented and cannot be bypassed; delegate-only is honoured (zero CRM writes, no invoice→paid flip on the transaction path); definition is valid and registered; typecheck introduces no new errors; 24/24 tests pass. Two non-blocking notes: (1) 8 of the 23 ops have no dedicated dispatch test, and (2) an unused `businessProfileRepository` import. No bugs found. **Cleared for commit** (no High/Medium bug open).

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Unit suite passes | ✅ | Pass | 24/24 in 2.7s (pure mocked repos — lean) |
| Dispatch for all 23 ops | ⚠️ | Partial | 15/23 ops have a dedicated dispatch assertion; 8 have none (see Note 1). All 23 exist as switch cases and match the JSON action set. |
| M1 — foreign `invoice_id` rejected BEFORE `recordManualPayment` | ✅ | Pass | 2 tests (null + error) assert `recordManualPayment` **not** called; source-verified guard at executor `:296-301` before delegate `:310`. |
| M1 — foreign `contact_id` rejected BEFORE record | ✅ | Pass | test `:192-198`; guard `:303-308`. |
| M1 — empty/missing `invoice_id` cannot reach a foreign row | ✅ | Pass | Guard gated on truthy `invoice_id`; repo coerces `invoiceId \|\| null` (`PaymentRepository.ts:348`) → T4 fires only on `invoice_id NOT NULL`, so `''`/undefined neutralised. Test `:200-205`. |
| `user_id` scoping on every op | ✅ | Pass | `userId = connection.user_id`; missing → `access_denied` (test `:220-221`). Every repo call passes `userId`. |
| Delegate-only (no `crm_activities` write, no invoice→paid on tx path) | ✅ | Pass | Grep: `crm_activities` only in comments; `markAsPaid`/`.update` never called inside `recordManualPayment`; test `:171-173` asserts neither. |
| `create_refund_record` DB-only (no processor) | ✅ | Pass | Delegates to `createRefund`; test `:208-216`. |
| Imports only payment repos + businessProfileRepository + read-only crmContactRepository | ✅ | Pass | No CRM-activity repo, no direct Supabase (grep clean). See Note 2 (businessProfileRepository unused). |
| Definition: 23 actions, each desc+params+output_guidance, db_active⇒isSystem, visibility business_os, domain payments | ✅ | Pass | Programmatic validation — all pass `validatePluginDefinition` (`plugin-manager-v2.ts:764`). |
| Registered in corePluginFiles + executorRegistry | ✅ | Pass | `plugin-manager-v2.ts:37`, `plugin-executer-v2.ts:68`. |
| Typecheck — new/changed files clean; only 2 known ChatCommandExecutor errors | ✅ | Pass | New/payment files 0 errors; `ChatCommandExecutor` only `:1088` (`is_free`) + `:2495` (`company`); `CapabilityEngine` 19 errors (SA-claimed 20→19), all pre-existing systemic casts/scheduling drift — none in the P0.1 invoice-create block. |
| Lean build (fast pure unit tests, no DB/integration) | ✅ | Pass | All repos `jest.mock`ed; 2.7s. |

### Guardrail Audit (source-verified, not test-trusting)

- **M1 no-bypass — CONFIRMED.** The only path that reaches T4's unscoped `UPDATE payment_invoices … WHERE id = NEW.invoice_id` is `recordManualPayment` writing a `succeeded` transaction with a non-null `invoice_id`. That value only becomes non-null when `params.invoice_id` is truthy, and every truthy value first passes `findById(invoice_id, userId)` (deny on error OR not-found). Empty string / null / undefined are falsy → guard skipped → repo coerces to `null` → T4 never fires. There is **no code path** where a caller-supplied `invoice_id`/`contact_id` reaches the insert/trigger without the ownership check. SA's `invoiceId || null` + user_id-scoped-insert claim verified (`PaymentRepository.ts:346-348`).
- **Delegate-only — CONFIRMED.** Executor performs zero `crm_activities` writes (only comments reference it) and never calls `markAsPaid`/`update` inside `recordManualPayment`. The only CRM usage is a read-only `crmContactRepository.findById` for the M1 pre-check — architecturally justified (raw Supabase would violate the repository-pattern rule) and preserves the guardrail intent (no CRM writes; T3 owns them).
- **Imports — CONFIRMED.** `PaymentRepository`, `PaymentPlanRepository`, `BusinessProfileRepository`, `CRMContactRepository` (read-only). No CRM-activity repo, no direct Supabase client.

### Edge Cases (reasoned — PASS/CONCERN)

1. **record_manual_payment on an owned-but-already-paid invoice (T4 re-fire) — PASS.** A new `succeeded` transaction re-flips the invoice `paid` (idempotent, refreshes `paid_at`). Note: a genuinely new INSERT with `status='succeeded'` also re-fires T3, logging another CRM activity — correct for a second real payment; only a concern if a caller double-records the *same* payment, which is caller responsibility, not an executor defect.
2. **create_refund_record partial vs full (M6) — PASS.** Executor passes `isFullRefund`; partial keeps `succeeded` (T4 harmlessly re-marks paid), full sets `refunded` (no trigger). Executor comment (`:158-159`) and `output_guidance` match the M6 note.
3. **count_invoices with/without status — PASS.** `count(userId, { status: params.status })`; repo guards `if (opts?.status)` (`PaymentRepository.ts:556`), so `undefined` skips the filter; always `user_id`-scoped, returns `count || 0`.
4. **get_revenue delegation — PASS.** `getTotalRevenue(userId, start_date, end_date)`, both dates optional; test asserts pass-through.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Edge Cases / Notes (nice to fix — non-blocking)
1. **8 ops have no dedicated dispatch test.** The prompt/§4.5 aim of "dispatch for all 23 ops" is only 15/23 covered. Untested (pure trivial delegation, all TS-clean): `update_invoice`, `get_transaction`, `list_plans`, `get_plan`, `update_plan`, `create_installments`, `list_installments`, `cancel_installments`. Risk is low (uniform `unwrap(await repo.method(...))` shape, matching tested siblings), but the suite does not literally exercise every op. Suggest adding one assertion each in a later pass. — File: `lib/server/payments-plugin-executor.test.ts` — Severity: Low.
2. **Unused import `businessProfileRepository`** (`payments-plugin-executor.ts:17`). db_active gating happens upstream in `AccessStrategyResolver`; the executor never references it. Vestigial (mirrors CRM/Scheduling scaffold). No functional impact (tsc clean). Suggest removing. — Severity: Low.

### Test Outputs

```
PASS lib/server/payments-plugin-executor.test.ts
Tests:       24 passed, 24 total
Time:        2.725 s
```

```
Definition: action count: 23 | isSystem: true | visibility: business_os | access_strategy: {"type":"db_active"}
actions missing desc/params/output_guidance: NONE (valid)
actions with domain != payments: NONE
```

Typecheck (touched files): `payments-plugin-executor.ts`, test, JSON, `PaymentRepository.ts`, `CRMActivityRepository.ts`, `plugin-manager-v2.ts`, `plugin-executer-v2.ts` → **0 errors**. `ChatCommandExecutor.ts` → only the 2 known pre-existing (`:1088` `is_free`, `:2495` `company`). `CapabilityEngine.ts` → **19** errors (matches SA's 20→19; all pre-existing systemic casts / scheduling-CRM schema drift; none in the P0.1 invoice-create block).

### Final Status
- [x] All acceptance criteria pass — ready for commit (2 Low non-blocking notes)
- [ ] Issues found — Dev must address before commit

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Created | Drafted from the read-only Payments assessment; awaiting SA review. Scope: internal DB-record ops over the 5 repo-backed tables; Stripe + automation infra as leaves; Step-0 remediation of the CapabilityEngine bug + two rogue callers + dead logPayment. |
| 2026-08-10 | SA-approved + M1–M8 folded in | APPROVE-WITH-CHANGES. Folded: **M1** cross-tenant ownership guard on `record_manual_payment` (T4 UPDATE is not user_id-scoped — HIGH), **M2** revenue-accounting divergence (`record_manual_payment` revenue-bearing vs `mark_invoice_paid` status-only), **M3** add `count()` to invoice repo (P0.7), **M4** `domain:"payments"` already exists, **M5** `output_guidance` + self-generated `invoice_number`, **M6** partial/full refund trigger re-fire note, **M7** scope is 4 tables (stripe_connect_accounts is a leaf), **M8** P0.5 is a consistency refactor + commit P0.1 independently. Cleared for implementation. |
