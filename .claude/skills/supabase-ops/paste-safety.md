# Paste-safe SQL checklist

Reference for `supabase-ops` §4 step 3. Applies to every file the user pastes in the Supabase SQL editor: the migration and its rollback. Check the file against this list before handing it over.

| # | Rule | Why |
|---|---|---|
| 1 | The word **"into"** never appears in a string literal or a comment (write "in"). As a keyword it is needed by `INSERT INTO` and has pasted cleanly in applied migrations; in a `DO` block still prefer a direct boolean test (`IF NOT EXISTS (…) THEN RAISE …`) over `SELECT … INTO`. If the migration's text test bans the word file-wide, the test wins. | The SQL editor misreads the word inside literals and comments and fails with an error like relation "a" (or "it") does not exist. |
| 2 | ASCII only, no BOM. | Smart quotes and dashes from a doc break parsing or change a literal. |
| 3 | LF line endings, with a `text eol=lf` line in `.gitattributes` **for each file**: the migration, its rollback, its pre-check and its checker each need their own line. | Windows checkouts otherwise turn the files CRLF; there is no blanket rule for SQL. |
| 4 | No psql meta-commands (`\i`, `\set`, `\gexec`). | The SQL editor is not psql. |
| 5 | One explicit `BEGIN; … COMMIT;`. A statement Postgres refuses inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`) goes in its own separate file, applied on its own. | The apply is all or nothing. |
| 6 | Idempotent guards where the statement allows (`if not exists`, `create or replace`). | A re-run after a partial failure does not error on the parts that landed. |
| 7 | Post-conditions inside the transaction where useful (a `DO` block that raises when the shape is wrong). | A wrong shape aborts the whole apply instead of committing half of it. |

**Enforcement, honestly.** A migration's text test (in `supabase/migrations/__tests__/`, one per migration that has one) checks these rules for that migration. Where a migration has no text test, the person preparing the paste checks the file against this list.
