# Workplan: Payment Tables Write Lock-down (P0-PAY-RLS)

> **Last Updated**: 2026-09-21

**Developer:** Dev
**Branch:** `fix/payment-tables-write-lockdown` (merged as PR #83, `8e502f1b`). Docs/rollback follow-up: `docs/payment-lockdown-applied`
**Status:** ✅ **APPLIED TO PRODUCTION 2026-09-21** — SA approved, QA passed (34/34), merged, applied by hand in the Supabase SQL editor and post-check verified (§5.3). One defect found by the post-check (63-byte identifier truncation, §5.3) is fixed in the migration's ROLLBACK block. One P1 follow-up queued in §10 — not part of this change
**Precedent:** `supabase/migrations/20261001_user_subscriptions_write_lockdown.sql` and [ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md](/docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md) §9

## Overview

Twelve Business OS payment tables (plus the `credit_transactions` credit ledger) carry PERMISSIVE owner **write** policies granted to role `PUBLIC`, and `anon` / `authenticated` hold INSERT/UPDATE/DELETE on all of them. Any signed-in user can mark their own invoices paid, fabricate `payment_transactions` (which is what revenue is counted from, and what trigger T4 uses to flip an invoice to `paid`), or forge credit-ledger rows — straight from the devtools console, with no API log and no audit entry. This change makes those tables server-write-only. Reads are unchanged. **No application code changes.**

## Table of Contents

1. [Scope](#1-scope) | 2. [Approach and decisions](#2-approach-and-decisions) | 3. [Blast radius](#3-blast-radius-swept-2026-09-21) | 4. [Risks](#4-risks) | 5. [Apply guide](#5-apply-guide-for-the-user) | 6. [Test plan](#6-test-plan) | 7. [SA Review Notes](#7-sa-review-notes) | 8. [QA Testing Report](#8-qa-testing-report) | 9. [Commit Info](#9-commit-info) | 10. [SECURITY DEFINER follow-up](#10-follow-up-security-definer-functions-executable-by-anon--queued-p1)

## 1. Scope

| Item | Value |
|---|---|
| Migration | `supabase/migrations/20261004_payment_tables_write_lockdown.sql` (create) |
| Static test | `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` (create) |
| Doc | this file (create) |
| Application code | **none** |
| Out of scope | `billing_events`, `boost_pack_purchases` (no user write policy), all service-role policies, all SELECT policies and grants |

Live policy state (read on prod by the user, read-only SQL, 2026-09-21 — all PERMISSIVE, roles `PUBLIC`):

| Table | Policy | cmd | Action |
|---|---|---|---|
| credit_transactions | Users can insert their own transactions | INSERT | drop |
| payment_automation_executions | Users can view their own automation executions | **ALL** | → SELECT twin |
| payment_automation_rules | Users can manage their own automation rules | **ALL** | → SELECT twin |
| payment_events | Users can view their own payment events | **ALL** | → SELECT twin |
| payment_invoices | insert / update / delete their own invoices | INSERT, UPDATE, DELETE | drop |
| payment_methods | insert / update / delete their own payment methods | INSERT, UPDATE, DELETE | drop |
| payment_plan_installments | Users can manage their own installments | **ALL** | → SELECT twin |
| payment_plans | Users can manage their own payment plans | **ALL** | → SELECT twin |
| payment_processors | Users can manage their own payment processors | **ALL** | → SELECT twin |
| payment_reminders | Users can manage their own payment reminders | **ALL** | → SELECT twin |
| payment_transactions | insert / update / delete their own transactions | INSERT, UPDATE, DELETE | drop |
| saved_payment_methods | Users can manage their contacts saved payment methods | **ALL** | → SELECT twin |

> **One function is in scope too (QA-2).** `update_overdue_installments()` (`supabase/migrations/20260723_enhance_payments.sql:406`) is `SECURITY DEFINER` in `public`, so it runs as its owner and **ignores both RLS and every grant this migration revokes** - a table lock-down alone cannot close it. Unlike the four queue claim/reap functions it carries no `REVOKE` anywhere in the repo, so it kept PostgreSQL's default `EXECUTE TO PUBLIC` and is callable at `POST /rest/v1/rpc/update_overdue_installments` with the public anon key; its `UPDATE payment_plan_installments SET status='overdue'` has **no `user_id` predicate**, so one anonymous call flips every tenant's installments. The user confirmed live on prod 2026-09-21: `has_function_privilege` is **true for both `anon` and `authenticated`**. This migration adds `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` (guarded on the function existing) plus a post-condition. `FROM PUBLIC` is required - the grant is the default PUBLIC one, so naming only the two roles would be a no-op. This is a *function* privilege, so RC-4's `bypassrls`/table-privilege warning does not apply. **Nothing calls it:** zero `.rpc('update_overdue_installments')` hits in the repo, no cron wired to it, and the only other occurrences are its own definition and an inventory row in `scripts/check-migrations.sql`; `PaymentReminderService.processOverdueItems` does its own user-scoped UPDATE through the service role. The function **body is untouched** - only the privilege changes.

> **`payment_methods` is dead weight (SA RC-7).** It has no writer *and* no reader anywhere in the repo - zero `.from('payment_methods')` hits - and `lib/business-os/purge/descriptors.ts:175` records that its drop migration `2026-08-14_drop_payment_methods.sql` was never applied. It stays in this set for uniformity (revoking writes on an unused table is free), but it is a **drop candidate for a separate follow-up** - do not drop it here.

## 2. Approach and decisions

| # | Decision | Why |
|---|---|---|
| D-1 | The eight `FOR ALL` policies are **converted**, not dropped: a `FOR SELECT` twin named `"<name> (read-only)"` is created with the **same** USING expression and roles, read from `pg_policies` at run time, then the original is dropped | Two of them are named "Users can view …" but are `cmd = ALL`, and on these tables the ALL policy may be the **only** policy — owner reads depend on it. A plain drop would silently kill the payments UI. Copying `qual` at run time is also why the file is correct without knowing each expression in advance |
| D-2 | The write-only policies are swept **by shape**, not by name (`PERMISSIVE`, `cmd IN (INSERT, UPDATE, DELETE)`, roles ∩ {public, anon, authenticated}, `qual`/`with_check` not mentioning `service_role`) | The live names of the `payment_invoices` / `payment_methods` / `payment_transactions` triplets were reported collapsed ("insert / update / delete their own …"). `DROP POLICY IF EXISTS` on a guessed name silently does nothing — the precise failure this change exists to avoid. The shape filter cannot hit a SELECT policy, a `FOR ALL` service-role policy, or a role-scoped policy |
| D-3 | Post-conditions assert, for **each** of the twelve tables, that a PERMISSIVE SELECT policy survives, that `authenticated` still holds SELECT, that no write-capable user policy remains and that neither role holds any write privilege — else the transaction ABORTS | The user's investigation query returned only write-capable policies, so we do not know which tables have separate SELECT policies. The migration must be correct either way, and must refuse to leave a table unreadable. **The SELECT half of that is a liveness hazard, not only a safety net (SA RC-3)** - so the pre-check now answers it *before* the apply starts (Section 5 step 2) rather than discovering it mid-apply |
| D-7 | The `20261001` ordering (R-1) is enforced **inside the transaction**: the guard aborts if `authenticated` still holds UPDATE on `public.user_subscriptions` (SA RC-1) | It is the only irreversible *data* consequence in this change, and prod being safe today says nothing about the Preview project in `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md`. A comment plus a name-based pre-check is not a control. The file only ever *reads* `user_subscriptions` |
| D-4 | Grants **and** policies, not one or the other | Without the grant a policy is unreachable; without the policy the grant is unusable. A future dashboard edit restoring only one does not re-open the hole |
| D-5 | `anon`'s SELECT grant is kept | Inert (owner policies need `auth.uid() = user_id`, NULL for anon) and revoking it turns pre-hydration reads into 403s. Same as the `user_subscriptions` precedent |
| D-6 | The browser `RewardService` → `credit_transactions` INSERT is **not** fixed | Same accepted degradation as D-3 of the `user_subscriptions` lock-down: that path awards credits from the browser, which *is* the vulnerability. Fixing it means a server-side reward route with its own SA review. See R-1 for the ordering consequence |

## 3. Blast radius (swept 2026-09-21)

**Method.** For each of the twelve tables: every `.from('<table>')` followed by `.insert/.update/.upsert/.delete` across `app`, `lib`, `components`, `hooks`, `scripts` (script-based scan, both quote styles); then every service/repository that takes an injected `SupabaseClient` traced to **all** its construction sites; then every file using `createServerClient` / `createAuthenticatedServerClient` / `supabaseServerAuth` / a browser client cross-referenced against the table names and the payment repo/service names; then `.rpc(` calls; then SQL functions and triggers that write these tables.

**Result: no RLS-respecting writer exists.** Every application writer is `supabaseServer` / `supabaseAdmin`.

| Writer group | Files | Client |
|---|---|---|
| Payment repositories (sole data path for most tables) | `lib/repositories/PaymentRepository.ts`, `PaymentPlanRepository.ts`, `PaymentPlanSubscriptionRepository.ts`, `PaymentAutomationRepository.ts`, `PaymentEventRepository.ts`, `PaymentReminderRepository.ts`, `PaymentProcessorRepository.ts` | `supabaseServer` (constructor default + exported singletons) |
| Direct service-role writes | `app/api/stripe/webhook/route.ts`, `app/api/stripe/sync-subscription/route.ts`, `app/api/payments/blocks/execute/route.ts`, `app/api/business-os/payment-stages/[id]/complete/route.ts`, `app/api/proposal/[token]/route.ts`, `app/api/website/booking/finalize/route.ts`, `lib/payments/bindPlanSubscription.ts`, `lib/payments/cancelPlan.ts`, `lib/payments/RefundService.ts` | `supabaseServer` / `supabaseAdmin` |
| Injected-client writers (SA RC-6, the W-4 shape) | `lib/services/CreditService.ts` INSERTs `credit_transactions` on an injected client - sole construction site `new CreditService(supabaseServer)` at `app/api/run-agent/route.ts:94`, now pinned by a test; `lib/services/PaymentReminderService.ts:861` UPDATEs `payment_plan_installments` via `this.supabase` | `supabaseServer` (service singleton) |
| Injected-client writer (the W-4 shape) | `lib/payments/invoiceSettlement.ts` → `settleInvoicePaid(client, …)` writes `payment_transactions`, `payment_invoices`, `payment_plan_installments`. All five call sites checked: `app/api/payments/blocks/execute/route.ts:172`, `app/api/payments/invoices/[id]/mark-paid/route.ts:86`, `app/api/scheduling/bookings/[id]/route.ts:299`, `lib/business-os/bizql/mutate/MutateExecutor.ts:382`, `lib/services/PaymentRetryService.ts:366` | `supabaseServer` at every site |
| §8.1 queue drains | `app/api/cron/payment-reminders/route.ts` → `paymentReminderService`; `app/api/cron/payment-retry/route.ts` → `paymentRetryService` + `paymentAutomationEngine`; claim/reap via `claim_due_payment_reminders`, `reap_stale_payment_reminders`, `claim_due_payment_automation_executions`, `reap_stale_payment_automation_executions` | Service singletons built with `supabaseServer`; all four RPCs are `SECURITY DEFINER`. No cron builds a user-scoped client |
| Internal Payments plugin | `lib/server/payments-plugin-executor.ts` | Repository singletons only (service role) |
| Insights detectors / metrics | `CashArOverdueDetector`, `MetricsComputeService` build `new PaymentInvoiceRepository(this.supabase)` | Read-only (`getOverdueInvoices`), and the injected client is `supabaseServer` at every construction site (`DetectorEngine`/`AutomationManager`/`MetricsComputeService` are all built with `supabaseServer`) |
| Purge / reset | `lib/business-os/purge/*` → `businessPurgeRepository` → `purge_business_data` RPC | `supabaseServer` |
| `scripts/**` | ~20 files | Service-role CLI tools, not a runtime path |
| Browser (`'use client'`) writes | **none** to any of the twelve tables | — |

**The one exception (deliberate, D-6).** `lib/credits/rewardService.ts:202` INSERTs `credit_transactions`, and `RewardService` is constructed with the **browser** client in `app/v2/agents/[id]/page.tsx:1857` and `app/(protected)/agents/[id]/page.tsx:714`. This is the same path the `user_subscriptions` lock-down accepted as broken (D-3 there). It is not switched to `supabaseServer` here because it is a client component, and a server-side reward route is a separate, SA-reviewed change.

**Database-side writers.** `log_payment_activity`, `update_invoice_on_payment` (T4), `recompute_transaction_refund_state`, `propagate_refund_to_invoice` and `move_plan_stage_with_invoice` are **SECURITY INVOKER** triggers that write `payment_invoices` / `payment_transactions` / `payment_plan_installments` in response to writes on those tables and on `payment_refunds`. They run with the privileges of whoever wrote the source row — and every app writer of those source rows (including all `payment_refunds` writers: `lib/payments/RefundService.ts`, the Stripe webhook) is the service role, which bypasses RLS and keeps its grants. `update_overdue_installments` and the four queue functions are SECURITY DEFINER. Nothing here breaks.

## 4. Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | Applied **before** `20261001_user_subscriptions_write_lockdown.sql`, the browser share-reward credits `balance` and then fails the ledger insert — `RewardService` returns `success: true` ("Credits awarded but transaction logging failed"), so credits are granted with **no ledger row** | Medium | Pre-check step 0 confirms 20261001 is live; the ORDERING note is in the migration header and in §5 step 1 |
| R-2 | A `FOR ALL` policy is the only policy on its table, so a naive drop kills owner reads | **Low today - corrected per SA RC-3.** SA's reader sweep found `credit_transactions` is the only one of the twelve read by any browser or user-cookie client; the other eleven are read solely through service-role routes, which bypass RLS. The eight twins are load-bearing for *zero* tables today | D-1 keeps the conversion anyway - cheap, correct, and it preserves the option of RLS-scoped reads. The real exposure is the inverse, R-9 |
| R-10 | The `update_overdue_installments()` revoke breaks a legitimate caller | **Very low** | Zero callers in the repo (checked: `.rpc(`, crons, `vercel.json`), no cron wired to it, and `PaymentReminderService.processOverdueItems` does the same job user-scoped through the service role. `service_role` and the owner are unaffected - the revoke names PUBLIC, `anon` and `authenticated` only. One-line rollback in header part (a2) |
| R-9 | Post-condition (a) aborts the apply because a table has no PERMISSIVE SELECT policy - a stall on a P0 over a read path nobody uses. `payment_methods` is the likeliest (no reader, no writer) | Medium | Section 5 step 2 makes it a **pre-apply decision from query 2**, before the transaction is run at all; the abort message names the table |
| R-3 | Policy names drifted since 2026-09-21, so a named drop silently no-ops | Low | The eight named conversions RAISE EXCEPTION when the policy is absent *and* no twin exists, or when its cmd/permissive differ; the write-only sweep is name-independent; the "no write-capable user policy left" post-condition catches anything missed |
| R-4 | A privilege was granted to `PUBLIC` rather than to `anon`/`authenticated`, so the REVOKE misses it | Low | `has_table_privilege` post-condition counts inherited PUBLIC grants and aborts with the remedy |
| R-5 | A writer this sweep missed breaks silently in production | Low | §3 used four independent methods including injected-client tracing; the Jest source guards re-run on every commit; §5 step 7 names the symptoms; rollback is one transaction |
| R-6 | `DROP/CREATE POLICY` queues billing reads behind an `ACCESS EXCLUSIVE` lock request | Low | `SET LOCAL lock_timeout = '3s'` / `statement_timeout = '60s'`: it gives up harmlessly and can be re-run |
| R-7 | The dropped write-only policies are not recoverable from the file alone | **Certain** | The pre-check query-2 export is the **only** backup (SA RC-2: the Supabase SQL editor does not surface a script's `RAISE NOTICE` output, so the apply transcript is *not* a second copy). Section 5 step 2 makes saving it into this workplan a hard gate before the apply starts |
| R-8 | Someone rolls this back to "fix" an unrelated bug and re-opens the hole | Medium | The rollback block says so and tells the reader to fix forward |

## 5. Apply guide (for the user)

File: `supabase/migrations/20261004_payment_tables_write_lockdown.sql`. Applied by hand in the Supabase SQL editor, on production (and any other environment with this schema).

1. **Deploy order: no application code needs to ship first.** The sweep (Section 3) found no RLS-respecting writer, so nothing in the running app depends on these policies or grants. The only ordering constraint is against **another migration**: `20261001_user_subscriptions_write_lockdown.sql` must already be applied (R-1). You do not have to take that on trust - the migration **enforces it and aborts** if `authenticated` still holds UPDATE on `public.user_subscriptions` (D-7). Pre-check step 0 is the human-readable version of the same check.
2. **Pre-check (read-only). Saving query 2 is a HARD GATE - do not start the apply until it is saved.** The four queries in the migration header:
   - **(0)** `user_subscriptions` policies - no "Users can update ..." left.
   - **(1)** RLS state - `rls_enabled = true` and `rls_forced = false` on all twelve, otherwise **stop and escalate**.
   - **(2) every** policy on the twelve tables with `qual` and `with_check`. This is the true before-state and the **only** backup of the policies this migration drops - the Supabase SQL editor does **not** surface the script's `RAISE NOTICE` output, so there is no second copy (SA RC-2). Save it to a file and paste it into Section 5.1 of this workplan **before applying**.
     Two decisions come out of it, both **before** the apply (SA RC-3):
     - **does every one of the twelve tables have at least one PERMISSIVE SELECT policy?** If one does not, the migration's post-condition (a) will abort - **stop and send the output to the Dev** instead of discovering it mid-apply. `payment_methods` is the likeliest (no reader, no writer anywhere in the repo).
     - **is any write-capable policy present that is not in Section 1's table** (cmd ALL/INSERT/UPDATE/DELETE, roles including public/anon/authenticated, not mentioning `service_role`)? If so, **stop and send it to the Dev**.
   - **(3)** grants for `anon` / `authenticated`.
3. **Apply:** run the whole file. One transaction, safe to re-run. If it aborts, **nothing changed**:

   | Abort message | What it means |
   |---|---|
   | `canceling statement due to lock timeout` | Something held a conflicting lock >3 s. Harmless — run it again |
   | `RLS is disabled on public.<t>` / `FORCE RLS is on for public.<t>` | Escalate to the Dev; the file would not protect the table, or would affect owner-side writers |
   | `policy "…" not found … live schema has drifted` / `is cmd …, expected ALL` | A name or shape drifted. Send the pre-check output to the Dev |
   | `no PERMISSIVE SELECT policy left ...` | That table would have been left with no owner read path. Per SA's reader sweep this only breaks a real read path for `credit_transactions`; for the rest it is a stall, not an outage (R-9). Step 2 should have caught it - escalate, nothing was applied |
| `authenticated lost SELECT ...` | Reads would have broken. Escalate - nothing was applied |
| `authenticated still holds UPDATE on public.user_subscriptions ...` | `20261001` has not been applied in this environment. Apply it first, then re-run this file (R-1 / D-7) |
   | `table public.<t> does not exist` | This environment never ran the migration that creates it. Escalate - do not hand-create the table |
   | `canceling statement due to statement timeout` | The 60 s limit, not the 3 s lock one. Nothing changed; re-run, and if it repeats send the output to the Dev |
   | `policy "... (read-only)" for table "..." already exists` (`duplicate_object`) | **Drift, and the one abort whose message does not explain itself:** a twin is present *alongside* the original, so a previous run was interrupted between the CREATE and the DROP, or someone hand-created it. Stop - do not drop either by hand - and send the pre-check output to the Dev |
   | `has no USING expression - cannot rebuild its read half safely` | A converted policy had a NULL `qual`. Escalate; nothing was applied |
   | `is %, expected PERMISSIVE` | One of the eight is RESTRICTIVE now. Shape drift - send the pre-check output to the Dev |
   | `<role> still holds EXECUTE on public.update_overdue_installments()` | The function revoke did not land (QA-2). Escalate - nothing was applied |
   | `write-capable user policies still present on public.<t>: …` | An unexpected write policy survived the sweep. Send the message to the Dev |
   | `<role> still holds <priv> on public.<t>` | The privilege came from a grant to `PUBLIC`. **Do not run the `FROM PUBLIC` remedy blind (SA RC-4).** `bypassrls` does *not* bypass table privileges, so if `service_role`'s writes on that table also come via PUBLIC, revoking from PUBLIC breaks the Stripe webhook - a money path - and no post-condition here would notice. First run `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee='service_role' AND table_name = '<t>';` and confirm `service_role` holds INSERT/UPDATE/DELETE **explicitly**. Only then re-run the REVOKE with `FROM PUBLIC`, re-run that query to confirm `service_role` is unchanged, and re-run the file |

   If your client shows `NOTICE` output, keep it (it lists every policy converted, every policy dropped and each original `WITH CHECK`) - but the Supabase SQL editor does not, which is why step 2's export is the backup and this is not.
4. **Post-check (read-only):** run the five queries in [§5.2](#52-post-check-queries-copy-paste-with-expected-results) — they are the pre-check's queries 1-4 plus the column-privileges query from the migration header's POST-CHECK block, written out with an expected result for each. The column one is **not optional** (QA-3): `has_table_privilege(..., 'INSERT')` returns false for a *column-level* grant and `REVOKE ... ON <table>` does not remove one, so post-condition (c) can pass with a column-level write path still open. On write policies, the precise claim (QA-7): no PERMISSIVE write-capable policy remains **whose roles include `public`, `anon` or `authenticated`** - one granted only to some other role would survive all of this, but is unreachable from a Supabase JWT, which maps only to those two roles. The 2026-09-21 production output of all five is recorded in [§5.3](#53-applied-to-production--2026-09-21).
5. **Verify from the browser** — the check that actually proves the hole is closed, using the anon key the way an attacker would. In a logged-in tab, devtools → Network, open the payments page, find a request to `…/rest/v1/payment_invoices?select=…`, right-click → *Copy as fetch*.
   - **(a) read** — run it as copied. Must still return your rows.
   - **(b) write** — paste it again, change `method` to `'PATCH'`, replace the `?select=…` part of the URL with `?id=eq.<one of your invoice ids>`, add `body: JSON.stringify({ status: 'paid' })`, and add both headers `'Content-Type': 'application/json'` and `'Prefer': 'return=representation'` (without `Content-Type` PostgREST answers **415** and proves nothing; without `Prefer` a successful PATCH answers a bodiless **204** and you cannot tell success from "0 rows").

   | Result of (b) | Meaning |
   |---|---|
   | 401/403 with `42501 permission denied for table payment_invoices` | ✅ the grant revoke landed — **this is the proof** |
   | 2xx with body `[]` (0 rows) | ⚠️ policies gone but a grant survives (possibly via `PUBLIC`) — **escalate**, half closed |
   | 2xx and the invoice actually changed | ⛔ nothing was applied — **stop** and restore that row |

   ⚠️ Run (b) only *after* applying, or use a throwaway row: before the migration it really does write. Repeat (a) on one more table with a converted policy (e.g. `payment_reminders`) to confirm the read twin works.
6. **Watch for a day:** the payments screens (invoices, plans, reminders, saved methods) still list rows; a manual "mark paid" still works; the reminder and retry crons still report processed counts; any `42501` / `permission denied for table payment_…` in client error logs. The expected — and accepted — one is the agent-share reward path (D-6).
7. **Rollback:** the block in the file header. Part (a) restores the eight converted policies including their original **roles** - it reads both `qual` and `roles` back out of the twin rather than assuming `TO public` (QA-5) - but **not** their `WITH CHECK`, which a SELECT twin cannot carry (RC-5); take that from the query-2 export. Its `GRANT` should be **trimmed to what pre-check query 3 actually showed** before you run it: as written it hands all six privileges to both roles on all twelve tables. Part (a2) re-grants EXECUTE on `update_overdue_installments()` - only if something legitimately calls it as a non-service role, because it re-opens a platform-wide write path. Part (b) needs the query-2 export to recreate the dropped write-only policies. Rolling back re-opens the hole - prefer fixing forward.
8. **Tell RM/QA** it has been applied, with the post-check and step 5 output.

### 5.1 Pre-check query-2 export (captured 2026-09-21, before the apply)

✅ **Captured.** Read on production by the user in the Supabase SQL editor, read-only, immediately before the apply. **This is the only backup of the policies the migration dropped** (SA RC-2 — the SQL editor does not surface a script's `RAISE NOTICE` output, so the apply transcript is not a second copy). Part (b) of the rollback cannot be written without it.

24 rows, complete — under the editor's 100-row cap, so nothing is missing. It matches §1's table exactly: eight `FOR ALL` policies, ten write-only INSERT/UPDATE/DELETE policies for the shape sweep to drop, five SELECT policies, and the one service-role policy on `credit_transactions` (8 + 10 + 5 + 1 = 24). No drift, and no write-capable policy outside §1 — so both RC-3 pre-apply decisions cleared. On the read path: four tables (`credit_transactions`, `payment_invoices`, `payment_methods`, `payment_transactions`) already carried a standalone PERMISSIVE SELECT policy, and the other eight carried the `FOR ALL` policy that the conversion turns into one, so post-condition (a) could not abort on any of the twelve.

```json
[
  {"tablename":"credit_transactions","policyname":"Service role can manage all transactions","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"((auth.jwt() ->> 'role'::text) = 'service_role'::text)","with_check":null},
  {"tablename":"credit_transactions","policyname":"Users can insert their own transactions","permissive":"PERMISSIVE","cmd":"INSERT","roles":"{public}","qual":null,"with_check":"(auth.uid() = user_id)"},
  {"tablename":"credit_transactions","policyname":"Users can view own transactions","permissive":"PERMISSIVE","cmd":"SELECT","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"credit_transactions","policyname":"Users can view their own transactions","permissive":"PERMISSIVE","cmd":"SELECT","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_automation_executions","policyname":"Users can view their own automation executions","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_automation_rules","policyname":"Users can manage their own automation rules","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_events","policyname":"Users can view their own payment events","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_invoices","policyname":"Users can delete their own invoices","permissive":"PERMISSIVE","cmd":"DELETE","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_invoices","policyname":"Users can insert their own invoices","permissive":"PERMISSIVE","cmd":"INSERT","roles":"{public}","qual":null,"with_check":"(auth.uid() = user_id)"},
  {"tablename":"payment_invoices","policyname":"Users can view their own invoices","permissive":"PERMISSIVE","cmd":"SELECT","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_invoices","policyname":"Users can update their own invoices","permissive":"PERMISSIVE","cmd":"UPDATE","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_methods","policyname":"Users can delete their own payment methods","permissive":"PERMISSIVE","cmd":"DELETE","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_methods","policyname":"Users can insert their own payment methods","permissive":"PERMISSIVE","cmd":"INSERT","roles":"{public}","qual":null,"with_check":"(auth.uid() = user_id)"},
  {"tablename":"payment_methods","policyname":"Users can view their own payment methods","permissive":"PERMISSIVE","cmd":"SELECT","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_methods","policyname":"Users can update their own payment methods","permissive":"PERMISSIVE","cmd":"UPDATE","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_plan_installments","policyname":"Users can manage their own installments","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_plans","policyname":"Users can manage their own payment plans","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_processors","policyname":"Users can manage their own payment processors","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_reminders","policyname":"Users can manage their own payment reminders","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_transactions","policyname":"Users can delete their own transactions","permissive":"PERMISSIVE","cmd":"DELETE","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_transactions","policyname":"Users can insert their own transactions","permissive":"PERMISSIVE","cmd":"INSERT","roles":"{public}","qual":null,"with_check":"(auth.uid() = user_id)"},
  {"tablename":"payment_transactions","policyname":"Users can view their own transactions","permissive":"PERMISSIVE","cmd":"SELECT","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"payment_transactions","policyname":"Users can update their own transactions","permissive":"PERMISSIVE","cmd":"UPDATE","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null},
  {"tablename":"saved_payment_methods","policyname":"Users can manage their contacts saved payment methods","permissive":"PERMISSIVE","cmd":"ALL","roles":"{public}","qual":"(auth.uid() = user_id)","with_check":null}
]
```

**Every dropped policy's `with_check` is `(auth.uid() = user_id)` on the INSERT policies and `null` on the UPDATE/DELETE ones**, and every `qual` is `(auth.uid() = user_id)`. That is what rollback part (b) would have to recreate by hand, and it also settles SA RC-5: none of the eight converted `FOR ALL` policies carried a `with_check` distinct from its `qual` (all eight are `null`), so rollback part (a) restores exactly what was live.

### 5.2 Post-check queries (copy-paste, with expected results)

Run all five, read-only, after the apply. They are pre-check queries 1-4 plus the column-privileges query from the migration header's POST-CHECK block. The 2026-09-21 production output of each is in §5.3.

**P1 — RLS is still on and still not FORCEd**

```sql
SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
  'credit_transactions','payment_automation_executions','payment_automation_rules',
  'payment_events','payment_invoices','payment_methods','payment_plan_installments',
  'payment_plans','payment_processors','payment_reminders','payment_transactions',
  'saved_payment_methods')
ORDER BY c.relname;
```

> **Expect:** twelve rows, every one `rls_enabled = true`, `rls_forced = false`. Unchanged by the migration — this query is here to prove it did *not* touch RLS.

**P2 — no write-capable user policy left, and every table still readable**

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN (
  'credit_transactions','payment_automation_executions','payment_automation_rules',
  'payment_events','payment_invoices','payment_methods','payment_plan_installments',
  'payment_plans','payment_processors','payment_reminders','payment_transactions',
  'saved_payment_methods')
ORDER BY tablename, cmd, policyname;
```

> **Expect:** every row `cmd = SELECT`, with the single exception of `credit_transactions` / "Service role can manage all transactions" (`ALL`), which is deliberately out of scope. The eight converted policies appear as `"<original name> (read-only)"`. At least one PERMISSIVE SELECT row per table. **`saved_payment_methods` shows its twin as the 63-character `Users can manage their contacts saved payment methods (read-onl` — truncated, and that is correct, not drift** (see §5.3 and the migration header's IDENTIFIER TRUNCATION section). Precise claim (QA-7): what is proven absent is a write-capable policy whose `roles` include `public` / `anon` / `authenticated` — one granted only to some other role would survive, but is unreachable from a Supabase JWT.

**P3 — `anon` and `authenticated` hold SELECT and nothing else**

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
  AND table_name IN (
  'credit_transactions','payment_automation_executions','payment_automation_rules',
  'payment_events','payment_invoices','payment_methods','payment_plan_installments',
  'payment_plans','payment_processors','payment_reminders','payment_transactions',
  'saved_payment_methods')
ORDER BY table_name, grantee, privilege_type;
```

> **Expect:** exactly 24 rows (12 tables × 2 roles), every `privilege_type = SELECT`. Any INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER row means the REVOKE did not land — escalate. This is the query that actually proves the hole is closed; 24 rows also fits under the editor's 100-row cap, unlike the pre-check version.

**P4 — the SECURITY DEFINER overdue helper is no longer publicly executable (QA-2)**

```sql
SELECT has_function_privilege('anon',          'public.update_overdue_installments()', 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', 'public.update_overdue_installments()', 'EXECUTE') AS auth_exec;
```

> **Expect:** `false` / `false` (both were `true` before). `has_function_privilege` counts a privilege inherited from `PUBLIC`, which is exactly how this one was held, so a `false` here means the `FROM PUBLIC` revoke worked. If the function does not exist in this environment the query errors with `undefined_function` — that is fine; the migration skips the revoke in that case.

**P5 — no column-level write grant survives (QA-3, not optional)**

```sql
SELECT table_name, grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
  AND privilege_type <> 'SELECT'
  AND table_name LIKE ANY (ARRAY['payment%','credit_transactions','saved_payment_methods']);
```

> **Expect:** **zero rows.** P3 cannot see this: `has_table_privilege(…, 'INSERT')` returns false for a column-level grant and `REVOKE … ON <table>` does not remove one, so post-condition (c) inside the migration can pass with a column-level write path still open.

### 5.3 Applied to production — 2026-09-21

Applied by hand in the Supabase SQL editor on production by the user, after the §5.1 export was saved. The transaction committed; **no abort, no `NOTICE`-visible drift, no rollback**.

| Apply-guide step | Status |
|---|---|
| 1. Deploy order (no code first; `20261001` must be live) | ✅ Pre-check query 0 returned no write policy on `user_subscriptions` → `20261001` was already applied, so the in-transaction RC-1 guard passed |
| 2. Pre-check, with the query-2 export as a hard gate | ✅ Queries 0/1/2/3/4 run; the export is in §5.1; both RC-3 decisions cleared (every table would end with a PERMISSIVE SELECT policy — four already had one, the other eight get one from the conversion — and no write-capable policy outside §1) |
| 3. Apply | ✅ Committed on the first run |
| 4. Post-check (all five of §5.2) | ✅ Output below |
| 5. Browser read + PATCH proof | ⚪ Not run — and not needed, see the note below |
| 6. One-day watch | ⏳ **In progress** — the apply is same-day, so the window is not over. Nothing reported so far: no `42501` / `permission denied for table payment_…`, and the payments screens still list rows. The one expected breakage remains the agent-share reward path (D-6), unchanged. This needs no action from the user, only the absence of reports |
| 7. Rollback | n/a — not needed. But the post-check *did* surface a defect in the rollback block itself; see the truncation finding below |
| 8. Tell RM/QA | ✅ This section |

**Pre-check output (before the apply).**

- **Query 0 — `user_subscriptions` policies:** `Service role can manage all credits` (ALL), `Users can view own credits` (SELECT), `Users can view own subscription` (SELECT), `Users can view their own credits` (SELECT). No write policy left → `20261001` is live, R-1 / D-7 satisfied.
- **Query 1 — RLS state:** all twelve `rls_enabled = true`, `rls_forced = false`.
- **Query 2 — every policy:** §5.1, 24 rows, complete.
- **Query 3 — grants:** the Supabase SQL editor **truncated this output at its 100-row cap**, after `payment_plans` / `anon` / `INSERT`. Five tables were not displayed (`payment_plans` partially, plus `payment_processors`, `payment_reminders`, `payment_transactions`, `saved_payment_methods`). **Why that is acceptable and was not re-run:** the pattern is uniform on every table that *was* displayed — `anon` and `authenticated` each hold `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`, i.e. the Supabase default set, which is exactly the set the migration revokes and exactly the set the rollback's `GRANT` re-grants. Nothing downstream depends on the missing rows: the migration's `REVOKE` is unconditional and a REVOKE of a privilege not held is a no-op; post-condition (c) verifies the *end* state directly for all twelve tables and both roles with `has_table_privilege`; and the post-check P3 below (24 rows, all SELECT) measures the same twelve tables under the cap. So the rollback's `GRANT` needs no trimming (QA-5's "trim it to what query 3 showed" is satisfied by the uniform default set), and the only thing lost is a cosmetic before-picture of five tables.
- **Query 4 — `update_overdue_installments()`:** `anon_exec = true`, `auth_exec = true` — the QA-2 hole, confirmed open.

**Post-check output (after the apply).**

- **P1:** twelve rows, `rls_enabled = true`, `rls_forced = false`. Unchanged. ✅
- **P2:** 14 rows. Every one `cmd = SELECT` except `credit_transactions` / "Service role can manage all transactions" (`ALL`), which is out of scope by design. All eight twins present. ✅

  ```json
  [
    {"tablename":"credit_transactions","policyname":"Service role can manage all transactions","cmd":"ALL","roles":"{public}"},
    {"tablename":"credit_transactions","policyname":"Users can view own transactions","cmd":"SELECT","roles":"{public}"},
    {"tablename":"credit_transactions","policyname":"Users can view their own transactions","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_automation_executions","policyname":"Users can view their own automation executions (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_automation_rules","policyname":"Users can manage their own automation rules (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_events","policyname":"Users can view their own payment events (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_invoices","policyname":"Users can view their own invoices","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_methods","policyname":"Users can view their own payment methods","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_plan_installments","policyname":"Users can manage their own installments (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_plans","policyname":"Users can manage their own payment plans (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_processors","policyname":"Users can manage their own payment processors (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_reminders","policyname":"Users can manage their own payment reminders (read-only)","cmd":"SELECT","roles":"{public}"},
    {"tablename":"payment_transactions","policyname":"Users can view their own transactions","cmd":"SELECT","roles":"{public}"},
    {"tablename":"saved_payment_methods","policyname":"Users can manage their contacts saved payment methods (read-onl","cmd":"SELECT","roles":"{public}"}
  ]
  ```

  **24 rows before → 14 after**, and the arithmetic is exact: ten write-only policies dropped (the DELETE/INSERT/UPDATE triplets on `payment_invoices`, `payment_methods` and `payment_transactions`, plus the INSERT on `credit_transactions`), and the eight `FOR ALL` policies converted 1-for-1, which does not change the count. 24 − 10 = 14. Table by table the delta matches §1 exactly.
- **P3:** 24 rows, every one `SELECT`. **No write privilege remains on any of the twelve tables for either role.** ✅ This is the measurement that proves the hole is closed.
- **P4:** `anon_exec = false`, `auth_exec = false`. ✅ The QA-2 function is no longer callable from the browser.
- **P5:** zero rows. ✅ No column-level write grant.

**On §5 step 5 (the browser PATCH proof) — why nothing more is owed.** The proof it was designed to produce is "a write from a signed-in session gets `42501 permission denied`". P3 measures the *cause* of that 42501 directly and exhaustively: neither `anon` nor `authenticated` holds INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any of the twelve tables, P5 confirms no column-level grant slipped through, and P2 confirms no write-capable policy survives either. With no grant *and* no policy, PostgREST has nothing left to permit. The browser check remains the better first move on a *future* apply in a fresh environment (it catches a mistake end-to-end), but re-running it here would only re-derive what P2/P3/P5 already state. **No further live verification is required for this change.**

**The truncation finding (defect in the ROLLBACK, fixed in this branch).** Look at P2's last row: the `saved_payment_methods` twin is `Users can manage their contacts saved payment methods (read-onl` — **63 characters, not the 65 the migration concatenates**. Postgres caps identifiers at `NAMEDATALEN-1 = 63` bytes and truncates silently.

| | |
|---|---|
| **Is the lock-down affected?** | **No.** The policy was created, is `FOR SELECT`, carries the original `USING (auth.uid() = user_id)` and the original roles, and is enforcing. Only its *name* is shorter. |
| **What was broken** | The header's ROLLBACK block part (a). It looked the twin up with `p.policyname = r.pol \|\| ' (read-only)'` — a 65-character string that can never equal a stored 63-character name — so for `saved_payment_methods` it would have raised `no read-only twin for … on saved_payment_methods` and restored nothing. **That one table could not be rolled back by the scripted path.** |
| **The fix (this branch)** | The lookup and the subsequent `DROP` both use `twin := left(r.pol \|\| ' (read-only)', 63)`, which reproduces exactly what Postgres stored — and is a no-op for the other seven twins (51–58 characters), so one expression is correct for all eight. **Why not a prefix match** (`policyname LIKE r.pol \|\| '%'`): it is not unambiguous. If a forward run were ever interrupted between the `CREATE` and the `DROP`, the writable **original** is still present and matches the same prefix, and the rollback would read *its* `qual` and then drop it. Exact-match-on-truncated cannot pick the wrong row. |
| **The forward block** | Still compares against the untruncated `newname` — and **cannot be changed**: this migration is applied to production, so only its comment block is editable (this branch touches nothing between `BEGIN;` and `COMMIT;`; verified with a diff). The consequence is bounded and **fails closed**: re-running the file on an environment where it is already applied finds neither the original (dropped) nor the twin (stored truncated) for `saved_payment_methods` and aborts the whole transaction with `policy "…" not found … live schema has drifted`. The other seven take the `already converted` path, and the abort discards everything, so the re-run stays the no-op it is meant to be — only the message is wrong about the cause. Documented in the migration header's new `IDENTIFIER TRUNCATION` section and in the abort table interpretation below. |
| **The general hazard** | The suffix `' (read-only)'` is 12 bytes, so **any base name longer than 51 bytes** produces a truncated twin. The pattern to use next time: compute the twin name **once** as `left(<name> \|\| <suffix>, 63)` and use that single value for the `CREATE`, the idempotency lookup, the `DROP` **and** the rollback, so all four agree with what Postgres actually stores. (`left()` counts characters; all names here are ASCII so characters = bytes. A non-ASCII name would need a byte-aware truncation — Postgres truncates on a character boundary, never mid-character.) Pinned by test T-20. |

> **Reading the §5 step-3 abort table after this finding:** the row `policy "…" not found … live schema has drifted` has a second, benign cause on a **re-run of an already-applied environment** — `saved_payment_methods` and its truncated twin. That is not drift and needs no action; it means the table is already converted. Every other table named by that message still means real drift.

## 6. Test plan

`lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` (static, no DB).

| # | Test | Result |
|---|---|---|
| T-1 | One transaction; `lock_timeout` / `statement_timeout` set before the first `DROP` | ✅ |
| T-2 | Fails closed on RLS off, FORCE RLS, or a missing table — before anything is dropped | ✅ |
| T-3 | Each of the eight ALL policies is converted to a `(read-only)` SELECT twin with the live roles and `qual`, created **before** the original is dropped; the file never creates a write policy | ✅ |
| T-4 | Refuses to guess on drift (missing policy, wrong cmd, non-PERMISSIVE, NULL qual); re-running an applied file is a no-op | ✅ |
| T-5 | The write-only sweep is shape-based and excludes service-role, SELECT and role-scoped policies; `billing_events`, `boost_pack_purchases` and `user_subscriptions` are never named | ✅ |
| T-6 | One REVOKE, all twelve tables, both roles, six privileges, never SELECT; no `GRANT` in the body | ✅ |
| T-7 | No DDL on tables, no data statements, no function/trigger creation | ✅ |
| T-8 | Post-conditions cover all twelve tables: PERMISSIVE SELECT survives, `authenticated` keeps SELECT, no write-capable user policy, no write privilege (`has_table_privilege`, which counts PUBLIC grants) | ✅ |
| T-9 | Header documents pre-check (listing **every** policy), post-check, rollback, and is honest that the write-only policies are not recoverable from the file | ✅ |
| T-10 | Header states "CODE THAT MUST SHIP FIRST: NONE" and the 20261001 ordering constraint | ✅ |
| T-11 | Source guard: no `'use client'` module writes any of the twelve tables (per-table) | ✅ |
| T-12 | Source guard: `RewardService` has exactly the two documented browser call sites | ✅ |
| T-13 | Source guard: every payment repository defaults to `supabaseServer`; the five payment services are service-role singletons; the two payment crons build no user-scoped client | ✅ |
| T-14 | Source guard: every `settleInvoicePaid(…)` call site passes `supabaseServer` (the injected-client / W-4 shape) | ✅ |
| T-15 | The `20261001` ordering guard is present, runs before any DDL, and the file only *reads* `user_subscriptions` (no DROP POLICY / REVOKE / CREATE POLICY naming it) - SA RC-1 | ✅ |
| T-16 | The conversion logs the original `WITH CHECK` alongside `qual` (SA RC-5) | ✅ |
| T-17 | Source guard: `new CreditService(` has exactly one construction site and it passes `supabaseServer` (SA RC-6) | ✅ |
| T-18 | The function revoke is present with `FROM PUBLIC`, guarded by `to_regprocedure`, never touches the function body, and has its own in-transaction post-condition (QA-2) | ✅ |
| T-19 | The RC-1 ordering guard covers INSERT as well as UPDATE (QA-4) | ✅ |
| T-20 | The ROLLBACK's twin lookup uses `left(<name> || ' (read-only)', 63)` for both the SELECT and the DROP, the untruncated forms are gone, and the 63-byte hazard is documented — plus the data itself: exactly one of the eight twins exceeds 63 characters (added 2026-09-21 after the production post-check) | ✅ |

34/34 pass (`npx jest lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts`).

Not covered by static tests, by design: the live effect (§5 steps 4–5 — the post-check queries and the browser check). Both are now recorded in §5.3.

## 7. SA Review Notes

**Code Review by SA — 2026-09-21**
**Status:** 🔄 Fix Required

Reviewed: the migration, the static test (run locally — 26/26 pass), and this workplan, against the `20261001` precedent. The SQL logic is sound and I found no defect that would produce a wrong end-state. Every required change below lands in the *apply guide*, the *record*, or two small guards — but on a hand-applied P0 migration the apply guide **is** the deliverable, so they block.

### Rulings on the questions asked

| # | Question | Ruling |
|---|---|---|
| D-1 | Dynamic conversion of the eight `FOR ALL` policies | **Correct and safe.** Verified line by line below |
| D-2 | Shape-based sweep instead of guessed names | **Correct call.** A `DROP … IF EXISTS` on a wrong name is a silent no-op that leaves a P0 open while reporting success. Shape matching is the only option that is honest about not knowing the names |
| R-7 | Rollback story for the dropped write-only policies | **Acceptable — conditional on RC-2.** As written, half the backup story is false |
| D-6 | Leaving the browser `RewardService` path broken | **Approved — conditional on RC-1.** Same accepted degradation as the precedent; awarding credits from the browser *is* the vulnerability |

### Verification of D-1 (where a mistake becomes a read outage)

| Check | Result |
|---|---|
| Policy-name injection | ✅ `%I` (`quote_ident`) on every name and table, in both the CREATE and the DROP |
| `qual` injection | ✅ Acceptable. `%s` is raw, but `qual` is `pg_get_expr` output from `pg_catalog`, and writing it requires table ownership — the trust boundary sits above the attacker. Worth one comment line saying so |
| `qual` fidelity | ✅ `pg_get_expr` → `CREATE POLICY … USING (…)` round-trips: the deparse is schema-qualified against the same session's `search_path` that re-parses it. The extra parens from `format` are inert |
| `roles` reconstruction | ✅ `string_agg(quote_ident(x), ', ')` over `unnest(roles)`. `pg_policies.roles` renders PUBLIC as `{public}`; `quote_ident('public')` returns it unquoted; `TO public` is PUBLIC. Named roles round-trip identically |
| `with_check` | ⚠️ Silently discarded. **Correct** for the twin (a `FOR SELECT` policy cannot carry WITH CHECK) — but it breaks rollback fidelity. See RC-5 |
| Ordering | ✅ CREATE before DROP, so no instant exists with no read policy — and it is one transaction regardless |
| Name already ending in "(read-only)" | ✅ Fails closed. If both the original and a same-named twin existed, `CREATE POLICY` raises `duplicate_object` and the whole transaction aborts. Nothing is silently overwritten |
| Re-runnability | ✅ Step 1 `CONTINUE`s on "original gone, twin present"; step 2 drops 0; the REVOKE is a no-op; the post-conditions still pass. Genuinely idempotent |
| Drift | ✅ Refuses to guess: missing-with-no-twin, `cmd <> ALL`, non-PERMISSIVE and `qual IS NULL` each `RAISE EXCEPTION`. `SELECT … INTO pol` + `IF NOT FOUND` is the right plpgsql idiom |

**Read-outage risk is materially lower than §4 claims.** I swept the repo for RLS-respecting *readers* of the twelve tables. The only table touched anywhere by a browser client or a user-cookie server client is `credit_transactions` (`components/settings/BillingSettings.tsx`, `components/settings/UsageAnalytics.tsx`, `components/v2/settings/BillingSettingsV2_NEW.tsx` — all `.select()`; `app/api/user/data-export/route.ts` and `app/api/stripe/sync-subscription/route.ts` use the service role for this table). The other eleven are read exclusively through service-role server routes, which bypass RLS. The eight `(read-only)` twins are therefore load-bearing for **zero** tables today. Keep the conversion — it is cheap, correct, and preserves the option of RLS-scoped reads — but R-2's "Certain, if done naively" is not supported by the code. See RC-3.

### Blast radius — independently re-swept, and it holds

I re-ran the sweep from scratch (write op within 200 chars of `.from('<table>')` across `app`/`lib`/`components`/`hooks`; then every injected-client writer traced to **all** construction sites; then `.rpc(`; then browser and user-cookie clients cross-referenced against the table names). **Conclusion confirmed: no RLS-respecting writer exists**, with the one documented `RewardService` exception. Specifics worth recording:

- `new CreditService(supabaseServer)` at `app/api/run-agent/route.ts:94` is the **only** construction site — the W-4 shape is clean.
- `paymentReminderService` / `paymentRetryService` / `paymentAutomationEngine` are `supabaseServer` singletons; the four claim/reap RPCs are reached only through them.
- Every repository construction site defaults to or passes `supabaseServer`, including the two injected `new PaymentInvoiceRepository(this.supabase)` sites in Insights (read-only anyway).
- `app/api/stripe/sync-subscription/route.ts` builds a user-cookie client, but every write there — including all three `credit_transactions` statements — goes through `supabaseAdmin`. The cookie client is used for auth only.
- Purge reaches these tables only through `purge_business_data` via `BusinessPurgeRepository`, which defaults to `supabaseServer`.

Two writers my sweep found are **missing from §3** (both trace clean, so the conclusion is unchanged) — see RC-6.

### Required changes

| # | Item | Priority |
|---|---|---|
| **RC-1** | **Enforce R-1 in the transaction, not in a human's reading comprehension.** R-1 is the only risk in this change with an irreversible *data* consequence (balance credited, no ledger row), and its entire mitigation today is a comment plus pre-check step 0 — which is itself a weak, name-based test. Add to the first `DO $$` guard block: abort if `has_table_privilege('authenticated', 'public.user_subscriptions', 'UPDATE')` is true, naming `20261001` as the file to apply first. That privilege is the precise condition that lets the balance upsert land. Prod is already safe, but this file will be applied to a fresh environment (the Preview env in `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md`) where the order is not guaranteed. Update the test's `expect(body).not.toContain('user_subscriptions')` to assert instead that the file only *reads* `user_subscriptions` (no `DROP POLICY` / `REVOKE` naming it), and keep pre-check step 0 as the human-readable version | **High** |
| **RC-2** | **Stop claiming the apply transcript is a backup.** The Supabase SQL editor does not surface `RAISE NOTICE` output from a script, so for the policies dropped by the step-2 sweep the pre-check query-2 export is not "the primary backup" — it is the **only** one. Required: (a) delete "the file logs every policy it drops with RAISE NOTICE, so the apply transcript is a second copy" from the header ROLLBACK (b), and the same claim from R-7 — keep the NOTICEs, just do not rely on them; (b) turn §5 step 2 into a hard gate: save query 2's output to a named file, paste it into this workplan under §5, and state that the apply must not start until it is there. "Export it" is not a forcing function on a P0 | **High** |
| **RC-3** | **Turn post-condition (a) into a pre-apply decision.** For the four tables whose policies are dropped wholesale (`credit_transactions`, `payment_invoices`, `payment_methods`, `payment_transactions`), "a PERMISSIVE SELECT policy must survive" is not a safety net — it is a *liveness* hazard: if the live schema has no separate SELECT policy on, say, `payment_methods`, the migration aborts on a P0 for a read path that (per the reader sweep above) nobody uses. Required: (a) add a pre-check instruction to answer this from query 2 **before** applying — "confirm each of the twelve tables has at least one PERMISSIVE SELECT policy; if any does not, stop and send to the Dev"; (b) fix the abort-table row that asserts "Reads would have broken" — demonstrably true only for `credit_transactions`; (c) restate R-2's likelihood with the evidence above | **High** |
| **RC-4** | **Guard the `FROM PUBLIC` remedy.** The abort table tells the user to "re-run the REVOKE with `FROM PUBLIC`". `bypassrls` does **not** bypass table privileges, so if `service_role`'s write access on any of these tables came via PUBLIC, that remedy breaks the Stripe webhook — a money path — and no post-condition here would notice. Required: before running it, capture `service_role`'s rows from `information_schema.role_table_grants` for the twelve tables and confirm the grants are explicit; re-verify after | **Medium** |
| **RC-5** | **`with_check` and rollback fidelity.** Rollback part (a) recreates `FOR ALL … USING (qual)` with no WITH CHECK. If any of the eight originals carried a `with_check` distinct from `qual`, the rollback restores a *different* policy than was live. Required: say so in the ROLLBACK block and point at the query-2 export for the original `with_check`; and add `with_check` to the conversion `RAISE NOTICE` alongside `qual` | **Medium** |
| **RC-6** | **Two writers missing from §3.** `lib/services/CreditService.ts` writes `credit_transactions` on an **injected** client (the exact W-4 shape that hid in the previous cycle) and `lib/services/PaymentReminderService.ts` writes `payment_plan_installments`. Both are clean, but `CreditService` is the single most valuable name to have in that table. Required: add both to §3, and add a `new CreditService(` construction-site assertion to `paymentTablesWriteLockdownMigration.test.ts` — the existing one lives in `userSubscriptionsWriteLockdownMigration.test.ts` and could be deleted without this file noticing | **Medium** |
| **RC-7** | **`payment_methods` (the sixth question).** It has no writer *and no reader anywhere in the repo* — zero `.from('payment_methods')` hits — and `lib/business-os/purge/descriptors.ts:175` records that `2026-08-14_drop_payment_methods.sql` was never applied. Answer: it does not change the migration (revoking writes on an unused table is free, and keeping it in the set is right for uniformity), but it makes this table the **most likely** source of an RC-3 abort, and it is a drop candidate. Required: one line each in §1 and §4 saying both | **Low** |

### Optimisation Suggestions (non-blocking)

- Replace `pol record` with typed locals (`pol_roles name[]`, `pol_qual text`, `pol_cmd text`, `pol_permissive text`). `FROM unnest(pol.roles)` on a field of an untyped `record` relies on plpgsql resolving the field type at first-execution plan time. It does resolve here (the record is assigned first) and a failure would abort harmlessly — typed locals simply remove the question.
- The `service_role` exclusion is applied *identically* in the step-2 sweep and in post-condition (b), so (b) cannot catch what step 2 deliberately skipped: a policy such as `USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role')` with `cmd = ALL` and roles `{public}` survives both, silently. The grant revoke is the real control in that case — worth a header line so the next reader does not mistake (b) for an independent check.
- Step 2 sweeps only `cmd IN (INSERT, UPDATE, DELETE)`, so an **unnamed** `cmd = ALL` user policy survives steps 1 and 2 — but post-condition (b) includes `'ALL'` and aborts. Good design; add a comment so nobody "simplifies" (b) away later.
- `has_table_privilege(…, 'INSERT')` returns false for a *column-level* grant, and `REVOKE … ON <table>` does not remove one. Very unlikely on Supabase defaults; an `information_schema.column_privileges` line in the POST-CHECK would close it.
- This workplan is over the ~150-line ToC threshold in CLAUDE.md § Documentation Standards.

### Approved as-is

- One transaction; `lock_timeout` / `statement_timeout` set before the first DDL; fail-closed on RLS-off, FORCE RLS and missing table; policies **and** grants; `anon`'s SELECT kept; `billing_events` / `boost_pack_purchases` out of scope; the SECURITY INVOKER trigger analysis; and the browser PATCH proof in §5.5 — including the `Content-Type` / `Prefer` detail, which is the difference between a real proof and a 415.
- No application code in this change, and no Zod / repository / logging surface touched. `lib/credits/rewardService.ts` is full of `console.*` but is **not** modified by this branch, so the CLAUDE.md § Logging rule does not attach — do not widen the diff for it.

### Code Approved for QA: **No**

Apply RC-1 … RC-7, then re-submit. RC-1, RC-5 and RC-6 are small file edits; RC-2, RC-3, RC-4 and RC-7 are apply-guide and record corrections. Nothing in the SQL's logic needs to change.


### SA Re-review — 2026-09-21 (delta only)

**Status:** ✅ **Approved — ship.** RC-1 … RC-7 are all applied, QA-2 … QA-7 spot-checked, 33/33 tests pass locally. Nothing below blocks.

**QA-2 (`update_overdue_installments()`) — correct, and the right call.** I confirmed the function at `supabase/migrations/20260723_enhance_payments.sql:406`: `SECURITY DEFINER`, no `SET search_path`, and an `UPDATE payment_plan_installments SET status='overdue' WHERE status='pending' AND due_date < CURRENT_DATE` with **no tenant predicate**. A table lock-down genuinely cannot close it — a definer function ignores both RLS and the step-3 revoke — so it belongs in this file.

| Check asked | Finding |
|---|---|
| Can `REVOKE ALL … FROM PUBLIC, anon, authenticated` break the owner? | **No.** The owner is not named; owner privileges are implicit and untouched |
| …break `service_role`? | **No operational risk, but the claim needs one word of care.** If the function's ACL carries Supabase's default-privilege grants, `service_role`'s EXECUTE is explicit and survives. If the ACL is still NULL (plain default: owner + PUBLIC), then `service_role`'s EXECUTE came *via PUBLIC* and this revoke removes it too. Either way nothing breaks, because the caller set is empty — I re-verified: zero `.rpc('update_overdue_installments')` hits anywhere, the only other references are the definition and `scripts/check-migrations.sql:448`, and `app/api/cron/payment-reminders/route.ts:75` does the job through `paymentReminderService.processOverdueItems()` on the service role. **Non-blocking:** add `has_function_privilege('service_role', …)` to pre-check query 4 and the post-check so the answer is measured rather than assumed. Do **not** add a post-condition asserting `service_role` keeps EXECUTE — in the NULL-ACL case that would abort the migration over a function nobody calls |
| …break a legitimate SECURITY DEFINER path? | **No.** `SECURITY DEFINER` governs the privileges the body runs *with*, not who may call it. Revoking EXECUTE only removes callers, and the only caller class removed is the browser |
| Is `to_regprocedure` the right idempotency shape? | **Yes.** It returns NULL instead of erroring for a missing function (unlike `to_regproc`, and unlike a bare `REVOKE`, which errors), and the argument is both schema- and signature-qualified so there is no `search_path` or overload ambiguity. `REVOKE` of a privilege not held is a no-op, so re-running is clean |
| Can post-condition (d) pass vacuously? | **No.** It is skipped only when the function does not exist — which is the case where there is nothing to protect. When it exists, `has_function_privilege` counts privileges inherited from PUBLIC *and* from role membership, which is exactly how this one was held, so it cannot be satisfied by the revoke having silently done nothing |
| Is this outside RC-4? | **Yes, entirely.** RC-4 warned against a `FROM PUBLIC` revoke on a **table** whose `service_role` access might be PUBLIC-sourced, because `bypassrls` does not bypass table privileges and the Stripe webhook demonstrably writes those tables. Here it is a function privilege, `bypassrls` is irrelevant, and the verified caller set is empty. `FROM PUBLIC` is also load-bearing here — naming only the two roles would not remove a PUBLIC grant, which is the whole reason the hole existed |

**QA-5 (rollback part a):** correct fix — reading `p.roles` back from the twin and rebuilding `TO %s` makes the rollback a true inverse, since the conversion preserves `roles` as faithfully as `qual`. The added "trim that GRANT to what query 3 showed" note closes the other half honestly.

**QA-4 (RC-1 guard → `UPDATE OR INSERT`):** correct, and the right direction of caution. The reward path is an upsert, so for a user with no `user_subscriptions` row an INSERT grant alone produces a credited balance. No false-abort risk: `20261001` revokes both, so after it both predicates are false.

**QA-3 / QA-6 / QA-7:** doc and abort-table changes, consistent with RC-2/RC-3. Pre-check query 2 is now an explicit hard gate naming `payment_methods` as the likeliest abort; the column-privilege query is in the post-check; the `FROM PUBLIC` remedy is guarded.

### Follow-up found while checking QA-2 (not a blocker — do not expand this file)

QA-2's mechanic almost certainly repeats. Six sibling definer functions revoke with `FROM anon, authenticated` and **never** `FROM PUBLIC` — which does not remove a default PUBLIC grant, so `has_function_privilege('anon', …)` is likely still **true** for all of them:

- `claim_due_payment_reminders` / `reap_stale_payment_reminders` (`2026-08-14_payment_reminders_claim.sql:109-110`)
- `claim_due_payment_automation_executions` / `reap_stale_payment_automation_executions` (`2026-08-14_payment_automation_executions_claim.sql:123-124`)
- `claim_due_daily_briefings` / `reap_stale_daily_briefings` (`20260911_daily_briefing.sql:192-193`)
- `claim_due_lead_responses` / `reap_stale_lead_responses` (`20260914_lead_responses.sql:183-184`)

(`20260915a_purge_schema_introspect.sql:181` gets it right — `FROM PUBLIC` first.) These claim queue rows platform-wide, so browser-callable would be the same class of bug. **MEASURED 2026-09-21 and confirmed, and far wider than eight: 59 of the 60 SECURITY DEFINER functions in `public` are executable by `anon`, 50 of them callable through PostgREST. Triage, both measurement queries and the fix shape are in [§10](#10-follow-up-security-definer-functions-executable-by-anon--queued-p1) — that is the single source for this item; everything below here is the original recommendation, kept for the record.** **Recommend:** one read-only measurement by the user — `has_function_privilege('anon', '<fn signature>', 'EXECUTE')` across those eight — and if true, a separate P1 migration. Raise it as its own item; keep this file scoped.

## 8. QA Testing Report

**QA — 2026-09-21**
**Test mode:** full
**Strategy used:** A (Jest static/source guards — run: 32/32 pass, 229/229 for `lib/repositories/__tests__`) + E (line-by-line SQL reasoning and an independent repo-wide blast-radius sweep). **No DB access of any kind** — every live-schema fact below is the user's read-only prod output already recorded in §1. No dev server, no production-code edits, nothing committed.
**Focus:** security, schema, api
**Skipped:** live SQL execution and the browser PATCH proof (§5.5) — cannot be run without DB/prod access; they remain the user's post-apply gate.
**Input source:** QA judgment (prompt directive)

### Verdict: **PASS** — no High-severity defect. Three Mediums are recorded below; none of them changes the SQL's end state, and all three are things the migration *does not* close rather than things it gets wrong.

### 8.1 End state, traced statement by statement

Against the 12-table live state in §1. Order: guards → step 1 (convert 8) → step 2 (sweep) → step 3 (REVOKE) → step 4 (post-conditions) → COMMIT.

| Table | Policies after | Privileges after (`anon`/`authenticated`) | Owner reads lost? | Write path left? |
|---|---|---|---|---|
| credit_transactions | INSERT policy **dropped**; any pre-existing SELECT policy + the service-role policies untouched | SELECT only | No — no SELECT policy is dropped anywhere in the file | No user path |
| payment_automation_executions | ALL → `… (read-only)` SELECT twin, same `qual`, same roles | SELECT only | No | No |
| payment_automation_rules | ALL → SELECT twin | SELECT only | No | No |
| payment_events | ALL → SELECT twin | SELECT only | No | No |
| payment_invoices | INSERT/UPDATE/DELETE policies **dropped** | SELECT only | No | No |
| payment_methods | INSERT/UPDATE/DELETE policies **dropped** | SELECT only | No (nothing reads it — RC-7) | No |
| payment_plan_installments | ALL → SELECT twin | SELECT only | No | ⚠️ `update_overdue_installments()` — see QA-2 |
| payment_plans | ALL → SELECT twin | SELECT only | No | No |
| payment_processors | ALL → SELECT twin | SELECT only | No | No |
| payment_reminders | ALL → SELECT twin | SELECT only | No | No |
| payment_transactions | INSERT/UPDATE/DELETE policies **dropped** | SELECT only | No | No |
| saved_payment_methods | ALL → SELECT twin | SELECT only | No | No |

**No table loses owner reads.** The file contains no `DROP POLICY` that can hit a `cmd = SELECT` policy: step 1 drops only the eight it has just re-created a SELECT twin for (and refuses if `cmd <> 'ALL'`), step 2's predicate is `cmd IN ('INSERT','UPDATE','DELETE')`. For the four tables whose policies are dropped wholesale, the dropped policies are write-only — an `INSERT` policy has `qual IS NULL` (only `with_check`), and an `UPDATE` policy's `USING` governs row selection *for the update*, never a `SELECT`. Nothing readable is lost. Post-condition (a) is a tripwire, not the mechanism.

**Does a write path survive?** For the user roles, no — `has_table_privilege` in post-condition (c) is checked for all 12 tables × 2 roles × 6 privileges and counts privileges inherited from `PUBLIC`, so a policy that step 2 deliberately skipped (the `service_role`-mentioning one, or an unnamed `cmd = ALL` one) is either unreachable or aborts the transaction. Three residual paths survive by design or by omission: `service_role` and the table owner (intended); a **column-level** write grant (invisible to `has_table_privilege` and not removed by `REVOKE … ON <table>` — QA-3); and the SECURITY DEFINER `update_overdue_installments()` (QA-2).

### 8.2 RC-1 — the ordering guard

✅ **Correct, and it cannot pass vacuously.** It sits in the first `DO $$` block, above every DDL statement (verified textually and pinned by two tests). `has_table_privilege('authenticated','public.user_subscriptions','UPDATE')` **raises** `undefined_table` if the table is absent and `undefined_object` if the role is absent, so a missing object aborts rather than skipping. It counts privileges inherited from `PUBLIC`, so a `GRANT … TO PUBLIC` cannot hide from it. The logic is sound because the grant is a *necessary* condition for the browser upsert to land — if it is gone, the balance cannot move regardless of policy state, so a pass is a real proof of safety. Re-verified the premise in source: `lib/credits/rewardService.ts` upserts `user_subscriptions.balance` at :177, inserts `credit_transactions` at :202, and returns `success: true` with `'Credits awarded but transaction logging failed'` on ledger failure — exactly as the header describes. The only gap is QA-4 below (`INSERT`-but-not-`UPDATE`).

### 8.3 The dynamic ALL→SELECT conversion — re-derived independently

| Property | QA finding |
|---|---|
| Identifier quoting | ✅ `%I` on policy name and table in both `CREATE` and `DROP`; roles via `string_agg(quote_ident(x), ', ')`. No unquoted caller-controlled identifier anywhere |
| PUBLIC vs named roles | ✅ `pg_policies.roles` renders a no-`TO` policy as `{public}`; `quote_ident('public')` returns it **unquoted** (`PUBLIC` is not in `kwlist.h`), and gram.y's `RoleSpec` maps the bare string `public` to `ROLESPEC_PUBLIC`. `TO public` is PUBLIC. Named roles round-trip byte-identically. An empty `roles` array would make `rolelist` NULL → syntax error → abort (fails closed, not silent) |
| `qual` fidelity | ✅ `pg_get_expr` output re-parsed in the same session/`search_path` that produced it; `auth.uid()` comes back schema-qualified, column refs resolve against the same relation. The extra parens from `USING (%s)` are inert. A `%` inside `qual` is safe — `format` interprets `%` only in the format string, never in an argument |
| `%s` for `qual` | ✅ Acceptable trust boundary: writing a policy `qual` requires table ownership, which is above the attacker. Documented in-file |
| CREATE before DROP | ✅ Per policy, inside one transaction — there is no instant, even internally, with no read policy |
| Re-runnability | ✅ 2nd run: `SELECT … INTO` + `IF NOT FOUND` → twin present → `RAISE NOTICE` + `CONTINUE`; step 2 matches 0 rows; `REVOKE` of an unheld privilege is a no-op; post-conditions still pass. Genuinely idempotent |
| Name already ending in "(read-only)" | ✅ Fails closed. If original **and** same-named twin both exist, `CREATE POLICY` raises `duplicate_object` and the whole transaction rolls back — nothing is overwritten. A live `cmd = ALL` policy *named* `… (read-only)` is not in the eight, is skipped by step 2 (`ALL`), and is caught by post-condition (b) → abort |
| Discarded `with_check` | ✅ For the twin: a `FOR SELECT` policy cannot carry one, and read semantics are unaffected. Where the original had no `WITH CHECK`, Postgres was reusing `USING` as the check, so nothing at all is lost. Only *rollback* fidelity is affected — logged per RC-5 and pointed at the query-2 export. See QA-5 for the remaining rollback gap |
| Drift handling | ✅ Missing-and-no-twin, `cmd <> 'ALL'`, non-`PERMISSIVE`, `qual IS NULL` each `RAISE EXCEPTION`. `SELECT … INTO` + `IF NOT FOUND` is the correct plpgsql idiom here (the enclosing `FOR` loop does not clobber `FOUND` mid-iteration) |
| plpgsql mechanics | ✅ Every `RAISE` has matching placeholder/argument counts (3/3, 5/5, 3/3, 2/2, 3/3); `name[]`/`text` typing is right; `name = text` and `name[] && name[]` operators exist; `has_table_privilege(text, text, text)` resolves via the implicit `text→name` cast — the identical call shape is already live in the applied `20261001` precedent |

### 8.4 The shape-based sweep (step 2) — the unrecoverable one

**Over-match:** cannot hit a `SELECT` policy (`cmd IN ('INSERT','UPDATE','DELETE')`), cannot hit a `RESTRICTIVE` policy (whose removal would *loosen* security), cannot hit a role-scoped policy (`roles && {public,anon,authenticated}`), and cannot hit a service-role policy that either is granted `TO service_role` or names `service_role` in `qual`/`with_check`. The one theoretical over-match is a service-role policy that is `TO public` **and** expresses its role test *without the literal string* `service_role` (e.g. `auth.jwt()->>'role' <> 'authenticated'`) — that policy would be dropped. The pre-apply gate for it is the RC-3 instruction in §5 step 2 ("is any write-capable policy present that is not in §1's table? stop and send to the Dev"), which is the only defence available and is correctly positioned *before* the apply.
**Under-match:** an unnamed `cmd = ALL` user policy is skipped by step 2 but aborts on post-condition (b) — the deliberate asymmetry, correctly commented. A write policy scoped to a role outside `{public, anon, authenticated}` survives both step 2 and (b), but is unreachable from a Supabase JWT (which maps only to `anon`/`authenticated`) and its role keeps no grants this file cares about. A `service_role`-mentioning *user* policy survives both — the header says so explicitly and correctly identifies the grant revoke as the real control there; post-condition (c) proves it.
**Scope:** newly pinned by a test — without the `p.tablename IN (…)` clause the same query would drop the owner write policy of every table in `public`. I confirmed by mutation that removing the clause makes the new test fail.

### 8.5 Post-conditions — do they fail closed?

Yes, with two caveats already stated above. All four checks are inside the same transaction, after the `REVOKE` and before `COMMIT` (now pinned by a test, mutation-verified). (a) requires a `PERMISSIVE` SELECT policy — correctly insisting on PERMISSIVE, since a RESTRICTIVE-only SELECT policy passes a naive "a SELECT policy exists" test and still lets no row through. (b) aborts on any leftover write-capable user policy including `cmd = ALL`. (c) aborts on any of six write privileges for either role and counts PUBLIC inheritance, with the `FROM PUBLIC` remedy correctly gated behind RC-4's `service_role` grant check. **The transaction can still commit with a write path open in exactly two cases:** a column-level write grant (QA-3), and `update_overdue_installments()` (QA-2). Neither is detectable by anything in the file.

### 8.6 Blast radius — re-swept independently, 2026-09-21

Method (mine, not the Dev's or SA's): a script enumerating every `.from('<table>')`/`.from("<table>")` occurrence for all twelve tables across `app`, `lib`, `components`, `hooks`, `scripts`, classifying each *occurrence* (not file) as read or write and each file by the client it imports; then tracing every injected-`SupabaseClient` consumer to all construction sites; then `.rpc(`; then all SQL functions and triggers that write the twelve tables, with their `SECURITY` mode and `EXECUTE` grants.

**Confirmed:** every application writer is `supabaseServer` / `supabaseAdmin`, and the sole RLS-respecting writer is `lib/credits/rewardService.ts:202` reached from exactly the two documented agent pages (re-verified against `origin/main`, where both lines still read `new RewardService(supabase)`). **Confirmed:** `credit_transactions` is the only one of the twelve read by a user-scoped client — `components/settings/BillingSettings.tsx`, `components/settings/UsageAnalytics.tsx`, `components/v2/settings/BillingSettingsV2_NEW.tsx`, all `.select()` on the browser client. `app/api/user/data-export/route.ts` reads it via `serviceSupabase`, not its cookie client, and `app/api/stripe/sync-subscription/route.ts` builds a cookie client for auth but performs all three `credit_transactions` statements on `supabaseAdmin`. **Refuted nothing.** Additional facts worth recording:

- The `app/api/v6/insights/*` routes *do* build `createAuthenticatedServerClient()` and pass it to an `InsightRepository` — but that is `lib/repositories/InsightRepository.ts`, a different class from `lib/business-os/insight/repository/InsightRepository.ts`, and it touches none of the twelve tables. Worth knowing, because the name collision is exactly the kind of thing a name-based sweep gets wrong.
- All 20 `scripts/**` writers use `SUPABASE_SERVICE_ROLE_KEY` (checked individually, not assumed).
- `payment_refunds` — the source table for the `recompute_transaction_refund_state` / `propagate_refund_to_invoice` cascade into `payment_transactions` / `payment_invoices` — carries only a `payment_refunds_select_own` policy, so there is no user write path into the cascade. This closes the one hazard the SECURITY INVOKER trigger analysis leaves implicit.
- No trigger on a *user-writable* table writes into any of the twelve. Every trigger that writes them is attached to `payment_refunds`, `payment_transactions` or `payment_invoices`.
- The four queue claim/reap functions carry explicit `REVOKE ALL … FROM anon, authenticated` (`2026-08-14_payment_reminders_claim.sql:109-110`, `2026-08-14_payment_automation_executions_claim.sql:123-124`). `purge_business_data` is `SECURITY DEFINER` with `REVOKE … FROM PUBLIC/anon/authenticated` + `GRANT … TO service_role` — and is still in `supabase/held/`. **`update_overdue_installments()` is the one exception → QA-2.**

### 8.7 Apply guide

A careful non-DBA can follow it and get a correct result. The query-2 export gate is unambiguous (stated three times: header PRE-CHECK, §5 step 2, and the ⬜ placeholder in §5.1 that has to be filled in), and both RC-3 decisions are posed as pre-apply questions with an explicit "stop and send to the Dev". The rollback is honest about part (b) being unrecoverable and about `with_check` (RC-5). Gaps are QA-5 through QA-7.

### Test Coverage

| Acceptance criterion (§6 test plan) | Tested? | Result | Notes |
|---|---|---|---|
| T-1 one transaction, timeouts before first DDL | ✅ | Pass | |
| T-2 fails closed on RLS off / FORCE RLS / missing table | ✅ | Pass | |
| T-3 eight ALL → `(read-only)` SELECT twin, CREATE before DROP, no write policy ever created | ✅ | Pass | Re-derived independently in §8.3 |
| T-4 refuses to guess on drift; re-run is a no-op | ✅ | Pass | |
| T-5 shape-based sweep excludes service-role / SELECT / role-scoped | ✅ | Pass | **Extended by QA:** the sweep's twelve-table scope is now pinned too |
| T-6 one REVOKE, 12 tables, 2 roles, 6 privileges, never SELECT, no GRANT | ✅ | Pass | **Extended by QA:** the table count is now pinned at exactly twelve |
| T-7 no DDL on tables, no data statements | ✅ | Pass | |
| T-8 post-conditions cover all twelve tables | ✅ | Pass | **Extended by QA:** they are now also pinned to run before `COMMIT` |
| T-9 / T-10 header documents pre-check, post-check, rollback, deploy order | ✅ | Pass | |
| T-11 no `'use client'` module writes the twelve | ✅ | Pass | **Extended by QA:** a user-cookie-client writer guard was missing and is now added |
| T-12 `RewardService` has exactly the two browser call sites | ✅ | Pass | Also re-verified against `origin/main` |
| T-13 payment repositories / services / crons are service-role | ✅ | Pass | |
| T-14 every `settleInvoicePaid` call site passes `supabaseServer` | ✅ | Pass | |
| T-15 RC-1 guard present, before any DDL, `user_subscriptions` read-only | ✅ | Pass | Vacuity analysed in §8.2 |
| T-16 conversion logs the original `WITH CHECK` | ✅ | Pass | |
| T-17 `new CreditService(` has one service-role construction site | ✅ | Pass | |
| Live effect (post-check queries + browser PATCH proof) | ❌ | Not run | Out of QA's reach — no DB access. Remains §5 steps 4–5, owned by the user |

### Issues Found

#### Bugs (must fix before commit)

*None.* Nothing in the SQL produces a wrong end state, and no application path breaks.

#### Should fix (Medium)

1. **QA-2 — `update_overdue_installments()` is a surviving, publicly-executable write path into `payment_plan_installments`.** File: `supabase/migrations/20260723_enhance_payments.sql:406-422`. It is `SECURITY DEFINER`, lives in `public`, and — unlike the four queue claim/reap functions, which all carry an explicit `REVOKE ALL … FROM anon, authenticated` — it has **no `REVOKE` anywhere in the repo**, so it keeps PostgreSQL's default `EXECUTE TO PUBLIC` and is reachable at `POST /rest/v1/rpc/update_overdue_installments` with the public anon key. As definer it bypasses RLS *and* the grants this migration revokes, and its `UPDATE` has **no `user_id` predicate** — one unauthenticated call flips every user's `pending` installments past due date to `overdue`, platform-wide. Nothing in the repo calls it (zero `.rpc('update_overdue_installments')` hits); it appears to be a never-wired cron helper. This is pre-existing and not introduced here, but it directly qualifies §3's "no write path" framing and this file's "`update_overdue_installments` … unaffected by these grants" — the accurate statement is *unaffected, therefore still open*. **Recommended:** one read-only confirmation by the user, `SELECT has_function_privilege('authenticated','public.update_overdue_installments()','EXECUTE');` — if true, either add `REVOKE ALL ON FUNCTION public.update_overdue_installments() FROM anon, authenticated;` to this migration (same theme, same transaction, needs a guard because `REVOKE` on an absent function errors) or raise it as a tracked follow-up. SA's call — it widens the file's declared scope.
2. **QA-3 — the column-privilege check is in the migration header but not in the apply guide.** The header's POST-CHECK ends with an `information_schema.column_privileges` query and correctly explains why it matters (`has_table_privilege(…, 'INSERT')` returns false for a column-level grant, and `REVOKE … ON <table>` does not remove one — so post-condition (c) can pass with a column-level write path still open). But §5 step 4 says only "re-run pre-check queries 1–3", so a user following the guide never runs it. File: `docs/workplans/PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md:123`. One clause fixes it.
3. **QA-5 — rollback part (a) does not restore roles, and re-grants more than it took.** File: `supabase/migrations/20261004_payment_tables_write_lockdown.sql:238` and `:242-247`. The block hardcodes `FOR ALL TO public`, reading only `qual` back out of the twin — but step 1 preserved the original `roles` verbatim in that same twin, so if any original were `TO authenticated` the rollback silently restores a policy with a *wider* role set, while the text claims it "restores the read half exactly". Correct on prod today (all twelve are `{public}` per §1) but not in the Preview environment RC-1 exists for. Same block `GRANT`s all six privileges back to both roles unconditionally, even where pre-check query 3 shows they were not held. Fix is one line each: read `p.roles` alongside `p.qual`, and say the re-grant should be trimmed to query 3's output.

#### Edge cases (nice to fix)

4. **QA-4 — the RC-1 guard checks `UPDATE` but the reward path is an `upsert`.** `supabase/migrations/20261004_payment_tables_write_lockdown.sql:300`. If an environment ever granted `authenticated` `INSERT` on `user_subscriptions` but not `UPDATE`, the reward's upsert still lands as an `INSERT` for a user with no row yet — balance created, ledger insert then blocked by this file, which is the precise data hazard the guard exists to prevent. `20261001` revokes both, so any environment that has run it is safe, and prod is safe. Hardening is `OR has_table_privilege(…, 'INSERT')`.
5. **QA-6 — the abort table does not cover four aborts the file can raise.** `docs/workplans/PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md:111-120` omits `table public.<t> does not exist` (plausible in a fresh environment, and the only guard message with no row), `has no USING expression - cannot rebuild its read half safely`, `canceling statement due to statement timeout` (the 60 s limit; only the 3 s lock timeout has a row), and the bare Postgres `duplicate_object` / `policy "… (read-only)" … already exists` — which is the *one* abort whose message does not explain itself and whose correct response ("a twin already exists alongside the original; stop, this is drift") is not obvious. The `is %, expected PERMISSIVE` message is only loosely covered by the "name or shape drifted" row.
6. **QA-7 — a write policy scoped to a role outside `{public, anon, authenticated}` survives step 2, post-condition (b) and the `REVOKE`.** Not reachable from a Supabase JWT, so not a live hole, but the post-check in §5 step 4 ("no PERMISSIVE write-capable user policy on any of the twelve") reads as broader than what is actually verified. One qualifying clause.
7. **QA-8 — the branch is 13 commits behind `origin/main`** (now at `7a2a06c5`; the branch sits on `9aeeb50e`). I diffed every `.ts`/`.tsx` changed in between against the twelve table names, `new CreditService(`, `new RewardService(` and `settleInvoicePaid(`: only the two agent pages appear, and both still construct `RewardService` with the browser client, so **the blast radius is unchanged**. `20261003_seed_bos_llm_area_settings.sql` landed on main, so the `20261004` filename is still correctly ordered and unique. RM should rebase before opening the PR.

### Tests added by QA (tests only — no production file touched)

| Test | Why |
|---|---|
| `scopes the shape-based sweep to the twelve tables, and nothing wider` | Step 2 is the one statement that cannot be rolled back from the file. Nothing pinned its `p.tablename IN (…)` clause; without it the same shape query drops the owner write policy of **every** table in `public` |
| `converts exactly the eight known FOR ALL policies — no more, no less` | A ninth name added later would drop a live policy on evidence nobody reviewed |
| `runs the post-conditions inside the transaction, after the REVOKE and before COMMIT` | Directly pins the fail-closed property: the file must not be able to commit and *then* report a surviving write path |
| `revokes … and nothing else` — extended with an exact table count | A thirteenth table in the `REVOKE` would be a table nothing else in the file sweeps |
| `no user-cookie server client writes any of the twelve tables` | The existing guard only saw `'use client'`. A route building `createAuthenticatedServerClient()` and writing one of these tables is equally RLS-respecting and would break on apply — this is the W-4 shape the test header warns about but did not check. It passes today, with `app/api/stripe/sync-subscription/route.ts` as the live example of the shape done right |

Each of the four new SQL assertions was mutation-checked (table filter removed; post-conditions moved after `COMMIT;`; a thirteenth table added to the `REVOKE`; a ninth conversion entry added) and each fails on its mutation — they pin structure, not loose substrings. Also corrected one stale comment in the test file that still claimed the `RAISE NOTICE` transcript is a backup, which RC-2 removed everywhere else.

### Test Outputs / Logs

```text
$ npx jest lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts --ci
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total   (28 before QA's additions)

$ npx jest lib/repositories/__tests__ --ci
Test Suites: 23 passed, 23 total
Tests:       229 passed, 229 total

$ npx eslint lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts
(clean, exit 0)

$ node scratch/mutate.js      # mutation sanity, in-memory only
baseline  sweepScope=true postBeforeCommit=true revokeCount=true eight=true
M1 no-table-filter      -> sweepScope=false (want false)
M2 post-after-COMMIT    -> postBeforeCommit=false (want false)
M3 thirteenth-revoke    -> revokeCount=false (want false)
M4 ninth-conversion     -> eight=false (want false)
```

### Final Status

- [x] All acceptance criteria that can be verified without a database pass — **ready for commit**, subject to SA's call on QA-2 and the three Medium doc/rollback fixes (QA-2, QA-3, QA-5), none of which change the SQL's end state.
- [x] Live verification **complete**, 2026-09-21: the §5.1 query-2 export was captured before the apply (it is the only backup of the dropped policies), all five post-check queries were run after it, and their output is recorded in §5.3. Nothing further is owed by the user for this change — see §5.3 for why the §5 step 5 browser PATCH proof adds nothing on top of a directly measured "no write grant, no write policy" state.
- [ ] Queued, **not** part of this change: §10, the 50 PostgREST-callable SECURITY DEFINER functions (P1).

## 9. Commit Info

_(RM to populate. Nothing committed by Dev.)_

## 10. Follow-up: SECURITY DEFINER functions executable by `anon` — queued P1

> **Status: QUEUED, not work for this change.** It needs its own requirement, SA review and migration. It is recorded here because this cycle is what found it: QA-2 closed exactly one instance (`update_overdue_installments()`), and SA's re-review flagged that the same shape almost certainly repeats across the schema. It does — measured below.

**The shape.** A `SECURITY DEFINER` function runs as its owner, so it ignores RLS *and* every table grant. Supabase exposes any non-trigger function in `public` at `POST /rest/v1/rpc/<name>` to whatever role the caller's key maps to. So a `SECURITY DEFINER` function that `anon` can execute is a hole that no amount of table lock-down can close — the whole point of QA-2.

**Measured on production, 2026-09-21 (by the user, read-only).** Of **60** `SECURITY DEFINER` functions in `public`, **59 are executable by `anon`**. The only one that is not is `purge_schema_introspect`. Excluding trigger-returning functions (not reachable over `/rest/v1/rpc/`), **50 are callable through PostgREST with the public anon key**.

Re-measure with these two queries before doing anything — the numbers below are a snapshot:

```sql
-- (1) every SECURITY DEFINER function in public, and who can execute it
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
ORDER BY anon_exec DESC, p.proname;
-- 2026-09-21 on prod: 60 rows, 59 with anon_exec = true
-- (only `purge_schema_introspect` is false).
```

```sql
-- (2) of those, the ones actually reachable over PostgREST: a trigger-returning
--     function cannot be called through /rest/v1/rpc/, so it is not in scope.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY p.proname;
-- 2026-09-21 on prod: 50 rows.
```

**Root cause (identified by SA).** The sibling revokes are written `REVOKE ... FROM anon, authenticated` and never `FROM PUBLIC`. PostgreSQL grants `EXECUTE` on a new function to `PUBLIC` by default, and revoking from two roles does **not** remove a grant held by `PUBLIC` — so those revokes are no-ops and the functions stayed open. The only place in the repo that gets it right is `supabase/migrations/20260915a_purge_schema_introspect.sql:181`, which is precisely why `purge_schema_introspect` is the one function that measures closed. `20261004`'s own function revoke names `FROM PUBLIC, anon, authenticated` for the same reason (QA-2), and P4 in §5.2 is what proves it landed.

**Triage of the 50.** Three buckets, worst first:

| Bucket | Functions | Why it matters |
|---|---|---|
| **A. No arguments at all** | the ten `claim_due_*` / `reap_stale_*` queue functions, `pg_try_advisory_lock` / `pg_advisory_unlock`, `auto_disable_ineffective_behavior_rules` | An anonymous caller needs **nothing but the URL** — no id to guess, no session. The queue claim/reap pair is the §8.1 durable-drain machinery for every module; calling it from outside a cron can claim, stall or reap other tenants' work, and the advisory-lock wrappers let an anonymous caller hold or release the lock the drains serialise on |
| **B. Reads another tenant's data from a caller-supplied id** | `get_user_credit_balance`, `get_user_subscription_info`, `get_user_usage_summary`, `get_user_workflow_stats`, `has_sufficient_credits`, `is_reward_eligible` | Pass any `user_id` and read that user's balance, plan, usage and eligibility. Cross-tenant **read** |
| **C. Writes another tenant's data from a caller-supplied id** | `increment_executions_used`, `advance_contact_stage`, `dismiss_setup_step`, `get_or_create_user_organization`, the `upsert_*` family | Cross-tenant **write**, definer-owned, bypassing RLS entirely. `increment_executions_used` is a money-adjacent counter (see the S-6 free-tier cycle, where it is already an open P1) |

**This is the same class as the identity-hardening work** (`x-user-id` / body-`userId` IDOR): a privileged path that takes the tenant id from the caller instead of deriving it from the session. The difference is that here the privileged path is the database function itself, so a route-level fix cannot reach it — the function has to stop being callable by `anon`, and the ones that stay callable have to derive the tenant from `auth.uid()` rather than trust an argument.

**Fix shape (for the requirement, not decided here).** Per function: `REVOKE ALL ON FUNCTION … FROM PUBLIC` first — that is the load-bearing clause — then `GRANT EXECUTE` back only to the roles that genuinely call it (`service_role` for anything a cron or server route invokes; nothing at all for bucket A). Bucket B/C functions that a browser legitimately calls need their id argument replaced by `auth.uid()` before the grant is handed back. Needs a caller sweep per function (same method as §3), an ordering decision against the crons that use the claim/reap RPCs, and a CI guard so a new `SECURITY DEFINER` function cannot land with the default PUBLIC grant. **Do not batch-revoke blind**: the queue drains run as `service_role`, and a revoke that catches `service_role` would stop every §8.1 drain.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-21 | Created | Migration, static test and this workplan. Migration-only change; no application code touched |
| 2026-09-21 | SA round 1 fixes | RC-1 ordering guard enforced in-transaction; RC-2 query-2 export made a hard gate and the NOTICE-as-backup claim removed; RC-3 SELECT-policy check moved to a pre-apply decision and R-2 restated (new R-9); RC-4 `FROM PUBLIC` remedy guarded by a `service_role` grant check; RC-5 `with_check` fidelity recorded + logged; RC-6 `CreditService` / `PaymentReminderService` added to Section 3 with a new test; RC-7 `payment_methods` noted as a drop candidate. Plus SA's non-blocking items: typed plpgsql locals, sweep/post-condition asymmetry comments, column-privilege post-check, ToC |
| 2026-09-21 | QA round 1 fixes | **QA-2 (user-approved scope increase): `REVOKE ALL ON FUNCTION public.update_overdue_installments() FROM PUBLIC, anon, authenticated`** - a SECURITY DEFINER, publicly-executable, non-tenant-scoped UPDATE into `payment_plan_installments` that no table lock-down could close - guarded on the function existing, with its own post-condition, rollback line, pre/post-check query 4 and abort row. QA-3 column-privileges query made explicit in step 4; QA-5 rollback now restores `roles` and says to trim the re-GRANT; QA-6 six more abort rows incl. `duplicate_object`; QA-7 post-check claim qualified by role; QA-4 ordering guard extended to INSERT |
| 2026-09-21 | QA review | PASS, no High-severity defect. Migration traced statement by statement; RC-1 guard, the dynamic ALL→SELECT conversion, the shape-based sweep and the post-conditions each re-derived independently; blast radius re-swept from scratch (SA's two claims confirmed). Five test cases added (sweep scope, exactly-eight conversions, post-conditions-before-COMMIT, exact REVOKE table count, user-cookie writer guard), each mutation-checked; 32/32 pass. Three Mediums recorded: QA-2 `update_overdue_installments()` is a surviving publicly-executable SECURITY DEFINER write path, QA-3 the column-privilege post-check is missing from §5 step 4, QA-5 rollback part (a) does not restore roles |
| 2026-09-21 | SA code review | Fix Required - RC-1..RC-7 in section 7. D-1 / D-2 / D-6 and the rollback story approved; blast radius independently re-swept and confirmed |
| 2026-09-21 | SA re-review | Approved to ship. QA-2 function revoke, QA-4 and QA-5 spot-checked and correct; 33/33 tests pass. Two non-blockers: measure service_role EXECUTE in pre/post-check query 4, and a separate P1 for eight sibling claim/reap functions revoked FROM anon, authenticated but never FROM PUBLIC |
| 2026-09-21 | **Applied to production** + rollback fix | Applied by hand in the Supabase SQL editor; all five post-check queries pass (§5.3). The post-check surfaced a 63-byte identifier-truncation defect: the `saved_payment_methods` twin was stored as `... (read-onl`, so the ROLLBACK's twin lookup (which matched on the untruncated 65-character name) could never have restored that table. Fixed in the migration's ROLLBACK block — comment block only; the executable body between `BEGIN;` and `COMMIT;` is byte-identical to what is live. New `IDENTIFIER TRUNCATION` header section, T-20 test, §5.2 copy-pasteable post-check list, §5.3 applied-state record, and §10 queuing the SECURITY DEFINER P1 |
