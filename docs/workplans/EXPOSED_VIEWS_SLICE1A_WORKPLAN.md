# Workplan: Exposed views slice 1a (OAuth tokens and auth emails)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Branch:** `fix/exposed-views-slice-1a` (off origin/main `3517f563`)
**Requirement:** none. This is an emergency fix commissioned by TL from prod measurements, so no BA requirement was written.
**Date:** 2026-10-11
**Status:** Code Complete (uncommitted, awaiting SA review)

## Overview

**Severity: P0, a live exposure of credentials and personal data.**

TL measured these facts on prod on 2026-10-11, read-only:

| View | Owner / mode | Returns | Client grants |
|---|---|---|---|
| `public.active_plugin_connections` | postgres, `security_invoker` unset (runs with the owner's rights) | `plugin_connections` JOIN `profiles`, **including `access_token` and `refresh_token`** of every user's active plugin connection | anon + authenticated SELECT |
| `public.user_settings_complete` | postgres, `security_invoker` unset | `auth.users` (id, email) plus profiles, user_preferences, notification_settings and security_settings for **all users** | anon + authenticated SELECT |

So anyone holding the public anon key (it ships in the browser bundle) can read every user's OAuth tokens and every user's email address over PostgREST. RLS does not help, because owner-rights views read the underlying tables as postgres.

- No code reads either view. `git grep` across `app/ lib/ components/ hooks/ scripts/ supabase/functions/` finds only schema metadata in `lib/business-os/catalog/catalog.generated.ts` (a PostgREST-inferred relationship note on `user_settings_complete`). Some docs mention the views, but no code does.
- Supabase API logs (24 h retention) show no request to either view in the last 24 h. Anything older cannot be seen.

### Ownership boundaries

Two other sessions are working on neighbouring objects. This slice does not touch any of them.

| Owner | Migration | Branch | Objects |
|---|---|---|---|
| Pilot routing history session | number to be reassigned (it claimed `20261053`, which PR #304 already holds) | `fix/pilot-routing-history-rls` | table `pilot_step_routing_history` (RLS), views `pilot_routing_performance`, `pilot_step_type_analysis`, `pilot_tier_distribution` |
| Price-review slice 2 | `20261052` and `20261053` (PR #304, `feature/ai-model-price-review-slice2`) | `feature/ai-model-price-review-slice2` | view `pilot_cost_savings_summary` (rebuilt in `20261053`) |

This slice owns only `active_plugin_connections` and `user_settings_complete`, which is why it is numbered `20261054`.

## Approach

- Migration `20261054` runs `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on both views, then grants `service_role` SELECT explicitly so it does not depend on vendor defaults.
- `REVOKE ALL` is used instead of a list on purpose. A list goes stale: PostgreSQL 17 added MAINTAIN, which is exactly what went wrong in `20261005`.
- A DO block checks the result in the same transaction. If a view is missing, or PUBLIC/anon/authenticated still holds any of the 7 classic privileges, or service_role lost SELECT, it raises and nothing is applied. It uses direct booleans and no `SELECT`.
- **Out of scope:** dropping the views (a separate decision) and setting `security_invoker` (slice 1b).
- The pre-check and checker also test MAINTAIN, but only when `server_version_num >= 170000`. The migration's own post-condition sticks to the 7 privileges that work on every version.

## Files

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261054_exposed_views_slice1a_tokens_and_auth_users.sql` | create | The fix |
| `supabase/SQL Scripts/20261054_exposed_views_slice1a_tokens_and_auth_users_rollback.sql` | create | Restores the default client grants |
| `scripts/precheck-exposed-views-slice1a.sql` | create | Read-only. Records per-role privileges, grantors and dependents |
| `scripts/check-exposed-views-slice1a-migration.sql` | create | Read-only post-apply checker, VERDICT first |
| `supabase/migrations/__tests__/exposed-views-slice1a.migration.test.ts` | create | Static guard over the SQL text and the paste rules |
| `docs/workplans/EXPOSED_VIEWS_SLICE1A_WORKPLAN.md` | create | This file |

## Task List

- ✅ Confirm the branch and that main tops at 20261051. 20261052 and 20261053 are claimed by other sessions (see Ownership boundaries), so this slice is 20261054
- ✅ Grep the code to confirm nothing reads the two views
- ✅ Pre-check, migration, checker, rollback
- ✅ Static test, `npm run test:authz-guard`, Tailwind escape guard

## Apply order

1. **Pre-check.** Paste `scripts/precheck-exposed-views-slice1a.sql`.
   - Expected `PRECHECK STATUS` = `CLEAN run the migration in a NEW tab`.
   - Per view, expect:
     - Q1 `present plain view`
     - Q2 `postgres ok`
     - Q3 `unset ...`
     - Q4 anon and authenticated `8 of 8 held ... ALL matches the rollback` (7 of 7 on PG below 17), public `0 of 8 held none none as expected`, service_role `... kept by the migration`
     - Q5 grants by postgres only
     - Q6/Q7/Q8/Q9 counts all `0 ok`
   - If any row says `stop here`, **stop** and bring the output back to TL.
   - **Save this output.** It is the record the rollback is checked against.
2. **Migration in a NEW tab.** Paste `20261054_...sql`. It succeeds silently, or raises and rolls back.
3. **Checker.** Paste `scripts/check-exposed-views-slice1a-migration.sql`. Expected: `VERDICT PASS 12 pass 0 fail`. That is 6 checks per view: exists, owner postgres, anon none, authenticated none, public none, service_role SELECT.
4. **Anon negative test.** Paste each block separately. Each must fail with `42501 permission denied for view ...`:

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.active_plugin_connections; ROLLBACK;
   ```

   ```sql
   BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.user_settings_complete; ROLLBACK;
   ```

   Optionally, run the same blocks with `authenticated`, which also expect 42501.
5. **Merge** through the PR (RM), after SA, QA and user approval.

## Rollback

Paste `supabase/SQL Scripts/20261054_exposed_views_slice1a_tokens_and_auth_users_rollback.sql`. It runs `GRANT ALL` on both views to anon and authenticated, which is the Supabase default for objects created in `public`. Its DO block confirms that anon, authenticated and service_role can SELECT again.

**Adjust the rollback to the pre-check's recorded Q4 privileges if they differ from ALL.** The pre-check prints `differs from ALL so adjust the rollback` when they do. Running the rollback **re-opens the token leak**. Use it only if something verified breaks, and never as a precaution.

## Follow-ups

- **Slice 1b:** the remaining **13** owner-rights views in `public`. That is 19 in total, minus this slice's 2, minus the 4 pilot views owned elsewhere (`pilot_routing_performance`, `pilot_step_type_analysis` and `pilot_tier_distribution` in `20261053`, `pilot_cost_savings_summary` in price-review slice 2 / `20261052`). For each of the 13, either set `security_invoker = true` or revoke client grants.
- **Slice 2:** the tables with RLS disabled, **excluding** anything the other two sessions touch (for example `pilot_step_routing_history`).
- **Not ours unless handed over:** the pilot routing history session listed the open `true` policies on `workflow_step_executions`, `agent_memories`, `execution_insights` and `ai_model_pricing` as its own follow-ups.
- **Business decision for the user (token exposure):** the tokens were readable by anyone with the anon key, for an unknown period before the 24 h log window. Options are to treat every stored OAuth token as compromised (revoke and force a reconnect of every plugin connection, and rotate where the provider allows) or to accept the risk. This is a business trade-off, not a code question. The decision whether to drop the two views later also belongs here.

## SA Review Notes

**Reviewed by SA — 2026-10-11 (combined workplan + code review, emergency slice)**
**Status:** ✅ Approved with nits (none block applying the migration)

### Verified
- **Number 20261054 is free.** origin/main tops at 20261051. Open PR #304 (`feature/ai-model-price-review-slice2`) holds 20261052 and 20261053. No other remote branch or open PR has a 2026105x file.
- **Migration is correct.** `REVOKE ALL` drops all eight privileges, MAINTAIN included on PG17. It changes no owner and no view option. The `service_role` SELECT grant is explicit. The single BEGIN/COMMIT plus the raising DO block makes it all or nothing. If a grant from another grantor survives the revoke, the post-condition raises and nothing is applied.
- **Nothing in the app breaks.** No code, Edge Function (`supabase/functions/run-scheduled-agents`) or script reads either view. The only mention is in `catalog.generated.ts`, and `scripts/generate-business-catalog.ts` introspects with the service_role key, so the catalog does not drift. Realtime cannot publish views. The dashboard runs as postgres. pg_graphql uses the same anon/authenticated grants, so this revoke closes the GraphQL path too.
- **The pre-check finds any dependency.** Q6 covers pg_depend, which also catches materialized views and other views' rewrite rules. Q7 covers function bodies, Q8 policy expressions and Q9 view definitions. Any of them stops the run. Q5 stops on another grantor. Q4 records the pre-state the rollback is checked against.
- **Rollback is correct.** `GRANT ALL` to anon and authenticated is the Supabase default, MAINTAIN included on PG17. PUBLIC is deliberately not re-granted, because Q4 expects none. service_role SELECT stays.
- **Paste rules hold.** There are no `--` or `/*` comments and no "into". Punctuated literals are only the two relation names, and every string_agg has `COLLATE "C"`. The static test passes 52/52, and `npm run test:authz-guard` passes 203/203.
- **Acceptance is proportionate.** Checker 12/0 plus the anon (and authenticated) 42501 negative SELECTs is enough.

### Comments
1. Ownership boundaries table and slice 1b bullet: **wrong number attribution.** PR #304 (price-review slice 2) holds **both** 20261052 (`ai_model_pricing_baseline`) and 20261053 (`ai_model_pricing_exact_prices_and_image_table`). The `pilot_cost_savings_summary` rebuild is in its 20261053, not 20261052. That means the pilot routing history session's claimed 20261053 **collides with PR #304**. This does not affect 1a, but the table should be corrected and TL should get the two other sessions to renumber. — Priority: Medium (no block) — SA: pending, TL
2. Migration DO block checks 7 privileges and not MAINTAIN. That is acceptable: `REVOKE ALL` removes MAINTAIN regardless, and the checker tests it on PG17. Recorded only so nobody "fixes" the migration to list privileges instead of using ALL. — Low — SA: resolved (accepted)
3. Pre-check `SET default_transaction_read_only = on` applies only to the *next* transaction. If the editor runs the paste as one implicit transaction, it does not guard the current one. This is harmless because every statement is a catalog SELECT. — Low — SA: resolved (accepted)

### Follow-ups framing
- Slice 1b (13 views), slice 2 (RLS-disabled tables, excluding other sessions' objects), the not-ours `true`-policy tables, and the drop-or-invoker decision on the two 1a views are all correctly framed.
- The token-exposure item is correctly framed as a **business decision** for the user: treat every stored OAuth token as compromised and force a reconnect, or accept the risk. It should be raised right after apply, not left until 1b. The exposure window is unknown beyond the 24 h log window.

### Approval
[x] Workplan and code approved. Proceed to QA, then the user's diff view. Comment 1 is a doc and coordination fix for TL and does not block applying 20261054.

## QA Testing Report

## Commit Info

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Created | Emergency slice 1a: revoke client access to two token and email exposing views |
| 2026-10-11 | Renumbered to 20261054 and scoped | 20261052 (price-review slice 2) and 20261053 (pilot routing history RLS) are claimed by other sessions. Recorded ownership boundaries. Slice 1b is now 13 views, and slice 2 excludes the objects those sessions own |
| 2026-10-11 | SA review | Approved with nits. 20261054 confirmed free. PR #304 holds both 20261052 and 20261053, so the ownership attribution needs correcting and the pilot routing session's 20261053 collides. Static test 52/52, authz guard 203/203 |
| 2026-10-11 | SA nit 1 applied (TL) | Ownership table corrected: PR #304 holds both 20261052 and 20261053 (pilot_cost_savings_summary rebuilt in 20261053); the pilot routing history session must take a new number. Raised with the user |
| 2026-10-11 | Applied on prod and accepted (TL via the Supabase connector, user-authorized) | Pre-check CLEAN (run by TL, read-only). Migration 20261054 applied from the committed file; its DO post-conditions passed. Checker VERDICT PASS 12 pass 0 fail. Negative tests: anon SELECT on active_plugin_connections and authenticated SELECT on user_settings_complete both 42501 permission denied for view. PR #306 |
