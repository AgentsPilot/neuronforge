# Live Schema Dump — Business OS Data Purge (T1)

> **Last Updated**: 2026-09-15

> ⚠️ **C-1 — NO CODE READS THIS FILE.** It is human-pasted evidence for T3 (delete order) and T4 (descriptors). The engine's runtime oracle is `SchemaReconciler` calling `purge_schema_introspect()`. If you ever find yourself generating a constant from this document, stop: that reintroduces the build-time-manifest failure FR-1 route (a) was chosen to avoid.

## Overview

T1's evidence base: what actually exists in the live database, measured rather than read from migration files. Part 1 (relation and column inventory) is **complete** and was obtained without applying any DDL. Part 2 (foreign keys, triggers, policies) is **pending** — it needs `20260915a_purge_schema_introspect.sql` applied first, and applying it requires a human with SQL-editor access.

**Measured:** 2026-09-15, branch `feature/business-os-business-data-purge` @ `7acd323a`, against the `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` using the service-role key.

## Table of Contents

1. [How this was measured, and why not the planned way](#1-how-this-was-measured-and-why-not-the-planned-way)
2. [Part 1 — relation inventory (complete)](#2-part-1--relation-inventory-complete)
3. [T2(a) — the four unknowns, resolved](#3-t2a--the-four-unknowns-resolved)
4. [T2(b) — the five unverified names, resolved](#4-t2b--the-five-unverified-names-resolved)
5. [T2(c) — §8.7 kernel list, confirmed and corrected](#5-t2c--87-kernel-list-confirmed-and-corrected)
6. [🔴 The headline result — 38 unclassified user-scoped relations](#6--the-headline-result--38-unclassified-user-scoped-relations)
7. [Incidental defects found while measuring](#7-incidental-defects-found-while-measuring)
8. [Part 2 — COMPLETE](#8-part-2--complete)
9. [Part 2 — foreign keys, triggers and policies](#9-part-2--foreign-keys-triggers-and-policies-complete)
   - 9.1 [The delete order — nine constraints](#91-the-delete-order--and-why-it-is-only-nine-constraints)
   - 9.2 [Blocker status B1–B6](#92-blocker-status--including-the-one-that-does-not-exist)
   - 9.3 [Triggers, from live definitions](#93-triggers--derived-from-live-definitions-not-migration-files)
   - 9.4 [Inventory reconciled — 110, not 117](#94-inventory-reconciled--110-base-tables-not-117)
   - 9.5 [🔴 A gap in the oracle — `organizations`](#95--a-gap-in-the-oracle-itself--organizations)
   - 9.6 [Policies — two findings](#96-policies--two-findings)
   - 9.7–9.10 [Raw tables, FKs, triggers, policies](#97-raw--the-110-user-scoped-base-tables)
10. [Change History](#change-history)

---

## 1. How this was measured, and why not the planned way

The workplan assumed T1 would apply the introspection RPC and call it. **Neither half was available to me:**

| Attempt | Result |
|---|---|
| Apply DDL via `supabase.rpc('exec_sql', …)` | ❌ **`exec_sql` does not exist in the live database.** Five scripts under `scripts/` call it (`apply-memory-search-function.ts`, `apply-memory-system-fixes.ts`, `analyze-audit-trail-issue.ts`, …). They are **stale tooling that cannot have worked** against this database. Another instance of the pattern the `business-os-schema-check` skill exists for |
| `psql` / direct connection | ❌ No `pg` driver and no `DATABASE_URL` in the repo — as the requirement predicted |
| Supabase CLI `db push` | ❌ Requires `supabase login` + project link; not available non-interactively here |
| **PostgREST OpenAPI spec** | ✅ **Worked.** `GET {SUPABASE_URL}/rest/v1/` with the service-role key returns a full OpenAPI definition: every exposed relation and every column |

**So Part 1 was obtained read-only, with no DDL and no writes.** This is a strictly better position than waiting: it resolves every existence question T2 was going to ask, and it surfaced a result that changes the size of the feature (§6).

**What the OpenAPI route cannot give**, and why Part 2 still needs the migration:

- **No `pg_constraint`** → no FK actions, so **T3's delete order cannot be derived yet**. This is the hard blocker.
- **No `pg_trigger`, no `pg_policies`.**
- **It does not distinguish base tables from views.** PostgREST exposes both. The FR-1 RPC filters `table_type = 'BASE TABLE'`, so its enumeration will be **smaller** than the 117 below. Several names in §6 are clearly views by convention (`agent_executions_with_details`, `top_complex_agents`, `active_plugin_connections`, `agent_memory_stats`) but **I am not guessing which** — the RPC settles it.

---

## 2. Part 1 — relation inventory (complete)

| Measure | Value |
|---|---|
| Relations exposed via PostgREST (`public`) | **174** |
| Of those, carrying a `user_id` column | **117** |
| Named anywhere in the requirement | 79 |
| **Named nowhere in the requirement** | **38** |

Full name list: `scratchpad/user_scoped.txt`; raw spec: `scratchpad/purge-openapi.json`. Not committed — they are measurement output, and the reproduction is four lines of `fetch`.

---

## 3. T2(a) — the four unknowns, resolved

| Table | Requirement status | **Live** | Consequence |
|---|---|---|---|
| `business_intake_forms` | ❓ (#37) | ✅ **EXISTS, has `user_id`** | **Stays in the purge set as `K`.** §10.2 ¶2's contingent second half is **live, not void**: Reset keeps the `draft`/`published` rows, Purge loses archived versions. **AC-3's intake assertion stands and must be tested.** §11.1 is closed |
| `websites` | ❓ (#11) | ❌ **ABSENT** | **Drops out of the purge set.** Confirms "probably phantom". The two dead detectors (H2) that query it were querying nothing |
| `payment_methods` | ❓ (#29) | ✅ **EXISTS, has `user_id`** | **The drop migration `2026-08-14_drop_payment_methods.sql` was NOT applied.** Stays in the purge set as `D`. Migration files describe intent; the database is fact |
| `processed_webhook_events` | ❓ (§3.15) | ✅ **EXISTS, and HAS `user_id`** | 🔶 **Needs a ruling — the requirement only planned for the other answer.** §3.15 says "Does it carry `user_id`? If not it is **global** and moves to §8." It does carry one, so the default does not apply. See [§7 D-3](#7-incidental-defects-found-while-measuring) |

---

## 4. T2(b) — the five unverified names, resolved

§8.9 listed five names from the stale `delete_user_by_id.sql`, SA-verified as having no `CREATE TABLE` and no code reference, and expected to be phantom. **Four of five are phantom. One is not.**

| Table | Live | Consequence |
|---|---|---|
| `agent_versions` | ❌ ABSENT | Phantom, as expected. No descriptor needed |
| `usage_records` | ❌ ABSENT | Phantom. Note §8.5 excludes it "if present" — it is not |
| `user_api_keys` | ❌ ABSENT | Phantom. (A separate `api_keys` **does** exist with `user_id` — see §6) |
| `contact_submissions` | ❌ ABSENT | Phantom. **The intake-shaped fresh-ruling caveat in §8.9 is moot** — nothing to rule on |
| **`audit_logs`** | ✅ **EXISTS, has `user_id`** | 🔶 **Not phantom.** A live, user-scoped table that no migration creates and no `lib/`/`app/` code references. It must be classified or the engine fails closed. **It is not `audit_trail`** — that is a different table, and only `audit_trail` is covered by the §10.3 activity-history checkbox. Needs a ruling |

---

## 5. T2(c) — §8.7 kernel list, confirmed and corrected

**SA's static closure of §8.7 is confirmed live**, and the reasoning holds exactly:

| Table | Live | `user_id`? | Verdict |
|---|---|---|---|
| `workflow_patterns` | ✅ | ❌ **no** | ✅ **SA correct.** Outside FR-1's enumeration; **needs no descriptor** |
| `global_failure_patterns` | ✅ | ❌ **no** | ✅ **SA correct.** Same |
| `execution_baselines` | ✅ | ✅ yes | Correctly listed in §8.7 |
| `execution_anomalies` | ✅ | ✅ yes | Correctly listed |
| `calibration_history` | ✅ | ✅ yes | Correctly listed |
| `error_patterns` | ✅ | ✅ yes | Correctly listed |
| `plugin_performance` | ✅ | ✅ yes | Correctly listed |
| `intent_examples` | ✅ | ❌ **no** | 🔄 Listed in §8.7, but has no `user_id` — **never enumerated, so the descriptor is inert.** Harmless; drop it or keep it as documentation |
| `behavior_rules` | ❌ ABSENT | — | 🔄 Listed in §8.7; **does not exist.** An exclusion that matches nothing. Harmless, but the list should say so |
| `execution_model_tracking` | ❌ ABSENT | — | 🔄 Same |

**Requirement §11.2 is discharged.** T2(c) is complete: the two plural-named migrations created exactly the four tables SA identified, and the two without `user_id` are structurally outside the engine's reach.

---

## 6. 🔴 The headline result — 38 unclassified user-scoped relations

> **Superseded in part by §9.4.** This section's 117 counted views as well as tables. The base-table figure is **110**, seven of the 38 are views that drop out, and BA has since classified the remainder. The finding itself — that the inventory was materially incomplete and AC-37 would have failed the first run closed — stands unchanged.

**117 relations carry a `user_id`. The requirement enumerates 79 of them.** The remaining **38 appear nowhere** — not in §3's delete inventory, not in §8's exclusion set.

**Why this matters more than a counting error.** FR-1 condition (iii) and AC-37 require the engine to **fail closed when a user-scoped table is present in neither set**. With the descriptor set as currently specified, **the engine refuses to run on its first execution, every time, until all 38 are classified.** That is the design working exactly as intended — and it is why FR-1 was sequenced as task 1 rather than a build-time manifest. It caught the thing it was built to catch.

```
active_plugin_connections      agent_configurations           agent_execution_logs
agent_executions_with_details  agent_intensity_metrics        agent_memories
agent_memory_stats             agent_stats                    agent_templates
agentkit_analytics             api_keys                       billing_events
boost_pack_purchases           business_chat_verified_questions
calibration_sessions           credit_transactions            daily_briefing_sends
daily_briefings                daily_token_usage              data_decision_requests
execution_insight_runs         execution_insights             lead_responses
monthly_token_usage            notification_settings          pilot_step_routing_history
proposals                      run_memories                   security_settings
shadow_failure_snapshots       shared_agents                  subscription_invoices
token_usage                    top_complex_agents             user_media
user_rewards                   user_subscriptions             workflow_executions
```

**Shape of the work, not a proposal to be adopted without review.** Most are clearly kernel/agent-platform, billing or token-accounting and belong at `level: 'never'`. But several need a genuine product ruling rather than a default, because they are plausibly *the user's own business data*:

| Table | Why it is not obvious |
|---|---|
| `business_chat_verified_questions` | `business_chat_*` — every other table in that family is in the **delete** set |
| `proposals`, `lead_responses` | Sound like CRM-adjacent business content, not platform telemetry |
| `daily_briefings`, `daily_briefing_sends` | Owner-facing generated content; `_sends` is a send log, which has the `email_unsubscribes` flavour |
| `user_media` | User-uploaded content. Likely has storage objects behind it, like `contact_documents` |
| `notification_settings`, `security_settings`, `api_keys` | Account configuration — and **the route T31 retires deleted the first two**, so someone once considered them personal data |
| `billing_events`, `credit_transactions`, `subscription_invoices`, `user_subscriptions`, `boost_pack_purchases` | Billing. §8.5 excludes billing, but only named `subscriptions` / `usage_records` / `storage_usage`, none of which is this list |

**Recommendation:** this is a BA/SA classification pass over 38 rows, not a Dev judgement call. I will prepare the list with a proposed level and a one-line rationale each, but **§8 needs a real amendment and I should not be the only reader of it.** The base-table/view split (see §1) should come first, since a view needs no descriptor and may remove several rows from the list for free.

---

## 7. Incidental defects found while measuring

Recorded here rather than acted on — none is this feature's to fix, and two are `business-os-schema-check` Rule 5 "never worked" shapes, which that skill says must not be silently deleted.

| # | Defect | Evidence | Shape |
|---|---|---|---|
| **D-1** | **`insight_outcomes` does not exist**, but `lib/repositories/OutcomeRepository.ts` queries it at lines 92, 135, 151 and 174 | Absent from the live relation list | 🔴 **"Never worked."** The requirement lists it as in-scope table **#53** and calls it "a 7th insight table absent from two architecture docs". It is absent from the *database* too. Every `OutcomeRepository` call fails. **Drops out of the purge set**; the repository needs a product decision (rebuild or retire), not a deletion of the reference |
| **D-2** | **`audit_logs` is live and user-scoped** though SA verified no `CREATE TABLE` and no code reference | Present with `user_id` | 🟡 A real table nobody owns. Must be classified for AC-37; worth asking how it got there |
| **D-3** | **`processed_webhook_events` carries `user_id`** | Present with `user_id` | 🟡 §3.15's stated default ("if not, it is global") does not apply. Needs a ruling: webhook idempotency records are arguably platform state, but a user-scoped one deleted mid-flight could allow a webhook replay |
| **D-4** | **`exec_sql` does not exist**, but five `scripts/` files call it | RPC probe returned "Could not find the function" | 🟡 Stale tooling that cannot have worked. Not in this feature's path |
| **D-5** | **`payment_methods` drop migration unapplied** | Table live | 🟢 Already handled — it stays in the purge set |

---

## 8. Part 2 — COMPLETE

✅ **Unblocked and executed.** `20260915a_purge_schema_introspect.sql` was applied to the live database by the user, and I called `purge_schema_introspect()` with the service-role key. **T3 is no longer blocked.**

Everything below is derived from that call. The migration is confirmed `SECURITY DEFINER` and callable by `service_role`.

---

## 9. Part 2 — foreign keys, triggers and policies (COMPLETE)

**Source:** `SELECT purge_schema_introspect();` via PostgREST with the service-role key.
**`generated_at`:** `2026-09-15T13:12:15.649713+00:00`.
**Volumes:** 2540 column rows · **110 user-scoped base tables** · 239 foreign keys · 84 triggers · 360 policies.

> The raw JSON is reproducible in one call and is not pasted verbatim below — 360 policy rows with their `USING`/`WITH CHECK` expressions would bury the findings. Everything load-bearing is derived and tabulated here; the derivations are stated so they can be re-run.

### 9.1 The delete order — and why it is only nine constraints

**The full FK graph is cyclic and cannot be topologically sorted.** `scheduling_bookings.contact_id -> crm_contacts` is `SET NULL` while other edges run the other way, so an order built over all 239 FKs has cycles through `crm_contacts`, `scheduling_bookings`, `agents`, `payment_invoices`, `payment_plans`, `scheduling_services`, `workflow_executions`, `calibration_sessions` and `calibration_history`.

That is not a problem, because **only `RESTRICT` and `NO ACTION` edges constrain a delete.** `CASCADE` removes the child for you and `SET NULL` nulls it; neither can fail. Restricted to blocking edges, the graph **is acyclic**, and there are exactly **nine** of them among the 110 user-scoped base tables:

| # | Child (delete FIRST) | Parent | ON DELETE | Constraint |
|---|---|---|---|---|
| 1 | `agent_logs` | `agents` | **NO ACTION** | `agent_logs_agent_id_fkey` |
| 2 | `billing_events` | `credit_transactions` | **NO ACTION** | `billing_events_transaction_id_fkey` |
| 3 | `billing_events` | `user_subscriptions` | **NO ACTION** | `billing_events_subscription_id_fkey` |
| 4 | `boost_pack_purchases` | `credit_transactions` | **NO ACTION** | `boost_pack_purchases_transaction_id_fkey` |
| 5 | `credit_transactions` | `token_usage` | **NO ACTION** | `credit_transactions_token_usage_id_fkey` |
| 6 | `insight_automations` | `kernel_executions` | **NO ACTION** | `insight_automations_last_run_execution_id_fkey` |
| 7 | `payment_plan_subscriptions` | `scheduling_bookings` | **RESTRICT** | `payment_plan_subscriptions_booking_id_fkey` |
| 8 | `payment_refunds` | `payment_transactions` | **RESTRICT** | `payment_refunds_transaction_id_fkey` |
| 9 | `user_rewards` | `credit_transactions` | **NO ACTION** | `user_rewards_transaction_id_fkey` |

**Everything else is free.** The RPC's ordered deletes need to honour these nine, plus the `crm_activities`-last rule (§9.3). This is a materially simpler contract than "derive a total order over 239 FKs", and it is more robust: a new `CASCADE` FK cannot invalidate it.

### 9.2 Blocker status — including the one that does not exist

| ID | Claim | Live result |
|---|---|---|
| **B1** | `payment_refunds` before `payment_transactions` | ✅ **Confirmed** — `payment_refunds_transaction_id_fkey`, **RESTRICT** |
| **B2** | `payment_plan_subscriptions` before `scheduling_bookings` | ✅ **Confirmed** — `payment_plan_subscriptions_booking_id_fkey`, **RESTRICT** |
| **B3** | `insight_automations` before `kernel_executions` | ✅ **Confirmed** — `insight_automations_last_run_execution_id_fkey`, **NO ACTION** |
| **B4** | `payment_plan_subscriptions` before `crm_contacts` | ✅ **Confirmed, and the mechanism is the trigger, not the FK.** The only FK between them is `scheduling_bookings_contact_id_fkey` (**SET NULL**), which does not block. The constraint comes from `delete_future_bookings_on_contact_delete_trigger` — `BEFORE DELETE ON crm_contacts` — which deletes future bookings and so trips **B2** from a direction B2 alone does not name |
| **B5** | `data_decision_requests` before `agents`? | ❌ **Does NOT materialize.** `fk_data_decision_requests_agent` is **CASCADE**; `fk_data_decision_requests_execution` -> `workflow_executions` is **CASCADE**; `fk_data_decision_requests_user` is **CASCADE**. The `optional:agents` classification (N11) still stands on its own merits — orphaned rows pointing at deleted agents — but it adds **no ordering constraint**. *Recorded as a negative result at SA's request, rather than left open.* |
| **B6** | 🆕 `agent_logs` before `agents` | 🔴 **NEW BLOCKER.** `agent_logs_agent_id_fkey` is **NO ACTION**. Both tables are in the **"delete my agents"** opt-in, so ticking that checkbox fails unless `agent_logs` goes first. **Off by default — a default T28 sweep never reaches it**, exactly like N11's trap |

The remaining five blocking edges (`billing_events`, `boost_pack_purchases`, `user_rewards`, `credit_transactions`, `token_usage`, `user_subscriptions`) sit **entirely between tables the owner ruled `never`**, so they never constrain a purge. Recorded so a future reclassification of any billing table knows it inherits an ordering problem.

### 9.3 Triggers — derived from live definitions, not migration files

**Only four DELETE-capable triggers exist in `public`:**

| Table | Trigger | Timing | Effect on a delete-only purge |
|---|---|---|---|
| `crm_contacts` | `delete_future_bookings_on_contact_delete_trigger` | **BEFORE DELETE** | ✅ **T1 confirmed.** Deletes future bookings -> trips B2 -> source of **B4** |
| `payment_refunds` | `recompute_transaction_refund_state_trigger` | AFTER INSERT **OR DELETE** OR UPDATE | ✅ **T2 confirmed.** Deleting refunds UPDATEs `payment_transactions.status` |
| `storage_usage` | `trigger_update_storage_on_delete`, `trigger_update_storage_used` | AFTER DELETE | Inert — `storage_usage` is `never` (§8.5). Noted because reclassifying it would start recomputing quota |

**T5 — SA's narrowing is confirmed against the live definitions.** The five `log_*_activity` triggers fire as follows:

| Trigger | Fires on | Reached by a delete-only purge? |
|---|---|---|
| `log_payment_activity_trigger` | AFTER INSERT OR **UPDATE OF status** on `payment_transactions` | ✅ **YES — the single live path.** T2's delete-driven UPDATE of `status` fires it, writing `crm_activities` |
| `log_booking_activity_trigger` | AFTER INSERT OR **UPDATE OF status** on `scheduling_bookings` | ❌ No. `propagate_refund_to_booking` writes `payment_status`, a column this trigger does not watch |
| `log_task_activity_trigger` | AFTER **UPDATE OF status** on `crm_tasks` | ❌ No. The contact FK is SET NULL, which updates `contact_id`, not `status` |
| `log_email_activity_trigger` | AFTER INSERT OR UPDATE OF status on `email_sends` | ❌ No |
| `log_document_activity_trigger` | AFTER **INSERT** on `contact_documents` | ❌ No |

**Exactly one path, so `crm_activities` deleted last inside the RPC remains correct and sufficient** (FR-17, AC-22). Suppression is still neither needed nor available.

**Duplicate CRM triggers confirmed live.** Both `update_crm_contacts_timestamp` and `update_crm_contacts_updated_at_trigger` exist on `crm_contacts`, calling the same function — the duplicate-migration hazard §5.2 predicted. Both are `BEFORE UPDATE`, so a delete-only purge never fires them.

### 9.4 Inventory reconciled — 110 base tables, not 117

My Part 1 number came from the PostgREST OpenAPI spec, which **does not distinguish views from tables**. The RPC filters `table_type = 'BASE TABLE'`. The difference is exactly seven relations, all views, all droppable at zero cost:

| View | In BA's §8.13 suspected-view list? |
|---|---|
| `active_plugin_connections` | ✅ yes |
| `agent_executions_with_details` | ✅ yes |
| `agent_memory_stats` | ✅ yes |
| `daily_token_usage` | ✅ yes |
| `monthly_token_usage` | ✅ yes |
| `top_complex_agents` | ✅ yes |
| `website_analytics_summary` | n/a — already known to be a view (§3.3) |

**BA listed eight suspected views; six are confirmed here.** The other two are **base tables and still need descriptors**:

- **`agent_stats`** — BASE TABLE, carries `user_id`
- **`agent_intensity_metrics`** — BASE TABLE, carries `user_id`

Nothing moved the other way: **zero base tables were missing from the OpenAPI list**, so Part 1's set was a strict superset and no classification work is invalidated. `user_scoped_tables` from the RPC is now the authority for §3/§8 reconciliation.

### 9.5 🔴 A gap in the oracle itself — `organizations`

`organizations` is a base table, is tenant-owned, and is **absent from the enumeration**, because it keys on **`owner_user_id`** rather than `user_id`. FR-1's predicate is a literal column-name match, so it cannot see it.

**This is a weakness in AC-37's fail-closed guarantee, not merely an inventory miss.** AC-37 promises the engine refuses to run when a user-scoped table is in neither the delete set nor the exclusion set. A table whose ownership column is named anything other than `user_id` is invisible to that check, so the guarantee silently does not cover it. `organizations` happens to be correctly excluded already (§8.4) — but it was excluded by a human writing prose, which is precisely the mechanism FR-1 exists to replace.

**How big is the gap? Measured, not assumed.** Across all 155 base tables, scanning for `owner_user_id`, `owner_id`, `created_by`, `created_by_user_id`, `account_id`, `profile_id`, `uid`, `author_id`, `member_user_id`, `requested_by`:

> **Exactly one** non-enumerated base table carries an owner-ish column: `organizations` (`owner_user_id`).

Separately, nine non-enumerated base tables hold an FK to `auth.users`. **Eight are attribution, not ownership** — `ais_scoring_weights.updated_by`, `ais_system_config.updated_by`, `exchange_rate_history.changed_by`, `exchange_rates.updated_by`, `sla_events.acknowledged_by`, `system_settings_config.updated_by`, `shared_agent_imports.imported_by_user_id`, plus `profiles.id` (identity, excluded by D3). The ninth is `organizations`.

**Recommendation — widen the predicate to the union, and accept nine extra `never` descriptors.**

```sql
-- FR-1 `user_scoped_tables` predicate, proposed
--   (a) a tenancy column by name, OR
--   (b) any FK referencing auth.users
column_name IN ('user_id', 'owner_user_id')
   OR EXISTS (SELECT 1 FROM pg_constraint con
              WHERE con.conrelid = <table> AND con.contype = 'f'
                AND con.confrelid = 'auth.users'::regclass)
```

**Why the union rather than either half:**

- A **name allow-list alone** (`user_id`, `owner_user_id`) closes today's gap but not tomorrow's: a future table calling it `tenant_id` is invisible again, and nothing would signal that. It optimises for the gap we happen to have found.

- **FK-to-`auth.users` alone** would drop `organizations` if its FK were ever removed, and would miss a tenancy column that holds a user id without declaring a constraint — which is common in this codebase, since many `user_id` columns have no FK at all.

- The **union** fails in the safe direction. Its cost is that AC-37 starts demanding a classification for eight attribution-only tables. That is a one-time cost of eight `never` descriptors with a one-line reason each, and it converts "we think nothing else is tenant-scoped" from an assertion into a check.

**The alternative — leave the predicate and give `organizations` an explicit descriptor with a documented reason — is cheaper today and weaker permanently**, because it fixes the instance and not the class. I recommend the union. **SA to rule; this changes FR-1's text.**

### 9.6 Policies — two findings

**(a) 27 of the 110 user-scoped base tables have no `DELETE` (or `ALL`) policy at all.** The requirement estimated "~20"; the live number is **27**. This is the live confirmation of §5.3 — the purge cannot run as `authenticated` and the service role is structurally required, which is what B-4's documented RLS-bypass comment must say:

```
agent_configurations, agent_execution_logs, agent_executions, agent_logs
agent_stats, agentkit_analytics, audit_logs, business_chat_action_log
business_chat_conversation, business_chat_plan_cache, business_chat_saved_plans, business_chat_verified_questions
business_profiles, calibration_history, daily_briefing_sends, daily_briefings
lead_responses, onboarding_conversations, onboarding_prompt_ideas, payment_plan_subscriptions
payment_refunds, processed_webhook_events, shadow_failure_snapshots, shared_agents
subscription_invoices, website_content, website_page_views
```

**(b) 🔴 9 `INSERT` policies are `WITH CHECK (true)` and granted to `public` or `anon` — the requirement named two.**

| Table | Policy | In the purge set? |
|---|---|---|
| `agent_memories` | `Service role can access all agent memories` | ✅ yes — `optional:agents` |
| `execution_insights` | `Service role can insert insights` | ⚠️ unclassified until §8 reconciliation |
| `newsletter_subscribers` | `Anyone can subscribe to newsletter` | no — outside the purge set |
| `pilot_step_routing_history` | `Service role can access all routing history` | ⚠️ unclassified until §8 reconciliation |
| `pilot_step_routing_history` | `System can insert routing history` | ⚠️ unclassified until §8 reconciliation |
| `smart_link_clicks` | `Service can insert clicks` | ✅ yes — known re-population path |
| `website_page_views` | `Service role can insert page views` | ✅ yes — known re-population path (FR-14/AC-27) |
| `workflow_approval_requests` | `approval_requests_insert_policy` | no — outside the purge set |
| `workflow_step_executions` | `Enable insert for anon role` | no — outside the purge set |

**Several of these are named "Service role can …" but are granted to `public`.** `agent_memories`, `execution_insights` and `pilot_step_routing_history` all carry a policy whose *name* asserts service-role scope while its *role list* is `public`, with `WITH CHECK (true)`. `workflow_step_executions` is granted to `anon` outright.

**Stated with its limit:** a policy permitting an insert is necessary but not sufficient — PostgREST also requires a table-level `GRANT`, which this dump does not capture. So this is **a strong signal, not a proven vulnerability**, and it needs a grants check before anyone acts on it. **It is outside this feature's scope either way** — flagged because a policy whose name contradicts its role list is exactly the kind of thing that survives review, and because two of the tables are in the purge set. **For SA to route.**

### 9.7 Raw — the 110 user-scoped base tables

The authority for reconciling §3 and §8. Any name here in neither set fails the engine closed (AC-37).

```
admin_users, advisor_reports, agent_configurations, agent_execution_logs
agent_executions, agent_intensity_metrics, agent_logs, agent_memories
agent_memory, agent_prompt_threads, agent_prompt_workflow_generation_sessions, agent_stats
agent_templates, agentkit_analytics, agents, api_keys
audit_logs, audit_trail, automation_slas, billing_events
boost_pack_purchases, business_chat_action_log, business_chat_conversation, business_chat_plan_cache
business_chat_saved_plans, business_chat_verified_questions, business_events, business_health_summaries
business_intake_forms, business_profiles, calibration_history, calibration_sessions
channel_connections, channel_metrics_daily, command_sessions, contact_documents
credit_transactions, crm_activities, crm_contacts, crm_pipeline_stages
crm_tasks, daily_briefing_sends, daily_briefings, data_decision_requests
derived_metrics, email_campaigns, email_sends, email_sequence_enrollments
email_sequence_steps, email_sequences, email_unsubscribes, error_patterns
execution_anomalies, execution_baselines, execution_insight_runs, execution_insights
external_calendar_events, group_metrics_rollup, insight_automations, insights
kernel_action_log, kernel_executions, lead_responses, metric_baselines
notification_settings, onboarding_conversations, onboarding_prompt_ideas, organization_members
owner_insight_history, payment_automation_executions, payment_automation_rules, payment_events
payment_invoices, payment_methods, payment_plan_installments, payment_plan_subscriptions
payment_plans, payment_processors, payment_refunds, payment_reminders
payment_transactions, pilot_step_routing_history, plugin_connections, plugin_performance
processed_webhook_events, proposals, run_memories, saved_payment_methods
scheduling_availability_exceptions, scheduling_bookings, scheduling_services, security_settings
shadow_failure_snapshots, shared_agents, smart_links, storage_usage
stripe_connect_accounts, subscription_invoices, token_usage, user_capabilities
user_intake_settings, user_media, user_memory, user_preferences
user_rewards, user_subscriptions, website_content, website_page_views
website_pages, workflow_executions
```

### 9.8 Raw — all 239 foreign keys

`ON DELETE` codes as returned by `pg_constraint.confdeltype`, expanded.

| Child table | References | ON DELETE | Constraint |
|---|---|---|---|
| `admin_users` | `users` | SET NULL | `admin_users_granted_by_fkey` |
| `admin_users` | `users` | CASCADE | `admin_users_user_id_fkey` |
| `advisor_reports` | `organizations` | CASCADE | `advisor_reports_org_id_fkey` |
| `advisor_reports` | `users` | CASCADE | `advisor_reports_user_id_fkey` |
| `agent_configurations` | `agents` | CASCADE | `agent_configurations_agent_id_fkey` |
| `agent_configurations` | `users` | CASCADE | `agent_configurations_user_id_fkey` |
| `agent_execution_logs` | `users` | CASCADE | `agent_execution_logs_user_id_fkey` |
| `agent_executions` | `agents` | CASCADE | `agent_executions_agent_id_fkey` |
| `agent_executions` | `users` | CASCADE | `agent_executions_user_id_fkey` |
| `agent_group_memberships` | `agents` | CASCADE | `agent_group_memberships_agent_id_fkey` |
| `agent_group_memberships` | `workflow_groups` | CASCADE | `agent_group_memberships_group_id_fkey` |
| `agent_intensity_metrics` | `agents` | CASCADE | `agent_intensity_metrics_agent_id_fkey` |
| `agent_intensity_metrics` | `users` | CASCADE | `agent_intensity_metrics_user_id_fkey` |
| `agent_logs` | `agents` | NO ACTION | `agent_logs_agent_id_fkey` |
| `agent_logs` | `users` | NO ACTION | `agent_logs_user_id_fkey` |
| `agent_memory` | `agents` | CASCADE | `agent_memory_agent_id_fkey` |
| `agent_memory` | `users` | CASCADE | `agent_memory_user_id_fkey` |
| `agent_prompt_threads` | `users` | CASCADE | `agent_prompt_threads_user_id_fkey` |
| `agent_prompt_workflow_generation_sessions` | `agents` | SET NULL | `agent_prompt_workflow_generation_sessions_agent_id_fkey` |
| `agent_prompt_workflow_generation_sessions` | `users` | CASCADE | `agent_prompt_workflow_generation_sessions_user_id_fkey` |
| `agent_scheduler_state` | `agents` | CASCADE | `agent_scheduler_state_agent_id_fkey` |
| `agent_scheduler_state` | `agent_executions` | NO ACTION | `agent_scheduler_state_last_execution_id_fkey` |
| `agent_stats` | `agents` | CASCADE | `agent_stats_agent_id_fkey` |
| `agent_stats` | `users` | CASCADE | `fk_user` |
| `agentkit_analytics` | `agents` | CASCADE | `agentkit_analytics_agent_id_fkey` |
| `agentkit_analytics` | `users` | CASCADE | `agentkit_analytics_user_id_fkey` |
| `agents` | `organizations` | SET NULL | `agents_org_id_fkey` |
| `agents` | `calibration_history` | SET NULL | `fk_agents_last_calibration` |
| `ais_scoring_weights` | `users` | SET NULL | `ais_scoring_weights_updated_by_fkey` |
| `ais_system_config` | `users` | SET NULL | `ais_system_config_updated_by_fkey` |
| `api_keys` | `users` | CASCADE | `api_keys_user_id_fkey` |
| `audit_logs` | `users` | CASCADE | `audit_logs_user_id_fkey` |
| `automation_slas` | `agents` | CASCADE | `automation_slas_agent_id_fkey` |
| `automation_slas` | `workflow_groups` | SET NULL | `automation_slas_group_id_fkey` |
| `automation_slas` | `organizations` | CASCADE | `automation_slas_org_id_fkey` |
| `automation_slas` | `users` | CASCADE | `automation_slas_user_id_fkey` |
| `billing_events` | `user_subscriptions` | NO ACTION | `billing_events_subscription_id_fkey` |
| `billing_events` | `credit_transactions` | NO ACTION | `billing_events_transaction_id_fkey` |
| `billing_events` | `users` | SET NULL | `billing_events_user_id_fkey` |
| `boost_pack_purchases` | `boost_packs` | CASCADE | `boost_pack_purchases_boost_pack_id_fkey` |
| `boost_pack_purchases` | `credit_transactions` | NO ACTION | `boost_pack_purchases_transaction_id_fkey` |
| `boost_pack_purchases` | `users` | CASCADE | `boost_pack_purchases_user_id_fkey` |
| `business_chat_action_log` | `users` | CASCADE | `business_chat_action_log_user_id_fkey` |
| `business_chat_conversation` | `users` | CASCADE | `business_chat_conversation_user_id_fkey` |
| `business_chat_plan_cache` | `users` | CASCADE | `business_chat_plan_cache_user_id_fkey` |
| `business_chat_saved_plans` | `users` | CASCADE | `business_chat_saved_plans_user_id_fkey` |
| `business_chat_verified_questions` | `users` | CASCADE | `business_chat_verified_questions_user_id_fkey` |
| `business_events` | `crm_contacts` | SET NULL | `business_events_contact_id_fkey` |
| `business_events` | `users` | CASCADE | `business_events_user_id_fkey` |
| `business_health_summaries` | `users` | CASCADE | `business_health_summaries_user_id_fkey` |
| `business_intake_forms` | `users` | CASCADE | `business_intake_forms_user_id_fkey` |
| `business_profiles` | `users` | NO ACTION | `business_profiles_user_id_fkey` |
| `calibration_history` | `agents` | CASCADE | `calibration_history_agent_id_fkey` |
| `calibration_history` | `calibration_sessions` | SET NULL | `calibration_history_session_id_fkey` |
| `calibration_history` | `users` | CASCADE | `calibration_history_user_id_fkey` |
| `calibration_sessions` | `agents` | CASCADE | `calibration_sessions_agent_id_fkey` |
| `calibration_sessions` | `workflow_executions` | SET NULL | `calibration_sessions_execution_id_fkey` |
| `calibration_sessions` | `profiles` | CASCADE | `calibration_sessions_user_id_fkey` |
| `capability_building_blocks` | `capabilities` | CASCADE | `capability_building_blocks_capability_id_fkey` |
| `channel_connections` | `users` | CASCADE | `channel_connections_user_id_fkey` |
| `channel_metrics_daily` | `users` | CASCADE | `channel_metrics_daily_user_id_fkey` |
| `command_sessions` | `users` | CASCADE | `command_sessions_user_id_fkey` |
| `contact_documents` | `crm_contacts` | CASCADE | `contact_documents_contact_id_fkey` |
| `contact_documents` | `users` | CASCADE | `contact_documents_user_id_fkey` |
| `credit_transactions` | `boost_packs` | NO ACTION | `credit_transactions_boost_pack_id_fkey` |
| `credit_transactions` | `reward_config` | NO ACTION | `credit_transactions_reward_config_id_fkey` |
| `credit_transactions` | `token_usage` | NO ACTION | `credit_transactions_token_usage_id_fkey` |
| `credit_transactions` | `users` | NO ACTION | `credit_transactions_user_id_fkey` |
| `crm_activities` | `crm_contacts` | CASCADE | `crm_activities_contact_id_fkey` |
| `crm_activities` | `users` | NO ACTION | `crm_activities_user_id_fkey` |
| `crm_contacts` | `users` | NO ACTION | `crm_contacts_user_id_fkey` |
| `crm_pipeline_stages` | `users` | NO ACTION | `crm_pipeline_stages_user_id_fkey` |
| `crm_tasks` | `crm_contacts` | SET NULL | `crm_tasks_contact_id_fkey` |
| `crm_tasks` | `users` | CASCADE | `crm_tasks_user_id_fkey` |
| `daily_briefing_sends` | `users` | CASCADE | `daily_briefing_sends_user_id_fkey` |
| `daily_briefings` | `users` | CASCADE | `daily_briefings_user_id_fkey` |
| `data_decision_requests` | `agents` | CASCADE | `fk_data_decision_requests_agent` |
| `data_decision_requests` | `workflow_executions` | CASCADE | `fk_data_decision_requests_execution` |
| `data_decision_requests` | `users` | CASCADE | `fk_data_decision_requests_user` |
| `derived_metrics` | `users` | CASCADE | `derived_metrics_user_id_fkey` |
| `email_campaigns` | `users` | CASCADE | `email_campaigns_user_id_fkey` |
| `email_sends` | `email_campaigns` | SET NULL | `email_sends_campaign_id_fkey` |
| `email_sends` | `crm_contacts` | CASCADE | `email_sends_contact_id_fkey` |
| `email_sends` | `email_sequences` | SET NULL | `email_sends_sequence_id_fkey` |
| `email_sends` | `email_sequence_steps` | SET NULL | `email_sends_sequence_step_id_fkey` |
| `email_sends` | `users` | CASCADE | `email_sends_user_id_fkey` |
| `email_sequence_enrollments` | `crm_contacts` | CASCADE | `email_sequence_enrollments_contact_id_fkey` |
| `email_sequence_enrollments` | `email_sequences` | CASCADE | `email_sequence_enrollments_sequence_id_fkey` |
| `email_sequence_enrollments` | `users` | CASCADE | `email_sequence_enrollments_user_id_fkey` |
| `email_sequence_steps` | `email_sequences` | CASCADE | `email_sequence_steps_sequence_id_fkey` |
| `email_sequence_steps` | `users` | CASCADE | `email_sequence_steps_user_id_fkey` |
| `email_sequences` | `users` | CASCADE | `email_sequences_user_id_fkey` |
| `email_unsubscribes` | `crm_contacts` | SET NULL | `email_unsubscribes_contact_id_fkey` |
| `email_unsubscribes` | `users` | CASCADE | `email_unsubscribes_user_id_fkey` |
| `error_patterns` | `agents` | CASCADE | `error_patterns_agent_id_fkey` |
| `error_patterns` | `users` | CASCADE | `error_patterns_user_id_fkey` |
| `exchange_rate_history` | `users` | NO ACTION | `exchange_rate_history_changed_by_fkey` |
| `exchange_rates` | `users` | NO ACTION | `exchange_rates_updated_by_fkey` |
| `execution_anomalies` | `agents` | CASCADE | `execution_anomalies_agent_id_fkey` |
| `execution_anomalies` | `agent_executions` | CASCADE | `execution_anomalies_execution_id_fkey` |
| `execution_baselines` | `agents` | CASCADE | `execution_baselines_agent_id_fkey` |
| `execution_insight_runs` | `agents` | CASCADE | `execution_insight_runs_agent_id_fkey` |
| `execution_insight_runs` | `workflow_executions` | SET NULL | `execution_insight_runs_execution_id_fkey` |
| `execution_insight_runs` | `execution_insights` | CASCADE | `execution_insight_runs_insight_id_fkey` |
| `execution_insight_runs` | `users` | CASCADE | `execution_insight_runs_user_id_fkey` |
| `execution_insights` | `agents` | CASCADE | `execution_insights_agent_id_fkey` |
| `execution_insights` | `organizations` | SET NULL | `execution_insights_org_id_fkey` |
| `execution_insights` | `users` | CASCADE | `execution_insights_user_id_fkey` |
| `execution_metrics` | `agents` | CASCADE | `execution_metrics_agent_id_fkey` |
| `execution_metrics` | `workflow_executions` | CASCADE | `execution_metrics_execution_id_fkey` |
| `execution_routing_decisions` | `agent_executions` | CASCADE | `execution_routing_decisions_execution_id_fkey` |
| `external_calendar_events` | `users` | CASCADE | `external_calendar_events_user_id_fkey` |
| `group_metrics_rollup` | `workflow_groups` | CASCADE | `group_metrics_rollup_group_id_fkey` |
| `group_metrics_rollup` | `organizations` | CASCADE | `group_metrics_rollup_org_id_fkey` |
| `group_metrics_rollup` | `users` | CASCADE | `group_metrics_rollup_user_id_fkey` |
| `insight_automations` | `insights` | SET NULL | `insight_automations_created_from_insight_id_fkey` |
| `insight_automations` | `kernel_executions` | NO ACTION | `insight_automations_last_run_execution_id_fkey` |
| `insight_automations` | `users` | CASCADE | `insight_automations_user_id_fkey` |
| `insights` | `insights` | SET NULL | `insights_correlation_parent_id_fkey` |
| `insights` | `users` | CASCADE | `insights_user_id_fkey` |
| `kernel_action_log` | `kernel_executions` | SET NULL | `kernel_action_log_execution_id_fkey` |
| `kernel_action_log` | `insights` | SET NULL | `kernel_action_log_insight_id_fkey` |
| `kernel_action_log` | `users` | CASCADE | `kernel_action_log_user_id_fkey` |
| `kernel_executions` | `insights` | SET NULL | `kernel_executions_insight_id_fkey` |
| `kernel_executions` | `users` | CASCADE | `kernel_executions_user_id_fkey` |
| `lead_responses` | `crm_contacts` | CASCADE | `lead_responses_contact_id_fkey` |
| `lead_responses` | `users` | CASCADE | `lead_responses_user_id_fkey` |
| `message_replies` | `contact_messages` | CASCADE | `fk_message_replies_message_id` |
| `metric_baselines` | `organizations` | CASCADE | `metric_baselines_org_id_fkey` |
| `metric_baselines` | `users` | CASCADE | `metric_baselines_user_id_fkey` |
| `notification_settings` | `users` | CASCADE | `notification_settings_user_id_fkey` |
| `onboarding_conversations` | `users` | NO ACTION | `onboarding_conversations_user_id_fkey` |
| `onboarding_prompt_ideas` | `agents` | SET NULL | `onboarding_prompt_ideas_agent_created_id_fkey` |
| `onboarding_prompt_ideas` | `users` | CASCADE | `onboarding_prompt_ideas_user_id_fkey` |
| `organization_members` | `organizations` | CASCADE | `organization_members_org_id_fkey` |
| `organization_members` | `users` | CASCADE | `organization_members_user_id_fkey` |
| `organizations` | `users` | CASCADE | `organizations_owner_user_id_fkey` |
| `owner_insight_history` | `insights` | CASCADE | `owner_insight_history_insight_id_fkey` |
| `owner_insight_history` | `users` | CASCADE | `owner_insight_history_user_id_fkey` |
| `payment_automation_executions` | `payment_automation_rules` | CASCADE | `payment_automation_executions_rule_id_fkey` |
| `payment_automation_executions` | `payment_events` | SET NULL | `payment_automation_executions_trigger_event_id_fkey` |
| `payment_automation_executions` | `users` | NO ACTION | `payment_automation_executions_user_id_fkey` |
| `payment_automation_rules` | `users` | NO ACTION | `payment_automation_rules_user_id_fkey` |
| `payment_events` | `crm_contacts` | SET NULL | `payment_events_contact_id_fkey` |
| `payment_events` | `users` | NO ACTION | `payment_events_user_id_fkey` |
| `payment_invoices` | `scheduling_bookings` | SET NULL | `payment_invoices_booking_id_fkey` |
| `payment_invoices` | `crm_contacts` | SET NULL | `payment_invoices_contact_id_fkey` |
| `payment_invoices` | `scheduling_services` | SET NULL | `payment_invoices_service_id_fkey` |
| `payment_invoices` | `users` | CASCADE | `payment_invoices_user_id_fkey` |
| `payment_methods` | `users` | CASCADE | `payment_methods_user_id_fkey` |
| `payment_plan_installments` | `scheduling_bookings` | SET NULL | `payment_plan_installments_booking_id_fkey` |
| `payment_plan_installments` | `crm_contacts` | SET NULL | `payment_plan_installments_contact_id_fkey` |
| `payment_plan_installments` | `payment_invoices` | SET NULL | `payment_plan_installments_invoice_id_fkey` |
| `payment_plan_installments` | `payment_plans` | CASCADE | `payment_plan_installments_payment_plan_id_fkey` |
| `payment_plan_installments` | `proposals` | SET NULL | `payment_plan_installments_proposal_id_fkey` |
| `payment_plan_installments` | `payment_plan_subscriptions` | CASCADE | `payment_plan_installments_subscription_id_fkey` |
| `payment_plan_installments` | `payment_transactions` | SET NULL | `payment_plan_installments_transaction_id_fkey` |
| `payment_plan_installments` | `users` | NO ACTION | `payment_plan_installments_user_id_fkey` |
| `payment_plan_subscriptions` | `scheduling_bookings` | RESTRICT | `payment_plan_subscriptions_booking_id_fkey` |
| `payment_plan_subscriptions` | `crm_contacts` | SET NULL | `payment_plan_subscriptions_contact_id_fkey` |
| `payment_plan_subscriptions` | `payment_plans` | SET NULL | `payment_plan_subscriptions_payment_plan_id_fkey` |
| `payment_plan_subscriptions` | `scheduling_services` | SET NULL | `payment_plan_subscriptions_service_id_fkey` |
| `payment_plan_subscriptions` | `users` | CASCADE | `payment_plan_subscriptions_user_id_fkey` |
| `payment_plans` | `scheduling_services` | SET NULL | `payment_plans_service_id_fkey` |
| `payment_plans` | `users` | NO ACTION | `payment_plans_user_id_fkey` |
| `payment_processors` | `users` | NO ACTION | `payment_processors_user_id_fkey` |
| `payment_refunds` | `payment_invoices` | SET NULL | `payment_refunds_invoice_id_fkey` |
| `payment_refunds` | `payment_transactions` | RESTRICT | `payment_refunds_transaction_id_fkey` |
| `payment_refunds` | `users` | CASCADE | `payment_refunds_user_id_fkey` |
| `payment_reminders` | `crm_contacts` | SET NULL | `payment_reminders_contact_id_fkey` |
| `payment_reminders` | `payment_plan_installments` | CASCADE | `payment_reminders_installment_id_fkey` |
| `payment_reminders` | `payment_invoices` | CASCADE | `payment_reminders_invoice_id_fkey` |
| `payment_reminders` | `users` | NO ACTION | `payment_reminders_user_id_fkey` |
| `payment_transactions` | `scheduling_bookings` | SET NULL | `payment_transactions_booking_id_fkey` |
| `payment_transactions` | `crm_contacts` | SET NULL | `payment_transactions_contact_id_fkey` |
| `payment_transactions` | `payment_invoices` | SET NULL | `payment_transactions_invoice_id_fkey` |
| `payment_transactions` | `scheduling_services` | SET NULL | `payment_transactions_service_id_fkey` |
| `payment_transactions` | `users` | CASCADE | `payment_transactions_user_id_fkey` |
| `plugin_connections` | `users` | CASCADE | `plugin_connections_user_id_fkey` |
| `plugin_performance` | `agents` | CASCADE | `plugin_performance_agent_id_fkey` |
| `processed_webhook_events` | `users` | SET NULL | `processed_webhook_events_user_id_fkey` |
| `profiles` | `users` | NO ACTION | `profiles_id_fkey` |
| `profiles` | `organizations` | NO ACTION | `profiles_org_id_fkey` |
| `proposals` | `scheduling_bookings` | SET NULL | `proposals_booking_id_fkey` |
| `proposals` | `crm_contacts` | CASCADE | `proposals_contact_id_fkey` |
| `proposals` | `payment_invoices` | SET NULL | `proposals_created_invoice_id_fkey` |
| `proposals` | `payment_plans` | SET NULL | `proposals_created_plan_id_fkey` |
| `proposals` | `contact_documents` | SET NULL | `proposals_document_id_fkey` |
| `proposals` | `scheduling_services` | SET NULL | `proposals_service_id_fkey` |
| `proposals` | `proposals` | SET NULL | `proposals_supersedes_id_fkey` |
| `proposals` | `users` | CASCADE | `proposals_user_id_fkey` |
| `reward_settings` | `reward_config` | CASCADE | `reward_settings_reward_config_id_fkey` |
| `run_memories` | `agents` | CASCADE | `run_memories_agent_id_fkey` |
| `run_memories` | `users` | CASCADE | `run_memories_user_id_fkey` |
| `saved_payment_methods` | `crm_contacts` | CASCADE | `saved_payment_methods_contact_id_fkey` |
| `saved_payment_methods` | `users` | NO ACTION | `saved_payment_methods_user_id_fkey` |
| `scheduling_availability_exceptions` | `users` | CASCADE | `scheduling_availability_exceptions_user_id_fkey` |
| `scheduling_bookings` | `crm_contacts` | SET NULL | `scheduling_bookings_contact_id_fkey` |
| `scheduling_bookings` | `payment_invoices` | SET NULL | `scheduling_bookings_invoice_id_fkey` |
| `scheduling_bookings` | `payment_plans` | SET NULL | `scheduling_bookings_payment_plan_id_fkey` |
| `scheduling_bookings` | `scheduling_services` | CASCADE | `scheduling_bookings_service_id_fkey` |
| `scheduling_bookings` | `users` | CASCADE | `scheduling_bookings_user_id_fkey` |
| `scheduling_services` | `users` | CASCADE | `scheduling_services_user_id_fkey` |
| `security_settings` | `users` | CASCADE | `security_settings_user_id_fkey` |
| `shadow_failure_snapshots` | `agents` | CASCADE | `shadow_failure_snapshots_agent_id_fkey` |
| `shared_agent_imports` | `agents` | SET NULL | `shared_agent_imports_created_agent_id_fkey` |
| `shared_agent_imports` | `users` | SET NULL | `shared_agent_imports_imported_by_user_id_fkey` |
| `shared_agent_imports` | `shared_agents` | CASCADE | `shared_agent_imports_shared_agent_id_fkey` |
| `shared_agents` | `agents` | CASCADE | `fk_shared_agents_original_agent` |
| `shared_agents` | `users` | CASCADE | `fk_shared_agents_user` |
| `sla_events` | `users` | NO ACTION | `sla_events_acknowledged_by_fkey` |
| `sla_events` | `automation_slas` | CASCADE | `sla_events_sla_id_fkey` |
| `smart_link_clicks` | `smart_links` | CASCADE | `smart_link_clicks_smart_link_id_fkey` |
| `smart_links` | `users` | CASCADE | `smart_links_user_id_fkey` |
| `stripe_connect_accounts` | `users` | CASCADE | `stripe_connect_accounts_user_id_fkey` |
| `subscription_invoices` | `users` | CASCADE | `subscription_invoices_user_id_fkey` |
| `system_settings_config` | `users` | NO ACTION | `system_settings_config_updated_by_fkey` |
| `token_usage` | `users` | CASCADE | `token_usage_user_id_fkey` |
| `user_capabilities` | `capabilities` | CASCADE | `user_capabilities_capability_id_fkey` |
| `user_capabilities` | `users` | CASCADE | `user_capabilities_user_id_fkey` |
| `user_capability_blocks` | `capability_building_blocks` | CASCADE | `user_capability_blocks_building_block_id_fkey` |
| `user_capability_blocks` | `user_capabilities` | CASCADE | `user_capability_blocks_user_capability_id_fkey` |
| `user_intake_settings` | `users` | CASCADE | `user_intake_settings_user_id_fkey` |
| `user_media` | `users` | CASCADE | `user_media_user_id_fkey` |
| `user_memory` | `agents` | SET NULL | `user_memory_source_agent_id_fkey` |
| `user_memory` | `users` | CASCADE | `user_memory_user_id_fkey` |
| `user_preferences` | `users` | CASCADE | `user_preferences_user_id_fkey` |
| `user_rewards` | `reward_config` | CASCADE | `user_rewards_reward_config_id_fkey` |
| `user_rewards` | `credit_transactions` | NO ACTION | `user_rewards_transaction_id_fkey` |
| `user_rewards` | `users` | CASCADE | `user_rewards_user_id_fkey` |
| `user_subscriptions` | `users` | NO ACTION | `user_credits_user_id_fkey` |
| `website_blocks` | `website_pages` | CASCADE | `website_blocks_page_id_fkey` |
| `website_content` | `users` | NO ACTION | `website_content_user_id_fkey` |
| `website_page_views` | `website_pages` | CASCADE | `website_page_views_page_id_fkey` |
| `website_page_views` | `users` | CASCADE | `website_page_views_user_id_fkey` |
| `website_pages` | `users` | NO ACTION | `website_pages_user_id_fkey` |
| `workflow_approval_responses` | `workflow_approval_requests` | NO ACTION | `workflow_approval_responses_approval_id_fkey` |
| `workflow_groups` | `organizations` | CASCADE | `workflow_groups_org_id_fkey` |
| `workflow_groups` | `workflow_groups` | SET NULL | `workflow_groups_parent_group_id_fkey` |

### 9.9 Raw — all 84 triggers

| Table | Trigger | Definition |
|---|---|---|
| `admin_users` | `trg_admin_users_updated_at` | `CREATE TRIGGER trg_admin_users_updated_at BEFORE UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION set_admin_users_updated_at()` |
| `agent_configurations` | `update_agent_configurations_updated_at` | `CREATE TRIGGER update_agent_configurations_updated_at BEFORE UPDATE ON public.agent_configurations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `agent_executions` | `update_agent_executions_updated_at` | `CREATE TRIGGER update_agent_executions_updated_at BEFORE UPDATE ON public.agent_executions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `agent_intensity_metrics` | `trigger_sync_agent_intensity` | `CREATE TRIGGER trigger_sync_agent_intensity AFTER INSERT OR UPDATE OF intensity_score ON public.agent_intensity_metrics FOR EACH ROW EXECUTE FUNCTION sync_agent_intensity_score()` |
| `agent_memories` | `agent_memories_updated_at` | `CREATE TRIGGER agent_memories_updated_at BEFORE UPDATE ON public.agent_memories FOR EACH ROW EXECUTE FUNCTION update_agent_memories_updated_at()` |
| `agent_memory` | `update_agent_memory_updated_at` | `CREATE TRIGGER update_agent_memory_updated_at BEFORE UPDATE ON public.agent_memory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `agent_prompt_threads` | `trigger_agent_prompt_threads_updated_at` | `CREATE TRIGGER trigger_agent_prompt_threads_updated_at BEFORE UPDATE ON public.agent_prompt_threads FOR EACH ROW EXECUTE FUNCTION update_agent_prompt_threads_updated_at()` |
| `agent_prompt_workflow_generation_sessions` | `trigger_apwgs_updated_at` | `CREATE TRIGGER trigger_apwgs_updated_at BEFORE UPDATE ON public.agent_prompt_workflow_generation_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `agent_scheduler_state` | `update_agent_scheduler_state_updated_at` | `CREATE TRIGGER update_agent_scheduler_state_updated_at BEFORE UPDATE ON public.agent_scheduler_state FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `agent_templates` | `update_agent_templates_updated_at` | `CREATE TRIGGER update_agent_templates_updated_at BEFORE UPDATE ON public.agent_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `agents` | `trigger_auto_set_agent_org_id` | `CREATE TRIGGER trigger_auto_set_agent_org_id BEFORE INSERT ON public.agents FOR EACH ROW EXECUTE FUNCTION auto_set_agent_org_id()` |
| `ais_scoring_weights` | `trigger_ais_scoring_weights_updated` | `CREATE TRIGGER trigger_ais_scoring_weights_updated BEFORE UPDATE ON public.ais_scoring_weights FOR EACH ROW EXECUTE FUNCTION update_ais_config_timestamp()` |
| `ais_system_config` | `trigger_ais_system_config_updated` | `CREATE TRIGGER trigger_ais_system_config_updated BEFORE UPDATE ON public.ais_system_config FOR EACH ROW EXECUTE FUNCTION update_ais_config_timestamp()` |
| `audit_trail` | `trigger_sync_audit_user_email` | `CREATE TRIGGER trigger_sync_audit_user_email BEFORE INSERT ON public.audit_trail FOR EACH ROW EXECUTE FUNCTION sync_audit_user_email()` |
| `business_health_summaries` | `business_health_summaries_updated_at` | `CREATE TRIGGER business_health_summaries_updated_at BEFORE UPDATE ON public.business_health_summaries FOR EACH ROW EXECUTE FUNCTION update_business_health_updated_at()` |
| `business_intake_forms` | `trg_touch_business_intake_forms` | `CREATE TRIGGER trg_touch_business_intake_forms BEFORE UPDATE ON public.business_intake_forms FOR EACH ROW EXECUTE FUNCTION touch_business_intake_forms()` |
| `business_profiles` | `ensure_user_code_on_insert` | `CREATE TRIGGER ensure_user_code_on_insert BEFORE INSERT ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION ensure_unique_user_code()` |
| `business_profiles` | `update_business_profiles_timestamp` | `CREATE TRIGGER update_business_profiles_timestamp BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION update_business_profiles_updated_at()` |
| `calibration_sessions` | `update_calibration_sessions_updated_at_trigger` | `CREATE TRIGGER update_calibration_sessions_updated_at_trigger BEFORE UPDATE ON public.calibration_sessions FOR EACH ROW EXECUTE FUNCTION update_calibration_sessions_updated_at()` |
| `channel_connections` | `trg_channel_connections_updated_at` | `CREATE TRIGGER trg_channel_connections_updated_at BEFORE UPDATE ON public.channel_connections FOR EACH ROW EXECUTE FUNCTION touch_channel_connections_updated_at()` |
| `command_sessions` | `trigger_command_sessions_updated_at` | `CREATE TRIGGER trigger_command_sessions_updated_at BEFORE UPDATE ON public.command_sessions FOR EACH ROW EXECUTE FUNCTION update_command_session_updated_at()` |
| `contact_documents` | `log_document_activity_trigger` | `CREATE TRIGGER log_document_activity_trigger AFTER INSERT ON public.contact_documents FOR EACH ROW EXECUTE FUNCTION log_document_activity()` |
| `contact_documents` | `update_contact_documents_updated_at` | `CREATE TRIGGER update_contact_documents_updated_at BEFORE UPDATE ON public.contact_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `contact_messages` | `update_contact_messages_updated_at` | `CREATE TRIGGER update_contact_messages_updated_at BEFORE UPDATE ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `crm_contacts` | `delete_future_bookings_on_contact_delete_trigger` | `CREATE TRIGGER delete_future_bookings_on_contact_delete_trigger BEFORE DELETE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION delete_future_bookings_on_contact_delete()` |
| `crm_contacts` | `update_crm_contacts_timestamp` | `CREATE TRIGGER update_crm_contacts_timestamp BEFORE UPDATE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION update_crm_contacts_updated_at()` |
| `crm_contacts` | `update_crm_contacts_updated_at_trigger` | `CREATE TRIGGER update_crm_contacts_updated_at_trigger BEFORE UPDATE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION update_crm_contacts_updated_at()` |
| `crm_tasks` | `log_task_activity_trigger` | `CREATE TRIGGER log_task_activity_trigger AFTER UPDATE OF status ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION log_task_activity()` |
| `crm_tasks` | `set_task_completed_at_trigger` | `CREATE TRIGGER set_task_completed_at_trigger BEFORE UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION set_task_completed_at()` |
| `crm_tasks` | `update_crm_tasks_updated_at_trigger` | `CREATE TRIGGER update_crm_tasks_updated_at_trigger BEFORE UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION update_crm_tasks_updated_at()` |
| `email_campaigns` | `update_email_campaigns_updated_at_trigger` | `CREATE TRIGGER update_email_campaigns_updated_at_trigger BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION update_email_campaigns_updated_at()` |
| `email_sends` | `log_email_activity_trigger` | `CREATE TRIGGER log_email_activity_trigger AFTER INSERT OR UPDATE OF status ON public.email_sends FOR EACH ROW EXECUTE FUNCTION log_email_activity()` |
| `email_sequences` | `update_email_sequences_updated_at_trigger` | `CREATE TRIGGER update_email_sequences_updated_at_trigger BEFORE UPDATE ON public.email_sequences FOR EACH ROW EXECUTE FUNCTION update_email_sequences_updated_at()` |
| `error_patterns` | `trigger_error_patterns_updated_at` | `CREATE TRIGGER trigger_error_patterns_updated_at BEFORE UPDATE ON public.error_patterns FOR EACH ROW EXECUTE FUNCTION update_error_patterns_updated_at()` |
| `exchange_rates` | `exchange_rate_change_trigger` | `CREATE TRIGGER exchange_rate_change_trigger AFTER UPDATE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION log_exchange_rate_change()` |
| `execution_insights` | `execution_insights_updated_at_trigger` | `CREATE TRIGGER execution_insights_updated_at_trigger BEFORE UPDATE ON public.execution_insights FOR EACH ROW EXECUTE FUNCTION update_execution_insights_updated_at()` |
| `external_calendar_events` | `trigger_external_calendar_events_updated_at` | `CREATE TRIGGER trigger_external_calendar_events_updated_at BEFORE UPDATE ON public.external_calendar_events FOR EACH ROW EXECUTE FUNCTION update_external_calendar_events_updated_at()` |
| `group_metrics_rollup` | `group_metrics_rollup_updated_at` | `CREATE TRIGGER group_metrics_rollup_updated_at BEFORE UPDATE ON public.group_metrics_rollup FOR EACH ROW EXECUTE FUNCTION update_group_metrics_rollup_updated_at()` |
| `helpbot_page_contexts` | `update_helpbot_page_contexts_timestamp` | `CREATE TRIGGER update_helpbot_page_contexts_timestamp BEFORE UPDATE ON public.helpbot_page_contexts FOR EACH ROW EXECUTE FUNCTION update_helpbot_page_contexts_updated_at()` |
| `insight_automations` | `insight_automations_updated_at` | `CREATE TRIGGER insight_automations_updated_at BEFORE UPDATE ON public.insight_automations FOR EACH ROW EXECUTE FUNCTION update_insight_automations_updated_at()` |
| `insights` | `insights_updated_at` | `CREATE TRIGGER insights_updated_at BEFORE UPDATE ON public.insights FOR EACH ROW EXECUTE FUNCTION update_insights_updated_at()` |
| `memory_config` | `update_memory_config_updated_at` | `CREATE TRIGGER update_memory_config_updated_at BEFORE UPDATE ON public.memory_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `metric_baselines` | `metric_baselines_updated_at` | `CREATE TRIGGER metric_baselines_updated_at BEFORE UPDATE ON public.metric_baselines FOR EACH ROW EXECUTE FUNCTION update_metric_baselines_updated_at()` |
| `newsletter_subscribers` | `newsletter_subscribers_updated_at` | `CREATE TRIGGER newsletter_subscribers_updated_at BEFORE UPDATE ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION update_newsletter_subscribers_updated_at()` |
| `notification_settings` | `update_notification_settings_updated_at` | `CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON public.notification_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at()` |
| `onboarding_prompt_ideas` | `onboarding_prompt_ideas_updated_at` | `CREATE TRIGGER onboarding_prompt_ideas_updated_at BEFORE UPDATE ON public.onboarding_prompt_ideas FOR EACH ROW EXECUTE FUNCTION update_onboarding_prompt_ideas_updated_at()` |
| `organizations` | `auto_set_profile_org_id` | `CREATE TRIGGER auto_set_profile_org_id AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION set_profile_org_id()` |
| `payment_invoices` | `move_plan_stage_with_invoice_trigger` | `CREATE TRIGGER move_plan_stage_with_invoice_trigger AFTER UPDATE OF status ON public.payment_invoices FOR EACH ROW EXECUTE FUNCTION move_plan_stage_with_invoice()` |
| `payment_invoices` | `update_payment_invoices_updated_at_trigger` | `CREATE TRIGGER update_payment_invoices_updated_at_trigger BEFORE UPDATE ON public.payment_invoices FOR EACH ROW EXECUTE FUNCTION update_payment_invoices_updated_at()` |
| `payment_refunds` | `recompute_transaction_refund_state_trigger` | `CREATE TRIGGER recompute_transaction_refund_state_trigger AFTER INSERT OR DELETE OR UPDATE ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION recompute_transaction_refund_state()` |
| `payment_refunds` | `refund_guard_before_trigger` | `CREATE TRIGGER refund_guard_before_trigger BEFORE INSERT OR UPDATE OF amount, status, currency ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION refund_guard_before()` |
| `payment_transactions` | `log_payment_activity_trigger` | `CREATE TRIGGER log_payment_activity_trigger AFTER INSERT OR UPDATE OF status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION log_payment_activity()` |
| `payment_transactions` | `promote_contact_on_payment_trigger` | `CREATE TRIGGER promote_contact_on_payment_trigger AFTER INSERT OR UPDATE OF status ON public.payment_transactions FOR EACH ROW WHEN (((new.status = 'succeeded'::text) AND (new.amount > (0)::numeric) AND (new.contact_id IS NOT NULL))) EXECUTE FUNCTION promote_contact_on_payment()` |
| `payment_transactions` | `propagate_refund_to_booking_trigger` | `CREATE TRIGGER propagate_refund_to_booking_trigger AFTER INSERT OR UPDATE OF refunded_amount, refund_status, status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION propagate_refund_to_booking()` |
| `payment_transactions` | `propagate_refund_to_invoice_trigger` | `CREATE TRIGGER propagate_refund_to_invoice_trigger AFTER INSERT OR UPDATE OF refunded_amount, refund_status, status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION propagate_refund_to_invoice()` |
| `payment_transactions` | `update_invoice_on_payment_trigger` | `CREATE TRIGGER update_invoice_on_payment_trigger AFTER INSERT OR UPDATE OF status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION update_invoice_on_payment()` |
| `payment_transactions` | `update_payment_transactions_updated_at_trigger` | `CREATE TRIGGER update_payment_transactions_updated_at_trigger BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION update_payment_transactions_updated_at()` |
| `plugin_connections` | `update_plugin_connections_updated_at` | `CREATE TRIGGER update_plugin_connections_updated_at BEFORE UPDATE ON public.plugin_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at()` |
| `pricing_config` | `pricing_config_updated_at` | `CREATE TRIGGER pricing_config_updated_at BEFORE UPDATE ON public.pricing_config FOR EACH ROW EXECUTE FUNCTION update_pricing_config_timestamp()` |
| `profiles` | `update_profiles_updated_at` | `CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at()` |
| `scheduling_bookings` | `advance_contact_on_completed_booking_trigger` | `CREATE TRIGGER advance_contact_on_completed_booking_trigger AFTER UPDATE OF status ON public.scheduling_bookings FOR EACH ROW WHEN (((new.status = 'completed'::text) AND (old.status IS DISTINCT FROM 'completed'::text))) EXECUTE FUNCTION advance_contact_on_completed_booking()` |
| `scheduling_bookings` | `create_crm_contact_from_booking_trigger` | `CREATE TRIGGER create_crm_contact_from_booking_trigger BEFORE INSERT ON public.scheduling_bookings FOR EACH ROW EXECUTE FUNCTION create_crm_contact_from_booking()` |
| `scheduling_bookings` | `log_booking_activity_trigger` | `CREATE TRIGGER log_booking_activity_trigger AFTER INSERT OR UPDATE OF status ON public.scheduling_bookings FOR EACH ROW EXECUTE FUNCTION log_booking_activity()` |
| `scheduling_bookings` | `update_scheduling_bookings_updated_at_trigger` | `CREATE TRIGGER update_scheduling_bookings_updated_at_trigger BEFORE UPDATE ON public.scheduling_bookings FOR EACH ROW EXECUTE FUNCTION update_scheduling_bookings_updated_at()` |
| `scheduling_services` | `update_scheduling_services_updated_at_trigger` | `CREATE TRIGGER update_scheduling_services_updated_at_trigger BEFORE UPDATE ON public.scheduling_services FOR EACH ROW EXECUTE FUNCTION update_scheduling_services_updated_at()` |
| `security_settings` | `update_security_settings_updated_at` | `CREATE TRIGGER update_security_settings_updated_at BEFORE UPDATE ON public.security_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at()` |
| `shared_agent_imports` | `trigger_increment_shared_agent_import_count` | `CREATE TRIGGER trigger_increment_shared_agent_import_count AFTER INSERT ON public.shared_agent_imports FOR EACH ROW EXECUTE FUNCTION increment_shared_agent_import_count()` |
| `smart_link_clicks` | `increment_click_count_on_insert` | `CREATE TRIGGER increment_click_count_on_insert AFTER INSERT ON public.smart_link_clicks FOR EACH ROW EXECUTE FUNCTION increment_smart_link_click_count()` |
| `smart_links` | `update_smart_links_timestamp` | `CREATE TRIGGER update_smart_links_timestamp BEFORE UPDATE ON public.smart_links FOR EACH ROW EXECUTE FUNCTION update_website_pages_updated_at()` |
| `storage_usage` | `trigger_update_storage_on_delete` | `CREATE TRIGGER trigger_update_storage_on_delete AFTER DELETE ON public.storage_usage FOR EACH ROW EXECUTE FUNCTION update_user_storage_on_delete()` |
| `storage_usage` | `trigger_update_storage_on_insert` | `CREATE TRIGGER trigger_update_storage_on_insert AFTER INSERT ON public.storage_usage FOR EACH ROW EXECUTE FUNCTION update_user_storage_usage()` |
| `storage_usage` | `trigger_update_storage_used` | `CREATE TRIGGER trigger_update_storage_used AFTER INSERT OR DELETE OR UPDATE ON public.storage_usage FOR EACH ROW EXECUTE FUNCTION update_user_storage_used()` |
| `stripe_connect_accounts` | `update_stripe_connect_accounts_updated_at_trigger` | `CREATE TRIGGER update_stripe_connect_accounts_updated_at_trigger BEFORE UPDATE ON public.stripe_connect_accounts FOR EACH ROW EXECUTE FUNCTION update_stripe_connect_accounts_updated_at()` |
| `system_settings_config` | `system_settings_config_updated_at` | `CREATE TRIGGER system_settings_config_updated_at BEFORE UPDATE ON public.system_settings_config FOR EACH ROW EXECUTE FUNCTION update_system_settings_config_updated_at()` |
| `token_usage` | `update_token_usage_updated_at` | `CREATE TRIGGER update_token_usage_updated_at BEFORE UPDATE ON public.token_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()` |
| `user_capabilities` | `update_user_capabilities_updated_at_trigger` | `CREATE TRIGGER update_user_capabilities_updated_at_trigger BEFORE UPDATE ON public.user_capabilities FOR EACH ROW EXECUTE FUNCTION update_user_capabilities_updated_at()` |
| `user_intake_settings` | `update_user_intake_settings_timestamp` | `CREATE TRIGGER update_user_intake_settings_timestamp BEFORE UPDATE ON public.user_intake_settings FOR EACH ROW EXECUTE FUNCTION update_user_intake_settings_updated_at()` |
| `user_memory` | `user_memory_updated_at` | `CREATE TRIGGER user_memory_updated_at BEFORE UPDATE ON public.user_memory FOR EACH ROW EXECUTE FUNCTION update_user_memory_updated_at()` |
| `user_preferences` | `update_user_preferences_updated_at` | `CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at()` |
| `user_subscriptions` | `trigger_update_user_subscriptions_updated_at` | `CREATE TRIGGER trigger_update_user_subscriptions_updated_at BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION update_user_subscriptions_updated_at()` |
| `website_content` | `update_website_content_timestamp` | `CREATE TRIGGER update_website_content_timestamp BEFORE UPDATE ON public.website_content FOR EACH ROW EXECUTE FUNCTION update_website_content_updated_at()` |
| `website_pages` | `update_website_pages_timestamp` | `CREATE TRIGGER update_website_pages_timestamp BEFORE UPDATE ON public.website_pages FOR EACH ROW EXECUTE FUNCTION update_website_pages_updated_at()` |
| `workflow_approval_requests` | `trigger_approval_expiration` | `CREATE TRIGGER trigger_approval_expiration BEFORE UPDATE ON public.workflow_approval_requests FOR EACH ROW EXECUTE FUNCTION check_approval_expiration()` |
| `workflow_executions` | `trigger_update_workflow_execution_updated_at` | `CREATE TRIGGER trigger_update_workflow_execution_updated_at BEFORE UPDATE ON public.workflow_executions FOR EACH ROW EXECUTE FUNCTION update_workflow_execution_updated_at()` |

### 9.10 Policies

360 rows. Not tabulated verbatim — the `USING`/`WITH CHECK` expressions would add several hundred lines and bury §9.6's two findings, which are the load-bearing derivations. Reproduce with `SELECT purge_schema_introspect();` and read `.policies`.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-15 | **Part 2 complete — FKs, triggers and policies** | Introspection RPC applied by the user and called with the service-role key (`generated_at 2026-09-15T13:12:15Z`): 2,540 column rows, **110 user-scoped base tables**, 239 FKs, 84 triggers, 360 policies. **Delete order derived: the full FK graph is cyclic, but only the nine `RESTRICT`/`NO ACTION` edges constrain a delete, and that subgraph is acyclic.** B1/B2/B3 confirmed; **B4 confirmed as a trigger constraint, not an FK one**; **B5 does NOT exist** (`fk_data_decision_requests_agent` is CASCADE) — recorded as a negative result; **B6 is new** — `agent_logs` before `agents`, NO ACTION, inside the off-by-default agents opt-in. **T5's single-path narrowing confirmed against live trigger definitions**, and the duplicate `crm_contacts` triggers confirmed present. **Inventory reconciled 117 -> 110**: seven views drop out, but `agent_stats` and `agent_intensity_metrics` are base tables and still need descriptors. **Two new findings:** `organizations` is invisible to FR-1's predicate because it keys on `owner_user_id`, which is a gap in AC-37's guarantee rather than a missing row — measured as exactly one such table, with a proposed union predicate; and **15 `WITH CHECK (true)` INSERT policies exist where the requirement named two**, several granted to `public` under a name asserting service-role scope. |
| 2026-09-15 | Part 1 complete; Part 2 pending | Relation inventory obtained via the PostgREST OpenAPI spec after `exec_sql` proved not to exist (D-4). All four T2(a) unknowns and all five T2(b) names resolved; §8.7 confirmed live. Headline: 117 live user-scoped relations against 79 named in the requirement. Five incidental defects recorded. |
