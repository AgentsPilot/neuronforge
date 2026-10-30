# What a good checker proves

Reference for `supabase-ops` §4. Dev writes pre-checks and checkers; whoever plans the apply uses this list to reject a weak one before the migration is handed over.

A checker proves **presence and behaviour**, with rows that can fail.

| Property | What it looks like |
|---|---|
| Rows that can fail | Numbered rows, each with a check name and `ok` / `FAIL`. Info-only rows are marked as never a gate. Run once on the pre-apply state, the rows for new objects read `FAIL` (`supabase-ops` §4 step 2b). |
| No raising lookups | Use `to_regclass` / `to_regprocedure`, which return null for a missing object. A cast like `'public.x'::regclass` raises an error on the pre-apply state instead of returning `FAIL`, so the step 2b proof cannot run. |
| Known row count | The header states how many gate rows there are. Fewer rows returned than gate rows plus info rows is a failed check. |
| Exact shape | Column count, types, nullability and defaults where they matter, so an extra or missing piece fails. |
| Function body and grants | The function exists (`to_regprocedure`), its body holds the critical clause (`pg_get_functiondef` contains it), and grants are exactly as reviewed (`has_function_privilege` for each role that matters, both true and false). |
| Header | Names the migration, what to do on `FAIL`, and — when a later migration makes an older checker stale — a note that the older one must not be re-run. |

## Grant checks and RLS checks are different checks

Check the control the migration actually uses.

| Control | Check |
|---|---|
| A grant or revoke | `has_table_privilege('<role>', '<table>', '<privilege>')` / `has_function_privilege(…)`. False only if the grant is really gone. |
| An RLS policy | `pg_class.relrowsecurity` (and `relforcerowsecurity` where intended) **plus** the exact `pg_policies` row: command, roles, and the `qual` / `with_check` text. |

Under an RLS policy the role still holds the table privilege, so a `has_table_privilege` row passes or fails for the wrong reason.

**The limit:** a behavioural RLS test needs `SET ROLE`, which the read-only SQL rule (a) forbids. Catalog checks are therefore the strongest evidence DO or the main session can produce through `execute_sql`. A behavioural RLS test belongs in Dev's Jest or integration tests.

## Running it

Through `execute_sql` only, inside `begin read only; …; commit;`. A checker whose first line is `SET default_transaction_read_only = on;` is run without that line (`supabase-ops` §1).
