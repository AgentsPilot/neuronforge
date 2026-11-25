# Workplan: PROD-2, Schema Baseline with an Empty-Diff Proof

> **Last Updated**: 2026-11-23

**Developer:** Dev
**Requirement:** Production build-out, Workstream B1 (items B1a to B1g) of the private environments strategy doc (untracked). The approved scope is quoted in section 1
**Branch:** `feature/prod-2-schema-baseline` (RM creates it from `origin/main`; Dev does not)
**Baseline read:** `origin/main` at `cf379a2a`. Every repo fact below comes from `git show` / `git grep` on that commit, plus DevOps' read-only inventory of 2026-11-23 (private, untracked)
**Date:** 2026-11-23
**Due:** 2026-12-01 (launch target 2026-12-07)
**Status:** In Progress. SA approved with conditions; DV-1 **code approved for QA** (SA re-review 2026-11-23, checker sha256 `bf1a7b31...71ec`, DO-1b passed on that exact file); DV-2 to DV-10 not started

## Overview

The new production Supabase project will be built from **one baseline**: a single schema dump of the staging project (the existing project, which becomes staging), plus the reference data the app needs to boot. We will not replay the 321 migrations and 140 hand-run scripts, because together they do not reproduce the live schema. The baseline is applied once to the new, empty production project. A read-only catalog fingerprint then has to come out **identical** on both projects before production counts as built. From the moment the dump is taken, a forward rule applies: every schema change is a numbered migration, applied to both environments and followed by a fingerprint re-check.

This plan has three parts. The first is a **repo slice (PROD-2a)**: the checker, the seed checker, the hand-written fragments that go before and after the schema, the seed export and import scripts, a failability proof script, README markers and the forward rule, and one Jest text test. None of it is runtime code. The second is an **ops run (PROD-2b)**: the user runs `pg_dump` and `psql` in their own terminal, and DevOps runs the checkers. The third is a small closing PR that fills in the provenance manifest. The highest-risk part is **grants (Risk A)**. A plain dump restored onto a fresh project re-grants the API roles, through Supabase's default privileges. The apply neutralises those defaults during the restore, and the proof compares every ACL.

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Where the baseline lives, and what archive means (Risk C)](#3-where-the-baseline-lives-and-what-archive-means-risk-c)
4. [The apply design and grant parity (Risk A)](#4-the-apply-design-and-grant-parity-risk-a)
5. [Objects outside public (Risk B)](#5-objects-outside-public-risk-b)
6. [Reference data: the seed list](#6-reference-data-the-seed-list)
7. [The empty-diff checker](#7-the-empty-diff-checker)
8. [Timing while migrations keep landing](#8-timing-while-migrations-keep-landing)
9. [The forward rule (B1f)](#9-the-forward-rule-b1f)
10. [What a dump does not carry (B1g checklist)](#10-what-a-dump-does-not-carry-b1g-checklist)
11. [Decisions for SA](#11-decisions-for-sa)
12. [User commands, step by step](#12-user-commands-step-by-step)
13. [Files to create / modify](#13-files-to-create--modify)
14. [Task list, by owner](#14-task-list-by-owner)
15. [Test plan](#15-test-plan)
16. [Open items (read-only queries for TL to run)](#16-open-items-read-only-queries-for-tl-to-run)
17. [Risks](#17-risks)
18. [Rollback](#18-rollback)
19. [SA Review Notes](#19-sa-review-notes)
20. [QA Testing Report](#20-qa-testing-report)
21. [Commit Info](#21-commit-info)
22. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

> B1a link the project · B1b one timestamped baseline · B1c reference/seed data the app needs to boot — **reference data only**, no user rows, no tokens, no business data · B1d archive the historical migrations and scripts for provenance; stop replaying them · B1e **prove it: the diff must be empty** · B1f write the forward rule: timestamped migration, never the dashboard SQL editor · B1g capture what a dump does **not** include (Auth settings, redirect allow-list, storage buckets and policies, role grants, realtime, edge functions, extensions, cron) as a checklist.

The brief adds these constraints. There is no Docker, no Supabase CLI and no `pg_dump` on this machine. The user installs the PostgreSQL 17 client tools and runs every connected command with a password prompt, so no credential ever lands in a file, an env var, the chat or a script. Risks A, B and C are as briefed. The seed holds reference data only. The checker is read-only, deterministic, provably able to fail, follows the existing checker shape, and is safe to paste into the SQL editor. The plan stays correct while other PRs keep landing migrations. Four decisions go to SA.

Three items need wording deviations. SA rules on them in section 11.

| Item | As worded | As planned | Why |
|---|---|---|---|
| B1a | Link the project, commit `project_id` | **Replaced.** No link and no `project_id` | There is no CLI to link with. `supabase-ops` forbids a project ref in tracked text. A committed link also makes a bulk `db push` at the wrong project one command away. The purpose of B1a, knowing which project you are talking to, is met by the apply's empty-target guard (section 4) and by the fingerprint |
| B1b | One timestamped baseline migration | One timestamped baseline **artefact, kept out of git**. Its sha256 and fingerprint are recorded in git | A full dump spells out every grant, which is the grant posture recorded privately, and the repo is public. A tracked dump also trips the SECURITY DEFINER guard's O-1 tripwire (section 3) |
| B1f | Timestamped migration + `db push`, never the SQL editor | Numbered migration (the existing 8-digit convention), applied to **both** environments by the existing `supabase-ops` section 4 flow. No ad-hoc SQL anywhere | `db push` stays forbidden while the history sits in `supabase/migrations/`, because it would replay all of it. The number guard forbids the timestamp form from `20261093` on. Pasting a *reviewed migration file* is the transport, not the forbidden habit |

---

## 2. Analysis summary

| Area | Fact (origin/main or the private inventory, non-private parts only) |
|---|---|
| Live schema (staging) | PostgreSQL 17.4. `public`: 199 tables, 20 views, 221 own functions (plus extension members), 103 triggers, 4 sequences, 3 enums, 368 policies, 1,085 indexes, 1,091 constraints, all owned by `postgres`. Plus schema `operator_private` (1 table) |
| Outside `public` | Trigger `create_user_settings_trigger` on `auth.users` (codified in `supabase/migrations/20261003_codify_create_user_settings_trigger.sql`). 5 storage bucket rows. Extensions `vector` and `btree_gist` installed **in `public`** |
| Not installed | `pg_graphql`, `pg_cron`, `pg_net`. 0 edge functions deployed. 0 tables in the realtime publication |
| Repo history | `supabase/migrations/`: 321 `.sql` + 3 `.md` + `__tests__/` (59 files). `supabase/SQL Scripts/`: 140 `.sql` + README. `supabase/held/`: 1 held migration (not applied, so not in the dump) |
| Apply transport today | `supabase-ops` section 4: the user pastes one reviewed migration in the SQL editor, and DO runs the pre-check and checker through `execute_sql`. `psql` and `db push` against a hosted project are forbidden (`supabase/migrations/README.md`, `.claude/agents/devops.md`) |
| Repo-wide `.sql` scanners | `supabase/__tests__/security-definer-surface.guard.test.ts` **O-1 tripwire**: every tracked or untracked `.sql` outside the three apply dirs must define **zero** SECURITY DEFINER functions. `app/__tests__/tailwind-css-escape.guard.test.ts`: every tracked text file must avoid undecodable CSS escapes |
| Checker shape | `scripts/check-*.sql`: first line `SET default_transaction_read_only = on;`, one `WITH ... SELECT`, a `VERDICT` row and then numbered rows of `check_name / result / detail`. See `scripts/check-approvals-update-policy-migration.sql` |
| Paste safety | `.claude/skills/supabase-ops/paste-safety.md`: the word "into" never appears in a pasted checker, ASCII only, LF line endings with a `.gitattributes` line for each file, no psql meta-commands |
| Operator cleanup | `public.operator_test_account_cleanup` is secret-gated by `operator_private.secrets`. It is **also** the account anonymise path: `lib/business-os/account-deletion/runAccountAnonymise.ts` and `selfServiceDeletion.ts` call it through `lib/repositories/TestAccountCleanupRepository.ts` |
| GraphQL usage | `git grep` across `lib app components hooks` finds no `graphql/v1` or `pg_graphql` reference |
| Region | Vercel production functions run in `iad1` (us-east-1). Staging Supabase is us-east-2. Vercel's function region is a project setting, shared by all environments of the one Vercel project |

No V6 pipeline, plugin, entitlements import, LLM call, API route or repository is involved. No migration is written. This slice adds no new runtime pattern. It does add one new *ops* pattern (a one-time `psql` apply), which SA must approve (D7).

---

## 3. Where the baseline lives, and what archive means (Risk C)

### 3.1 The baseline artefacts: outside git, in a private folder

The `pg_dump` archive, the rendered `schema.sql` and the seed CSVs are written to `%USERPROFILE%/agentspilot-baseline/<STAMP>/`, never under the repo. `<STAMP>` is the UTC time of the dump, for example `20261128T1500Z`. The folder sits outside OneDrive-synced folders and holds no credentials. It is kept for 30 days after production has its own backups, then archived privately. What gets **tracked** is the provenance, in `supabase/baseline/README.md`: the stamp, the source (by role), the migration high-water mark, sha256 of each artefact, the TOC entries filtered out, the PARITY KEY and the seed key.

Why not track the dump, even outside the three dirs:

1. **The grant posture recorded privately would be published.** A dump with privileges kept, which Risk A requires, carries one `GRANT` line per grant.
2. **The O-1 tripwire fails.** The dump defines every SECURITY DEFINER function in `public`, and the tripwire allows zero in any `.sql` outside the three dirs. Tracking the dump would mean adding an exemption to the guard (1 test changed) only to publish (1).
3. Provenance already exists. The history stays where it is (3.2), the dump can be re-taken from staging at any time, and once production exists it is its own source of truth.

The tracked **hand-written** fragments (`supabase/baseline/before-schema.sql`, `after-schema.sql`) define no functions at all, so the tripwire stays green.

### 3.2 Archive means "leave in place, add a README marker"

| Option | Tests changed | Also breaks |
|---|---|---|
| **A. Leave in place + README marker (chosen)** | **0** | nothing |
| B. Move to `_archive/` + guard updates | at least the 24 named whole-folder scanners in the inventory, plus most of the 59 per-migration text tests in `supabase/migrations/__tests__/` (they read their migration by path) | `scripts/check-migrations-applied.ts`, `scripts/audit-deletion-coverage.ts`, `scripts/generate-test-account-cleanup-sql.ts` (reads FKs from the migrations through `scripts/lib/migrationForeignKeys.ts`). The SECDEF guard's anti-vacuity floors of 200/80/1 |

"Archive" becomes a status, not a location. The marker goes at the top of `supabase/migrations/README.md` and `supabase/SQL Scripts/README.md`. It says that files numbered at or below the high-water mark **H** are the historical record, that they are covered by the baseline of `<STAMP>`, and that no environment is ever built by replaying them. It links to `supabase/baseline/README.md`. Every guard keeps scanning the same files and stays green. New migrations keep going in `supabase/migrations/` under the existing number guard.

**Existing tests changed: 0.** New test files: 1 (section 15). Optionally a second, the forward-rule guard in section 9 (SA decides).

The seed must **not** go in `supabase/seeds/`. That folder is test data, and `supabase-ops` section 3 says it is never applied to production.

---

## 4. The apply design and grant parity (Risk A)

### 4.1 Why a plain restore re-opens access

`pg_dump` writes each object's ACL as `GRANT`/`REVOKE` statements *relative to PostgreSQL's built-in default*: owner only for tables and sequences, owner plus `PUBLIC EXECUTE` for functions. On a Supabase project, `postgres` also has default privileges in `public` that grant the API roles (`anon`, `authenticated`, `service_role`) access to every new table, sequence and function. If those defaults are active while `psql` replays `CREATE TABLE`, each table is born with the API-role grants. The dump then only *adds* the grants the source has. It never revokes one the source lacks, because the built-in default never had it. The result: every table or function where staging deliberately has no API-role grant would come out granted in production.

### 4.2 The apply order (one `psql --single-transaction` run, so all or nothing)

| # | Step | Where | Effect |
|---|---|---|---|
| 1 | **Empty-target guard** | `before-schema.sql` | A `DO` block raises, and so aborts the whole run, if `public` holds any relation or any function that is not an extension member, or if `operator_private` exists. **This is what stops the baseline ever being applied to staging.** It also raises if `pg_graphql` is installed while D2 says off |
| 2 | Create `vector` and `btree_gist` `WITH SCHEMA public` | `before-schema.sql` | Before step 3, *if* OQ-3 shows the staging extension members carry the API-role grants (they were created under the defaults). Otherwise after step 3. The version follows D8 |
| 3 | **Neutralise** `postgres`'s default privileges: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES / SEQUENCES / FUNCTIONS FROM anon, authenticated, service_role`, plus any global (no-schema) `postgres` rows the production pre-check reports | `before-schema.sql` | The restore now runs under built-in defaults only, which is exactly `pg_dump`'s model. `PUBLIC` is **not** touched, because the dump relies on the built-in `PUBLIC EXECUTE` and emits `REVOKE ... FROM PUBLIC` wherever staging removed it |
| 4 | The rendered dump | `schema.sql` | Objects are created owner-only, then the dump's ACL pass reproduces staging's grants exactly. Its `DEFAULT ACL` entries for `postgres` then **restore** staging's default privileges, so future migrations grant the same way on both environments |
| 5 | Out-of-public pieces (section 5) | `after-schema.sql` | `auth.users` trigger, 5 bucket rows, `NOTIFY pgrst, 'reload schema'` |
| 6 | Seed import (section 6) | `seed-import.psql` | Data only, with no new objects, so the default-privilege state no longer matters |

The dump is rendered offline from a custom-format archive with `pg_restore --use-list`. Two kinds of TOC entry are commented out, and the change is recorded in the manifest:

- `DEFAULT ACL` entries owned by a role other than `postgres` (for example `supabase_admin`). They fail as `postgres`, and they are Supabase-managed on both sides.
- A `SCHEMA - public` creation entry, if one is present (the schema already exists).

The schema's own ACL and comment entries are kept. Nobody hand-edits `schema.sql`.

### 4.3 How the proof covers it

The checker compares ACLs as **exploded, grantor-free sets**: `aclexplode(coalesce(acl, acldefault(kind, owner)))` gives `(object, grantee, privilege, grantable)`. That works for relations (`relacl`), columns (`attacl`, which matters for the column-level token lockdown), functions (`proacl`), types (`typacl`), schemas (`nspacl`), `postgres`'s default ACLs (`pg_default_acl`) and extension-member functions. Grantor and aclitem order are deliberately ignored. A restore as `postgres` can legitimately change both without changing who can do what. A NULL ACL is expanded to its default, so "never granted" and "explicitly default" compare equal. Section 15 shows the ACL rows failing on a deliberate difference.

The production project is not reachable by the app until PROD-3 wires the Vercel Production env. A wrong ACL found by the proof has therefore never been exposed.

---

## 5. Objects outside public (Risk B)

| Object | Carried by | Proof row |
|---|---|---|
| `create_user_settings_trigger` on `auth.users`, which calls `public.create_user_settings()` | `after-schema.sql`: `CREATE TRIGGER` text taken from staging's `pg_get_triggerdef` (OQ-1). The function itself comes with the dump | P19 |
| Schema `operator_private`, table `operator_private.secrets` | The dump (`--schema=operator_private`, **schema only**). The one row is a secret hash and is **never** copied: the dump is `--schema-only`, the seed list does not name it, and a Jest assertion checks that no tracked baseline file names it in a data statement | P01, P09, P14. Post-apply check: 0 rows in production |
| 5 storage buckets (`avatars`, `website-images`, `contact-documents`, `business-data-exports`, `business-purge-snapshots`) | `after-schema.sql`: `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) ... ON CONFLICT (id) DO NOTHING`, with values read from staging (OQ-8). This is the same statement shape as the migrations that created them. Objects are not copied | P20 |
| Storage policies (zero on `storage.objects`, kept at zero) | Nothing to carry | P21 |
| `vector`, `btree_gist` in `public` | `before-schema.sql`, which is needed because `pg_dump --schema` emits no `CREATE EXTENSION` | P16, P17 |
| Anything else of ours in `auth`, `storage`, `realtime`, `extensions`, `vault`, `graphql_public` | OQ-1 lists it. The inventory found none beyond the trigger. Anything found gets a line in `after-schema.sql` | I7 (info: objects owned by `postgres` in managed schemas) |

The held migration `supabase/held/20260916b_purge_business_data.sql` is not applied on staging, so it is not in the dump. It stays held, and on release it is applied to **both** environments under the forward rule.

---

## 6. Reference data: the seed list

### 6.1 The 19 tables (954 rows)

| # | Table | Rows | Why it is needed to boot |
|---|---|---|---|
| 1 | `ai_model_pricing` | 55 | Every LLM cost calculation reads it. Retired rows are kept because the catalogue's retirement flags belong to the catalogue |
| 2 | `ais_system_config` | 59 | AIS model-routing configuration |
| 3 | `ais_scoring_weights` | 24 | AIS scoring. Serial, so `setval` |
| 4 | `ais_normalization_ranges` | 23 | AIS score normalisation |
| 5 | `pricing_config` | 23 | Credit pricing |
| 6 | `system_settings_config` | 217 | App settings, including Business OS model settings and database flags. `updated_by` is nulled |
| 7 | `memory_config` | 5 | Memory system configuration |
| 8 | `model_routing_config` | 3 | Model routing |
| 9 | `boost_packs` | 3 | Credit top-up catalogue. Copied as is (none active, no Stripe ids) |
| 10 | `storage_plans` | 5 | Storage quota tiers |
| 11 | `reward_config` | 3 | Reward rules (the parent of 12) |
| 12 | `reward_settings` | 1 | Reward settings. FK to `reward_config`, so it loads after it |
| 13 | `exchange_rates` | 43 | Currency labels and the admin rates page. `updated_by` is nulled. Its insert/update trigger is suppressed during load |
| 14 | `capabilities` | 11 | Capability catalogue (the parent of 15) |
| 15 | `capability_building_blocks` | 34 | FK child of `capabilities` |
| 16 | `help_articles` | 342 | Help bot content, embeddings included (124 rows) so semantic help search works on day one. Serial, so `setval` |
| 17 | `helpbot_page_contexts` | 12 | Help bot page mapping |
| 18 | `plugin_semantic_ops` | 85 | Plugin operation semantics used by agent generation |
| 19 | `website_archetypes` | 6 | Website builder templates |

**Excluded:** `exchange_rate_history` (18 rows). It is an audit trail of staging admin edits and carries actor ids, so production's history starts at its first edit. Also excluded: `agent_templates`, `ai_model_image_pricing`, `intent_examples`, `workflow_patterns`, `global_failure_patterns` (empty, nothing to copy), `operator_private.secrets` (a secret), and every table with a user, tenant, token or business column.

**Not seed, but needed before go-live** (PROD-3/4 provisioning, listed in the B1g checklist): the first `admin_users` row (it FKs a production login that does not exist yet), production's own operator secret hash (D3), and any `system_settings_config` key that OQ-6 marks as environment-specific. Those keys are seeded with the staging value and then set through the admin UI.

### 6.2 How the traps are handled

| Trap | Handling |
|---|---|
| `auth.users` FK columns (`updated_by` and any others OQ-5 finds) | Nulled **at the source** in the export: `\copy (SELECT <explicit column list with NULL AS updated_by> FROM public.<t> ORDER BY <pk>) TO '<t>.csv'`. No staging user id reaches the artefact |
| Triggers on insert (`updated_at` triggers, the `exchange_rates` trigger) | `ALTER TABLE public.<t> DISABLE TRIGGER USER` before each `\copy ... FROM`, and `ENABLE TRIGGER USER` after, inside the same transaction. FK triggers stay **on**, so a wrong load order or an un-nulled auth FK fails the load instead of slipping through. Proof row P05 compares `tgenabled`, so a trigger left disabled fails parity. (`session_replication_role = replica` was rejected because it also switches off FK checks) |
| Serial `setval` (2 tables) | `SELECT setval(pg_get_serial_sequence('public.<t>', 'id'), (SELECT max(id) FROM public.<t>))` after load. The seed checker asserts that the next value cannot collide |
| Generated / identity columns | Excluded from the column lists if OQ-5 finds any |
| Consistency | The export runs inside `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, so all 19 tables come from one snapshot |
| Header drift | The import uses `\copy ... WITH (FORMAT csv, HEADER MATCH)` (PostgreSQL 15+). A column-name mismatch refuses |

Seed proof: `scripts/check-baseline-seed.sql` gives one row per table with row count and `md5` of the sorted `(to_jsonb(row) - <nulled columns>)::text`. It also prints a SEED KEY and an info row with the session `TimeZone`, which must match on both sides. The same rows on staging (at export) and production (after import) prove the copy.

---

## 7. The empty-diff checker

### 7.1 Shape

`scripts/check-schema-parity.sql`. It is read-only: first line `SET default_transaction_read_only = on;`, then one `WITH ... SELECT`, with no DML or DDL keywords outside comments. It is paste-safe: ASCII, LF, no psql meta-commands, no single-letter aliases, and the standalone word "into" appears nowhere, comments included. It reads the catalog plus `storage.buckets` configuration and never reads table data. It runs the same way through `execute_sql`, the SQL editor and `psql`.

Rows, in order. **Summary mode returns exactly 39 rows** (the header says so, and T4 pins it). Revised for SA B-2 to B-5, A-3 and A-6 (DV-1, 2026-11-23):

| Row | Content | Gate? |
|---|---|---|
| `VERDICT` | PASS when the fingerprint is *complete*: every P section has at least one line and G1 has none. **Completeness only** (SA B-3): no documented P00 values are hard-coded, so the checker is not tied to one client. FAIL on an empty project. Detail: `n pass m fail` plus the reading order | yes |
| `P00` | Deparse context: `search_path`, `TimeZone`, `DateStyle`, `IntervalStyle`, `extra_float_digits`, `quote_all_identifiers`, `standard_conforming_strings`, `bytea_output`, `server_encoding` (SA B-3 added the last two). Printed in clear, because they are session settings, not secrets | yes (completeness) |
| `P01` to `P26` | One row per section (7.2). Detail is `<n> lines, md5 <hash>` for structural sections and **`md5 <hash>` only** for the seven privilege sections (P08, P09, P10, P15, P17, P24, P25), so the output never carries a grant count (SA B-4) | yes |
| `G1` | ACL items on our relations, columns, functions and types whose grantor is not the object owner (SA A-3). Result only: detail `none` or `present`, never a count. Schema ACLs are left out on purpose: OQ-13 decides how a foreign grantor on the `public` schema ACL is handled | yes |
| `CONTEXT KEY` | md5 of P00. **Compared first.** Unequal means the comparison is **VOID**, not FAIL: re-run both sides in one client (SA B-3) | compared |
| `PARITY KEY` | md5 of the P01 to P26 hashes, in order. P00 is **not** in it. **The one value to compare** once CONTEXT KEY matches | compared |
| `I1` to `I8` | Info, never a gate and in neither key: server version; extensions in managed schemas; `pg_graphql` present or absent; I4, every default ACL outside P15 (`supabase_admin` and every other role, plus `postgres` in managed schemas), md5 only (SA A-6); event triggers; database-level and `authenticator`/`postgres` setting names (values hashed, never printed); objects owned by `postgres` in managed schemas; **I8 reconciliation counts** per schema (SA B-2, see 7.4) | no |

**Reading rule.** (1) VERDICT is PASS on both sides. (2) CONTEXT KEY equal, otherwise VOID. (3) PARITY KEY equal means the diff is empty. Unequal is a FAIL: compare the P rows to find the sections, then use lines mode privately to find the lines.

A `run_mode` parameter (`'summary'`, as committed) can be switched to `'lines'`. Lines mode adds every line behind each hash, so a mismatching section can be diffed. **Lines-mode output shows the grant posture.** It goes only to the private record, never to chat or a tracked file. **DO never runs lines mode through `execute_sql`**, because its rows would land in the chat transcript (SA B-7). Only the user runs it, in the SQL editor using download as CSV (the result grid truncates), or in `psql` writing to the private folder. Setting values stay hashed even in lines mode.

**Anchors (SA B-2).** P05, P10, P15, P19, P21, P22 and P23 can legitimately have nothing to report. Each emits an anchor line built from the population it scanned (P15's are constant: `anchor | default ACL scan | public / operator_private / GLOBAL`, SA code review 3) (for example P21: one line per `storage.objects` / `storage.buckets` with its RLS flags and policy count). So a section that returned nothing at all fails VERDICT, while one with nothing to report still shows its anchor.

### 7.2 Sections (from DevOps' catalog list)

Every section covers `public` and `operator_private` and excludes extension members (`pg_depend.deptype = 'e'`), except where noted. Lines are sorted `COLLATE "C"` before hashing, so the database collation cannot change the order. No OID ever appears in a line. Identity comes from names, `regclass`/`regprocedure` text or `pg_identify_object`.

| # | Section | Line content |
|---|---|---|
Every ACL section is an **exploded, grantor-free set**, aggregated `DISTINCT`, so a privilege held from two grantors is one line and a missing revoke shows up as an extra line (SA A-7). `relacl`, `proacl`, `typacl` and `nspacl` are exploded as `coalesce(acl, acldefault(kind, owner))`. `attacl` and `defaclacl` are exploded as they are, never NULL-expanded (SA B-6). As shipped in DV-1:

| # | Section | Line content |
|---|---|---|
| P01 | Relations | schema, name, relkind, relpersistence, owner, sorted `reloptions` (carries `security_invoker`), `relrowsecurity`, `relforcerowsecurity`, plus `relreplident`, `relispartition`, the partition bound, the partition key, inheritance parents and the access method (SA B-5) |
| P02 | Columns | table, ordinal among live columns (so dropped-column gaps in staging do not count), name, `format_type`, not-null, default expression, identity, generated, collation, storage, compression, statistics target |
| P03 | Constraints | table, name, type, `pg_get_constraintdef` |
| P04 | Indexes | `pg_get_indexdef`, clustered, replica-identity flag, `indisvalid` (an index left invalid on staging comes back valid from a dump; SA code review 8) |
| P05 | Triggers | non-internal only (internal FK triggers have OID-derived names): table, name, `tgenabled`, `pg_get_triggerdef`. **Anchor:** `internal triggers not enabled: n`, because disabled FK enforcement would otherwise pass (SA B-5) |
| P06 | Views | name, kind, `md5(pg_get_viewdef(oid, true))` (views and materialized views) |
| P07 | Functions | schema, name, identity args, kind, `md5(replace(pg_get_functiondef(oid), chr(13), ''))` (aggregates hash their `pg_aggregate` row instead, chosen by `CASE`, because `pg_get_functiondef` raises on them), `prosecdef`, sorted `proconfig`, owner. **CR is stripped**, so line endings never change a hash |
| P08 | Function ACLs | exploded `proacl` (grantee, privilege, grantable; `PUBLIC` for grantee 0) |
| P09 | Relation ACLs | exploded `relacl`, with the default kind `s` for sequences and `r` otherwise |
| P10 | Column ACLs | exploded `attacl` where non-null. **Anchor:** one line per scanned schema |
| P11 | Policies | table, name, command, permissive, sorted role names, `USING` and `WITH CHECK` expressions |
| P12 | Types | **structure only**: enum labels in sort order, domains (base type, not-null, default, collation, named constraints), ranges, standalone composite types, other kinds by input/output function. The ACL lines are P24, so this count is never a privilege count (SA B-4) |
| P13 | Sequences | type, start, increment, min, max, cache, cycle, owned-by column. **Not** `last_value`, which is data |
| P14 | Schemas | **structure only**: owner, comment hash. The ACL lines are P25 (SA B-4) |
| P15 | Default ACLs of `postgres` | **our schemas plus `GLOBAL` only** (SA A-6): schema (or `GLOBAL`), object type, exploded `defaclacl`. `postgres`'s rows in managed schemas and every other role's rows (including `supabase_admin`) are I4, by hash. **Anchor:** three constant lines, so P15 stays md5-only and can be legitimately empty after a lockdown (SA code review 3) |
| P16 | Extensions in our schemas | name, version, schema, owner |
| P17 | Extension-member function ACLs in our schemas | extension, identity, exploded `proacl`. **Functions only, accepted (SA code review 9):** ACLs on extension member types (for example `vector`) are not compared |
| P18 | Comments | `pg_identify_object` type and identity + `md5` of the CR-stripped description, for every commentable object in our schemas (constraints, triggers, policies and rules found through their table). Schema comments are P14 |
| P19 | Our triggers on managed-schema tables | triggers on tables outside our schemas whose function lives in our schemas. **Anchor:** one line per `auth`, `storage`, `realtime` with present or absent |
| P20 | Storage buckets | id, name, public, size limit, sorted MIME types (configuration rows only) |
| P21 | Storage policies | as P11, for tables in `storage`. **Anchor:** one line for each of `storage.objects` and `storage.buckets`: present, RLS flags, policy count |
| P22 | Realtime publication | **Anchor:** the `supabase_realtime` line with present and its flags. Then member tables (with row filter and the column list printed as sorted column names, never attnums; SA code review 7) and member schemas |
| P23 | API-role settings | **Anchor:** one line per `anon`, `authenticated`, `service_role`: present, `rolbypassrls`, `rolinherit`, `rolcanlogin`. Then `pg_db_role_setting` for them, all databases or this one: setting name + `md5(value)` |
| P24 | Type ACLs (new, SA B-4) | exploded `typacl` of the P12 types |
| P25 | Schema ACLs (new, SA B-4) | exploded `nspacl` of our schemas |
| P26 | Object census (new, SA B-5) | per catalog, the count of objects that depend on our schemas (`pg_depend`, deptype `n`), plus every non-view rewrite rule (md5 of `pg_get_ruledef`) and every extended statistics object. An object kind that no other section models (an operator, an opclass, a collation) still moves this section |
| G1 | Grantor gate (new, SA A-3) | ACL items of P08, P09, P10 and P24 whose grantor is not the owner. Must be empty |

### 7.3 Skeleton (as reviewed by SA; superseded by the shipped file)

> **DV-1 note:** kept as the reviewed design record. The shipped `scripts/check-schema-parity.sql` differs where SA's conditions required it: P00 is out of the PARITY KEY and has its own CONTEXT KEY row, VERDICT is completeness only, ACL lines come from one `acl_items` CTE aggregated `DISTINCT`, the summary prints the lines behind each hash in lines mode instead of filtering the report away, and P24 to P26 and G1 are added. Read the shipped file, not this abridgement.

**File:** `scripts/check-schema-parity.sql` (abridged: P00, one structural, one ACL and the function section, then the summary)

```sql
SET default_transaction_read_only = on;

WITH params AS (
  SELECT 'summary'::text AS run_mode
),
our_schemas AS (
  SELECT nsp.oid AS nsp_oid, nsp.nspname
  FROM pg_namespace AS nsp
  WHERE nsp.nspname IN ('public', 'operator_private')
),
ext_member AS (
  SELECT dep.classid, dep.objid FROM pg_depend AS dep WHERE dep.deptype = 'e'
),
lines AS (
  SELECT 'P00' AS section,
         concat_ws(' | ', current_setting('search_path'), current_setting('TimeZone'),
                   current_setting('DateStyle'), current_setting('IntervalStyle'),
                   current_setting('extra_float_digits'), current_setting('quote_all_identifiers'),
                   current_setting('standard_conforming_strings')) AS line
  UNION ALL
  SELECT 'P01',
         concat_ws(' | ', sch.nspname, cls.relname, cls.relkind, cls.relpersistence,
                   pg_get_userbyid(cls.relowner), cls.relrowsecurity, cls.relforcerowsecurity,
                   array_to_string(ARRAY(SELECT opt FROM unnest(cls.reloptions) AS opt
                                         ORDER BY opt COLLATE "C"), ','))
  FROM pg_class AS cls
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  WHERE cls.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
    AND NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = 'pg_class'::regclass AND em.objid = cls.oid)
  UNION ALL
  SELECT 'P07',
         concat_ws(' | ', sch.nspname, fn.proname, pg_get_function_identity_arguments(fn.oid),
                   fn.prokind,
                   CASE WHEN fn.prokind <> 'a'
                        THEN md5(replace(pg_get_functiondef(fn.oid), chr(13), ''))
                        ELSE 'aggregate' END,
                   fn.prosecdef,
                   array_to_string(ARRAY(SELECT cfg FROM unnest(fn.proconfig) AS cfg
                                         ORDER BY cfg COLLATE "C"), ','),
                   pg_get_userbyid(fn.proowner))
  FROM pg_proc AS fn
  JOIN our_schemas AS sch ON sch.nsp_oid = fn.pronamespace
  WHERE NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = 'pg_proc'::regclass AND em.objid = fn.oid)
  UNION ALL
  SELECT 'P09',
         concat_ws(' | ', sch.nspname, cls.relname,
                   CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
                   acl.privilege_type, acl.is_grantable)
  FROM pg_class AS cls
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(cls.relacl,
               acldefault(CASE WHEN cls.relkind = 'S' THEN 's' ELSE 'r' END::"char", cls.relowner))) AS acl
  WHERE cls.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  -- P02 to P06, P08, P10 to P23 follow the same pattern
),
sections (sort_order, section, title, must_have_items, show_count) AS (
  VALUES (100, 'P00', 'deparse context', true, false),
         (101, 'P01', 'relations', true, true),
         (107, 'P07', 'functions', true, true),
         (109, 'P09', 'relation ACLs', true, false)
),
summary AS (
  SELECT sec.sort_order, sec.section, sec.title, sec.must_have_items, sec.show_count,
         count(lines.line) AS items,
         md5(coalesce(string_agg(lines.line, chr(10) ORDER BY lines.line COLLATE "C"), '')) AS fingerprint
  FROM sections AS sec
  LEFT JOIN lines ON lines.section = sec.section
  GROUP BY sec.sort_order, sec.section, sec.title, sec.must_have_items, sec.show_count
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM summary WHERE summary.must_have_items AND summary.items = 0)
              THEN 'FAIL' ELSE 'PASS' END AS result,
         'fingerprint complete; compare PARITY KEY across projects' AS detail
  UNION ALL
  SELECT summary.sort_order, summary.section || ' ' || summary.title,
         CASE WHEN summary.must_have_items AND summary.items = 0 THEN 'FAIL' ELSE 'PASS' END,
         CASE WHEN summary.show_count THEN summary.items || ' items, ' ELSE '' END
           || 'md5 ' || summary.fingerprint
  FROM summary
  UNION ALL
  SELECT 900, 'PARITY KEY', 'INFO',
         md5(string_agg(summary.fingerprint, ',' ORDER BY summary.sort_order))
  FROM summary
) AS report
CROSS JOIN params
WHERE params.run_mode = 'summary'
ORDER BY report.sort_order;
```

*(Abridgement ends. In the shipped file, lines mode is one more branch of the report CTE gated on `params.run_mode = 'lines'`, so summary rows always print and lines are added after them. The header states the exact row count, 39. Under `supabase-ops` section 1, returning fewer rows than that is a failed check.)*

### 7.4 How it is proven able to fail (revised for SA B-1, B-2, A-7)

| # | Run | Where, who | Expected |
|---|---|---|---|
| F1 | Empty production project, after U2b and before the apply | DO through `execute_sql`, summary mode (or the user in the SQL editor, if OQ-10 says MCP cannot see it) | `VERDICT FAIL`: the structural sections have no lines. This is the `supabase-ops` 2b state, and the proof that the completeness gate can fail |
| F2 | Staging, run 1 then run 2, at least 10 minutes apart with no apply between | DO, same client both times | Every row byte-identical: **determinism**. Then the **reconciliation** below (SA B-2) |
| F3 | Staging, via the other client (user, SQL editor) | user | Identical when CONTEXT KEY matches. If CONTEXT KEY differs the comparison is VOID, which is why the comparison of record always uses one client on both sides |
| F4 | Production after the apply | DO | CONTEXT KEY first, then every P row and the PARITY KEY equal staging's at `T_dump` (or live staging after a catch-up, section 8.4) |
| F5 | **Deliberate differences**: one `psql` run of `supabase/baseline/prove-checker-can-fail.psql` on production after U5 and before PROD-3 sends it traffic | user | Last row `PROOF PASS` (table below). Nothing is ever committed |
| F6 | Seed checker: D5, an `UPDATE` appending text to one `website_archetypes` row inside a savepoint | user | Only that table's seed row and the SEED KEY change. Added with DV-2 / DV-5, not in DV-1 |

**How F5 runs.** One transaction (`BEGIN READ WRITE`) that ends in `ROLLBACK`. It opens with `SET client_min_messages = error` (no server notice naming an object reaches `proof.log`), then a **staging guard**: a `DO` block with no exception handler that refuses any project with a row in `auth.users`, so **U6 must run before the first production login**. Then `SET LOCAL lock_timeout = '3s'`, so no step holds a lock while queued behind a long query (SA code review 1, 11). BASE runs the checker and must be VERDICT PASS with 39 rows. Each step then opens a savepoint, makes **one** deliberate difference in a `DO` block, runs the checker (through `prove-checker-step.psql`, which writes the summary rows to a scratch CSV in the private folder and loads them back in a temp table), compares every row with BASE and rolls the savepoint back. POST checks that the rollbacks left nothing, the transaction is rolled back, and AFTER checks the BASE keys again in a fresh transaction that is also rolled back. **Each step picks its target from the catalog at run time**, so the tracked file names no object of ours and never pairs an object with a role (SA B-1). Each step prints `PROVEN` (every must-change row changed and nothing unexpected moved), `FAIL`, `NOT RUN` (no candidate, or, only on a step whose `may_refuse` is true, the platform refused with 42501, 0A000, 55000, 55006 or 42809, for SA to rule on) or `SCRIPT ERROR` (any other error, including a refusal on a step not marked `may_refuse`: the script is wrong, fix and re-run; SA code review 4). Information rows may move in any step except D07b, POST and AFTER. The log carries codes, hashes and states only.

**One deliberate difference per section (SA B-1).** "Must change" always also needs the row to differ from BASE. Seven steps **add** a grant staging lacks, the real Risk A direction (SA A-7): D08b, D09b, D10, D15, D17, D24, D25.

| Step | Section | Deliberate difference (target chosen at run time) | Must change | May also change |
|---|---|---|---|---|
| D00 | P00 | `TimeZone` set to a zone other than the current one | P00, CONTEXT KEY | any (P00 is what makes the rest comparable) |
| D01 | P01 | `FORCE ROW LEVEL SECURITY` on the first owned table without it | P01, PARITY KEY | - |
| D02 | P02 | `DROP DEFAULT` on the first owned column with a plain (non-`nextval`) default | P02, PARITY KEY | - |
| D03 | P03 | `ADD CONSTRAINT ... CHECK (true) NOT VALID` on the first owned table | P03, PARITY KEY | P26 |
| D04 | P04 | `CREATE INDEX` on the first owned indexable column | P04, PARITY KEY | P26 |
| D05 | P05 | `DISABLE TRIGGER` on the first enabled non-internal trigger | P05, PARITY KEY | - |
| D06 | P06 | `CREATE OR REPLACE VIEW` with the same definition wrapped in a subquery and the same options | P06, PARITY KEY | P01 |
| D07 | P07 | `ALTER FUNCTION ... SET search_path = pg_catalog` | P07, PARITY KEY | - |
| D07b | P07 | the first multi-line plpgsql function re-created from its own definition with **CRLF** line endings | **nothing**, strictly (proves CR stripping) | - |
| D08 | P08 | `REVOKE` one API-role privilege on one function | P08, PARITY KEY | - |
| D08b | P08 | `GRANT EXECUTE` on a function to an API role it lacks | P08, PARITY KEY | - |
| D09 | P09 | `REVOKE` one API-role privilege on one table | P09, PARITY KEY | - |
| D09b | P09 | `GRANT` a table privilege an API role lacks (a missing revoke) | P09, PARITY KEY | - |
| D10 | P10 | `GRANT SELECT (column)` to an API role | P10, PARITY KEY | - |
| D11 | P11 | `ALTER POLICY ... TO` a different role list | P11, PARITY KEY | - |
| D12 | P12 | `ALTER TYPE ... ADD VALUE` on one enum | P12, PARITY KEY | - |
| D13 | P13 | `ALTER SEQUENCE ... CACHE` + 1 on the first owned **non-identity** sequence (SA code review 10) | P13, PARITY KEY | - |
| D14 | P14 | `COMMENT ON SCHEMA` | P14, PARITY KEY | - |
| D15 | P15 | `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ... GRANT SELECT ON TABLES` to an API role it lacks | P15, PARITY KEY | - |
| D16 | P16 | `CREATE EXTENSION` of one uninstalled trusted extension in one of our schemas | P16, PARITY KEY | P17, P18 (the extension comment; SA code review 2), P26 |
| D17 | P17 | `GRANT EXECUTE` on one extension member function to an API role it lacks | P17, PARITY KEY | - |
| D18 | P18 | `COMMENT ON TABLE` | P18, PARITY KEY | - |
| D19 | P19 | a never-firing `CREATE TRIGGER ... WHEN (false)` beside our trigger on the managed table, using the same function | P19, PARITY KEY | - |
| D20 | P20 | `UPDATE` one bucket's size limit (SA R-4: never a delete) | P20, PARITY KEY | - |
| D21 | P21 | a restrictive deny-all `CREATE POLICY` on `storage.objects` | P21, PARITY KEY | - |
| D22 | P22 | `ALTER PUBLICATION supabase_realtime ADD TABLE` | P22, PARITY KEY | - |
| D23 | P23 | `ALTER ROLE <API role> SET statement_timeout` | P23, PARITY KEY | - |
| D24 | P24 | `GRANT USAGE ON TYPE` to an API role it lacks | P24, PARITY KEY | - |
| D25 | P25 | `GRANT CREATE ON SCHEMA` to an API role it lacks | P25, PARITY KEY | - |
| D26 | P26 | `CREATE COLLATION ... FROM "C"`, a kind no other section models | P26, PARITY KEY | - |
| DG1 | G1 | the owner grants SELECT with grant option to one API role, which (by `SET ROLE`) grants it on to another | G1, VERDICT | P09, PARITY KEY |
| POST | all | nothing, after every savepoint rollback | **nothing**, strictly | - |
| AFTER | all | nothing, in a fresh transaction after the `ROLLBACK` | CONTEXT KEY and PARITY KEY equal BASE, 39 rows | - |

**Stated reasons, for SA to rule on:**
- **The P05 anchor (`internal triggers not enabled`) cannot be made to differ.** Disabling an internal constraint trigger needs a superuser, and `postgres` is not one. The rest of P05 is proven by D05. The anchor is still in the P05 hash, and F2's reconciliation checks the trigger count.
- **The VERDICT completeness gate** is proven by F1 (an empty project), not inside F5. Its G1 half is proven by DG1.
- **Steps that may be NOT RUN on a platform refusal:** D16 (extension allow-list), D17 (if `postgres` neither owns the members nor holds a grant option), D19 (needs the TRIGGER privilege on the managed table; disabling the existing trigger needs ownership, which `postgres` lacks), D20 (if a storage trigger refuses the update, per SA R-4), D21 (storage policy creation), D22 (publication ownership), D23 (`ALTER ROLE` privilege), DG1 (needs `SET ROLE` to an API role). These eight are exactly the rows with `may_refuse` true, pinned by T13. Each refusal prints its SQLSTATE. The proof's last row is then `PASS, NOT RUN steps go to SA`.

**Reconciliation at F2 (SA B-2).** The structural counts are reconciled against DevOps' independently measured inventory. I8 is computed through the **same filters** as the sections, so a match also proves the filters.

| Inventory measure (section 2) | Checker field to compare |
|---|---|
| `public`: 199 tables | I8 `public: tables` (`operator_private: tables` is the 1 table there) |
| 20 views | I8 `public: views` + `matviews` |
| 221 own functions | I8 `public: functions` (extension members are excluded on both sides) |
| 103 triggers | I8 `public: triggers` |
| 4 sequences | I8 `public: sequences` |
| 3 enums | I8 `public: enums` |
| 368 policies | I8 `public: policies` |
| 1,085 indexes | I8 `public: indexes` |
| 1,091 constraints | I8 `public: constraints` |

The rule: each pair equal is a match. A pair that differs is explained by DO (for example the inventory query counted partitions or extension members differently) and recorded in the private record as match or mismatch with the reason. An unexplained mismatch goes to SA before the dump. DO also checks that the P rows agree with I8 on every run: P01 lines = the sum of the I8 relation kinds over both schemas, P03 = constraints, P04 = indexes, P05 = triggers + 1 anchor, P11 = policies, P13 = sequences. **The privilege sections print no count and are not reconciled in chat.** The user reconciles them privately, from a lines-mode CSV in the private folder against the private inventory, and records match or mismatch there only (SA B-7).

---

## 8. Timing while migrations keep landing

1. **The forward rule starts at `T_dump`, not at cutover.** From the moment of the dump, every migration applied to staging is also applied to production through the section 4 flow, the same day. That keeps the plan correct without re-dumping.
2. **The freeze is short and the user controls it.** The user is the only person who applies migrations. They do not paste one between the staging fingerprint (F2 run 2) and the dump (U3), which happen in the same sitting. DO announces the sitting in the coordination file so parallel sessions hold their applies for that hour.
3. **The high-water mark H** is the highest migration number whose checker passes on staging at `T_dump` (OQ-12). The manifest also lists any migration that was applied on staging before its PR merged (allowed by the `supabase-ops` timing test). Those are already in the dump and must never be applied to production a second time. Their pre-checks would refuse anyway.
4. **Catch-up before the proof.** If migrations land between `T_dump` and the production apply, they are applied to production right after the baseline, in number order. F4 is then compared against **live** staging rather than the `T_dump` key.
5. **Re-check points:** after the apply (F4), after every later migration pair, and once more as a PROD-4 cutover gate.
6. **When to dump:** as late as the 12-01 deadline allows, after PROD-1 (due 11-27, code only, no migrations). The target is 11-28 to 11-30. A re-dump is needed only if the rollback in section 18 is used.

---

## 9. The forward rule (B1f)

This text goes at the top of `supabase/migrations/README.md`. `supabase/SQL Scripts/README.md` gets a short pointer to it.

1. Every schema change is a numbered migration in `supabase/migrations/`, with its rollback in `supabase/SQL Scripts/`, a pre-check and a checker. That covers tables, columns, indexes, functions, triggers, policies, grants, default privileges, extensions, bucket configuration and publication membership.
2. It is applied to **staging, then production**, each through `supabase-ops` section 4 and each with its checker. It is not done until both are applied. The change record names both environments by role.
3. After every production apply, `scripts/check-schema-parity.sql` runs on both, and the PARITY KEYs must match. A mismatch stops the next apply until SA rules.
4. **Never ad-hoc SQL**: not in the SQL editor, the Table editor, the Storage settings, the Extensions toggle, the Realtime toggle or the Database roles page. Pasting a *reviewed migration file* is the transport and is not an exception to this rule.
5. `supabase/SQL Scripts/` takes rollbacks only from H on. No new hand-run scripts.
6. Edits to reference data (prices, settings) are admin operations, not migrations, and are expected to diverge between environments. The parity check covers schema only.
7. `supabase db push`, `db execute`, `migration up` and ad-hoc `psql` against a hosted project stay forbidden. The one sanctioned `psql` use is the baseline apply and proof against an **empty** project (D7).

Optional guard (SA decides, D9): a new `supabase/__tests__/forwardRule.guard.test.ts`. It requires that every `supabase/SQL Scripts/` file numbered above H ends in `_rollback.sql` and has a matching migration, and that the README marker names H. It is pure fs, runs in milliseconds, and a fixture proves it can fail. No existing test changes.

---

## 10. What a dump does not carry (B1g checklist)

This becomes `supabase/baseline/PROVISIONING_CHECKLIST.md` (tracked). It holds **setting names and the rule only**. The per-environment values go in the private record.

| Area | Setting | Rule for production | Who |
|---|---|---|---|
| Project | Region | Per D1 | user (at creation) |
| Project | Postgres version | The newest 17.x offered. Never 18 | user |
| Project | Plan tier, compute, backups, PITR, spend cap | Per the strategy doc's production requirements | user |
| Project | DB password | Generated, stored in the password manager only | user |
| Database | SSL enforcement, network restrictions, pooler mode, IPv4 add-on | SSL enforced. Session pooler on 5432 is what the commands use | user |
| Database | Extensions | Exactly staging's set (P16, I2). `pg_graphql` per D2. `pg_cron`/`pg_net` stay off | user, DO verifies |
| Data API | Exposed schemas, extra search path, max rows | Equal to staging. `operator_private` never exposed | user reads both |
| Auth | Site URL, redirect allow-list | **Environment-specific**: production domains only, never copied (PROD-3) | user |
| Auth | Email provider, confirm email, sign-up open or closed | Equal to staging's intent (invite-only sign-up) | user |
| Auth | Google sign-in client and callback | The sign-in client, with the production callback added (PROD-EXT) | user |
| Auth | Anonymous sign-ins, manual linking | Equal to staging | user |
| Auth | Email templates, custom SMTP, email rate limits | Equal to staging | user |
| Auth | OTP expiry | 1 hour or less | user |
| Auth | Leaked-password protection | On | user |
| Auth | Password rules, CAPTCHA, MFA, session settings, Auth hooks | Equal to staging, or stricter | user |
| Auth | JWT expiry, signing key type, API key family | Same family as staging, so the env var names the code reads do not change | user |
| Storage | Global size limit, image transformations, S3 protocol | Equal to staging | user |
| Storage | Buckets and policies | Carried by `after-schema.sql` (P20, P21) | Dev / user |
| Roles | Role grants, default privileges | Carried by the dump (P08 to P15) | proof |
| Roles | Per-role and database-level settings | P23 / I6 compared. Fix a difference by migration, or by dashboard if it is managed | DO |
| Realtime | Publication membership, realtime settings | 0 tables, equal to staging (P22) | proof / user |
| Edge functions | `supabase/functions/run-scheduled-agents` | **Not deployed** (it is not deployed on staging either) | none |
| Cron, webhooks, vault | pg_cron jobs, database webhooks, vault secrets | None on staging (OQ-8 confirms vault). Vercel crons drive jobs | DO verifies |
| Integrations | Vercel integration env sync, log drains | No auto env sync (PROD-1a hands env changes to DO) | user |
| Bootstrap (not seed) | First `admin_users` row; production operator secret and its hash; environment-specific settings keys | PROD-3/4, each by its own reviewed procedure | user |

---

## 11. Decisions for SA

| # | Decision | Recommendation | Why |
|---|---|---|---|
| **D1** | Production region | **Create the production project in us-east-1**, paired with Vercel `iad1` | A project's region is fixed at creation. Vercel's function region is shared by every environment of the one Vercel project, so only one of the two databases can sit next to the functions, and production should be that one. Moving functions to us-east-2 instead would move production off Vercel's default region to favour staging |
| **D2** | `pg_graphql` in production | **Off** | Staging has it off, so "on" breaks the empty diff unless it is also enabled on staging by migration. No code calls `/graphql/v1`. Off also means less of the schema is exposed. It is turned off from the dashboard before the apply, and the empty-target guard refuses if it is present. Turning it on later is a migration applied to both |
| **D3** | Keep or drop `operator_private` and `public.operator_*` | **Keep, schema only** | The name says "test account", but the same function is the account **anonymise** engine for self-service and admin deletion. Dropping it breaks account deletion in production. The staging secret row is never copied. Production gets its own secret and hash (bootstrap row in section 10). Until then the function refuses with 42501, so it fails closed |
| **D4** | The 145 mutable-`search_path` functions | **Later (HARDEN), as migrations applied to both** | PROD-2 is a faithful copy proven by an empty diff, and changing them in the baseline alone breaks that. A blanket `search_path = ''` breaks functions whose bodies name tables unqualified, which is the S11.1 trap, so each function needs review. For the advisor gate on the new project, the bar is "no finding that staging does not also have", not zero |
| D5 | Baseline tracked or not | **Not tracked.** Sha256, fingerprint and procedure tracked | Section 3.1: the grant posture would be published, and the O-1 tripwire would fail |
| D6 | B1a link | **Replaced** by the empty-target guard and the fingerprint | Section 1 |
| D7 | `psql` exception | **One-time, user-executed, against the empty production project only**: the apply (U5) and the proof (U6). `pg_dump` and the seed export are read-only against staging. Rules elsewhere unchanged | The dump is over 1 MB and carries psql-only `\restrict` lines, so the SQL editor cannot run it. The empty-target guard makes a wrong-project apply refuse |
| D8 | Extension versions (**amended 2026-11-24 by SA R-8 in section 19: pin `vector` 0.8.0 and `btree_gist` 1.7**) | Read the new project's default versions (OQ-4). **If they equal staging's, use them. If newer, apply `ALTER EXTENSION ... UPDATE` to staging as a numbered migration before the dump**, so the diff stays empty | Pinning an old version usually fails, because packages ship only the newest base install script. Accepting a mismatch would make "empty diff" carry an exception |
| D9 | Forward-rule guard test | Add it (section 9) | It is cheap, and it stops the SQL Scripts habit coming back |

---

## 12. User commands, step by step

All commands are for **PowerShell**. Paths are written with forward slashes (the Tailwind escape guard reads tracked docs). Placeholders come from the dashboard: **Connect, Session pooler** for each project. `<HOST>` is the pooler host and `<USER>` is the pooler user (`postgres.<project ref>`). Use port 5432. Never use the transaction pooler on 6543. `-W` always prompts for the password. Never put a password in a URL, `PGPASSWORD` or a pgpass file. `<REPO>` is a **clean worktree of `origin/main`** after PROD-2a merges, created by RM. Do not use the everyday checkout.

| Step | Run once, in one PowerShell window |
|---|---|
| U1 setup | `$env:Path = "C:/Program Files/PostgreSQL/17/bin;" + $env:Path; pg_dump --version; psql --version`. Both must print the same 17.x (17.6 or later, for `\restrict`) |
| U2 folder | `$B = "$env:USERPROFILE/agentspilot-baseline/<STAMP>"; New-Item -ItemType Directory -Force $B` |
| U3a dump (staging, read-only) | `pg_dump -h <STAGING_HOST> -p 5432 -U <STAGING_USER> -d "dbname=postgres sslmode=require" -W --schema-only --schema=public --schema=operator_private --no-publications --no-subscriptions --no-security-labels --no-tablespaces --quote-all-identifiers --format=custom --file="$B/schema.dump"` |
| U3b list (offline) | `pg_restore --list "$B/schema.dump" \| Out-File -Encoding ascii "$B/schema.list"` |
| U3c filter (offline) | `Get-Content "$B/schema.list" \| ForEach-Object { if (($_ -match ' DEFAULT ACL ' -and $_ -notmatch ' postgres$') -or $_ -match ' SCHEMA - public ') { ';' + $_ } else { $_ } } \| Out-File -Encoding ascii "$B/schema.filtered.list"` |
| U3d render (offline) | `pg_restore --no-owner --use-list="$B/schema.filtered.list" --file="$B/schema.sql" "$B/schema.dump"` |
| U3e hashes | `Get-FileHash -Algorithm SHA256 "$B/schema.dump","$B/schema.sql" \| Format-List` |
| U4 seed export (staging, read-only) | `Set-Location $B; psql -h <STAGING_HOST> -p 5432 -U <STAGING_USER> -d "dbname=postgres sslmode=require" -W -v ON_ERROR_STOP=1 -f "<REPO>/supabase/baseline/seed-export.psql"` |
| U5 apply (production, empty) | `Set-Location $B; psql -h <PROD_HOST> -p 5432 -U <PROD_USER> -d "dbname=postgres sslmode=require" -W --single-transaction -v ON_ERROR_STOP=1 -f "<REPO>/supabase/baseline/before-schema.sql" -f "$B/schema.sql" -f "<REPO>/supabase/baseline/after-schema.sql" -f "<REPO>/supabase/baseline/seed-import.psql" 2>&1 \| Tee-Object "$B/apply.log"` |
| U6 proof (production, never commits) | `Set-Location $B; psql -X -h <PROD_HOST> -p 5432 -U <PROD_USER> -d "dbname=postgres sslmode=require" -W -v ON_ERROR_STOP=1 -f "<REPO>/supabase/baseline/prove-checker-can-fail.psql" 2>&1 \| Tee-Object "$B/proof.log"`. `Set-Location $B` matters: the proof writes its scratch file `parity-proof-run.csv` (summary rows only) to the current folder, which must be the private folder, never the repo. **U6 must run before the first production login:** its opening guard refuses any project with a row in `auth.users` (SA code review 1) |

After U3e, DO or Dev runs structural counts on `schema.sql` locally (e.g. `Select-String -Path "$B/schema.sql" -Pattern '^CREATE TABLE' \| Measure-Object`, and the same for functions, policies and triggers). They are compared with the inventory, and no `COPY` or `INSERT` may be present. Counts only. Nothing from the file is copied anywhere. If U5 errors, nothing was applied: read the error, fix the cause (the filter or a header line), and re-run U5.

---

## 13. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `scripts/check-schema-parity.sql` | create ✅ DV-1 | The empty-diff checker (section 7) |
| `scripts/check-baseline-seed.sql` | create | Seed proof (section 6.2) |
| `supabase/baseline/README.md` | create | Procedure, commands (section 12), manifest template, artefact handling, the D7 exception |
| `supabase/baseline/PROVISIONING_CHECKLIST.md` | create | B1g (section 10) |
| `supabase/baseline/before-schema.sql` | create | Empty-target guard, extensions, default-privilege neutralisation |
| `supabase/baseline/after-schema.sql` | create | `auth.users` trigger, 5 buckets, PostgREST reload |
| `supabase/baseline/seed-export.psql` | create | Read-only `\copy` of the 19 tables, FK columns nulled at source |
| `supabase/baseline/seed-import.psql` | create | Trigger-suppressed `\copy ... FROM`, `setval` |
| `supabase/baseline/prove-checker-can-fail.psql` | create ✅ DV-1 (parity part) | F5: one deliberate difference per section, all rolled back (section 7.4). The seed difference (F6, D5) is added with DV-2 / DV-5 |
| `supabase/baseline/prove-checker-step.psql` | create ✅ DV-1 | The step F5 repeats: run the checker, load its summary rows, compare with BASE |
| `scripts/__tests__/schemaParityBaseline.test.ts` | create ✅ DV-1 (checker and proof part) | Text test (section 15). DV-2 to DV-4 add their T rows to it |
| `supabase/__tests__/forwardRule.guard.test.ts` | create (if D9) | Forward-rule guard |
| `supabase/migrations/README.md` | modify | Baseline marker + forward rule at the top |
| `supabase/SQL Scripts/README.md` | modify | Baseline marker + "rollbacks only from H" |
| `.gitattributes` | modify | `text eol=lf` line for each new `.sql` and `.psql` file (paste-safety rule 3) |
| `.claude/skills/supabase-ops/SKILL.md` | modify (DO) | Section 3: a `supabase/baseline/` row. Section 4: step 7b, the parity re-check after every production apply |

No runtime code, migration, route or repository. `supabase/**` counts as a deploying change in `.github/ci/non-deploying-change.sh`, so the PR runs the full build. It has no runtime effect.

---

## 14. Task list, by owner

### SA
- ⬜ SA-1 Review this workplan; rule on D1 to D9.
- ⬜ SA-2 Code review of PROD-2a (above all the ACL sections, the empty-target guard and the TOC filter). DV-1 part done 2026-11-23: Fix Required, then re-reviewed the same day and **approved for QA** (section 19).
- ⬜ SA-3 Rule on any P-row mismatch in F4 (fix-forward or rollback, section 18).

### Dev (PROD-2a, after SA-1)
- ✅ DV-1 `scripts/check-schema-parity.sql`, sections P00 to P26, G1, CONTEXT KEY, PARITY KEY and I1 to I8, summary and lines modes, with SA's DV-1 conditions folded in (section 19, Dev response). Includes the parity half of DV-5 (`prove-checker-can-fail.psql` + `prove-checker-step.psql`), the three `.gitattributes` lines for these files (part of DV-7) and the checker/proof half of DV-8. **Not yet run against any database**: DO-1b is its first execution.
- ⬜ DV-2 `scripts/check-baseline-seed.sql`.
- ⬜ DV-3 `before-schema.sql` / `after-schema.sql` (needs OQ-1 to OQ-4, OQ-8, OQ-9). **Note from SA code review 8:** a `--schema-only` dump creates materialized views WITH NO DATA and never refreshes them. If I8 shows `matviews` above 0, `after-schema.sql` needs a `REFRESH MATERIALIZED VIEW` for each one, or reads fail with "has not been populated".
- ⬜ DV-4 `seed-export.psql` / `seed-import.psql` (needs OQ-5, OQ-6).
- ⬜ DV-5 `prove-checker-can-fail.psql` (D1 to D5 objects named from `origin/main`).
- ⬜ DV-6 READMEs, manifest template, provisioning checklist, forward-rule text.
- ⬜ DV-7 `.gitattributes` lines.
- ⬜ DV-8 Jest text test (and the forward-rule guard if D9).
- ⬜ DV-9 Ship drill step 1 for touched files: `npx tsc --noEmit` filtered to the two test files; `npm test -- scripts/__tests__/schemaParityBaseline supabase/__tests__ app/__tests__/tailwind-css-escape`; confirm the SECDEF O-1 tripwire is still green.
- ⬜ DV-10 (PROD-2b close) Fill the manifest: stamp, H, sha256s, PARITY KEY, SEED KEY, TOC entries filtered, post-dump migrations, "forward rule in force since".

### DevOps
- ⬜ DO-1 Run OQ-1 to OQ-12 read-only on staging; write the results to the private record.
- ⬜ DO-1b **First execution of the checker (added by DV-1).** Dev had no database, so the SQL has only been checked as text. Run `scripts/check-schema-parity.sql` on **staging** in summary mode through `execute_sql`, under `supabase-ops` section 1: drop the `SET` line and wrap the rest in `begin read only; ... commit;`. Pass when it returns exactly 39 rows and every P row is PASS. G1 FAIL is not a checker defect: it means OQ-13 found a grantor other than the owner, which goes to SA. Any SQL error goes to Dev with the message only. The summary output carries hashes and structural counts and can be shared. Run this as early as possible, because DO-3 and F5 depend on it. **Never lines mode through `execute_sql`** (SA B-7).
  - **Required gate on every checker change (added after the first DO-1b).** Text-only tests cannot catch planner errors. The first DO-1b failed at plan time with SQLSTATE 42725 (`text || "char"` at two sites) while every Jest rule and both reviews were green. The new Jest rule closes that one class only. So **any** edit to `scripts/check-schema-parity.sql` is not ready for SA or QA sign-off until DO-1b has run the exact edited file on staging (39 rows, every P row PASS, G1 `none`, no SQL error), recorded with that file's sha256. A diagnostic copy does not count: the run of record is the worktree file.
  - **Re-run owed now:** on the file with the two casts and SA code review items 3, 6, 7 and 8, sha256 `bf1a7b3185bcbfcb47e1dfcbd29c6f4a22534feed0e3b078b862f6d8200971ec`. DO confirms the same sha256 before running it.
- ⬜ DO-2 After U2b, run the production pre-check (OQ-2, OQ-4, OQ-9 on production) and **F1**: the checker in summary mode on the empty production project. Pass when VERDICT is FAIL with at least P01 (relations) FAIL. The anchored sections (P05, P10, P19, P21 to P23) and P14, P15, P25 may be PASS on an empty project, which is expected. Record which rows were FAIL. A VERDICT PASS on an empty project means the checker cannot fail and stops PROD-2b.
- ⬜ DO-3 **F2** (twice on staging, at least 10 minutes apart, same client, no apply between) right before U3, in the same sitting, after SA R-1's three migrations; announce the sitting in the coordination file. Pass when all 39 rows are byte-identical between the two runs. Then the **reconciliation** in section 7.4: each I8 count against the inventory, and the P line counts against I8. Record match or mismatch per pair in the private record. An unexplained mismatch goes to SA before the dump.
- ⬜ DO-4 Structural counts on the rendered `schema.sql` (section 12).
- ⬜ DO-5 **F4** and the seed checker on both; compare every row. Order: VERDICT PASS on both sides, then CONTEXT KEY (unequal is VOID: re-run both through the same client), then PARITY KEY, then every P row. Record the PARITY KEY and the checker's sha256 for the manifest (G-6).
- ⬜ DO-5b **F5 evidence.** After the user's U6 run, read `proof.log` (codes, hashes and states only). Pass when the last row is `PROOF PASS`, or `PASS, NOT RUN steps go to SA` with every NOT RUN step listed for SA with its SQLSTATE. Any FAIL or SCRIPT ERROR goes to Dev. Record the per-step results in section 20.
- ⬜ DO-6 Advisors (security + performance) on production, compared privately with staging: no finding that staging does not also have.
- ⬜ DO-7 Change record per `env-change-protocol` (environments by role, no posture details).
- ⬜ DO-8 Update the `supabase-ops` skill (section 13).

### User
- ⬜ U0 Approve the PROD-2a diff (no commit before the user has seen it).
- ⬜ U1 Install the PostgreSQL 17 client tools (EDB installer, "Command Line Tools" only).
- ⬜ U2a Create the production project in the D1 region, with the plan and password per section 10. U2b: turn `pg_graphql` off (D2) and set Data API exposed schemas.
- ⬜ U3 Dump, filter, render, hash (section 12).
- ⬜ U4 Seed export.
- ⬜ U5 Apply.
- ⬜ U6 Proof run.
- ⬜ U7 Dashboard checklist items (section 10) that belong to PROD-2. Environment-specific ones are left to PROD-3.

### QA
- ⬜ QA-1 Run the Jest tests; review the F1 to F6 evidence and the row counts; record in section 20.

---

## 15. Test plan

### Jest (Dev, in the existing gate, fs-only, milliseconds)

`scripts/__tests__/schemaParityBaseline.test.ts`:

| # | Asserts | Fails when |
|---|---|---|
| T1 ✅ | The checker starts with `SET default_transaction_read_only = on;`, holds exactly one `SET`, and no DML/DDL keyword outside comments and strings (the seed checker joins with DV-2) | A write sneaks in |
| T2 ✅ | The standalone word "into" and the SECURITY DEFINER phrase appear nowhere in the checker or the two proof files (comments included); no `CREATE FUNCTION`/`PROCEDURE`; ASCII only; no psql meta-command and no single-letter alias in the checker. **Deviation:** the raw "no CR byte" check is replaced by T3's LF pin plus line-ending-normalised reads, because a working-tree CR on a Windows checkout is a known local-versus-CI flake source | Paste safety or the O-1 tripwire broken |
| T3 ✅ | `.gitattributes` has an `eol=lf` line for every new `.sql` / `.psql` file (the three DV-1 files so far) | A file is missing one |
| T4 ✅ | Section codes are exactly P00 to P26, G1, I1 to I8, unique and in sort order, every one produces lines and has its block header, and the header's stated row count (39) equals VERDICT + sections + the two keys | A section is added or dropped without updating the count |
| T5 ✅ | Every `pg_get_functiondef` and every description is wrapped in `replace(..., chr(13), '')` | A hash would see line endings |
| T6 ✅ | Per catalog (SA B-6): `relacl`, `proacl`, `typacl`, `nspacl` are exploded as `coalesce(..., acldefault(...))`; `attacl` and `defaclacl` are exploded as they are; all six appear | An ACL section is dropped or NULL-handled wrongly |
| T7 ✅ | The committed `run_mode` is `'summary'`, and the header forbids lines mode through `execute_sql` (SA B-7) | Lines mode is committed |
| T8 ⬜ | `seed-export.psql` and `seed-import.psql` name exactly the 19 approved tables, in parent-before-child order; the FK-nulled columns are present; neither names `operator_private` | A table is added or the secret is named |
| T9 ⬜ | `before-schema.sql` holds the empty-target guard and does not revoke from `PUBLIC`; neither fragment defines a function | The guard is dropped, or the O-1 tripwire would be at risk |
| T10 ✅ | "The audits can fail": 23 breaks of the checker, 17 of the proof and 3 of the step file, each applied to the real text, each must raise its own complaint | The test itself is vacuous |
| T11 ✅ | No privilege section prints a count (SA B-4): the `acl` kind equals the sections built in `acl_items`, each is md5-only, no block that explodes or reads ACLs holds `count(`, and only the `count` display prints a line count | A grant count reaches the output |
| T12 ✅ | Anchors (SA B-2) on P05, P10, P15, P19, P21, P22, P23; P00 holds all nine settings; CONTEXT KEY is the P00 hash; PARITY KEY covers the structure and acl sections only (SA B-3); VERDICT sorts first | "Returned nothing" looks like "nothing to report", or P00 decides the PARITY KEY |
| T13 ✅ | The proof: BEGIN, ROLLBACK, BEGIN, ROLLBACK and no COMMIT; every savepoint rolled back and released; every step expected, run and summarised; a step targets each of P00 to P26 and G1; at least one step adds a grant; no object of ours named; `expected_rows` equals the checker's 39. Added by SA code review 1, 4 and 5: the staging guard (a `DO` block with no exception handler refusing rows in `auth.users`) and `SET LOCAL lock_timeout = '3s'` both come before the first savepoint; both transactions set `client_min_messages = error`; `may_refuse` is true for exactly D16, D17, D19 to D23 and DG1, and the compare view gates NOT RUN on it; in **both** `.psql` files no COMMIT, ABORT, PREPARE TRANSACTION or COMMIT PREPARED anywhere, no END that closes no CASE, no `dblink` or `pg_background`, and only the meta-commands `\set \pset \o \ir \copy \gset` | The proof could commit, reconnect, shell out, skip a section, run on staging, hide a script error as NOT RUN, or publish an object-role pair |
| T14 ✅ | No `"char"` catalog column (named explicitly: `relkind`, `relpersistence`, `relreplident`, `prokind`, `typtype`, `defaclobjtype`, `deptype`, `contype`, `polcmd`, `tgenabled`, `attidentity`, `attgenerated`, `attstorage`, `attcompression`, `evtenabled`, `aggkind` and more) is joined with `\|\|` without `::text`, in the checker or the proof. Added after DO-1b's 42725. **It closes this one class only: text tests cannot catch planner errors, so DO-1b stays a required gate** | A query that fails at plan time ships |

Existing guards that must stay green, unchanged: the SECDEF O-1 tripwire (the new `.sql` files define no SECURITY DEFINER function), the Tailwind escape guard (forward slashes only), and the migration number guard (nothing added to `supabase/migrations/`).

### Live (recorded in section 20 with hashes only)

| # | Check | Pass |
|---|---|---|
| L1 | F1 on empty production | VERDICT FAIL |
| L2 | F2 on staging, twice | Byte-identical |
| L3 | F4 production vs staging at `T_dump` | Every P row and PARITY KEY equal; row count as stated |
| L4 | F5 D1, D2, D4 | Exactly the named rows change |
| L5 | F5 D3 | Nothing changes |
| L6 | Seed checker, staging vs production; F6 | Equal; D5 changes exactly one table row |
| L7 | `operator_private.secrets` on production | 0 rows |
| L8 | Advisors | No production finding that staging lacks |
| L9 | Behavioural pair through PostgREST with the production publishable key, run by the user in their own terminal, the key entered at a prompt: one table the API roles cannot read and one they can, both chosen in the private record. Paired, per the checker-pattern lesson that an unpaired refusal cannot be told from a broken probe | Same outcomes as staging |

---

## 16. Open items (read-only queries for TL to run)

| # | Question | Needed by |
|---|---|---|
| OQ-1 | Every object of ours outside `public`/`operator_private`: relations, functions, types and policies owned by `postgres` in `auth`, `storage`, `realtime`, `extensions`, `vault`, `graphql_public` (excluding extension members). Every non-internal trigger on a managed-schema table, with `pg_get_triggerdef` | DV-3 |
| OQ-2 | `pg_default_acl` in full (role, schema, type, ACL) on staging, and on production right after creation | DV-3, DO-2 |
| OQ-3 | ACLs of `vector`/`btree_gist` member functions in `public`, grouped by grantee, against `pg_init_privs` | DV-3 (extension order) |
| OQ-4 | `pg_available_extensions.default_version` for `vector`, `btree_gist` on production | D8 |
| OQ-5 | For each of the 19 tables: columns, FKs (target table), identity/generated columns, triggers, owned sequences, primary key | DV-4 |
| OQ-6 | In `system_settings_config`, `ais_system_config`, `model_routing_config`, `memory_config`: keys whose value looks like a URL, host, email, key or project ref. **Key names and counts only, never values** | DV-4, section 10 bootstrap |
| OQ-7 | `pg_db_role_setting` names (values hashed) for the database and the API roles | P23 / I6 |
| OQ-8 | `storage.buckets` config for the 5 buckets; policy count per `storage` table; vault secret count; realtime publication tables | DV-3 |
| OQ-9 | Owner and ACL of schema `public` on staging and production (decides whether a `SCHEMA - public` TOC entry appears) | U3c |
| OQ-10 | Can the Supabase MCP see the production project once it is created? | F1 / F4 runner |
| OQ-11 | Can `postgres` run `ALTER TABLE ... DISABLE TRIGGER USER` on the seed tables (it is the owner) and `CREATE TRIGGER` on `auth.users` on a new project? Answered by U5 itself, because it fails closed | U5 |
| OQ-12 | H: the highest migration whose checker passes on staging at `T_dump`, plus any applied-but-unmerged ones | Manifest |

---

## 17. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Grants differ after restore (Risk A)** | 🔴 | Default privileges neutralised during the restore and restored by the dump; P08 to P15 and P17 compare exploded ACLs; D1/D2 prove those rows can fail; no app traffic before PROD-3 |
| R2 | The baseline is applied to staging by mistake | 🔴 | Empty-target guard in step 1 of the same transaction; host typed from the production dashboard; the user confirms the project name on screen before U5 |
| R3 | Staging secret hash copied | 🔴 | `--schema-only`; not in the seed list; T8; L7 |
| R4 | The dump artefact (grant posture) leaks | 🟡 | Outside the repo and sync folders; never in chat; only hashes and counts leave the folder; lines-mode output goes to the private record only |
| R5 | A statement in the dump fails as `postgres` | 🟡 | Single transaction, so nothing half-applied; offline TOC filter for the known cases; fix and re-run |
| R6 | Extension version mismatch | 🟡 | D8 |
| R7 | A newer 17.x minor deparses differently (false FAIL) | 🟡 | P00 makes the context explicit; lines mode localises the difference; SA rules. Only our schemas are compared, never managed ones |
| R8 | Migrations land during the window | 🟡 | Section 8: the forward rule from `T_dump`, a same-day catch-up, and re-check points |
| R9 | Different clients give different P00 | 🟢 | One client on both sides for the comparison of record |
| R10 | Credential exposure | 🟢 | `-W` prompts only; no URL, env var or pgpass; commands carry host and user only |
| R11 | Something of ours outside `public` missed (Risk B) | 🟡 | OQ-1, I7, P19 to P22 |
| R12 | A trigger left disabled after the seed | 🟢 | Same transaction; P05 compares `tgenabled` |
| R13 | Time: three user sittings before 12-01 | 🟡 | PROD-2a review on 11-24 to 11-26; U1/U2 run in parallel with the review; U3 to U6 fit one sitting of about 2 hours |

---

## 18. Rollback

| Point | Rollback |
|---|---|
| U3/U4 (staging, read-only) | Nothing to undo. Delete the private folder if abandoned |
| U5 fails | Single transaction, so nothing was applied. Fix and re-run |
| U5 succeeds but F4 has a mismatch | SA rules. **Fix-forward** for a narrow, explained class (for example one missing `REVOKE`): an SA-reviewed statement list, applied by the user to production only and recorded privately, then F4 re-run. Otherwise **delete and re-create the production project** and repeat U2 to U6. That is cheap before PROD-3, because no env var or OAuth redirect points at it yet |
| U6 | Never commits; nothing to undo |
| PROD-2a PR | Revert. Docs, SQL scripts and tests only, no runtime effect |
| Forward rule | Text only. Reverting it returns to today's single-environment flow |

---

## 19. SA Review Notes

**Reviewed by SA — 2026-11-23** (workplan review, phase 1)
**Status:** Approved with conditions. The design is right: neutralise the default privileges, let the dump restore the ACLs, and compare grantor-free ACL sets. The gaps are additive, but several of them are blocking for the file they govern. DV-1 and DV-2 may start now. DV-3 to DV-5 start only once the conditions for that file are written into this workplan and the OQs it needs are answered (table at the end). SA re-reviews only the revised sections, not the whole plan.

**Verified on `origin/main` (`cf379a2a`):** the migration number guard, the SECURITY DEFINER guard (O-1 tripwire), the Tailwind escape guard, the 16 folder scanners listed in DevOps' inventory, `.github/ci/non-deploying-change.sh` and `jest-gate-scope.sh`, `supabase-ops` sections 1, 3 and 4 plus `paste-safety.md` and `checker-pattern.md`, `supabase/migrations/README.md`, `.claude/agents/devops.md`, the operator secret migration (20261041) and `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` section 6, and the global descriptors in `lib/business-os/purge/descriptors.ts`.

### Rulings on D1 to D9

| # | Ruling | Conditions |
|---|---|---|
| D1 | **Approved**: production in us-east-1, next to Vercel `iad1` | Staging stays in us-east-2 and pays the cross-region hop. That is acceptable. Record the choice in `PROVISIONING_CHECKLIST.md` |
| D2 | **Approved**: `pg_graphql` off | U2b runs before DO-2, so the guard, the production read of OQ-2 and F1 all see the final extension set. `graphql_public` is managed and is not compared. Turning it on later is a migration applied to both |
| D3 | **Approved**: keep, schema only | Production's secret is a **PROD-4 go-live gate**, not a later task. Until it exists, self-service and admin account deletion fail closed with 42501. Procedure: runbook section 6.2 to 6.4 (the hash is made locally, and only the hash enters the SQL editor). PROD-3 must revisit the runbook's "Production only" env-var scoping, because staging and production become separate databases |
| D4 | **Approved**: fix later, by migrations applied to both | HARDEN gets a ticket with an owner before PROD-2 closes. The advisor bar "no finding that staging lacks" is approved for PROD-2 only |
| D5 | **Approved**: the baseline is not tracked | The manifest also records the checker's sha256 (G-6). The only fingerprints tracked are the PARITY KEY and the SEED KEY. Per-section hashes of the privilege sections are never tracked |
| D6 | **Approved**: B1a dropped | B1a, B1b and B1f are deviations from user-approved wording. TL records the user's acknowledgement in the strategy doc. This ruling does not replace it |
| D7 | **Approved with amendment** | As written ("against the empty production project only") the exception is wrong: U3a (`pg_dump`) and U4 (`psql` seed export) connect to **staging**. The exception covers exactly: U3a, read-only, against staging; U4, read-only, against staging, inside its read-only transaction; the rehearsal U5r (G-1) and U5, against production; U6, against production, before PROD-3 sends it any traffic. Every `psql` call uses `-X` and `-v ON_ERROR_STOP=1`. The exception ends when the manifest PR merges. The warning line in `supabase/migrations/README.md` gets a one-line pointer to it. DO still never runs `psql` (`devops.md` is unchanged) |
| D8 | **Approved** | If production's default is newer, the staging update migration goes through the normal flow and must land before the dump, so OQ-4 is needed by about 11-26. If production's default is *older* than staging's: stop, and SA rules. Re-run F2 after any such update, because P17 will change |
| D9 | **Approved with redesign** | "Numbered above H" can be dodged by a file with no number or an older-looking name. Freeze the current `SQL Scripts` file names as a list asserted by equality, so a stale entry fails (the SECDEF baseline is the precedent). Every file not on the list must be `<8 digits>_<slug>_rollback.sql` with a migration of the same number. The README H check stays, and a fixture proves the guard can fail. It polices repo files only. It does not stop environment drift (E-2) |

### Comments

**A. Grants (Risk A)**

1. Section 4.2 step 3 (line 125): **assert the end state instead of issuing a fixed REVOKE list.** After the neutralisation, `before-schema.sql` raises unless `pg_default_acl` holds **no row for role `postgres`**, whether for `public`, for `operator_private` or global. Postgres deletes a per-schema row once it is empty, and a global row once it equals the built-in default, so "no row" means exactly "the built-in model `pg_dump` assumes". This also answers the PUBLIC question. Leaving PUBLIC alone is right only while `postgres`'s effective default equals the built-in one. If the new project has a global default that removes PUBLIC EXECUTE on functions (or adds any grant), it must be undone for the restore. Otherwise functions are born narrower than the dump assumes, and P08 fails. T9's "does not revoke from PUBLIC" becomes "holds the end-state assertion". Depends on OQ-2 (both projects). — Priority: High, blocks DV-3 — SA: pending
2. Global default ACLs are not carried. With `--schema`, `pg_dump` writes only the default ACLs scoped to a selected schema, never the global ones. If staging has global rows for `postgres`, neither the dump nor `after-schema.sql` restores them, and every later migration then grants differently on production. `after-schema.sql` recreates staging's global `postgres` rows from OQ-2, and the P15 GLOBAL lines prove it. If OQ-2 finds none on staging, the manifest says "none". — High, blocks DV-3 — pending
3. **Grantors other than the owner.** When an ACL item's grantor is not the object's owner, `pg_dump` wraps that GRANT in `SET SESSION AUTHORIZATION <grantor>`. `postgres` is not a superuser and cannot run that, so U5 fails. The failure is safe (one transaction) but would only show up on the day. New **OQ-13** (results private): on staging, the ACL items on our schemas' relations, columns, functions, types and schemas whose grantor is not the owner, plus the `public` schema's own ACL. What each answer means: **0** means nothing to do. **Non-zero on our objects** means a fix is designed before the dump, for example re-granting as the owner on staging by migration. **Non-zero only on the `public` schema's ACL** means U3c also comments out `ACL - SCHEMA public`, and P14 is relied on. Also add a gate row, result only and no count, "ACL items whose grantor is not the owner: none", so the restore assumption stays true for later migrations. — High — pending
4. Every grantee role named in staging's ACLs and in `postgres`'s default ACLs must exist on production, or that GRANT fails. Role names only, private (OQ-13). — Medium — pending
5. Extension members (step 2, line 124). With `--schema`, `pg_dump` treats the extensions as not selected and writes **no** ACL for their members. That makes the order of step 2 the only mechanism. Under Supabase's extension wrapper, a privileged extension may be created by the superuser. In that case its members follow `supabase_admin`'s defaults, and neutralising `postgres`'s defaults has no effect on them. OQ-3 must also return the members' owner. What each answer means: **owner `postgres` and staging's member ACLs equal to `pg_init_privs`** means create before step 3. **Owner `supabase_admin`** means the order does not matter and P17 is the only check. **Staging members carry grants or revokes beyond `pg_init_privs`** means `after-schema.sql` replays them if `postgres` can. If it cannot, SA rules and the difference is recorded. — Medium — pending
6. P15 (line 243): limit it to our schemas plus GLOBAL. `postgres`'s default ACLs in managed schemas are set by Supabase and can differ between images. Move them to I4 as a hash. On `supabase_admin`: leave its default ACLs alone. `postgres` cannot alter them, and they do not affect objects `postgres` creates. Comment out their TOC entries (as planned), compare them by hash in I4, and record equal or unequal in the change record. A difference is an SA ruling, not a gate. — Medium — pending
7. Grantor-free sets: aggregate the ACL lines `DISTINCT`, so a privilege held from two grantors counts once. A missing revoke on production adds an extra `(grantee, privilege, grantable)` line, so the section hash changes and the gap is caught. B-1 adds a deliberate difference in that direction to prove it. — Low — pending

**B. The checker**

1. **Section 7.4 F5: D1 to D5 cover 3 of the 23 P sections** (P07, P08, P09), plus the seed checker. P00 is not tested either. The approved scope says "provably able to fail". Each section needs one rolled-back deliberate difference, or a stated reason why it cannot be changed inside a transaction, on which SA then rules. Suggested set: P00 `SET TimeZone`. P01 force RLS on one table. P02 change one column default. P03 add a `NOT VALID` check. P04 create an index. P05 disable one trigger (this is also R12's proof). P06 replace one view. P10 add a column grant. P11 change one policy's roles. P12 add an enum value. P13 change one sequence's cache. P14 comment on a schema. P15 alter one default privilege. P17 revoke on one extension-member function. P18 change one comment. P19 disable the `auth.users` trigger, if `postgres` may. P20 change one bucket limit. P22 add a table to the publication. P23 is given a reason if `ALTER ROLE` is refused. At least one deliberate difference must **add** a grant that staging lacks, because that is the real Risk A failure. Choose the D objects at run time from a catalog query (psql's `gset`), so that no tracked file names an object and a role together. — High, blocks DV-5 — pending
2. **Vacuity.** "Must have items" only catches a section that is empty on both sides. A wrong filter that drops part of a section (for example `operator_private`) still gives a non-empty and equal result on both sides. At F2, DO reconciles every structural count against the inventory's independently measured numbers (relations, functions, triggers, sequences, enums, policies, indexes, constraints) and records match or mismatch privately. Every section is must-have. A section that is legitimately empty (P21 today, possibly P10 or P23) emits an anchor line that exists whether or not there are items. For example, P21 gives one line per `storage` table with its RLS flag and policy count, and P22 gives the publication flags line. That way "the query returned nothing" can be told apart from "nothing to report". — High, blocks DV-1 — pending
3. **P00 (lines 217, 273) is necessary but not sufficient.** Add `bytea_output` and `server_encoding`. No session setting covers deparse changes between 17.4 and a newer 17.x, so R7 remains. The rehearsal (G-1) and a lines-mode diff mitigate it. Hard-coding the documented P00 values into VERDICT ties the checker to one client. P00 is already in the PARITY KEY, so two different contexts fail the comparison anyway. Preferred: VERDICT checks completeness only, and when P00 differs between the two sides the comparison is **void** ("re-run both in one client"), not "the schema differs". If you keep the documented values, they are those of the comparison-of-record client chosen by OQ-10. — Medium — pending
4. P12 (`typacl`) and P14 (`nspacl`) mix ACL lines with structure, so `show_count` would print a privilege count. Split the ACL lines into their own sections, or set `show_count` false. Add a T row: any section built on `aclexplode` has `show_count` false. — Medium — pending
5. Coverage. Add an **object census** row: per catalog, the count of objects that depend on our namespaces (from `pg_depend`), plus non-view rules. Then an object kind that no section models (an operator, an opclass, a statistics object or a rule) cannot slip through. Add `relreplident`, `relispartition` and the partition bound to P01. Add one aggregate line to P05, "internal triggers not enabled: n", because disabled FK enforcement would otherwise pass. — Medium — pending
6. T6 (line 547): `attacl` and `defaclacl` must not be wrapped in `coalesce(..., acldefault(...))`. A NULL `attacl` means no column privileges, and `defaclacl` is never NULL. Make the test match the right expression for each catalog. — Low — pending
7. Lines mode prints the grant posture. DO **never** runs it through `execute_sql`, because the rows would land in the chat transcript. Only the user runs it: in the SQL editor using download-as-CSV (the result grid truncates), or in the rehearsal's `psql` writing to the private folder. — Medium — pending
8. Paste safety: the skeleton contains no "into" and reads the catalog plus `storage.buckets` configuration only. T2 with the T10 fixtures is enough. — confirmed
9. Seed checker (section 6.2): `to_jsonb` renders `timestamptz` in the session TimeZone, floats according to `extra_float_digits`, and intervals according to `IntervalStyle`. Make all three a gate, as P00 is, not an info row. — Medium — pending

**C. The empty-target guard and atomicity**

1. **Guard definition (line 123).** Staging is already protected twice: by the guard, and by the dump's first `CREATE` failing inside the same transaction. The case the guard really has to catch is a production project that is no longer pristine because someone used the dashboard. There, the `ON CONFLICT DO NOTHING` and `IF NOT EXISTS` steps would silently do nothing. Add refusals for each of these:
   - any row in `auth.users`. This is also the strongest data-level discriminator against staging, and a user created before the trigger exists would have no settings row.
   - any `storage.buckets` row with one of our five ids
   - any non-internal trigger on `auth.users`
   - `vector` or `btree_gist` already installed. The version and the member ACLs must come from step 2.
   - any non-extension type in `public`
   - `current_user` not `postgres`. The owner lines in P01 and P07 depend on it.

   On Supabase's own objects: only extension members are excluded. Anything else Supabase puts in `public` on a fresh project makes the guard refuse, which is failing closed, and then SA rules. That is the right direction. Do not widen the exclusion. — High, blocks DV-3 — pending
2. **Atomicity precondition.** The whole rollback story rests on `--single-transaction`. If the flag is left off, `psql` commits statement by statement. A failure then leaves a half-built project with the seed triggers disabled, and only re-creating the project recovers it. Make every U5 fragment refuse to run outside a transaction block. Open each one with a `SAVEPOINT`: Postgres refuses a savepoint outside a transaction block, so ON_ERROR_STOP stops before anything runs. Release it at the end of the fragment. Add T rows for this, and for "no U5 fragment contains `BEGIN`, `COMMIT`, `END` or `ROLLBACK`". DO-4's structural count on `schema.sql` adds "0 transaction-control lines". — High, blocks DV-3/DV-4 — pending
3. **Rollback if the apply half-succeeds: confirmed, given C-2.** With `-1` and `ON_ERROR_STOP=1`, `psql` wraps every `-f` file in one transaction. On the first error it stops and the transaction rolls back. A dropped connection or a Ctrl+C aborts it on the server. `DISABLE TRIGGER` is transactional DDL, so on failure the triggers come back with everything else. After a successful U5, nothing re-runs: the guard refuses, and the only path is fix-forward or a new project (section 18). — confirmed
4. The dump sets `search_path` to empty for the rest of the session, so `after-schema.sql` and `seed-import.psql` run with an empty search path. Every name in them must be schema-qualified. Add a T row. — Medium — pending

**D. Seeding**

1. **Section 6.2, line 197 is wrong for identity columns.** Leaving an identity column out of the copy renumbers the rows on production. That breaks the parent-child FKs (`capability_building_blocks`, `reward_settings`) or points them at the wrong parent, and the seed md5 differs. Identity values are copied as they are, and their sequence is set afterwards, as for the serial tables. Only generated (stored) columns are left out. The `setval` list then follows OQ-5, not "2 tables". — High, blocks DV-4 — pending
2. `ENABLE TRIGGER USER` turns on every user trigger on the table, including one deliberately disabled on staging. OQ-5 returns `tgenabled` for each trigger on the 19 tables. Disable and enable by trigger name, or confirm that none is disabled. — Medium — pending
3. **Widen OQ-6 (environment-specific data).** As written it covers 4 tables, key names only. Widen it to every text and jsonb column of all 19 tables. Report, per table and column, the count of values that look like a URL, a Supabase host or project ref, an email address, a Stripe-style id or a key, never the values themselves. Likely hits are thumbnail or image URLs in `website_archetypes` and `help_articles` that point at staging storage: production pages would then load images from the staging bucket. What each answer means: **none** means seed as is. **Environment-specific but not secret** means seed it, list it in the bootstrap row, and fix it before PROD-3. **Secret-shaped** means that column or row is left out at export. Never "seed it, then change it", because the artefact would already hold it. — High, blocks DV-4 — pending
4. `system_settings_config` carries database flags. Staging's values reflect testing (kill switches, inert features), not launch intent. Before the export, the user or BA reviews the key list for production intent, privately. Any flag that should differ goes on the bootstrap list. — Medium — pending
5. **Seed completeness.** The list came from a list of candidates. One example: `lib/business-os/purge/descriptors.ts` describes `website_templates` as a global catalogue whose loss "breaks website creation platform-wide", yet it is in neither the seed list nor the exclusions. New **OQ-15**: every `public` table with no tenancy column and no FK to `auth.users`, with row counts. Each one goes either on the seed list or on the exclusion list with a reason. — High, blocks DV-4 — pending
6. `seed-import.psql` writes `ai_model_pricing`. The live-price guard does not see it (it scans migrations for SQL DML and code files elsewhere), and a one-time bootstrap load is acceptable. State the exception in the baseline README, so the guard's "one writer" intent is visibly excepted rather than silently bypassed. — Low — pending

**E. Timing and the forward rule**

1. **Claim verified:** `migrationNumberUnique.guard.test.ts` refuses a 14-digit timestamp name whenever its first 8 digits are 20261093 or later, which covers every current and future date. The B1f deviation is accepted. Pasting a *reviewed* migration in the SQL editor is the transport. What the rule forbids is unreviewed SQL. TL records the user's acknowledgement (D6). — confirmed
2. **The forward rule plus D9 is not enough.** D9 polices files. Drift is environment state, and only the parity check sees it. Required:
   - (a) `supabase-ops` section 4 step 7b runs parity on **both** environments after an apply to **either** of them, not only after a production apply (section 9 rule 3, line 385). The failure mode is "applied to staging, never to production", and under rule 3 as written that never triggers a re-check.
   - (b) An **open-pair register** in the coordination file. A migration applied to one environment stays an open item until both have it.
   - (c) The PROD-4 cutover re-check, as planned.

   — High — pending
3. Section 9 rule 6: data migrations (rows the code needs, such as a new settings key) are migrations under rule 2 and go to both environments. Parity does not see them. Say so, so that "reference data diverges" is not read as "data migrations are staging-only". — Medium — pending
4. Sections 3.2 (line 105) and 8.3: "H = the highest applied migration" does not mean every file at or below H is in the dump. Held, skipped and never-applied files exist, and the ledger is incomplete. Reword the marker: the baseline is staging's live schema at `T_dump`; files at or below H are history, not a statement of what is applied. The manifest lists the known unapplied files at or below H (the held migration, anything merged and awaiting apply) as forward-rule items. — Medium — pending
5. Bootstrap writes versus "never ad-hoc SQL" (section 9 rule 4). The first `admin_users` row and the operator secret hash are data writes on production, and no admin UI can make them. Add a carve-out: reviewed bootstrap data scripts, run per their runbook and recorded privately. Also say how the first production login is created under invite-only sign-up. The dashboard's add-user path is the obvious one, and it tests the `auth.users` trigger in practice: check that the new user's settings row exists. — Medium — pending

**F. Tests and CI (checked against `origin/main`)**

1. O-1 tripwire: it lists every tracked and untracked `.sql` file outside the three apply folders. It will therefore scan `scripts/check-schema-parity.sql`, `scripts/check-baseline-seed.sql`, `supabase/baseline/before-schema.sql` and `after-schema.sql`. It stays green provided that:
   - no file contains `CREATE FUNCTION`
   - the words SECURITY DEFINER appear nowhere in the guard's `DO` body or in any string in the two fragments. The string exemption applies only to files whose first statement is the read-only `SET`, which means the checkers only.
   - no string or dollar body is left unterminated

   `ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS` and `CREATE TRIGGER ... EXECUTE FUNCTION` do not match its GRANT or CREATE patterns. The tripwire matches `*.sql`, so the three `.psql` files are not scanned at all. Extend T9's "defines no function, no SECURITY DEFINER text" to them to close that blind spot. — Medium — pending
2. The other scanners in the inventory either read `supabase/migrations`, `SQL Scripts` and `held` only, read file names by number, or read code extensions only (live-price and billing-symbol scans of `scripts/`). None reads `supabase/baseline/` or the new SQL under `scripts/`. The migration number guard's folder is unchanged. The Tailwind guard scans every tracked text file. psql meta-commands decode to valid code points, so keep Windows paths in forward slashes. **0 existing tests change: confirmed.** — confirmed
3. CI: the new test files are fs-only and run inside the existing Jest gate. There is no new workflow or job. The PR already runs the full build, because `supabase/**` and `.gitattributes` count as deploying paths; that is existing behaviour. **No added CI time: confirmed.** — confirmed
4. In the README, U3b and U3c go in fenced code blocks, not table cells. The escaped pipe in a table cell would be copied literally. — Low — pending

**G. Missing pieces**

1. **Rehearsal (U5r).** Several unknowns are "answered by U5 itself": OQ-11, A-3, A-4, the TOC filter, the `auth.users` trigger, the bucket insert and the extension owner. As soon as the production project exists, run a full apply from a preliminary dump inside an explicit transaction that ends in `ROLLBACK`. Run the parity checker (summary mode) before the rollback. Nothing is left behind, surprises become fixes before 11-28, and most of the delete-and-recreate risk goes away. It runs under the D7 exception. — High — pending
2. **Environment changes section.** The plan has production-tier steps but no `## Environment changes` section under `env-change-protocol` (tier, before-state, probe, order against the deploy, rollback). Those steps are: project creation, the `pg_graphql` toggle, the Data API settings, the apply, a possible MCP scope change for OQ-10, and D8's staging migration. DO writes the section, and SA reviews it before U2b. U2a (creating the empty project) may go ahead now, because deleting the project undoes it. — High — pending
3. Project-creation options. The checklist names every creation-time option that changes the database (Data API on or off, which schema it uses, automatic exposure of new tables, any automatic-RLS event trigger offered at creation) and sets each one to match staging. New **OQ-14**: the event triggers on the new project compared with staging's set (names only). An extra event trigger fires during the restore and can change RLS or grants. — Medium — pending
4. **P23 will fail unless it is handled.** The dump does not carry per-role settings. Widen OQ-7 to both projects. A non-secret difference (`statement_timeout` and similar) is set by `ALTER ROLE ... SET` in `after-schema.sql`, if `postgres` is allowed to. A setting that can carry a secret (database-level `app.settings.*`) is never carried; it appears in I6 only. Also list, by name only, any function of ours that reads `current_setting('app.%')` or the vault. Each such setting is provisioned on production privately, through the bootstrap row. — Medium — pending
5. Credentials and transport. `-W` prompting only is confirmed: no URL, no `PGPASSWORD`, no pgpass file. PowerShell history records the host and user, which contain the project ref. That is not a secret, and the history file is local and outside the repo. `sslmode=require` encrypts but does not verify the server, and a password crosses this connection. Use `verify-full` with the CA certificate from the dashboard if it validates the pooler host. Otherwise use `require`, on a trusted network only. Add `-X` to every `psql` call. From `apply.log`, share the error message, not the statement text, because a failing GRANT line names a grant. — Low — pending
6. The manifest records the sha256 of `check-schema-parity.sql`. Any later change to the checker makes earlier keys incomparable, and both sides are re-run. — Low — pending
7. Settings that make parity *misleading*, though not meaningless: the Data API's exposed schemas (the ACLs match while what is reachable differs; L9 is the probe), whether auth hooks are switched on (the function and its grants are carried, but the switch is a dashboard setting), the S3 protocol, a storage global size limit below a bucket's own limit (uploads fail while P20 passes), and the JWT signing key family. All of these are already in section 10. Mark them "check before L9". — Low — pending

### Adjusted items (marked by SA)
- Section 6.2, the identity row: identity columns are copied with their values and their sequence is set afterwards. Only generated columns are left out (D-1).
- Section 11, D7: the exception list is replaced by the one in the rulings table above.
- Section 9, the optional guard: redesigned as a frozen-list ratchet (D9).
- Section 9 rule 3: parity runs after an apply to either environment (E-2).
- Section 16, OQ-11: replaced by the rehearsal U5r (G-1). New OQ-13, OQ-14 and OQ-15 added. OQ-6 and OQ-7 widened.

### Open-query answers needed before Dev builds

| OQ | Needed before | What the answer decides |
|---|---|---|
| OQ-1 | DV-3 | Only the trigger found: `after-schema.sql` as planned. Anything more: one line in `after-schema.sql` and one P19-style row for each object |
| OQ-2 (both projects) | DV-3 | A-1 (what to neutralise, and the end-state assertion) and A-2 (whether staging's global rows need re-creating) |
| OQ-3 (+ member owner) | DV-3 | A-5: extensions before or after step 3, and whether member ACLs need replaying |
| OQ-4 | D8, by about 11-26 | Equal: nothing to do. Newer: a staging update migration before the dump. Older: stop, SA rules |
| OQ-5 (+ `tgenabled`, identity) | DV-4 | D-1 (identity columns and the `setval` list) and D-2 (triggers by name) |
| OQ-6 (widened) | DV-4 | D-3: seed as is, list in the bootstrap row, or leave out at export |
| OQ-7 (both projects, widened) | DV-3 | G-4: `ALTER ROLE` lines in `after-schema.sql`, or I6 only |
| OQ-8 | DV-3 | Bucket values. Vault secret count above 0: a bootstrap item |
| OQ-9 | U3c | Whether `SCHEMA - public` and `ACL - SCHEMA public` are commented out (A-3) |
| OQ-10 | F1/F4 runner | Yes: DO runs both sides in summary mode through `execute_sql`. Extending MCP to production is itself an environment change, so read-only mode and its own plan step. No: the user runs both sides in the SQL editor (same client) and passes on the summary rows |
| OQ-11 | none | Replaced by U5r (G-1) |
| OQ-12 (widened per E-4) | manifest, at `T_dump` | H, plus the known unapplied files at or below H |
| **OQ-13** (new) | DV-3, U5r | A-3 and A-4: grantors other than the owner, and grantee roles missing on production |
| **OQ-14** (new) | U2a options, U5r | G-3: an extra event trigger, or a creation option that does not match staging |
| **OQ-15** (new) | DV-4 | D-5: the final seed and exclusion lists |

DV-1 (the checker) needs no OQ. DV-2 needs OQ-15 for its table list. DV-5 needs none if the D objects are chosen at run time (B-1). The production-side reads (OQ-2, OQ-4, OQ-7, OQ-9, OQ-13, OQ-14) need U2a and U2b done, so U2 stays in parallel with this review, as R13 plans.

### Addendum: rulings on the staging OQ answers (SA, 2026-11-23)

DevOps answered the staging side of OQ-1, OQ-3, OQ-5 to OQ-9 and OQ-12. OQ-2, OQ-3 and OQ-9 are in the private record only; rulings that depend on them say so without restating them.

| # | Topic | Ruling |
|---|---|---|
| R-1 | **OQ-12: three migrations at or below H are missing or partial on staging** (20261010, 20261123 partial, 20261126) | **Approved: complete them on staging before `T_dump`**, not as manifest exceptions. Production would otherwise inherit the gaps, and `findTenantsMissingPlanRow` already fails on staging today because the function it calls by RPC is absent. Conditions: (a) each goes through `supabase-ops` section 4: pre-check, the user pastes, checker. Timing test case 1 applies: the deployed code already expects these objects. (b) Order: 20261010, then 20261123, then 20261126, which targets the function 20261123 creates. (c) **Find out why 20261123 is partial before re-pasting it.** It is a single `BEGIN ... COMMIT`, so a partial state means an earlier draft was applied, part of it was pasted, or something later dropped the function and its trigger. If the drop was deliberate, re-applying reverses a decision. If not, the file is written to re-run (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`). Its pre-check must still prove that no existing `refund_requests` row violates the re-added status check, which would otherwise fail the whole paste. (d) The three applies are on the critical path. They land before the F2 determinism runs and the dump, and F2 runs after them. (e) The change in E-4 still stands: the README marker must not claim that every file at or below H is applied. 70 staging objects have no tracked SQL; the dump carries them, which confirms the baseline approach. The manifest records that count, not the names |
| R-2 | **OQ-5: four `updated_by` FKs, two price-proposal FK columns, and no insert-firing seed trigger** | **Approved: drop the `DISABLE/ENABLE TRIGGER USER` step.** No user trigger on a seed table fires on INSERT or COPY, so the step only adds an ACCESS EXCLUSIVE lock and the "left disabled" risk. That retires D-2 and R12's mitigation. Replace it with a one-statement assertion at the top of `seed-import.psql`: refuse if any user trigger on the 19 tables fires on INSERT, so a trigger added before the dump cannot fire unnoticed. FK triggers stay on. Correct section 6.2's "insert trigger" rows. **Null at the source** all four `updated_by` columns and both `ai_model_pricing` proposal columns. Do not "assert zero": price review is active, and a proposal applied before the export would make an assertion stop the export, while nulling is correct either way because the proposal tables are not seeded. The seed checker subtracts the same six columns on both sides. With no identity or generated columns, `setval` covers exactly the two serial sequences. D-1 stays as the rule for any future identity column. Export `ORDER BY` uses each table's real primary key (`config_key` and `page_route` where it is not `id`) |
| R-3 | **OQ-6: the `system_settings_config` key `admin_users` holds staging user ids** | **Approved: empty it at export.** Replace the value with an empty value of the same JSON type (an empty array), not NULL, unless the column allows NULL and every reader handles it. The seed checker applies the same transform on the staging side, so the two sides compare equal. On `origin/main`, a literal search finds no code that reads this key; admin authority is the `admin_users` table (CLAUDE.md, Security Rules). So **do not re-populate the key on production**. Record it in the bootstrap row as "left empty; legacy key, no reader". Dev confirms there is no dynamic reader, such as a settings screen listing the `admin` category, before closing. The rest of OQ-6 came back clean (283 strings, positive control 4 of 4) for the 4 tables it covered. D-3 still requires the same scan over the other 15 seed tables |
| R-4 | **`storage.buckets` delete trigger blocks a plain-SQL bucket rollback** | Accepted, and it changes three places. (a) Section 18: the "delete and re-create the production project" path does not depend on deleting buckets, so it stands. A bucket fix-forward is an `UPDATE` of the mismatched columns, never a delete and re-insert. Removing a bucket on production goes through the dashboard or the Storage API, and that is an environment change with its own plan step. (b) The rehearsal (G-1) is unaffected, because its inserts are undone by `ROLLBACK`, not by a delete. (c) The C-1 guard refuses when any of our bucket ids already exists. Clearing them before a re-run is a dashboard step, which the guard's error message names. The P20 deliberate difference (B-1) uses an `UPDATE` inside the rolled-back transaction. If a storage trigger refuses that too, P20 gets a stated reason instead |
| R-5 | Other answers that settle earlier comments | **OQ-1:** nothing of ours outside `public` except the `auth.users` trigger, so `after-schema.sql` is as planned, schema-qualified. **A-2:** settled by OQ-2 (private record). **A-5 and the TOC filter:** settled by OQ-3 and OQ-9 (private record). U3c's filter gains the entries the private record names, and SA reviews the final filter at code review. **G-4 / P23:** OQ-7 found settings on the API roles that the dump does not carry. Read the same names on production at DO-2. Where a value differs, `after-schema.sql` carries an `ALTER ROLE ... SET` for it, provided it is not secret-bearing and `postgres` is allowed to set it. The database-level setting found by OQ-7 stays I6 only. `postgres`'s own `search_path` setting feeds P00 through `execute_sql`, so B-3's "void, not failed" rule matters here. **OQ-8:** bucket values captured for `after-schema.sql`, vault holds no secrets, and the publication has no tables, so the P21 and P22 anchor lines (B-2) are required |

**R-1 revised (SA, 2026-11-23): the staging apply plan for the three missing migrations.** This is the live app database, so it is production tier: the user pastes, after SA approval. The plan is **approved as changed below**, and only if the answer to "was the missing section 7 dropped deliberately?" is no. A yes stops step 2 and goes back to SA and the author.

| Step | Ruling |
|---|---|
| 1. 20261010 | **Approved as written.** Hand it over by its full path, `supabase/migrations/20261010_business_os_tenants_missing_plan_row.sql`, because two migrations and a `SQL Scripts` file share the number 20261010. It already carries its own `SET LOCAL lock_timeout` |
| 2. 20261123 | **A full re-paste is refused.** Section 4 re-adds the status check without `handled`, which would undo 20261124. **Approved:** file lines 284 to 377 of `origin/main`, unchanged, preceded by two added lines, `BEGIN;` and `SET LOCAL lock_timeout = '5s';` (approved; see note 2). Conditions: (a) DO generates the excerpt from `origin/main` with a line-range extract, never by selecting lines in an editor, and records the sha256 of lines 284 to 377 against `origin/main`. (b) The excerpt file lives in the session scratchpad outside the repo. A `.sql` file in the repo's own `scratchpad/` folder is untracked but not ignored, so the SECDEF O-1 tripwire would scan it and go red. (c) The one non-ASCII byte in the block is an em dash in a comment, and the same file's comments have pasted before, so it is kept for byte identity |
| 3. 20261126 | **Skip the paste.** Its whole body is the REVOKE/GRANT already in step 2's block. "Applied" is decided by catalog evidence, not by the act of pasting, so G26-1 to G26-4 passing after step 2 is its evidence. The change record says "20261126 satisfied by the identical statements in 20261123 lines 363 to 364; G26 ok". One fewer production paste |

Checker set, approved with these changes:
- P23-1 to P23-11 must all be ok before step 2. Add one row that records the md5 of the live `refund_requests_status_check` definition.
- S23-8 becomes "the status check's definition md5 equals the value P23 recorded", which is stronger than "it still contains `handled`".
- S23-1 strips CR on **both** sides. The file has no `.gitattributes` LF line, so the user's copy may be CRLF.
- S23-4's `tgtype = 21` is right: row, AFTER, INSERT and UPDATE.
- The existing `SQL Scripts/20261123_refund_agent_checker.sql` still fits the post-20261124 state. Its last row reads NULL, not false, while the trigger is absent, so it is not used as the step 2b failability proof. S23-1 to S23-7 failing on the current state is that proof.
- C10-1 to C10-9 and G26-1 to G26-4 are approved as described.
- Order: P23, then step 1 and C10, then step 2 and the existing checker plus S23, then G26. Run the advisors before and after.

Rollback is approved, with each step wrapped in `BEGIN; SET LOCAL lock_timeout = '5s'; ... COMMIT;`. For step 2, drop the trigger before the function, as written. Rolling back step 1 only returns to today's state, in which the RPC caller already fails.

Note 2, lock_timeout: `DROP TRIGGER IF EXISTS` takes an ACCESS EXCLUSIVE lock on `payment_refunds` even when the trigger is absent, and `CREATE TRIGGER` then takes SHARE ROW EXCLUSIVE. Without a timeout, a paste stuck behind a long transaction would block every read and write on that table for the live app while it waits. A timeout aborts the whole transaction cleanly, and the user re-runs it.

**OQ-15 ruling: a general PROD-2 rule for rows inserted by migrations.** A schema-only dump drops every row a migration inserted. Dev lists every top-level INSERT and UPDATE in `supabase/migrations/` and `supabase/SQL Scripts/` that targets a table outside the seed list, and puts each one in one of three classes, recorded in the manifest:

| Class | What it is | Where it goes |
|---|---|---|
| (a) Reference rows | Catalogue rows that must equal staging's | The table joins the **seed** list, so its rows are copied and the md5 proves them |
| (b) Initialisation rows | Singletons, markers and "installed at" rows whose value belongs to the environment | **`after-schema.sql`**, re-executing the migration's own statement, for example `bos_cron_run_recording`'s `DEFAULT VALUES` insert from 20261011. Never a copy of staging's value. The seed checker checks that the row exists, not its content |
| (c) One-time backfills or fixes of staging's existing rows | e.g. audit rows, data repairs | Neither. Excluded, with the reason |

**Closed by round 2 (private record):** A-3 and A-4 need no action, but A-3's gate row stays so the condition remains true for later migrations. D-3 is closed: seed as is, apart from emptying the `admin_users` key. D-5 is closed for `website_templates`, which does not exist. The stale purge-descriptor entries for `website_templates` and `intake_form_templates` are a separate Dev ticket, not PROD-2. The orphan trigger function that the dump will carry goes on the HARDEN cleanup list.

**Bootstrap note (E-5):** `app/admin/settings/page.tsx` on `origin/main` says admin access also comes from an `ADMIN_EMAILS` environment setting. The first production admin can therefore come either from that variable (a PROD-3 environment change) or from an `admin_users` row. The bootstrap row in section 10 names which one, and if it is the variable, when it is removed again.

### Dev response: DV-1 conditions (Dev, 2026-11-23)

DV-1 is code complete and awaits SA code review. Files: `scripts/check-schema-parity.sql`, `supabase/baseline/prove-checker-can-fail.psql`, `supabase/baseline/prove-checker-step.psql`, `scripts/__tests__/schemaParityBaseline.test.ts`, three `.gitattributes` lines. **No database was available to Dev, so the SQL has been checked as text only.** DO-1b is its first execution, on staging, read-only. SA's status markers above are left for SA to close.

| Condition | Dev status | Where |
|---|---|---|
| B-1 one deliberate difference per section | Done. 31 steps cover P00 to P26 and G1, plus D07b (CRLF, nothing may change), POST and AFTER. Targets are chosen at run time, so no tracked file names an object of ours or pairs one with a role. Stated reasons for the P05 anchor and the possible NOT RUN refusals | 7.4; the `.psql` pair; T13 |
| B-2 anchors and reconciliation | Done. Anchors on P05, P10, P19, P21, P22, P23 (SA R-5 requires P21 and P22). I8 gives the reconciliation counts through the sections' own filters, and 7.4 defines the procedure, with privilege sections reconciled privately | 7.1, 7.4, DO-3; T12 |
| B-3 P00 additions, VOID not FAIL | Done. `bytea_output` and `server_encoding` added. VERDICT is completeness only. CONTEXT KEY (the P00 hash) is compared first: unequal is VOID. PARITY KEY excludes P00 | 7.1; T12 |
| B-4 no privilege counts from P12 / P14 | Done by splitting: P24 type ACLs and P25 schema ACLs, both md5-only. P12 and P14 are structure only | 7.2; T11 |
| B-5 coverage | Done. P26 object census (namespace dependencies per catalog, non-view rules, statistics objects). P01 gains `relreplident`, `relispartition`, the bound, the partition key, parents and access method. P05 gains the internal-trigger anchor | 7.2; D26 |
| B-6 attacl / defaclacl | Done. Exploded as they are, never NULL-expanded. T6 now checks each catalog's own form | T6 |
| B-7 lines mode never via `execute_sql` | Done, in the checker header and 7.1. DO-1b, DO-2 and DO-3 say summary mode only | 7.1 |
| B-9 seed checker gates | Not DV-1: DV-2 | - |
| A-3 gate row | Done as G1: result only (`none` / `present`), never a count, in VERDICT. Schema ACLs left out, per A-3's own split | 7.1; DG1 |
| A-6 P15 scope, `supabase_admin` by hash | Done. P15 is our schemas plus GLOBAL. I4 holds every other default ACL by md5 | 7.2 |
| A-7 grantor-free sets, a step that adds a grant | Done. ACL lines are `DISTINCT` without the grantor. Seven steps add a grant: D08b, D09b, D10, D15, D17, D24, D25 | 7.4 |
| F-1 the O-1 tripwire | Green. The checker creates nothing, and neither the checker nor the `.psql` files contain the SECURITY DEFINER phrase or a function definition (T2 covers the `.psql` files the tripwire cannot see) | T2 |
| Editor constraints | The word "into" appears nowhere. ASCII, LF, no meta-commands, no single-letter aliases. No semicolon or apostrophe in a checker comment | T2 |
| Optimisation: `expected_parity_key` parameter | **Not taken.** Editing a parameter changes the file's sha256, which G-6 ties to key comparability. The two key rows make the comparison two values instead | - |

**Code Review by SA — 2026-11-23** (DV-1: checker, proof pair, text test, `.gitattributes`)
**Status:** 🔄 Fix Required. The design is right and nearly all of it is done as ruled. Five small fixes are blocking, four of them in the proof pair. SA re-reviews **only the deltas**. QA starts once they land.

**Checked:** every catalog query in `scripts/check-schema-parity.sql`; all 34 steps and `proof_compare` in the proof pair; the test. Also ran `npx jest scripts/__tests__/schemaParityBaseline supabase/__tests__/security-definer-surface app/__tests__/tailwind-css-escape` (3 suites, 123 tests, green). Byte checks on the three SQL files: 0 CR, 0 non-ASCII, `git check-attr eol` = lf. No standalone "into". No SECURITY DEFINER phrase. No COMMIT, `dblink`, `\!`, `\c` or `\gexec`. The only psql meta-commands are `\set`, `\pset`, `\o`, `\ir`, `\copy` and `\gset`. The tracked text holds no project ref, grant count or object-role pair. The gate floors are minimums, so the new suite needs no floor change. Like Dev, SA has run nothing against a database.

**Conditions closed by this review:** B-1 (subject to fix 2), B-3, B-4, B-5, B-6, B-7, A-3 (G1), A-6, A-7, F-1 (T2 now scans the `.psql` files, which closes the T9 blind spot). B-2 closes once fix 3 is in.

### Code Review Comments

**Blocking (fix, then SA re-reviews the deltas)**

1. `supabase/baseline/prove-checker-can-fail.psql:48` — **nothing stops a run against staging.** The header says "never against staging", but no statement enforces it. On staging, D01, D04, D05, D06, D12, D19 and D22 each take a SHARE or ACCESS EXCLUSIVE lock on a live table, and hold it until their savepoint rolls back. Without a lock timeout, any one of those waits behind a long query, and every app read and write on that table then queues behind it. The rollback undoes the data, but not the outage. Fix:
   - right after `BEGIN READ WRITE`, add a `DO` block **with no exception handler** that raises when `auth.users` holds any row. This is the discriminator C-1 already uses. Production has no user before PROD-3, and staging always has some.
   - add `SET LOCAL lock_timeout = '3s'`.
   - The raise message names no count and no object. It also sets an order: U6 must run before the first production login (E-5).
   - A T13 row pins both, and one mutation proves the row can fail.
   — Priority: **High**

2. `prove-checker-can-fail.psql:81` (D16 expectation) — **D16 will FAIL as written.** `CREATE EXTENSION` writes the control file's comment on the new `pg_extension` row. That row has a normal dependency on its schema, so `comment_scope` (checker lines 193-199) picks it up, and **P18** moves. P18 is not in D16's `may_change`. Add it, with a one-line reason. D18 still proves P18 on its own, so nothing is weakened. U5r or U6 confirms this, not DO-1b. — **High**

3. `scripts/check-schema-parity.sql:133-142` — **P15 has no anchor, and it can legitimately be empty** (the B-2 rule). When `postgres` has no default-ACL row in either of our schemas or GLOBAL, P15 has zero lines and VERDICT is FAIL for good. That is the built-in state A-1's assertion aims at mid-apply. It is also the likely end state if a later S11 lockdown revokes the API-role defaults, because Postgres deletes a row once it is empty. Staging's actual state is in the private record, so neither Dev nor SA can claim that P15 is non-empty. Fix: emit constant anchor lines (`anchor | default ACL scan | <public, operator_private, GLOBAL>`). They are constant, so P15 stays md5-only and prints no count. Then add P15 to `ANCHORED` in the test. F1 still fails through P01 and the other structural sections. **DO-1b tells us something:** if P15 comes back FAIL on staging, the gap is already live today. If it comes back PASS, the fix is still required. — **Medium, blocking (B-2)**

4. `prove-checker-can-fail.psql:127-129` — **every step turns a refusal into NOT RUN.** That contradicts Dev's stated rule (item 5 below). Today a 42501 or 0A000 on D01 to D15, D18 or D24 to D26 reads NOT RUN, which flows to "PASS, NOT RUN steps go to SA" instead of SCRIPT ERROR. `postgres` owns every candidate on those steps, so a refusal there means the script is wrong. Fix: add a `may_refuse boolean` column to `proof_expect`, true only for D16, D17, D19 to D23 and DG1. Use it in the `refused:` branch. A T13 row checks that the set is exactly those eight, and one mutation proves the row can fail. "No candidate" may stay NOT RUN for every step, because SA rules on each one. — **Medium, blocking**

5. `scripts/__tests__/schemaParityBaseline.test.ts:352-358, 405-411` — **T13 only sees transaction control at the start of a line in the proof file.** `COMMIT` written mid-line, or on a line with no `;`, passes. So does anything in `prove-checker-step.psql`, which the test never scans for control statements. It does not check meta-commands either. A `\c` reconnect would leave the rest of the run in autocommit, `\gexec` could run a generated COMMIT, and `\!` is a shell. Fix:
   - scan **both** files' `bare` text for `\b(COMMIT|END|ABORT|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED)\b` anywhere. `END` inside a `DO` body is already blanked. Also ban `dblink` and `pg_background`.
   - add an **allow-list** of psql meta-commands for both files: `\set \pset \o \ir \copy \gset`. Anything else fails.
   - add three mutations: COMMIT in the step file, `\c` in the proof, `\gexec` in the proof.
   — **Medium, blocking** (this is the escape-hatch proof the brief asks for)

**Not blocking. Land before F2, because any checker edit changes its sha256 (G-6), and F2 is the run of record**

6. `check-schema-parity.sql:59-63, 607-633` — **a schema of ours outside the two named ones is invisible**, which is partial vacuity at the schema level. OQ-1 says none exists today, so the baseline is safe. The risk is a migration under the forward rule that creates one. Add to I7 one line for each schema owned by `postgres` that is neither ours nor in I7's managed list (name only). It stays info, not a gate, because managed-schema owners can differ between Supabase images. DO's reconciliation reads it. — Medium
7. `check-schema-parity.sql:496-498` (P22) — `prattrs` prints attnums. A restore renumbers them wherever staging has dropped columns. Map them to column names, sorted. Nothing is affected today (0 member tables). — Low
8. `check-schema-parity.sql:255-261` (P04) — add `indisvalid`. An invalid index on staging comes back from the dump as valid, and that difference should show up. **For DV-3, not DV-1:** a `--schema-only` dump creates materialized views WITH NO DATA and never refreshes them. If I8 shows `matviews` above 0, `after-schema.sql` needs a `REFRESH` for each one, or reads fail with "has not been populated". `relispopulated` in P01 would make that visible. — Low (checker), Medium (DV-3)
9. `check-schema-parity.sql:89-97` (P17) — P17 covers member **functions** only. ACLs on extension member types (for example `vector`) are not compared. Accept it and record it in 7.2, or add the types. — Low
10. `prove-checker-can-fail.psql:738-747` (D13) — leave identity sequences out of the candidates (`pg_depend` deptype `i`). If `ALTER SEQUENCE` refuses one, the refusal is a script problem, not a proof result. With fix 4 it becomes SCRIPT ERROR instead of a silent NOT RUN. — Low
11. `prove-checker-can-fail.psql:42-45` — add `SET client_min_messages = error` once the transaction opens. Server NOTICE and WARNING text, such as "no privileges were granted for ...", names objects and would reach `proof.log`. No step is expected to raise one. This makes sure none can. — Low
12. Workplan DO-1b (line 587) says "drop its first line". The first line is a comment. Say "drop the `SET` line", as `checker-pattern.md` does. — Low

### Rulings on Dev's deviations

| # | Deviation | Ruling |
|---|---|---|
| 1 | `expected_parity_key` not added | **Accepted.** It was optional, and the G-6 argument holds: a committed value edit changes the sha256. Comparing two key values is enough |
| 2 | T2's raw CR check replaced by the LF pin plus CR-normalised reads | **Accepted.** T3 pins `eol=lf`, and SA confirmed 0 CR bytes on disk. A CR in the checker's own text never reaches a hash: function bodies and comments are stripped, and psql and the SQL editor accept CRLF |
| 3 | The P05 internal-trigger anchor cannot be perturbed | **Accepted.** Disabling a system trigger needs a superuser. The anchor is one `count(*)` over a fixed predicate, which the text pins, and D05 proves the rest of P05 |
| 4 | VERDICT's completeness half proven by F1, not inside F5 | **Accepted.** One limit, recorded at DO-2: F1 proves completeness only for the sections that are empty on an empty project. The anchored sections (P05, P10, P19, P21 to P23, and P15 after fix 3), and P14 and P25, cannot fail completeness by design. Their proof is their D step. DG1 proves VERDICT's G1 half |
| 5 | Listed steps print NOT RUN with the SQLSTATE; any other error is SCRIPT ERROR | **Accepted as the policy. The code does not implement it yet:** see fix 4 |
| 6 | CONTEXT KEY compared first (unequal means VOID); PARITY KEY excludes P00 | **Accepted.** This is B-3 as ruled. D00 correctly requires only P00 and CONTEXT KEY to move |

### Answers to the review questions

- **Filters, and partial vacuity.**
  - The extension-member exclusion is applied the same way in `our_rel`, `our_fn` and `our_type`, and P03, P04, P05, P11 and P13 inherit it through `our_rel`.
  - P05's internal-trigger exclusion is anchored.
  - The array and row-type filters in `our_type` are right.
  - P18 reaches constraints, triggers, policies, rules, columns, indexes and namespace-dependent catalogs.
  - The holes are P15's missing anchor (fix 3) and the fixed schema list (comment 6). I8 runs through the same CTEs, so F2's reconciliation against the independent inventory is what proves the filters.
- **Determinism.** Every aggregate sorts `COLLATE "C"`, and every array is sorted before printing. No line prints an OID or a timestamp, and the grantor appears only in G1's predicate. The one exception is P22's attnums (comment 7). Output that depends on deparse is covered by CONTEXT KEY.
- **"Must change" against "May also change".** No step's may-list hides its must-section: each must-change row moves without the side effect. D16 has the opposite problem, a side effect missing from its list (fix 2). Every other step changes only what its row says.
- **One transaction, rolled back.**
  - The proof runs two transactions, each ending in ROLLBACK, then a VALUES-only summary.
  - It contains no COMMIT, autonomous transaction, `dblink`, shell or reconnect.
  - Every change is transactional DDL or DML, and neither `nextval` nor `setval` is called.
  - `\gset` captures the BASE keys before the first ROLLBACK drops the temp table.
  - `--single-transaction` is harmless: the warnings show only that there was nothing left to commit.
  - Fix 5 makes the test prove all of this.
- **Empty production only.** Safe there: the locks are short, nothing survives the rollbacks, and the scratch CSV holds summary rows only. Nothing stops a staging run today, which is fix 1.
- **Privacy.** P08, P09, P10, P15, P17, P24, P25 and I4 print md5 only. G1 prints `none` or `present`. The proof log carries codes, states and the two keys. The tracked files are clean. **Ruling for section 20 (QA):** record the per-row PASS/FAIL, CONTEXT KEY and PARITY KEY only, and **never the per-section md5 of a privilege section** (D5). P24 and P25 hash a handful of low-entropy lines, so their md5 can be reversed by enumeration.
- **CI cost.** One fs-only suite inside the existing Jest gate: no new job, step or workflow, and the suite runs in well under a second. No added CI time.

### What DO-1b (first live run, staging, summary mode) confirms or refutes

| Expectation | Confirms / refutes |
|---|---|
| Runs, 39 rows, no SQL error | The syntax and catalog-column review (nothing found that should error on 17.x). Any error goes to Dev as the message only |
| P15 PASS or FAIL | Fix 3: FAIL means the gap is live today. PASS still needs the fix |
| G1 PASS (`none`) | A-3 round 2, "no action". FAIL goes to SA |
| P16, P17 PASS | That extension members sit in `public` as the inventory says |
| I8 against the inventory (DO-3) | That the filters are not partially vacuous |
| D16 (fix 2), fix 1, fix 4 | **Not** testable by DO-1b. U5r or U6 confirms them |

### Addendum: DO-1b first run on staging (SA, 2026-11-23)

**DO-1b found a defect the text review missed: SA's miss.** The shipped checker fails at plan time with SQLSTATE 42725, ambiguous `text || "char"`, at line 135 (`dacl.defaclobjtype`) and line 390 (`own_dep.deptype`). SA had judged those two concatenations resolvable. They are not, because `"char"` has no unambiguous `||` with `text`.

- **Dev's fix (a `::text` cast at those two sites, nothing else): approved.** SA grepped both files and the proof pair. No other concatenation involves a `"char"` catalog column. Every other `"char"` column is printed through `format()`, which is safe.
- **The Jest rule Dev proposes against uncast `"char"` concatenation: approved.** It needs a mutation that removes one of the two casts and expects the complaint. It must name the `"char"` columns explicitly (at least `relkind`, `relpersistence`, `relreplident`, `prokind`, `typtype`, `defaclobjtype`, `deptype`, `contype`, `polcmd`, `tgenabled`, `attidentity`, `attgenerated`, `attstorage`, `attcompression`, `evtenabled`, `aggkind`), so that a new column cannot slip past a pattern.

**The diagnostic copy's result on staging, with only those casts:** 39 rows, every P row PASS, G1 `none`, byte-identical across two runs, and I8 equal to the inventory on all nine measures. That is the first live evidence that the filters are not partially vacuous (B-2 reconciliation) and that the output is deterministic within one client. **It was a diagnostic copy, not the file under review.** The run of record is the re-run of DO-1b against the fixed file in the worktree, recorded with that file's sha256.

**Effect on the findings above:**
- **Fix 3 (P15 anchor) still stands.** P15 is PASS on staging today, which is the "PASS, still required" case in the table above. The gap is the end state after a lockdown that empties `postgres`'s per-schema default-ACL rows.
- Fixes 1, 2, 4 and 5 are proof-pair or test changes, and DO-1b does not test them.
- **Comment 7 (P22 attnums)** stays inert. The publication has 0 member tables, so P22 is its anchor only, as R-5 required. D22 is what proves P22 can move.
- **Order of edits:** fix 3 and the non-blocking checker items 6 to 8 change the checker's sha256 again. Land them together with the casts, then do **one** DO-1b re-run on the final file. That re-run, not the diagnostic copy, is what F2 builds on.

**Rulings on DO's other points:**
- **`pg_graphql` absent on staging (I3); a new project may have it on.** No checker change. D2 already rules it off, and U2b turns it off before DO-2. I3 is info, so the parity keys never depend on it. Two checks enforce the setting:
  - DO-2 / F1 must read `absent` on production.
  - C-1's empty-target guard (DV-3) refuses the apply while it is installed.

  If I3 reads `present` on production at DO-2, U2b was not done: stop and redo U2b. Do not adapt the checker.
- **The MCP client's `search_path` is `"$user", public, extensions`, so a compare across clients is VOID.** That is by design (B-3). Consequences:
  - The comparison of record uses `execute_sql` on **both** projects, if OQ-10 allows it, or the user's SQL editor on both. Never one of each.
  - CONTEXT KEY and PARITY KEY values from the U6 psql run are **not** comparable with `execute_sql` values. U6 compares only with its own BASE, so this is expected, not a fault.
  - The manifest records which client produced the recorded PARITY KEY, next to the checker's sha256 (G-6).

### Dev response to the code review (Dev, 2026-11-23)

Everything below landed in **one** pass with the two approved casts, so the checker's sha256 changed once: `f43175e7...` (reviewed) to **`bf1a7b3185bcbfcb47e1dfcbd29c6f4a22534feed0e3b078b862f6d8200971ec`**. Proof `e42f6107de2b2c7995840b0a470d9b9e601e69a15c17a4a661d0dddeb6f760d7`, step `b3f6d79c5f988b7bebc6e2de8d4ed85992dc30e512c73b76b5ed753aa56a0376`. The checker has **not** run on a database in this form: the DO-1b re-run is the gate (section 14).

| # | Fix | Where |
|---|---|---|
| 42725 | `dacl.defaclobjtype::text` (P15) and `own_dep.deptype::text` (P13), nothing else. New T14 rule names the `"char"` columns explicitly; three mutations (each cast removed, a `"char"` column on the left of `\|\|`); the pre-fix file goes red on exactly the two sites | checker; T14 |
| 1 | Staging guard right after `BEGIN READ WRITE` (a `DO` block, no exception handler, refuses rows in `auth.users`, message names no count or object), then `SET LOCAL lock_timeout = '3s'`. U6 runs before the first production login (sections 7.4, 12). Mutations: guard removed, guard given a handler, timeout removed | proof; T13 |
| 2 | D16 may also move P18, with the reason in the file | proof; 7.4 |
| 3 | P15 constant anchors (`public`, `operator_private`, `GLOBAL`); P15 in `ANCHORED`; mutation drops it | checker; T12 |
| 4 | `may_refuse` column, true for exactly D16, D17, D19 to D23, DG1; the compare view uses it; any other refusal is SCRIPT ERROR. Mutations: D01 set true, the view ignoring the column | proof; T13 |
| 5 | Both `.psql` files scanned: COMMIT, ABORT, PREPARE TRANSACTION, COMMIT PREPARED anywhere; an END closing no CASE (CASE ... END is legitimate in the view and summary, so ENDs may not outnumber CASEs); `dblink`, `pg_background`; meta-command allow-list `\set \pset \o \ir \copy \gset`. Mutations: COMMIT, END and `\!` in the step file; `\c`, `\gexec`, mid-line COMMIT and `dblink_exec` in the proof | T13 |
| 6 | I7 lists every schema owned by `postgres` that is neither ours nor managed (name only) | checker |
| 7 | P22 prints sorted column names, not attnums | checker |
| 8 | P04 adds `indisvalid`; the matview REFRESH note is on DV-3 | checker; section 14 |
| 9 | P17 functions-only, recorded as accepted | 7.2 |
| 10 | D13 leaves identity sequences out | proof |
| 11 | `SET client_min_messages = error` in both transactions, pinned by T13 | proof |
| 12 | DO-1b says "drop the `SET` line"; and the new rule: DO-1b on the exact file is a required gate before SA or QA sign-off on any checker change | section 14 |

**Code Re-review by SA — 2026-11-23** (deltas only)
**Status:** ✅ Code Approved for QA

**Files re-reviewed, by sha256 (SA recomputed all three):** checker `bf1a7b3185bcbfcb47e1dfcbd29c6f4a22534feed0e3b078b862f6d8200971ec` (786 lines), proof `e42f6107de2b2c7995840b0a470d9b9e601e69a15c17a4a661d0dddeb6f760d7` (1373 lines), step `b3f6d79c5f988b7bebc6e2de8d4ed85992dc30e512c73b76b5ed753aa56a0376` (unchanged). SA's run: 3 suites, 140 tests, green.

**DO-1b on the exact checker file (that sha256, not a diagnostic copy):** 39 rows, every P row PASS, G1 `none`, no SQL error, and the two runs byte-identical. I8 equals the inventory on all nine measures. I7's new branch reports no unlisted schema owned by `postgres`. This satisfies condition (b), and with it the B-2 reconciliation and F2-style determinism within one client. One addition is not exercised: P22's column naming, because the publication has 0 member tables. It planned without error, and D22 exercises it at U5r or U6. Dev's response line "has not run on a database in this form" is superseded by this run.

| Item | Verdict |
|---|---|
| 42725 casts (lines 135, 400) + T14 | ✅ T14 names the `"char"` columns explicitly. It checks both sides of `\|\|`, and three mutations go red. Text tests cannot catch planner errors in general: T14 closes this one class only, as its comment says |
| 1 Staging guard + lock timeout | ✅ The `DO $guard$` block has no handler and sits after `BEGIN` and before any lock or temp object. Its message names no count or object. `SET LOCAL lock_timeout = '3s'` comes before the first savepoint. The three mutations go red |
| 2 D16 may move P18 | ✅ The reason is in the file. D18 still proves P18 on its own |
| 3 P15 anchors | ✅ Three constant lines, so P15 stays md5-only. P15 is in `ANCHORED`, and its mutation goes red. F1 still fails through P01 and the other structural sections |
| 4 `may_refuse` | ✅ True for exactly D16, D17, D19 to D23 and DG1. The view applies NOT RUN to a refusal only when `may_refuse` is true. Any other refusal reads SCRIPT ERROR. T13 pins the set |
| 5 Escape hatches | ✅ Both files are scanned for COMMIT, ABORT, PREPARE TRANSACTION, COMMIT PREPARED, `dblink*` and `pg_background*`. The meta-command allow-list (`\set \pset \o \ir \copy \gset`) applies to both. The seven mutations go red. The END rule is ruled below |
| 6 I7 unlisted schemas | ✅ Name only, info only. `pg_*` (temp schemas included) and `information_schema` are excluded, so the proof's own temp schema never shows |
| 7 P22 column names | ✅ Sorted `attname`, so no attnums. Not exercised live (see above) |
| 8 P04 `valid=` | ✅. The matview REFRESH note is carried to DV-3 |
| 9 to 12 | ✅ P17 recorded as functions-only. D13 leaves identity sequences out. `client_min_messages = error` in both transactions, pinned. The DO-1b wording is fixed |

**Ruling on the END rule (deviation from fix 5): accepted. It is sufficient.**
- Outside dollar bodies, comments and strings (all blanked in `bare`), every legitimate END in valid SQL closes exactly one CASE. A transaction `END`, `END WORK` or `END TRANSACTION` therefore always makes ENDs outnumber CASEs by at least one, whatever its position in the line.
- A line-start `END ...;` is also caught by the separate transaction-shape check.
- Requiring equality instead of "no more than" would add nothing: a CASE without an END does not parse.
- The rule can only be masked by a CASE word that is not SQL, such as a double-quoted identifier `"case"` or a `\set` value. That is a deliberate evasion, not a slip, and none exists. No change required.
- For the record: a mid-line `ROLLBACK` or `BEGIN` is not an escape. `\set AUTOCOMMIT` and `\set ON_ERROR_ROLLBACK` are reachable through the allowed `\set`, but neither can commit, and `ON_ERROR_STOP` still stops the run.

**Ruling on Dev's gate: confirmed, with two amendments.**
1. **The gate is keyed to the sha256.** DO-1b records the sha256 of the file it ran, and SA and QA sign off only on that same sha256. Any later edit, a comment included, re-opens the gate, and the manifest records the signed sha (G-6).
2. **Scope:** the gate covers every SQL file that runs against a database.
   - The checker, and from DV-2 `check-baseline-seed.sql`: read-only DO-1b-style runs, summary mode only, through `execute_sql`.
   - The proof pair and the DV-3/DV-4 fragments write, so DO cannot run them on staging. Their live gate is the rehearsal U5r on the empty production project, before U5 and U6. Until then their sign-off is the text review plus Jest, and it says so in section 20.

### Code Approved for QA: Yes (re-review 2026-11-23). Superseded line: "No. Yes once (a) fixes 1 to 5 land and SA has re-reviewed the deltas, and (b) DO-1b is re-run against the final checker file". Both conditions are now met

**What QA runs (QA-1), after the fixes:**
1. `npx jest scripts/__tests__/schemaParityBaseline supabase/__tests__ app/__tests__/tailwind-css-escape`: all green, and the SECDEF O-1 tripwire and the migration number guard are unchanged.
2. Run the `tsc` check from DV-9 on `scripts/__tests__/schemaParityBaseline.test.ts`, filtered to that file. Confirm the command did not die from OOM.
3. Confirm the new mutations exist and fail: the staging guard (fix 1), `may_refuse` (fix 4), and COMMIT in the step file, `\c` and `\gexec` (fix 5).
4. `git check-attr eol` on the three files reports `lf`. `git status` shows nothing under `supabase/migrations/`, and nothing under `supabase/baseline/` except the two `.psql` files.
5. Review the DO-1b evidence: 39 rows, every P row PASS, G1 `none`, no SQL error. Record it in section 20 by the privacy ruling above.

### Optimisation Suggestions
- Optionally add a `expected_parity_key` parameter (NULL by default) to the checker, so it can print MATCH or MISMATCH and the comparison stops relying on a person reading two hashes.
- An `apply.psql` wrapper that includes the four files in a fixed order, with the folder passed as a psql variable. Then the order and the guard-first rule live in a tracked file instead of a long command line.
- Optional: upgrading staging to the same 17.x patch as production before the dump removes R7 and clears the outstanding security patches, at the cost of a short staging restart. Recommended if a window exists; otherwise accept R7.
- A Jest row asserting that no tracked file under `supabase/baseline/` ends in `.dump` or `.csv`. The O-1 tripwire already goes red if a rendered `schema.sql` is ever saved inside the repo, so do **not** add a `.gitignore` entry for it: that would hide it from the tripwire.

### Approval
[x] Workplan approved **with conditions**. DV-1 and DV-2 proceed now. DV-3, DV-4 and DV-5 proceed once the High items for that file are written into this workplan and the OQs in the table above are answered. SA then reviews the revised sections only (4, 6.2, 7, 9, 11, 12, 15, 16 and the new Environment changes section).

### Addendum: rulings on the production reads, OQ-14 and OQ-4 (SA, 2026-11-24)

The production project exists (us-east-1, PG 17.12, empty). The main session ran the production-side reads, read-only.

| # | Topic | Ruling |
|---|---|---|
| R-6 | **OQ-14: production has an extra event trigger, `ensure_rls`** (ddl_command_end; CREATE TABLE, CREATE TABLE AS, SELECT INTO; owner `postgres`; function `public.rls_auto_enable()`). This is the automatic-RLS creation option. It enables RLS on every new table in `public` and swallows its own errors | **Remove it: approved. Where: amended.** Not in `before-schema.sql`, but as its own environment step, **U2c**, next to U2b. Reasons: (a) C-1 ruled that the guard's exclusion is never widened, and the function sits in `public`, so the guard would refuse a project that still has it. (b) It is a creation option set back to staging's value, which is what U2b already does for `pg_graphql`. (c) One change per step, with its own probe. U2c, in order: if the dashboard has an off switch for automatic RLS, use it. Otherwise the user drops the event trigger and then the function, as `postgres`, in the SQL editor. Before-state: the event-trigger row and the md5 of `pg_get_functiondef`, kept in the private record. Probe: production's event-trigger names equal staging's six exactly (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`), and the function is absent. Rollback: re-create both from the captured definition. DO adds U2c to the Environment changes section. **The guard (C-1) gains one assertion, not an exclusion:** refuse unless the event-trigger names equal those six. A trigger that reappears, or a new platform trigger, then fails closed before any `CREATE TABLE`, and SA rules. If the trigger comes back after U2c, treat the option as a platform setting and switch it off in the dashboard. G-3's checklist sets this option off for any re-creation (section 18). Adopting automatic RLS on **both** environments, and the RLS state of the one staging table that has it off, goes to HARDEN as a migration applied to both |
| R-7 | **Checker change for R-6** | **Needed, kept small.** I5 stays info: platform event triggers may differ between images, the same reasoning as A-6. Add a branch to **P26**: one line for each event trigger **owned by `postgres`** (name, event, sorted tags, enabled, function). P26 already models "an object kind no other section models", so there is no new row, no anchor and no change to the 39-row count. An event trigger that changes our DDL then moves the PARITY KEY, so section 9's after-either-apply parity catches drift. `evtenabled` is `"char"`: print it through `format()`, and the T14 list already names it. **Proof that the branch can move:** run the checker (summary mode, read-only) on production before and after U2c, both on the new sha256. P26 must change. That run is also U2c's probe. If the checker change cannot land before U2c, add a D26b step instead (a `postgres` event trigger created inside the rolled-back proof, `may_refuse` true). Gate as already ruled: a DO-1b re-run on staging against the new sha256, and SA and QA sign off on that sha256. It lands before F2 |
| R-8 | **OQ-4 / D8: `vector` default is 0.8.2 on production, staging has 0.8.0, and staging's image offers only 0.8.0** | **D8 amended: pin the version.** D8's "update staging" path is impossible without a Postgres image upgrade on the live staging database, which is a bigger production-tier change and out of proportion. Production's image lists 0.8.0 among its versions, so the reason D8 gave against pinning ("packages ship only the newest base script") does not apply here. `before-schema.sql` creates `vector WITH SCHEMA public VERSION '0.8.0'` and also **pins `btree_gist VERSION '1.7'`**, so a default that moves before U5 cannot drift either. U5r proves the pin, and a refusal fails closed inside the transaction. P16 compares versions at U5r and U6. Conditions: the manifest checks that staging's installed version at `T_dump` still equals the pin, and re-reads it if a staging image upgrade happens first. Never `ALTER EXTENSION ... UPDATE` on one environment alone. Moving to 0.8.2 is a migration applied to both, once staging's image offers it (HARDEN, with the staging 17.x patch suggestion). Ignore any dashboard prompt to update the extension on production. R6's mitigation is this ruling. This supersedes the D8 row in section 11 and its ruling above |
| R-9 | **`supabase_vault` 0.3.2 on production, 0.3.1 on staging** | **Confirmed: no action.** It lives in `vault`, outside `our_schemas`, so P16 does not see it. It shows in I2, which is info only. OQ-8 found that vault holds no secrets of ours. The change record notes the expected I2 difference, so the person comparing the two sides is not surprised |
| R-10 | Other production reads | **No action.** OQ-2 and OQ-9 (production side) are in the private record. **G-4 / P23 is closed:** the API-role settings match, so `after-schema.sql` carries no `ALTER ROLE`. The extra platform role `supabase_read_only_user` is not ours and stays outside P23's `api_role` list. All grantee roles exist on production (A-4). `pg_graphql` is absent (D2). The `search_path` matches. **OQ-10: yes**, so DO runs both sides through `execute_sql`, which is the same client for the comparison of record (B-3) |

**Dev: R-7 implemented (2026-11-24).**

- `scripts/check-schema-parity.sql`, block P26: a new `UNION ALL` branch over `pg_event_trigger`, filtered to `evtowner` = `postgres`. One line per trigger: `event trigger | name | event= | tags= | enabled= | function=`. Tags are sorted (`array(SELECT ... FROM unnest(evt.evttags) ... ORDER BY 1)`); `evtenabled` (`"char"`) goes through `format()` only, never `||`. I5 is unchanged. No new section row and no anchor, so the count stays 39.
- `scripts/__tests__/schemaParityBaseline.test.ts`: a new audit rule (the branch exists, is filtered to owner `postgres`, and sorts its tags), a dedicated test (also asserts the sections and the 39-row count are unchanged), and 4 mutations: branch removed, owner filter dropped, tags unsorted, `evtenabled` joined with `||` (caught by T14).
- Checker sha256: `3f7c5b98f10cc19500703e1ff6508494e88cb5940ee430ad81a56587bd3774d0` (superseded below).
- Jest: 55/55 (was 50). The new branch has never run on a database. A DO-1b re-run on staging against this sha256 is still the gate.

**Dev: SA code review fix for R-7 (2026-11-24).** The tag sort is now `ORDER BY evt_tag.tag_name COLLATE "C"`, matching the file's determinism rule (was `ORDER BY 1`). The audit regex and the tags-unsorted mutation follow it, and a 5th mutation drops `COLLATE "C"` and goes red. Checker sha256 now `83cb77bab2081243d9e913b2fcad04e67ea440ec5e412ffdb8a99cba00affa69`. Jest 56/56. The DO-1b re-run on staging is owed against this sha256.

**Code Review by SA — 2026-11-24** (R-7: the P26 event trigger branch, both passes)
**Status:** ✅ Code Approved

First pass, on `3f7c5b98...74d0` (Fix Required). This note was not written to the file at the time, so it is recorded here.
1. `scripts/check-schema-parity.sql`, the tag sort: `ORDER BY 1` used the database's default collation. Every other text sort in the file uses `COLLATE "C"`, as the DETERMINISM rule requires, so the sort had to use it too. Priority: Medium.
2. The audit regex and the mutation had to follow item 1, and a new mutation had to drop `COLLATE "C"`. Priority: Medium.
3. A new sha256, with DO-1b re-run on it. Priority: High (gate).

The first pass also confirmed these, and they still hold:
- The change is R-7 only.
- `evtenabled` goes only through `format()`, so the code is safe from the 42725 class.
- `pg_event_trigger` carries no ACL, and the function is printed by name only.
- The sections and the 39-row count are unchanged.
- The harness asserts that each mutation changed the text.

Second pass, on `83cb77bab2081243d9e913b2fcad04e67ea440ec5e412ffdb8a99cba00affa69`:
- SA confirmed the sha256 with `sha256sum`.
- SA re-ran Jest: 56/56.
- Item 1 is done: `ORDER BY evt_tag.tag_name COLLATE "C"`.
- Item 2 is done: the audit regex is updated, the tags-unsorted mutation now targets the new text, and the new mutation ("tags sorted without `COLLATE \"C\"`") passes, which means the audit catches the broken text.
- Item 3 is done: the Dev note and the Change History row carry the new sha256.

### Code Approved for QA: Yes, on sha256 `83cb77ba...fa69`. The gate is unchanged: DO-1b must re-run on staging against this sha256, and any run against `3f7c5b98...` counts only as a smoke test.

---

## 20. QA Testing Report

**QA — 2026-11-24 (DV-1: the schema parity checker and its proof that it can fail)**
**Test mode:** full
**Strategy used:** A (Jest text audit) plus real-file mutation runs, and E-style review of the DO-1b evidence. The checker cannot run in Jest, because there is no database. Its only live run is DO-1b on staging.
**Focus:** schema, security
**Skipped:** no live run by QA. QA has no database tool in this session, so the DO-1b result below is recorded from SA's re-review in section 19. QA did not run it again.
**Input source:** prompt keywords (SA's QA-1 list in section 19, plus the TL brief)

**Signed artefacts (QA recomputed all three with `sha256sum`, and each matches):**

| File | sha256 | Lines |
|---|---|---|
| `scripts/check-schema-parity.sql` | `bf1a7b3185bcbfcb47e1dfcbd29c6f4a22534feed0e3b078b862f6d8200971ec` | 786 |
| `supabase/baseline/prove-checker-can-fail.psql` | `e42f6107de2b2c7995840b0a470d9b9e601e69a15c17a4a661d0dddeb6f760d7` | 1373 |
| `supabase/baseline/prove-checker-step.psql` | `b3f6d79c5f988b7bebc6e2de8d4ed85992dc30e512c73b76b5ed753aa56a0376` | 22 |

### Test Coverage

| Criterion (QA-1 and brief) | Tested? | Result | Notes |
|---|---|---|---|
| 1. Jest: parity test, `supabase/__tests__`, Tailwind escape guard | ✅ | Pass | 3 suites, 140 tests. SECDEF guard and Tailwind guard unchanged against `cf379a2a`. The migration number guard sits in `supabase/migrations/__tests__/`, which the QA-1 pattern does not match. QA ran it separately: 6/6, and the folder is unchanged against base |
| 2. `tsc` filtered to the test file, not OOM | ✅ | Pass | Run with a 12 GB heap. 0 diagnostics in `schemaParityBaseline.test.ts`. The file is in the program (`--listFilesOnly`). There are 1,408 semantic TS2xxx errors elsewhere in the repo, all pre-existing, so the semantic pass ran. No V8 or heap trace |
| 3a. In-test mutations exist and are asserted | ✅ | Pass | All 14 are named in the brief, and each asserts `broken !== original` plus its specific complaint: guard removed, guard with handler, lock timeout removed, D01 `may_refuse`, view ignores `may_refuse`, step COMMIT, step END, step `\!`, proof `\c`, `\gexec`, mid-line COMMIT, `dblink_exec`, and the three T14 `"char"` cases (P15 `defaclobjtype`, P13 `deptype`, `relkind` on the left of `\|\|`) |
| 3b. Real files broken, test red, restored byte-exact | ✅ | Pass | 14 real-file breaks, each listed below with its result. After every restore, `sha256sum -c` printed OK for all three files |
| 4. `eol` attributes and `git status` | ✅ | Pass | `lf` for all three files. Nothing under `supabase/migrations/`. Under `supabase/baseline/`, only the two `.psql` files. No CR byte on disk in any of the four files |
| 5. DO-1b evidence recorded by the privacy ruling | ✅ | Recorded | See below. Recorded from SA, not run again by QA |
| sha256 of all three files | ✅ | Pass | Table above |
| No PRIVATE inventory facts in the slice files or the workplan | ✅ | Pass | No project ref, no ACL string such as `role=arwd/owner`, and no pairing of an object with a role. The test file names no object. Grant figures appear only as SA's step labels. The only counts are the structural inventory in section 2, which carries no privilege data |
| `into` and the SECURITY DEFINER phrase absent from the 3 SQL/psql files | ✅ | Pass | A whole-word, case-insensitive grep finds no hits in any of the three |
| Untracked files are exactly the slice | ✅ | Pass | The checker, the 2 `.psql` files, the test and this workplan, plus the `.gitattributes` edit (6 added lines) |
| Folder scanners that could read the new files | ✅ | Pass | `scripts/__tests__`, `supabase/**` and `app/__tests__`: 77 suites, 3,637 of 3,638 tests passed. The one failure is `lib/__tests__/supabaseFetch.test.ts`, which the `supabase` pattern matched by name. It expects a development-only timeout, so it fails because of the shell's `NODE_ENV`. It reads no slice file, and the slice touches no `lib/` code |

**Real-file mutations (3b).** Each row was applied to the real file, then the full parity suite was run and the file was restored from a byte copy:

| Break | File | Tests | Complaint printed |
|---|---|---|---|
| Staging guard removed | proof | 3 failed | `staging guard: no DO block refusing ...` |
| Guard given `EXCEPTION WHEN OTHERS` | proof | 2 failed | `staging guard: it has an exception handler ...` |
| `SET LOCAL lock_timeout` removed | proof | 2 failed | `lock timeout: ... not set before the first step` |
| D01 `may_refuse` set to true | proof | 2 failed | `may_refuse: expected exactly D16,...,DG1 and found D01,...` |
| Compare view ignores `may_refuse` | proof | 2 failed | `may_refuse: the compare view does not gate ...` |
| `\c postgres` added | proof | 1 failed | `psql meta-command \c is not on the allow-list` |
| `\gset` changed to `\gexec` | proof | 1 failed | `psql meta-command \gexec is not on the allow-list` |
| Mid-line `; COMMIT;` | proof | 1 failed | `proof: transaction control COMMIT` |
| `dblink_exec(...)` added | proof | 1 failed | `autonomous-transaction escape dblink_exec` |
| COMMIT appended | step | 1 failed | `step: transaction control COMMIT` |
| END appended | step | 1 failed | `step: an END that closes no CASE (1 END, 0 CASE)` |
| `\!` added | step | 1 failed | `step: psql meta-command \! is not on the allow-list` |
| P15 `defaclobjtype` cast removed | checker | 2 failed | `planner: "char" column joined with \|\| without ::text` |
| P13 `deptype` cast removed | checker | 2 failed | `planner: "char" column joined with \|\| without ::text` |

### DO-1b evidence (checker sha256 `bf1a7b3185bcbfcb47e1dfcbd29c6f4a22534feed0e3b078b862f6d8200971ec`)

Source: SA's re-review in section 19, on the exact signed file. Following `supabase-ops` section 1, the run dropped the `SET` line and wrapped the rest in `begin read only; ... commit;`. Recorded under the privacy ruling: PASS or FAIL for each row, the keys as present only, and no privilege-section md5.

| Row(s) | Result |
|---|---|
| Row count | 39, as the header states |
| VERDICT | PASS |
| P00 to P26 | PASS, every row (P08, P09, P10, P15, P17, P24 and P25: PASS only, hash not recorded) |
| G1 | `none` |
| CONTEXT KEY / PARITY KEY | present |
| I1 to I8 (information only) | I4: hash not recorded. I7: the new branch found no unlisted schema. I8: equal to the inventory on all nine measures (199/20/221/103/368/1085/1091/4/3) |
| SQL error | none |
| Determinism | two runs, byte-identical |
| Not exercised | P22's column naming, because the publication has 0 member tables. The section planned without error, and D22 exercises it at U5r or U6 |

**The proof pair has passed text review only.** `prove-checker-can-fail.psql` and `prove-checker-step.psql` write, so they cannot run on staging. Their sign-off is SA's text review plus this Jest audit. Their live gate is the U5r rehearsal on the empty production project, before U5 and U6. SA's fixes 1, 2 and 4 (the staging guard, D16 moving P18, `may_refuse`) are confirmed only there.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **The meta-command allow-list admits two shell escapes.** The file is `scripts/__tests__/schemaParityBaseline.test.ts` (`ALLOWED_META`). Severity: Low.
   - Input: in the step file, `\o parity-proof-run.csv` is changed to `\o '|psql -c "select 1"'`. Or a line `\copy (select 1) to program 'psql -c "select 1"'` is added.
   - Expected: red, like `\!`, because both run a shell command, and that command could start its own session and commit.
   - Actual: 50/50 green on the real file (QA applied both, then restored the file, and the sha256 is unchanged).
   - Same class as SA's `"case"` ruling: this is a deliberate evasion, not a slip, and neither file contains it today. Suggested fix: refuse an `\o` target that starts with `|`, and refuse `program` in a `\copy`.
2. **The QA-1 command does not reach the migration number guard.** `supabase/__tests__` does not match `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts`. QA ran that guard separately and it passed. Name the guard's path in future QA-1 lists.
3. **The Tailwind escape guard does not cover untracked files.** It lists files with `git ls-files`, so its green run in item 1 did not scan the five new files. QA ran the guard's decoder on all six slice files after this report was written, and found no undecodable escape. CI covers them once the files are committed.

### Test Outputs / Logs

```text
npx jest scripts/__tests__/schemaParityBaseline supabase/__tests__ app/__tests__/tailwind-css-escape
PASS scripts/__tests__/schemaParityBaseline.test.ts
PASS app/__tests__/tailwind-css-escape.guard.test.ts
PASS supabase/__tests__/security-definer-surface.guard.test.ts
Test Suites: 3 passed, 3 total
Tests:       140 passed, 140 total

npx jest supabase/migrations/__tests__/migrationNumberUnique
Tests:       6 passed, 6 total

git check-attr eol (3 files): eol: lf, eol: lf, eol: lf
git status --porcelain -- supabase/migrations/   (no output)
sha256sum -c (after the last restore): OK, OK, OK
```

### Final Status
- [x] All acceptance criteria pass — ready for commit, on the three sha256 values above. Any edit to any of the three files, a comment included, re-opens the DO-1b gate (SA amendment 1)
- [ ] Issues found — Dev must address before commit

### QA addendum: R-7, the P26 event trigger branch (2026-11-24)

**Test mode:** full. **Strategy:** A (Jest text audit and mutations) plus E (review of DO's read-only runs). **Focus:** schema. **Skipped:** QA ran no SQL; the live runs are DO's. **Input source:** TL brief.

| Criterion | Tested? | Result | Notes |
|---|---|---|---|
| Checker sha256 equals SA's approved `83cb77ba...fa69` | ✅ | Pass | Recomputed with `sha256sum` |
| `schemaParityBaseline.test.ts` | ✅ | Pass | 56/56. Includes the dedicated R-7 test (owner filter, `format()` only, sections and 39 rows unchanged) |
| `security-definer-surface.guard.test.ts` | ✅ | Pass | 84/84 |
| Failure path in Jest | ✅ | Pass | 5 new mutations go red: branch removed, every owner, tags unsorted, sort without `COLLATE "C"`, `evtenabled` joined with `\|\|` |
| `git diff --stat` | ✅ | Pass | Only the checker (+13), its test (+37) and this workplan. Nothing else modified or untracked |
| Happy path, staging (DO, read-only, on this sha256) | ✅ | Pass | Two runs: 39 rows, VERDICT PASS, byte-identical. Staging has no `postgres`-owned event trigger, so P26 is unchanged by construction |
| Failure path, production (DO, read-only, on this sha256) | ✅ | Pass | VERDICT FAIL, as expected for the empty project. P26 moved with exactly +1 line (the `ensure_rls` trigger); only P26 and the PARITY KEY moved |

**Issues:** none. **Status:** ✅ R-7 ready for commit on sha256 `83cb77bab2081243d9e913b2fcad04e67ea440ec5e412ffdb8a99cba00affa69`.

---

## 21. Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-23 | Workplan created | PROD-2 (B1a to B1g). Baseline kept out of git; archive = leave in place + README marker (0 existing tests changed); 19-table seed (954 rows); catalog fingerprint checker with VERDICT, P00 to P23, PARITY KEY and I rows, proven able to fail by rolled-back deliberate differences; nine SA decisions with recommendations |
| 2026-11-23 | SA workplan review | Approved with conditions. D1 to D5, D6 and D8 approved; D7 amended (staging reads are in the exception); D9 redesigned as a frozen-list ratchet. Blocking: end-state default-ACL assertion, global default ACLs, foreign grantors (OQ-13), one deliberate difference per section, anti-vacuity reconciliation, stronger empty guard, savepoint atomicity precondition, identity-column seed fix, widened OQ-6, seed completeness (OQ-15), parity after either environment's apply, rehearsal U5r, Environment changes section |
| 2026-11-23 | SA addendum on staging OQ answers | R-1 complete 20261010 / 20261123 / 20261126 on staging before the dump (find the cause of the partial first); R-2 drop the trigger-disable step, null six FK columns at source, insert-trigger assertion; R-3 empty the `admin_users` settings key, not re-populated; R-4 bucket delete trigger: fix-forward by UPDATE, removal via dashboard |
| 2026-11-23 | SA ruling on the staging apply plan + OQ-15 | 20261010 as written; 20261123 lines 284-377 only (full re-paste refused: it would undo 20261124's status check), with BEGIN and a 5 s lock_timeout; 20261126 not pasted, proven by G26; checker additions; rule for migration-inserted rows (seed / after-schema / excluded) |
| 2026-11-23 | DV-1 code complete (Dev) | `scripts/check-schema-parity.sql` (39 rows: VERDICT, P00 to P26, G1, CONTEXT KEY, PARITY KEY, I1 to I8), `prove-checker-can-fail.psql` + `prove-checker-step.psql` (one rolled-back deliberate difference per section, targets chosen at run time), `scripts/__tests__/schemaParityBaseline.test.ts`, three `.gitattributes` lines. Sections 7.1, 7.2, 7.4, 12 (U6), 13, 14 (DV-1, DO-1b to DO-5b), 15 and the section 19 Dev response updated. Not yet run against a database: DO-1b first |
| 2026-11-23 | SA code review of DV-1 | Fix Required. Blocking: (1) staging guard + lock_timeout in the proof, (2) D16 may also move P18 (extension comment), (3) P15 anchor (B-2), (4) NOT RUN on refusal only for D16, D17, D19 to D23, DG1, (5) T13 escape-hatch scan of both `.psql` files + meta-command allow-list. Six Dev deviations accepted; non-blocking items 6 to 12 to land before F2; section 20 privacy ruling (no per-section privilege md5). Addendum: DO-1b's 42725 (`text || "char"` at lines 135 and 390) was missed by SA; the `::text` casts and a Jest rule are approved; the verdict is conditional on a DO-1b re-run against the final file; pg_graphql, MCP search_path (VOID across clients) and empty-publication rulings |
| 2026-11-23 | DV-1 fixes after DO-1b and the SA code review (Dev) | The two approved `::text` casts (42725) plus SA fixes 1 to 5 and items 6 to 12 in one pass. Checker sha256 now `bf1a7b31...71ec`. New T14 `"char"` concatenation rule. Recorded that text-only tests cannot catch planner errors, so DO-1b on the exact file is a required gate before SA/QA sign-off on any checker change. Jest 50/50 in the suite, 140/140 with the guards |
| 2026-11-23 | SA re-review of DV-1 (deltas) | Code approved for QA. All 5 blocking fixes and items 6 to 12 verified. DO-1b passed on the exact checker sha256 (39 rows, all P PASS, G1 none, byte-identical, I8 = inventory). END rule (ENDs may not outnumber CASEs) ruled sufficient. DO-1b gate confirmed, amended: keyed to sha256; proof pair and fragments are gated live by U5r |
| 2026-11-24 | SA rulings on the production reads (OQ-14, OQ-4) | R-6: remove the `ensure_rls` event trigger and `public.rls_auto_enable()` as a separate step U2c (dashboard switch first, otherwise SQL), not in `before-schema.sql`; the C-1 guard asserts the six staging event-trigger names. R-7: P26 gains a line for each `postgres`-owned event trigger, proven by a before/after run around U2c, with a DO-1b re-run on the new sha256. R-8: D8 amended to pin `vector` 0.8.0 and `btree_gist` 1.7, proven at U5r. R-9: `supabase_vault` difference needs no action (I2 only). R-10: no `ALTER ROLE` needed (G-4 closed); OQ-10 yes |
| 2026-11-24 | Dev: R-7 implemented | P26 gains a `pg_event_trigger` branch (owner `postgres`; name, event, sorted tags, enabled via `format()`, function). No new row, count stays 39. New audit rule + 4 mutations. Checker sha256 now `3f7c5b98...74d0`. Jest 55/55. Not yet run on a database: DO-1b re-run owed |
| 2026-11-24 | Dev: SA code review fix for R-7 | Tag sort is now `ORDER BY evt_tag.tag_name COLLATE "C"`; audit regex and mutation updated, and a new mutation drops `COLLATE "C"`. Checker sha256 now `83cb77ba...fa69`. Jest 56/56. DO-1b re-run owed on this sha256 |
