---
name: supabase-ops
description: How to read Supabase state and prepare a migration for the user to apply in this repo — advisors, logs, migration drift by catalog evidence, the paste-and-check apply flow (pre-check, the user pastes the migration, checker, rollback), paste-safe SQL, key and project lifecycle facts. Use when the user asks to apply the migration, check whether a migration is applied, run or review a pre-check or checker, read Supabase advisors or logs, check migration drift, change or check a Supabase auth or project setting, verify or rotate a Supabase key, or create, pause or restore a project. Used by the main session and by the DevOps (DO) agent. Prevents half-applied migrations, checkers that cannot fail, and "applied" claims read off an incomplete ledger.
---

# supabase-ops

This repo's operating procedure for Supabase. It adds only what is specific to Supabase and points elsewhere for the rest:

| For | Read |
|---|---|
| The eight steps, tiers, approval, order against the deploy, read-only SQL rules (a)–(d), change-record template, public-repo rule | `.claude/skills/env-change-protocol/SKILL.md` — mandatory for every change; not repeated here |
| DO's Supabase tool list, forbidden database clients, where plans go | `.claude/agents/devops.md` |
| Does a column or table exist; phantom-column shapes | `.claude/skills/business-os-schema-check/SKILL.md` |
| Generic Supabase and Postgres guidance: RLS design, indexes, migration authoring | the `supabase:supabase` and `supabase:supabase-postgres-best-practices` plugin skills |
| What a good checker proves; paste-safe SQL checklist | [checker-pattern.md](checker-pattern.md), [paste-safety.md](paste-safety.md) |

Every environment is named **by role** ("the production Supabase project"). Never a project ref, URL, org or plan-per-project fact in tracked text.

---

## 1. Running SQL through `execute_sql`

The only form: `begin read only; <select>; commit;`

- Measured on the plugin server: this returns the select's rows with `current_setting('transaction_read_only') = 'on'`, and a write inside it fails with SQLSTATE `25006`. The rows are not lost behind the `commit`.
- **Never a session-level `SET` through `execute_sql`.** A `set default_transaction_read_only = on;` in the same call leaves the running transaction writeable (`transaction_read_only = off`) — it governs only the *next* transaction, so it is no guard. Whether a `SET` carries to later calls depends on how the server pools connections; do not rely on it either way.
- **Running a repo pre-check or checker:** if it has a `SET default_transaction_read_only = on;` line (older files start with one), drop that line and run the rest inside the wrapper. The body is normally one `WITH … SELECT`, so the rows come back as one result set.
- **Count the rows.** A checker with N gate rows returns exactly N plus its info rows. Fewer rows than that is a failed check, not a pass.

## 2. Reading state (Read tier)

| Topic | Procedure |
|---|---|
| **Advisors** | `get_advisors` for **both** `security` and `performance`, before and after every migration apply, and before calling a new project ready. Compare by lint name and object. A finding that is new after the apply and names an object the migration touched **stops** the step — report it; whether to roll back or accept is SA's ruling. |
| **Where advisor results go** | The full before/after lists go only to the untracked private docs. The tracked record's Evidence field says only "no new advisor finding on objects this migration touched" or "new finding: stopped, see private record" — never a lint name, an object name or a count of open findings. |
| **Logs** | `query_logs` for counts, status codes and error classes over a stated window that brackets the apply or deploy time. Never copy a log line that names a person (rule (c)). |
| **Migration drift** | `list_migrations` reads the platform's history table, which records only CLI or MCP applies. This repo applies by pasting in the SQL editor, so the ledger is incomplete by design (see the header of `scripts/check-migrations-applied.ts`). **The ledger is never evidence either way:** an entry proves an apply once ran, not that the objects still exist (a rollback paste leaves it behind); a missing entry proves nothing. "Applied" is decided only by catalog evidence. Never backfill the ledger. |
| **Catalog evidence** | `to_regclass`, `to_regprocedure`, `pg_attribute`, `pg_constraint`, `pg_policies`, `pg_class.relrowsecurity` / `relforcerowsecurity`, `has_table_privilege`, `has_function_privilege`, `pg_get_functiondef` (hash it with carriage returns stripped). `scripts/check-migrations-applied.ts` sees tables and columns only and needs a service-role env, so it is a main-session tool, never DO's. |
| **Extensions, functions, branches** | `list_extensions`; `list_edge_functions` / `get_edge_function` (source in `supabase/functions/`, config in `supabase/config.toml`); `list_branches`. Read only — deploying a function or creating a branch is not a DO tool. |

Why the incomplete ledger matters: a bulk `supabase db push` would try to re-apply migrations that are already live. It stays forbidden (the database-clients row in `devops.md`).

**What the tools cannot read** — a user dashboard step. Give the user the dashboard area, they report what it shows, the record names the environment by role. If the dashboard has moved, find the current path with `search_docs`.

| Setting | Dashboard area |
|---|---|
| Site URL, redirect URLs | Authentication → URL Configuration |
| Providers, email templates, SMTP, sign-up and password rules, JWT expiry | Authentication → Providers / Emails / Sign In settings |
| Backups and PITR | Database → Backups |
| Network restrictions, API keys | Project Settings |
| Plan, usage, billing | Organization → Billing |

## 3. Repo layout

| Path | Holds |
|---|---|
| `supabase/migrations/` | The apply path. **New** files are `<number>_<slug>.sql` with exactly eight digits, unique, no letter suffix, no timestamp form — a reserved running number, not a calendar date. Enforced by `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts`. Older shapes exist (calendar-date names, shared numbers, letter suffixes, non-SQL docs) and are legacy, not a pattern to copy. |
| `supabase/SQL Scripts/` | Rollbacks (`<number>_<slug>_rollback.sql`) and older hand-applied scripts |
| `supabase/held/` | Reviewed migrations that must **not** be applied yet. They live outside the apply path because a bulk push applies everything in `migrations/` — a "do not apply" comment is not a control |
| `supabase/seeds/` | Test data. Never applied to production |
| `scripts/precheck-*.sql`, `scripts/check-*-migration.sql` | Pre-checks and checkers |
| `supabase/migrations/__tests__/` | Migration text tests (one per migration that has one) and the number guard |

Do not follow the `supabase db push` / `psql` instructions in the older apply READMEs under `supabase/`; this skill is the procedure.

## 4. The migration application flow

Who runs what: **DO or the main session runs the pre-check and the checker** through `execute_sql`. **The user pastes only the migration** (and the rollback if needed). Older workplans and checker headers that say the operator runs or pastes the checker are history.

| # | Step | Who |
|---|---|---|
| 1 | Dev wrote the migration, its rollback, a pre-check and a checker; SA reviewed the DDL. A missing piece goes back to Dev. | Dev, SA |
| 2 | **Pre-check** through the wrapper. Every row `ok`, or stop and apply nothing. It proves the shape the migration expects (column count, absent names, existing dependencies), so a surprise production shape refuses instead of half-applying. | DO / main session |
| 2b | **Prove the checker can fail.** Run the checker once against the pre-apply state. Rows for the new objects must read `FAIL`. A checker that is all `ok` before the apply cannot detect the apply — send it back to Dev. | DO / main session |
| 3 | **Hand over only the migration file:** its repo path, and "paste its full contents in the SQL editor of [environment by role] and run it once". Not the pre-check, not the checker. | User executes |
| 4 | Wait for the user to say it ran, with the result shown (success, or the error text). An error inside the file's single `BEGIN; … COMMIT;` means nothing was applied: run the checker to confirm the pre-apply state, and do not paste the rollback. | User |
| 5 | **Checker** through the wrapper; report each row and the row count (§1). | DO / main session |
| 6 | On `FAIL`: re-read the failing row's catalog fact once — the checker can be the faulty part. Still `FAIL` → see the rollback rule below. | DO / main session |
| 7 | Advisors re-run (§2); change record per `env-change-protocol`. | DO / main session |

**Rollback rule.** For DDL-only and additive changes, the user pastes the rollback file **in the same sitting**, then the checker is re-run to prove the rollback. For a migration that drops or rewrites data, the rollback may restore the shape but not the rows: the plan says "No known undo for data", and on `FAIL` the step is **stop, apply nothing more, escalate to SA and the user** — never a blind rollback.

### When to apply — the timing test

Ask in this order. Labels like "additive" or "destructive" are not enough: a new trigger, a default, a NOT NULL with a backfill, a narrower RLS policy or a wider grant can still break or change the deployed code.

1. **The currently deployed code keeps working against the new schema** → apply **before merge**, and only after SA's code review **and the user's diff approval** (applying earlier orphans the schema if the PR is abandoned).
2. **The new code works against the old schema, but the old code breaks against the new schema** → apply **after the deploy** that stops using the old shape is Ready.
3. **Neither** → the migration must be split into expand and contract parts. Back to Dev and SA; not DO's call.

The migration header's stated timing is copied into the plan. If it disagrees with this test, SA decides — the header does not win by default.

## 5. Keys and credentials (generic facts)

- Two key families: the legacy JWT pair (anon, service role) and the newer publishable and secret keys. Anon and publishable keys respect RLS; service-role and secret keys bypass it.
- Verify a deployed key per `env-change-protocol` step 5. DO never holds, reads or prints a key and never calls a key-returning tool.
- Rotation is user-executed, production tier. A switch of key family can change the env var **name** the code reads, so the plan greps the code for the old name first.
- Which keys a rotation invalidates: check with `search_docs` at use time; not fixed here.

## 6. Project lifecycle (generic facts)

- The plan tier decides backups and PITR, pausing on inactivity and how many active projects are allowed; the free tier has no PITR and pauses idle projects. Check current limits with `search_docs` at use time.
- A project's region is fixed at creation and should match the Vercel function region, or every query pays cross-region latency.
- A project built from a schema baseline inherits the baseline's advisor findings: run the advisors gate (§2) before calling it ready.
- Creating, pausing and restoring a project are user-executed; DO holds no tool for them.

## 7. PostgREST gotchas

- One non-existent column in `.select()` rejects the **whole** query (42703) — use `business-os-schema-check`.
- UPDATE + `.or()` + `.select()` fails with 42703 in production; use `{ count: 'exact' }` with no `.select()` (see `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md`). Matters for any probe that goes through PostgREST.

## 8. Checklist

- [ ] Every SQL call used `begin read only; …; commit;` — no `SET`, no DDL
- [ ] Advisors (security + performance) captured before, privately
- [ ] Pre-check all `ok`; checker shown to `FAIL` on the pre-apply state
- [ ] Timing decided by the test in §4, after the user's diff approval if before merge
- [ ] User handed only the migration file, by path, with the environment by role
- [ ] Checker all `ok` with the full row count; advisors re-run, no new finding on touched objects
- [ ] Record written per `env-change-protocol`, with no ledger claim as evidence and no advisor details in tracked text
