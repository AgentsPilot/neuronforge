# Applying the Business OS entitlements migration

> **Last Updated**: 2026-09-22

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

Paste the whole of `scripts/preflight-bos-entitlements-migration.sql` → **Run**.

You get one table of results. **Read row 0 (`OVERALL`) first:**

| It says | Do |
|---|---|
| `PASS` | Go to step 3 |
| `WARN` | Read every `WARN` row's `what_to_do` column, decide, note it in the PR, then step 3 |
| `FAIL` | **Stop.** Do not apply anything. The `what_to_do` column says what to do instead |

What the rows mean, briefly: **1** nothing is there yet · **2** the three database roles exist · **3** every account has a login record · **4** no account would be counted twice · **5** how big the job is (**note these numbers for the PR**) · **6** nothing is holding the two tables the apply needs to touch · **7** what success looks like · **8** what the read-only setting did.

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

Paste the whole of `scripts/check-bos-entitlements-migration.sql` → **Run**. Read row 0 again:

| It says | Meaning |
|---|---|
| `PASS` | Done. **Paste this table into the PR** — it is the evidence |
| `WARN` | Fine, with something to note — in practice row 54 |
| `FAIL` | Something did not land. Each `FAIL` row names the fix. Most are "run the backfill again", which is safe — but **not on this tab**, which is now read-only |

Two rows to understand before you see them: **row 54** counts accounts that signed up in the gap between steps 4 and 5 (harmless, note the number), and **row 61** will be `0` right now — see step 8.

### 6b. Check the database log

Dashboard → **Logs** → **Postgres Logs**, search for `business_os_plan_fact_`. **Expect nothing.**

This matters because the new triggers are built to fail *quietly* rather than break a customer's signup — so the log is the only place a problem would show. If there are entries, read them and ask; nobody's data was lost.

### 7. Report

In the PR: the step 2 table, the two elapsed times, the step 6 table, row 54's number, the backup date, and "no `business_os_plan_fact_` entries in the log".

### 8. One week later

Paste `scripts/check-bos-entitlements-migration.sql` again and look at **row 61**. Once anyone has signed up since the apply, it must be above `0`. Search the log for `business_os_plan_fact_` once more. These two together are how we know the new triggers work on real traffic — it is a real check, not a formality.

---

## If you want it gone

No rush and no incident: nothing reads these tables. Open `scripts/rollback-bos-entitlements-migration.sql`.

1. **Paste 1** is read-only and tells you what cannot be rebuilt. Export those tables (Table Editor → Export CSV) if the counts are not zero.
2. **Paste 2 refuses to run as written.** Arming it is a one-line edit inside the block: change `v_confirm text := 'NO';` to `v_confirm text := 'DROP-ENTITLEMENTS';`.
3. It finishes with a table saying `PASS` / "all nine objects are gone". Re-running steps 4 and 5 rebuilds everything except anything an admin had set by hand.

---

## Two things worth knowing

**The read-only setting follows the tab, not the script.** Both checking scripts set it, and it stays until that editor connection is recycled. That is deliberate — it is what stops a checking script ever changing anything — and the only cost is the step 4 error above.

**We deliberately did not run the write-tests against production.** Proving one of them needs fake user logins inserted into the real identity table, which is not a fair trade for evidence we can get another way. One property — that a problem creating a plan record can never break a customer's signup — is argued from the code rather than demonstrated. Steps 6b and 8 are how you would notice if that were wrong, and nothing reads these records in the meantime.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Created | Extracted from the workplan (§4.20.3) as a self-contained hand-off for the production apply, written for the operator rather than the team |
