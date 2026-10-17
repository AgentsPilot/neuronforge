# Workplan: Business OS Finance & Business Health — Slice 4b.1 (Boost reversal events, writer)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md), **§11I** (4b.1 parts: §11I.1 to §11I.6, §11I.8, §11I.9 AC-204 to AC-216, §13 checks 23 and 24) and "SA Requirement Review — 4b (§11I) — 2026-10-17" (SA-Q65 to SA-Q74, E-65 to E-69). Scoping: [BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REFUND_TIMING_SCOPING.md) (option ii).
**Decisions in force:** BD-17 (refunds and lost disputes count in the month we recorded them; finished months never change), BD-14, BD-33 (full cycle, stop for a production migration), BQ-13 open (no take-back: nothing in 4b.1 writes a credit lot or a lot draw).
**SA rulings implemented:** SA-Q65 (no `occurred_at`), SA-Q66 (CASCADE + regenerated cleanup `20261073` in this PR), SA-Q67 (`ON CONFLICT DO NOTHING`), SA-Q69 (INVOKER), SA-Q70 + E-67 (rollback refuses once rows exist; order 73 then 72), SA-Q71 (write-lockdown scan), E-65 (lock before the assertion; check 24 row), E-66 (local-only self-checking SQL). E-68 (Pin B) and E-69 (two reads, 100-id chunks) belong to 4b.2 and are noted only.
**Skills applied:** `supabase-postgres-best-practices` (FK index, constraints, least privilege, short lock), `tenant-isolation-guard` (§3.8), `business-os-schema-check` (read-only live facts, §1).
**Date:** 2026-10-17
**Branch:** `feature/bos-finance-health-4b` (cut by RM from `main` `f0b5e9d4`; confirmed with `git branch --show-current` in worktree `neuronforge-finance-health`). `node_modules` is a junction to the main checkout: never `git worktree remove`, never `git stash`, never `npm install` in the worktree, never commit (RM commits).
**Status:** Code Complete 2026-10-17 (SA workplan review: approved with conditions B1-R1 to B1-R3, all applied). Awaiting SA code review. Nothing applied to production, nothing committed.

## Overview

4b.1 is the writer half of BD-17. One hand-applied migration, `20261072`, creates the append-only table `business_os_boost_reversal_events` and replaces `business_os_transition_boost_purchase` with the same signature and the `20261031` body plus **six `INSERT … ON CONFLICT DO NOTHING` statements**, one per refund step or dispute stage that the function records. A second generated migration, `20261073`, re-issues the test-account cleanup so its G-18 guard knows the new link. There is no UI, no finance read, no webhook, handler, reconcile-pass or repository change, and no TypeScript runtime change apart from the generated cleanup version stamp.

Ten points need an SA ruling (SA-W105 to SA-W115, §9). Two are real misfits between the requirement and the code: the test-account cleanup coverage test rejects a `never` `via` descriptor that the plan does not delete (SA-W105), and adding the table to the payment write-lockdown "fixed list" would break that list's own migration pins (SA-W106).

---

## Table of Contents

1. [Verification Log](#1-verification-log)
2. [Analysis Summary](#2-analysis-summary)
3. [Migration 20261072](#3-migration-20261072)
4. [Migration 20261073 (regenerated cleanup)](#4-migration-20261073-regenerated-cleanup)
5. [Rollback scripts and order](#5-rollback-scripts-and-order)
6. [Checks 23 and 24](#6-checks-23-and-24)
7. [E-66 local self-checking script](#7-e-66-local-self-checking-script)
8. [Guard and test edits, line by line](#8-guard-and-test-edits-line-by-line)
9. [Questions for SA (SA-W105 to SA-W115)](#9-questions-for-sa-sa-w105-to-sa-w115)
10. [User hand-apply steps](#10-user-hand-apply-steps)
11. [AC mapping](#11-ac-mapping)
12. [Verification plan](#12-verification-plan)
13. [Files to create / modify](#13-files-to-create--modify)
14. [Risks](#14-risks)
15. [Estimate](#15-estimate)
16. [Task list](#16-task-list)
17. [SA Workplan Review](#sa-workplan-review)
18. [SA Code Review](#sa-code-review)
19. [QA Report](#qa-report)
20. [Commit Info](#commit-info)
21. [Change History](#change-history)

---

## 1. Verification Log

Measured 2026-10-17 on `feature/bos-finance-health-4b` = `main` `f0b5e9d4` (plus the uncommitted requirement edits), and on the live database read-only.

| # | Fact | How | Result |
|---|---|---|---|
| V-1 | `20261072` and `20261073` are free | `ls supabase/migrations` | Latest is `20261071_website_images_bucket_lockdown.sql` ✅ |
| V-2 | The transition function is defined only in `20261031:174-376` | `grep -rl business_os_transition_boost_purchase` | Only `20261031`, its rollback, its migration test, the 2b checker and probe, `boostChargeHandler.ts`, `BusinessOsBoostPurchaseRepository.ts` ✅ |
| V-3 | The six write branches are at `:282-285`, `:303-306`, `:322-325`, `:330-333`, `:349-352`, `:368-371` | Read line by line | Match RV-2 ✅ |
| V-4 | md5 of the `20261031` transition body (LF-normalised text between the `$transition_purchase$` tags) | `node` over the file | **`b9a5fe318eb25cdc65ba0402b23d7241`** (7,564 chars). The working tree is CRLF; the hash is of the LF form, matched on prod by `md5(replace(prosrc, chr(13), ''))` (the 2a/2b precedent). PGlite re-checks it at build (§7) |
| V-5 | Live: events table absent | `business-os-schema-check` Rule 1 shape: zero-row select, service role, from the main checkout `e49a4719` | `42P01 relation "public.business_os_boost_reversal_events" does not exist` ✅ |
| V-6 | Live: purchases, refunds, disputes | Head counts | **1 purchase, 0 with `amount_refunded_minor > 0`, 0 with `stripe_dispute_id`** ✅ (PF-10 holds) |
| V-7 | Live: every purchase column the inserts read exists | Zero-row select of `id, status, currency, livemode, amount_total_minor, amount_refunded_minor, stripe_dispute_id, paid_at, user_id` | All present ✅ |
| V-8 | **The live function body cannot be read through PostgREST.** `schema:check` replays selects; no RPC exposes `pg_proc.prosrc` (`purge_schema_introspect` returns columns, FKs, triggers, policies, not bodies) | Read `20260915a_purge_schema_introspect.sql` | Not provable read-only from here. **Moved into check 23 (md5 row) and an in-migration assertion that fails closed** (SA-W107) |
| V-9 | A local database exists | `which psql postgres supabase docker` → none. PGlite: `@electric-sql/pglite` **0.5.8** installed in an earlier session scratchpad with the 2b harness (`…/9515a9ff…/scratchpad/pglite/harness.mjs`) | **Yes: PGlite 0.5.8 = PostgreSQL 18.3 (WASM, in-process)** answered `select version()` today. No Docker, no Supabase CLI, no psql. Precedent: 2a §6.8, 2b §7.3 (SA-W110) |
| V-10 | Purchase status/lot CHECKs force a paid row to have a lot and `paid_at` | `20261030:83-85` | The self-check seeds through the real reserve → attach → credit functions, as the 2b probe does (§7) |
| V-11 | The cleanup chain ends at `20261047` (version stamp `789e4758d674b561` in `cleanupFunctionVersion.generated.ts`); `20261047` is **not** in the test's `APPLIED` list | `scripts/__tests__/testAccountCleanupSql.test.ts:647-659` | Must become applied history before it is `PREVIOUS` (SA-W108) |
| V-12 | Cleanup coverage test counts every non-global descriptor | `testAccountCleanupSql.test.ts:190-194` (`d.scope.kind !== 'global'`) | A `never` `via` descriptor not in the plan **fails it** (SA-W105) |
| V-13 | Write-lockdown `TABLES` doubles as the `20261004` content pin | `paymentTablesWriteLockdownMigration.test.ts:125-133, 166-172, 192-204` | Adding the table to `TABLES` fails three migration tests (SA-W106) |
| V-14 | SECDEF guard scans `supabase/migrations`, `supabase/SQL Scripts`, `supabase/held`; O-1 tripwire flags any other `.sql` that names SECURITY DEFINER | `security-definer-surface.guard.test.ts:62-72` | `20261072` is INVOKER (not tripped). `20261073` is the cleanup function (DEFINER) with the generated REVOKE/GRANT, compliant like `20261047`. No new `.sql` file may contain that phrase, even in a comment |
| V-15 | Ownership test: a `via` child needs no registry entry | `businessOwnedTables.test.ts:170-176` comment; direction 3 at `:245` | Registering it in `USER_OWNED_TABLES` is allowed and satisfies direction 3 (SA-W114) |

---

## 2. Analysis Summary

| Area | What 4b.1 touches |
|---|---|
| DB tables | **New** `business_os_boost_reversal_events`. Reads `business_os_boost_purchases` (no column, grant or policy change) |
| DB functions | `business_os_transition_boost_purchase(uuid, text, text, integer, text, text)` replaced, same signature, return type, INVOKER, `search_path = ''`, grants. `operator_test_account_cleanup` regenerated (`20261073`) |
| TypeScript runtime | Only `cleanupFunctionVersion.generated.ts` (new stamp). Webhook, `boostChargeHandler.ts`, `boostReconcilePass.ts`, `BusinessOsBoostPurchaseRepository.ts`: **unchanged** (RV-8) |
| Registries | Purge descriptor, classification baseline + note, `USER_OWNED_TABLES`, export `BILLING_TABLES`, write-lockdown caller scan, cleanup generator |
| Scripts | Check 23, check 24, E-66 self-check, rollback |
| Not touched | Finance builders, repository, route, UI, Pin A to D, AC-173 (4b.2) |

**Implementation approach, and why.**
- **Inserts as `INSERT … SELECT` from the locked purchase row** (SA-W109). The `20261031` SELECT … INTO does not read `currency` or `livemode`. Rather than widening it, each insert reads the row it has just updated (same transaction, already `FOR UPDATE`), so **every original line stays byte-identical** and the migration test can prove "the body is `20261031` plus six inserts and nothing else" by deleting the six inserts and comparing bytes. `status_after` is the row's status after the update, so it is never computed twice.
- **Explicit conflict targets.** `ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING` and `ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING`. Only the idempotency key is swallowed (SA-Q67); any other violation (a CHECK, the FK) still raises and rolls the purchase update back with it (SA F-1).
- **Dispute amount** = `COALESCE(amount_total_minor - amount_refunded_minor, 0)` read from the row. NULL total (flagged row) gives 0 (RV-5). The purchases CHECK `refund_within_total` (`20261030:79`) guarantees the difference is never negative, so no clamp is needed.
- **Refund amount** = `amount_refunded_minor` (after) − `v_refunded` (before, read under the lock). Never negative: a lower cumulative returns `stale` before any write (`:272`).
- **Fail closed on drift.** The migration refuses unless the live function body hashes to the `20261031` body (SA-W107) and no purchase has a refund or a dispute (RV-9), both after `LOCK TABLE … IN EXCLUSIVE MODE` (E-65).
- **Cleanup.** The new FK is CASCADE; the cleanup removes purchases at step B and the events go with them. The generator reviews the edge (parent-owned) so G-18 does not block, and the coverage test learns that a cascade child of a plan table is handled (SA-W105).

**Phase note (CLAUDE.md rule 8 / v6-pipeline):** not applicable; no V6, `lib/pilot/` or plugin code.

---

## 3. Migration 20261072

**File:** `supabase/migrations/20261072_business_os_boost_reversal_events.sql`. One transaction. No header comments (the `20261030`/`20261031` paste-safe precedent: the file starts with `BEGIN;`). ASCII only. No apostrophe and no `--` inside any string. The word "into" appears only as SQL keywords (§3.7). The phrase naming the definer security mode appears nowhere.

### 3.1 Lock, then the two refusals (E-65, RV-9, SA-W107)

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;

DO $no_undated_history$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS purchase_row WHERE purchase_row.amount_refunded_minor > 0 OR purchase_row.stripe_dispute_id IS NOT NULL) THEN
    RAISE EXCEPTION USING MESSAGE = 'MIGRATION REFUSED  a boost purchase already has a refund or a dispute with no dated event  nothing was applied  stop and tell the session';
  END IF;
  IF (SELECT md5(replace(proc_row.prosrc, chr(13), '')) FROM pg_catalog.pg_proc AS proc_row WHERE proc_row.oid = pg_catalog.to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')) IS DISTINCT FROM 'b9a5fe318eb25cdc65ba0402b23d7241' THEN
    RAISE EXCEPTION USING MESSAGE = 'MIGRATION REFUSED  the transition function on this database is not the 20261031 body  nothing was applied  stop and tell the session';
  END IF;
END
$no_undated_history$;
```

Why `EXCLUSIVE`: it conflicts with `ROW SHARE` (the function's `FOR UPDATE`) and `ROW EXCLUSIVE` (its `UPDATE`) but not with `ACCESS SHARE`, so the Finance page and the boost history reads keep working. A transition that already holds its row lock makes the `LOCK` wait (≤ 5 s); when it commits, the assertion sees its refund and refuses. The only residual window is a call that entered the old body but had not yet reached its `FOR UPDATE`: it waits behind the lock and then finishes with the old body. Check 24's E-65 row proves none did. On `55P03` (lock timeout) nothing is applied; the user re-runs once.

### 3.2 Table, constraints, indexes, comment

```sql
CREATE TABLE public.business_os_boost_reversal_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL,
  kind text NOT NULL,
  amount_minor integer NOT NULL,
  cumulative_refunded_minor integer NOT NULL,
  currency text NOT NULL,
  stripe_dispute_id text,
  status_before text NOT NULL,
  status_after text NOT NULL,
  livemode boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_boost_reversal_events_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.business_os_boost_purchases (id) ON DELETE CASCADE;

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_kind_known CHECK (kind IN ('refund', 'dispute_opened', 'dispute_won', 'dispute_lost'));

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_amount_not_negative CHECK (amount_minor >= 0);

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_cumulative_not_negative CHECK (cumulative_refunded_minor >= 0);

ALTER TABLE public.business_os_boost_reversal_events ADD CONSTRAINT business_os_boost_reversal_events_dispute_id_by_kind CHECK ((kind = 'refund') = (stripe_dispute_id IS NULL));

CREATE UNIQUE INDEX business_os_boost_reversal_events_refund_step_key ON public.business_os_boost_reversal_events (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund';

CREATE UNIQUE INDEX business_os_boost_reversal_events_dispute_stage_key ON public.business_os_boost_reversal_events (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund';

CREATE INDEX business_os_boost_reversal_events_recorded_at_idx ON public.business_os_boost_reversal_events (recorded_at);

CREATE INDEX business_os_boost_reversal_events_purchase_id_idx ON public.business_os_boost_reversal_events (purchase_id);

COMMENT ON TABLE public.business_os_boost_reversal_events IS 'One dated row per refund step or dispute stage of a boost purchase  recorded_at is the time we recorded it and the month Finance counts it in  Append only  Written only by business_os_transition_boost_purchase  Server only with no client grant  Never purged  Removed only with its purchase';
```

Notes:
- No `user_id` column and the token `user_id` appears nowhere in the `CREATE TABLE` statement (the ownership test's regex would otherwise classify it; RT §3).
- The plain `(purchase_id)` index serves the cascade and the FK (the two unique indexes are partial, so the planner cannot use them for `WHERE purchase_id = $1` alone). Best-practice `schema-foreign-key-indexes`.
- `gen_random_uuid()` for the PK follows the boost tables; the table is tiny, so UUIDv4 fragmentation is irrelevant.
- Constraint names stay under 63 bytes (longest: `business_os_boost_reversal_events_cumulative_not_negative`, 57).

### 3.3 RLS and grants (§11I.5)

```sql
ALTER TABLE public.business_os_boost_reversal_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM anon;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM authenticated;

REVOKE ALL ON TABLE public.business_os_boost_reversal_events FROM service_role;

GRANT SELECT ON TABLE public.business_os_boost_reversal_events TO service_role;

GRANT INSERT (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode) ON TABLE public.business_os_boost_reversal_events TO service_role;
```

No policy for any role. Writes work only because Supabase's `service_role` has `BYPASSRLS` (the 2a PGlite finding, checker row B3 33); checks 23 and 24 both assert it. `id` and `recorded_at` are not in the INSERT grant, so they always take their defaults (F-3). No UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER to anyone. The cascade needs no DELETE grant (F-3). `INSERT … ON CONFLICT` with an arbiter reads the arbiter columns; `service_role` holds table SELECT, so that is covered.

### 3.4 The replaced function (RV-2, SA-Q67)

Every line not marked `-- [n]` below is **byte-identical** to `20261031:174-376` except the first word (`CREATE OR REPLACE`). The `-- [n]` markers are workplan annotations only; **the migration file carries no comment inside the body** (the check 24 occurrence count and the md5 depend on the exact text).

```sql
CREATE OR REPLACE FUNCTION public.business_os_transition_boost_purchase(
  p_purchase_id uuid,
  p_to_status text,
  p_payment_intent_id text,
  p_amount_refunded_minor integer,
  p_dispute_id text,
  p_flag_reason text
)
RETURNS TABLE (out_status text, out_user_id uuid, out_from_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $transition_purchase$
DECLARE
  v_found boolean;
  v_user uuid;
  v_from text;
  v_intent text;
  v_total integer;
  v_refunded integer;
  v_dispute text;
  v_target text;
BEGIN
  IF p_purchase_id IS NULL OR p_to_status IS NULL THEN
    RAISE EXCEPTION 'business_os_transition_boost_purchase needs a purchase id and a target' USING ERRCODE = '22004';
  END IF;

  IF p_to_status NOT IN ('awaiting_payment', 'failed', 'expired', 'flagged_mismatch', 'partially_refunded', 'refunded', 'disputed', 'dispute_won', 'dispute_lost')
     OR (p_payment_intent_id IS NOT NULL AND (left(p_payment_intent_id, 3) <> ('pi' || chr(95)) OR char_length(p_payment_intent_id) > 255))
     OR (p_dispute_id IS NOT NULL AND ((left(p_dispute_id, 3) <> ('dp' || chr(95)) AND left(p_dispute_id, 3) <> ('du' || chr(95))) OR char_length(p_dispute_id) > 255))
     OR (p_flag_reason IS NOT NULL AND char_length(p_flag_reason) NOT BETWEEN 1 AND 64)
     OR (p_amount_refunded_minor IS NOT NULL AND p_amount_refunded_minor < 0)
     OR (p_to_status = 'awaiting_payment' AND p_payment_intent_id IS NULL)
     OR (p_to_status = 'flagged_mismatch' AND p_flag_reason IS NULL)
     OR (p_to_status IN ('partially_refunded', 'refunded') AND p_amount_refunded_minor IS NULL)
     OR (p_to_status IN ('disputed', 'dispute_won', 'dispute_lost') AND p_dispute_id IS NULL) THEN
    RAISE EXCEPTION 'business_os_transition_boost_purchase was given an argument out of range' USING ERRCODE = '22023';
  END IF;

  SELECT purchase_row.user_id, purchase_row.status, purchase_row.stripe_payment_intent_id, purchase_row.amount_total_minor,
         purchase_row.amount_refunded_minor, purchase_row.stripe_dispute_id
  INTO v_user, v_from, v_intent, v_total, v_refunded, v_dispute
  FROM public.business_os_boost_purchases AS purchase_row
  WHERE purchase_row.id = p_purchase_id
  FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    out_status := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  out_user_id := v_user;
  out_from_status := v_from;

  IF p_to_status = 'awaiting_payment' THEN
    IF v_from = 'awaiting_payment' AND v_intent = p_payment_intent_id THEN
      out_status := 'already';
    ELSIF v_from <> 'pending' THEN
      out_status := 'not_allowed';
    ELSIF EXISTS (SELECT 1 FROM public.business_os_boost_purchases AS other_row WHERE other_row.stripe_payment_intent_id = p_payment_intent_id AND other_row.id <> p_purchase_id) THEN
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'flagged_mismatch', flag_reason = 'payment_intent_reused', status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      out_status := 'mismatch';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'awaiting_payment', stripe_payment_intent_id = p_payment_intent_id, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      out_status := 'transitioned';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_to_status IN ('failed', 'expired', 'flagged_mismatch') THEN
    IF v_from = p_to_status THEN
      out_status := 'already';
    ELSIF v_from NOT IN ('pending', 'awaiting_payment') THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = p_to_status,
          flag_reason = (CASE WHEN p_to_status = 'flagged_mismatch' THEN p_flag_reason ELSE NULL END),
          status_changed_at = now(),
          updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      out_status := 'transitioned';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_to_status IN ('partially_refunded', 'refunded') THEN
    IF v_from NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost', 'flagged_mismatch') THEN
      out_status := 'not_allowed';
    ELSIF p_amount_refunded_minor < v_refunded THEN
      out_status := 'stale';
    ELSIF v_from = 'refunded' AND p_to_status = 'partially_refunded' THEN
      out_status := 'not_allowed';
    ELSIF v_total IS NOT NULL AND p_amount_refunded_minor > v_total THEN
      out_status := 'not_allowed';
    ELSIF v_from IN ('disputed', 'dispute_lost', 'flagged_mismatch') THEN
      IF p_amount_refunded_minor = v_refunded THEN
        out_status := 'already';
      ELSE
        UPDATE public.business_os_boost_purchases AS purchase_row
        SET amount_refunded_minor = p_amount_refunded_minor, updated_at = now()
        WHERE purchase_row.id = p_purchase_id;
        INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)  -- [1]
        SELECT purchase_row.id, 'refund', purchase_row.amount_refunded_minor - v_refunded, purchase_row.amount_refunded_minor, purchase_row.currency, NULL, v_from, purchase_row.status, purchase_row.livemode
        FROM public.business_os_boost_purchases AS purchase_row
        WHERE purchase_row.id = p_purchase_id
        ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING;
        out_status := 'recorded';
      END IF;
    ELSE
      IF p_amount_refunded_minor = v_total THEN
        v_target := 'refunded';
      ELSIF p_amount_refunded_minor > 0 THEN
        v_target := 'partially_refunded';
      ELSE
        v_target := NULL;
      END IF;

      IF v_target IS NULL OR v_target <> p_to_status THEN
        out_status := 'not_allowed';
      ELSIF v_from = v_target AND p_amount_refunded_minor = v_refunded THEN
        out_status := 'already';
      ELSIF v_from = 'refunded' THEN
        out_status := 'not_allowed';
      ELSE
        UPDATE public.business_os_boost_purchases AS purchase_row
        SET status = v_target, amount_refunded_minor = p_amount_refunded_minor, status_changed_at = now(), updated_at = now()
        WHERE purchase_row.id = p_purchase_id;
        INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)  -- [2]
        SELECT purchase_row.id, 'refund', purchase_row.amount_refunded_minor - v_refunded, purchase_row.amount_refunded_minor, purchase_row.currency, NULL, v_from, purchase_row.status, purchase_row.livemode
        FROM public.business_os_boost_purchases AS purchase_row
        WHERE purchase_row.id = p_purchase_id
        ON CONFLICT (purchase_id, cumulative_refunded_minor) WHERE kind = 'refund' DO NOTHING;
        out_status := 'transitioned';
      END IF;
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_to_status = 'disputed' THEN
    IF v_from = 'disputed' AND v_dispute = p_dispute_id THEN
      out_status := 'already';
    ELSIF v_from = 'flagged_mismatch' THEN
      IF v_dispute = p_dispute_id THEN
        out_status := 'already';
      ELSIF v_dispute IS NOT NULL THEN
        out_status := 'not_allowed';
      ELSE
        UPDATE public.business_os_boost_purchases AS purchase_row
        SET stripe_dispute_id = p_dispute_id, updated_at = now()
        WHERE purchase_row.id = p_purchase_id;
        INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)  -- [3]
        SELECT purchase_row.id, 'dispute_opened', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
        FROM public.business_os_boost_purchases AS purchase_row
        WHERE purchase_row.id = p_purchase_id
        ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
        out_status := 'recorded';
      END IF;
    ELSIF v_from NOT IN ('paid', 'partially_refunded', 'refunded') THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'disputed', stripe_dispute_id = p_dispute_id, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)  -- [4]
      SELECT purchase_row.id, 'dispute_opened', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
      FROM public.business_os_boost_purchases AS purchase_row
      WHERE purchase_row.id = p_purchase_id
      ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
      out_status := 'transitioned';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_dispute IS DISTINCT FROM p_dispute_id THEN
    out_status := 'not_allowed';
  ELSIF v_from = 'flagged_mismatch' THEN
    out_status := 'already';
  ELSIF p_to_status = 'dispute_lost' THEN
    IF v_from = 'dispute_lost' THEN
      out_status := 'already';
    ELSIF v_from <> 'disputed' THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = 'dispute_lost', status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)  -- [5]
      SELECT purchase_row.id, 'dispute_lost', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
      FROM public.business_os_boost_purchases AS purchase_row
      WHERE purchase_row.id = p_purchase_id
      ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
      out_status := 'transitioned';
    END IF;
  ELSE
    IF v_refunded = 0 THEN
      v_target := 'paid';
    ELSIF v_refunded >= v_total THEN
      v_target := 'refunded';
    ELSE
      v_target := 'partially_refunded';
    END IF;

    IF v_from = v_target THEN
      out_status := 'already';
    ELSIF v_from <> 'disputed' THEN
      out_status := 'not_allowed';
    ELSE
      UPDATE public.business_os_boost_purchases AS purchase_row
      SET status = v_target, status_changed_at = now(), updated_at = now()
      WHERE purchase_row.id = p_purchase_id;
      INSERT INTO public.business_os_boost_reversal_events (purchase_id, kind, amount_minor, cumulative_refunded_minor, currency, stripe_dispute_id, status_before, status_after, livemode)  -- [6]
      SELECT purchase_row.id, 'dispute_won', COALESCE(purchase_row.amount_total_minor - purchase_row.amount_refunded_minor, 0), purchase_row.amount_refunded_minor, purchase_row.currency, purchase_row.stripe_dispute_id, v_from, purchase_row.status, purchase_row.livemode
      FROM public.business_os_boost_purchases AS purchase_row
      WHERE purchase_row.id = p_purchase_id
      ON CONFLICT (purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund' DO NOTHING;
      out_status := 'transitioned';
    END IF;
  END IF;
  RETURN NEXT;
END;
$transition_purchase$;
```

| # | Branch (`20261031` lines) | Outcome | kind | amount_minor | cumulative | dispute id | before → after |
|---|---|---|---|---|---|---|---|
| [1] | refund on disputed / lost / flagged (`:282-285`) | `recorded` | `refund` | new − old cumulative | new cumulative | NULL | unchanged status |
| [2] | refund to partial / full (`:303-306`) | `transitioned` | `refund` | new − old cumulative | new cumulative | NULL | e.g. `paid` → `partially_refunded` |
| [3] | dispute on flagged (`:322-325`) | `recorded` | `dispute_opened` | at stake, 0 if total NULL | current | the new id | `flagged_mismatch` → `flagged_mismatch` |
| [4] | dispute opened (`:330-333`) | `transitioned` | `dispute_opened` | at stake | current | the new id | paid family → `disputed` |
| [5] | dispute lost (`:349-352`) | `transitioned` | `dispute_lost` | at stake | current | stored id | `disputed` → `dispute_lost` |
| [6] | dispute won (`:368-371`) | `transitioned` | `dispute_won` | at stake | current | stored id | `disputed` → paid family |

No insert on `already`, `stale`, `not_allowed`, `not_found`, `mismatch`, nor in the `awaiting_payment` / `failed` / `expired` / `flagged_mismatch` target branches (RV-1). No line names `business_os_credit_lots` or `business_os_credit_lot_draws` (RV-10, BQ-13).

PL/pgSQL name resolution: no variable or OUT parameter shares a name with an events or purchases column (`p_*`, `v_*`, `out_*` only), so the column list, the arbiter columns and `kind` in the arbiter predicate resolve to columns.

### 3.5 Function grants (re-stated, `20261031:460-468`), then commit

```sql
REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

`NOTIFY` is delivered at commit so PostgREST sees the new table for 4b.2's reads (precedent `20261028`, `20261029` and the cleanup migrations; Supabase's DDL watcher normally does it too). SA-W115.

### 3.6 The md5 of the new body

Dev computes `md5` of the LF-normalised text between the `$transition_purchase$` tags of `20261072` at build time, records it here and in check 24, and PGlite confirms `md5(replace(prosrc, chr(13), ''))` equals it after the apply. The migration test pins that check 24 carries exactly that hash. **New body md5:** `018c4447f2b52dd87e4ae3b229e5b42c` (B1-R3; confirmed by PGlite after the apply, pinned by the migration test and check 24).

### 3.7 Paste and editor rules pinned by the migration test

- `\binto\b` (case-insensitive) occurs exactly **7** times: the original `INTO v_user, …` and six `INSERT INTO public.business_os_boost_reversal_events (`. None inside a string literal or comment.
- No apostrophe, semicolon or `--` inside any string literal except the plain SQL literals listed in the file (`'refund'`, statuses, the two `MESSAGE` strings and the `COMMENT`); the messages and comment contain no `;`, `'`, `--` or "into".
- ASCII only. No line comment anywhere (the file has none).

---

## 4. Migration 20261073 (regenerated cleanup)

**Generated, never hand-edited.** `npx tsx scripts/generate-test-account-cleanup-sql.ts` after the generator edits in §8.6 writes:

| File | Change |
|---|---|
| `supabase/migrations/20261073_operator_test_account_cleanup_boost_reversal_events.sql` | **New.** `CREATE OR REPLACE` of `public.operator_test_account_cleanup(text, text, text, text, uuid, text)` with the new plan: the only SQL difference from `20261047` is one more `inbound_review` row `('business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', NULL)`, the header lines and the version stamp |
| `supabase/SQL Scripts/20261073_operator_test_account_cleanup_boost_reversal_events_rollback.sql` | **New.** Restores the `20261047` function byte for byte (`previousFunctionSql`) |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | Regenerated (same `inbound_review` row) |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | New stamp |

Why it is needed although the FK cascades (PF-11, SA-Q66): G-18 blocks **any** catalogue edge into an emptied table that `INBOUND_FOREIGN_KEYS` does not list, whatever its delete action and whether or not rows exist. After `20261072`, until `20261073` is applied, every Danger Zone check refuses at G-18 ("not reviewed"). Owner column `null` means parent-owned: G-18 counts 0 for it and does not block. No delete step is added; the step-B delete of `business_os_boost_purchases` (ord 91) cascades the events. `FUNCTION_REQUIRED_TABLES` is **not** extended: the new name appears only as a string literal, never as a static table reference, so the cleanup compiles and runs with or without the table.

**Version window:** after `20261073` is applied and before the 4b.1 build is deployed, the app's pinned stamp differs from the function's, so the Danger Zone check and delete refuse (designed behaviour, `runCleanupDelete.ts:99`, `check/route.ts:104`). The user must not need the Danger Zone in that window (§10).

---

## 5. Rollback scripts and order

**Order (E-67): `20261073`'s rollback first, then `20261072`'s.** Before either, the user runs one line: `select count(*) from public.business_os_boost_reversal_events;`. **If it is not 0, roll back neither**: the `20261072` rollback refuses once events exist, and rolling back only `20261073` would leave the events table with a cleanup that blocks every account at G-18. From the first event on, defects are fixed forward by a new migration (SA-W111).

### 5.1 `supabase/SQL Scripts/20261072_business_os_boost_reversal_events_rollback.sql`

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;

LOCK TABLE public.business_os_boost_reversal_events IN ACCESS EXCLUSIVE MODE;

DO $refuse$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_os_boost_reversal_events) THEN
    RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED  the reversal events table holds dated money history  fix forward with a new migration  nothing was changed';
  END IF;
END
$refuse$;

CREATE OR REPLACE FUNCTION public.business_os_transition_boost_purchase(
  ... the 20261031 text from the opening parenthesis to the closing $transition_purchase$ tag, byte for byte ...
$transition_purchase$;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM anon;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text) TO service_role;

DROP TABLE public.business_os_boost_reversal_events;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

The function is restored **before** the table is dropped, under the same purchases lock as the migration (same lock order, no deadlock). After it, `md5(replace(prosrc, chr(13), ''))` is again `b9a5fe318eb25cdc65ba0402b23d7241` (PGlite proves it; check 23's md5 row then passes again).

### 5.2 `20261073`'s rollback

Generated. Restores the `20261047` function; its header already says to redeploy a build pinning the previous stamp. After a rollback of both, RM reverts the 4b.1 PR (the version file) so the Danger Zone stamp matches again.

---

## 6. Checks 23 and 24

Read-only, ASCII only, no apostrophe in any comment, never the word "into", **one statement and one result set each**, no `SET` line (so the editor tab is not left read-only). They supersede the requirement's text with the additions marked **(new)** below, which SA rules on (SA-W113). The requirement MD is not edited by Dev; TL records the outcome.

### 6.1 Check 23 — `scripts/precheck-bos-boost-reversal-events.sql`

```sql
-- Finance check 23: run BEFORE applying migration 20261072, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
-- The md5 is the body of the transition function as migration 20261031 wrote it.
-- The cleanup row shows the test-account cleanup function is the 20261047 version.
select 'reversal events table absent' as item,
  to_regclass('public.business_os_boost_reversal_events') is null as ok,
  null::bigint as found
union all
select 'transition function present with six arguments',
  to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)') is not null,
  null::bigint
union all
select 'transition function is security invoker',
  coalesce(bool_and(not p.prosecdef), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')
union all
select 'transition function body is the 20261031 body',
  coalesce(bool_and(md5(replace(p.prosrc, chr(13), '')) = 'b9a5fe318eb25cdc65ba0402b23d7241'), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)')
union all
select 'service_role bypasses row level security',
  coalesce(bool_and(r.rolbypassrls), false),
  count(*)
from pg_catalog.pg_roles r
where r.rolname = 'service_role'
union all
select 'cleanup function is the 20261047 version',
  coalesce(bool_and(position('789e4758d674b561' in p.prosrc) > 0), false),
  count(*)
from pg_catalog.pg_proc p
where p.oid = to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)')
union all
select 'no boost purchase with a refund',
  count(*) = 0,
  count(*)
from public.business_os_boost_purchases b
where b.amount_refunded_minor > 0
union all
select 'no boost purchase with a dispute',
  count(*) = 0,
  count(*)
from public.business_os_boost_purchases b
where b.stripe_dispute_id is not null;
```

New rows: the body md5 (SA-W107), BYPASSRLS, the cleanup version (SA-W108). Expected on prod today: 8 rows, all `ok = true`.

### 6.2 Check 24 — `scripts/check-bos-boost-reversal-events-migration.sql`

```sql
-- Finance check 24: run AFTER applying migrations 20261072 and 20261073, read only.
-- Every row must show ok = true. If one does not, stop and tell the session.
-- The function must name the events table six times, once per insert point.
-- The two md5 and stamp values are the files of this pull request.
with t as (
  select to_regclass('public.business_os_boost_reversal_events') as tbl,
         to_regprocedure('public.business_os_transition_boost_purchase(uuid, text, text, integer, text, text)') as fn,
         to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') as cleanup_fn
)
select 'table exists' as item, t.tbl is not null as ok from t
union all
select 'row level security on', coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) from t
union all
select 'no policy on the table', not exists (select 1 from pg_catalog.pg_policy pol where pol.polrelid = t.tbl) from t
union all
select 'anon has no privilege on the table or any column', not coalesce(has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'authenticated has no privilege on the table or any column', not coalesce(has_table_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') or has_any_column_privilege('authenticated', t.tbl, 'SELECT, INSERT, UPDATE, REFERENCES'), true) from t
union all
select 'service_role can select', coalesce(has_table_privilege('service_role', t.tbl, 'SELECT'), false) from t
union all
select 'service_role can insert kind', coalesce(has_column_privilege('service_role', t.tbl, 'kind', 'INSERT'), false) from t
union all
select 'service_role can insert purchase_id', coalesce(has_column_privilege('service_role', t.tbl, 'purchase_id', 'INSERT'), false) from t
union all
select 'service_role can insert exactly nine columns',
  coalesce((select count(*) from pg_catalog.pg_attribute a
            where a.attrelid = t.tbl and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('service_role', t.tbl, a.attnum, 'INSERT')) = 9, false) from t
union all
select 'service_role cannot set recorded_at', not coalesce(has_column_privilege('service_role', t.tbl, 'recorded_at', 'INSERT'), true) from t
union all
select 'service_role cannot set id', not coalesce(has_column_privilege('service_role', t.tbl, 'id', 'INSERT'), true) from t
union all
select 'service_role cannot update', not coalesce(has_table_privilege('service_role', t.tbl, 'UPDATE') or has_any_column_privilege('service_role', t.tbl, 'UPDATE'), true) from t
union all
select 'service_role cannot delete', not coalesce(has_table_privilege('service_role', t.tbl, 'DELETE, TRUNCATE'), true) from t
union all
select 'service_role bypasses row level security', coalesce((select r.rolbypassrls from pg_catalog.pg_roles r where r.rolname = 'service_role'), false) from t
union all
select 'foreign key to purchases cascades',
  exists (select 1 from pg_catalog.pg_constraint con
          where con.conrelid = t.tbl and con.contype = 'f'
            and con.confrelid = 'public.business_os_boost_purchases'::regclass
            and con.confdeltype = 'c') from t
union all
select 'two unique partial indexes and four indexes besides the key',
  coalesce((select count(*) filter (where i.indisunique and i.indpred is not null) = 2
                   and count(*) filter (where not i.indisprimary) = 4
            from pg_catalog.pg_index i where i.indrelid = t.tbl), false) from t
union all
select 'function still security invoker', coalesce((select not p.prosecdef from pg_catalog.pg_proc p where p.oid = t.fn), false) from t
union all
select 'function body is the 20261072 body',
  coalesce((select md5(replace(p.prosrc, chr(13), '')) = '018c4447f2b52dd87e4ae3b229e5b42c' from pg_catalog.pg_proc p where p.oid = t.fn), false) from t
union all
select 'function names the events table six times',
  coalesce((select (length(pg_get_functiondef(t.fn)) - length(replace(pg_get_functiondef(t.fn), 'business_os_boost_reversal_events', '')))
            / length('business_os_boost_reversal_events') = 6), false) from t
union all
select 'anon cannot execute the function', not coalesce(has_function_privilege('anon', t.fn, 'EXECUTE'), true) from t
union all
select 'service_role can execute the function', coalesce(has_function_privilege('service_role', t.fn, 'EXECUTE'), false) from t
union all
select 'cleanup function is the 20261073 version',
  coalesce((select position('f854486b31baf784' in p.prosrc) > 0 from pg_catalog.pg_proc p where p.oid = t.cleanup_fn), false) from t
union all
select 'no refund or dispute recorded without an event',
  not exists (select 1 from public.business_os_boost_purchases b
              where (b.amount_refunded_minor > 0 or b.stripe_dispute_id is not null)
                and not exists (select 1 from public.business_os_boost_reversal_events e where e.purchase_id = b.id))
from t;
```

The values are `018c4447f2b52dd87e4ae3b229e5b42c` (new body) and `f854486b31baf784` (cleanup stamp); the migration test and the cleanup test each pin that check 24 carries the value their file produces (B1-R3). The last row is E-65. Expected on prod right after the apply: 23 rows, all `ok = true`.

Strengthened versus the requirement text (SA-W113): `has_table_privilege` alone misses a column-level grant, so the anon, authenticated and UPDATE rows also use `has_any_column_privilege`; plus the nine-column count, `id` not insertable, BYPASSRLS, index shape, body md5 and cleanup stamp rows.

---

## 7. E-66 local self-checking script

**Is there a local database?** Not a Postgres server: no `psql`, `postgres`, Docker or Supabase CLI on this machine. **There is PGlite** (`@electric-sql/pglite` 0.5.8, PostgreSQL 18.3 compiled to WASM, in-process), the house local database for boost slices 2a and 2b (§1 V-9). It runs in the session scratchpad only, never in `package.json` or the lockfile. So AC-207 to AC-211 **can** be proven locally, and SA F-5's fallback (a user Stripe test-mode refund after the apply) is **not needed** (SA-W110). PGlite cannot prove real concurrency (E-65's window), Supabase's real default privileges, or the SQL editor's paste parsing; check 24 and the migration test own those.

### 7.1 The script: `scripts/test-bos-boost-reversal-events.sql`

One `DO $selftest$ … $selftest$;` block. **Local-only guards first** (before anything is written):
1. `current_setting('bos.selftest_local', true) = 'on'`, set by the runner with `SET LOCAL`; otherwise raise `SELFTEST REFUSED  local only`.
2. Refuse when `to_regclass('auth.refresh_tokens') IS NOT NULL` (a real Supabase database has it; the PGlite stub does not).
3. Refuse when the transaction is read only.

Then it seeds an account and purchases **through the real functions** as `postgres` and `SET LOCAL ROLE service_role` (reserve → attach → credit, as the 2b probe P01 does; flagged rows through `transition(... 'flagged_mismatch' ...)` from `awaiting_payment`, so their total is NULL), snapshots the lot and draw counts, and runs the cases below as `service_role` through the RPC. Each failed expectation raises `SELFTEST FAIL <case> <detail>` immediately (E-66). On success it emits `RAISE NOTICE 'SELFTEST PASS <case>'` per case and ends normally. No line or string contains "into" except the `INSERT INTO` keyword used by seeding (none needed if all seeding is by RPC); no "SECURITY DEFINER" text anywhere (O-1 tripwire).

| Case | AC | Steps | Expectation |
|---|---|---|---|
| S-01 | 207 | P1 paid 2,500: refund cumulative 1,000 to `partially_refunded` | `transitioned`; 1 `refund` row: amount 1,000, cumulative 1,000, `paid` → `partially_refunded`, currency `USD`, livemode as the purchase, dispute id NULL |
| S-02 | 207 | P1: refund cumulative 2,500 to `refunded` | `transitioned`; 2nd row amount 1,500, cumulative 2,500 |
| S-03 | 207 | P1: re-send 2,500; send 1,000 | `already`; `stale`; still 2 rows |
| S-04 | 207 | P1b paid: partial 400 then partial 900 (partial → partial) | 2 rows, amounts 400 and 500 |
| S-05 | 208 | P2 disputed: refund 500 | `recorded`; 1 `refund` row, before = after = `disputed` |
| S-06 | 208 | P3 dispute_lost: refund 700 | `recorded`; 1 `refund` row, `dispute_lost` both sides |
| S-07 | 208 | P4 flagged (total NULL): refund 300 | `recorded`; 1 `refund` row amount 300, `flagged_mismatch` both sides |
| S-08 | 209 | P5 paid 2,500 with 1,000 refunded: dispute `dp_…a` | `transitioned`; `dispute_opened` amount 1,500, cumulative 1,000 |
| S-09 | 209 | P5: re-send the same dispute | `already`; no new row |
| S-10 | 209 | P5: won, then won again | `transitioned` → 1 `dispute_won` row amount 1,500, `disputed` → `partially_refunded`; second `already`, no row |
| S-11 | 209 | P6: dispute `dp_…b`, then lost, then lost again | `dispute_opened` and `dispute_lost` rows, amounts = remainder; repeat `already`, no row |
| S-12 | 209 | P7 flagged (total NULL): dispute `dp_…c`; then won and lost | `recorded`, 1 `dispute_opened` row amount 0; both closes `already`, no row (PF-6) |
| S-13 | 210 | `awaiting_payment`, `failed`, `expired`, `flagged_mismatch` targets on fresh pending rows | 0 event rows added |
| S-14 | 210 | `not_allowed` (refund on pending; refund above total; partial after full), `not_found` (random uuid), dispute id mismatch on close | 0 rows added |
| S-15 | 211 | Every row of the run | `recorded_at = now()` (one transaction, so equal to the transaction time) |
| S-16 | 211 | As `service_role`: insert naming `recorded_at`; insert naming `id`; `UPDATE`; `DELETE` | each `42501` (sub-block catches `insufficient_privilege`) |
| S-17 | 205 | As `anon` and `authenticated` (with JWT claims set): `SELECT`, `INSERT` | each `42501` |
| S-18 | 213 | After all cases | lot and lot-draw counts equal the snapshot taken after seeding; no `business_os_credit_charges` change |
| S-19 | 207/209 | Idempotency backstop: as `postgres`, insert a duplicate refund step and a duplicate dispute stage directly with `ON CONFLICT … DO NOTHING` | 0 rows added; without `ON CONFLICT` → `23505` |
| S-20 | — | Totals | check 25's `refunds_ok` true and `dispute_ok` true for every purchase of the run (S-12's flagged row: status not `disputed`, so true) |

### 7.2 How it is run (Dev, recorded in §12)

1. Copy the 2b harness (`…/9515a9ff…/scratchpad/pglite/harness.mjs`) to this session's scratchpad `pglite/` and point it at this worktree; reuse an existing PGlite 0.5.8 install or `npm install @electric-sql/pglite@0.5.8` **in the scratchpad only**.
2. `setup`: roles `anon`, `authenticated`, `service_role` (NOLOGIN, `service_role` BYPASSRLS), Supabase-style default privileges, the `auth.users` and `auth.uid()` stubs, the plan-row stub, one owner account (2a §6.8 steps 1 to 5).
3. Apply `20261017`, `20261015`, `20261030`, `20261031`, `20261032` verbatim (CRLF working-tree files). Run **check 23**: expect all ok except the cleanup row (no cleanup function in PGlite; recorded as N/A).
4. Apply `20261072`. Run **check 24** (cleanup row N/A). Confirm the new body md5.
5. `BEGIN; SET LOCAL bos.selftest_local = 'on';` + the script + `ROLLBACK;`. Record every NOTICE.
6. Regression: the 2b checker (`check-bos-boost-purchases-migration.sql`) still `VERDICT PASS`; the 2b probe still `PROBE PASS` (it now also writes events, rolled back).
7. **AC-212:** fresh database, apply up to `20261031`, record a refund through the old function, run check 23 (refund row `ok = false`), apply `20261072` → `MIGRATION REFUSED … refund or a dispute`; table absent; md5 unchanged. Same with a dispute only. Then a hand-altered `20261031` body → the md5 refusal.
8. **AC-215:** with events present the rollback answers `ROLLBACK REFUSED`, nothing changed; on a database with no events it restores md5 `b9a5fe31…`, drops the table, and `20261072` re-applies to a full check 24.
9. **Mutations** (each must make the script FAIL): drop insert [1]; drop insert [6]; swap `- v_refunded` for nothing (amount = cumulative); grant `INSERT (recorded_at)`; remove the `kind = 'refund'` arbiter (`ON CONFLICT DO NOTHING` without target still passes, recorded as a note); grant table `UPDATE`.
10. Delete nothing in the repo; the harness stays in the scratchpad.

---

## 8. Guard and test edits, line by line

### 8.1 Purge descriptor — `lib/business-os/purge/descriptors.ts`

After `:1346` (the `business_os_boost_cap_overrides` entry), inside the "Credits boost slice 2a" group, add:

```ts
  // Finance slice 4b.1 (BD-17, §11I.4): the dated refund and dispute history of a boost purchase.
  never('business_os_boost_reversal_events', { kind: 'via', parent: 'business_os_boost_purchases', fk: 'purchase_id' }, exclude(EXPORT_REASON.BILLING),
    'One append-only, dated row per refund step or dispute stage of a boost purchase: the date Finance counts it in. A financial record: never purged and never archived. No user_id: the account comes through the purchase, and the row is removed only with its purchase (ON DELETE CASCADE).'),
```

### 8.2 Classification baseline — `lib/business-os/purge/__tests__/classification-baseline.json`

- `:3` `"count": 155` → `156`.
- After `:48` (`"business_os_boost_purchases": "never",`) add `"business_os_boost_reversal_events": "never",`.
- `reviewNotes` (after `:166`-ish, alphabetical): `"business_os_boost_reversal_events": "2026-10-17 4b.1: new table (migration 20261072). No user_id; purchase_id -> business_os_boost_purchases CASCADE, no inbound FK, no trigger. Dated money history of a boost purchase: never, excluded from export as billing."` (the "every descriptor is in the baseline" test asks for a dated note, `descriptors.invariant.test.ts:745-749`).

### 8.3 Invariant count — `lib/business-os/purge/__tests__/descriptors.invariant.test.ts`

- `:870` `expect(baseline.count).toBe(155);` → `156`.
- Comment line before it: `// +1 finance 4b.1: business_os_boost_reversal_events (never, via its purchase).`

### 8.4 Ownership inventory — `lib/business-os/businessOwnedTables.ts`

After the `business_os_boost_cap_overrides` entry (`:222-223`), in `USER_OWNED_TABLES`:

```ts
  // Finance slice 4b.1 (§11I.4): no user_id of its own; it follows its purchase.
  business_os_boost_reversal_events:
    'Dated refund and dispute history of a boost purchase. No user_id: it hangs off ' +
    'business_os_boost_purchases (ON DELETE CASCADE), so it follows the account the same way.',
```

(SA-W114: the ownership test says a `via` child needs no entry; the requirement asks for one; harmless either way.)

### 8.5 Export billing list — `lib/business-os/data-export/__tests__/exportClassification.test.ts`

`:1595`: `'subscription_invoices', 'business_os_account_plans', 'business_os_boost_purchases',` → append `'business_os_boost_reversal_events',` (the `business_os_boost_` prefix is not matched automatically, `:1596`). The data-export route tests (`route.characterization.test.ts:336-341`, `route.test.ts:813-817`) are **not** changed: they seed `user_id` rows the events table cannot hold, and the route touches only its 33 section tables.

### 8.6 Cleanup generator — `scripts/generate-test-account-cleanup-sql.ts`

| Line | Edit |
|---|---|
| `:116` (end of the history comment) | Add: `* 20261073: the link business_os_boost_reversal_events -> business_os_boost_purchases (finance 4b.1, ON DELETE CASCADE) reviewed as parent-owned for G-18; no delete step, the purchase delete cascades.` |
| `:117` | `FUNCTION_MIGRATION = '20261073_operator_test_account_cleanup_boost_reversal_events'` |
| `:119` | `PREVIOUS_FUNCTION_MIGRATION = '20261047_operator_test_account_cleanup_audit_actor'` |
| `:377` (after the `business_os_boost_purchases` inbound row) | `['business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', null],` |
| `:546` (`PARENT_OWNED_REASONS`, alphabetical) | `business_os_boost_reversal_events: 'Refund and dispute events of the target boost purchases. No owner column: the account comes through the purchase, which step B removes, and the link cascades.',` |
| New export after `PARENT_OWNED_REASONS` (SA-W105) | `CASCADE_CHILDREN: ReadonlyArray<{ table: string; parent: string; fk: string; reason: string }> = [{ table: 'business_os_boost_reversal_events', parent: 'business_os_boost_purchases', fk: 'purchase_id', reason: '…' }]`. TypeScript only; not rendered into SQL |

Then run the generator. `git diff --stat` must show only the five generated files plus the generator; deletion without insertion stops the work (agent file-write hazard).

### 8.7 Cleanup test — `scripts/__tests__/testAccountCleanupSql.test.ts`

| Line | Edit |
|---|---|
| `:190-194` coverage | `handled` also contains each `CASCADE_CHILDREN.table` **only if** its `parent` is a plan table, its descriptor is `{ kind: 'via', parent, fk }` with the same values, and `INBOUND_FOREIGN_KEYS` lists the edge with owner `null`. Add a negative control: a planted cascade child whose parent is not in the plan is reported missing |
| `:321-328` | Unchanged (the new `null` owner has its `PARENT_OWNED_REASONS` entry) |
| `:433` | The rollback now restores `20261047`, which names the actor: expect `` `'${AUDIT_ACTION}', 'user', v_user_id::text, NULL,\n    ${ACTOR}, ${ACTOR},` `` in `rollbackSql`; comment "The restored 20261047 function names the actor, as applied" |
| `:647-659` `APPLIED` | Add the `20261047` migration and rollback with their LF sha256 (computed at build), comment "Applied to prod (AD-2 convention)"; only after check 23's cleanup row confirms it (SA-W108) |
| New `describe('finance 4b.1: the reversal events link (PF-11, SA-Q66)')` | (a) `INBOUND_FOREIGN_KEYS` has the edge with owner `null`; (b) each of the four generated SQL artefacts carries the `inbound_review` row; (c) the plan has **no** entry for the events table (no delete step); (d) `FUNCTION_REQUIRED_TABLES` does not name it and no generated file names `public.business_os_boost_reversal_events` (no static reference); (e) check 24 carries `cleanupFunctionVersion()` |

### 8.8 Payment write-lockdown scan — `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` (SA-Q71, SA-W106)

| Line | Edit |
|---|---|
| after `:48` | `/** Server-write-only payment tables created after 20261004 (finance 4b.1, SA-Q71). Scanned for callers only: the 20261004 content tests keep TABLES. */ const LATER_SERVER_ONLY_TABLES = ['business_os_boost_reversal_events']; const CALLER_SCAN_TABLES = [...TABLES, ...LATER_SERVER_ONLY_TABLES];` |
| `:347` | `it.each(TABLES)` → `it.each(CALLER_SCAN_TABLES)` |
| `:362` | `for (const table of TABLES)` → `for (const table of CALLER_SCAN_TABLES)` |
| `:351` title | "…any of the twelve tables" → "…any of the server-only payment tables" |

### 8.9 New migration test — `supabase/migrations/__tests__/business-os-boost-reversal-events.migration.test.ts`

Precedent `business-os-boost-crediting.migration.test.ts` (text pins, `read` LF-normalised, `functionBody`). Pins:
1. One `BEGIN;` first and `COMMIT;` last; `SET LOCAL lock_timeout = '5s'` before the `LOCK`; the `LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE` **before** the assertion block, which is **before** `CREATE TABLE` (E-65).
2. The RV-9 predicate exactly (`amount_refunded_minor > 0 OR … stripe_dispute_id IS NOT NULL`) and the md5 literal equals `md5(functionBody(20261031))`.
3. Table: the eleven columns, types, NOT NULLs, defaults; no `user_id` token in the `CREATE TABLE` statement; the FK `ON DELETE CASCADE`; the four CHECKs; the two partial unique indexes with their exact predicates; the two plain indexes; `COMMENT ON TABLE` present.
4. RLS enabled; **no `CREATE POLICY`** anywhere; `REVOKE ALL ON TABLE` from all four roles; `GRANT SELECT` and the nine-column `GRANT INSERT` to `service_role` only, the column list without `id` and `recorded_at`; no `GRANT UPDATE`, `DELETE`, `TRUNCATE` or `ALL` on the table.
5. Function: `CREATE OR REPLACE`, the six-argument signature with the `20261031` argument names, `RETURNS TABLE (out_status text, out_user_id uuid, out_from_status text)`, `SECURITY INVOKER`, `SET search_path = ''`; the five function grant statements after it.
6. **Only the six inserts:** removing every `/^ *INSERT INTO public\.business_os_boost_reversal_events [\s\S]*?DO NOTHING;\n/gm` match from the new body leaves a string **byte-equal** to the `20261031` body; exactly 6 matches; each insert sits directly after one `UPDATE … WHERE purchase_row.id = p_purchase_id;` and directly before an `out_status := 'recorded'|'transitioned'` line; the kinds in order are refund, refund, dispute_opened, dispute_opened, dispute_lost, dispute_won; refund inserts use the refund arbiter, dispute inserts the dispute arbiter.
7. No mention of `business_os_credit_lots` or `business_os_credit_lot_draws` in the new body (AC-213); the table name occurs exactly 6 times in the body (check 24's rule).
8. Paste safety: `\binto\b` exactly 7 times, all keywords (§3.7); no string with `;`, `--` or `'`-escape; ASCII only; no line comment; no "SECURITY DEFINER" text.
9. Rollback: refusal before any `CREATE OR REPLACE`/`DROP`; its function text equals the `20261031` text with `CREATE FUNCTION` → `CREATE OR REPLACE FUNCTION`; the five grants; `DROP TABLE public.business_os_boost_reversal_events` after the function; same lock order.
10. Checks 23 and 24: one statement each, ASCII, no apostrophe in comments, no "into"; check 23 holds the `20261031` md5 and the `20261047` stamp; check 24 holds `md5(functionBody(20261072))` and the E-65 row.
11. The E-66 script: starts with its three local-only guards before the first role switch; contains each case id S-01 to S-20; no "into" outside keywords.
12. A planted negative control for (6): a body with a seventh insert, or one changed original line, fails the comparison.

### 8.10 Not edited (run unchanged, results pasted)

`business-os-boost-crediting.migration.test.ts` (file `20261031` unchanged), `business-os-boost-purchases.migration.test.ts` (the 2b checker is unchanged), `BusinessOsBoostPurchaseRepository.test.ts` (`:519-574` signature pins), `boostRouting.integration.test.ts`, `routerPlacement.guard.test.ts`, `invoiceIntentsStayUnowned.guard.test.ts`, `planSurfaces.guard.test.ts`, `lib/business-os/boost/__tests__/*`, `security-definer-surface.guard.test.ts`, `AdminDeletionPreview.test.ts` (its kept list gains a row; tests use `arrayContaining`), `app/api/admin/test-account-cleanup/__tests__/route.test.ts` (imports the stamp), deprecated `accountDeletionPolicy.ts` / `audit-deletion-coverage.ts` (not touched; the table has no `user_id`).

---

## 9. Questions for SA (SA-W105 to SA-W115)

| # | Where the requirement does not fit the code | Dev proposal |
|---|---|---|
| **SA-W105** | §11I.4 / SA-Q66 say "with CASCADE, no delete step is added". But the cleanup coverage test (`testAccountCleanupSql.test.ts:190-194`) requires **every non-global descriptor** to be in the plan or `MUST_BE_EMPTY`, and a `never` `via` descriptor is non-global. Step B cannot express `via` today (`buildCleanupPlan` maps extras to `user_id`). | A generator constant `CASCADE_CHILDREN` (TS only, not rendered) that the coverage test accepts when the parent is a plan table, the descriptor is `via` that parent and the edge is reviewed parent-owned (§8.6, §8.7). Alternative: teach step B a `via` extra and delete the events explicitly before the purchases (larger generator change, contradicts SA-Q66) |
| **SA-W106** | SA-Q71: "add the table to the fixed list". The fixed `TABLES` is also the content pin of migration `20261004` (`:125-133`, `:166-172`, `:192-204` count and contain exactly twelve tables). Adding to it fails three tests | A separate `LATER_SERVER_ONLY_TABLES`, used only by the two caller scans (`:347`, `:362`) (§8.8) |
| **SA-W107** | The brief asks to confirm the live function body matches `20261031` with `business-os-schema-check`. That skill is select-only; PostgREST cannot read `pg_proc.prosrc`. | (a) Check 23 row with the md5 `b9a5fe31…`; (b) an **in-migration** md5 assertion so the replace refuses if prod's body ever differs (fail closed, nothing applied). Approve (b)? |
| **SA-W108** | `20261073` makes `20261047` the `PREVIOUS` function; the generator rule requires it to be applied history with sha256 pins, and the rollback pin `:433` changes (it now restores an actor-naming function). Nothing in the repo records that `20261047` is applied | Check 23 row "cleanup function is the 20261047 version" (its stamp `789e4758d674b561` in `prosrc`); add the `APPLIED` pins; update `:433`. If the row is false, stop and re-plan |
| **SA-W109** | RV-10 says "the body gains only the inserts", but the inserts need `currency` and `livemode`, which the locked SELECT does not read | `INSERT … SELECT` from the already locked row, so no original line changes and the test proves it byte for byte. Explicit arbiter targets so only the idempotency key is swallowed |
| **SA-W110** | E-66 says "a local database"; F-5 assumed there might be none | PGlite 0.5.8 (PG 18.3) in the scratchpad is the local database (2a/2b precedent). Confirm it satisfies E-66, so no user test-mode refund is needed. Script guards: a `SET LOCAL` marker plus refusal on a real Supabase auth schema |
| **SA-W111** | E-67's order (73 then 72) leaves a bad state if 72 then refuses: events table + `20261047` cleanup → G-18 blocks every account | Rollback procedure: count events first; if > 0 roll back neither (fix forward) |
| **SA-W112** | Existing `20261031` behaviour: a late `charge.dispute.created` for an already **closed** dispute (same id) reopens a `paid` row to `disputed`. The `dispute_opened` insert then conflicts and writes nothing, so check 25 shows `dispute_ok = false` | Record only; RV-8 forbids changing the state machine in 4b.1. Any fix is its own slice |
| **SA-W113** | Checks 23/24 as written in §13 miss column-level grants (`has_table_privilege` only), BYPASSRLS, the body hash and the cleanup version | The strengthened text in §6 supersedes §13's for 4b.1; TL records it in the requirement |
| **SA-W114** | §11I.8 says register in `businessOwnedTables.ts`; the ownership test says a `via` child needs no entry | Register in `USER_OWNED_TABLES` as asked (direction 3 is then satisfied by the descriptor). Or skip, if SA prefers the test's rule |
| **SA-W115** | `20261031` has no `NOTIFY pgrst`; 4b.2 reads the new table through PostgREST | Include `NOTIFY pgrst, 'reload schema';` in both `20261072` and its rollback (harmless; precedent `20261028`, `20261029`) |

---

## 10. User hand-apply steps

Only after SA code approval and QA pass, with the PGlite results recorded in §12. Production, Supabase SQL editor. Each step in a **new editor tab**.

1. **Pre-check.** Paste `scripts/precheck-bos-boost-reversal-events.sql` (check 23) and run it. Expect **8 rows, every `ok = true`**. If any row is false, stop and send the rows to the session.
2. **Apply `20261072`.** Paste the whole of `supabase/migrations/20261072_business_os_boost_reversal_events.sql` and run it once. Expect "Success. No rows returned".
   - `MIGRATION REFUSED …`: nothing was applied. Stop and tell the session.
   - `canceling statement due to lock timeout` (55P03): nothing was applied. Run it once more; if it fails again, stop.
3. **Apply `20261073`.** Paste the whole of `supabase/migrations/20261073_operator_test_account_cleanup_boost_reversal_events.sql` and run it. Expect success.
4. **Post-check.** Paste `scripts/check-bos-boost-reversal-events-migration.sql` (check 24) and run it. Expect **23 rows, every `ok = true`**. If any row is false, stop and send the rows; do not roll back on your own.
5. **Tell the session "applied"**, with the UTC time and the check 24 result. RM then merges 4b.1 by hand (not auto-merge).
6. **Do not use the Danger Zone test-account cleanup from step 2 until the Vercel deploy of 4b.1** (B1-R1). From step 2 to step 3 it refuses at G-18 (the new link is not yet reviewed); from step 3 to the deploy it refuses on the version stamp. Both refusals are by design and change nothing.
7. Nothing else for 4b.1. After the first real refund or dispute (test mode counts), run check 25 (4b.2's QA).

**Rollback (only if the session asks):** run `select count(*) from public.business_os_boost_reversal_events;`. If it is not 0, stop: no rollback, the fix goes forward. If 0: run `supabase/SQL Scripts/20261073_…_rollback.sql`, then `supabase/SQL Scripts/20261072_…_rollback.sql`, then check 23 (all ok again), then RM reverts the 4b.1 PR.

---

## 11. AC mapping

| AC | Proof |
|---|---|
| AC-204 table, columns, CHECKs, indexes | Migration test §8.9 (3); check 24 rows (table, FK, index shape); PGlite §7.2 step 4 |
| AC-205 RLS, no policy, grants | Migration test §8.9 (4); check 24 rows; self-check S-16, S-17 |
| AC-206 signature, INVOKER, path, EXECUTE; repo and webhook tests unchanged | Migration test §8.9 (5); check 24 rows; §8.10 suites unchanged |
| AC-207 partial then full refund, deltas, replays | Self-check S-01 to S-04, S-19 |
| AC-208 refund on disputed, lost, flagged | S-05 to S-07 |
| AC-209 dispute opened, won, lost; repeats; flagged | S-08 to S-12 |
| AC-210 no row for other targets and outcomes | S-13, S-14; migration test (6) |
| AC-211 `recorded_at` transaction time; naming it refused | S-15, S-16; check 24 `recorded_at` row |
| AC-212 refuses with a refund or dispute | PGlite §7.2 step 7; migration test (2) |
| AC-213 no lot or draw written | S-18; migration test (7) |
| AC-214 registrations; G-18 | §8.1 to §8.7; descriptor invariants, ownership, export classification, cleanup tests |
| AC-215 rollback byte for byte, refuses with rows | Migration test (9); PGlite §7.2 step 8 |
| AC-216 user ran checks 23 and 24 | §10 steps 1 to 5, recorded under Commit Info before merge |

---

## 12. Verification plan

Run before SA code review; results pasted here.

| # | What | Command / method |
|---|---|---|
| 1 | New migration test | `npx jest supabase/migrations/__tests__/business-os-boost-reversal-events.migration.test.ts --ci` |
| 2 | Boost migrations unchanged | `npx jest supabase/migrations/__tests__/business-os-boost-crediting.migration.test.ts supabase/migrations/__tests__/business-os-boost-purchases.migration.test.ts --ci` |
| 3 | Cleanup | `npx jest scripts/__tests__/testAccountCleanupSql.test.ts app/api/admin/test-account-cleanup lib/business-os/test-account-cleanup --ci` |
| 4 | Purge / ownership / export | `npx jest lib/business-os/purge/__tests__ lib/business-os/__tests__/businessOwnedTables.test.ts lib/business-os/data-export/__tests__ app/api/user/data-export/__tests__ --ci` |
| 5 | Write-lockdown scan | `npx jest lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts --ci` |
| 6 | Billing / boost | `npx jest lib/repositories/__tests__/BusinessOsBoostPurchaseRepository.test.ts app/api/stripe lib/business-os/boost lib/business-os/billing lib/payments/__tests__/planSurfaces.guard.test.ts --ci` |
| 7 | `npm run test:bos-entitlements` | Expected unchanged plus the new migration test (it is under `supabase/migrations/__tests__`) |
| 8 | `npm run test:authz-guard` | SECDEF surface: `20261073` compliant, `20261072` INVOKER |
| 9 | `npm run lint:hooks`; eslint on touched `.ts` | 0 warnings |
| 10 | Scoped `tsc` | Scratchpad config extending the repo `tsconfig.json` over every touched `.ts`; with a canary `const canary: number = 'x'` → exit 2 with only TS2322; without → exit 0; config and canary deleted. `NODE_OPTIONS=--max-old-space-size=8192`, exit code read directly (schema-check Rule 7) |
| 11 | PGlite | §7.2 steps 1 to 9, every NOTICE and result recorded |
| 12 | Diff hygiene | `git diff --stat` and `--numstat`: no file with deletions and no insertions; generated files only from the generator |

---

## 13. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261072_business_os_boost_reversal_events.sql` | create | Table, RLS, grants, function with six inserts (§3) |
| `supabase/SQL Scripts/20261072_business_os_boost_reversal_events_rollback.sql` | create | §5.1 |
| `supabase/migrations/20261073_operator_test_account_cleanup_boost_reversal_events.sql` | create (generated) | §4 |
| `supabase/SQL Scripts/20261073_operator_test_account_cleanup_boost_reversal_events_rollback.sql` | create (generated) | §5.2 |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | modify (generated) | New `inbound_review` row |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | modify (generated) | New stamp |
| `scripts/generate-test-account-cleanup-sql.ts` | modify | §8.6 |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | §8.7 |
| `scripts/precheck-bos-boost-reversal-events.sql` | create | Check 23 (§6.1) |
| `scripts/check-bos-boost-reversal-events-migration.sql` | create | Check 24 (§6.2) |
| `scripts/test-bos-boost-reversal-events.sql` | create | E-66 self-check (§7.1) |
| `supabase/migrations/__tests__/business-os-boost-reversal-events.migration.test.ts` | create | §8.9 |
| `lib/business-os/purge/descriptors.ts` | modify | §8.1 |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | §8.2 |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify | §8.3 |
| `lib/business-os/businessOwnedTables.ts` | modify | §8.4 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | §8.5 |
| `lib/repositories/__tests__/paymentTablesWriteLockdownMigration.test.ts` | modify | §8.8 |
| `docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B1_REVERSAL_EVENTS_WORKPLAN.md` | create | This file |

No `console.*` file is touched: the generator writes with `process.stdout.write` (a CLI script, unchanged line), the rest are SQL, JSON and tests.

---

## 14. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Missing or wrong INSERT grant makes every refund or dispute RPC fail (42501), failing the webhook claim | Low / high | Migration test pins the grant; S-01 to S-12 run as `service_role`; check 24 nine-column row. A failure rolls the purchase update back too (F-1), so Stripe retries; no half state |
| R-2 | Prod body differs from `20261031`, and `CREATE OR REPLACE` would silently drop a hotfix | Low / high | Check 23 md5 row + in-migration md5 refusal (SA-W107) |
| R-3 | A refund lands in the old body during the apply (E-65 window) and has no event | Very low (1 test purchase, 0 refunds) / medium | `LOCK … EXCLUSIVE` first; check 24 E-65 row; if false, stop (a dated row cannot be invented) |
| R-4 | Lock timeout during the apply | Low / none | Nothing applied; re-run once |
| R-5 | PGlite (PG 18.3) differs from prod (PG 17.4) or from Supabase's real privileges | Low / medium | The SQL uses only long-stable features; check 24 on prod is the proof for grants and RLS |
| R-6 | Cleanup unusable between `20261072` and the 4b.1 deploy | Certain / low | Designed refusals (G-18, then version stamp); user told (§10 step 6) |
| R-7 | `20261047` not actually applied on prod | Unknown / medium | Check 23 cleanup row before anything is applied (SA-W108) |
| R-8 | Rollback half done (73 rolled back, 72 refuses) | Low / medium | Count first; both or neither (SA-W111) |
| R-9 | Re-opened dispute (existing behaviour) leaves `dispute_ok = false` | Rare / low | Recorded (SA-W112); check 25 shows it |
| R-10 | Editor paste hazards ("into", apostrophes, semicolons in strings) | Low / medium | Migration test paste pins (§3.7, §8.9 item 8) |
| R-11 | Accidental truncation of a large file by a tool write (the generator outputs are ~2,000 lines) | Low / high | Generate only through the script; `git diff --numstat` check (§12 #12) |

---

## 15. Estimate

| Work | Days |
|---|---|
| Migration `20261072`, rollback, md5 work | 0.4 |
| Checks 23 and 24 | 0.15 |
| Migration test (incl. the byte-for-byte pin and controls) | 0.4 |
| Generator edits, regeneration, cleanup test edits | 0.35 |
| Descriptor, baseline, invariant, ownership, export, write-lockdown edits | 0.15 |
| PGlite harness, self-check script, AC-212/215 runs, mutations | 0.45 |
| Verification bar, scoped tsc, workplan results | 0.2 |
| **Total** | **≈ 2.1 days** (requirement: about 2 days) |

---

## 16. Task List

- [x] T0: SA workplan review; apply rulings on SA-W105 to SA-W115
- [x] T1: Write `20261072` (§3), compute and record the new body md5
- [x] T2: Write the `20261072` rollback (§5.1)
- [x] T3: Write checks 23 and 24 (§6) with the md5 and stamp values
- [x] T4: Generator edits (§8.6), run the generator, `git diff --stat` check
- [x] T5: Cleanup test edits (§8.7), incl. `APPLIED` pins for `20261047`
- [x] T6: Descriptor, baseline, invariant count, ownership, export list (§8.1 to §8.5)
- [x] T7: Write-lockdown scan list (§8.8)
- [x] T8: New migration test (§8.9) with negative controls
- [x] T9: E-66 script (§7.1)
- [x] T10: PGlite run §7.2 steps 1 to 9; record outputs
- [x] T11: Verification bar §12; paste results
- [x] T12: Status → Code Complete; hand to SA code review
- [ ] T13 (user): §10 steps 1 to 5; record AC-216 under Commit Info

---

## SA Workplan Review

**Reviewed by SA — 2026-10-17, against `f0b5e9d4` and §11I (with E-65 to E-69)**
**Status:** ✅ **APPROVED WITH CONDITIONS** (B1-R1 to B1-R3, all Low). Dev may start. SA applied E-70 to the requirement.

**User action beyond the planned apply steps: none.** PGlite satisfies E-66 (SA-W110), so the test-mode refund fallback (F-5) is **not** needed. Whether `20261047` is applied is proven by check 23's own row, inside the planned step 1, so no separate confirmation is needed (SA-W108).

**Checked against the code**
- **The function.** §3.4 matches `20261031:174-376` line for line, with exactly six inserts, each after the branch's `UPDATE` and before its outcome line.
  - **Insert values.** The `INSERT … SELECT` reads the row just updated: same transaction, row already locked, and the next statement sees the new version. That gives the correct `status_after`, `currency` and `livemode`. The refund delta is `after − v_refunded` (never negative: `stale` returns first). The dispute amount uses `COALESCE(total − refunded, 0)` (the `refund_within_total` CHECK makes it ≥ 0).
  - **Names.** No PL/pgSQL variable shadows `kind` or any column.
  - **Unchanged surface.** Signature, return type, INVOKER, `search_path = ''` and the five function grants are kept.
- **E-65.** `SET LOCAL lock_timeout = '5s'`, then `LOCK … IN EXCLUSIVE MODE` (it blocks `FOR UPDATE` and `UPDATE`, not plain reads), then the RV-9 assertion and the md5 assertion. Check 24 carries the "no refund or dispute recorded without an event" row.
- **E-66.** The self-check runs inside `BEGIN … ROLLBACK`, with two local-only guards (the `SET LOCAL` marker, and refusal when `auth.refresh_tokens` exists), so it also refuses if someone pastes it on production. S-01 to S-20 cover AC-207 to AC-213.
- **E-67.** The rollback order is 73 then 72, both or neither (count first), with fix forward once events exist.
- **E-68.** Pin B is untouched: 4b.1 touches no finance code.
- **Grants and RLS** follow the lockdown conventions: RLS on, no policy, `REVOKE ALL` from four roles, SELECT plus a nine-column INSERT (no `id`, no `recorded_at`), no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER. Service role BYPASSRLS is asserted in checks 23 and 24.
- **Idempotency.** The explicit arbiters (`(purchase_id, cumulative_refunded_minor) WHERE kind = 'refund'` and `(purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund'`) swallow only the key. Any other violation raises and rolls the purchase update back.
- **Editor safety.** SA scanned checks 23 and 24 as written in §6: ASCII only, no apostrophe in a comment, no "into", one statement and one result set each. The migration's "into" is keyword-only and pinned at 7 occurrences.
- **The guard list is complete:** descriptor, baseline 156 with a review note, invariant count, ownership, export billing list, write-lockdown caller scan, generator and its cleanup test, the new migration test, SECDEF surface (72 INVOKER, 73 generated and compliant), the boost and billing suites, `test:bos-entitlements` and `test:authz-guard`.
- **The AC mapping is complete** (AC-204 to AC-216). **The estimate of about 2.1 days is accepted.**

**Rulings SA-W105 to SA-W115**

| # | Ruling |
|---|---|
| **SA-W105** | **Approved:** a TS-only `CASCADE_CHILDREN`, accepted by the coverage test only when the parent is a plan table, the descriptor is `via` that parent with the same FK, and the edge is reviewed parent-owned. A planted negative control is required. This keeps SA-Q66's "no delete step". |
| **SA-W106** | **Approved:** a separate `LATER_SERVER_ONLY_TABLES` for the two caller scans. The `20261004` content pins stay exact. |
| **SA-W107** | **(b) approved, together with (a).** The md5 check sits in the migration after the lock, failing closed, and also in check 23. A `CREATE OR REPLACE` must never silently drop a hand hotfix. |
| **SA-W108** | **Approved; the user does not separately confirm.** Project records say the cleanup runner went live and was used on 2026-10-08 under the app's pinned stamp `789e4758…`. The app refuses on a stamp mismatch, which is strong evidence that `20261047` is applied. SA could not read `prosrc` read-only here (V-8). **Check 23's "cleanup function is the 20261047 version" row is the gate:** it runs before anything is applied. If it is false, stop: nothing is applied, the `APPLIED` pins are withdrawn, and 4b.1 is re-planned. Adding the pins at build is therefore safe. |
| **SA-W109** | **Approved.** `INSERT … SELECT` keeps every original line byte-identical, and the test proves it by subtraction (§8.9 item 6, with its planted control). |
| **SA-W110** | **PGlite satisfies E-66.** Prod is PG 17 and PGlite is PG 18.3, but everything the migration and function use predates both: PL/pgSQL, `ON CONFLICT` with partial-index inference (9.5), column-level grants, `LOCK`, core `gen_random_uuid()` (13), `md5`, and `has_*_privilege`. Nothing behaves differently across 17 and 18 for this code. What PGlite cannot prove (real concurrency, Supabase's real default privileges, editor parsing) is owned by check 24 and the migration test, as §7 says. **No user test-mode refund is needed.** |
| **SA-W111** | **Approved:** count first, then both rollbacks or neither. |
| **SA-W112** | **Record only.** This is existing `20261031` behaviour, and RV-8 forbids changing the state machine here. Check 25's `dispute_ok` surfaces it. Note it as FU-4B-1. |
| **SA-W113** | **Approved:** the §6 checks supersede §13's text for 4b.1 (E-70, applied). |
| **SA-W114** | **Register it** in `USER_OWNED_TABLES` as the requirement asks; it is harmless, and direction 3 is satisfied. |
| **SA-W115** | **Approved:** `NOTIFY pgrst, 'reload schema'` in `20261072` and in its rollback. |

**Required changes (SA verifies at code review)**
1. **B1-R1 (Low). §10 step 6.** The Danger Zone refuses from **step 2** (G-18, until `20261073` is applied), then from step 3 to the Vercel deploy (version stamp). Reword the step to cover "from step 2 until the 4b.1 deploy".
2. **B1-R2 (Low). The self-check script's first lines** state in a SQL comment that it is local only and refuses on a real Supabase database. §10 never names the script.
3. **B1-R3 (Low). The new body md5 and the cleanup stamp** are recorded in §3.6 and in check 24. The migration test and the cleanup test pin them, so `<NEW_BODY_MD5>` and `<NEW_CLEANUP_STAMP>` cannot survive into the PR.

**Requirement edit (SA applied)**
- **E-70 (§13 "Slice 4b checks" intro).** Appended: "For 4b.1, checks 23 and 24 are the strengthened text in the 4b.1 workplan §6: added rows for column-level privileges, the nine INSERT columns, BYPASSRLS, the index shape, the body md5 and the cleanup version (SA-W113, SA-WP-4b1). The 4b.1 PR carries those files."

---

## Implementation Notes (Dev, 2026-10-17)

### What was built

| Item | Notes |
|---|---|
| `20261072` + rollback | Generated from the `20261031` file by a scratchpad builder that inserts the six blocks after their anchors, so every original line is byte-identical (SA-W109). LF in the working tree; git normalises it |
| Values pinned (B1-R3) | Old body md5 `b9a5fe318eb25cdc65ba0402b23d7241`; new body md5 `018c4447f2b52dd87e4ae3b229e5b42c`; cleanup stamp before `789e4758d674b561`, after `f854486b31baf784` |
| `20261073` + rollback | Generated. The SQL diff from `20261047` is the header lines, one `inbound_review` row in each of the two CTE copies, and the stamp. The rollback restores `20261047`, which already names the admin |
| Self-check | `scripts/test-bos-boost-reversal-events.sql`. Its first line reads "LOCAL ONLY. NEVER RUN THIS FILE ON PRODUCTION OR ON ANY SUPABASE PROJECT." (B1-R2). Guards: the `bos.selftest_local` marker, refusal when `auth.refresh_tokens` exists, refusal when read only, refusal before `20261072`. All comparisons are NULL-safe (`IS DISTINCT FROM`); a first mutation run showed that a missing row could slip past `<>` |
| FU-4B-1 (SA-W112) | Recorded only. A late `dispute.created` for an already closed dispute reopens a paid row; its `dispute_opened` insert conflicts, so check 25 shows `dispute_ok = false`. This is existing `20261031` behaviour, not changed (RV-8) |

### Deviations from the plan

All are guard re-pins forced by the new table, or by `PREVIOUS` moving to `20261047`. SA, please confirm.

| File | Why |
|---|---|
| `lib/business-os/data-export/__tests__/exportClassification.test.ts:1296-1306` | The DE-6 totals pin `155 = 33 + 5 + 117` becomes `156 = 33 + 5 + 118` (the new billing exclude). Not listed in §8.5 |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` (SQL login-delete allow-list) | `20261046` is no longer `PREVIOUS_MIGRATION_FILE`, so it is listed as older applied history, built from the generator constant like `20261042` and `20261043` |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` (L8 charge-path allow-list) | `20261047` and its rollback are now history, listed by name like `20261046`. The generator constants cover `20261073` |
| Cleanup test | `CASCADE_CHILDREN` also carries the constraint name, so the coverage check matches the exact reviewed edge |

### Verification (real results)

| # | Check | Result |
|---|---|---|
| 1 | New migration test | ✅ 27 / 27 |
| 2 | `business-os-boost-crediting` + `business-os-boost-purchases` migration tests (unchanged) | ✅ pass |
| 3 | Cleanup: `testAccountCleanupSql.test.ts`, `app/api/admin/test-account-cleanup`, `lib/business-os/test-account-cleanup` | ✅ pass |
| 4 | Purge (all of `lib/business-os/purge/__tests__`), ownership, data-export (lib + route), write-lockdown scan | ✅ 27 suites, 1,027 tests after the two re-pins above (2 failed before them) |
| 5 | Boost / billing: boost repository, `app/api/stripe`, `lib/business-os/boost`, `lib/business-os/billing`, `planSurfaces` | ✅ 73 suites, 4,855 tests |
| 6 | `npm run test:bos-entitlements` | ✅ 281 suites, 8,549 tests (1 failed before the L8 re-pin) |
| 7 | `npm run test:authz-guard` | ✅ 2 suites, 203 tests |
| 8 | `npm run test:gate` (the CI config) | 1,475 suites passed, **9 suites (18 tests) failed**: `contact-drawer` (3), `supabaseFetch`, `openaiPricingAdapter`, `onboarding` (2), `publicEndpointsAreThrottled`, `oneAddressPolicy`. None touches a 4b.1 file. All are source scans or environment ceilings that fail on this Windows CRLF checkout (the known CRLF flake class). CI on Linux is the judge |
| 9 | `npm run lint:hooks`; eslint `--max-warnings 0` on the 11 touched TS files | ✅ exit 0 / exit 0 |
| 10 | Scoped tsc (scratch config, the 11 touched TS files, 8 GB heap) | Exit 2 with **one** error: `exportClassification.test.ts:1936` TS2353. It is on `main` at `:1933` and is not from this diff. With the canary: the canary's TS2322 plus that same error. Canary and config deleted |
| 11 | Frozen pins (LF sha256) | ✅ All byte-identical: AC-173 `3a1a2dd4…f6f8` and helper `b84e0c96…aabf`; A `30f5fc24…2e01`; B `24ff0da7…df9f`; C `98ea0507…1e4b` and helper `02813360…5bd8`; D `1f7cf07a…f144`. No file under `app/` or `lib/business-os/finance/` changed |
| 12 | `git diff --numstat`: no file with deletions and no insertions | ✅ |

### PGlite run

PGlite 0.5.8 (PostgreSQL 18.3), scratchpad harness `pglite/h4b1.mjs`. It applies `20261017`, `20261015`, `20261030`, `20261031` and `20261032` from the CRLF working tree.

| Step | Result |
|---|---|
| md5 before | `b9a5fe318eb25cdc65ba0402b23d7241` ✅ |
| Check 23 before | 8 rows, all ok (the cleanup row is N/A: PGlite has no cleanup function) ✅ |
| Apply `20261072` | Applied; md5 after is `018c4447f2b52dd87e4ae3b229e5b42c` ✅ |
| Check 24 after | 23 rows, all ok (cleanup row N/A) ✅ |
| Second apply | `MIGRATION REFUSED  the transition function on this database is not the 20261031 body` (the md5 guard fails closed) ✅ |
| **E-66 self-check**, in `BEGIN; SET LOCAL bos.selftest_local = 'on'; … ROLLBACK;` | ✅ **`SELFTEST PASS 20 cases S-01 … S-20  events written 16`**. Afterwards 0 events and 0 purchases are kept |
| 2b shared checker | `PASS VERDICT 22 pass 0 fail` ✅ |
| 2b probe | `PROBE PASS` (it now also writes events, which are rolled back) ✅ |
| Rollback with an event (AC-215) | `ROLLBACK REFUSED  the reversal events table holds dated money history  fix forward with a new migration  nothing was changed`. Table present, md5 unchanged ✅ |
| Rollback with no event | md5 back to `b9a5fe31…`, table dropped. Check 23 all ok; re-apply, then check 24 all ok ✅ |
| AC-212, refund present | Check 23's refund row is false. Apply gives `MIGRATION REFUSED  a boost purchase already has a refund or a dispute …`. Table absent, md5 unchanged ✅ |
| AC-212, dispute present | Same refusal, nothing changed ✅ |
| Hand-changed `20261031` body | `MIGRATION REFUSED  … not the 20261031 body`; table absent ✅ |
| Mutations | Drop insert 1 → `FAIL S-05`. Drop insert 6 → `FAIL S-10`. Amount = cumulative → `FAIL S-02`. `recorded_at` insertable → `FAIL S-16`. Table UPDATE granted → `FAIL S-16`. Bare `ON CONFLICT DO NOTHING` (no arbiter) passes, as expected: only the migration test's text pin catches it |

Not provable in PGlite (unchanged from §7): real concurrency (the E-65 window), Supabase's real default privileges, and the SQL editor's parsing. Check 24 and the migration test own those.

---

## SA Code Review

**Code Review by SA — 2026-10-17** (uncommitted on `feature/bos-finance-health-4b`; nothing applied anywhere)
**Status:** ✅ **Code Approved.** No conditions. QA next. The PR then stays **off auto-merge** until the user's §10 steps 1 to 5 are done.

**1. `20261072`, read line by line (SA re-derived every claim with its own script)**
- **Order.** `BEGIN; SET LOCAL lock_timeout = '5s'; LOCK TABLE public.business_os_boost_purchases IN EXCLUSIVE MODE;` comes first. Then one `DO` block holds both refusals: RV-9 (any refund or dispute id) and the fail-closed md5 check against `b9a5fe31…7241` (W107). Only after that come the DDL, RLS, grants and function. `COMMIT` is last. The file is ASCII. `\binto\b` occurs 7 times, all as keywords. There are no line comments and no "SECURITY DEFINER" text.
- **Table.** It has the 11 columns as specified and the FK `ON DELETE CASCADE`. The four CHECKs are kind, amount ≥ 0, cumulative ≥ 0, and dispute id NULL exactly for refunds. There are two **partial unique** idempotency indexes, `(purchase_id, cumulative_refunded_minor) WHERE kind = 'refund'` and `(purchase_id, kind, stripe_dispute_id) WHERE kind <> 'refund'`, plus the `recorded_at` and `purchase_id` indexes and the comment.
- **RLS and grants.** RLS is enabled with **no policy**, and `REVOKE ALL` runs for PUBLIC, anon, authenticated and service_role. service_role then gets `GRANT SELECT` and a nine-column `GRANT INSERT`, which excludes `id` and `recorded_at`. Nothing else is granted.
- **The function, verified by SA's own script:**
  - Removing the six `INSERT … DO NOTHING;` blocks from the new body leaves a string **byte-equal** to the `20261031` body.
  - There are exactly 6 inserts, in the kind order refund, refund, dispute_opened, dispute_opened, dispute_lost, dispute_won.
  - Each refund insert uses exactly the refund arbiter and each dispute insert exactly the dispute arbiter.
  - The header (signature, `RETURNS TABLE`, `LANGUAGE`, `VOLATILE`, `SECURITY INVOKER`, `SET search_path = ''`) is byte-equal to `20261031`.
  - md5s: old `b9a5fe318eb25cdc65ba0402b23d7241`, new `018c4447f2b52dd87e4ae3b229e5b42c`. Both match the pinned values.
  - Insert values are the refund delta `after − v_refunded` and the dispute amount `COALESCE(total − refunded, 0)`. `status_before` is `v_from`; `status_after`, `currency` and `livemode` come from the locked, just-updated row.
- **Function grants and reload.** The five function grants are re-stated, and `NOTIFY pgrst, 'reload schema'` is present.

**Rollbacks.**
- **`20261072` rollback.** It takes the same lock order (purchases EXCLUSIVE, then events ACCESS EXCLUSIVE), then refuses if any event row exists. It restores the function, with its body md5 back to `b9a5fe31…` (SA computed), re-states the grants, drops the table after the function, and sends `NOTIFY`.
- **`20261073` rollback** is generated and restores `20261047`.
- **Both or neither.** §10 enforces this by counting rows first.

**2. `20261073` is genuine generator output.** The cleanup test's "matches the generator output" cases pass. SA's diff against `20261047` shows only the header lines, two `inbound_review` rows for the new edge, and the stamp `789e4758…` → `f854486b31baf784`. That stamp equals `cleanupFunctionVersion.generated.ts` and check 24.

**3. Checks 23 and 24.**
- **Editor safety.** Both are ASCII only, with no apostrophe in a comment, no "into", and one statement each. Check 23 has 8 rows; check 24 has 23 rows.
- **What they prove.** Check 23 proves the starting state: the table is absent, the function is INVOKER, the body md5 is the `20261031` one, service_role has BYPASSRLS, the cleanup stamp is `789e4758…`, and there are no refunds or disputes. Check 24 proves the end state: grants including column-level ones, exactly nine INSERT columns, `id` and `recorded_at` not insertable, the index shape, the new md5, the six-occurrence rule, the cleanup stamp `f854…`, and E-65's "no refund or dispute recorded without an event".

**4. The self-check is local only (B1-R2).** Its header says "LOCAL ONLY. NEVER RUN THIS FILE ON PRODUCTION". It has three guards that fire before any write: the `bos.selftest_local` marker, refusal if `auth.refresh_tokens` exists, and a read-only check. S-01 to S-20 cover every insert path, the no-insert outcomes, privileges, BQ-13 and the backstop. **The coverage is adequate.**

**5. The arbiter mutation.** The migration test's text pin catching it is **enough**. With a bare `ON CONFLICT DO NOTHING`, the only extra violation swallowed would be the random UUID primary key, so the behaviour is practically the same. Correctness is tied to the pinned text.

**6. The three forced re-pins are legitimate. They do not hide anything:**
- **Export totals 155 → 156 (118 exclude).** This is the one new billing-excluded table.
- **The no-deletion-paths allow-list adds `20261046`.** It is an older applied cleanup version, now history once PREVIOUS moves to `20261047`.
- **The L8 / credit-lots allow-list adds `20261047`** and its rollback.

All three files are applied history pinned by sha256 in `testAccountCleanupSql.test.ts` APPLIED. SA recomputed the `20261047` pair (`8294bb81…`, `3a808ed1…`), and both files are unchanged against `origin/main`. Allow-listing a pinned, never-edited file opens no new deletion path.

**7. `test:gate` 9 failing suites: not caused by 4b.1, so they do not block.** SA ran them:
- `contact-drawer`: `bookingsSearchAndPaging`, `jobOverAfterHeldMeeting`, `noIntakeToSendOnADeadJob`;
- `supabaseFetch`;
- `openaiPricingAdapter`;
- `onboarding`: `servicesAreDraftsWithWords`, `theChainHoldsEndToEnd`;
- `publicEndpointsAreThrottled`;
- `oneAddressPolicy`.

That is 9 suites and 18 tests, exactly as Dev reported. The messages show Windows causes, such as backslash paths (`app\api\book\…`), absolute `C:\…` paths in `oneAddressPolicy`, and a `NODE_ENV` ceiling in `supabaseFetch`. The 4b.1 change set (purge, data-export test, test-account-cleanup, `businessOwnedTables`, write-lockdown test, `scripts/`, `supabase/`) is outside every one of their inputs. No failing suite or scanned file differs from the branch base `f0b5e9d4`. The merge queue's Linux `test:gate` is the judge.

**8. Frozen pins, recomputed by SA. All unchanged:**

| Pin | SHA-256 |
|---|---|
| AC-173 pin | `3a1a2dd4…` |
| AC-173 helper | `b84e0c96…` |
| Pin A | `30f5fc24…` |
| Pin B | `24ff0da7…` |
| Pin C | `98ea0507…` |
| Pin C helper | `02813360…` |
| Pin D | `1f7cf07a…` |

**9. User steps (§10) are clear and in the right order:**
1. Check 23: 8 rows ok.
2. Apply 72.
3. Apply 73.
4. Check 24: 23 rows ok.
5. Say "applied", with the time and the result. RM merges by hand.

Step 6 (B1-R1) covers no Danger Zone use from step 2 until the deploy. The rollback note counts first, then both rollbacks or neither, then check 23 and a PR revert. **No other user action is needed.**

**SA re-run** (one at a time, own exit codes, all exit 0)

| Run | Suites | Tests |
|---|---|---|
| `supabase/migrations/__tests__` | 44 | 2349 |
| Cleanup (test, route, stamp) | 3 | 141 |
| Purge, ownership, data export | 19 | 583 |
| Write-lockdown, boost repository, boost, Stripe, `supabase/__tests__` (SECDEF surface) | 39 | 1419 |
| `test:bos-entitlements` | 281 | 8549 |
| `test:authz-guard` | 2 | 203 |

**Code Approved for QA: Yes**

---

## QA Report

**QA — 2026-10-17**
**Test mode:** full
**Strategy used:** A + B + C:
- Jest text pins and guard suites, run one at a time.
- A local PGlite 0.5.8 database (PostgreSQL 18.3) in the QA scratchpad. It was used for checks 23 and 24, the E-66 self-check, AC-212 and AC-215, and mutations.
- A QA-only harness `qa4b1.mjs`, plus Dev's `h4b1.mjs` re-run by QA.
- A scratch `git archive` of origin/main for `test:gate` and for a rebase dry run.

Nothing ran against production.
**Focus:** schema, security, pipeline (migration and guards)
**Skipped:** production checks 23 and 24, which are the user's (§10, AC-216).
**Input source:** prompt + workplan §11 and §12

**Verdict: PASS, with one merge-readiness bug (QA-4B1-1, Medium).** The 4b.1 code is correct. However, origin/main moved during QA (DE-7, PR #446, `5c214310`), and the branch no longer rebases cleanly or stays green. Fix QA-4B1-1 before the PR is opened, and before the user starts §10.

### Suite runs (each alone, worktree on base `f0b5e9d4`)

| Suite | Result |
|---|---|
| New migration test `business-os-boost-reversal-events.migration.test.ts` | 1/1, 27/27 |
| `business-os-boost-crediting`, `-purchases`, `credit-lots` migration tests | 3/3, 212/212 |
| Purge `lib/business-os/purge/__tests__` | 16/16, 364/364 |
| Ownership `businessOwnedTables.test.ts` | 1/1, 14/14 |
| Export `lib/business-os/data-export/__tests__` + `app/api/user/data-export/__tests__` | 4/4, 353/353 |
| Cleanup generator `scripts/__tests__/testAccountCleanupSql.test.ts` | 1/1, 114/114 |
| Cleanup route + stamp (`app/api/admin/test-account-cleanup`, `lib/business-os/test-account-cleanup`) | 2/2, 27/27 |
| Write-lockdown scan `paymentTablesWriteLockdownMigration.test.ts` | 1/1, 35/35 |
| Boost and billing (repository, `app/api/stripe`, `lib/business-os/boost`, `lib/business-os/billing`, `planSurfaces`) | 73/73, 4855/4855 |
| `npm run test:bos-entitlements` | 281/281, 8549/8549 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run lint:hooks` | exit 0 |
| `npm run test:gate` | 1475 passed, **9 failed (18 tests)**, see below |

**Scoped tsc:**
- Config in the scratchpad covering the 11 touched TS files.
- With the canary in `descriptors.ts`: exit 2, the canary's TS2322 plus one other error.
- The file was restored with `cp` and checked with `cmp` (identical; numstat back to 3/0).
- The clean run gives exit 2 with **only** `exportClassification.test.ts:1936` TS2353 (`'scope' does not exist`).
- That error is pre-existing. The same line is `:1933` on `f0b5e9d4` and `:1960` on origin/main, and 4b.1 adds lines above it but does not edit it.

**Pins (sha256 of the LF form; all tracked, 0 diff):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅.

**Diff hygiene:** `git diff --numstat` shows no deletion-only file. 20261073 differs from 20261047 only in the header (2 lines), the two `inbound_review` rows and the stamp `789e4758…` → `f854486b31baf784`. The 20261073 rollback function text is byte-equal to 20261047 from `CREATE OR REPLACE` to the end.

### `test:gate`: 9 suites, all pre-existing or environmental, none caused by 4b.1

The failing suites:
1. `components/crm/contact-drawer/__tests__/bookingsSearchAndPaging.guard.test.ts`
2. `…/jobOverAfterHeldMeeting.guard.test.ts`
3. `…/noIntakeToSendOnADeadJob.guard.test.ts`
4. `lib/__tests__/supabaseFetch.test.ts`
5. `lib/ai/pricing-research/__tests__/openaiPricingAdapter.test.ts`
6. `lib/business-os/onboarding/__tests__/servicesAreDraftsWithWords.guard.test.ts`
7. `…/theChainHoldsEndToEnd.test.ts`
8. `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts`
9. `lib/utils/__tests__/oneAddressPolicy.guard.test.ts`

**Proof:**
- QA ran these 9 against a scratch `git archive` of origin/main `b160102d`, which has none of 4b.1, with a scratch jest config.
- Result: **the same 9 suites and the same 18 test names fail** (a `diff` of the names is identical, with 0 "Cannot find module").
- The export is LF, so these are not CRLF failures. The messages point to Windows: backslash paths (`app\api\book\manage\[token]\…`), absolute `C:\…` paths in `oneAddressPolicy`, and a `NODE_ENV` ceiling in `supabaseFetch` (60000 expected, 20000 received).
- No 4b.1 file is in their inputs. Linux CI is the judge.

### PGlite (QA scratchpad, local only)

- **Check 23 before 72:** 8 rows. 7 are ok; the "cleanup function is the 20261047 version" row is N/A (no cleanup function in PGlite). Run after 72, check 23 correctly turns false (table present, md5 changed).
- **Apply 72:** new body md5 `018c4447f2b52dd87e4ae3b229e5b42c`. **Check 24:** 23 rows. 22 are ok; the 20261073 cleanup row is N/A.
- **E-66 self-check:** `SELFTEST PASS 20 cases S-01 … S-20  events written 16`. Dev's 20/20 is reproduced. Afterwards 0 events and 0 purchases are kept.
  - The guards refuse without the marker (`SELFTEST REFUSED  local only`), when `auth.refresh_tokens` exists (`this is a real Supabase database`), and before 72 (`apply migration 20261072 first`).
- **Independent flows (QA's own, not the self-check):**
  - A partial refund of 600 then a full refund of 2500 gives refund rows 600/600 and 1900/2500, with statuses paid → partially_refunded → refunded. A replay returns `already`; 600 after full returns `stale`; neither writes a row.
  - A disputed purchase gives a 1000 refund, `dispute_opened` 1500, a 200 refund recorded while disputed, and `dispute_lost` 1300. A repeat lost returns `already`; a won with the wrong id returns `not_allowed`.
  - `recorded_at` equals the purchase's `updated_at` from the same transaction. `livemode` true is copied.
  - No credit lot is written.
  - anon and authenticated are refused 42501 on select, update, delete and insert; service_role on update, delete and an insert naming `recorded_at`.
  - Deleting a purchase cascades its events.
- **Dev's harness, re-run by QA:**
  - Rollback with an event: `ROLLBACK REFUSED`, nothing changed.
  - Clean rollback: md5 back to `b9a5fe31…`, table dropped, check 23 ok, re-apply gives check 24 ok.
  - AC-212: a refund, a dispute and a changed body each give `MIGRATION REFUSED` with the table absent.
  - The 2b checker and probe pass.
  - Dev's 5 mutations are all caught. The bare-arbiter mutation is caught only by the migration-test text pin (`migration.test.ts:210,213`), which SA accepted.
- **QA's extra mutations, all caught:**
  - `dispute_lost` written as `dispute_won` (S-11);
  - the dispute amount ignoring refunds (S-08);
  - `status_after` taken from `v_from` (S-01);
  - anon granted SELECT (S-17, plus check 24's anon row).

### Editor safety (step 5)

All seven SQL files were tokenised: checks 23 and 24, 72, the 72 rollback, 73, the 73 rollback and the self-check. In every file:
- **0** non-ASCII characters;
- **0** "into" inside a string or comment (72 has 7, all keywords);
- **0** apostrophes in comments;
- **0** `;` or `--` inside a string.

Checks 23 and 24 are one statement and one result set each (one `;`, no `SET`).

### Test Coverage

| AC | Verdict | Evidence |
|---|---|---|
| AC-204 | PASS | migration test 27/27; PGlite check 24 (table, FK cascade, index shape) |
| AC-205 | PASS | migration test; check 24 rows; QA's 42501 matrix; S-16, S-17 |
| AC-206 | PASS | migration test (signature, INVOKER, `search_path`); check 24 execute rows; boost repository + `app/api/stripe` unchanged and green (73 suites) |
| AC-207 | PASS | S-01..S-04, S-19; QA's 600/1900 flow |
| AC-208 | PASS | S-05..S-07; QA's refund while disputed (`recorded`) |
| AC-209 | PASS | S-08..S-12; QA's dispute opened/lost flow; mutation S-11 |
| AC-210 | PASS | S-13, S-14; QA's `already`/`stale`/`not_allowed` give no row |
| AC-211 | PASS | S-15, S-16; QA's `recorded_at = updated_at` (same transaction) and insert naming `recorded_at` refused |
| AC-212 | PASS | PGlite: refund, dispute and changed body each give `MIGRATION REFUSED`, nothing applied |
| AC-213 | PASS | S-18; QA's lot count unchanged; migration test (7) |
| AC-214 | PASS (tests); live owed | descriptor, baseline 156, ownership, export `BILLING_TABLES`, cleanup coverage + G-18 text tests green. A real G-18 run on prod is only possible after the deploy (first Danger Zone use) |
| AC-215 | PASS | PGlite: refuses with an event; a clean rollback restores `b9a5fe31…`; migration test (9) |
| AC-216 | NOT-TESTED (user) | §10 steps 1 to 5 on production, recorded under Commit Info before merge |

### Issues Found

#### Bugs (must fix before the PR / before §10)
1. **QA-4B1-1: the branch no longer rebases onto main.** Medium. Files: `lib/business-os/data-export/__tests__/exportClassification.test.ts:1294-1307` (the 4b.1 hunk) and origin/main `:296`, `:1320-1331`.
   - DE-7 (#446, `5c214310`) merged during QA and rewrote the same totals test to `155 = 38 include + 0 planned + 117 exclude`. It also added a second pin, `:296` `expect(PURGE_DESCRIPTORS).toHaveLength(155)`, in "no table descriptor is planned".
   - Steps to reproduce:
     1. `git apply --check` the 4b.1 diff onto a scratch export of `5c214310`. This rejects hunk #1.
     2. Resolve only the totals hunk. This leaves **2 tests red**: "the classification totals …" and "no table descriptor is planned (… 155 …)".
   - Expected after the rebase: both `toHaveLength(155)` become 156; the totals become `156 = 38 include + 0 planned + 118 exclude`, with `bySlice` `{}` as on main; the `:296` title becomes "156"; the `BILLING_TABLES` hunk applies cleanly.
   - QA proved that fix in the scratch export: **69/69 suites, 3304/3304 tests green** (data-export, purge, ownership, cleanup, all of `supabase/migrations/__tests__`, write-lockdown, data-export route, cleanup route + stamp).
   - All other 4b.1 files apply cleanly onto `5c214310`. `20261072` and `20261073` are still free on main.
   - **Order:** RM rebases and gets CI green **before** the user runs §10. Otherwise production could hold 72 and 73 while the PR cannot merge, and the Danger Zone stays blocked on the stamp.

#### Performance Issues
None.

#### Edge Cases (nice to fix)
1. **Low.** `§10` rollback names its files as `20261073_…_rollback.sql`. Using the full paths would avoid a wrong pick under stress: `supabase/SQL Scripts/20261073_operator_test_account_cleanup_boost_reversal_events_rollback.sql`, then `…/20261072_business_os_boost_reversal_events_rollback.sql`.
2. **Low, pre-existing.** `exportClassification.test.ts` TS2353 (`:1936` here, `:1960` on main). It is not from 4b.1; noted so that no one counts it against this slice.
3. **Low, recorded.** FU-4B-1 (SA-W112): a late re-opened dispute leaves `dispute_ok = false`. This is existing behaviour and is out of scope.

### User steps review (§10)

The order is correct and clear:
1. check 23: 8 rows ok;
2. apply 72, with refusal and 55P03 handling;
3. apply 73;
4. check 24: 23 rows ok, with no self-rollback;
5. say "applied" with the UTC time;
6. RM merges by hand, not auto-merge;
7. no Danger Zone from step 2 until the deploy (B1-R1).

The self-check is never named in §10 (B1-R2). **One addition:** start step 1 only once the rebased PR (QA-4B1-1) is open and green.

### Final Status
- [x] All code-level acceptance criteria pass (AC-204 to AC-215). AC-216 is the user's.
- [x] **Issue found: QA-4B1-1 (Medium, merge readiness).** RM or Dev must rebase onto origin/main and re-pin both 155 → 156 before the PR and before §10. No code defect is open in 4b.1 itself.

---

## Commit Info

_RM populates. AC-216 (user apply record) goes here before the merge._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-17 | Created (Dev) | Workplan for slice 4b.1: migration `20261072` (table, RLS, grants, six inserts), regenerated cleanup `20261073`, rollbacks, checks 23/24, E-66 PGlite self-check, guard edits, SA-W105 to SA-W115. No code written |
| 2026-10-17 | SA workplan review: **APPROVED WITH CONDITIONS** | SA-W105 to SA-W115 ruled (W108: check 23 is the gate for 20261047; W110: PGlite satisfies E-66, no user test-mode refund). B1-R1 to B1-R3 (Danger Zone wording from step 2, self-check header, md5 and stamp placeholders filled and pinned). E-70 applied to the requirement. No user action beyond the planned apply steps |
