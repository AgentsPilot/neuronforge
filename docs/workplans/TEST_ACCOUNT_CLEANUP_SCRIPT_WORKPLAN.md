# Workplan: Test-Account Cleanup (operator SQL scripts)

> **Last Updated**: 2026-10-06

**Developer:** Dev
**Requirement:** none (operator tool, user-approved option A on 2026-10-06; re-scoped to pasted SQL by user decision the same day)
**Branch:** `feature/test-account-cleanup-script` (worktree `neuronforge-test-cleanup`, from origin/main `4f6fb6ca`)
**Date:** 2026-10-06
**Status:** Code Complete (uncommitted, awaiting the user's read of the SQL, then SA code review and QA)

## Overview

Two SQL files the user pastes into the Supabase SQL editor to remove ONE test account completely, so the same email can be invited and sign up again: its Business OS data, its profile, and its login (`auth.users`). A **check** file that only reads, and a **delete** file that runs as one all-or-nothing block. This is NOT a product feature and NOT the admin delete (that one keeps the login by decision UD-1). It does not call the held `purge_business_data` function and does not need the key rotation.

The delete file is **generated** from `lib/business-os/purge/descriptors.ts` (plus a short reviewed list for the tables a business purge never touches), and a Jest test fails if the committed SQL drifts from what the generator would write.

## Table of Contents

1. [Measured facts (prod, read-only, 2026-10-06)](#1-measured-facts-prod-read-only-2026-10-06)
2. [Design](#2-design)
3. [Files](#3-files)
4. [Task list](#4-task-list)
5. [Test plan](#5-test-plan)
6. [Risks](#6-risks)
7. [Business questions (for the user)](#7-business-questions-for-the-user)
8. [Technical questions (for SA)](#8-technical-questions-for-sa)
9. [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info)

---

## 1. Measured facts (prod, read-only, 2026-10-06)

Taken with `purge_schema_introspect()` (service role, read-only) and head-only `count` selects. Nothing was written.

| Fact | Value | Consequence |
|---|---|---|
| FKs to `auth.users` | 124 = 88 CASCADE, 13 SET NULL, **23 NO ACTION** | The 23 are what make a plain auth delete fail with 23503 |
| NO ACTION, business data | `business_profiles`, `crm_contacts`, `crm_activities`, `crm_pipeline_stages`, `onboarding_conversations`, `payment_automation_executions`, `payment_automation_rules`, `payment_events`, `payment_plan_installments`, `payment_plans`, `payment_processors`, `payment_reminders`, `saved_payment_methods`, `website_content`, `website_pages`, `agent_logs` | All are in the purge descriptors (reset/purge/optional) and are removed before the login |
| NO ACTION, identity | `profiles` (`profiles_id_fkey`) | Removed after business data, before the login |
| NO ACTION, legacy billing (`never` in descriptors) | `credit_transactions`, `user_subscriptions` (constraint `user_credits_user_id_fkey`) | Must be removed for the login delete to succeed: see BQ-2. Blocking children inside the cluster: `billing_events`, `boost_pack_purchases`, `user_rewards` -> `credit_transactions`; `credit_transactions` -> `token_usage`; `billing_events` -> `user_subscriptions` |
| NO ACTION, platform actor columns | `exchange_rates.updated_by`, `exchange_rate_history.changed_by`, `system_settings_config.updated_by`, `sla_events.acknowledged_by` | Platform data, never touched: a row naming the target is a **blocker** |
| SET NULL | `business_os_credit_charges`, `_credit_lots`, `_credit_lot_draws`, `_billing_accounts`, `_boost_purchases`, `_boost_cap_overrides`, `billing_events`, `processed_webhook_events`, `marketing_consent_events.recorded_by`, `admin_users.granted_by`, `shared_agent_imports`, `ais_scoring_weights`, `ais_system_config` | Do not block the delete; if left, they survive as rows with no owner (BQ-2) |
| Invite tables | `business_os_invites`, `business_os_account_lineage`: **no FK to auth.users**, no unique index on invite email | They never block; the same email can be re-invited today |
| Triggers on `profiles` | none fire on DELETE | Safe to delete |
| `audit_trail` columns | `id, user_id, actor_id, action, entity_type, entity_id, resource_name, changes, details, ip_address, user_agent, session_id, severity, compliance_flags, hash, created_at, user_email`; trigger `trigger_sync_audit_user_email`; no FK to auth.users | An operator row can be written (see §2.6, TQ-5) |
| `livemode` column | present on `business_os_billing_accounts`, `business_os_boost_purchases` | Lets the guard refuse anything touching real money |

The column for each NO ACTION / SET NULL FK is not in the introspection payload (it returns constraint, table, target, on_delete only). The generator takes the column from a reviewed map; the check file verifies each mapped column exists via `information_schema.columns` and reports BLOCKED if one does not (fail closed).

---

## 2. Design

### 2.1 Where operator SQL lives

The repo's existing place for pasted operator SQL is `scripts/*.sql` (`scripts/check-bos-credit-lots-migration.sql` and siblings). Both files go there. Nothing under `supabase/migrations/`.

### 2.2 The one edit point

The SQL editor has no psql variables. Both files begin with a single statement the user edits once:

```sql
SELECT set_config('cleanup.target_email', 'name+test1@example.com', true) AS edit_target_email;
SELECT set_config('cleanup.test_tag', '+test', true) AS edit_test_tag;
```

Every later statement reads `current_setting('cleanup.target_email')`, so the email is typed once per file, lower-cased and trimmed in SQL. The delete file has a second line, `cleanup.confirm_email`, that must equal the first (the typed confirmation). No email is ever committed to the repo (the repo is public).

### 2.3 The test-account guard (strict: running as `postgres` bypasses RLS, so this is the only safety)

The delete refuses unless ALL hold. The check reports each one.

| # | Guard | Source |
|---|---|---|
| G-1 | Exactly one `auth.users` row matches the email | `auth.users` |
| G-2 | The account carries the **test marker** (recommended: `raw_app_meta_data ->> 'test_account' = 'true'`, see BQ-1) | `auth.users` |
| G-3 | `cleanup.confirm_email` equals `cleanup.target_email` (delete file only) | settings |
| G-4 | Not in `admin_users` (any row for the user id) | admin delete R-2 |
| G-5 | No `business_os_billing_accounts` / `business_os_boost_purchases` row with `livemode = true` | real money |
| G-6 | No live plan subscription in either mode (status in the R-3 list, or a Stripe subscription id with no `ended_at`) | `R3_LIVE_STATUSES` in `adminDeletionRefusals.ts` |
| G-7 | No Stripe Connect account (`stripe_connect_accounts` row, or a `stripe` row in `plugin_connections`) | admin delete R-5 |
| G-8 | No money in flight: every `LOCAL_BLOCKING_CONDITIONS` entry (table + statuses) counts 0 | `localPrecondition.ts` |
| G-9 | No platform actor row names the user (`exchange_rates`, `exchange_rate_history`, `system_settings_config`, `sla_events`) | NO ACTION, platform data |
| G-10 | No OTHER account has this one as `parent_account_id` / `root_account_id` in `business_os_account_lineage` | would leave a child pointing at nobody |
| G-11 | Every column the delete names exists (`information_schema.columns`) | fail closed on schema drift |

G-6 to G-8 read local rows only. SQL cannot ask Stripe, so a subscription the webhook never mirrored is invisible here; this is acceptable for test accounts and is stated in the check output.

### 2.4 Check file (read-only)

Plain `SELECT`s only (a `DO` block cannot return rows to the editor). Three result sets, in this order so the editor's last result is the verdict:

1. **Rows that would be removed**: one row per table (table, area, count), generated from the same list as the delete.
2. **Blockers**: one row per guard (id, status `ok`/`BLOCKED`, count, what clears it).
3. **Verdict**: a single row, `OK` or `BLOCKED (n)`, plus the user id. The user pastes the delete only after `OK`.

Also reported, not blocking: storage objects under `{user_id}/` in `contact-documents` and `website-images` (TQ-3), and invite rows naming the account (BQ-3).

### 2.5 Delete file (one atomic block)

A single `DO $$ ... $$` block (atomic by itself; any `RAISE EXCEPTION` rolls everything back), then one verification `SELECT`.

1. Resolve the user id; re-run G-1 to G-11. Any failure: `RAISE EXCEPTION` naming the guard. Nothing is removed.
2. Delete in **generated order** (§2.7). `user_id`-scoped tables use `WHERE user_id = v_uid`; `via`-scoped (`website_blocks`, `smart_link_clicks`, `user_capability_blocks`, `agent_scheduler_state`) use `WHERE <fk> IN (SELECT id FROM <parent> WHERE user_id = v_uid)`. Each delete records `GET DIAGNOSTICS` row counts in a local jsonb.
3. The reviewed full-removal extras (§2.7 step B), then `business_profiles`, then `profiles WHERE id = v_uid`, then `auth.users WHERE id = v_uid` (CASCADE clears the 88 cascade tables, auth identities and sessions).
4. Invite and lineage handling per BQ-3.
5. One `audit_trail` row (§2.6).
6. After the block: a verification `SELECT` that the auth user, profile and every listed table hold 0 rows for the id, returning `CLEAN` or the survivors.

Mid-way failure cannot half-delete: the block is one transaction. Re-running after a failure starts from the same state; re-running after success stops at G-1 ("no account for this email"), which is the idempotent end state.

Variables are assigned with `:=` and sub-selects, never `SELECT ... INTO` (see §2.8).

### 2.6 Audit row

> **Superseded (F-4, 2026-10-06):** the event is `BUSINESS_TEST_ACCOUNT_REMOVED` and `entity_type = 'user'` (as registered in `events.ts`). Settings are `set_config(..., true)` (C-5), with a second edit line for the test tag (BQ-1). The text below is the original plan.

Inserted last inside the block, so it commits only if the cleanup did: `action = 'TEST_ACCOUNT_REMOVED'`, `entity_type = 'test_account'`, `entity_id = <removed user id>`, `user_id = NULL`, `actor_id = NULL` (pasted SQL has no signed-in operator), `severity = 'warning'` (pending TQ-5), `details = { source: 'operator_sql', tables: n, rows: n, counts: {...} }`. No email in `details`; `user_email` stays NULL because `user_id` is NULL. `TEST_ACCOUNT_REMOVED` is added to `lib/audit/events.ts` so the admin audit screen can label it.

### 2.7 How the table list and order are derived (not by hand)

`scripts/generate-test-account-cleanup-sql.ts` (pure, no DB) writes both SQL files:

- **Step A**: `descriptorsForRun('purge', { integrations: true, agents: true, activityHistory: true })`, which is already in band order (`PRE_BLOCKING` < `BLOCKING_CHILD` < `LEAF` < `ROOT` < `CONFIG` < `LAST` (`crm_activities`) < `TENANCY_ROOT` (`business_profiles`)). `business_profiles` is held back until after step B.
- **Step B**: a reviewed `FULL_REMOVAL_EXTRAS` list inside the generator: user-scoped `never` descriptors removed for a test account only, in the order their NO ACTION edges need (`billing_events`, `boost_pack_purchases`, `user_rewards`, then `credit_transactions`, then `token_usage`, `user_subscriptions`, and the SET NULL money tables per BQ-2). Every entry must name an existing `never` descriptor and carry a reason.
- **Step C**: `business_profiles`, `profiles`, `auth.users`.
- The guard queries are emitted from `LOCAL_BLOCKING_CONDITIONS` and `R3_LIVE_STATUSES`, so the SQL cannot disagree with the admin delete preview.
- `BUSINESS_OWNED_TABLES` is asserted as a subset of the emitted tables.

Platform tables (`never` with `global` scope, and the four actor-column tables) are never emitted as deletes.

### 2.8 SQL editor hazards

| Hazard | Mitigation |
|---|---|
| The word "into" breaks the editor (memory: `relation "a"/"it"`) | The generator emits no comment prose containing it; plpgsql uses `:=` (no `SELECT ... INTO`). `INSERT INTO audit_trail` is the only occurrence and it is the keyword, not prose. Checked mechanically by the Jest hygiene test (§5), which fails on the word in any comment or string literal. The rest of the hygiene rules from `scripts/__tests__/entitlementSqlScripts.guard.test.ts` (no semicolons in comments, etc.) are applied too. TQ-6 asks whether to drop the keyword use too |
| Runs as `postgres`, RLS bypassed | §2.3 is the only safety: marker + typed confirmation + money/admin refusals |
| `DO` blocks cannot return rows | The check is plain SELECTs; the delete reports via the final SELECT and `RAISE NOTICE` |

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `scripts/generate-test-account-cleanup-sql.ts` | create | Pure generator: descriptors + reviewed extras -> two SQL strings; `--write` writes the files |
| `scripts/test-account-cleanup-check.sql` | create (generated) | Read-only check |
| `scripts/test-account-cleanup-delete.sql` | create (generated) | Atomic delete |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | create | Drift, ordering, coverage and hygiene tests |
| `lib/audit/events.ts` | modify | Register `TEST_ACCOUNT_REMOVED` (label, severity) |
| `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` | create | How to mark, check, delete, verify; what it never does |
| `lib/business-os/purge/descriptors.ts` | no change | Read only |

Deprecated `accountDeletionPolicy.ts` and the scripts depending on it (`test-account-deletion.ts`, `audit-deletion-coverage.ts`, `verify-deletion-policy-tables.ts`, `reset-onboarding.ts`, `business-fixture.ts`) are neither imported nor extended.

---

## 4. Task list

- [ ] T1: Generator skeleton: import `descriptorsForRun`, `PURGE_DESCRIPTORS`, `BLOCKING_EDGES`, `LOCAL_BLOCKING_CONDITIONS`, `R3_LIVE_STATUSES`, `BUSINESS_OWNED_TABLES`; build the ordered plan (steps A to C) as data
- [ ] T2: `FULL_REMOVAL_EXTRAS` and the reviewed FK-column map for NO ACTION / SET NULL edges, each with a reason (after BQ-2)
- [ ] T3: Emit the check SQL (removal counts, guards G-1 to G-11, storage and invite report, verdict)
- [ ] T4: Emit the delete SQL (guards, ordered deletes with counts, invites per BQ-3, audit row, verification SELECT)
- [ ] T5: Register `TEST_ACCOUNT_REMOVED` in `lib/audit/events.ts`
- [ ] T6: Jest tests (§5)
- [ ] T7: Generate and commit-ready the two SQL files; `git diff --stat` review
- [ ] T8: Runbook
- [ ] T9: Manual run by the user on one marked test account: check (expect OK), delete, verify CLEAN, re-invite the same email and sign up

---

## 5. Test plan

Jest only, pure, no DB, no network. Lives in `scripts/__tests__/`, which the Jest gate already collects: one small suite, well inside the existing critical path (no added CI time).

| Test | Fails when |
|---|---|
| Drift | The committed SQL differs from the generator output |
| Coverage | A `reset`/`purge`/`optional:*` descriptor, or a `BUSINESS_OWNED_TABLES` entry, is not deleted by the script |
| Order vs bands | A table's position contradicts its descriptor band, or any `BLOCKING_EDGES` child comes after its parent |
| Extras order | Within step B a NO ACTION child comes after its parent (the cluster edges in §1 are asserted) |
| Never-platform | Any `global`-scope descriptor or actor-column table appears in a DELETE |
| Login last | `auth.users` is the last delete, after `profiles`, after `business_profiles` |
| Guards present | Each of G-1 to G-11 appears in BOTH files; the delete raises on each |
| Hygiene | The word "into" in any comment or string literal; a semicolon in a comment; any `SELECT ... INTO` |
| No email | Neither file contains an `@` outside the placeholder |

Manual (T9, user): one throwaway account end to end, plus one negative run against an unmarked account (expect BLOCKED, nothing removed).

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Pointed at a real customer | Marker (BQ-1) + typed confirmation + livemode / admin / Connect refusals; the marker can only be set by an operator (app metadata is not user-writable) |
| A new table added later is missed | Coverage + drift tests; G-11; and the login delete itself fails on any new NO ACTION FK, which rolls the whole block back |
| Ledger rows orphaned or deleted wrongly | BQ-2; livemode refusal |
| Storage files left behind | Reported by the check (TQ-3) |
| Editor parsing failure | Hygiene test; the block is atomic, so a mis-split paste fails rather than half-runs (TQ-6) |
| D3 ("auth.users is never deleted") | This is an operator exception for marked test accounts, user-approved; SA to confirm (TQ-1). The repo guard (`no-deletion-paths.guard.test.ts`) scans TS in app/lib/components/hooks only, so the SQL does not trip it |

---

## 7. Business questions (for the user)

**BQ-1. How do we mark an account as a test account?** The script trusts nothing else, so this mark is the one thing that stops it deleting a real customer.
- (a) A hidden "test account" flag on the login, set by one line of SQL you run on purpose before cleanup. Customers cannot set it themselves.
- (b) A fixed list of test emails written in the script. Rejected: the repository is public, so the emails would be published.
- (c) Only allow certain email domains. Does not fit: your test accounts use ordinary providers.
- **Recommendation: (a).** The script also refuses admins and anything with real money or a connected Stripe account, whether or not the flag is set.

**BQ-2. What happens to a test account's credit and payment history?** A test account has charges, credit grants and old billing rows. Two of the old billing tables have to go, or the login cannot be deleted at all.
- (a) Delete all of it for the marked test account. The figures in admin reports drop by that account's test usage.
- (b) Refuse whenever any history exists. Nearly every test account would be blocked, so the script would be useless.
- (c) Delete only the two rows that block, and keep the rest with no owner. Admin totals keep the test usage, and the rows point at nobody.
- **Recommendation: (a)**, and only if nothing was ever in Stripe live mode (refused otherwise).

**BQ-3. What about invitations?** Invitations do not block anything, and the same email can already be invited again.
- **Recommendation:** keep the invitation that brought this account in (it records what an admin did), remove the account's own place in the invitation circle, remove invitations it sent that nobody used yet, and refuse if it invited someone who still has an account (clean that account first).

---

## 8. Technical questions (for SA)

- **TQ-1** Confirm this operator exception to D3 / UD-1 (hard delete of `auth.users` for marked test accounts) is acceptable, and that SQL `DELETE FROM auth.users` as `postgres` (rather than the Auth admin API) is the sanctioned path on this project.
- **TQ-2** Generated SQL committed + drift test (proposed), versus generate-on-demand only. Generated keeps the pasted artefact reviewable in the PR.
- **TQ-3** Storage: Supabase blocks direct `DELETE` on `storage.objects`, so SQL cannot remove the files. Proposed: report the count, and the runbook tells the user to empty the folder in the dashboard. Block instead?
- **TQ-4** The FK column map (§1) is reviewed data in the generator, verified at run time by G-11. Acceptable, or extend `purge_schema_introspect` with the column (a migration, out of scope here)?
- **TQ-5** Audit row by raw SQL: `hash` is left NULL (it is computed by `AuditTrailService`). Does any integrity check or the admin screen treat a NULL hash as tampering? Severity `warning` vs `info`?
- **TQ-6** The single `INSERT INTO audit_trail` is the only "into" token. Keep it, or drop the audit row and rely on the editor history, to remove the hazard entirely?
- **TQ-7** Should G-6/G-7 also block on test-mode subscriptions (mirrors R-3, proposed), or only on live mode?

---

## Implementation Notes (Dev, 2026-10-06)

**User answers folded in:**
- **BQ-1 = email pattern, no flag.** An account qualifies when its email **contains** the tag, case-insensitive, compared with `strpos` (so `%` and `_` are read as plain characters). The tag is free text on its own edit line at the top of both files (default `+test`). It may be a full address or any fragment. An empty or whitespace-only tag blocks (G-2). The typed confirmation must equal the email (G-3, delete only). C-10 (a jsonb flag and a separate marking paste) is therefore **superseded**. The test asserts instead that neither file touches `raw_app_meta_data` or runs any `UPDATE`.
- **BQ-2 = delete the test credit and payment history**, behind G-5 (anything in live mode), G-6 (a live plan subscription in either mode, TQ-7) and G-7 (C-8: legacy rows with a Stripe subscription, payment-intent or event id). `subscriptions` was measured absent on prod, so G-7 reads `user_subscriptions`, `credit_transactions` and `billing_events`.
- **BQ-3 = keep the invitation that brought the account in, and remove the invitations it sent.** The account's own `business_os_account_lineage` row also goes. G-15 refuses when another account hangs below it. The runbook carries the T9 point about the inviter's friend slot.

**Tasks:** ✅ T1–T8 done. T9 (a live run on one test account) is the user's.

**Delete steps:**
- Step A is `descriptorsForRun('purge', all options)`, with `business_profiles` held back.
- Step B is `FULL_REMOVAL_EXTRAS`: 51 reviewed `never` tables, ordered by measured NO ACTION edges (`STEP_B_BLOCKING_EDGES`).
- Step C is `business_profiles`, `profiles`, `organizations`, lineage and sent invites, then `auth.users`.

**C-2 guard (G-10):** both files read `pg_constraint` for every FK to `auth.users` outside `auth`. A row naming the login is BLOCKED when it sits in an actor column (`ACTOR_FOREIGN_KEYS`) and is not the account's own. An unreviewed FK is BLOCKED whether it has rows or not. G-11 is kept as a schema check (a missing key column blocks), and a table that is absent is skipped.

**New guards:**
- G-12: storage. Blocks, and lists the paths in all three `STORAGE_DESCRIPTORS` buckets.
- G-13: another account inside an organisation the target owns.
- G-14: consent-ledger rows. **Found while implementing:** `marketing_consent_events` has a BEFORE DELETE trigger that refuses every delete, including the cascade from the login. A test account with consent rows cannot be cleaned by this script.
- G-16: another account imported one of its shared agents, which the cascade would remove.
- G-17: an unreviewed DELETE trigger on a plan table. Reviewed: `REVIEWED_DELETE_TRIGGERS`, plus the two `storage_usage` quota triggers.

**Audit row:**
- Event renamed `BUSINESS_TEST_ACCOUNT_REMOVED`, so it groups under "Business OS" in the admin filter.
- Registered in `events.ts` (warning, SOC2) and in `eventAudience.ts` (`bos`, the only operator-facing audience that exists). Pinned counts are now 183 and 38.
- `user_id`, `actor_id` and `user_email` are NULL. Columns verified on prod.
- The verification SELECT finds the run by `action` plus `created_at = now()`, so the delete file sets no setting of its own.

**Verification:**
- **Jest:** the new suite passes, 52 tests (drift, coverage, bands, edges, `via`, guard order, tag rule, settings, audit pin, hygiene).
- **Affected suites pass:** audit, purge, `businessOwnedTables`, and the entitlement SQL hygiene suite.
- **Static checks:** scoped `tsc` exit 0. `eslint` exit 0 (one warning, already present in `events.ts`).
- **Replica run:** prod cannot take SQL through PostgREST, so the read-only prod measurement covered introspection only. Both files were then **executed** on a local WASM Postgres (PGlite 0.5.8, PG 18) rebuilt from the prod schema (2,907 columns, 266 FKs, the consent and storage triggers), in scratch space outside the repo:
  - OK on a seeded test account, then CLEAN after the delete. The other account stayed intact, the redeemed invite was kept, the sent invite and the lineage row were removed, and the audit row was written.
  - BLOCKED for a non-test email, an empty tag, and a wrong confirmation, with nothing removed.
  - Every guard G-4 to G-17 fired on planted rows.
  - An unforeseen NO ACTION child raised mid-run and rolled back completely.
  - A full address or a fragment works as the tag.

**SA code review fixes (F-1 to F-4, 2026-10-06):**
- **F-1:** the survivor scan runs inside the block, after `DELETE FROM auth.users` and before the audit INSERT. It covers the login, every plan table and every catalog link to the login, and raises on any survivor, so a partial result cannot commit. The trailing SELECT only reports the most recent `BUSINESS_TEST_ACCOUNT_REMOVED` row of the last 15 minutes, with `same_run`: CLEAN, REMOVED EARLIER or NO RECENT REMOVAL. Runbook corrected. Pinned by test.
- **F-2:** G-18 reads every FK whose parent is a plan table from `pg_constraint`, whatever its `ON DELETE` action. An unreviewed link, or a multi-column one, blocks by name. A row whose owner column is not the target, pointing at a row this script removes, blocks. The reviewed list is `INBOUND_FOREIGN_KEYS`, measured on prod 2026-10-06: **189 edges**. 11 have no owner column, and their rows belong to the parent (`PARENT_OWNED_REASONS`). 9 children sit outside the plan: `agent_group_memberships`, `execution_metrics` (2 edges), `execution_routing_decisions`, `marketing_consent_events.contact_id` (SET NULL, owner `user_id`), `shared_agent_imports` (2 edges, owner `imported_by_user_id`), `sla_events`, `workflow_groups`. G-13 and G-16 stay as named instances.
- **F-3:** G-17 covers plan tables, every table with a FK to the login, and every inbound child. `trg_mce_guard` was added to the reviewed list, with its reason (unreachable behind G-14 and G-18). Measured on prod: no other DELETE-capable trigger is in that set.
- **F-4:** §2.2 and §2.6 refreshed (supersession note).
- **Re-validated on the PGlite replica:**
  - OK, then CLEAN with `same_run` true.
  - BLOCKED, with nothing removed, for a non-test email, an empty tag and a wrong confirmation.
  - G-18 blocks a planted foreign-owned row of each kind: SET NULL (another account's consent row on the target's contact) and CASCADE (another account's booking on the target's service).
  - G-18 blocks a planted unreviewed link; G-17 blocks a planted trigger on a cascade-only table.
  - A planted trigger on the login that re-creates a row naming it is caught by the in-block scan, and everything rolls back.
  - A later transaction reports REMOVED EARLIER, not "nothing removed".

**Open for SA:**
- (1) The `--` comments are on the edit lines only, at the user's request. That deviates from the entitlement paste standard of no comments at all. The hygiene test bans `;`, apostrophes and "into" in them.
- (2) `agent_stats`, `data_decision_requests` and `shared_agents` have FK names that do not name the column (`fk_user`…). They are assumed to be `user_id`. If not, G-10 blocks by name on the first check.
- (3) The SQL relies on the editor running one paste as one transaction. The verification prints NOT RUN otherwise, and nothing is removed.

## SA Review Notes

**Reviewed by SA — 2026-10-06** (workplan review, no code; against `4f6fb6ca`)
**Status:** ✅ Approved with conditions. Implementation may start once C-1 to C-12 are folded into §2 to §5. BQ-1..BQ-3 stay with the user, and their answers change only the parts named under "BQ impact" below.

### What holds up (verified)

- **One transaction.** A single `DO` block rolls back as a whole on any `RAISE EXCEPTION` or 23503, so a missed NO ACTION FK fails safe. Re-running after success stops at G-1, which is the correct idempotent end state.
- **Nothing in `supabase/migrations/`**, no route, no TS runtime path, no service-role key. The artefacts are `scripts/*.sql`, which is the right home.
- **Order.** `descriptorsForRun('purge', all options)` already sorts by band. Holding `business_profiles` back until after step B, then `profiles`, then `auth.users`, matches the delete graph. Every `via` child (`website_blocks` LEAF before `website_pages` ROOT, `smart_link_clicks` before `smart_links`, `user_capability_blocks` CONFIG-1 before `user_capabilities`, `agent_scheduler_state` BLOCKING_CHILD+1 before `agents`) comes before its parent, so its sub-select still finds the parent rows.
- **The `into` hazard, measured.** A bare `INSERT INTO public.<existing table>` inside a dollar-quoted body has already been pasted and applied by hand on prod: the `20261011_bos_cron_runs.sql` dry-run `DO` block (7 occurrences) and the `20261017_business_os_credit_lots.sql` function bodies. The failures recorded in memory (`relation "a"` / `"it"`) both come from prose ("into a NEW tab"), where the editor seems to take the next word as a relation name. A schema-qualified real table after the keyword is safe. Keep the audit row (TQ-6), with the exact-token rule in C-6.
- **Audit hash (TQ-5).** Nothing in `app/` or `lib/` reads or verifies `audit_trail.hash`. `AuditTrailService` only writes it when `enableTamperDetection` is on, and both repository readers leave it out of their selects. A NULL hash is not treated as tampering.
- **Generator + committed SQL + drift test (TQ-2): approved.** It is pure and runs in the existing Jest gate. `jest-gate-scope.sh` already runs the gate for any non-markdown change under `scripts/`, so a hand-edit to the `.sql` files is caught, and so is a change to `descriptors.ts`. It adds no time to the critical path.

### Rulings on TQ-1..TQ-7

1. **TQ-1: approved as a scoped operator exception, named OX-1.** Conditions:
   - (a) It runs only as pasted SQL by the operator. No route, no TS, no service-role path may ever call it. The `no-deletion-paths` guard stays as it is.
   - (b) G-2 (the marker) is checked inside the same `DO` block, before the first `DELETE`. A Jest assertion pins that order.
   - (c) **In this PR**, splice an insert-only note into the purge requirement next to D3, and into the admin delete requirement next to UD-1/D14: "OX-1: operator-only hard delete of `auth.users` for accounts carrying the test marker, by `scripts/test-account-cleanup-delete.sql`. Not a product path. D3, D14 and UD-1 are unchanged for every other account." Add a row to each requirement's Change History.

   `DELETE FROM auth.users` as `postgres` is an acceptable path: identities, sessions, refresh tokens and MFA factors cascade inside `auth`. If the project's grants refuse it, the block rolls back, and T9 is where that shows.
2. **TQ-2:** approved. See C-9.
3. **TQ-3: never delete `storage.objects` from SQL**, even where the project allows it. Recent Supabase storage versions install `storage.protect_delete()` triggers that refuse direct deletes ("Use the Storage API instead"). Where those triggers are absent, deleting the metadata row leaves the file itself in object storage with nothing pointing at it. **Ruling: block, do not just report.**
   - The delete gains **G-12**: zero objects under `{uid}/` in every bucket in `STORAGE_DESCRIPTORS`. Generate the list from it: that is **three** buckets, including `business-purge-snapshots`, not the two named in §2.4.
   - The check lists the object paths and prints the user id, so the operator can empty those folders in the dashboard first.
   - Once the login is gone, nothing in the product knows that `{uid}/` folder exists, so "fully removed" would be false.
   - The check may also report, for information only, whether the protect triggers exist (`pg_trigger` on `storage.objects`). Reading `storage.objects` as `postgres` is fine.
4. **TQ-4: replace the reviewed column map's existence check with a run-time catalog read** (C-2). `postgres` can read `pg_constraint` directly, so no migration is needed. Counts can come from a plain `SELECT` via `query_to_xml(format(...))`, so the check stays free of `DO` blocks.
5. **TQ-5:** NULL hash is fine. Use `severity = 'warning'` and register the event with the same value. The Jest test asserts that the SQL literal equals the `events.ts` registration.
   - Verify with `business-os-schema-check` that `actor_id`, `user_id` and `compliance_flags` accept NULL or have defaults, and pass `compliance_flags` explicitly.
   - Side note: the `audit_trail` descriptor says "user_id is SET NULL on the auth FK", while §1 measured no FK. Settle it in the schema check. Either way the design holds, because step A deletes the rows explicitly.
6. **TQ-6:** keep the audit row. See C-6.
7. **TQ-7: yes, block on test-mode subscriptions too** (mirrors R-3). A test-mode Stripe subscription keeps sending webhooks for a user id that no longer exists. Cancel it in the Stripe test dashboard first. See also C-8.

### Conditions

- **C-1** OX-1 scoping and the two requirement splices (TQ-1). Doc work in this PR.
- **C-2 Cross-tenant guard (`tenant-isolation-guard`). This is the important one.**
  - The 13 SET NULL FKs and any CASCADE FK on an **actor** column (`granted_by`, `recorded_by`, `updated_by`, `actor_admin_id`…) write to or delete **other tenants' and platform rows** when the login is deleted. They do it silently, with no 23503 to stop the block.
  - G-9 covers only the four NO ACTION platform tables.
  - Fix: both files enumerate every FK to `auth.users` from `pg_constraint`, in all schemas except `auth`. The generator holds a reviewed allow-list of **tenancy** columns (`user_id`, `owner_user_id`, `profiles.id`, plus the step-B tables per BQ-2).
  - Any FK not on that list that has a row naming the target is BLOCKED, and the output names table and column.
  - Any FK the list does not know at all is BLOCKED too (fail closed). This replaces G-11 and catches new FKs before the delete rather than through the rollback.
  - Add **G-13**: no `organization_members` row of another user in an `organizations` row the target owns. `organizations.owner_user_id` is CASCADE, so deleting the login would remove other people's memberships.
- **C-3 Every user-scoped descriptor gets a disposition.** That includes the `never` ones not in step B: `user_preferences`, `email_unsubscribes`, `marketing_consent_*`, `api_keys`, `audit_logs`, `token_usage`, `business_os_account_plans`/overrides/shadow events, `business_os_credit_totals`, the agent-platform and kernel-learning tables, `archived_records` (no FK on purpose), and the rest.
  - Each one must be one of: deleted explicitly, cleared by a measured CASCADE (asserted against the catalog read), or kept as named residue with a reason.
  - A coverage test fails on any `U`-scope descriptor without a disposition.
  - `CLEAN` means that, apart from the named residue, no table names the uuid: every catalog FK, plus every no-FK `user_id` descriptor.
- **C-4 Storage**, as in TQ-3: G-12 blocks, the bucket list is generated from `STORAGE_DESCRIPTORS`, and no `storage` DELETE ever appears.
- **C-5 Settings scope.**
  - Use `set_config(..., true)` (transaction-local). The editor sends one paste as one implicit transaction, so a value cannot carry over through a pooled session into a later paste that is missing its set line.
  - Read with `NULLIF(current_setting('cleanup.target_email', true), '')`, and fail closed on NULL.
  - If the editor ever splits statements, the settings come back empty, G-1 fails, and nothing is removed.
- **C-6 `into` rule.** Allow exactly one token sequence, `INSERT INTO public.audit_trail (`, schema-qualified. The hygiene test strips that one sequence, then fails on any remaining `into` anywhere, including inside the `$$` body: a `DO` body is itself a string literal, so a naive "comments and strings" scan would flag the allowed line.
- **C-7 Audit registration is more than `events.ts`.** `lib/audit/eventAudience.ts` must tag `TEST_ACCOUNT_REMOVED` (proposed audience: admin/operator). Update the pinned split counts in `lib/audit/__tests__/eventAudience.test.ts`, and check `filterOptions.guard.test.ts`. Add these files to §3.
- **C-8 Legacy billing guard.** G-6 also refuses a legacy `user_subscriptions` / `subscriptions` row that carries a Stripe subscription id. Confirm the column names via schema-check first. The livemode guard G-5 does not cover these tables.
- **C-9 Drift test determinism.** No timestamps or random values in the output. Use a stable sort (already `localeCompare`). Normalise `\r\n` before comparing, or pin `*.sql` to LF in `.gitattributes`: this is a Windows checkout.
- **C-10 Marker.** The marker is a strict jsonb boolean: `(raw_app_meta_data -> 'test_account') = 'true'::jsonb`. The marking snippet lives **only** in the runbook as its own paste, and is never in the delete file. A test asserts the delete file contains no `UPDATE` of `raw_app_meta_data`. Marking and deleting in one paste would defeat the guard.
- **C-11 Triggers.**
  - The check reports the triggers on `auth.users` (read from `pg_trigger`) and the `REVIEWED_DELETE_TRIGGERS` that will fire.
  - Neither file may use `session_replication_role` or `ALTER TABLE ... DISABLE TRIGGER`.
- **C-12 Tests to add:**
  - every `via` child precedes its parent;
  - the marker check comes before the first `DELETE`;
  - no `storage.` DELETE;
  - the audit severity matches the registry.

### BQ impact (not decided here)

- **BQ-1:** the design assumes (a). Any other answer means redesigning G-2 and C-10.
- **BQ-2:** only the contents of `FULL_REMOVAL_EXTRAS` and the C-2 tenancy allow-list change.
  - (b) makes the tool unusable.
  - (c) needs the ownerless rows listed as named residue under C-3.
  - (a) overrides the "dispute evidence" owner ruling on `never` billing rows. That is acceptable only behind G-5, G-6 and C-8.
- **BQ-3:** "keep the invite that brought it in" may keep holding the inviter's friend slot or allowance. T9 should re-invite through the same path the test used, and confirm it works. "Refuse if it invited someone who still has an account" extends G-10.

### Adjusted items (marked by SA)

- §2.3 G-11 is replaced by the C-2 catalog guard. G-12 (storage) and G-13 (org members) are added.
- §2.4 the storage report covers the three generated buckets and becomes a blocker in the delete.
- §3 adds `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts`, and the two requirement docs (OX-1).

### Approval

[x] Workplan approved with conditions C-1 to C-12. Proceed to implementation after folding them in. SA code review will walk each one.

---

**Code Review by SA — 2026-10-06** (uncommitted worktree `neuronforge-test-cleanup`; both SQL files, generator, test, runbook, audit registration, requirement splices)
**Status:** 🔄 Fix Required (F-1 to F-3). Everything else is approved as built; no re-review of the approved parts is needed.

### Verified (holds)

- **Fail before the first DELETE.** G-3 and the empty-email check raise first; every guard row is aggregated into one `RAISE EXCEPTION` before the loop starts. Pinned by test.
- **G-2** is `sign(strpos(lower(btrim(email)), lower(btrim(tag))))`, so `%`/`_` are plain characters, a full address works, and an empty or whitespace tag is NULL and blocks. No further restriction added, per the user decision. C-10 superseded by BQ-1: accepted, and the no-`UPDATE`/no-`raw_app_meta_data` assertion replaces it.
- **Injection.** The edit lines only ever reach SQL as values compared to `current_setting`. Every `EXECUTE`/`query_to_xml` is `format()` with `%I` for generated identifiers and `%L` for a uuid read from `auth.users`. The single `%s` is itself built from `%I`/`%L`. Nothing from the edit lines is interpolated.
- **Order.** Every `via` child precedes its parent (7<53, 46<66, 49<67, 68<77). `auth.users` is the last DELETE and must equal 1 row; the audit row follows inside the block.
- **`into`.** Exactly one token, `INSERT INTO public.audit_trail (`. Comments on the edit lines only (Dev item 1): accepted; the test bans `;`, apostrophes and the word in them.
- **Storage** is never deleted; G-12 blocks on the three generated buckets, and `storage.objects.owner` is also an actor FK in G-10.
- **G-10** blocks any FK the review list does not know, any multi-column FK, and any actor row not owned by the target. Dev item 2 (three FKs assumed `user_id`): accepted; the column comes from `pg_attribute`, so a wrong assumption is an unknown FK and blocks by name, and G-11 checks the plan column exists.
- **G-14, G-15, G-16** as specified. Admin rows (G-4) and live/test subscriptions (G-5..G-7, TQ-7) block.
- **Drift test** is deterministic (no clock, random or env in the generator), normalises CRLF, and `.gitattributes` pins the files to LF. 52 tests in under 9 s inside the existing Jest gate: no added CI time. Audit suites pass (14 suites, 219 tests). Nothing under `supabase/migrations/`. Requirement splices for OX-1 are insert-only, with Change History rows. Event registered in `events.ts` and `eventAudience.ts` with matching severity.

### Code Review Comments

1. **`scripts/test-account-cleanup-delete.sql:662-837` + runbook line 66: the verification can report a real delete as "nothing removed". Priority: High.** If the DO block fails, the implicit transaction aborts and the final SELECT never runs. So inside one transaction `NOT RUN` is impossible. It can only appear when the block committed in an earlier transaction (partial selection, or an editor that splits the batch after the DO), so `now()` no longer matches. The runbook then tells the user "Nothing was removed". The delete itself stays safe (`set_config(..., true)` is transaction-local: if the set lines are split from the DO, the DO sees no email and raises). Fix, without weakening anything:
   - (a) Move the survivor scan **inside** the DO block, after `DELETE FROM auth.users` and before the audit INSERT. It covers every catalog FK column plus every plan table, and `RAISE EXCEPTION` on any survivor, so the whole run rolls back. CLEAN then becomes a property of the commit, not of a later read. Add `RAISE NOTICE 'CLEAN ...'`.
   - (b) Keep the trailing SELECT for information only. Pick the most recent `BUSINESS_TEST_ACCOUNT_REMOVED` row with `created_at >= now() - interval '15 minutes'` (ORDER BY created_at DESC LIMIT 1). Show its `created_at` and a `same_run` flag (`created_at = now()`). Rename `NOT RUN` to `NO RECENT REMOVAL`.
   - (c) Correct the runbook: if no error was shown and no recent removal is listed, run the check file. G-1 "no login for this email" means the account is gone.
   - (d) Add a test that pins the in-block scan between the login DELETE and the audit INSERT.
2. **No-data-loss for other accounts is only hand-covered (G-13, G-16). Priority: High.** G-10 scans FKs to `auth.users` only. An FK from another table into a table this script empties, with `ON DELETE CASCADE / SET NULL / SET DEFAULT`, silently removes or orphans the referencing rows, and those rows may belong to another account. No 23503 is raised to stop it. Fix: add a generic **G-18** in both files, read from `pg_constraint`. Take every FK whose `confrelid` is a plan table and whose `confdeltype` is in `('c','n','d')`, where the referencing table is not itself in the plan, or is in the plan but the row's owner column differs from the target. Block when any referencing row points at a target-owned parent. Also block by name on any such edge missing from a reviewed list in the generator (fail closed, the same shape as G-10). G-13 and G-16 become reviewed instances of it. Run it once on the PGlite replica and paste the edge list into §1.
3. **G-17 reviews triggers on plan tables only. Priority: Medium.** The login DELETE also cascades into CASCADE tables that are not in the plan. The consent-ledger trigger was found by accident during implementation. Fix: extend G-17 to `rel.relname IN (plan tables) OR rel.oid IN (fk_catalog referencing tables)`, using the same reviewed list. The `auth.users` triggers stay report-only (C-11).
4. **Workplan §2.2/§2.6 are stale. Priority: Low.** They still say `set_config(..., false)`, `TEST_ACCOUNT_REMOVED` and `entity_type = 'test_account'`. The code uses `true`, `BUSINESS_TEST_ACCOUNT_REMOVED` and `'user'` (consistent with `events.ts`). Update the text and note the supersession.

### Optimisation Suggestions

- `shared_agent_imports.imported_by_user_id` is an actor with no owner column, so the target's **own** imports block it too. This is safe but over-strict. If it bites in T9, give it an exclusion keyed on the import's own owner.
- `fk_review` lists `business_os_invites.issuer_account_id` as tenancy, while §1 measured no FK. It is harmless; add a one-line reason or drop it.
- Step A deletes `audit_trail` rows where `user_id` = target, including admin actions recorded against the test account. This is within BQ-2 (a). Mention it in the runbook's "what is removed" list.

### Code Approved for QA: No. Yes once F-1 to F-3 are fixed. F-4 and the suggestions do not gate. SA re-checks only F-1 to F-3 and their tests.

**SA re-check — 2026-10-06 (F-1 to F-4 only):** ✅ **Code Approved for QA.**

- **F-1.** The survivor scan sits inside the block, between the login DELETE and the audit INSERT. It covers every catalog FK to `auth.users` plus every directly keyed plan table, and raises on any survivor. `via` children are omitted, which is correct because their parents are already gone. The final SELECT is information only (latest removal in a 15-minute window, `same_run`), and the runbook text is corrected.
- **F-2.** G-18 reads every FK into an emptied table, whatever its ON DELETE action. It blocks unreviewed links, multi-column keys, missing owner columns, and rows whose owner is another account. The 11 ownerless reviewed links each reach only rows below a parent the target owns, and each carries a reason; `workflow_groups` is backed by G-13. Dynamic SQL is still `%I`/`%L`, and the one `%s` is generated.
- **F-3.** G-17 now covers plan tables, every table linked to the login, and every child of an emptied table. `trg_mce_guard` is exempted only because G-14 blocks first.
- **F-4.** Stale workplan text refreshed.
- **Tests.** 61 tests pass in about 3 s, still inside the existing gate.

## QA Testing Report

**QA — 2026-10-06** (uncommitted worktree `neuronforge-test-cleanup`, after the F-1 to F-4 fixes; SQL hashes: check `9526945c…`, delete `aa2a9a47…`)
**Test mode:** full
**Strategy used:** A (Jest: new suite, audit, purge, authz guard, full suite) + C (both SQL files executed on a local PGlite 0.5.8 / PG 18 replica rebuilt from the existing read-only prod schema dump, reusing Dev's `harness.mjs`, in session scratch space outside the repo). Nothing was run against prod, not even introspection.
**Focus:** security, schema
**Skipped:** D (no UI). The live run in the real Supabase SQL editor stays T9 (user)
**Input source:** prompt keywords

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| New suite | ✅ | Pass | `testAccountCleanupSql.test.ts` 61/61 |
| Audit + purge + entitlement SQL hygiene suites | ✅ | Pass | 25 suites, 533 tests |
| `npm run test:authz-guard` | ✅ | Pass | 119/119 |
| Full `npm test` | ✅ | Pass (no new failures) | 971 suites, 18,953 tests; 144 failed in 15 suites = the 11 quarantined suites + the known Windows-only `oneAddressPolicy.guard`, `addressFormat`, `AdminAreaField.search`, `AdminAreaField.render`. Nothing else red |
| Drift: regenerated SQL byte-identical | ✅ | Pass | `npx tsx scripts/generate-test-account-cleanup-sql.ts` rewrote both files; sha256 unchanged |
| Drift: CRLF checkout | ✅ | Pass | Delete file converted to CRLF (1,099 line ends): whole suite still 61/61 (reader normalises). `.gitattributes` pins the two files to `eol=lf` (`git check-attr` confirms). Restored, hash re-verified |
| Drift: a hand edit is caught | ✅ | Pass | One-character edit: drift test fails. Restored |
| Scoped `tsc` / `eslint` | ✅ | Pass | tsc exit 0; eslint exit 0 (1 pre-existing warning, `events.ts:1339`) |
| Happy path: OK, then CLEAN | ✅ | Pass | Test account seeded in every `user_id` table: business data, credits (lots, draws, charges, legacy credit rows), payments, agents, website, 2 sent invites, 1 inbound friend invite from another account, a lineage row, an identity, no storage. The check is read-only (fingerprint of every table unchanged), verdict OK, 132 tables / 143 rows. The delete returned `CLEAN`, `same_run` true, 142 rows + the login. Per-table counts in the check and in the audit details agree exactly |
| Nothing names the removed login | ✅ | Pass | Every uuid column in public/auth/storage scanned: 0 hits, except the kept invite's `redeemed_account_id` and the audit `entity_id` (by design) |
| Other account untouched | ✅ | Pass | V's login, data and invites intact |
| Inbound invite kept; sent invites and own lineage removed | ✅ | Pass | 1 kept, 0 sent left, 0 lineage |
| Audit row | ✅ | Pass | One `BUSINESS_TEST_ACCOUNT_REMOVED`: entity U, `user_id` NULL, `warning`, `SOC2`, no `@` in details |
| Re-run after success | ✅ | Pass | Refused at G-1 |
| Same email re-created | ✅ | Pass | The replica was given a unique index on `auth.users.email` and a cascading `auth.identities`, as on prod. A new login, identity, profile and fresh invite for the same email all insert, and the check then resolves to the new login (OK) |
| Tag as a full email, and case-insensitive | ✅ | Pass | Full address as tag, `+TEST1`, a padded upper-case email line, and a mixed-case `auth.users.email`: each OK, then CLEAN |
| Failure paths: BLOCKED, zero rows changed | ✅ | Pass (29/29) | Fingerprint (row count + md5 of every table in public/auth/storage) taken before the check, after the check and after the delete: identical each time. Cases: non-test email (G-2); empty and blank tag (G-2); wrong and placeholder confirmation (G-3, delete only, so the check says OK, as designed); unknown email (G-1); admin by `user_id` and by email only (G-4); livemode billing account and livemode boost (G-5); active test-mode subscription, and a Stripe sub id with no `ended_at` (G-6); legacy Stripe sub id (G-7); Stripe Connect (G-8); pending payment, sent invoice, active plan subscription (G-9); storage object in `website-images` and in `business-purge-snapshots` (G-12); foreign-owned linked row, CASCADE (V proposal on U contact) and SET NULL (V invoice on U contact) (G-18); another member in its organisation (G-13 + G-18); unreviewed FK to `auth.users` with no rows (G-10); unreviewed FK into a plan table with no rows (G-18); actor column `exchange_rates.updated_by` (G-10); unreviewed row and statement DELETE triggers on plan tables (G-17); consent-ledger row (G-14); child account below it in the invitation circle (G-15) |
| Planted survivor: full rollback | ✅ | Pass | An AFTER DELETE trigger on `auth.users` re-inserts a row naming the login. The in-block scan raised "Rows still name the login … rolled back: archived_records 1", and no table changed. A refill trigger on a plan table is stopped earlier, by G-17 |
| Hygiene | ✅ | Pass | "into" occurs once across both files, as `INSERT INTO public.audit_trail (`. No `session_replication_role` or `DISABLE TRIGGER`. No DELETE on `storage.*`. No `UPDATE`. No `@` except the placeholder. Nothing under `supabase/migrations/` |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The new suite stays inside the existing Jest gate.

#### Edge Cases (nice to fix)
1. **Replica fidelity, so T9 still matters.** The replica's columns are loosely typed. It has no CHECK or NOT NULL constraints, it infers FK columns from constraint names, and its `auth` schema is minimal. Three things are therefore proven only by T9: the real editor running one paste as one transaction, the `postgres` grant for `DELETE FROM auth.users`, and the real cascade inside `auth`. The block is atomic, so a failure in any of them rolls back.
2. **Count wording (cosmetic).** The check's `remove` total counts the login row (143), while the delete's `rows` does not (142). Neither counts rows removed by cascade (e.g. `auth.identities`).
3. **Not exercised:** the SA note that `shared_agent_imports.imported_by_user_id` blocks the target's own imports. That fails safe, so it is left to T9.

### Test Outputs / Logs

```text
testAccountCleanupSql.test.ts       Tests: 61 passed, 61 total
audit + purge + entitlement SQL     Test Suites: 25 passed; Tests: 533 passed
test:authz-guard                    Tests: 119 passed, 119 total
npm test                            971 suites; 144 failed / 18,953 (11 quarantined + 4 known Windows-only suites)
regenerate                          sha256 unchanged: check 9526945c… delete aa2a9a47…
tsc (scoped) exit 0 | eslint exit 0 (1 pre-existing warning)
replica qa.mjs                      happy 26 PASS, tag variants 4 PASS, blocked 29 PASS, survivor 2 PASS; FAILURES: 0
```

### Final Status
- [x] All acceptance criteria pass: ready for commit. T9 (the user's live run on one test account) remains
- [ ] Issues found — Dev must address before commit

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-06 | Created | Workplan only. Re-scoped from a TS CLI to pasted SQL by user decision the same day |
| 2026-10-06 | SA workplan review | Approved with conditions C-1 to C-12. TQ-1 becomes OX-1 (scoped, documented in both requirements). Storage: block, never delete via SQL. Run-time catalog FK guard replaces G-11 and closes cross-tenant SET NULL/CASCADE writes. `INSERT INTO public.audit_trail` allowed as the only exact token |
| 2026-10-06 | Implemented (Dev) | BQ answers folded in (tag = free-text contains, BQ-2 delete, BQ-3 keep incoming invite), C-1..C-12 implemented except C-10 superseded by BQ-1; G-14/G-16/G-17 added; validated on a PGlite replica of the prod schema. Uncommitted |
| 2026-10-06 | SA code review | Fix Required: F-1 verification can report a committed delete as nothing removed (move survivor scan into the block, windowed post-select, runbook); F-2 generic inbound-cascade guard G-18 for other accounts' rows; F-3 G-17 over cascade tables. Rest approved |
| 2026-10-06 | SA code-review fixes (Dev) | F-1 in-block survivor scan + informational final SELECT; F-2 G-18 inbound-link guard (189 reviewed edges); F-3 G-17 widened; F-4 doc refresh. Re-validated on the replica. Uncommitted |
| 2026-10-06 | SA re-check | F-1 to F-4 verified: in-block survivor scan, G-18 inbound-link guard, G-17 widened. Code approved for QA |
| 2026-10-06 | QA | Full pass: Jest (new 61, audit/purge 533, authz 119, full suite no new failures), drift byte-identical incl. CRLF, replica happy path CLEAN + 29 blocked paths with zero rows changed + survivor rollback. No bugs |
| 2026-10-07 | Per-table report (Dev) | User request: the delete file's final SELECT lists each removed table with its row count, read from the audit row's counts, then a TOTAL row (result, rows, tables, login, same_run). Informational only, the DO block is unchanged. Test pins the shape; replica happy path: 130 tables summing to 141 = TOTAL. Uncommitted |
