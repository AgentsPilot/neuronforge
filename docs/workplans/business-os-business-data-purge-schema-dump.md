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
8. [Part 2 — pending, needs the SQL editor](#8-part-2--pending-needs-the-sql-editor)
9. [Change History](#change-history)

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

## 8. Part 2 — pending, needs the SQL editor

**Blocked on a human with Supabase SQL-editor access.** Steps:

1. Open the Supabase dashboard → **SQL Editor**.
2. Paste and run `supabase/migrations/20260915a_purge_schema_introspect.sql`. It is read-only, `SECURITY DEFINER`, and granted to `service_role` only — it creates one function and no tables.
3. Run `SELECT purge_schema_introspect();` and paste the `foreign_keys`, `triggers` and `policies` arrays below.

**What Part 2 unblocks:**

| Consumer | Needs |
|---|---|
| **T3** (delete order) | `foreign_keys` with `on_delete` actions. **This is the critical-path blocker** — B1–B4 cannot be verified from migration files, because the duplicate CRM migrations disagree about CASCADE |
| **T3** (trigger ordering) | `triggers` — confirming T1/T2/T5 and that `crm_activities` must be last |
| **T4** | The base-table/view split, which shrinks §6's list of 38 |
| **T7 / C-2** | The FK-set fingerprint the reconciler compares against at run time |

> _Paste `foreign_keys` here._

> _Paste `triggers` here._

> _Paste `policies` here._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-15 | Part 1 complete; Part 2 pending | Relation inventory obtained via the PostgREST OpenAPI spec after `exec_sql` proved not to exist (D-4). **All four T2(a) unknowns and all five T2(b) names resolved**, and §8.7 confirmed live including SA's static closure of the two plural-named migrations. **Headline: 117 live user-scoped relations against 79 named in the requirement — 38 unclassified, which under AC-37 fails the engine's first run closed until §8 is amended.** Five incidental defects recorded, including `insight_outcomes` (in-scope table #53) not existing while `OutcomeRepository` queries it in four places. |
