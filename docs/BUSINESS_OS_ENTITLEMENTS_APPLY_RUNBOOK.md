# Applying the Business OS entitlements migration

> **Last Updated**: 2026-09-24

## Overview

This is the hand-off for the one person who runs this: **you, in the Supabase dashboard, against production.** It is self-contained — paste it into the PR description or keep it open in a second tab. No terminal, no `psql`, no repository checkout beyond copying two files out of GitHub.

It adds three tables, four functions and two triggers. **Nothing in the product reads them.** The feature is off by default (`BOS_ENTITLEMENTS_MODE` is unset), so when you finish, customers see exactly what they saw before. That is the point: the risky part is the schema change, and it is being done while it cannot affect anyone.

**Only two of the eight steps change anything: step 4 and step 5.** Everything else reads, or takes a backup. Stopping before step 4 leaves the database exactly as it was.

**One thing will probably go wrong, and it is one line to fix.** Step 2 makes its editor tab read-only on purpose. If step 4 runs on **that same tab**, it fails with *"cannot execute CREATE TABLE in a read-only transaction"* — immediately after step 2 said `PASS`, which looks much worse than it is. Run `RESET default_transaction_read_only;` on that tab, or open a new one, and paste again. Nothing was applied.

---

## What you are running

| File | What it does | Changes anything? |
|---|---|---|
| `scripts/preflight-bos-entitlements-migration.sql` | Checks it is safe to apply | No |
| `supabase/migrations/20261005_business_os_entitlements.sql` | Creates the tables, functions and triggers | **Yes** |
| `supabase/migrations/20261005b_business_os_entitlements_backfill.sql` | Gives every existing account a plan record | **Yes** |
| `scripts/check-bos-entitlements-migration.sql` | Confirms it all landed | No |
| `scripts/rollback-bos-entitlements-migration.sql` | Removes it entirely, if you ever want that | Only when you arm it by hand |

**How to get a file's text:** open it on GitHub (the PR's *Files changed* tab, or browse the branch), click **Raw**, select all, copy. **Use Raw, not the rendered view** — the rendered view copies the line numbers too, and the paste fails on the first one.

---

## The eight steps

### 1. Open the SQL editor

Supabase dashboard → your project → **SQL Editor** → **New query**. It connects as `postgres`, which is the access these scripts need.

### 2. Pre-flight (reads only)

`scripts/preflight-bos-entitlements-migration.sql` is **four separate statements**, run **one block at a time**:

| Block | Starts with | What it answers |
|---|---|---|
| 0 | `SET default_transaction_read_only = on;` | Makes the rest of this tab refuse writes |
| 1 | `WITH expected_objects(kind, object_name) AS (` | Is the database clean, do the three roles exist |
| 2 | `WITH tenants AS (` | Every account has a login record, nobody is counted twice, how big the job is |
| 3 | `WITH parent_locks AS (` | Is anything holding the two tables the apply must touch, and what the read-only setting did |

**Read the `VERDICT` row of each block:**

| It says | Do |
|---|---|
| `PASS` | Next block, then step 3 |
| `WARN` | Look up the row's `fix` key in [the pre-flight reference](#reference-preflight-bos-entitlements-migrationsql), decide, note it in the PR |
| `FAIL` | **Stop.** Do not apply anything. The reference says what to do instead |

**Note the block 2 row 5 numbers for the PR.** The rows carry a short `fix` key instead of a sentence — every sentence is in the reference below.

### 3. Backup

Dashboard → **Database** → **Backups**.

| What you see | Do |
|---|---|
| A backup dated **today** | Note the date and time for the PR. Go to step 4 |
| No backup today, but a button to start one | Start it, wait for it, note the time |
| No backup today and no way to start one | **Stop and ask** — or, if you decide to go ahead, write this in the PR *before* step 4: **"no backup taken; the undo path is the rollback script, not a restore"** |

Do not pass this step silently. The migration being additive makes this unlikely to matter — that is not the same as not mattering.

### 4. Apply the schema

New query tab → paste the whole of `supabase/migrations/20261005_business_os_entitlements.sql` → **Run**.

*Expect:* "Success. No rows returned."

| If it fails with | What it means | Do |
|---|---|---|
| **"cannot execute … in a read-only transaction"** | You are on step 2's tab. **Nothing was applied.** | `RESET default_transaction_read_only;` on that tab (or a new tab), paste again |
| "canceling statement due to lock timeout" | Something was using the tables. **Nothing was applied** | Re-run step 2, wait for row 6 to say `PASS`, paste again |
| "role … does not exist" | Step 2 row 2 would have warned you | Stop and re-read step 2 |
| **Anything else** | Unknown | **Stop.** Do not run step 5. Paste the message into the PR and ask. **Nothing was applied** — the file is one transaction, all or nothing |

### 5. Apply the backfill, straight after

New query tab → paste the whole of `supabase/migrations/20261005b_business_os_entitlements_backfill.sql` → **Run**.

*Expect:* "Success. No rows returned." **Note the elapsed time the editor shows.** Doing this right after step 4 keeps a small gap small — see row 54 below.

| If it fails with | What it means | Do |
|---|---|---|
| **"cannot execute … in a read-only transaction"** | Same as step 4 — a checking script ran on this tab. Nothing was applied | `RESET default_transaction_read_only;` (or a new tab), paste again |
| **"canceling statement due to statement timeout"** | It stopped itself after ten minutes. **Nothing is half-done** — the whole thing rolled back | Just run it again. It is built to be re-run: a second run fills in what is missing and changes nothing else |
| **"violates foreign key constraint"** | An account has no login record — what step 2 row 3 warns about. Nothing was inserted | Stop. Re-read step 2 row 3's advice |
| **Anything else** | Unknown | **Stop and ask**, pasting the message into the PR. Unlike step 4, the tables from step 4 **are** there now — that is fine, they do nothing until this step succeeds. Re-running this step later is safe |

### 6. Check it landed

`scripts/check-bos-entitlements-migration.sql` is **four separate statements**, and it is meant to be run **one block at a time**. Open the file and copy the blocks in order — each is separated by a blank line and starts with `SET` or `WITH`:

| Block | Starts with | What it answers | Grid |
|---|---|---|---|
| 0 | `SET default_transaction_read_only = on;` | Makes the rest of this tab refuse writes | no output |
| 1 | `WITH plan_tables(table_name) AS (` | Do the three tables exist, is RLS on, can a client role touch them | `BLOCK 1 VERDICT` + 5 rows |
| 2 | `WITH entitlement_functions AS (` | The four functions, the two triggers, the three CHECK constraints | `BLOCK 2 VERDICT` + 10 rows |
| 3 | `WITH tenants AS (` | The data the backfill produced, and the counts for the PR | `BLOCK 3 VERDICT` + 9 rows |

You can also paste the whole file at once; the editor will show only the **last** grid, which is why running them one at a time is the recommended way. **Each block is self-contained** — if one fails you still have the others, and you know exactly which one to report.

Read the `VERDICT` row of each block:

| It says | Meaning |
|---|---|
| `PASS` | Done. **Paste the three grids into the PR** — they are the evidence |
| `WARN` | Fine, with something to note — in practice row 54 or 55 |
| `FAIL` | Something did not land. Look up the row's `fix` key in [the check reference](#reference-check-bos-entitlements-migrationsql) below. Most fixes are "run the backfill again", which is safe — but **not on this tab**, which is now read-only |

Two rows to understand before you see them: **row 54** counts accounts that signed up in the gap between steps 4 and 5 (harmless, note the number), and **row 61** will be `0` right now — see step 8.

> **The rows no longer explain themselves.** Every check emits a short `fix` key like `runbook B1` instead of a sentence. The sentences are all below, in the reference section — the SQL files carry no prose and no comments at all, on purpose. See [Why the scripts are boring](#why-the-scripts-are-boring).

### 6b. Check the database log

Dashboard → **Logs** → **Postgres Logs**, search for `business_os_plan_fact_`. **Expect nothing.**

> **Two different names, one mechanism.** The **triggers** are called
> `business_os_plan_on_onboarding` and `business_os_plan_on_profile`; the
> **functions** they call are `business_os_plan_fact_onboarding` and
> `business_os_plan_fact_profile`. Search the *log* for `business_os_plan_fact_`
> (the function writes the warning) and search *pg_trigger* for
> `business_os_plan_on_` (the trigger is what is bound to the table).

This matters because the new triggers are built to fail *quietly* rather than break a customer's signup — so the log is the only place a problem would show. If there are entries, read them and ask; nobody's data was lost.

### 7. Report

In the PR: the step 2 table, the two elapsed times, the step 6 table, row 54's number, the backup date, and "no `business_os_plan_fact_` entries in the log".

### 8. One week later

Run **block 3** of `scripts/check-bos-entitlements-migration.sql` again and look at **row 61**. Once anyone has signed up since the apply, it must be above `0`. Search the log for `business_os_plan_fact_` once more. These two together are how we know the new triggers work on real traffic — it is a real check, not a formality.

---

## If you want it gone

No rush and no incident: nothing reads these tables. Open `scripts/rollback-bos-entitlements-migration.sql`.

1. **Paste 1** is the first two statements (`SET default_transaction_read_only = on;` and the `SELECT`). It is read-only and tells you what cannot be rebuilt. Export those tables (Table Editor → Export CSV) if the counts are not zero — see [the rollback reference](#reference-rollback-bos-entitlements-migrationsql).
2. **Paste 2 is everything from `RESET default_transaction_read_only;` to the end, and it refuses to run as written.** Arming it is a one-line edit inside the `DO` block: find the line reading `v_confirm text := 'NO';` and change `NO` to `DROP-ENTITLEMENTS`, keeping the quotes that are already there. The file carries no comment pointing at that line — this is the pointer.
3. It finishes with a row saying `PASS` and `0 of 9 objects still present`. Re-running steps 4 and 5 rebuilds everything except anything an admin had set by hand.

**Why the drops sit inside the same `DO` block as the arming check:** they used to be nine statements after it, which is safe only if the editor submits the paste as one implicit transaction — true under the simple query protocol, and not something anyone can verify about a UI. In one block, the check and the drops are **one statement**: if it refuses, execution never reaches a `DROP`, however the paste was submitted. It also works on a half-applied migration: every `DROP` is `IF EXISTS`, and the two counts are wrapped in `to_regclass` checks, so a missing table is skipped rather than raising `42P01` and aborting the batch.

---

## Two things worth knowing

**The read-only setting follows the tab, not the script.** Block 0 of the pre-flight and of the checking script sets it, and it stays until that editor connection is recycled. That is deliberate — it is what stops a checking script ever changing anything — and the only cost is the step 4 error above.

**We deliberately did not run the write-tests against production.** Proving one of them needs fake user logins inserted into the real identity table, which is not a fair trade for evidence we can get another way. One property — that a problem creating a plan record can never break a customer's signup — is argued from the code rather than demonstrated. Steps 6b and 8 are how you would notice if that were wrong, and nothing reads these records in the meantime.

---

## Why the scripts are boring

On 2026-09-23, and again on 2026-09-24 after a first round of fixes, pasting these files into the Supabase SQL editor failed with `ERROR: 42P01: relation "a" does not exist`. Every plain single-statement query we handed the operator ran first time; every elaborate file of ours failed.

**We do not know why, and we stopped guessing.** The best theory — that an apostrophe in a comment plus a semicolon inside a string confuses the editor's statement splitter — was tested directly on 2026-09-24 and **disproven**: a two-line file containing both ran fine. So we cannot inspect the parser and cannot predict it, and the answer was to **stop giving it anything to misparse**:

| Rule | Why |
|---|---|
| **No `--` comments anywhere in the file** | A comment is the one thing a statement splitter has to understand and might not. Every word of explanation moved here, where the operator is already reading |
| **No punctuation inside text** | No apostrophes, no semicolons, no `--`. Rows emit short plain labels and a `fix` key instead of sentences |
| **Several small statements, not one large one** | Each block is a standalone `SELECT` that returns its own labelled rows. A splitter that cuts anywhere still produces valid SQL, and the operator can see which block failed |
| **No single-letter aliases** | The failing token was literally `a` — the alias in `CROSS JOIN activity a`. Full table names everywhere means a misparse cannot produce a plausible-looking relation name |
| **No `aclexplode`, no `DO $$` blocks in the checking scripts** | Set-returning functions and dollar-quoted bodies are exactly the constructs the operator's own working queries never used |

**A script that cannot be pasted is worth less than a script with no inline documentation.** That is the whole trade.

---

## Reference: check-bos-entitlements-migration.sql

What each row means, and what to do when it is not `PASS`. The `fix` column of the grid names the entry.

### Block 1 — objects and access

| Row | `fix` key | What it checks, and what to do |
|---|---|---|
| A1 | `runbook A1` | The three tables exist. If not: apply `supabase/migrations/20261005_business_os_entitlements.sql` |
| A2 | `runbook A2` | Row level security is on for all three. RLS off **plus** no policies means anyone holding a table grant reads everything. Re-apply `20261005`, or `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |
| A3 | `runbook A3` | This module defines **no** RLS policies: every read and write goes through `service_role` in the repository layer. A policy appearing here is somebody else's change, and worth asking about |
| A4 | `runbook A4` | No grant to `anon`, `authenticated` or `PUBLIC`. If one exists, an account could read or write its own entitlements. Re-apply the `REVOKE` statements at the end of `20261005` |
| A10 tables | `runbook A10 tables` | `service_role` holds SELECT, INSERT and UPDATE on all three (the `arw` in its ACL entry). Without it every repository call fails with "permission denied". Re-apply the `GRANT` statements at the end of `20261005` |

### Block 2 — functions, triggers, constraints

| Row | `fix` key | What it checks, and what to do |
|---|---|---|
| A8 | `runbook A8` | All four functions exist: `business_os_record_shadow_events`, `business_os_reset_plan_state`, `business_os_plan_fact_onboarding`, `business_os_plan_fact_profile`. If not: re-apply `20261005` |
| A6 | `runbook A6` | All four pin `search_path`. An unpinned `search_path` on a SECURITY DEFINER function is a privilege-escalation route: a caller-controlled schema could shadow a table name |
| A7 | `runbook A7` | The two **fact** functions are SECURITY DEFINER with `lock_timeout=2s`. DEFINER so an INSERT by the account owner can write the plan table; the lock timeout so a lock on the plan table can never stall a customer's onboarding message |
| A5 invoker | `runbook A5 invoker` | The two **callable** functions run as their caller (`service_role`) on purpose. DEFINER would make them usable by anyone who could reach them |
| A5 execute | `runbook A5 execute` | No client role can execute any of the four, and none has a NULL ACL (which would mean the default EXECUTE to PUBLIC). Re-apply the `REVOKE ... FROM PUBLIC, anon, authenticated` lines in `20261005` |
| A10 functions | `runbook A10 functions` | `service_role` can execute the two callable ones (the `X` in its ACL entry). Without it the shadow writer and the admin reset both fail |
| owners | `runbook owners` | Informational, never asserted: ownership is a deployment property. SECURITY DEFINER runs as the owner, so this is who the fact triggers write as |
| A9 | `runbook A9` | Both triggers are bound to the right table **and** the right function, checked by binding rather than by name — a trigger with the right name on the wrong table would record facts for the wrong tenant. **The triggers are `business_os_plan_on_onboarding` (on `onboarding_conversations`) and `business_os_plan_on_profile` (on `business_profiles`); the functions they call are named `business_os_plan_fact_*`.** Different prefix, and worth knowing before you search `pg_trigger` for a `fact_` name and find nothing |
| A11 | `runbook A11` | The three CHECK constraints exist **and** still check what their name claims — each is matched against its definition, so a constraint renamed onto a different expression does not pass. The `tier_expires_at` rule (A-1) is one of them |

### Block 3 — the data the backfill produced

| Row | `fix` key | What it checks, and what to do |
|---|---|---|
| B1 | `runbook B1` | Every tenant has a plan row. If not: apply `supabase/migrations/20261005b_business_os_entitlements_backfill.sql`. It is re-runnable |
| B2 | `runbook B2` | Every backfilled row is a champion with no end date and no tier (U-2 / B-14). A row that is not is either an admin edit or a bug |
| B3 | `runbook B3` | The backfill actually ran. Without this, B1 and B2 both pass on a database where nothing was backfilled and there is nothing to be wrong |
| B4 | `runbook B4` | Facts were healed. Re-run `20261005b`, whose heal step fills exactly these. A NULL fact with no history to fill it from is normal and is not counted |
| Q5 | `runbook Q5` | `WARN` counts pre-existing tenants caught by a trigger **between** the two migrations. Harmless: they are recorded as trials, the launch operation makes them champions at switch-on, and their facts were healed by `20261005b`. Note the number in the PR |
| B5 | `runbook B5` | `WARN` when there are more plan rows than tenants. **Usually benign:** a tenant is counted from the union of business profiles and onboarding messages, so anyone who legitimately reset or deleted their onboarding transcript, with no business profile yet, stops being counted while their plan row correctly stays. Only worth investigating if the gap is large or the rows are recent — then look for an admin `ensure_plan_row` on the wrong id |
| C counts | `runbook C counts` | The numbers for the PR. `of_those_with_no_profile` is the trim list: accounts that opened onboarding once and never came back, currently champions for ever |
| trigger rows | `runbook trigger rows` | Plan rows created by a **trigger** rather than the backfill. Expected to be `0` right after the apply; once new tenants exist it must be above `0`, or the triggers are not firing (step 8) |
| read only | `runbook read only` | Informational. `this statement` is whether the `SET` in block 0 covered this statement too; `this connection` is whether the tab is read-only from now on. Clear it by running `RESET default_transaction_read_only` |
| VERDICT | `runbook block 1` / `2` / `3` | The block verdict. `FAIL` if any row in that block failed, `WARN` if any warned, `PASS` otherwise. **All three blocks must say PASS** |

### What the checking script cannot answer

Behaviour needs writes: that a trigger really records a fact, that a failing plan write cannot fail a product write, that a trial cannot be restarted, the reset function, the arithmetic in the shadow RPC. Those live in `scripts/verify-bos-entitlements-migration.sql`, **which must not be run on production**. Everything in the checking script is structure and data, which is all that can be established without writing.

---

## Reference: preflight-bos-entitlements-migration.sql

| Row | `fix` key | What it checks, and what to do |
|---|---|---|
| 1 clean | `runbook P1` | None of the nine objects exists yet. If some do: **do not apply**. Either the migration already ran (run the checking script instead) or a previous attempt half-landed (run the rollback first). Applying now would **skip** those objects, and the post-apply checks could then pass over a table with the wrong shape |
| 2 roles | `runbook P2` | `anon`, `authenticated` and `service_role` all exist. `20261005` REVOKEs from the first two and GRANTs to the third, and a missing role aborts it. Find out why a role is absent before changing the migration |
| 3 login rows | `runbook P3` | `WARN` when a tenant has no `auth.users` row. **Decide before applying:** the backfill inserts into a table with a foreign key to `auth.users`, so it would abort in full (nothing partially applied). Either add a guard to the backfill SELECT, skipping those accounts deliberately, or find out why they exist. The query that lists them is [below](#optional-queries) |
| 4 one row per tenant | `runbook P4` | The backfill would insert exactly one row per tenant. More rows than tenants means `business_profiles.user_id` is no longer unique, so the backfill LEFT JOIN multiplies rows — and `business_os_reset_plan_state` would later raise "more than one row returned by a subquery". **Do not apply.** Restore uniqueness first |
| 5 size | `runbook P5` | Informational, and **the numbers to put in the PR**. The editor prints its own execution time under the grid: that time is the **read** cost of the backfill, because this block runs the same scan and counts instead of inserting. The insert adds the write on top. `20261005b` sets `statement_timeout` to 10 minutes |
| 6 quiet | `runbook P6` | `WARN` when something has held a lock on `onboarding_conversations` or `business_profiles` for more than 5 seconds. Step 4 needs an ACCESS EXCLUSIVE lock on both for the instant it creates the triggers, and waits 5s for it — so the apply would probably fail with `55P03`, safely, but you would rather know now. The database-wide numbers in the same row are **context**: a live Supabase project always has replication, the dashboard and background jobs running, and none of that is a reason to wait. Re-run in a quieter minute; if it persists, find the session in Dashboard → Database → Query performance |
| 7 what next | `runbook P7` | Clear to apply when rows 1, 2, 3, 4 and 6 all say `PASS`. Then step 4 |
| read only | `runbook read only` | Informational. `this statement` is whether the block-0 `SET` covered this statement too; `this connection` is whether the tab is read-only from now on. **The apply step will fail on this tab** until you run `RESET default_transaction_read_only` |

### Optional queries

Neither is in the script any more, because a commented-out query is still text a parser has to get past. Both are read-only. Paste whichever you need on its own.

Which tenants have no login row (ids only, no names or emails):

```sql
SELECT tenants.user_id AS tenant_without_auth_user
FROM (SELECT user_id FROM public.business_profiles
      UNION
      SELECT user_id FROM public.onboarding_conversations) AS tenants
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE auth.users.id = tenants.user_id)
LIMIT 20
```

How the planner intends to run the scan the backfill does (`EXPLAIN` without `ANALYZE` executes nothing):

```sql
EXPLAIN
SELECT tenants.user_id
FROM (SELECT user_id FROM public.business_profiles
      UNION
      SELECT user_id FROM public.onboarding_conversations) AS tenants
LEFT JOIN (SELECT user_id, min(created_at) AS first_message_at
             FROM public.onboarding_conversations
            GROUP BY user_id) AS onboarding ON onboarding.user_id = tenants.user_id
LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id
```

---

## Reference: rollback-bos-entitlements-migration.sql

**You almost certainly do not need this.** Applying these migrations changes no customer behaviour: nothing in the product reads these tables and `BOS_ENTITLEMENTS_MODE` defaults to `off`. The realistic failure is a partially-applied first migration (a `lock_timeout` while creating a trigger), and the honest fix for that is to run `20261005` **again** — it is written to be re-runnable. Use the rollback only when you want the schema gone entirely.

Paste 1 rows:

| Row | `fix` key | What it means |
|---|---|---|
| plan rows | `runbook R1` | Rebuildable: re-applying `20261005` and `20261005b` recreates them from each tenant's own history |
| set by an admin | `runbook R2` | **Not rebuildable.** Cohorts, tiers and expiry dates somebody chose by hand. Export the table first |
| overrides all | `runbook R3` | **Not rebuildable.** Every grant and its reason. Export first |
| overrides still in force | `runbook R4` | **Not rebuildable**, and these are the ones an account is relying on right now |
| shadow events | `runbook R5` | **Not rebuildable.** The measurement Slice 3 sets its numbers from. Export if shadow mode has run |
| this session | `runbook read only` | Paste 1 leaves the tab read-only, which is why paste 2 opens with `RESET` |
| verification | `runbook R6` | After paste 2: `PASS` with `0 of 9 objects still present` means the database is back where it started. `FAIL` lists what is left — something holds a dependency on it; read the error and drop it by hand. The nine objects are **enumerated, not matched with a `business_os_%` pattern**: a pattern would sweep in objects this script never claimed to drop and report "incomplete" after a rollback that did exactly what it should, mid-incident |

**How to export:** Supabase dashboard → Table Editor → the table → Export as CSV. Do this for `business_os_account_plans` and `business_os_entitlement_overrides` before paste 2 if either count is non-zero.

**Why arming is a manual edit.** Resetting the plan state of **one** account requires a confirm literal and the account id echoed back. The one script that destroys everything cannot ask for less.

---

## Reference: verify-bos-entitlements-migration.sql

**Do not run it on production, and do not paste it into the SQL editor.** It needs psql and a database you can throw away:

```bash
psql "$BOS_DB" -v ON_ERROR_STOP=1 -f scripts/verify-bos-entitlements-migration.sql
```

It is the only one of the four that still carries its own comments, deliberately: psql parses comments correctly, and this file is never pasted into the editor. Its header explains what it proves, what was deliberately removed from it (the lock probe), and how each behaviour it cannot prove here is covered instead.

The reason it is quarantined is not the rollback at the end — every write is inside a transaction that ends in `ROLLBACK`. It is that proving a fact trigger fires requires **inserting rows into `auth.users`**, and if any part of the transaction discipline is lost, those fabricated logins are committed into the production identity table.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | The scripts are comment-free and block-per-paste | After two failed pastes (`relation "a" does not exist`), the checking script was rewritten as four standalone statements with **no `--` comments and no prose in any string**. Every word of explanation moved into this document: a new reference section per script, keyed by the `fix` column of each row, plus [Why the scripts are boring](#why-the-scripts-are-boring). No check changed its predicate, its threshold or its PASS/WARN/FAIL meaning |
| 2026-09-22 | Created | Extracted from the workplan (§4.20.3) as a self-contained hand-off for the production apply, written for the operator rather than the team |
