# Requirement: Business OS — Business Data Reset & Purge

> **Last Updated**: 2026-09-15

**Created by:** BA
**Date:** 2026-09-14
**Status:** ✅ **Approved by SA — in implementation.** Amended 2026-09-15 from SA's workplan review (FR-26, FR-28, AC-26, AC-40; D11, D12; §8.7 closed).

## Overview

A capability to delete and clean up **all data belonging to one business** in Business OS. It serves two audiences from one engine: the product owner resetting a test business between test cycles, and a **real customer exercising "delete my business"** from account settings. Two levels are offered — **Reset** (wipe the data, keep the business shell) and **Purge** (remove the business entirely, leaving a bare login).

Because Stripe — not this database — executes recurring payment schedules and refunds, the deletion is **gated by a live pre-flight check of external payment state**. If the business has money in flight in either direction, the purge **refuses to run**. See [§10.5](#105-pre-flight-external-state-gate).

The investigation in §§1–8 establishes the blast radius. §9 records product decisions D1–D12; §10 is the requirement. §11 carries the one follow-through still open during Dev. §13 and §14 are SA's review passes.

**Three structural findings drive everything:**
- [§2](#2-there-is-no-business-id) — there is no `business_id`. A *business* is a **user account**.
- [§1.2](#12-prior-art-an-existing-deletion-script-in-this-repo-is-broken-in-exactly-the-way-sa-warned-about) — the repo contained a user-deletion script embodying precisely the platform-wide-delete failure SA identified as this feature's real risk.
- [§1.3](#13-a-third-deletion-path-exists-and-it-is-customer-facing) — a **live, customer-facing** delete path already ships, and it is broken in a way that makes it worse than having none.

---

## Table of Contents

1. [Evidence base & honesty statement](#1-evidence-base--honesty-statement)
2. [There is no `business_id`](#2-there-is-no-business-id)
3. [Table inventory — the blast radius](#3-table-inventory--the-blast-radius)
4. [Indirect / second-degree data](#4-indirect--second-degree-data)
5. [Delete semantics already in the codebase](#5-delete-semantics-already-in-the-codebase)
6. [Ordering constraints & trigger hazards](#6-ordering-constraints--trigger-hazards)
7. [Non-table state](#7-non-table-state)
8. [The exclusion set — enumerated](#8-the-exclusion-set--enumerated)
9. [Product decisions (D1–D12)](#9-product-decisions-d1d12)
10. [Requirement](#10-requirement)
11. [Open follow-throughs during Dev](#11-open-follow-throughs-during-dev)
12. [Notes on integration points](#12-notes-on-integration-points)
13. [SA Review — first pass](#sa-review--2026-09-14-first-pass)
14. [SA Review — second pass](#sa-review--2026-09-14-second-pass)
15. [Change History](#change-history)

---

## 1. Evidence base & honesty statement

| Source | Used for |
|---|---|
| `supabase/migrations/**` (127 files) | Table DDL, FK actions, triggers, RLS policies, storage buckets |
| **`supabase/SQL Scripts/**` (65 files)** | Added after SA's first pass — this directory was missed initially. Kernel/platform DDL, and the prior-art deletion script in §1.2 |
| [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md) | The 42-table catalog as of 2026-08-04 |
| [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) | Insight tables; hazards H1–H10 |
| [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) | The `/test-business-os` account model |
| `lib/business-os/catalog/catalog.generated.ts` | Live introspection of a **hard-coded 25-table allow-list**, generated 2026-09-03. See §1.1 |
| `lib/payments/stripeAccountContext.ts` | Stripe account resolution; the direct-charge model; "absent evidence refuses" |
| `lib/business-os/bizql/mutate/ActionLog.ts` | The idempotency-key construction behind FR-24 |
| `supabase/migrations/20260828b_payment_refund_ledger.sql` | Refund lifecycle, reconciler queue, dashboard-issued-refund class |
| `lib/repositories/*.ts` (54 files) | Which tables have an owning repository |
| `vercel.json` | The 11 crons |
| SA review passes 1 & 2 (§13, §14) | Independent verification of B1–B4, T1, T2, buckets, crons, repositories; the T5 correction; two completeness sweeps |
| **SA workplan review 2026-09-15** ([workplan §12](/docs/workplans/business-os-business-data-purge.md#12-sa-review-notes)) | The FR-26/FR-28/AC-26/AC-40 amendments; D11; D12; §8.7's static closure. **Corrected two claims this document had wrong** — see §6.3 and FR-26 |

### 1.1 Migration files are NOT proof the table exists — and neither is `catalog.generated.ts` alone

[Insights hazard H6](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md#11-known-state--hazards) records **58 migrations deliberately not applied**. SA additionally established that `catalog.generated.ts` introspects only a **hard-coded 25-table list** and its committed output is **stale**.

| Tag | Meaning |
|---|---|
| ✅ **Verified live** | Present in `catalog.generated.ts` (live introspection, 2026-09-03) |
| 📄 **Migration-only** | Read from DDL; unverified — resolved by the FR-1 mechanism |
| ❓ **Existence unknown** | Referenced by code or named in a stale list, with no live evidence |

**Tag counts: 22 ✅ · 35 📄 · 3 ❓.**

### 1.2 Prior art: an existing deletion script in this repo was broken in exactly the way SA warned about

`supabase/SQL Scripts/delete_user_by_id.sql` was a pre-existing "delete all data for a user" script, headed *"FOR TESTING ONLY"*, containing the exact defect SA named as the real service-role vector:

```sql
DECLARE
    user_id UUID := 'USER_ID_HERE';
BEGIN
    DELETE FROM agent_executions WHERE user_id = user_id;
```

The PL/pgSQL variable is named `user_id`, identical to the column. Under `plpgsql.variable_conflict = use_variable` this resolves to `WHERE <var> = <var>` — **constantly true — deleting every row in the table, for every user on the platform.** Under the PostgreSQL default it raises "column reference is ambiguous". **Which of those happens is a database setting, not a property of the file.**

Consequences, all still binding:

1. **Live evidence** for SA's ruling that the guard belongs on *scoping*, not ownership pre-checks. NFR **Security — delete scoping** and **AC-45** exist because of it.
2. The purge RPC must **never bind a parameter whose name matches a column it filters on**. Mandated: `p_user_id`.
3. The file itself was **removed** (FU-13, PR #39) rather than repaired — a repaired script is a second deletion path with no gate, snapshot, audit or descriptor guard.

### 1.3 A third deletion path exists, and it is customer-facing

Surfaced by Dev during workplanning and verified line-by-line by SA. `components/business-os/settings/SecurityTab.tsx:305` renders a **"Delete account"** button calling **`POST /api/user/delete-account`**. It ships today, to customers, and this requirement had never mentioned it.

| Verified fact | Consequence |
|---|---|
| It deletes `auth.users` | **Violates D3 and FR-30**, which forbid that absolutely |
| It deletes `user_preferences` | That is a **`K*` table** — retained by both levels under this requirement (§3.14) |
| It touches **exactly one** of the 60 in-scope tables (#60) | The other 59 are left behind entirely |
| It audits **intent but never outcome** | A failed run is indistinguishable from a successful one in the audit trail |
| It **500s at phase 6 for every onboarded user** — 16 `auth.users` FKs have no `ON DELETE` clause | And it does so **after phases 1–5 have irreversibly run**, so it reliably produces a half-deleted account and then reports failure |

The last row is why this is worse than having no button: a path that always fails *after* destroying part of the account leaves more unaccounted residue than one that never starts. **D11** puts it in scope.

> A **fourth** destructive path — `/api/auth/cleanup-incomplete`, which deletes `auth.users` on a predicate the live onboarding flow never writes — was also found during workplanning. It is **out of this cycle's scope and escalated separately** (workplan §12.9 E1), noted here only because it bears on this feature's premise: this codebase has accumulated several destructive paths nobody inventoried, and gating, scoping, snapshotting and auditing deletion is the whole point of this work.

---

## 2. There is no `business_id`

No table has a `business_id` column. The tenancy root is `auth.users(id)`:

```
auth.users(id)
   └── business_profiles.user_id   UNIQUE   ← 1:1. THIS is the "business" row.
   └── every other Business OS table .user_id
```

- `20260721_create_business_profiles.sql` — `user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)`. ✅ SA-confirmed.
- [DATA_MODEL §13 obs. 12](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#13-data-model-observations--risks) — *"`business_profiles` is the natural per-tenant anchor."*

**Consequences:** "delete business X" = "delete all Business OS rows where `user_id = X`"; one login = one business; a purge is close to an account wipe, hence the conservative opt-ins in §10.3 and the absolute exclusion of `auth.users`.

---

## 3. Table inventory — the blast radius

**60 user-scoped tables**, plus 1 view, 3 storage buckets, and the enumerated exclusion set in §8.

**R column:** `D` = deleted by Reset · `K` = kept by Reset, deleted by Purge · **`K*` = retained by BOTH levels**.

### 3.1 Business profile

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 1 | `business_profiles` | `user_id` **1:1** | K | ✅ | UNIQUE `user_code`, UNIQUE partial `subdomain`. **No DELETE RLS policy**. Reset retains it — the enumeration source for `calendar-sync` (FR-26) |

### 3.2 CRM — 5 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 2 | `crm_contacts` | `user_id` | D | ✅ | CRM hub — referenced by 13 tables. **BEFORE DELETE trigger T1**. One of `insight-detect`'s four enumeration sources |
| 3 | `crm_activities` | `user_id` + contact CASCADE | D | ✅ | **Deleted LAST inside the RPC** (T5 ordering) |
| 4 | `crm_pipeline_stages` | `user_id` | K | ✅ | Seeded by `/api/onboarding/build` |
| 5 | `crm_tasks` | `user_id` + contact SET NULL | D | ✅ | |
| 6 | `contact_documents` | `user_id` + contact CASCADE | D | 📄 | Rows point at storage objects |

### 3.3 Website — 5 tables + 1 view

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 7 | `website_pages` | `user_id` | D | ✅ | UNIQUE `subdomain` |
| 8 | `website_blocks` | **indirect** (`page_id` CASCADE) | D | ✅ | **No `user_id`.** Child ids captured in snapshot (AC-5) |
| 9 | `website_content` | `user_id` **1:1** | D | 📄 | **No DELETE RLS policy** |
| 10 | `website_page_views` | `user_id` + page CASCADE | D | ✅ | **Open INSERT policy** `WITH CHECK (true)` |
| 11 | `websites` | unknown | D | ❓ | Queried only by the two [known-dead detectors (H2)](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md#11-known-state--hazards) — probably phantom |
| — | `website_analytics_summary` (VIEW) | — | — | 📄 | No rows of its own |

### 3.4 Scheduling — 4 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 12 | `scheduling_services` | `user_id` | D | ✅ | |
| 13 | `scheduling_bookings` | `user_id` | D | ✅ | Blocked by **B2**; reached by **T1**. One of `insight-detect`'s four enumeration sources |
| 14 | `scheduling_availability_exceptions` | `user_id` | D | 📄 | |
| 15 | `external_calendar_events` | `user_id` | D | 📄 | **Repopulated by `calendar-sync` within ~5 min after a Reset** (FR-26) |

### 3.5 Payments — 14 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 16 | `payment_invoices` | `user_id` | D | ✅ | Unpaid rows drive **C3**. One of `insight-detect`'s four enumeration sources |
| 17 | `payment_transactions` | `user_id` | D | ✅ | Blocked by **B1**. Pending rows drive **C2** |
| 18 | `payment_refunds` | `user_id` | D | ✅ | `transaction_id … RESTRICT`. SELECT-only RLS. `status='pending'` drives **C2** |
| 19 | `payment_plan_subscriptions` | `user_id` | D | ✅ | `booking_id … RESTRICT`. SELECT-only RLS. Drives **C1**. **B2 + B4** |
| 20 | `payment_plans` | `user_id` | D | ✅ | |
| 21 | `payment_plan_installments` | `user_id` | D | ✅ | CASCADE from plan **and** subscription |
| 22 | `payment_events` | `user_id` | D | 📄 | |
| 23 | `payment_automation_rules` | `user_id` | D | 📄 | |
| 24 | `payment_automation_executions` | `user_id` + rule CASCADE | D | 📄 | Durable queue |
| 25 | `payment_reminders` | `user_id` | D | 📄 | Durable queue; dead-letter via `status='failed'` |
| 26 | `payment_processors` | `user_id` | K | 📄 | Holds `credentials` JSONB |
| 27 | `stripe_connect_accounts` | `user_id` **1:1** | K | 📄 | Gate reads this **before** any delete |
| 28 | `saved_payment_methods` | `user_id` + contact CASCADE | D | 📄 | |
| 29 | `payment_methods` | `user_id` | D | ❓ | `2026-08-14_drop_payment_methods.sql` — applied? |

### 3.6 Email automation — 6 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 30 | `email_sequences` | `user_id` | D | 📄 | |
| 31 | `email_sequence_steps` | `user_id` + sequence CASCADE | D | 📄 | |
| 32 | `email_campaigns` | `user_id` | D | 📄 | |
| 33 | `email_sends` | `user_id` + contact CASCADE | D | ✅ | |
| 34 | **`email_unsubscribes`** | `user_id` | **K\*** | 📄 | 🔒 **RETAINED ON BOTH LEVELS (D8).** A third-party consent record. `auth.users` survives (D3), so the same `user_id` can re-onboard and resume emailing people who opted out |
| 35 | `email_sequence_enrollments` | `user_id` + CASCADEs | D | 📄 | |

### 3.7 Intake — 2 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 36 | `user_intake_settings` | `user_id` **1:1** | K | 📄 | Created by `20260728_create_intake_tables.sql` — **older than #37, so #37's ❓ does not propagate here** |
| 37 | `business_intake_forms` | `user_id` | K | ❓ | Absent from `catalog.generated.ts`, which `process.exit(1)`s on a missing table — the snapshot predates it. Resolved by FR-1 in Dev's first hour; §10.2 ¶2, §11.1 |

### 3.8 Onboarding & chat — 7 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 38 | `onboarding_conversations` | `user_id` | D | 📄 | Append-only RLS |
| 39 | `onboarding_prompt_ideas` | `user_id` | D | 📄 | |
| 40 | `command_sessions` | `user_id` | D | 📄 | |
| 41 | `business_chat_conversation` | `user_id` is **PK** | D | 📄 | |
| 42 | `business_chat_action_log` | `user_id` | D | 📄 | UNIQUE `idempotency_key` — deleting re-arms plan-level sends. **Accepted; FR-24** |
| 43 | `business_chat_saved_plans` | `user_id` | D | 📄 | |
| 44 | `business_chat_plan_cache` | `user_id` **NULLABLE** | D (own rows only) | 📄 | ⚠️ `user_id IS NULL` = portable, cross-tenant — **excluded (§8.2)**. Those surviving rows are why a `planId` can recur post-purge (FR-24) |

### 3.9 Capabilities — 2 tables

| # | Table | Scoping | R | Status |
|---|---|---|---|---|
| 45 | `user_capabilities` | `user_id` | K | 📄 |
| 46 | `user_capability_blocks` | **indirect** (CASCADE) | K | 📄 |

### 3.10 Conversion / attribution — 2 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 47 | `smart_links` | `user_id` | D | ✅ | UNIQUE `code` |
| 48 | `smart_link_clicks` | **indirect** (CASCADE) | D | ✅ | **No `user_id`.** Insert policy `WITH CHECK (true)` |

### 3.11 Channel insights — 2 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 49 | `channel_connections` | `user_id` | K | ✅ | Holds `account_token`. **Always deleted by Purge** regardless of checkbox. Reset retains it **including `last_synced_at`**, which is why channel stats return only on the next scheduled sync (FR-26) |
| 50 | `channel_metrics_daily` | `user_id` | D | ✅ | Repopulated by `channel-metrics-sync` on the connection's next due sync — **up to ~20 h** |

### 3.12 Insights — 7 tables

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 51 | `insights` | `user_id` | D | ✅ | Self-FK `correlation_parent_id` SET NULL |
| 52 | `owner_insight_history` | `user_id` + insight CASCADE | D | 📄 | |
| 53 | `insight_outcomes` | `user_id` | D | 📄 | **A 7th insight table** (`OutcomeRepository.ts`) — absent from both the data-model doc and the as-built Insights doc, which says six |
| 54 | `business_events` | `user_id` | D | 📄 | Hazard H1 — no emitters. One of `insight-detect`'s four enumeration sources |
| 55 | `derived_metrics` | `user_id` | D | 📄 | |
| 56 | `insight_automations` | `user_id` | D | 📄 | **Blocks B3** |
| 57 | `business_health_summaries` | `user_id` | D | 📄 | |

### 3.13 Kernel (insight-triggered) — 2 tables

| # | Table | Scoping | R | Status |
|---|---|---|---|---|
| 58 | `kernel_executions` | `user_id` | D | 📄 |
| 59 | `kernel_action_log` | `user_id` | D | 📄 |

### 3.14 Owner configuration — 1 table

| # | Table | Scoping | R | Status | Notes |
|---|---|---|---|---|---|
| 60 | **`user_preferences`** | `user_id` | **K\*** | 📄 | 🔒 **RETAINED ON BOTH LEVELS.** Holds `preferred_language` and currency. Two reasons: deleting it mid-run resets the owner's language **while they read the result screen**, and it is an **account preference on a login that survives every level** (D3), so deleting it renders the owner's *next sign-in* in the wrong language. ⚠️ **The existing `/api/user/delete-account` route deletes this table** — see §1.3, D11 |

### 3.15 Still unresolved — answered by FR-1 in Dev's first hour

| Table | Question |
|---|---|
| `processed_webhook_events` | Does it carry `user_id`? If not it is **global** and moves to §8 |
| `payment_methods` | Was the drop applied? |
| `business_intake_forms` | Does it exist at all? (§10.2 ¶2, §11.1) |
| `websites` | Does it exist at all? |
| `user_settings_complete` | **Resolved by SA:** a view PostgREST reports as the FK target; the real target is `auth.users(id)` |
| Landing pages | **Resolved by SA:** no `landing` table exists; the `landing` surface is a `website_pages` row |

### 3.16 `supabase/SQL Scripts/` — disposition of every user-scoped table

| Table | Scoping | Disposition |
|---|---|---|
| `agent_prompt_threads` | `user_id` CASCADE | **In the "delete my agents" checkbox** |
| `agent_prompt_workflow_generation_sessions` | `user_id` | **Same** |
| `user_memory` | `user_id` CASCADE | **Same** — the user's own remembered preferences |
| `audit_trail` | `user_id` **SET NULL** | The third opt-in checkbox |
| `advisor_reports` | `user_id` + `org_id` | **Excluded** — org-analytics advisor, a different subsystem (§8.6) |
| `automation_slas` | `user_id` + `org_id` + `agent_id` | **Excluded** (§8.6) |
| `metric_baselines` | `user_id` + `org_id` | **Excluded** — agent-execution analytics, not `derived_metrics` (§8.6) |
| `group_metrics_rollup` | `user_id` / `org_id` | **Excluded** (§8.6) |
| `storage_usage` | `user_id` | **Excluded** — platform quota accounting (§8.5) |
| `agent_versions`, `usage_records`, `audit_logs`, `user_api_keys`, `contact_submissions` | named only by the now-removed `delete_user_by_id.sql` | ⚠️ **Existence unverified — probably phantom names in a stale script.** No `CREATE TABLE` in either DDL directory and no `.from()` reference (SA-verified). Listed so FR-1 can rule, **not** because they were found and excluded. **Caveat: `contact_submissions` is intake-shaped** — if FR-1 finds it live and user-scoped it needs a **fresh ruling, not the blanket exclusion** |

---

## 4. Indirect / second-degree data

| Risk | Table | Only reachable via | Mitigation |
|---|---|---|---|
| 🔴 | `website_blocks` | `page_id → website_pages` | CASCADE — verify live. **Child ids captured in the snapshot** so AC-5 is testable |
| 🔴 | `smart_link_clicks` | `smart_link_id → smart_links` | Same |
| 🔴 | `user_capability_blocks` | `user_capability_id → user_capabilities` | Same |
| 🟡 | `payment_reminders` | Also CASCADE from invoice/installment | Order-sensitive |
| 🟡 | `payment_plan_installments` | CASCADE from plan **and** subscription | Order-sensitive |
| 🟡 | `owner_insight_history` | CASCADE from `insights` | |
| 🟡 | `crm_activities` | CASCADE from `crm_contacts` | Deleted last regardless (T5) |
| 🟢 | `insights` children | Self-FK SET NULL | Cosmetic |

---

## 5. Delete semantics already in the codebase

### 5.1 No soft-delete convention exists in Business OS

`status='deleted'` is a **kernel `agents`** convention; no `deleted_at` on any Business OS table; three tables have unrelated `archived` states. Hence D4.

### 5.2 CASCADE from `auth.users` is partial and inconsistent

`business_profiles`, `crm_contacts`, `crm_activities`, `crm_pipeline_stages`, `payment_processors`, `payment_plans`, `payment_events`, `payment_automation_rules`, `onboarding_conversations`, `website_pages` declare the FK with **no ON DELETE clause** (= NO ACTION). "Delete the auth user and let CASCADE handle it" does not work — and is forbidden anyway (D3).

> This is not theoretical. SA counted **16 `auth.users` FKs with no `ON DELETE` clause**, which is exactly why the existing `/api/user/delete-account` route 500s at its final phase for every onboarded user (§1.3).

> ⚠️ The [duplicate CRM migrations](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#3-crm) disagree about CASCADE **and about triggers**. Resolved by FR-1's dump (`pg_constraint` + `pg_trigger` + `pg_policies`).

### 5.3 RLS makes this a service-role operation

~20 tables give the logged-in user no DELETE policy. Hence the §10.9 **delete-scoping** guard.

---

## 6. Ordering constraints & trigger hazards

### 6.1 Hard blockers

| # | Blocked delete | Blocked by | Must delete first |
|---|---|---|---|
| **B1** | `payment_transactions` | `payment_refunds.transaction_id … ON DELETE RESTRICT` | `payment_refunds` |
| **B2** | `scheduling_bookings` | `payment_plan_subscriptions.booking_id … ON DELETE RESTRICT` | `payment_plan_subscriptions` |
| **B3** | `kernel_executions` | `insight_automations.last_run_execution_id` — no `ON DELETE` = NO ACTION | `insight_automations` |
| **B4** | `crm_contacts` | **T1** deletes future `scheduling_bookings`, tripping **B2** from a direction B2 alone does not name | `payment_plan_subscriptions` before `crm_contacts` |
| B5 | `insights` | `owner_insight_history` CASCADE; kernel FKs SET NULL | — (safe) |

The purge overrides B1/B2 **by ordering**, never by altering a FK. ✅ All SA-confirmed against DDL.

### 6.2 Triggers

| # | Trigger | Fires on | Effect during a delete-only purge |
|---|---|---|---|
| T1 | `delete_future_bookings_on_contact_delete_trigger` | BEFORE DELETE on `crm_contacts` | Deletes **future** bookings only. **Source of B4** |
| T2 | `recompute_transaction_refund_state_trigger` | AFTER DELETE on `payment_refunds` | UPDATEs `payment_transactions` **including `status`** |
| T3 | `propagate_refund_to_booking_trigger` | AFTER UPDATE on `payment_transactions` | UPDATEs `scheduling_bookings.payment_status` |
| T4 | `update_invoice_on_payment` | Transaction changes | **Unscoped** — `WHERE id = NEW.invoice_id` |
| **T5** | `log_*_activity` triggers | `AFTER INSERT OR UPDATE **OF status**` | ⚠️ **Corrected by SA.** A delete-only purge fires **exactly one** path: `payment_refunds` delete → T2 updates `payment_transactions.status` → `log_payment_activity_trigger` writes `crm_activities`. `propagate_refund_to_booking` writes `payment_status`, which `log_booking_activity_trigger` does **not** watch. **One path — AC-22 stands** |
| T6 | `ensure_user_code_on_insert` | BEFORE INSERT on `business_profiles` | Re-seed after Purge generates a **new** `user_code`; Reset keeps it |

**T5 is handled by ordering, not suppression.** `crm_activities` is deleted **last**, as the final statement inside the RPC transaction. Suppression is **not available**: `ALTER TABLE … DISABLE TRIGGER` is table-owner-only and `SET session_replication_role = replica` is superuser-only.

### 6.3 Crons and public endpoints re-populate after commit

Six of eleven crons write into the purge set. **The enumeration source is what decides whether a cron finds a business after a Reset** — and this document previously got that wrong:

| Cron | Schedule | Enumerates tenants from | Returns after a **Reset**? |
|---|---|---|---|
| `calendar-sync` | 5 min | `business_profiles` (**K**) | ✅ **Yes — ~5 min.** `calendar_last_synced_at` is retained and already stale |
| `channel-metrics-sync` | hourly :30 | `channel_connections` (**K**) | ✅ **Yes — but on that connection's next scheduled sync, up to ~20 h.** `last_synced_at` is retained, so a Reset does not make the connection due |
| `insight-detect` | 15 min | `payment_invoices` · `scheduling_bookings` · `crm_contacts` · `business_events` — **all four `D`** | ❌ **No.** Only once the owner creates new data |
| `insight-metrics` | daily 03:00 | `D` tables | ❌ No |
| `insight-automations` | 5 min | `insight_automations` (**D**) | ❌ No |
| `payment-reminders` / `payment-retry` | daily 08:00 / hourly | `D` tables | ❌ No |

Plus two **public unauthenticated INSERT paths**: `website_page_views` and `smart_link_clicks`.

**Requirement implication (FR-14):** **Purge** removes the rows that make a business visible to every producer above. **Reset** deliberately keeps `business_profiles` and `channel_connections`, so what returns is calendar events and channel stats — **not insights**. FR-26 governs the copy.

> ⚠️ **The earlier claim that "new `insights` appear within 15 minutes" after a Reset was false** and has been removed. It assumed `insight-detect` enumerates from `business_profiles`; it does not.
>
> *Noted in passing, not a change to this requirement:* each of `insight-detect`'s four enumeration selects carries `.limit(500)` with no pagination — a pre-existing tenant-coverage bug, irrelevant to the purge, worth its own follow-up.

---

## 7. Non-table state

| Kind | Item | Handled by |
|---|---|---|
| Storage | `contact-documents` (private), `website-images` (public) — objects under `{auth.uid()}/…` | ✅ Both levels. **Non-transactional** — FR-22 |
| Storage | **`business-purge-snapshots`** (new, private, no RLS policy) | §10.7 |
| Queue | `payment_reminders`, `payment_automation_executions` | ✅ Rows only |
| Queue | `payment_refunds` pending rows — the reconciler's work queue | 🛑 **BLOCKS** (C2) |
| External | Live subscription schedules | 🛑 **BLOCKS** (C1) |
| External | Pending/uncaptured payments **and in-flight refunds** | 🛑 **BLOCKS** (C2) |
| External | Unpaid invoices owed to the business | 🛑 **BLOCKS** (C3) |
| External | Connect account, saved customers, calendar events | 📋 Reported, non-blocking |
| External | Emails already delivered | ❌ Irreversible |
| External | `subdomain` — the `*.agentpilot.io` rewrite | ✅ Purge frees it; **the name becomes claimable** — FR-25 |
| Platform | `plugin_connections` · agents+threads+sessions+memory · `audit_trail` | ⚙️ Opt-in, off by default (§10.3) |
| Platform | `profiles`, `auth.users` | 🚫 Never deleted (D3) — **and the existing delete-account route violates this** (§1.3, D11) |

---

## 8. The exclusion set — enumerated

> ⚠️ **Machine-readable input, not prose.** An `information_schema` enumeration (FR-1 route (a)) **cannot distinguish "Business OS" from "kernel"**. AC-37 is therefore only implementable if the engine holds an **enumerated known-and-excluded list** alongside its known-and-deleted list. Every row below becomes one descriptor at `level: 'never'`.

### 8.1 Global catalogs — no `user_id`

| Table | Scope | Why |
|---|---|---|
| `capabilities` | `global` | Shared catalog, RLS off |
| `capability_building_blocks` | `global` | Same |
| `website_templates` | `global` | Public read; breaks website creation platform-wide |
| `intake_form_templates` | `global` | ❓ a DROP exists in `20260910_business_intake_forms.sql` — FR-1 confirms |

### 8.2 Cross-tenant rows inside an in-scope table

| Table | Rule |
|---|---|
| `business_chat_plan_cache` **WHERE `user_id IS NULL`** | Portable rows shared by **all** tenants. Predicate must be `user_id = p_user_id`; **`<>`, `IS DISTINCT FROM` and `NOT IN` are forbidden** — the danger is a future "tidy-up" rewriting equality as exclusion. These surviving rows are also why a `planId` can recur post-purge (FR-24) |

### 8.3 Retained Business OS tables

| Table | Scope | Why |
|---|---|---|
| `email_unsubscribes` | `user_id`, `level: never` | D8 — third-party consent record |
| `user_preferences` | `user_id`, `level: never` | Account preference on a login that survives (D3) |

### 8.4 Organisation / multi-user

| Table | Why |
|---|---|
| `organizations` | Every user gets a row via `get_or_create_user_organization` |
| `organization_members` | Deleting a membership can strand a multi-user org |

### 8.5 Billing & quota

| Table | Why |
|---|---|
| `subscriptions` | Billing state |
| `usage_records` | ❓ existence unverified (§3.16); billing if present |
| `storage_usage` | Platform quota accounting |

### 8.6 Org analytics (a different subsystem)

| Table | Why |
|---|---|
| `advisor_reports` | Org-analytics advisor, not Business OS Insights |
| `automation_slas` | Workflow/agent SLAs |
| `metric_baselines` | Agent-execution analytics, not `derived_metrics` |
| `group_metrics_rollup` | Workflow-group analytics |

### 8.7 Kernel / V6 learning — ✅ closed

| Table | Evidence |
|---|---|
| `calibration_history` | SA sweep; `20260428_calibration_history_table.sql` |
| `error_patterns` | SA sweep; `20260629_error_patterns_table.sql` |
| `execution_anomalies` | SA sweep |
| `execution_baselines` | SA sweep |
| `plugin_performance` | SA sweep; `20260629_plugin_performance_table.sql` |
| `behavior_rules` | `20260629_enhance_behavior_rules.sql` |
| `intent_examples` | `20260629_intent_examples_table.sql` |
| `execution_model_tracking` | `20260629_execution_model_tracking.sql` |

> ✅ **This list was previously marked "seeded, not closed", with a Dev obligation to expand two plural-named migrations. That obligation is now discharged — statically, not by enumeration.** SA opened both files: `20260629_platform_learning_tables.sql` creates **`workflow_patterns`** and **`global_failure_patterns`**, and **neither carries a `user_id`**, so neither can ever appear in FR-1 route (a)'s user-scoped enumeration and neither needs an exclusion descriptor. `20260629_execution_optimization_tables.sql` creates two tables already listed above. **Nothing is outstanding.** T2 confirms against the live dump rather than discovering.

### 8.8 Platform identity

| Table | Why |
|---|---|
| `admin_users` | Locks admins out — **and is now the authorisation source for the internal surface (D12)** |
| `profiles` | D3 |
| `auth.users` | D3 — never deleted, at any level, under any option |

### 8.9 Unverified names — ruling deferred to FR-1

`agent_versions` · `usage_records` · `audit_logs` · `user_api_keys` · `contact_submissions`

No `CREATE TABLE` in either DDL directory and no code reference (SA-verified). **If FR-1 finds any live and user-scoped it needs a ruling, not a default** — and **`contact_submissions` is intake-shaped**, so it must not inherit the blanket exclusion.

---

## 9. Product decisions (D1–D12)

| # | Decision | Ruling |
|---|---|---|
| **D1** | Audience | **Both** — a customer-facing "delete my business" *and* the owner's test cycles |
| **D2** | Levels | **Reset** and **Purge**, per §10.2 |
| **D3** | Non-BOS data | **None by default**; three opt-in checkboxes off by default. **`auth.users` never deleted** |
| **D4** | Reversibility | **Hard delete + pre-purge JSON snapshot.** No soft delete, no undo |
| **D5** | Surfaces | **Two surfaces, one engine**, caller's own session user only. No admin surface in v1 |
| **D6** | External state | **Pre-flight gate, then report.** Blocks on C1/C2/C3; never calls a provider cancel API in v1 |
| **D6a** | Gate scope | **Hard block on both surfaces. No override, no bypass flag** |
| **D6b** | In-flight refunds | `payment_refunds.status='pending'` folds into **C2** |
| **D7** | Grace period | **None.** Immediate on typed confirmation |
| **D8** | `email_unsubscribes` | **RETAINED on both levels.** BA proposed deletion; SA overruled because `auth.users` survives (D3), so the same `user_id` can re-onboard and resume emailing people who opted out. **The customer copy must not claim total erasure** (FR-23) |
| **D9** | Customer surface | **FLAG-GATED.** Customer surface behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`, off by default. Un-gating requires **AC-2, AC-5, AC-10, AC-13, AC-16, AC-24, AC-37** demonstrated on a real account. ⚠️ **Amended by D12** — the internal surface is *not* simply "unflagged"; it is admin-gated server-side, because without that D9's staging is a fiction |
| **D10** | Stripe key | **No read-only credential exists today** — only `STRIPE_SECRET_KEY` (53 references). Provisioning `STRIPE_RESTRICTED_KEY_READONLY` is a Vercel-env task, **same blocker shape as `CRON_SECRET`** — an external dependency with an owner, not a blocker on starting work. Until it lands **the gate runs on the fully-privileged key — a known, time-boxed state.** FU-12 |
| **D11** | **The existing "Delete account" button is IN SCOPE** *(new, 2026-09-15)* | The customer-facing button at `SecurityTab.tsx:305` → `POST /api/user/delete-account` (§1.3) is **this feature's problem, not a separate one.** The user **rejected** replacing it with a support-request message — self-service erasure stays. **Dev decides and justifies between: (a)** reuse the existing button as the customer-facing surface and build the correct functionality behind it, or **(b)** build the new surface and formally deprecate the old button. **Decision pending Dev's justification**; either way the route's current behaviour — deleting `auth.users` (violating D3/FR-30), deleting the `K*` `user_preferences`, touching 1 of 60 tables, auditing intent but never outcome, and 500ing at phase 6 after phases 1–5 have irreversibly run — must not survive this cycle |
| **D12** | **Internal-surface authorisation moves server-side to `AdminAccessService`** *(new, 2026-09-15)* | SA **retracted** its first-pass approval of shipping the internal surface "unflagged". `/test-business-os` is on the middleware skip-onboarding list with **no admin gate**, and the page gates on `useAuth()` only — so an unflagged internal Purge would be **reachable by every signed-in customer who knows the URL**, while the polished surface sat behind a flag. That makes D9's staged rollout a fiction. **The user chose platform admins via `AdminAccessService`** (the `admin_users` table). The control is **server-side on the preview and commit routes**, not on tab visibility — a `NEXT_PUBLIC_` flag is a rendering hint, never an authorisation boundary; the tab renders only after that server check resolves. **Per CLAUDE.md § Security Rules, `profiles.role` must never be used for this** — it is user-writable and self-promotable; `admin_users` is the only trusted admin signal |

### BA's position on D8, preserved

BA proposed deleting `email_unsubscribes`, reasoning that a purged business cannot send. **That premise was wrong** — D3 keeps `auth.users`, so the same login re-onboards under the same `user_id`. SA's overrule is correct and BA does not contest it.

### ⚠️ Residual risk

1. **TOCTOU** — narrowed to one round-trip under the RPC shape; both gate timestamps logged (FR-19).
2. **Non-blocking residue** — calendar events, Connect account, Stripe customers.
3. **Liveness** — a Stripe outage means you cannot delete. A refusal, never a false pass.
4. **`email_unsubscribes` and `user_preferences` survive** — the copy must be honest (FR-23).
5. **The gate runs on a fully-privileged key** until FU-12 lands (D10).
6. **A broken customer-facing delete path ships today** until D11 resolves (§1.3).

---

## 10. Requirement

### 10.1 Users & user stories

- As a **business owner**, I want to delete my business and all its data, and be told plainly what is kept and why.
- As a **business owner**, I want the platform to stop me if deleting would leave my clients being charged, or a refund owed to them in limbo.
- As a **business owner**, I want to know exactly which Stripe items to resolve and where.
- As the **product owner testing Business OS**, I want to wipe my business and immediately re-run a scenario without redoing onboarding or reconnecting OAuth.
- As a **developer**, I want the purge to fail loudly if the live schema or Stripe does not answer cleanly.

### 10.2 The two levels

| | **Reset** | **Purge** |
|---|---|---|
| **Pre-flight gate** | Applies — identical | Applies — identical |
| `business_profiles`, `crm_pipeline_stages`, `user_capabilities` (+blocks) | Kept | Deleted |
| `user_intake_settings`, `business_intake_forms` | Kept | Deleted |
| `payment_processors`, `stripe_connect_accounts` | Kept | Deleted |
| `channel_connections` | Kept | Deleted |
| **`email_unsubscribes`, `user_preferences`** | **Kept** | **Kept (D8 / §3.14)** |
| All other §3 tables | Deleted | Deleted |
| Storage buckets | Emptied | Emptied |
| Re-run tests without onboarding? | **Yes** | No |
| What returns on a timer | Calendar events (~5 min), channel stats (next sync, up to ~20 h). **Not insights** — FR-26 | Nothing — all producers starved |

**Re-seed divergence:**

1. **`user_code` / `subdomain`.** Reset keeps them, so `/c/{userCode}` links and the public address still resolve. Purge releases both; a re-seed fires T6 and generates a **new** `user_code`, and the subdomain becomes claimable (FR-25).
2. **Intake.** ⚠️ **Contingent, and narrow.** The **settings** half is firm: `user_intake_settings` (#36) comes from an older migration, so Reset keeps the business's intake configuration regardless. The **forms** half depends on `business_intake_forms` (#37, ❓): *if it exists*, Reset keeps the `draft` and `published` rows so re-testing needs no regeneration, and Purge loses archived versions. **If FR-1 finds it absent, this half is void and the table drops out of the purge set.** Settled from FR-1's output **before the workplan goes to SA code review**.
3. **Capabilities.** Reset keeps the dashboard's tabs; Purge returns to pre-onboarding state.
4. **Stripe.** Reset keeps Connect, so test payments work immediately.

### 10.3 Opt-in extras (all off by default)

| Checkbox | Deletes | Default |
|---|---|---|
| **Also disconnect integrations** | `plugin_connections` | Off |
| **Also delete my agents** | `agents`, `agent_executions`, `agent_logs`, `agent_memory`, `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions`, `user_memory` | Off |
| **Also delete my activity history** | `audit_trail` rows for this user | Off |

Constraints:
- `auth.users` / `profiles` never deleted, under any combination.
- **Purge always deletes `channel_connections`** regardless of the integrations checkbox.
- With the audit checkbox ticked, the audit record of *this* purge is still written afterwards.
- **The gate runs before every deletion including the extras** — `plugin_connections` is one of the two sources of a Stripe account id (AC-33).

### 10.4 The two surfaces, one engine

| | `/test-business-os` → Danger Zone | Account settings → Delete my business |
|---|---|---|
| **Authorisation** | **`AdminAccessService` (`admin_users`), enforced server-side on the routes (D12)** | `getUser()`, session user only |
| Flag | No `NEXT_PUBLIC_` flag — the admin check is the boundary | **`NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`, off by default (D9)** |
| Target | Caller's own session user only | Caller's own session user only |
| Levels | Reset **and** Purge | Purge |
| Gate | Enforced, no override | Enforced, no override |
| Copy | Technical; table names and counts | Plain language, localised, no table names |
| Dry-run | Mandatory | Mandatory |
| Confirmation | Type the business name | Type the business name |

**Neither surface accepts a `user_id` from the client.** Tab visibility is never the control — it renders only after the server check resolves.

### 10.5 Pre-flight external-state gate

#### 10.5.1 Blocking conditions

| # | Condition | Why it blocks | Local signal |
|---|---|---|---|
| **C1** | Active recurring subscription schedules | Stripe executes the schedule; deleting the local record leaves clients charged with nothing recording it | `payment_plan_subscriptions.status ∈ {pending, active, past_due, paused}` |
| **C2** | Pending/uncaptured payments **and in-flight refunds** | Money in flight either way. A pending refund is money owed **back to a client** | `payment_transactions.status='pending'`; `payment_refunds.status='pending'` |
| **C3** | Unpaid invoices owed to the business | The owner loses the record of money owed to them | `payment_invoices.status ∈ {sent, overdue}` |

> **C3 — a deliberate decision.** BA assessed it as different in kind: an unpaid invoice is the business's **own** loss. The owner saw that reasoning and chose to block anyway. FU-1a is the cheapest softening.

#### 10.5.2 Enumerate from the provider; Reset gated identically

**From Stripe, not from local rows.** A schedule or refund created in the Stripe dashboard has no local row.

**Multi-account.** `resolveUserConnectAccounts()` returns a **list**, warning when the two sources differ. Every read carries `stripeRequestOptions()` / `stripeAccount` — these are **direct charges on connected accounts**, and a platform-scoped read returns "no such object": a **false all-clear**.

**Reset is gated identically.** Reset keeps Connect but deletes subscriptions, transactions, invoices, refunds and reminders — so the business keeps trading while Stripe keeps charging and settling, with the local mirror gone, producing **silently wrong books**.

#### 10.5.3 Failure and absence semantics

| Situation | Behaviour |
|---|---|
| Provider unreachable / error / timeout / budget exceeded | **Fail closed — refuse.** Per `stripeAccountContext.ts`: *"A failed read is not a 'no'… so it refuses, loudly"* |
| **No Stripe connected** | **Skipped cleanly.** Not a failure, no warning |
| Account revoked / "does not exist" | Provider failure → fail closed |
| Multiple accounts | Check all; any blocking state blocks |

#### 10.5.4 Placement and TOCTOU

Evaluated **inside the dry-run**, and **re-evaluated immediately before the RPC**. v1 accepts the residual window; both timestamps are logged (FR-19).

#### 10.5.5 What the block tells the user

Per condition: what was found, how many, and the id to search for in Stripe (subscription / schedule / payment-intent / **refund** / invoice).

### 10.6 Dry-run preview and confirmation

1. A destructive run is reachable only after a dry-run in the same session, same target, level and options, carrying the same `correlationId` (FR-21).
2. The dry-run returns gate outcome, per-table counts, per-bucket object counts, non-blocking provider items, and any table FR-1 could not verify.
3. If the gate blocks, **no confirmation is offered**.
4. Confirmation requires typing the business name.
5. Material count drift is **reported**, not hidden.
6. No grace period (D7).

### 10.7 Pre-purge snapshot

1. Written before any deletion: every row to be deleted keyed by table, **plus the child ids of `website_blocks` / `smart_link_clicks` / `user_capability_blocks`**, the gate result, and the non-blocking provider inventory.
2. **Location:** private bucket `business-purge-snapshots`, `public = false`, `{user_id}/{iso8601}.json`. **No storage RLS policy granting `authenticated` anything**, no read route, no signed-URL helper. Service role only.
3. **Retention is a mechanism: 7 days, with a shipped enforcer.** If the enforcer does not ship, the customer-path snapshot carries counts and row ids only — **no contact PII**.
4. **"Verified" means write-then-read-back.**
5. **Snapshot failure aborts the run** with zero rows deleted.
6. Forensic artefact, **not** a restore path.

### 10.8 Functional requirements

1. **Schema verification — FR-1 route (a).** A **`SECURITY DEFINER` RPC** returning `information_schema.columns` + `pg_constraint` + `pg_trigger` + `pg_policies`, consumed **at run time**. Route (b) was rejected: a manifest cannot detect a table added after it was committed. Conditions: **(i)** `EXECUTE` granted to **`service_role` only, never `authenticated`** — a SECURITY DEFINER function returning `information_schema` is a schema-disclosure endpoint if browser-callable; **(ii)** the engine holds §8's **enumerated** exclusion descriptors; **(iii)** it **fails closed** when an expected table is missing, or a user-scoped table is in neither set.
2. Operates on exactly one business, `user_id` from `getUser()`. **No client-supplied id accepted.**
3. Two levels per §10.2 and the **R** column.
4. Three opt-in extras, off by default, per §10.3.
5. **Pre-flight gate before any deletion, both levels, both surfaces, no override.** Blocks on C1, C2 (charges **and** refunds), C3.
6. The gate enumerates **from the provider across all connected-account candidates**, every read scoped with `stripeAccount`.
7. The gate **fails closed** on any provider error, timeout, 429-after-retry, or exceeded budget.
8. The gate is **skipped cleanly** when no Stripe account is connected.
9. The gate result appears **in the dry-run**; a blocked outcome suppresses confirmation.
10. The gate is **re-evaluated immediately before the RPC**; both must pass.
11. Typed confirmation of the business name. No grace period.
12. Pre-purge snapshot written, **read-back verified**, child ids captured (§10.7).
13. Covers every §3 table appropriate to the level, all storage buckets, and reports orphan counts for the three `user_id`-less tables.
14. **Purge** starves the six crons and two public INSERT paths; **Reset** does not, and says so (FR-26).
15. Respects **B1, B2, B3 and B4**; **never alters a FK definition**.
16. Never touches the §8 exclusion set or the portable `business_chat_plan_cache` rows.
17. **T5 residue prevented by ordering** — `crm_activities` deleted last inside the RPC.
18. **Three-phase execution:** **(1)** gate + snapshot in TypeScript, no transaction, all reads through repositories; **(2)** destructive commit as **one `SECURITY DEFINER` RPC** `purge_business_data(p_user_id uuid, p_level text, p_options jsonb)` returning per-table counts as JSONB; **(3)** storage removal, report, audit. **Resume is rejected.** Engine in **`lib/business-os/purge/`**.
19. Structured result: gate outcome, rows per table, storage objects deleted **and any that failed**, tables skipped and why, non-blocking provider state, snapshot path, **both gate timestamps and the commit timestamp**, duration.
20. Every run — **including blocked attempts** — written to the audit trail with actor, target, level, options, gate outcome, counts, snapshot path and timestamps.
21. **`correlationId` carried from the dry-run into the commit**, not regenerated.
22. **Storage removal is non-transactional.** It runs after the DB commit. Partial failure **reports per-object failures and surfaces the residue; it does not fail the run**.
23. **The customer copy must not claim total erasure.** `email_unsubscribes` and `user_preferences` survive. Required sentence, localised: *"People who asked you to stop emailing them are kept, so they won't be emailed again if you come back."*
24. **Duplicate-send re-arm: accepted, and documented.** `business_chat_action_log` is deleted; keys are **not** retained. `ActionLog.ts:47` builds `sha256(planId|stepId|itemId ?? '-')`. Where `itemId` is present it is an entity row id re-created post-purge with a **new UUID**, so the key is not reproducible. Where absent it reduces to `planId|stepId`, and a `planId` from the **portable** `business_chat_plan_cache` rows (§8.2) **is** reproducible — so the re-arm is real but confined to item-less, plan-level actions. **In exactly that case re-arming is correct:** a business that wiped its data should be able to send its welcome sequence again. The note appears on the **internal** surface's result only.
25. **Subdomain release is stated.** Purge frees `business_profiles.subdomain`; the old URL may later serve a **different** business. The result copy says so.
26. **Reset's post-state is not presented as permanent — and the UI must name the right things.** Reset keeps `business_profiles` and `channel_connections`, so **`calendar-sync` repopulates `external_calendar_events` within about five minutes** (it enumerates via `business_profiles`, and the retained `calendar_last_synced_at` is already stale), and **`channel-metrics-sync` repopulates `channel_metrics_daily` on that connection's next scheduled sync — up to ~20 hours**, because `channel_connections.last_synced_at` is retained and a Reset does not make the connection due. **Insights and metrics do not return on a timer:** `insight-detect` enumerates tenants from `payment_invoices` / `scheduling_bookings` / `crm_contacts` / `business_events`, all of which Reset deletes, and `insight-metrics` and `insight-automations` likewise read `D` tables — so they rebuild only once the owner creates new data. The UI must say this and **must not promise insights within 15 minutes**.
27. **Post-purge destination is specified.** After Purge, `business_profiles` is gone and the middleware onboarding gate routes the account into the onboarding wizard. The customer must not be silently dropped into "let's set up your business".
28. **Double submission is a provable no-op.** A second concurrent run returns "already running". Mechanism: **`pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` taken inside `purge_business_data`**, released automatically at COMMIT or ROLLBACK, with no unlock call that can leak. The pre-existing `pg_try_advisory_lock` wrapper (`supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql`) is **deliberately not used**: it is session-scoped, and `supabase-js` speaks PostgREST over a pooled connection, so it yields both false passes (a concurrent call served by another backend does not observe the lock) and permanent false blocks (a run that dies leaves the lock held on a connection handed to unrelated traffic). No new DDL beyond the purge RPC itself.
29. **Both routes validate input with Zod before any business logic** (mandatory rule 2).
30. `auth.users` and `profiles` are never deleted. ⚠️ **The existing `/api/user/delete-account` route violates this today** — D11 resolves it.
31. **No bypass flag, env var, query parameter or internal route may skip the gate** (D6a). The D9 flag hides the **surface**, never the **gate**; and per D12 the internal surface's boundary is server-side authorisation, not flag or tab visibility.

> **Note (was FR-27, relaxed by SA):** with `user_preferences` retained on both levels, resolving the owner's language before phase 2 is no longer load-bearing. Sensible ordering, not a requirement.

### 10.9 Non-functional requirements

- **Security — delete scoping (the guard that matters).** FR-2 / AC-28 already forbid a caller-supplied `user_id`, stronger than an ownership pre-check. The real service-role risk: **a purge is one missing `WHERE user_id = …` away from `DELETE FROM crm_contacts` platform-wide** — §1.2 shows a script that had that defect. Required:
  - One **declarative descriptor** per table — table, level (`reset` / `purge` / `never` / `optional:<checkbox>`), scope (`user_id`, `via: { parent, fk }`, `global`). **The executor iterates only that structure.**
  - **§8's exclusions are `level: 'never'` rows**, not prose — FR-1 route (a) cannot otherwise distinguish unknown from excluded.
  - A **unit test asserts the structural invariant**: every descriptor has a non-`global` scope or is `level: 'never'`, and **no delete is emitted without a scoping predicate**.
  - `business_chat_plan_cache` carries `user_id = p_user_id`; **`<>` / `IS DISTINCT FROM` / `NOT IN` forbidden**.
  - **RPC parameters prefixed `p_`**, never sharing a name with a column they filter on (§1.2).
  - The two unscoped triggers filter by `id`. Safe **provided no FK crosses tenants** — AC-24 tests that empirically.
  - The RLS bypass is documented in code per CLAUDE.md § Security Rules.
- **Security — authorisation boundary (D12).** The internal surface's control is **server-side on the preview and commit routes**, via `AdminAccessService` / `admin_users`. **`profiles.role` must never be used** — it is user-writable and self-promotable. A `NEXT_PUBLIC_` flag is a rendering hint, never an authorisation boundary.
- **Security — provider credentials.** **(a) No read-only Stripe credential exists;** the gate runs on the full-privilege `STRIPE_SECRET_KEY` — acceptable for v1 because the gate's surface is `list`/`retrieve` on an authenticated path, but **stated, not assumed** (D10, FU-12). **(b) No existing Stripe client to reuse** — 18 files each call `new Stripe(...)`. Dev creates `lib/stripe/client.ts`; **unbudgeted work the workplan must carry.** Do not migrate the other 18 this cycle.
- **Resilience — gate bounds (exceeding any bound is a refusal, never a truncated pass).** Three of four conditions use list endpoints with **no status filter**, so each is a **paginated traversal of account history**.
  1. **Time-window every unfilterable traversal** — `created: { gte: now − N days }`, N justified per condition.
  2. **Hard page cap and hard wall-clock budget — ≤ 10 s for the entire gate.** Exceeding either is a **fail-closed refusal with a distinct message**. Silently truncated results would be a false all-clear.
  3. **`export const maxDuration`** set explicitly on both routes, above the gate budget.
  4. **Retry is global, not per-read** — ≤2 for the whole gate.
  5. **429 is not a "no"** — retry, then refuse.
  6. **Cache the dry-run gate result for the session.**
- **Atomicity.** Per FR-18.
- **Duration & progress (customer path).** The workplan specifies the progress signal and the timeout message.
- **Rate limiting.** Both destructive routes rate-limited.
- **Data protection (customer path).** Residue is a compliance failure, not cosmetic.
- **Logging.** Pino, `correlationId` continuous across dry-run and commit. No `console.*`.
- **Repository pattern.** **Every read** in phase 1 goes through repositories. The RPC is the destructive commit only — the documented exception, rule-7 signed off.
- **Performance.** Set-wise deletes inside the RPC.
- **Accessibility.** Keyboard-operable dialogs; **blocked state announced to assistive technology, not conveyed by colour alone**.
- **Copy quality.** Plain language, localised via `LanguageContext` (en/es/he). Must include FR-23's retention sentence, FR-25's subdomain sentence and FR-26's corrected Reset copy.

### 10.10 Acceptance criteria

**Completeness**

- [ ] **AC-1** Dry-run on a seeded business returns non-zero counts for contacts, bookings, invoices, activities, insights.
- [ ] **AC-2** After a **Purge**, all §3 tables return **0 rows** for that `user_id`, **except `email_unsubscribes` and `user_preferences`**, which must be non-zero if they were non-zero before.
- [ ] **AC-3** After a **Reset**, every **K**/**K\*** table retains its rows and every **D** table returns 0. *(The `business_intake_forms` assertion is contingent on FR-1 — §10.2 ¶2.)*
- [ ] **AC-4** After either level, both content buckets contain no objects under that user's folder.
- [ ] **AC-5** **Orphan scan:** the child ids of `website_blocks`, `smart_link_clicks` and `user_capability_blocks` are **captured in the snapshot before the delete**, and after the Purge **those specific ids** are absent.

**The pre-flight gate**

- [ ] **AC-6** **C1** — active subscription schedule → refused on both levels and surfaces, zero rows deleted.
- [ ] **AC-7** **C2 (charges)** — pending/uncaptured payment → refused, zero rows deleted.
- [ ] **AC-8** **C2 (refunds)** — a `payment_refunds` row in `status='pending'`, and an unsettled refund at Stripe, each → refused, zero rows deleted.
- [ ] **AC-9** **C3** — unpaid (sent/overdue) invoice → refused, zero rows deleted.
- [ ] **AC-10** **Fail-closed:** Stripe stubbed to error/timeout → **refused**, zero rows deleted. *(D9 un-gating condition.)*
- [ ] **AC-11** **No Stripe connected** → completes normally, gate recorded as skipped, **no error or warning surfaced**.
- [ ] **AC-12** **Gate in the preview** — a blocked business returns the blocked outcome from the **dry-run**; the confirmation input is never offered.
- [ ] **AC-13** **Dashboard-created state is caught** — a schedule at Stripe with no local row, and a dashboard-issued refund with no local row, each block. *(D9 un-gating condition.)*
- [ ] **AC-14** **Multi-account** — blocking state on **either** candidate blocks; a connected-account object is not missed by a platform-scoped read.
- [ ] **AC-15** **No override** — no parameter, header, env var, route variant **or the D9 flag** permits a run while the gate blocks.
- [ ] **AC-16** The blocked message names, per condition, the count and the Stripe-side identifiers — including refund ids. *(D9 un-gating condition.)*
- [ ] **AC-17** **Gate budget** — a stubbed account exceeding the page cap or the 10 s budget → **refused** with the distinct budget message, never a truncated pass.
- [ ] **AC-18** Blocked attempts are written to the audit trail.

**The deletion traps**

- [ ] **AC-19** A business with `payment_refunds` and `payment_plan_subscriptions` rows (both in **non-blocking terminal** states) purges successfully — proves **B1**, **B2**, no FK altered.
- [ ] **AC-20** A `kernel_executions` row referenced by `insight_automations.last_run_execution_id` purges successfully — proves **B3**.
- [ ] **AC-21** **B4** — a `payment_plan_subscriptions` row whose `booking_id` points at a **future** booking of a contact being deleted purges successfully.
- [ ] **AC-22** After a **Purge**, `crm_activities` is empty — proves the single live T5 path left no residue.
- [ ] **AC-23** After a **Purge**, every §8 table is unchanged — the four global catalogs, `organizations`/`organization_members`, billing, org analytics, and the §8.7 kernel tables — **and `business_chat_plan_cache WHERE user_id IS NULL` matches on both row count and a content checksum**.
- [ ] **AC-24** A **second, different** business is completely unaffected — full cross-tenant sweep. *(D9 un-gating condition.)*
- [ ] **AC-25** **Purge** leaves no row causing the six crons to pick this business up. **Each cron's selection predicate is named in the workplan.**
- [ ] **AC-26** After a **Reset**, the UI states that calendar events resync within minutes, that channel stats refresh on their next scheduled sync, and that insights and metrics rebuild once new data is created. A later cron regenerating any of them is **not** a failure.
- [ ] **AC-27** A public `POST` to the page-view or smart-link-click endpoint after a **Purge** cannot create a row attributable to the deleted business.

**Safety & surfaces**

- [ ] **AC-28** The purge cannot be invoked for another `user_id` — body, header and query, on both routes.
- [ ] **AC-29** A destructive commit is rejected without a prior matching dry-run in the same session.
- [ ] **AC-30** A destructive commit is rejected when the typed name does not match.
- [ ] **AC-31** With all checkboxes **off**, `plugin_connections`, agents-and-friends and `audit_trail` are untouched; `auth.users` / `profiles` untouched in all cases.
- [ ] **AC-32** With integrations **off**, a **Purge** still deletes `channel_connections`.
- [ ] **AC-33** With integrations **on**, the gate still runs correctly — `plugin_connections` is read for account resolution **before** deletion.
- [ ] **AC-34** With **Also delete my agents** on, `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions` and `user_memory` are also removed.
- [ ] **AC-35** A failed snapshot write aborts with zero rows deleted; a snapshot that writes but fails **read-back** does the same.
- [ ] **AC-36** The snapshot bucket has **no** policy granting `authenticated` any access, and no route returns its contents.
- [ ] **AC-37** **Schema completeness** — the engine fails closed when an expected table is absent **and** when a user-scoped table exists in neither the delete set nor §8's enumerated exclusion set. **The FR-1 RPC is not executable as `authenticated`.** *(D9 un-gating condition.)*
- [ ] **AC-38** **Double submission** — two concurrent runs for the same user: the second returns "already running"; exactly one purge occurs. **The lock is transaction-scoped** — a run that dies leaves no lock held.
- [ ] **AC-39** **Zod** — malformed bodies rejected with 400 before any business logic, on both routes.
- [ ] **AC-40** **Authorisation and flag.** With `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` off, the customer surface is unreachable **and no other surface in the application offers Reset or Purge to a non-admin.** A non-admin calling the preview or commit routes for the internal surface or the Reset level receives **403 regardless of what the client renders** (D12).

**Behaviour after**

- [ ] **AC-41** After a **Reset**, the full test flow (contact → service → booking → invoice → payment) runs again without re-onboarding or reconnecting.
- [ ] **AC-42** After a **Purge**, re-seeding via `/api/onboarding/build` yields a working business with a **new** `user_code` (T6), documented in the result copy.
- [ ] **AC-43** The result names the non-blocking provider state left behind, **the retained `email_unsubscribes` / `user_preferences` (FR-23)**, and **the subdomain becoming claimable (FR-25)**.
- [ ] **AC-44** After a **Purge** on the customer surface, the user lands on the specified destination with the specified message — not silently in the onboarding wizard.

**Engineering**

- [ ] **AC-45** **Structural invariant** — the descriptor unit test fails when a descriptor is added without a scope, asserts that **no delete is emitted without a scoping predicate**, and asserts that **every §8 exclusion is present as a `level: 'never'` descriptor**.
- [ ] **AC-46** `correlationId` is identical across the dry-run and the commit, and both gate timestamps plus the commit timestamp appear in the audit row.
- [ ] **AC-47** Partial storage-removal failure reports per-object failures and surfaces residue **without** failing the run.
- [ ] **AC-48** Unit tests cover C1/C2(both halves)/C3, fail-closed, no-Stripe, gate budget, B1–B4, the §8 exclusion set and the descriptor invariant. Integration tests cover happy path + auth failure + invalid input + blocked-by-gate + missing-table failure.
- [ ] **AC-49** No `console.*` in any new or touched file; all logging via `createLogger` with a `correlationId`.

### 10.11 Out of scope (v1) and follow-ups

| # | Item | Priority |
|---|---|---|
| **FU-1** | Resolve provider state on purge — cancel schedules, settle refunds, void invoices, release Connect, delete calendar events | 🟡 |
| **FU-1a** | Clear a **C3** block in-product by voiding the unpaid invoices | 🟡 |
| **FU-2** | Close the TOCTOU window (provider-side freeze); needs FU-1 | 🟢 |
| **FU-3** | Data export alongside deletion | 🟡 |
| **FU-4** | Admin / support-initiated purge of **another** business (D5 keeps v1 self-service only; D12 gates *who may reach the internal surface*, not *whose data they may purge*) | 🟡 |
| **FU-5** | Restore-from-snapshot | 🟢 |
| **FU-6** | Soft delete / undo / grace period | 🟢 |
| **FU-7** | Pausing or fencing the crons during a run | 🟢 |
| **FU-8** | Scheduled cleanup of stale test businesses | 🟢 |
| **FU-9** | Deleting `auth.users` / closing the account | 🟢 |
| **FU-10** | Extend the gate to future payment processors | 🟢 |
| **FU-11** | **Replace retained `email_unsubscribes` addresses with salted hashes** — the resolution if legal later objects to D8 | 🟡 |
| **FU-12** | **Provision `STRIPE_RESTRICTED_KEY_READONLY`** and move the gate onto it (D10) | 🟡 |
| **FU-13** | ✅ **Done — `delete_user_by_id.sql` removed** (PR #39), not repaired | ✅ |
| **FU-14** | Migrate the other 18 `new Stripe(...)` call sites onto `lib/stripe/client.ts` | 🟢 |
| **FU-15** | **The `pg_try_advisory_lock` / `pg_advisory_unlock` wrappers are `SECURITY DEFINER` and granted to `authenticated`** — any logged-in user can take or release an arbitrary advisory lock id. Not used by this feature (FR-28), but a real exposure needing an owner, outside this cycle | 🟡 |
| **FU-16** | `insight-detect`'s four enumeration selects each carry `.limit(500)` with no pagination — a pre-existing tenant-coverage bug, irrelevant to the purge | 🟢 |

---

## 11. Open follow-throughs during Dev

1. **§10.2 ¶2 — the intake paragraph.** `business_intake_forms` is ❓; FR-1 is task 1 and answers it in Dev's first hour. If absent: the table drops out of the purge set, §10.2 ¶2's second half is deleted, and AC-3's intake assertion is dropped. Nothing architectural pivots on it. **The settings half is firm regardless.** Must close **before the workplan goes to SA code review**.
2. ~~**§8.7 — the kernel exclusion list is seeded, not closed.**~~ ✅ **Resolved 2026-09-15.** Discharged statically rather than by enumeration: `platform_learning_tables` creates `workflow_patterns` and `global_failure_patterns`, **neither of which has a `user_id`**, so neither can ever appear in FR-1 route (a)'s user-scoped enumeration; `execution_optimization_tables` creates two tables already listed. No Dev obligation remains — T2 confirms against the dump rather than discovering.
3. **D11 — Dev's justified choice** between reusing the existing Delete-account button as the customer surface, or building the new surface and formally deprecating the old button. Pending; must be recorded with its justification before the customer surface ships.

---

## 12. Notes on integration points

| System | Impact |
|---|---|
| **`lib/payments/stripeAccountContext.ts`** | Gate foundation — `resolveUserConnectAccounts()`, `stripeRequestOptions()`, "absent evidence refuses". Do not reimplement account resolution |
| **`lib/stripe/client.ts`** | **Does not exist — Dev creates it.** 18 files each call `new Stripe(...)`; the gate uses the new shared client. Unbudgeted; do not migrate the other 18 |
| **`lib/business-os/bizql/mutate/ActionLog.ts`** | `idempotencyKey = sha256(planId\|stepId\|itemId)` — the evidence behind FR-24 |
| **`supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql`** | **Not used by this feature** — session-scoped over a pooled connection, so unsuitable as a double-submit guard (FR-28). Recorded here because it is `SECURITY DEFINER` and granted to **`authenticated`**, letting any logged-in user take or release an arbitrary advisory lock id — a follow-up with an owner, outside this cycle (FU-15) |
| **`components/business-os/settings/SecurityTab.tsx:305` → `POST /api/user/delete-account`** | ⚠️ **The existing customer-facing delete path (§1.3), in scope under D11.** Deletes `auth.users` (violates D3/FR-30) and `user_preferences` (a `K*` table), touches 1 of 60 in-scope tables, audits intent but never outcome, and **500s at phase 6 for every onboarded user after phases 1–5 have irreversibly run.** Dev decides between reusing it and deprecating it |
| **`AdminAccessService` / `admin_users`** | **The internal surface's authorisation boundary (D12)**, enforced server-side on the preview and commit routes. **Never `profiles.role`** — user-writable and self-promotable. See [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) |
| **`middleware.ts:155–156`** | `/test-business-os` is on the **skip-onboarding-check** list with no admin gate — the reason D12 exists |
| **`supabase/migrations/20260828b_payment_refund_ledger.sql`** | The refund lifecycle C2's refund half gates on |
| **`lib/payments/` (PaymentPlanService, invoiceLifecycle, RefundService, cancelPlan)** | Existing lifecycle vocabularies — the gate's conditions must agree |
| **Account settings** | Destructive section behind `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` (D9), localised incl. blocked-state copy |
| **`/test-business-os`** | Danger Zone tab, **admin-gated server-side (D12)**, session-based, no gate bypass |
| **`lib/business-os/purge/`** | **Engine location (SA-ruled).** Not `lib/services/` |
| **`lib/repositories/**`** | All phase-1 reads |
| **`AuditTrailService`** | `BUSINESS_DATA_PURGED` / `..._BLOCKED`, non-blocking `.catch()`, severity ≥ `warning` |
| **Snapshot retention enforcer** | 7-day cleanup; host cron per the workplan's C-17 ruling |
| **`POST /api/onboarding/chat/reset`** | Existing precedent; the purge should **absorb** it rather than duplicate it |
| **`POST /api/onboarding/build`** | Re-seed counterpart (AC-42) |
| **Supabase Storage** | `contact-documents`, `website-images`, plus the new `business-purge-snapshots` |
| **Middleware onboarding gate** | Reads `business_profiles.onboarding_completed`; after Purge the account routes into onboarding — FR-27 owns the destination |

---

## SA Review — 2026-09-14 (first pass)

**Verdict:** 🔄 Rework required. Six blockers, all closed:

| # | SA item | Disposition |
|---|---|---|
| **SA-B1** | §3 incomplete; tags wrong; `SQL Scripts/` unread | ✅ Closed |
| **SA-B2** | FR-1's mechanism does not exist | ✅ Closed — route (a) |
| **SA-B3** | `email_unsubscribes` retained | ✅ Closed — D8 |
| **SA-B4** | Stripe credential/client/bounds premises wrong | ✅ Closed — D10 |
| **SA-B5** | Tenant-isolation guard aimed at the wrong vector | ✅ Closed — descriptor + invariant test |
| **SA-B6** | Missing NFRs | ✅ Closed |

---

## SA Review — 2026-09-14 (second pass)

**Verdict:** ✅ **Approved for Dev** — subject to SA-2P1, four rulings, and the `service_role`-only grant. All applied.

| Item | Ruling | Applied |
|---|---|---|
| **SA-2P1** | §8's prose categories cannot be evaluated by an `information_schema` enumeration; expand into `level: 'never'` descriptors; grant the FR-1 RPC to `service_role` only | ✅ §8 rewritten as nine subsections |
| **§11.1** | `user_preferences` → `K*` | ✅ §3.14, §8.3, §10.2 |
| **§11.2** | `business_intake_forms` ❓ does not block Dev; does not propagate to `user_intake_settings` | ✅ §3.7, §10.2 ¶2 |
| **§11.3** | FR-24 — accept the re-arm, delete the log | ✅ FR-24 |
| **§11.4** | FR-1 route (a) | ✅ FR-1 |
| §3.16 | Last row overstates certainty | ✅ Reworded; §8.9 |
| FU-13 | Remove, don't repair | ✅ Done, PR #39 |

---

## SA Review — 2026-09-15 (workplan review — amendments back into this requirement)

SA's workplan review produced changes to the approved requirement. SA deliberately did not edit this document from a workplan review and left BA exact replacement text ([workplan §12.6](/docs/workplans/business-os-business-data-purge.md)). All applied verbatim.

| # | Amendment | Applied |
|---|---|---|
| **1** | **FR-28** — `pg_try_advisory_lock` is session-scoped and unsafe over a pooled PostgREST connection (false passes *and* leaked locks). Replaced with **`pg_try_advisory_xact_lock` inside the RPC** | ✅ FR-28, AC-38, §12 |
| **2** | **FR-26** — the claim that insights return 15 minutes after a Reset is **false**; `insight-detect` enumerates from four `D` tables, not `business_profiles`. What returns is `calendar-sync` (~5 min) and `channel-metrics-sync` (**next scheduled sync, up to ~20 h** — SA's correction of Dev's proposed "within the hour", because `last_synced_at` is retained) | ✅ FR-26 |
| **3** | **AC-26** — replaced to match | ✅ AC-26 |
| **4** | **§6.3** — the false sentence removed and replaced with the enumeration-source table | ✅ §6.3 |
| **5** | **§11.2** — resolved; §8.7 closed statically | ✅ §8.7, §11.2 |
| **D11** | The existing customer-facing Delete-account path is **in scope**; user rejected a support-request replacement; Dev decides reuse vs deprecate | ✅ §1.3, §9, §11.3, §12 |
| **D12** | Internal-surface authorisation moves server-side to **`AdminAccessService`**; SA retracted its "unflagged internal surface" approval | ✅ §9, §10.4, §10.9, AC-40, §12 |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-14 | Created | Investigation + draft. No `business_id` — a business is a user account. 56 tables, 3 FK blockers, 6 triggers, 6 crons, 2 public insert paths, 3 orphan-risk tables, the portable plan-cache rows, no soft-delete convention. |
| 2026-09-14 | D1–D7 resolved | D1 overrode BA's test-only recommendation. Reset/Purge split, opt-in extras, two surfaces one engine, dry-run + typed confirmation, snapshot. 15 FRs, 26 ACs. |
| 2026-09-14 | D6 amended — pre-flight blocker | External state moved from post-hoc report to hard gate, enumerated from the provider. C3 recorded as a deliberate decision over BA's contrary reasoning. |
| 2026-09-14 | D6b — in-flight refunds fold into C2 | AC-8 added; ACs renumbered to 39. |
| 2026-09-14 | **SA first pass — rework required** | Six blockers. SA corrected T5, which BA had overstated. |
| 2026-09-14 | **BA rework — SA-B1…SA-B6 closed; D8/D9/D10 applied** | Read `supabase/SQL Scripts/` (65 files). §3 grew 56 → 60. Eleven tags corrected. New §1.2 (`delete_user_by_id.sql`). FR-1 rewritten; §10.9 rewritten; three-phase shape; B4; T5 corrected. FRs 21 → 32, ACs 39 → 49. |
| 2026-09-14 | **SA second pass — approved for Dev** | Four §11 items ruled; SA-2P1 required. |
| 2026-09-14 | **BA final — SA-2P1 applied** | §8 rewritten into nine enumerated subsections. `user_preferences` → `K*` (FRs 32 → 31). FR-24 accept-the-re-arm. Route (a) confirmed. 31 FRs, 49 ACs. |
| 2026-09-15 | **BA amendments from SA's workplan review — FR-26, FR-28, AC-26, AC-40; D11, D12; §8.7 closed** | **Two requirement claims were wrong and are corrected.** **FR-28:** the named `pg_try_advisory_lock` wrapper is **session-scoped**, and over `supabase-js`'s pooled PostgREST connection it yields both false passes and permanently leaked locks; replaced with **`pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` taken inside the RPC**, released at COMMIT/ROLLBACK with no unlock call to leak. AC-38 gains the transaction-scope assertion; §12's row now records that the unused wrapper is `SECURITY DEFINER` **granted to `authenticated`**, letting any logged-in user take or release an arbitrary lock id — new **FU-15**. **FR-26/AC-26/§6.3:** the claim that insights return within 15 minutes of a Reset was **false** — `insight-detect` enumerates tenants from `payment_invoices`/`scheduling_bookings`/`crm_contacts`/`business_events`, **all four deleted by Reset**, not from `business_profiles`. What actually returns is `calendar-sync` (~5 min) and `channel-metrics-sync` (**next scheduled sync, up to ~20 h**, because `channel_connections.last_synced_at` is retained — SA's correction of Dev's proposed "within the hour"). §6.3 now carries an enumeration-source column so the error cannot recur; `insight-detect`'s unpaginated `.limit(500)` noted as **FU-16**. **D11 (new):** the live customer-facing `SecurityTab.tsx:305` → `POST /api/user/delete-account` path — never previously mentioned in this requirement — is **in scope**; the user rejected replacing it with a support-request message, so self-service erasure stays and **Dev justifies reuse vs formal deprecation**. New **§1.3** records the verified facts: it deletes `auth.users` (violating D3/FR-30) and `user_preferences` (a `K*` table), touches 1 of 60 in-scope tables, audits intent but never outcome, and **500s at phase 6 for every onboarded user after phases 1–5 have irreversibly run** — worse than having no button, because it reliably half-deletes and then reports failure. **D12 (new):** SA **retracted** its approval of an "unflagged" internal surface — `/test-business-os` is on the middleware skip list with no admin gate, so an unflagged Purge would be reachable by every signed-in customer, making D9's flag gate a fiction. Authorisation moves **server-side to `AdminAccessService`/`admin_users`** on the preview and commit routes (never `profiles.role`, which is user-writable); §10.4 and AC-40 updated. **§8.7 closed statically** — `platform_learning_tables` creates `workflow_patterns` and `global_failure_patterns`, **neither with a `user_id`**, so neither can ever reach FR-1's user-scoped enumeration; the outstanding Dev obligation in §11.2 is discharged. **Counts unchanged at 31 FRs / 49 ACs** (FR-26, FR-28, AC-26, AC-40 replaced in place); decisions D1–D12; follow-ups FU-1…FU-16. |
