# Workplan: Business OS Issue Reporting — Slice 1.1 Report Storage

> **Last Updated**: 2026-11-27

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md) — slice **1.1**, data-model row `issue_reports`, CR-5, CR-19, SR-2, SR-3, OQ-S5, OQ-S12
**Date:** 2026-11-27
**Status:** SA Approved with changes (RC-1 to RC-9 folded in below). **Split taken by Barak on 2026-11-27:** slice 1.1 ships as **1.1a storage** (**Merged** to `main` in PR #700, merge `25eec10c`; migrations 20261137 and 20261138 **applied** to the live database) and **1.1b repository** (**In progress**). See [§9](#9-files-to-create--modify) and [§14](#14-task-list).
**Branch (1.1a):** `feature/bos-issue-reporting-1-1a`, cut from a freshly fetched `origin/main` (`05732d73`) in its own worktree (see [§11](#11-branch-worktree-and-ship-drill)).
**Branch (1.1b):** `feature/bos-issue-reporting-1-1b`, cut from a freshly fetched `origin/main` (`25eec10c`, the #700 merge) in its own worktree, with no upstream set.

> **1.1a apply record (2026-11-27).** Checker A read ok on every gate row. The 20261138 checker (checker B) read **8 / 9**: row 9, the exact-body md5, differed only because the SQL editor paste carried CRLF line endings. The md5 of the live body with the CR characters removed equals the committed body's md5 (`44f20892f1719dcf76ab51179eebc655`), so the applied function is the committed one.

> **Migration numbers moved by one (Step 1 re-check, 2026-11-27).** The open branch `fix/no-show-next-session-charge` now carries `20261136_session_charge_decisions.sql`. So migration A is **20261137** and migration B is **20261138**. Where the SA Review Notes say "20261137" for migration B, read 20261138. Every other section of this plan uses the new numbers.

## Overview

Slice 1.1 adds the place where a "Report an issue" submission is stored, and nothing a user can reach: one table, `issue_reports`, with RLS and grants that let the server write and let a signed-in user read only their own rows; a repository with only the two methods slices 1.2 to 1.5 need; and the registrations that make the table visible to deletion and export **in the same slice** (CR-19). There is no route, no UI, no email, no flag and no audit event in this slice.

The research for this plan found three couplings the requirement does not name. Each changes the size of the slice, so they are stated up front:

1. **The account cleanup function has to learn the new table** (a second, generated migration). The test-account cleanup and the account-deletion anonymise both run `public.operator_test_account_cleanup`, which refuses on **G-10** whenever a foreign key to the login has not been reviewed. A new `user_id -> auth.users` foreign key that the function does not know about makes **every** Danger Zone check, test-account delete and account-deletion anonymise refuse (fail closed) until the function is regenerated. In anonymise mode the login is kept as a tombstone, so `ON DELETE CASCADE` never fires. Without the function update, a closed account's reports would **survive** the deletion. The generator's drift test also fails CI on any new descriptor. So 1.1 ships a regenerated `*_operator_test_account_cleanup_issue_reports` migration, as `business_os_account_closures` (20261093 + 20261094) and the export requests (20261095 + 20261096) did.
2. **Including the table in the export is more than one descriptor field.** An `include` classification needs a section id, a registry entry, a module in the export drawer map, and labels for every column in English, Hebrew and Spanish. CI checks all of these (§6.2).
3. **Several tests pin counts.** These include the descriptor total (167), the classification baseline (167), the include/exclude totals (38/129), and the module and section counts (13/39). Each moves by one in this slice.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Table Design](#2-table-design)
3. [Reference Generation](#3-reference-generation)
4. [Migration A — issue_reports: SQL Outline, Pre-check, Checker, Rollback](#4-migration-a--issue_reports-sql-outline-pre-check-checker-rollback)
5. [Migration B — the Regenerated Cleanup Function](#5-migration-b--the-regenerated-cleanup-function)
6. [Deletion and Export Registration](#6-deletion-and-export-registration)
7. [Repository](#7-repository)
8. [Tests](#8-tests)
9. [Files to Create / Modify](#9-files-to-create--modify)
10. [Out of Scope](#10-out-of-scope)
11. [Branch, Worktree and Ship Drill](#11-branch-worktree-and-ship-drill)
12. [Risks](#12-risks)
13. [Open Questions for SA](#13-open-questions-for-sa)
14. [Task List](#14-task-list)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## 1. Analysis Summary

| Touches | What | Why |
|---|---|---|
| Database | New table `public.issue_reports`. Migration A creates it, migration B regenerates the cleanup function | OQ-S5 data model; CR-5 / SR-2 grants; CR-19 / SR-3 deletion |
| Repository | New `lib/repositories/IssueReportRepository.ts` | CLAUDE.md rule 1; CR-5 |
| Domain constants | New pure module `lib/business-os/issue-reports/issueReportModel.ts`: statuses, category hints, closed reasons, reference format and generator | One source for the migration's CHECK values, the repository's Zod schema and later the 1.2 route schema and the 1.5 form chips (a client component can import a pure module) |
| Purge registry | One descriptor in `lib/business-os/purge/descriptors.ts` + the classification baseline | CR-19; `descriptors.invariant.test.ts`, `exportClassification.test.ts` |
| Ownership registry | One `USER_OWNED_TABLES` entry in `lib/business-os/businessOwnedTables.ts` | `businessOwnedTables.test.ts` fails on a `user_id` table nobody classified |
| Export | A section id, a registry entry, a module and labels | CR-19 default: report + context + customer-facing status |
| Test-account cleanup | Generator constants, regenerated operator SQL, migration B + rollback, version stamp, applied-file pins | G-10 / anonymise coupling (Overview point 1); `testAccountCleanupSql.test.ts` drift test |
| Providers / LLM / entitlements / audit | **None** | 1.1 has no AI call, no entitlements import (the `business-os-entitlements` skill does not apply) and no audit event (events arrive in 1.2) |

**V6 / plugin phase:** not applicable. 1.1 touches neither the V6 pipeline nor the plugin system.

**Live schema:** not measured in this session (no database tool was available to Dev here). The pre-check (§4.3) is the live evidence. It proves `issue_reports` is absent and that every dependency (`auth.users.id` uuid, `auth.uid()`, the roles, the live cleanup function stamp) has the expected shape. The main session or DO runs it before the apply. Every other claim in this plan about existing code was read from `origin/main` at `1f24faeb`.

**Requirement doc not on `main`:** `BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md` is untracked in this checkout and absent from `origin/main`. RM lands it (or the feature branch carries it), so the slice's PR can link to it.

---

## 2. Table Design

### 2.1 Columns

| # | Column | Type | Null | Default | Constraint / note |
|---|---|---|---|---|---|
| 1 | `id` | `uuid` | NOT NULL | `gen_random_uuid()` | Primary key |
| 2 | `user_id` | `uuid` | NOT NULL | — | `REFERENCES auth.users (id) ON DELETE CASCADE` (CR-19). Always the session user, never input (CR-1, SR-2) |
| 3 | `reference` | `text` | NOT NULL | — | `UNIQUE` (constraint `issue_reports_reference_key`). CHECK format `^R-[0-9A-HJKMNP-TV-Z]{8}$`: `R-` + 8 Crockford base-32, with no I, L, O or U (§3) |
| 4 | `message` | `text` | NOT NULL | — | CHECK `char_length(message) BETWEEN 1 AND 5000`. A backstop only: the 10-character minimum is 1.2's Zod rule, so a change to the suggested minimum needs no migration |
| 5 | `category_hint` | `text` | NULL | — | CHECK `IN ('bug', 'support', 'feature')` (§5.1 chips). NULL = the user picked no chip |
| 6 | `page` | `text` | NOT NULL | — | Always attached (§4.4). CHECK: starts with `/`, contains no `?` or `#` (query string and fragment stripped, §4.2), `char_length <= 512` |
| 7 | `area` | `text` | NULL | — | NULL = unmapped route (SR-7). Shape CHECK `^[a-z][a-z0-9_-]{0,39}$`. The lifecycle `area:*` list is open-ended (DEVELOPMENT_LIFECYCLE §8.3 ends in "…"), so the enumerated map lives in 1.2's code, not in a DB enum |
| 8 | `environment` | `text` | NOT NULL | — | Shape CHECK `^[a-z][a-z-]{1,31}$`. The value set is 1.2's (see SA Q6) |
| 9 | `status` | `text` | NOT NULL | `'submitted'` | CHECK `IN ('submitted', 'in_review', 'classified', 'actioned', 'resolved', 'closed')`. Exactly §7 |
| 10 | `closed_reason` | `text` | NULL | — | CHECK `IN ('duplicate', 'spam', 'no_response')` (§7). Shape CHECK `(status = 'closed') = (closed_reason IS NOT NULL)` |
| 11 | `context` | `jsonb` | NULL | — | Filled from M2. CHECK `context IS NULL OR (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 32768)`. Size backstop; 2.1 / 2.2 Zod is the real bound |
| 12 | `screenshot_path` | `text` | NULL | — | Filled in 2.4. CHECK `screenshot_path IS NULL OR (char_length(screenshot_path) <= 512 AND left(screenshot_path, 74) = user_id::text || '/' || id::text || '/')`. The `{user_id}/{report_id}/` layout of OQ-S2, enforced by the row itself, so a path can never point at another account's folder |
| 13 | `problem_id` | `uuid` | NULL | — | **Plain nullable uuid with no foreign key and no index in 1.1.** `issue_problems` arrives in 3.5a, which adds `FOREIGN KEY … REFERENCES issue_problems (id) ON DELETE SET NULL` and its index. Until then nothing writes it |
| 14 | `created_at` | `timestamptz` | NOT NULL | `now()` | |
| 15 | `updated_at` | `timestamptz` | NOT NULL | `now()` | Set by the repository on every update (none in 1.1). **No trigger** — see §2.3 |

Fifteen columns. Nothing beyond the OQ-S5 shape is added (no `resolved_at`, no counters).

### 2.2 Indexes

| Index | Columns | Serves |
|---|---|---|
| PK | `id` | `findByIdForUser` (1.3 / 1.4 drain reads) |
| `issue_reports_reference_key` (from the UNIQUE) | `reference` | Collision detection; later support look-ups by reference |
| `issue_reports_user_created` | `(user_id, created_at DESC)` | The owner list (3.6) and any per-account read; the RLS predicate |

No status, area or `problem_id` index yet. The admin review screen (3.3) and 3.5a add what they measure they need.

### 2.3 `updated_at` convention

Recent server-write-only tables (`20261093_business_os_account_closures`, `20261095_business_os_export_requests`) have `updated_at timestamptz NOT NULL DEFAULT now()`, with **no trigger**: the repository sets it in each update. Older tables use per-table `update_*_updated_at` triggers. This plan follows the recent precedent. A trigger would also be one more object for the cleanup generator's reviewed-trigger lists (`REVIEWED_UPDATE_TRIGGERS`).

### 2.4 RLS, grants, policy (CR-5, SR-2)

- `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
- `REVOKE ALL ON TABLE public.issue_reports FROM PUBLIC, anon, authenticated, service_role;`. Supabase's default privileges grant the browser roles everything on a new table in `public`, so the revoke is required. `service_role` is revoked too and granted back explicitly, as 20261093 does.
- `GRANT SELECT ON TABLE public.issue_reports TO authenticated;`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.issue_reports TO service_role;`. UPDATE and DELETE are granted now, so M2 / M3 (status, context and screenshot path, retention) need no grant migration (see SA Q3).
- One policy: `CREATE POLICY issue_reports_owner_select ON public.issue_reports AS PERMISSIVE FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));`. It names `TO authenticated` explicitly, never the PUBLIC default, because a policy with no TO clause applies to PUBLIC, every role. There is no INSERT, UPDATE or DELETE policy, so no client write path exists even if a grant were added by mistake.
- No `SECURITY DEFINER` function in 1.1. The claim RPC (SR-4) is 1.3's.

---

## 3. Reference Generation

**Where:** in TypeScript, in the pure module `lib/business-os/issue-reports/issueReportModel.ts`, not in a DB function.

| Option | For | Against |
|---|---|---|
| **TS generator (chosen)** | Pure and unit-testable with an injected random source; the same function serves 1.2's plain insert and 1.3's report-plus-outbox write (it is passed as a parameter if 1.3 uses an RPC); no `pgcrypto` / `extensions` schema dependency | A retry loop in the repository |
| DB default (`DEFAULT issue_report_reference()`) | Insert needs no value | A new function to lock down (search_path, EXECUTE grants), and one more object for the cleanup and SECURITY DEFINER inventories |

**Generator (1.1b):** `generateIssueReportReference(randomBytes = defaultRandomBytes)` takes 8 random bytes and maps each through `byte & 31` to the alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. 256 is a multiple of 32, so there is no modulo bias. Output `R-XXXXXXXX`. **RC-7:** the default byte source is Web Crypto, `globalThis.crypto.getRandomValues(new Uint8Array(8))`, which Node 18+ and every browser provide. Node's `crypto` module is never imported, so the model module stays pure and client-safe for 1.5, and there is no server-only sibling file. The byte source stays injectable for tests.

**1.1a ships the constants only:** the alphabet and the regex `ISSUE_REPORT_REFERENCE_PATTERN` (pinned equal to the migration's CHECK by the text test), with the statuses, category hints and closed reasons. The generator is added to the same module in 1.1b.

**Collisions:** 32^8 ≈ 1.1 × 10^12 values, so a collision is practically never expected. Still, `create` retries **up to 3 attempts in total** when, and only when, the insert fails with SQLSTATE `23505` **and** the error names `issue_reports_reference_key`. Each attempt uses a fresh reference. Any other `23505`, any other error, or a third collision returns `{ data: null, error }` and logs `reference_collision_exhausted` (ids only). The test drives all of these paths with an injected generator.

---

## 4. Migration A — issue_reports: SQL Outline, Pre-check, Checker, Rollback

### 4.1 Files

| File | Purpose |
|---|---|
| `supabase/migrations/20261137_issue_reports.sql` | The migration. Re-confirmed at implementation (2026-11-27): `origin/main` ends at 20261135, and the open branch `fix/no-show-next-session-charge` holds 20261136, so A takes 20261137 |
| `supabase/SQL Scripts/20261137_issue_reports_rollback.sql` | Rollback |
| `scripts/precheck-issue-reports.sql` | Pre-check |
| `scripts/check-issue-reports-migration.sql` | Checker |
| `.gitattributes` | Four `text eol=lf` lines, one per file above (paste-safety rule 3) |

### 4.2 Migration outline

Header comment lines name the requirement and this workplan, the apply order (A, then B in the same sitting, §5.3), the G-10 window, the pre-check, the checker and the rollback. Paste-safe: ASCII only, LF, no psql meta-commands, the word "into" nowhere (comments say "in"), one `BEGIN; … COMMIT;`.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre_guard$ BEGIN
  -- refuse, applying nothing, when: anon or authenticated may CREATE in schema public;
  -- to_regclass('public.issue_reports') IS NOT NULL;
  -- auth.users.id is missing or not uuid; to_regprocedure('auth.uid()') IS NULL
END $pre_guard$;

CREATE TABLE public.issue_reports ( ...15 columns of section 2.1, named CHECK constraints... );
CREATE INDEX issue_reports_user_created ON public.issue_reports (user_id, created_at DESC);

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_reports FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.issue_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.issue_reports TO service_role;
CREATE POLICY issue_reports_owner_select ON public.issue_reports
  AS PERMISSIVE FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DO $post_condition$ BEGIN
  -- raise (rolling everything back) unless: RLS on; exactly one policy, SELECT, roles {authenticated};
  -- anon holds no privilege; authenticated holds SELECT only; service_role holds S/I/U/D;
  -- exactly one FK (user_id -> auth.users, confdeltype 'c'); reference unique; no trigger
END $post_condition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

Named CHECK constraints (the checker lists them by name): `issue_reports_reference_format`, `issue_reports_message_length`, `issue_reports_category_hint_check`, `issue_reports_page_shape`, `issue_reports_area_shape`, `issue_reports_environment_shape`, `issue_reports_status_check`, `issue_reports_closed_reason_check`, `issue_reports_closed_shape`, `issue_reports_context_shape`, `issue_reports_screenshot_path_shape`.

**Timing (supabase-ops §4 test):** additive, and no deployed code reads the table, so the deployed code keeps working, **except** that the live cleanup function starts refusing on G-10 (§5.3). The apply therefore happens after SA's code review and Barak's diff approval, with migration B in the same sitting, and as close to the deploy as possible. Per DEVELOPMENT_LIFECYCLE §7: Staging first when a Staging database exists; Production with the release that carries it. DO / SA confirm which environments exist at apply time.

### 4.3 Pre-check (`scripts/precheck-issue-reports.sql`)

One `WITH … SELECT`, numbered rows `ok` / `FAIL`, run through `begin read only; …; commit;` by the main session or DO (never pasted by Barak).

| # | Row | `ok` when |
|---|---|---|
| P-1 | table absent | `to_regclass('public.issue_reports') IS NULL` |
| P-2 | no policy of that name | no `pg_policies` row named `issue_reports_owner_select` |
| P-3 | `auth.users.id` is uuid | `pg_attribute` lookup |
| P-4 | `auth.uid()` exists | `to_regprocedure('auth.uid()') IS NOT NULL` |
| P-5 | roles exist | `anon`, `authenticated`, `service_role` in `pg_roles` |
| P-6 | browser roles cannot create in `public` | both `has_schema_privilege(…, 'public', 'CREATE')` false |
| P-7 | live cleanup function is the expected predecessor | the 20261134 stamp is live and migration B's stamp is not (the 20261093 pre-check precedent). **RC-2:** P-7 is the only proof that 20261134 is live, per environment. If it reads `FAIL`, stop and escalate to TL; never re-chain onto 20261130 |

Gate rows: 7. Fewer rows returned is a failed check.

### 4.4 Checker (`scripts/check-issue-reports-migration.sql`)

Catalog evidence only, with `to_regclass` / `to_regprocedure` (no raising casts), so it returns `FAIL` rows on the pre-apply state (supabase-ops step 2b). The header states the gate row count.

| # | Row | Evidence |
|---|---|---|
| C-1 | table exists | `to_regclass` |
| C-2 | exact column set | 15 columns; name, type, `attnotnull` for each (§2.1) |
| C-3 | defaults | `id` = `gen_random_uuid()`, `status` = `'submitted'`, both timestamps `now()`; no other column has a default |
| C-4 | RLS on | `pg_class.relrowsecurity = true` |
| C-5 | exactly one policy | `pg_policy` count = 1 for the table |
| C-6 | policy shape | `polcmd = 'r'`, `polpermissive`, `polroles` = `{authenticated}` (read via `polroles`, never the name), `pg_get_expr(polqual)` contains `user_id` and `auth.uid()`, `polwithcheck IS NULL` |
| C-7 | PUBLIC holds nothing | no `aclexplode(relacl)` entry with grantee 0 |
| C-8 | anon holds nothing | `has_table_privilege('anon', …)` false for SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER |
| C-9 | authenticated holds SELECT only | SELECT true; the other six false |
| C-10 | service_role grants | SELECT, INSERT, UPDATE, DELETE true; TRUNCATE false |
| C-11 | the one foreign key | exactly one `contype = 'f'`: `user_id` -> `auth.users(id)`, `confdeltype = 'c'` (so `problem_id` has none) |
| C-12 | reference unique | `contype = 'u'` named `issue_reports_reference_key` on `(reference)` |
| C-13 | the eleven CHECK constraints | each name in §4.2 present, and no other CHECK |
| C-14 | the index | `issue_reports_user_created` on `(user_id, created_at DESC)` |
| C-15 | no trigger | no non-internal `pg_trigger` row |
| I-1 | info, never a gate | row count of the table (0 expected right after the apply) |

Gate rows: 15, plus 1 info row.

### 4.5 Rollback (`supabase/SQL Scripts/20261137_issue_reports_rollback.sql`)

The 20261093 rollback precedent. One transaction that refuses, changing nothing, when:

- the table does not exist;
- the live cleanup function's source still names `issue_reports`, because migration B must be rolled back first; otherwise the restored plan would name a missing table;
- the table holds any row (`LOCK TABLE … IN ACCESS EXCLUSIVE MODE` first, then count), because a row is a real user's report.

Then `DROP TABLE public.issue_reports;` (no `CASCADE`, so an unexpected dependant fails loudly) and `NOTIFY pgrst`. Undo order: B rollback, then A rollback, then the PR revert. DDL-only and additive, so the supabase-ops rollback rule applies: on a checker `FAIL`, Barak pastes the rollback in the same sitting and the checker re-runs.

---

## 5. Migration B — the Regenerated Cleanup Function

### 5.1 Why it is in 1.1

| Without it | Effect |
|---|---|
| G-10 | `issue_reports.user_id -> auth.users` is a link to the login that the live function has not reviewed. **Every** test-account check, delete and anonymise refuses (fail closed): the Danger Zone, admin delete and the account-deletion lifecycle's stage E |
| Anonymise | The login is kept as a tombstone, so `ON DELETE CASCADE` never fires. Reports, with the customer's own message text, would outlive the account deletion: a CR-19 / §4.5 breach |
| CI | `scripts/__tests__/testAccountCleanupSql.test.ts` regenerates the SQL from the descriptors and fails on any difference |

### 5.2 What changes (generated, never hand-edited)

All in `scripts/generate-test-account-cleanup-sql.ts`, then `npx tsx scripts/generate-test-account-cleanup-sql.ts`:

- `FULL_REMOVAL_EXTRAS` gains `{ table: 'issue_reports', reason: 'Problem reports of the account (issue reporting 1.1, CR-19). Kept by a business Reset or Purge, removed in both modes here.' }`. This applies if SA rules the descriptor level `never` (§6.1, recommended). If the level is `reset` or `purge` instead, the table joins step A from the descriptors and this entry is not needed.
- Not in `KEEP_SET`: the message is personal, so it goes in the anonymise too. Not in `FUNCTION_REQUIRED_TABLES`: step B names extras only as VALUES literals and skips a table while it is absent (the SA O-3 / MX1A-3 precedent), so B cannot fail on a missing A. Dev confirms this in the generated text.
- `FUNCTION_MIGRATION` = `20261138_operator_test_account_cleanup_issue_reports`; `PREVIOUS_FUNCTION_MIGRATION` = `20261134_operator_test_account_cleanup_drop_data_exports`. **RC-2:** whether 20261134 is live is decided by the pre-check row P-7 in each environment, not by any generator comment (the comment's "confirmed live 2026-11-25" belongs to the 20261130 stamp).
- `FUNCTION_MIGRATION_PURPOSE` and `ROLLBACK_CONSEQUENCE` rewritten (paste-safe: no semicolons or apostrophes).
- A dated paragraph added to the generator's version history comment.
- Regenerated outputs: `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql`, `supabase/migrations/20261138_operator_test_account_cleanup_issue_reports.sql`, `supabase/SQL Scripts/20261138_operator_test_account_cleanup_issue_reports_rollback.sql`, `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts`.
- **RC-1, migration B checker:** `scripts/check-test-account-cleanup-issue-reports-migration.sql`, on the precedent `scripts/check-test-account-cleanup-export-requests-migration.sql`: the 8-argument function exists and the 6-argument one is gone; `prosecdef`, owner `postgres`, fixed `search_path`; EXECUTE for `service_role` only (no PUBLIC entry); the body holds the new stamp; the 20261134 stamp is gone; the body names `issue_reports` in its plan; the exact-body row. It reads `FAIL` on the pre-apply state. It gets its own `.gitattributes` line and a text test. Ship drill step 6 runs it after B.
- **RC-6, `scripts/__tests__/testAccountCleanupSql.test.ts`:** (i) the `PREVIOUS_FUNCTION_MIGRATION` literal at the end of the audit-actor describe moves from 20261130 to 20261134; (ii) the `describe('20261134: …')` block is frozen as a literal-file, applied-history assertion (its first `it` named `MIGRATION_FILE` / `ROLLBACK_FILE`); (iii) a new `describe('20261138: issue_reports joins step B')` pins: it is the target and chains on 20261134; a new stamp, never the 20261134 one; `issue_reports` in step B of both the hard and the anonymise plans; not in `KEEP_SET` or `FUNCTION_REQUIRED_TABLES`; `issue_reports.user_id` in `tenancyForeignKeys()`; the generated body skips the table while it is absent (the `plan_state.present` path). The stamp literals sit in that block. The `APPLIED` / `APPLIED_TARGET` pins move as its comments direct.
- **RC-4, `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`:** with the target at 20261138, **20261134** becomes `PREVIOUS_MIGRATION_FILE` and stays covered by that constant. The file that drops out is **20261130**: it is named on its own, built from `INITIAL_FUNCTION_MIGRATION` (R-7 forbids the literal function name), in both `SQL_LOGIN_DELETE_ALLOW_LIST` and `SQL_AUTH_WRITE_ALLOW_LIST` (with `ALL_AUTH_WRITE_SHAPES`), with the matching "displaced" assertion block. The `PREVIOUS_MIGRATION_FILE` pin moves from 20261130 to 20261134.
- **RC-5, `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts`:** its L8 allow-list names older generator pairs one by one up to 20261130. Once the target moves, the **20261134** pair (migration + rollback) is named, with the standard reason comment.
- `.gitattributes`: migration B and its rollback are already covered by the `*_operator_test_account_cleanup*` lines; the B checker needs its own line (RC-1).

**RC-9: migration A cannot ship without migration B.** `scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts` replays every migration and fails on an FK to `auth.users` that `tenancyForeignKeys()` does not key, and the drift test fails on any un-regenerated descriptor. So both migrations, and every registration, are in 1.1a.

No inbound foreign key into `issue_reports` exists in 1.1, so `INBOUND_FOREIGN_KEYS` does not change. **Note for 1.3:** `issue_report_outbox.report_id -> issue_reports` will be one and must be reviewed there for G-18. **Note for 3.5a:** the `problem_id` FK is outbound to a global table; the 3.5a plan checks it against the generator then.

### 5.3 Apply order and the refusal window

Same as the 20261093 / 20261094 precedent: **A, then B, in the same sitting**, then the deploy. From A's apply until B is applied, G-10 refuses. From B's apply until the deploy, the app's pinned stamp disagrees, so the Danger Zone check and delete refuse. Both fail closed, and nothing is deleted wrongly. An account-deletion stage E that lands in the window refuses and is retried by its job. To keep the window short, apply right before the merge, with the deploy following. SA rules on whether B should go first (it skips the absent table, which would shorten the G-10 window to zero but lengthen the stamp window) — see SA Q2.

---

## 6. Deletion and Export Registration

### 6.1 Purge descriptor (`lib/business-os/purge/descriptors.ts`)

Recommended row, in the account-level block beside `business_os_account_closures`:

```ts
never('issue_reports', U, ISSUE_REPORTS_EXPORT,
  'Problem reports the account sent us (issue reporting 1.1, CR-19). `never` on purpose: a report is the '
  + "person's support history with the platform, not the business's data, so a business Reset or Purge must "
  + 'not erase an open report. Keyed to auth.users (ON DELETE CASCADE); no inbound foreign key in 1.1, no '
  + 'trigger. Removed by step B of the test-account cleanup in both modes (the hard delete and the anonymise).'),
```

**Why `never` and not `purge`:** the precedents for account-level rows (`business_os_account_closures`, `business_os_export_requests`) are `never` + `USER_OWNED_TABLES` + cleanup step B. Account deletion removes the rows (step B in anonymise, CASCADE in a hard delete). `never` also needs no new `PurgeArea`. `purge` would need a new member of the closed `PurgeArea` union in `purge/types.ts`, `DeletionAreaView` in `app/admin/users/types.ts`, a label in `app/admin/users/deletionCopy.ts`, and the wire-type pin. SA Q1 decides.

Also:
- `lib/business-os/purge/__tests__/classification-baseline.json`: `count` 167 -> 168, `levels.issue_reports = "never"`, and a dated `reviewNotes.issue_reports`.
- `descriptors.invariant.test.ts`: the baseline-count assertion 167 -> 168, with a dated comment line in its running history.

### 6.2 Export classification

Barak's default (CR-19): the report, its context and the customer-facing status are exported. The triage output and decisions are operator data (3.1 / 3.5a, not this table).

**`ISSUE_REPORTS_EXPORT`** (in `descriptors.ts`):

| Kind | Columns |
|---|---|
| `include`, section `issue_reports` | `id`, `reference`, `created_at`, `status`, `category_hint`, `message`, `page`, `area`, `environment`, `context`, `updated_at` |
| `excludedColumns` | `user_id`: `EXPORT_COLUMN_REASON.OWNER_ID` · `screenshot_path`: where the file sits in our storage; files are not exported (BQ-35) · `problem_id`: operator data, a link to the internal problem record (CR-19) · `closed_reason`: operator decision detail; the customer sees only "Closed" (§7) |

`status` goes out as stored (`columnLabels.ts`: cell values are never translated). Each internal value maps one to one to a §7 customer label, so no internal word leaks.

**Files this pulls in, each checked by CI:**

| File | Change | CI rule |
|---|---|---|
| `lib/business-os/data-export/classificationTypes.ts` | `'issue_reports'` added to `ExportSectionId` | type + `exportClassification.test.ts` T-6 |
| `lib/business-os/data-export/sections.ts` | `EXPORT_SECTIONS` gains `accountTableSection('issue_reports')`. Group `account`, AgentPilot the controller: the person's own correspondence with us, not their clients' data | T-6, `sections.test.ts` |
| `lib/business-os/data-export/exportModules.ts` | **Recommended:** a new module `issue_reports` (en "Reported issues", he "דיווחים על תקלות", es "Problemas reportados" — drafts, Barak approves the wording in the diff), `on: false` until M1's flag reaches On, then a one-line switch. Module ids are durable (T-8), so this is an SA item (SA Q4). Alternative: add the section to the existing `account_business` module (no new id, but exported at once and labelled "Account & business details") | `exportModules.test.ts` T-1..T-10 |
| `lib/business-os/data-export/columnLabels.ts` | `RECORD_TYPE_LABELS.issue_reports` + en / he / es labels for each included column not already labelled by key (`reference`, `category_hint`, `message`, `page`, `area`, `environment`, `context`; `status`, `created_at`, `updated_at` may already resolve by key; Dev checks L-6, one meaning per key per module) | `columnLabels.test.ts` L-1..L-9 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | Totals 167 -> 168 and `{ include: 38 }` -> `{ include: 39 }`, `exclude` stays 129, with dated history comments; **RC-3:** "every include without rowKey lists id" `toHaveLength(37)` -> 38, with a dated comment; a new pinned block for `issue_reports` (columns + excludedColumns = the migration's 15 columns exactly, read from the migration text) | — |
| `lib/business-os/data-export/__tests__/exportModules.test.ts` | T-2 13 -> 14 modules, 39 -> 40 sections; T-8 pinned id list gains `issue_reports`; **RC-3:** the stale test name "requestedModulesSchema accepts one module and all 13" is updated | — |

The reader is already descriptor-driven (`BusinessDataExportRepository.listOwnedRowsForExport` resolves the table from the section id), so **no repository change** is needed for the export. After the apply, `npm run schema:reconcile` (read-only) must report no unclassified column.

### 6.3 Ownership registry (`lib/business-os/businessOwnedTables.ts`)

`USER_OWNED_TABLES.issue_reports`: "Problem reports the person sent the platform. Account level, keyed to auth.users: a business Reset or Purge must not erase an open report; the account deletion removes them." The table is not in `BUSINESS_OWNED_TABLES`, and no FK to `business_profiles` is added, so `20260916_business_data_ownership.sql` is unchanged. `businessOwnedTables.test.ts` (it classifies every `user_id` table; direction 2 and direction 3) passes with this entry.

### 6.4 Guards checked and not affected

| Guard | Effect |
|---|---|
| `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts` | Two new 8-digit numbers, unique |
| `rls-disabled-*`, `exposed-views-*`, `secdef-lockdown-*` migration tests | Per-migration; not repo-wide scanners of new tables. Nothing to update |
| `lib/security/__tests__/publicEndpointsAreThrottled.guard.test.ts` | Routes only; 1.1 has none |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` B-2 (table names only in `descriptors.ts` within the purge engine) | The repository lives in `lib/repositories/`, outside the engine scan |
| `exportClassification.test.ts` T-13 (purge engine blind to `export`) | Unchanged |

---

## 7. Repository

> **This section is slice 1.1b.** Nothing here is built in 1.1a.
>
> **RC-8 (tenant-isolation-guard Step 4):** `create` builds the insert object field by field from the parsed allow-list, with `user_id` set from `input.userId`, never through a spread. The test asserts the payload keys exactly.

**File:** `lib/repositories/IssueReportRepository.ts`, per the `new-repository` skill. Class plus singleton `issueReportRepository`, constructor `(supabaseClient?: SupabaseClient)` with default `supabaseServer`, `createLogger({ service: 'IssueReportRepository' })`, `{ data, error }` results that never throw, no `console.*`, server-only (never imported by a `'use client'` file). Exported from `lib/repositories/index.ts`, with the entity types in `lib/repositories/types.ts`, as the skill requires.

**Service role, documented:** there is no INSERT grant for `authenticated`, so the write path must be the service role (SR-2). Reads use the same client, so the 1.3 / 1.4 drains (no user session) can read. Every method filters `.eq('user_id', userId)` (CLAUDE.md rule 4). The header comment says this is intentionally RLS-bypassing and why.

**Methods — only what 1.2 to 1.5 use:**

| Method | Used by | Behaviour |
|---|---|---|
| `create(input: CreateIssueReportInput): Promise<RepositoryResult<IssueReport>>` | 1.2 submit route (or 1.3's write, see SA Q5) | Zod-parses an explicit allow-list: `userId`, `message`, `categoryHint`, `page`, `area`, `environment`. It never takes `id`, `status`, `reference`, `context`, `screenshot_path`, `problem_id` or timestamps from input (tenant-isolation-guard step 3). `user_id` is set from `input.userId`, which 1.2 takes from the session. Generates the reference, inserts, `.select(ISSUE_REPORT_COLUMNS).single()`, and retries per §3. Logs `{ id, userId, reference, duration }` and never the message, page or context (CR-7) |
| `findByIdForUser(id: string, userId: string)`, returning a `RepositoryResult` of `IssueReport` or `null` | 1.3 support email, 1.4 acknowledgement (drain reads scoped to the claimed row's `user_id`, tenant-isolation-guard step 6) | Both ids Zod-checked as uuids before any query (a bad id returns an error, no query). `.eq('id').eq('user_id').maybeSingle()`: not found or another account's id gives `{ data: null, error: null }` |

**Not added:** `listForUser` (first needed by 3.6), status or context updates (M2 / M3), delete (account deletion and the cleanup run in SQL), any `…AllAccounts` admin read (2.4 / 3.3). Each arrives with the slice that calls it.

`ISSUE_REPORT_COLUMNS` is an explicit column list (never `*`) in table order, plus a Zod row schema (the `AccountClosureRepository` precedent), so a PostgREST shape surprise is an error, not a silently wrong object.

---

## 8. Tests

All tests are Jest unit tests or text tests. **None reaches the network:** the repository test injects a mocked `SupabaseClient` through the constructor and `jest.mock('@/lib/supabaseServer', …)` neutralises the default singleton import; the migration and registry tests read files. `tests/jest-no-network.ts` would refuse anything else.

| Test file | Covers |
|---|---|
| `lib/repositories/__tests__/IssueReportRepository.test.ts` (new, **1.1b**) | `create`: success (returns row; insert payload has exactly the allow-listed fields + generated reference); injected `user_id` / `id` / `status` / `reference` in input are dropped (tenant-isolation step 7); one `23505` on `issue_reports_reference_key` then success (2 attempts, two different references); three collisions -> error, no throw; `23505` on another constraint -> not retried; other DB error -> `{ data: null, error }`; invalid input (empty message, bad category) -> error and **no** DB call; log calls carry no message / page text. `findByIdForUser`: found; not found -> `{ null, null }`; both `.eq('id')` and `.eq('user_id')` applied; non-uuid id -> error and no query; DB error -> error |
| `lib/business-os/issue-reports/__tests__/issueReportModel.test.ts` (new) | **1.1a:** the alphabet is 32 characters with no I / L / O / U; the pattern accepts a well-formed reference and rejects lower-case, 7 / 9 characters, a forbidden letter and a missing prefix. Constants: the status list equals §7 in order; the category hints equal §5.1; the closed reasons equal §7. **1.1b adds:** the generator gives `R-` + 8 characters, every character in the alphabet; deterministic with an injected byte source (bytes 0, 31, 32, 255 map as expected); the default source is Web Crypto (RC-7) |
| `supabase/migrations/__tests__/issue-reports.migration.test.ts` (new) | Text of migration A: status / category / closed-reason CHECKs equal the TS constants; reference CHECK equals `ISSUE_REPORT_REFERENCE_PATTERN`; `user_id` NOT NULL, `REFERENCES auth.users (id) ON DELETE CASCADE`, the only `REFERENCES`; `problem_id` has no FK; `ENABLE ROW LEVEL SECURITY`; revoke from `PUBLIC, anon, authenticated, service_role`, then exactly the §2.4 grants; one policy `FOR SELECT TO authenticated` with the `auth.uid()` predicate and no INSERT / UPDATE / DELETE policy; no `CREATE TRIGGER`, no `SECURITY DEFINER`. Paste safety: ASCII, LF, one `BEGIN` / `COMMIT`, no "into", no meta-commands. Rollback: refuses on missing table, on the cleanup function still naming the table, and on rows; plain `DROP TABLE` without `CASCADE`. Checker: 15 gate rows + 1 info row, row C-13 names every CHECK of the migration; pre-check: 7 rows. **SA optimisation:** the export descriptor's `columns` + `excludedColumns` equal the 15 migration columns exactly. **RC-1:** the migration B checker's rows (text) |
| Existing, updated (count pins, §6) | `descriptors.invariant.test.ts`, `exportClassification.test.ts`, `exportModules.test.ts`, `columnLabels.test.ts` (no edit expected beyond passing), `sections.test.ts` (if it pins the registry), `businessOwnedTables.test.ts` (no edit expected), `testAccountCleanupSql.test.ts` (RC-6), `no-deletion-paths.guard.test.ts` (RC-4), `business-os-credit-lots.migration.test.ts` (RC-5) |
| Existing, run unchanged | `business-os-data-exports-drop.migration.test.ts` (reads 20261134 by name; passing confirms the RC-6 freeze), `testAccountCleanupInboundFk.guard.test.ts` (RC-9) |

**Behavioural RLS proof:** a `SET ROLE` test cannot run through the read-only SQL path (checker-pattern.md). The catalog checker rows C-4 to C-10 are the strongest evidence the main session can produce; no new integration harness is introduced (that would be a new pattern).

**Commands before handover:** `npm test -- lib/repositories/__tests__/IssueReportRepository.test.ts lib/business-os/issue-reports supabase/migrations/__tests__ lib/business-os/purge lib/business-os/data-export lib/business-os/__tests__/businessOwnedTables.test.ts scripts/__tests__/testAccountCleanupSql.test.ts`, then the full `npm test`. Per the full-gate memory, failures are compared against a clean-main baseline (from `git archive origin/main` into scratch), deduplicated, and not read as totals.

---

## 9. Files to Create / Modify

### 9.1 Slice 1.1a — storage (this branch)

| File | Action | Reason |
|---|---|---|
| `lib/business-os/issue-reports/issueReportModel.ts` | create | Constants only: statuses, category hints, closed reasons, reference alphabet and pattern |
| `lib/business-os/issue-reports/__tests__/issueReportModel.test.ts` | create | Constant tests (1.1b extends it) |
| `supabase/migrations/20261137_issue_reports.sql` | create | Migration A |
| `supabase/SQL Scripts/20261137_issue_reports_rollback.sql` | create | Rollback A |
| `scripts/precheck-issue-reports.sql` | create | Pre-check A |
| `scripts/check-issue-reports-migration.sql` | create | Checker A |
| `supabase/migrations/__tests__/issue-reports.migration.test.ts` | create | Text test A, plus the B checker text (RC-1) |
| `.gitattributes` | modify | 4 LF lines for A's files, 1 for the B checker (RC-1) |
| `scripts/generate-test-account-cleanup-sql.ts` | modify | Step B extra, migration constants, history comment |
| `supabase/migrations/20261138_operator_test_account_cleanup_issue_reports.sql` | create (generated) | Migration B |
| `supabase/SQL Scripts/20261138_operator_test_account_cleanup_issue_reports_rollback.sql` | create (generated) | Rollback B |
| `scripts/check-test-account-cleanup-issue-reports-migration.sql` | create | Checker B (RC-1) |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | modify (generated) | Operator SQL follows the plan |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | modify (generated) | New stamp |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | RC-6 (i) to (iii) |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify | RC-4: 20261130 named on its own; `PREVIOUS_MIGRATION_FILE` pin 20261134 |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | modify | RC-5: the 20261134 pair joins the L8 allow-list |
| `lib/business-os/purge/descriptors.ts` | modify | Descriptor + `ISSUE_REPORTS_EXPORT` |
| `lib/business-os/purge/__tests__/classification-baseline.json` | modify | 168, level, review note |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | modify | Count 168 |
| `lib/business-os/businessOwnedTables.ts` | modify | `USER_OWNED_TABLES` entry |
| `lib/business-os/data-export/classificationTypes.ts` | modify | Section id |
| `lib/business-os/data-export/sections.ts` | modify | Registry entry |
| `lib/business-os/data-export/exportModules.ts` | modify | Module (SA Q4) |
| `lib/business-os/data-export/columnLabels.ts` | modify | Record type + column labels |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify | Totals, the include-lists-id pin 37 -> 38 (RC-3), pinned block |
| `lib/business-os/data-export/__tests__/exportModules.test.ts` | modify | 14 / 40, pinned ids, stale "all 13" test name (RC-3) |
| `docs/requirements/BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md` | carried (untracked copy) | The feature branch carries it so the PR can link to it. The slice-stage record and the SA wording fixes are BA / TL's, not Dev's |
| `docs/workplans/BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md` | carried + modify | Task ticks, SA / QA / RM sections |

### 9.2 Slice 1.1b — repository (later, its own branch)

| File | Action | Reason |
|---|---|---|
| `lib/business-os/issue-reports/issueReportModel.ts` | modify | Add `generateIssueReportReference` (Web Crypto, RC-7) |
| `lib/business-os/issue-reports/__tests__/issueReportModel.test.ts` | modify | Generator tests |
| `lib/repositories/IssueReportRepository.ts` | create | Repository (RC-8) |
| `lib/repositories/__tests__/IssueReportRepository.test.ts` | create | Unit tests |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | Types and export (new-repository skill steps 2 and 4) |

No migration, no registry change and no apply in 1.1b.

**Estimated size (whole of 1.1, before the split):** about 30 files. About 10 of them are new hand-written files (two migrations' companions, the model, the repository, three tests); about 5 are generated; the rest are one- to ten-line registry and pin edits. Roughly 900 to 1,300 lines added, of which about 40% is generated operator SQL. **Two to three working days**, inside the "few days" slice budget, with the cleanup regeneration and the export labels as the slow parts.

---

## 10. Out of Scope

| Item | Where it lands |
|---|---|
| Submit route, Zod body schema, 10-character minimum, area route map, environment resolver, rate limit, 429 body | 1.2 |
| `issue_report.*` audit events (`lib/audit/events.ts`, `eventAudience.ts`) | 1.2 |
| **Flag reader `isIssueReportingEnabled`** | **Recommended for 1.2, not 1.1.** Nothing in 1.1 is reachable: the repository has no caller, so there is nothing to gate, and an unused reader is dead code the lint and the flag docs would carry for a slice. 1.2 adds it with the route that checks it (and `docs/feature_flags.md`); 1.5 reads it for the button |
| Outbox table, claim RPC, cron, Jobs & queues entry, emails, `replyTo`, idempotency keys | 1.3 / 1.4 |
| Form, header button, lazy dialog | 1.5 |
| `context` content and its Zod shape, screenshot bucket and its descriptor, retention purge | M2 (2.1–2.5) |
| `issue_problems`, the `problem_id` FK, the triage table, "My reports" list method | 3.1 / 3.5a / 3.6 |

---

## 11. Branch, Worktree and Ship Drill

**Branch:** `feature/bos-issue-reporting-1-1a` for 1.1a (created 2026-11-27 off a freshly fetched `origin/main`, in a sibling worktree whose `node_modules` is a junction to the shared folder); 1.1b gets its own branch. The original text, kept for the record: RM creates `feature/bos-issue-reporting-1-1` from an up-to-date `origin/main` (fetch first, then compare the local `main` with `origin/main`: a stale local `main` has produced false findings before). Dev confirms with `git branch --show-current` before the first edit and escalates to TL if the branch is wrong or missing. This checkout's branch (`fix/plugin-oauth-callback-session-identity`) holds unrelated uncommitted work and is not touched. Never `git stash`.

**Worktree (recommended):** a separate worktree for the branch, so the uncommitted OAuth work stays undisturbed. Per `claude-harness-ops` §6:
- The main session creates it with the user. The user names the shared `node_modules` folder, and the main session links it as a **junction** (`New-Item -ItemType Junction …` in PowerShell), then checks that `LinkType` is `Junction` and that `next/package.json` resolves.
- Never `npm install` through the junction (it rewrites the shared folder for every tree). If the shared dependencies are behind `main`, fix that with the user.
- Removal later: delete the junction link first and verify the shared folder is intact, then `git worktree remove` **without** `--force`.
- No worktree path or folder name is written in tracked text.

**Ship drill (later, after SA approves this plan and the code):**

| # | Step | Gate |
|---|---|---|
| 1 | `npm run build`, plus `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, written to a file and filtered to the touched files; the tool's own exit code is checked (an OOM prints no diagnostics) | Clean for touched files |
| 2 | Targeted tests, then the full `npm test` against a clean-main baseline | Happy + failure paths green; no new failures |
| 3 | SA code review; QA (repository paths + migration text + checker review) | ✅ both |
| 4 | **Barak sees the diff before any commit**, even a local one | Barak's explicit approval |
| 5 | RM commits (Conventional Commits, e.g. `feat(bos): issue_reports storage (issue reporting 1.1)`), pushes, opens the PR. Barak sees and OKs the PR open; **no auto-merge** | Required checks green; branch up to date with `main` (strict mode) |
| 6 | Apply: main session / DO runs the pre-check, proves the checker FAILs, and asks Barak to paste A then B. Checker after each, advisors before and after, change record per `env-change-protocol` | Checker 15/15 ok + 1 info; cleanup checks pass with the new stamp after deploy |
| 7 | Merge, with Barak's OK on the merge itself. Deploy; then `npm run schema:reconcile` and one Danger Zone **check** (read-only mode) to prove the new stamp is live | Reconcile clean; check passes |

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | The refusal window between applies and deploy (§5.3) blocks a real account-deletion stage E or an admin delete | Fails closed (nothing wrongly deleted); its job retries; apply A + B in one sitting right before the merge; SA Q2 |
| K-2 | Another stream also changes the cleanup plan and takes 20261138 | Generator rule: the second to land rebases, takes the next number, re-chains `PREVIOUS_FUNCTION_MIGRATION`; P-7 refuses a wrong predecessor |
| K-3 | Migration number collision with another stream | Re-confirm against `origin/main` + the coordination record at implementation; the number guard fails CI on a duplicate |
| K-4 | An export label or module name in Hebrew / Spanish reads wrong | Drafts flagged in the diff for Barak; the module ships `on: false` |
| K-5 | Count pins edited without understanding (a wrong 168 hides a real drift) | Each pin edit carries a dated comment naming this table; the baseline also carries the level and a review note |
| K-6 | `crypto` import makes the model module unusable in the 1.5 client bundle | **Removed by RC-7:** the generator uses Web Crypto, so no Node module is imported (§3) |
| K-7 | A future slice writes `screenshot_path` in a layout the CHECK refuses | The CHECK encodes OQ-S2's ruled layout; 2.4's plan must use it or change it with SA |

---

## 13. Open Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| SA Q1 | Descriptor level: `never` (account-level, cleanup step B, no new `PurgeArea`) or `purge` (a business Purge also removes reports; needs a new `PurgeArea` + admin delete label + wire pin)? | `never`, per the `business_os_account_closures` / `business_os_export_requests` precedent |
| SA Q2 | Apply order A then B (precedent; G-10 window) or B then A (B skips the absent table; zero G-10 window, same stamp window)? | A then B in one sitting, as 20261093 / 20261094; or B first if SA confirms the step B skip holds in the generated text |
| SA Q3 | `service_role` grants: S / I / U / D now (no grant migration later) or S / I only until M2? | S / I / U / D now, matching 20261093 |
| SA Q4 | Export placement: a new durable module `issue_reports` (`on: false` until M1 is On) or the section in `account_business` (on immediately)? And group `account` / controller for the section? | New module, off until M1 On; group `account`, AgentPilot the controller |
| SA Q5 | Requirement 1.2 says "stores the report **and its support-email outbox row in one step**", but the outbox table arrives in 1.3. Is 1.1's `create` (report only) the right shape, with 1.3 replacing it by an atomic report-plus-outbox write (an RPC taking the TS-generated reference)? Or should 1.2 and 1.3 be re-ordered? A BA wording fix may be owed | Keep `create` report-only in 1.1; 1.3 owns the atomic write. BA aligns the 1.2 wording |
| SA Q6 | `environment` value set: a shape CHECK only (value set owned by 1.2), or a DB enum? The existing `environmentLabelOf` yields `production` / `preview` / `vercel-development` / `local` / `unknown`, and the requirement says `production` / `staging` | Shape CHECK in 1.1; 1.2's plan rules on the value set and whether Staging is distinguished |
| SA Q7 | `closed_reason`: a closed enum (`duplicate` / `spam` / `no_response`) or free text? Exported or not? | Closed enum (no free teammate text on a customer row); excluded from the export as operator detail |
| SA Q8 | Should the `authenticated` grant be column-level (omitting `problem_id`, `screenshot_path`, `closed_reason`), since no browser code reads the table today? | Table-level SELECT, as CR-5 states. All reads go through the server repository; 3.6 revisits |

---

## 14. Task List

### 14.1 Slice 1.1a — storage

- [x] Step 0: Branch `feature/bos-issue-reporting-1-1a` off a freshly fetched `origin/main` (`05732d73`), sibling worktree + junction to the shared `node_modules`; requirement and this workplan copied in; branch confirmed ✅
- [x] Step 1: Migration numbers re-checked: `origin/main` ends at 20261135, open branch `fix/no-show-next-session-charge` holds 20261136, so A = **20261137**, B = **20261138**. No open branch touches the generator. The generator's `FUNCTION_MIGRATION` was 20261134 ✅
- [x] Step 2: `issueReportModel.ts` (constants only, plus the three DB backstop bounds) + its unit test ✅
- [x] Step 3: Migration A, rollback, pre-check (7 rows), checker (15 gate rows + 1 info row), `.gitattributes`, text test ✅
- [x] Step 4: Descriptor + `ISSUE_REPORTS_EXPORT`, baseline JSON (168), invariant count, `USER_OWNED_TABLES` ✅
- [x] Step 5: Export section id, registry (last, `account` / controller), module `issue_reports` (`on: false`), labels; pin updates incl. RC-3; pinned block checks columns + excludedColumns = the 15 migration columns ✅
- [x] Step 6: Generator change, regenerated with `npx tsx scripts/generate-test-account-cleanup-sql.ts` (stamp 9a097ff36229f6b5 -> **e3796cce5c2b37a7**), RC-6 (i) to (iii), RC-4, RC-5 ✅
- [x] Step 7: Migration B checker (RC-1, 9 rows, md5 `44f20892f1719dcf76ab51179eebc655`) + `.gitattributes` line + text tests ✅
- [x] Step 8: Targeted tests green (see 14.3); filtered typecheck; build (see 14.3) ✅
- [x] Step 9: Hand to SA for code review (Code Complete). No commit, push or apply before Barak sees the diff ✅
- [x] Step 10: Merged to `main` in PR #700 (merge `25eec10c`); migrations 20261137 and 20261138 applied to the live database. Checker B read 8 / 9: row 9 differed only by the CRLF of the editor paste, and the md5 without CR equals the committed body ✅

### 14.3 Implementation notes (1.1a, Dev, 2026-11-27)

**Files beyond §9.1, each a pin the change moved (no design change):**

| File | Why |
|---|---|
| `lib/business-os/data-export/__tests__/sections.test.ts` | Pins the registry order and the account group; `issue_reports` appended (`IR_IDS`) |
| `lib/business-os/data-export/__tests__/joinedCsv.test.ts` | `EXPECTED: Record<ExportModuleId, …>` needs the new module (`issue_reports: []`, no declared reference) |
| `lib/business-os/purge/__tests__/SchemaReconciler.test.ts` | Pins the sorted list of include tables; + `issue_reports` |
| `exportClassification.test.ts` T-6 | The registry id list (in a file already on the list) |

**Small additions inside planned files:** the model also exports `ISSUE_REPORT_INITIAL_STATUS`, `ISSUE_REPORT_REFERENCE_PREFIX`, `ISSUE_REPORT_REFERENCE_LENGTH` and the three backstop bounds (message 5000, page 512, context 32768 bytes); the text test pins the CHECKs to them. The checker's info row counts rows through `query_to_xml` under a `CASE` on `to_regclass`, so it cannot raise on the pre-apply state.

**Registry position:** `issue_reports` is the last section of `EXPORT_SECTIONS` (after `images`), so every earlier order pin only grew by one entry. It is read only by its own module, which is off.

**Drafts for Barak (K-4):** module name en "Reported issues", he "דיווחים על תקלות", es "Problemas reportados"; record type "Reported issue"; column labels for `reference`, `category_hint`, `message`, `page`, `area`, `environment`, `context`.

**SA code review finding 1 (fixed by Dev, 2026-11-27):** checker A rows 8 to 10 now prove on their own what the 20261137 post-condition asserts: row 8 adds anon column-level INSERT / UPDATE / REFERENCES, row 9 adds authenticated column-level REFERENCES, row 10 adds service_role REFERENCES and TRIGGER. Each row still reads FAIL before the apply, and the text test pins every clause with negative controls.

**Not done here (by design):** no commit, push or migration apply; 1.1b untouched; requirement wording fixes (BA).

### 14.2 Slice 1.1b — repository (in progress)

- [x] Step 0: Branch `feature/bos-issue-reporting-1-1b` off a freshly fetched `origin/main` (`25eec10c`), sibling worktree, upstream removed, `node_modules` a junction to the shared folder; workplan and requirement status updated ✅
- [x] Step 1: `generateIssueReportReference` in `issueReportModel.ts` (Web Crypto, RC-7) + tests ✅
- [x] Step 2: `IssueReportRepository` (RC-8) + types + index + unit test ✅
- [ ] Step 3: Targeted tests, filtered typecheck; hand to SA (tests and typecheck done, see 14.4; SA hand-over is TL's)

### 14.4 Implementation notes (1.1b, Dev, 2026-11-28)

**Files:**

| File | Action |
|---|---|
| `lib/business-os/issue-reports/issueReportModel.ts` | modify: `IssueReportRandomBytes`, `defaultIssueReportRandomBytes` (Web Crypto), `generateIssueReportReference`. Still no import |
| `lib/business-os/issue-reports/__tests__/issueReportModel.test.ts` | modify: 6 generator tests |
| `lib/repositories/IssueReportRepository.ts` | create |
| `lib/repositories/__tests__/IssueReportRepository.test.ts` | create: 31 tests |
| `lib/repositories/types.ts` | modify: `IssueReport`, `CreateIssueReportInput` (a type-only import of the model's three union types) |
| `lib/repositories/index.ts` | modify: class, singleton, `ISSUE_REPORT_COLUMNS`, `ISSUE_REPORT_ERROR` and the two types |

**How §3 and §7 were built:**
- Generator: 8 bytes from the source, each `byte & 31` into the alphabet, `R-` prefix. It throws if the source returns fewer than 8 bytes; the repository turns that throw into `{ data: null, error }` before any database call.
- `create`: Zod allow-list `userId`, `message`, `categoryHint`, `page`, `area`, `environment`. The bounds mirror the 20261137 CHECKs (message and page length counted in code points, as `char_length` counts; page starts with `/`, no `?` or `#`; the area and environment shape regexes). The insert is built field by field in the order `user_id, reference, message, category_hint, page, area, environment` (RC-8), and the test pins the keys exactly. `.select(ISSUE_REPORT_COLUMNS).single()`, then the Zod row schema. Report-only, no outbox and no RPC (SA Q5).
- Collision: retried only on SQLSTATE `23505` whose message (or details) names `issue_reports_reference_key`, up to 3 attempts in total, each with a fresh reference. A third collision returns the database error (code `23505`) and logs `reference_collision_exhausted`. Any other `23505` or other error returns after one attempt.
- `findByIdForUser`: both ids checked as uuids first, then `.eq('id').eq('user_id').maybeSingle()`. A missing row or another account's id gives `{ data: null, error: null }`.
- Logs: ids, reference, attempt, error code and duration only. The test serialises every log call and checks the message and page text are absent.

**Small additions inside the plan (no design change):**
- The constructor takes a second optional argument, `generateReference`, so the tests can drive the collision paths (§3 "with an injected generator"). It defaults to the Web Crypto generator. §7 named only the client argument.
- Exported constants `ISSUE_REPORT_COLUMNS` (§7 names it), `ISSUE_REPORT_REFERENCE_CONSTRAINT`, `ISSUE_REPORT_CREATE_MAX_ATTEMPTS`, `ISSUE_REPORT_ERROR` (`invalid_input`), and the row schema `issueReportRowSchema`.
- A test pins that the class has exactly the two methods, and one that the model file has no `import` or `require` (RC-7 client safety).

**Checks run (2026-11-28, in the 1.1b worktree):**

| Check | Result |
|---|---|
| `IssueReportRepository.test.ts` + `lib/business-os/issue-reports` | 2 / 2 suites, 52 / 52 tests (31 repository, 21 model, 6 of them new) |
| The same plus `issue-reports.migration.test.ts` | 3 / 3 suites, 82 / 82 tests |
| Neighbouring guards: every `lib/repositories/__tests__/*guard*`, `businessOwnedTables`, `noPilotCreditTableReads`, `chargeSources`, `clientPaymentsUsd.source`, Tailwind escape | 16 / 16 suites, 487 / 487 tests |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, output to a file | Exit 2 with diagnostics, no OOM trace; the semantic pass ran (TS2339, TS2322 and others present). **0 errors in the six touched TS files**; the rest are pre-existing elsewhere |
| ESLint on the six touched TS files | 0 errors, 1 warning: `types.ts:830` `no-explicit-any`, a pre-existing line this diff does not touch |

**Not done (by design):** no route, UI, email, migration, outbox or database access; no commit or push.

---

## SA Review Notes

**Reviewed by SA — 2026-11-27** (workplan review, against `origin/main` at `ec66b04e`; the plan was written at `1f24faeb`, and the one merge between them, #693, touches neither the cleanup generator nor the purge, export or migration files this plan edits)
**Status:** ✅ Approved with changes. Required changes RC-1 to RC-9 below are made in this plan before Step 1. None of them changes the design. They correct three file facts and add the missing B checker, so SA does not need to re-review the plan. SA checks them at code review.

### Dev's three scope-growth claims, verified

| Claim | Verdict | Evidence on `origin/main` |
|---|---|---|
| (a) G-10 forces a regenerated cleanup migration in 1.1, and anonymise keeps the login, so CASCADE never fires | ✅ **Confirmed, and CI enforces it too.** It must ship with the table, so it cannot move to a later slice | `scripts/generate-test-account-cleanup-sql.ts`: G-10 blocks any `fk_catalog` row (every FK to `auth.users` outside `auth`) with no `fk_review` entry. `fk_review` is built from `tenancyForeignKeys()`, which is the plan's key columns plus `MUST_BE_EMPTY`. Step A comes from `descriptorsForRun('purge', …)`, so a `never` row only reaches the plan through `FULL_REMOVAL_EXTRAS` (step B). The anonymise modes close the login in place (`KEEP_SET`, "closes and anonymises a login in place"). Statically, `scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts` replays every migration and fails the PR on any FK to `auth.users` that is not keyed in `tenancyForeignKeys()`. So a table without the generator change is red in CI, not only refused on prod |
| (b) Export inclusion touches about 6 files, all CI-checked | ✅ **Confirmed.** The six files are right. One more pin is in a file already on the list (RC-3) | `classificationTypes.ts`, `sections.ts` (`accountTableSection` gives group `account`, `controller`), `exportModules.ts`, `columnLabels.ts`, plus `exportClassification.test.ts` and `exportModules.test.ts`. `never` + `include` has precedent (`notification_settings`, `profiles`) |
| (c) The count pins and their numbers | ⚠️ **Mostly right, three misses** | Right: `PURGE_DESCRIPTORS` 167 (`exportClassification.test.ts` at two places), `{ include: 38, planned: 0, exclude: 129 }`, baseline `count` 167 (`descriptors.invariant.test.ts`), `EXPORT_MODULES` 13 and sections 39 (`exportModules.test.ts` T-2), the T-8 id list. **Missed:** `exportClassification.test.ts` "every include without rowKey lists id", `toHaveLength(37)` becomes 38 (RC-3). **Wrong number:** in `no-deletion-paths.guard.test.ts` the displaced file is 20261130, not 20261134 (RC-4). **Missed file:** the L8 allow-list in `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` (RC-5). The cleanup test needs more than pin moves (RC-6) |

### Rulings on SA Q1 to Q8

| # | Ruling | Reason |
|---|---|---|
| Q1 | **`never`**, `USER_OWNED_TABLES`, step B in both modes | Same as `business_os_account_closures` and `business_os_export_requests`. A business Reset or Purge must not erase the person's support history. The account deletion removes it through step B, and CASCADE covers a hard delete. No new `PurgeArea` is needed |
| Q2 | **A then B**, two pastes back to back in one sitting, with the checker after each. Apply only once the PR is green and up to date with `main`, then merge and deploy straight away | This is the proven 20261093/94 and 20261095/96 order. The G-10 window is the time between two pastes, and it fails closed. B first would cut that to zero, but it puts the order on the skip-while-absent property alone and needs a reworked P-7. That is not worth it for a window of seconds. The longer window is the stamp mismatch until the deploy, and the order does not change it. Strict up-to-date mode (no merge queue) can delay the merge, so do not paste before the branch is current |
| Q3 | **S / I / U / D for `service_role` now** | Repo convention (20261074, 20261080, 20261093, 20261095 all `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then re-grant S/I/U/D). This saves a grant migration in M2/M3 and opens no client path |
| Q4 | **New durable module `issue_reports`, `on: false`, group `account`, AgentPilot as controller.** The switch to `on: true` becomes a named acceptance criterion of the slice that first lets a customer outside Dark submit (BA adds it to 1.5, see the wording fixes) | Eight of the 13 modules are already off, so off is an established state, and the on-set pin catches a switch flipped by accident. Putting the section in `account_business` would label a support history as "Account & business details", and that module is on today, so the drawer would offer a section for a feature the owner cannot see. Without a named criterion the switch is easy to forget. Pilot customers' reports would then be stored but not exportable |
| Q5 | **Keep `create` report-only in 1.1.** 1.3 owns the atomic report-plus-outbox write, as one transaction through a locked-down RPC (SR-4 shape) that takes the TS-generated reference and keeps the 23505 retry on `issue_reports_reference_key` in the repository around the RPC call. No reordering | An outbox before its producer cannot be verified (the SA requirement review merged 1.3 + 1.4 for exactly this reason). M1 is Dark until 1.5, so a 1.2 build that stores without emailing reaches no customer. BA fixes the 1.2 and 1.3 wording (below) |
| Q6 | **Shape CHECK only in 1.1. The value set is ruled in the 1.2 workplan.** The 1.2 plan must say how Staging is told apart, because `environmentLabelOf` (`lib/admin/environment/classifyEnvironment.ts`) cannot produce `staging`: it reads only `VERCEL_ENV`, which yields `preview` for a Preview deployment. A DB enum now would freeze a set nobody has ruled on | The requirement's `production` / `staging` and the helper's five labels disagree, and the Staging environment is still being built (PROD stream). The shape CHECK `^[a-z][a-z-]{1,31}$` admits every candidate. BA fixes §4.1 (below) |
| Q7 | **Closed enum `duplicate` / `spam` / `no_response`, excluded from the export** | §7 lists exactly these. A closed set keeps teammate free text off a customer row. The reason is a reviewer decision, which CR-19 classifies as operator data. Accepted side effect: the owner can read their own `closed_reason` through the table-level SELECT (Q8). No UI shows it. 3.6 revisits it when "My reports" exists |
| Q8 | **Table-level `SELECT` for `authenticated`**, as CR-5 states | No browser code reads the table. A column-level grant breaks `select('*')` and adds a pattern this table does not need. The three columns hold nothing about another account: `problem_id` is an opaque uuid, `screenshot_path` is the user's own folder (the CHECK pins it), and `closed_reason` is covered under Q7. 3.6 revisits it |

### Required changes

1. **RC-1 — Migration B checker (missing).** Add `scripts/check-test-account-cleanup-issue-reports-migration.sql`, with its `.gitattributes` line and a text test. It follows the precedent `scripts/check-test-account-cleanup-export-requests-migration.sql`: the 8-argument function exists and the 6-argument one is gone; `prosecdef`, owner `postgres`, fixed `search_path`; EXECUTE for `service_role` only (no PUBLIC entry); the body holds the new stamp; the 20261134 stamp is gone; the body names `issue_reports` in its plan; and the exact-body row. It must read FAIL on the pre-apply state. Ship drill step 6 runs it after B. Without it, §11's "checker after each" has nothing to run for B.
2. **RC-2 — P-7 is the proof that 20261134 is live, not the generator comment.** The comment's "confirmed live (MX-7 LC-8, 2026-11-25)" belongs to the 20261130 stamp (`5c369aaf2fa78abf`), not to the 20261134 one (`9a097ff36229f6b5`). Drop the "confirmed live 2026-11-25" wording in §5.2. P-7 decides, per environment. If it reads FAIL, stop and escalate to TL. Never re-chain onto 20261130.
3. **RC-3 — Missed pin.** `lib/business-os/data-export/__tests__/exportClassification.test.ts`, "every include without rowKey lists id": `toHaveLength(37)` becomes 38, with a dated comment. Also update the stale test name "requestedModulesSchema accepts one module and all 13" in `exportModules.test.ts`. It is a label, not an assertion.
4. **RC-4 — Wrong file in §5.2.** In `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`, moving the target to 20261137 makes **20261134** the `PREVIOUS_MIGRATION_FILE`, so the constant still covers it. The file that drops out is **20261130**. It must be named on its own, built from `INITIAL_FUNCTION_MIGRATION` (R-7), in **both** `SQL_LOGIN_DELETE_ALLOW_LIST` and `SQL_AUTH_WRITE_ALLOW_LIST` (with `ALL_AUTH_WRITE_SHAPES`). Add the matching "displaced" assertion block, and change the `PREVIOUS_MIGRATION_FILE` pin from 20261130 to 20261134. Fix §5.2 and §9.
5. **RC-5 — Missed file.** Add `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` to §9. Its L8 allow-list covers the generator target through `MIGRATION_FILE` / `ROLLBACK_FILE` and names older pairs one by one up to 20261130. Once the target moves, the **20261134** pair (migration + rollback) must be named, with the standard reason comment, or L8 goes red (commit `694fab8e` fixed exactly this omission).
6. **RC-6 — `scripts/__tests__/testAccountCleanupSql.test.ts` needs more than pin moves.** Three changes. (i) Change the `PREVIOUS_FUNCTION_MIGRATION` literal at the end of the audit-actor describe from 20261130 to 20261134. (ii) Freeze the `describe('20261134: …')` block: its first `it` asserts `MIGRATION_FILE` / `ROLLBACK_FILE` are the 20261134 files, so it becomes a literal-file, applied-history assertion. (iii) Add a new `describe('20261137: issue_reports joins step B')` that pins: it is the target and chains on 20261134; it has a new stamp, never the 20261134 one; `issue_reports` sits in step B of both the hard and the anonymise plans; it is not in `KEEP_SET` or `FUNCTION_REQUIRED_TABLES`; `issue_reports.user_id` is in `tenancyForeignKeys()`; and the generated body skips the table while it is absent (the text of the `plan_state.present` path). Put the stamp literals in that block, as the 20261134 block does.
7. **RC-7 — Reference generator without Node `crypto`.** Use Web Crypto (`globalThis.crypto.getRandomValues(new Uint8Array(8))`), which Node 18+ and every browser provide, with the byte source injectable for tests. This removes K-6 and the possible server-only sibling file. The model module stays pure and client-safe for 1.5.
8. **RC-8 — Insert payload order (tenant-isolation-guard Step 4).** `create` builds the insert object field by field from the parsed allow-list, with `user_id` set from `input.userId` and never through a spread. The test asserts the payload keys exactly (§8 already plans this; keep it).
9. **RC-9 — Record the split (below) in §9 / §14** if Barak takes it. Either way, note in §5.2 that migration A cannot ship without migration B: the inbound-FK guard and the drift test make it red.

### Migration plan check

| Item | Finding |
|---|---|
| Numbering | ✅ The latest on `origin/main` is 20261135. No remote branch carries 20261136 or above, and no open branch has touched the cleanup generator. Step 1 re-checks this at implementation |
| Grants | ✅ Revoking from `service_role` and re-granting is the repo convention (four precedents, Q3). C-7 to C-10 read privileges through `has_table_privilege` and `aclexplode`, never through names |
| Policy | ✅ A single `FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))` matches the owner-select precedents. C-6 reads `polroles`, not the name, and checks `polwithcheck IS NULL` |
| FK delete rule | ✅ `ON DELETE CASCADE` to `auth.users` (CR-19). C-11 proves it is the only FK, so `problem_id` has none |
| CHECKs | ✅ All eleven are sound. The `screenshot_path` arithmetic is right (36 + 1 + 36 + 1 = 74). The closed-shape equivalence is right. Keep `message` at a 1 to 5000 backstop with the 10-character minimum in Zod |
| Index | ✅ `(user_id, created_at DESC)` is enough for 1.1 to 3.6. Nothing else until something measures a need |
| Pre-check / checker can fail | ✅ For A: P-1 and P-7 fail on a wrong state, and C-1 to C-15 read FAIL before the apply because they use `to_regclass` with no raising casts. For B it was missing until RC-1 |
| Rollback | ✅ It refuses when the table is missing, when the cleanup function still names the table, and when any row exists (after an ACCESS EXCLUSIVE lock). The drop has no CASCADE. The undo order is B, then A, then the revert |
| Repository | ✅ It follows the `new-repository` final checklist (injectable client, `{ data, error }`, `user_id` on every query, logger, singleton, types + index, tests). There is no delete method, so the skill's soft-delete default does not apply (deletion runs in SQL). Service-role use is documented in the header. `findByIdForUser` scoped by both ids satisfies tenant-isolation-guard Step 6 for 1.3/1.4 |

### Size and split

The 30-file estimate is honest, and most of those files are one- to ten-line pins. The cut Dev floated, with export inclusion as a separate 1.1b, is **not safe**. Every descriptor must be `include` or `exclude` ("no table descriptor is planned"), so 1.1a would have to ship the table as `exclude` and 1.1b would flip it. That is a deliberately wrong CR-19 classification in between, plus every count pin edited twice. The table, migration B and all registrations are one CI-coupled unit (a).

**Recommended split, if Barak wants a smaller first PR:**
- **1.1a: storage.** Covers `issueReportModel.ts` (constants only: statuses, hints, closed reasons, reference pattern and alphabet, because the migration text test pins the CHECKs to them), migration A and its companions, migration B, its checker and the regenerated outputs, descriptor + export + ownership registration, and every pin. It ends with the apply. Deletion and export are complete from the moment the table exists.
- **1.1b: repository.** Covers `generateIssueReportReference` (in the same model module), `IssueReportRepository`, its types and index export, and both unit tests. There is no migration, no registry and no apply. It cannot leave deletion or export incomplete, because it adds no table, and nothing calls it until 1.2.

Each half is green on its own, and there is no window where account deletion misses reports. If Barak prefers one PR, the plan as written (with RC-1 to RC-9) is fine.

### Requirement wording fixes (BA, in `BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md`)

- **1.2**, replace "Stores the report and its support-email outbox row in one step, returns the reference number" with: "Stores the report and returns the reference number. From 1.3 on, the report and its support-email outbox row are written in one transaction (1.3)."
- **1.3**, replace "Store-first: the email is a queued row created with the report (CR-6)" with: "Store-first: the submit route's write becomes one transaction that stores the report and its support-email outbox row together, through a claim-style locked-down RPC (SR-4) (CR-6)."
- **§4.1 Environment row**, replace the example `production` / `staging` with: "The deployment environment label, set server-side. The value set, and how Staging is told apart from a Preview deployment, is ruled in the 1.2 workplan."
- **1.5**, add a criterion: "The export module `issue_reports` is switched on (`on: true`) in this slice, so every report a customer can submit is in their data export."
- **1.1 row:** no change needed.

### Optimisation suggestions
- §8: add a check to the migration text test that the export `columns` + `excludedColumns` equal the 15 migration columns. §6.2 already plans this, so put it in the task list so it is not lost.
- Run `business-os-data-exports-drop.migration.test.ts` among the targeted tests. It reads 20261134 by name and should pass unchanged, which confirms the freeze in RC-6.

### Approval
[x] Workplan approved with changes. Make RC-1 to RC-9 in this plan, then proceed to implementation once Barak approves the plan (and the split, if taken). The apply of A then B is cleared for the user to paste at ship drill step 6, after code review, diff approval and a green, up-to-date PR, and only after the pre-check passes.

---

## QA Testing Report

*QA populates this section.*

---

## Commit Info

*RM populates this section.*

---

## SA Code Review — 2026-11-27

**Code Review by SA — 2026-11-27** (slice 1.1a, worktree `neuronforge-issue-reporting-1-1a`, branch `feature/bos-issue-reporting-1-1a` off `origin/main` `05732d73`, uncommitted diff plus untracked files)
**Status:** ✅ Code Approved. Three Low items below are optional and do not block QA.

### What was verified, not taken from the report

| # | Check | Result |
|---|---|---|
| 1 | Migration A against rulings Q1 to Q8 | ✅ `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then `SELECT` to `authenticated` and S/I/U/D to `service_role` (Q3). One `PERMISSIVE FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))` policy, no write policy, no function, no trigger, nothing to anon (Q8). `closed_reason` is a closed CHECK `duplicate` / `spam` / `no_response` and is in `excludedColumns` (Q7). `environment` has the shape CHECK only (Q6). `problem_id` has no FK and no index. The post-condition reads `polroles`, privileges through `has_table_privilege` / `has_any_column_privilege` (including the `public` pseudo-role), the one FK by `confdeltype`, the eleven CHECKs by name and count, the index and the triggers |
| 2 | CHECKs tied to the model constants | ✅ `issue-reports.migration.test.ts` builds the expected CHECK text from `ISSUE_REPORT_STATUSES`, `_CATEGORY_HINTS`, `_CLOSED_REASONS`, `_REFERENCE_PATTERN.source`, `_INITIAL_STATUS` and the three bounds, and compares byte for byte. The negative controls (an extra status, a widened pattern) fail it |
| 3 | Migration B equals the generator output | ✅ Rendered in memory by importing the generator's `render*` functions, with no file written. All five outputs (check SQL, delete SQL, migration, rollback, version module) are byte-identical to disk, LF only. Stamp `e3796cce5c2b37a7`. The md5 of the `$operator_cleanup$` body, computed independently, is `44f20892f1719dcf76ab51179eebc655`, the checker's row 9 value |
| 4 | Migration B is the only cleanup change | ✅ Diffed against `20261134` with the plan row numbers normalised: the header, 12 added `issue_reports` lines (8 step B plan rows across the hard and the anonymise plans, and 4 `fk_review` tenancy rows) and the stamp. Nothing else. The generator diff is `FUNCTION_MIGRATION`, `PREVIOUS_FUNCTION_MIGRATION`, purpose and rollback text and one `FULL_REMOVAL_EXTRAS` entry. Not in `KEEP_SET` or `FUNCTION_REQUIRED_TABLES` |
| 5 | G-10 and the inbound-FK guard | ✅ `tenancyForeignKeys()` holds `public.issue_reports.user_id` (pinned in the new 20261138 block). `testAccountCleanupInboundFk.guard.test.ts` passes in the targeted run |
| 6 | Checkers can fail | ✅ Checker A: walked row by row against the pre-apply state, all 16 rows read FAIL (every gate is either an `EXISTS` on the table oid, a count compared with a positive number, or guarded by `rel.oid IS NOT NULL`; a NULL result renders FAIL). It names every object exactly. No tautology. Checker B: matches its `export-requests` precedent shape; rows 5, 6, 7 and 9 read FAIL before the B paste, as its header says. Rows 1 to 4 already read ok then, which is the precedent and is stated honestly |
| 7 | Pre-check is read-only | ✅ One `WITH … SELECT`, no `SET`, no DML or DDL, only `to_regclass` / `to_regprocedure` lookups (the one cast is `'uuid'::regtype`, which cannot raise). P-7 requires the 20261134 stamp and the absence of the 20261138 one, never the 20261130 stamp (RC-2) |
| 8 | Rollbacks are complete | ✅ A: refuses on a missing table, on the 8-argument function still naming `issue_reports`, and on any row after an `ACCESS EXCLUSIVE` lock; plain `DROP TABLE` (policy and index go with it), no `CASCADE`; one transaction with `lock_timeout`. B: generated, drops the 8-argument signature and restores the 20261134 function byte for byte (pinned by `previousFunctionSql`). Undo order B, A, revert is stated in both headers |
| 9 | Registrations and pins agree | ✅ Descriptor `never`, scope `user_id`, `ISSUE_REPORTS_EXPORT` include with 11 columns + 4 excluded = the 15 migration columns (read from the migration text). `USER_OWNED_TABLES.issue_reports`. `ExportSectionId`, `accountTableSection('issue_reports')` last (account / controller), module `issue_reports` `on: false`, record and column labels (no key collides with an existing included column of another table). Counts: 168 = 39 include + 0 planned + 129 exclude; baseline 168; include-without-rowKey 38 (RC-3); 14 modules / 40 sections and the renamed schema test (RC-3); `PREVIOUS_MIGRATION_FILE` = 20261134 and 20261130 named on its own in both allow-lists with `ALL_AUTH_WRITE_SHAPES` (RC-4); the 20261134 pair in the L8 allow-list (RC-5); RC-6 (i) to (iii), with 20261134 moved from `APPLIED_TARGET` to `APPLIED` and the new target hashes pinned |
| 10 | Scope | ✅ No repository, no reference generator, no route, no flag. The model module is constants only, has no imports and no backslash escape (Tailwind scan) |
| 11 | Only module-driven export reads | ✅ The only runtime consumer of `EXPORT_SECTIONS` (`moduleExportWorkerDeps.ts`) filters by the requested modules' sections, so the off module keeps the section unread until 1.5 |
| 12 | Standards | ✅ No `console.*` in touched app or lib files. No secret, project id or key prefix in any new file. Typecheck of the touched files (a scoped `tsc -p` over the 20 touched TS files): the only errors are two in `lib/business-os/catalog/catalog.ts` and one at `exportClassification.test.ts:2070`, all three in lines this diff does not touch (git blame: 2026-10-17) |

### Code Review Comments

1. `scripts/check-issue-reports-migration.sql:77-106` — the checker is a little weaker than the migration's own post-condition. Row 8 does not test anon column-level INSERT / UPDATE / REFERENCES, row 9 does not test authenticated column-level REFERENCES, and row 10 does not assert that `service_role` lacks REFERENCES and TRIGGER. The post-condition checks all of them, so a wrong apply cannot commit, and the plan's C-10 only asked for TRUNCATE. Optional: align the three rows with the post-condition so the checker carries the same evidence on its own — Priority: Low
2. `docs/workplans/BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md:113` — the reason given for `TO authenticated` names an internal security incident by tracker id. That hole is fixed and applied, so it is not a current weakness, but tracked text should state the rule rather than the history. Suggested wording: "It names `TO authenticated` explicitly: a policy with no `TO` clause applies to PUBLIC, every role." — Priority: Low
3. SA Review Notes RC-4 and RC-6 above still say the target is 20261137. That was written before the renumbering. The code correctly uses 20261138 throughout (§5.2 is already updated). Nothing to change in code; the notes stay as the record — Priority: Low (information)

### Optimisation Suggestions
- The label and module-name drafts (K-4; §14.3) are for Barak's diff review, not an SA item. The Hebrew record label "דיווח על תקלה" and module "דיווחים על תקלות" say "fault", which fits `bug` but less so a `support` or `feature` report. Barak may prefer a neutral word.

### Tests run by SA (in the worktree, node_modules junction untouched)

| Run | Suites | Tests |
|---|---|---|
| `supabase/migrations/__tests__`, `lib/business-os/purge`, `lib/business-os/data-export`, `scripts/__tests__/testAccountCleanup*`, `lib/business-os/issue-reports` | 98 passed / 98 | 4352 passed / 4352 |
| Dependents: account and account-deletion, `firstPaymentStamp` guard, `businessOwnedTables`, `BusinessDataExportRepository`, the test-account-cleanup, export-sends and export-requests routes, `ModuleExport.render`, `lib/business-os/test-account-cleanup`, all of `scripts/__tests__` | 49 passed / 49 | 1992 passed / 1992 |

Dev's counts (101 / 4372 and 23 / 635) came from a different path set, so the numbers differ; nothing failed in either run. No full build was run (no env in the worktree; ship drill step 1 still runs it).

### Apply clearance (unchanged from the workplan review)
A then B, back to back in one sitting, at ship drill step 6: only after Barak's diff approval, a green PR that is up to date with `main`, and a pre-check with all 7 rows ok (row 7 is the per-environment proof that 20261134 is live). Checker A after A (rows 1 to 15 ok), checker B after B (all 9 ok). Then merge and deploy at once.

### Code Approved for QA: Yes

---

## QA Report — 2026-11-27 (1.1a)

**QA — 2026-11-27**
**Test mode:** full
**Strategy used:** A (Jest unit and text tests) plus C (an in-memory generator re-render and mutation probes in a scratch folder). This is a storage-only slice and nothing is applied, so no DB test is possible; no SQL was run against any project.
**Focus:** schema, security (grants, RLS text, checkers), registrations and pins
**Skipped:** B (integration) and D (browser). Nothing is applied and 1.1a has no route or UI. The behavioural RLS proof stays with checker A after the apply (§8)
**Input source:** prompt instructions from TL, plus §9.1 and §8 of this workplan

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Every §9.1 test file exists and passes | ✅ | Pass | `issueReportModel.test.ts` and `issue-reports.migration.test.ts` (new), every updated pin file, and the unchanged `business-os-data-exports-drop.migration.test.ts` and `testAccountCleanupInboundFk.guard.test.ts` |
| Targeted run: `supabase/migrations/__tests__`, `lib/business-os/issue-reports`, `lib/business-os/purge`, `lib/business-os/data-export`, `lib/business-os/__tests__/businessOwnedTables.test.ts`, `scripts/__tests__` (all), `lib/business-os/test-account-cleanup` | ✅ | Pass | **110 / 110 suites, 4962 / 4962 tests**, 442 s |
| Tailwind escape guard (`app/__tests__/tailwind-css-escape.guard.test.ts`) | ✅ | Pass | 1 suite, 6 / 6 tests |
| Failure path: a CHECK limit differs from the model constant | ✅ | Pass | Scratch probe on a copy. Each change makes `checkConstraintProblems` name the CHECK that differs: message `5000` to `5001`, page `512` to `511`, context `32768` to `32769` |
| Failure path: a revoke missing from the migration | ✅ | Pass | Dropping `anon` from the `REVOKE ALL` gives "the revoke is not from all four roles" |
| Failure path: a grant clause missing from checker A | ⚠️ | Partial | Caught: the column-level clauses (C-8, C-9), C-10 service_role and the C-7 PUBLIC acl. **Not caught:** the table-level clauses of rows 8 and 9 (see Edge Case 1) |
| Failure path: `issue_reports` left out of the cleanup function | ✅ | Pass | The probe removed it from `FULL_REMOVAL_EXTRAS` in memory and ran the real `testAccountCleanupSql.test.ts` and `testAccountCleanupInboundFk.guard.test.ts`. All of these fail: the drift tests (all five generated files), the 20261138 step B and G-10 tests, coverage C-3 and the G-18 inbound-FK guard |
| Failure path: export count pin off by one | ✅ | Pass | Probe 1 removed the `issue_reports` descriptor (167, not 168). The 168 totals, the 38 include-lists-id pin, the 15-column pin and the baseline "no table removed" test fail. Probe 2 removed the `issue_reports` module. T-2 fails (13 modules, not 14) and T-1 reports a section in no module |
| Probe control | ✅ | Pass | The same wrapper with no mutation is green, so the probe failures come from the mutation |
| The generator is deterministic and matches disk | ✅ | Pass | All five outputs rendered in memory, twice: check SQL, delete SQL, migration B, rollback B and the version module. They are byte-identical to disk and to each other, with no CR. The copies are in the QA scratchpad only; no worktree file was written |
| SQL is ASCII and LF; `.gitattributes` covers it | ✅ | Pass | All 9 SQL files have 0 CR and 0 non-ASCII bytes. `git check-attr` gives `text` and `eol=lf` for each. Coverage comes from the 5 new lines plus the existing `operator_test_account_cleanup` lines, which cover 20261138 and its rollback |
| No backslash+hex in new files | ✅ | Pass | None in the new lib, test or SQL files. The only backslashes in the lib diff are `\n` and `\r\n` in tests. The guard passes |
| No `console.*` in the new lib code | ✅ | Pass | 0 in every changed or new file under `lib/`, `scripts/` and `supabase/` |
| No secrets or project refs | ✅ | Pass | None of these in the new files: a JWT, `sk_`, `sb_`, a `supabase.co` host, a key name or a 20-character ref. The `encrypted_password = ''` hits are the cleanup function's anonymise step, not credentials |
| The `issue_reports` export module is off | ✅ | Pass | `exportModules.ts:187` `on: false` |
| Entitlements registration | ✅ | N/A | The diff imports nothing from `lib/business-os/entitlements/`, so `test:bos-entitlements` is not owed |
| Scope | ✅ | Pass | No repository, route, UI, flag or audit event. The 4 extra pin files are the ones §14.3 records |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **The text test does not pin the table-level clauses of checker A rows 8 and 9.** Severity: Low.
   - Files: `scripts/check-issue-reports-migration.sql:79-85` (row 8: anon SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) and `:94-99` (row 9: authenticated INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER).
   - Also not pinned: the positive grants, row 9 `:93` (authenticated SELECT) and row 10 `:106-109` (service_role S/I/U/D).
   - The `proves` list at `supabase/migrations/__tests__/issue-reports.migration.test.ts:306` covers only the column-level clauses and service_role TRUNCATE, REFERENCES and TRIGGER.
   - Steps to reproduce: in a copy of the checker, delete the line `    AND NOT pg_catalog.has_table_privilege('anon', (SELECT rel.oid FROM rel), 'INSERT')`. Then run `checkerProblems`, `scriptProblems` and `pasteProblems` on the copy.
   - Expected: a problem such as "C-8 anon INSERT is not checked".
   - Actual: `[]`. All 13 single-line deletions of this kind passed in the probe.
   - Impact: none on the current file, which is correct. The migration's own post-condition checks every one of these privileges, so a wrong apply still cannot commit. The gap is that a future edit could weaken the checker without CI noticing. Fix: add the table-level and positive clauses to `proves`.
2. **The SA Code Review section names the worktree folder** (`…-1-1a`), in "Code Review by SA" and in "Tests run by SA". §11 says no worktree path or folder name goes into tracked text. Docs only. Severity: Low.
3. **For information:** `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` has no `eol` attribute, so git warns "LF will be replaced by CRLF". The same happens on `origin/main`. The index and the working copy are both LF, and the drift test passes. Nothing to change in 1.1a.

### Test Outputs / Logs

```text
Targeted run (worktree):
Test Suites: 110 passed, 110 total
Tests:       4962 passed, 4962 total
Time:        442.296 s

Tailwind escape guard: Tests: 6 passed, 6 total

Generator re-render (in memory, compared with disk):
scripts/test-account-cleanup-check.sql: identical=true deterministic=true hasCR=false bytes=64928
scripts/test-account-cleanup-delete.sql: identical=true deterministic=true hasCR=false bytes=85053
supabase/migrations/20261138_operator_test_account_cleanup_issue_reports.sql: identical=true deterministic=true hasCR=false bytes=344611
supabase/SQL Scripts/20261138_operator_test_account_cleanup_issue_reports_rollback.sql: identical=true deterministic=true hasCR=false bytes=341768
lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts: identical=true deterministic=true hasCR=false bytes=361
FILES_DIFFERING=0

Mutation probes (scratch wrappers that require the real test files):
qa-control (no mutation)  PASS
qa-cleanup-drop           FAIL (expected) - drift x5, 20261138 step B + G-10, coverage C-3, G-18 inbound-FK guard
qa-descriptor-drop        FAIL (expected) - 168 totals, 38 rowKey pin, 15-column pin, baseline removal
qa-module-drop            FAIL (expected) - T-1, T-2 (14 -> 13)
Total: Test Suites 3 failed (by design), 1 passed; Tests 46 failed, 984 passed, 1030 total
Migration-text probes (copy of the suite + 22 probes = 52 tests): 39 passed (30 original + 9 probes caught); 13 checker-clause deletions not caught (Edge Case 1)
```

### Final Status
- [x] All acceptance criteria pass: ready for commit once Barak has reviewed the diff. Edge Case 1 is Low and does not block. Dev may close it in this slice or carry it to 1.1b
- [ ] Issues found — Dev must address before commit

---

## SA Code Review (1.1b) — 2026-11-28

**Code Review by SA — 2026-11-28**
**Status:** ✅ Code Approved

Reviewed against the uncommitted diff on `feature/bos-issue-reporting-1-1b` (base `25eec10c`) plus the two new files, `lib/repositories/IssueReportRepository.ts` and its test. The migration 20261137 CHECKs were read from the file, not from this plan.

### What was verified, not taken from the report

| Item | Finding |
|---|---|
| RC-7 generator | ✅ `issueReportModel.ts` maps each of 8 bytes through `byte & 31` into the 32-character alphabet. 256 / 32 = 8, so there is no bias; the "each character exactly 8 times over 0..255" test proves it. The output matches the CHECK `^R-[0-9A-HJKMNP-TV-Z]{8}$` (200 random draws plus the pattern test). The byte source is `globalThis.crypto.getRandomValues`, and a short source throws instead of producing a short reference. The module still has no `import` or `require`, and a test pins that |
| RC-8 payload | ✅ The insert is a literal object built from the parsed allow-list, in the order `user_id, reference, message, category_hint, page, area, environment`. There is no spread. `user_id` is `value.userId` only. The test pins the keys exactly, and an injected `user_id`, `id`, `status`, `reference`, `context`, `screenshot_path`, `problem_id` and timestamps are all dropped (Zod strips unknown keys) |
| SA Q5 | ✅ `create` makes one `from('issue_reports')` call per attempt and no `rpc`. The test asserts the only database call is that `from` |
| Collision retry | ✅ Retried only when the code is `23505` and the message (or details) names `issue_reports_reference_key`, which is the constraint name in 20261137. At most 3 attempts in total, with a fresh reference each time. The third collision returns the `23505` error and logs `reference_collision_exhausted`. A `23505` on another constraint, any other error, a thrown generator and a row-shape failure all return after one attempt. The loop always ends: each pass returns, except a collision before attempt 3 |
| Zod bounds against the CHECKs | ✅ message 1 to 5000 and page at most 512, both counted in code points (`Array.from`), as `char_length` counts in a UTF-8 database. Page: starts with `/`, no `?` or `#`. The area and environment regexes are the CHECK regexes character for character. The category enum is the CHECK list. The astral-character test (5000 code points, 10000 UTF-16 units, accepted) proves the counting |
| `findByIdForUser` | ✅ Both ids are checked as uuids before any query, then `.eq('id', id).eq('user_id', userId).maybeSingle()`. A missing or foreign row gives `{ data: null, error: null }` |
| Repository pattern | ✅ Client injection with the service-role default, `RepositoryResult`, the explicit `ISSUE_REPORT_COLUMNS` (the 15 table columns in table order), a Zod row schema, `createLogger({ service })`, no `console.*`, never throws. Logs carry ids, the reference, the attempt, the error code and a duration, never the message, page or context; `toError` copies only `message` and `code`, so a PostgREST `details` (which can hold the failing row) never reaches a log or the caller |
| Service-role contract | ✅ Acceptable under CLAUDE.md rule 4 and `tenant-isolation-guard`. A `userId` parameter supplied by the caller is the contract of every repository here; the route is the place that binds it to the session. Step 1 of the skill does not call for more in the repository: the method is insert-only, the table has no trigger, there is no upsert or conflict target, and nothing in the payload comes from the caller except the allow-list. The worst a wrong caller could do is file a report under another account, never read or change one. The binding is therefore a requirement on 1.2 (see comment 3) |
| Dev's departures | ✅ All three accepted. The `generateReference` constructor argument is the injected generator that §3 names; it defaults to the Web Crypto generator and the production singleton passes nothing. The extra exports are constants and the row schema, with no new behaviour. The two guard tests (exactly two methods; no imports in the model file) pin the §7 "Not added" rule and RC-7 |
| Scope | ✅ No route, UI, email, migration, outbox or registry change. Nothing outside `lib/repositories/` imports the repository yet. The `types.ts` import from the model module is type-only, so nothing runs at load time |
| Text | ✅ Nothing in the tracked text describes an existing security weakness. The header describes the grant design (SELECT only for `authenticated`), which is the table's intended state. No backslash plus hex in any touched file (Tailwind), LF line endings, no secrets |

### Code Review Comments
1. `lib/repositories/IssueReportRepository.ts:234` and `:267` — when the row schema fails, `toError` copies the `ZodError` message into the returned error and the log. That message is the issue list, and for an enum it includes the value received (a `status` or `category_hint`, never the message or page text, since those are only type-checked). It is safe to log. The 1.2 route must not pass `error.message` to the client outside development (CLAUDE.md error format) — Priority: Low (note for 1.2, no change here)
2. `docs/workplans/BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md` §3 — the text says any other `23505` or other error also "logs `reference_collision_exhausted`". The code logs that event only for the third collision and logs other failures as "Failed to create the issue report". The code is the better behaviour; the §3 sentence could be reworded when the plan is next touched — Priority: Low
3. For the 1.2 workplan, not this diff — the route must take `userId` from `getUser()` only, and its integration test must show that a body `userId` / `user_id` is ignored (`tenant-isolation-guard` Step 7 at the route boundary). The 1.3 / 1.4 drains must pass the claimed row's `user_id` to `findByIdForUser` (Step 6) — Priority: Low (carry-forward)
4. For the 1.2 route schema, not this diff — Postgres `text` refuses U+0000, so a message or page holding a NUL character passes this Zod and fails at the database as a non-retried error. The product schema in 1.2 should refuse or strip it so the user gets a 400, not a 500. The repository's backstop role is fine as it is — Priority: Low (carry-forward)

### Optimisation Suggestions
- `IssueReportRepository.ts:103`: the refine computes `codePoints(value)` twice; computing it once is clearer. Style only.
- The retry `warn` at line 218 carries no `duration`, unlike the other log lines. Optional.

### Tests run by SA (in the worktree, `node_modules` junction untouched)

| Run | Result |
|---|---|
| `IssueReportRepository.test.ts` + `lib/business-os/issue-reports` + `issue-reports.migration.test.ts` | 3 / 3 suites, 82 / 82 tests |
| Every `lib/repositories/__tests__/*guard*` | 11 / 11 suites, 224 / 224 tests |

No full build, as briefed. No database access.

### Code Approved for QA: Yes

No High or Medium findings. Comments 1 to 4 are Low and need no change in 1.1b; 3 and 4 belong in the 1.2 workplan.

---

## QA Report — 2026-11-28 (1.1b)

**QA — 2026-11-28**
**Test mode:** full
**Strategy used:** A (Jest unit tests), plus C: mutation probes and an edge-case probe suite, run from a scratch folder through a scratch Jest config. That config extends the repo config, so the no-network guard stays on. The slice is a repository and a pure generator with no route, so the injected mock client is the right seam. No database was touched.
**Focus:** api (repository), security (tenant filter, insert allow-list, log content), schema (Zod bounds against the 20261137 CHECKs)
**Skipped:** B (integration) and D (browser). The brief rules out DB access, and 1.1b has no route or UI.
**Input source:** prompt instructions from TL, plus §3, §7, §8, §9.2, §14.4 and the SA Code Review (1.1b) of this workplan

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Every §8 / §9.2 test exists and passes | ✅ | Pass | `IssueReportRepository.test.ts` 31 / 31. `issueReportModel.test.ts` 21 / 21, of which 6 are new generator tests. `issue-reports.migration.test.ts` 30 / 30. **3 / 3 suites, 82 / 82 tests.** Every case §8 lists is present |
| All of `lib/repositories/__tests__` | ✅ | Pass | **145 / 145 suites, 3318 / 3318 tests**, 86 s |
| Failure path: `findByIdForUser` drops the `user_id` filter | ✅ | Caught | 2 tests fail: "found: filters by id AND user_id" and "another account's id … scoped to the caller's user_id". Dropping the `id` filter instead is also caught (1 test) |
| Failure path: the insert gains a spread | ✅ | Caught | `...input` before the fields: 2 fail (exact keys; injected-field drop). `...input` after the fields: 3 fail (also the NULL-optionals test) |
| Failure path: `user_id` taken from raw input (`input.user_id ?? value.userId`) | ✅ | Caught | 1 test fails: "drops an injected user_id …" |
| Failure path: retry on any 23505 | ✅ | Caught | 1 test fails: "a 23505 on another constraint is not retried" |
| Failure path: retry bound raised (3 to 10) | ✅ | Caught | 1 test fails: "stops after 3 collisions in total" |
| Failure path: retry unbounded | ⚠️ | Caught as a hang | The suite never finishes. It was killed at 120 s with no Jest result (see Edge Case 1). The baseline copy finishes in seconds |
| Failure path: message length counted in UTF-16 units | ✅ | Caught | 1 test fails: "accepts a message of exactly 5000 characters counted as code points" |
| Failure path: generator uses `Math.random` | ✅ | Caught | 1 test fails: "the default byte source is Web Crypto getRandomValues". It is still caught when the mutant keeps the `globalThis.crypto.getRandomValues` text in a comment, so the source-text check is not the only guard |
| Probe control | ✅ | Pass | The unmutated copies under the same scratch config are green, 52 / 52 |
| Edge: message empty / whitespace-only / 5000 / 5001 | ✅ | Pass | Empty is refused. Whitespace-only `'   '` is accepted and stored as given, which matches the CHECK `char_length BETWEEN 1 AND 5000`; trimming and the 10-character minimum are 1.2 route rules (§7). 5000 is accepted and 5001 refused, in ASCII and in astral characters. 4999 ASCII + 1 astral (5001 UTF-16 units) is accepted. A non-string is refused |
| Edge: page `/`, `?`, `#`, 512 / 513 | ✅ | Pass | `/` accepted. `/a?b`, `/a?` and `/a#b` refused. 512 accepted, 513 refused. 512 astral code points (1023 UTF-16 units) accepted. Empty, missing and null are refused |
| Edge: null versus missing optionals | ✅ | Pass | Missing, `undefined` and `null` `categoryHint` / `area` all insert `category_hint: null, area: null`, with the same 7 keys in the same order. An empty-string area is refused. Area of 40 is accepted, 41 refused. A null message, page or environment is refused |
| Edge: invalid uuid in `findByIdForUser` | ✅ | Pass | Empty, non-hex, SQL-like, trailing space, braces, `undefined` and `null` all return `invalid_input` with zero client calls and no throw. An upper-case uuid is accepted, which is right for Postgres `uuid` |
| Edge: a DB row that fails the row schema | ✅ | Pass | Six bad shapes on both methods: bad `user_id`, unknown `closed_reason`, array `context`, a missing column, bad `problem_id`, null `message`. Each returns `{ data: null, error }` and never throws. The ZodError text carries the received enum value (`archived`), never the message or page text (SA comment 1 confirmed) |
| Edge: the logger never receives message or page text | ✅ | Pass | One run through every path: success, collision, other DB error, row-shape failure, a throwing generator, read error, invalid input. Each DB error put the message and page into its `details` and `hint`. The serialised log, error objects and stacks included, holds neither |
| SA comment 4: U+0000 | ✅ | Noted | A NUL in the message and the page passes the repository Zod and reaches the insert. It cannot be reached today because nothing outside `lib/repositories/` calls the repository. **Carry-over to 1.2**, not a 1.1b bug |
| Generator sanity | ✅ | Pass | 10,000 default draws all match `ISSUE_REPORT_REFERENCE_PATTERN`. A `null` byte source throws. A 16-byte source uses the first 8 |
| No `console.*` | ✅ | Pass | 0 in all six touched TS files |
| LF line endings | ✅ | Pass | Both new files have 0 CR on disk. The four modified TS files and two docs are LF in the index (`git ls-files --eol`: `i/lf w/crlf`). The CRLF is the `core.autocrlf=true` checkout, and git normalises it on commit, so the diff has no line-ending churn (264 / 14 lines) |
| No backslash+hex | ✅ | Pass | No backslash at all in the repository, its test or the model. The model test has 3, all regex escapes (`\s`, `\(`). The added lines of `index.ts`, `types.ts` and the docs have none |
| No secrets | ✅ | Pass | No JWT, `sk_`, key name, password or private key in the touched files |
| Nothing outside `lib/repositories/` imports the repository | ✅ | Pass | No match in `app/`, `lib/` (outside `lib/repositories/`), `components/`, `hooks/`, `scripts/` or `tests/`, tracked or untracked. `types.ts` imports only types from the pure model module |
| Scope: no route, UI, email or migration | ✅ | Pass | 6 modified files (model, model test, `index.ts`, `types.ts`, workplan, requirement) + 2 new (repository, its test) |
| Entitlements registration | ✅ | N/A | The diff imports nothing from `lib/business-os/entitlements/`, so `test:bos-entitlements` is not owed |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **An unbounded retry is caught only as a hang, not as a named failure.** Severity: Low.
   - File: `lib/repositories/__tests__/IssueReportRepository.test.ts:45` and `:53`. `take()` repeats the last result forever, and the builder's `then` resolves synchronously.
   - Steps to reproduce: in a copy, change `IssueReportRepository.ts:217` to `if (true) {` and run the "stops after 3 collisions" test.
   - Expected: a red test that names the cause.
   - Actual: an endless loop of microtasks, so Jest's 5 s timeout cannot fire. The run was killed at 120 s with no result. In CI this would show as a stalled job, not as this test.
   - The code is correct today, since the loop always ends (verified, and the bound-of-10 mutant is caught cleanly). A possible fix, the next time the test is touched: make the mock's 4th answer a success row, so an over-retry fails `toHaveLength(3)` straight away.
2. **Carry-over to 1.2 (SA comment 4):** a U+0000 in the message or page passes `createSchema` (`IssueReportRepository.ts:101-113`) and would fail at Postgres as a non-retried error, which is a 500. It cannot be reached today, because nothing calls the repository yet. The 1.2 route schema should refuse or strip it, and its test should show a 400.
3. **For information:** a whitespace-only message (`'   '`) is accepted by the repository and the CHECK alike. The trimmed 10-character minimum is the 1.2 route's rule (§7). The 1.2 route test should cover it.

### Test Outputs / Logs

```text
Targeted (worktree): IssueReportRepository.test.ts + lib/business-os/issue-reports + issue-reports.migration.test.ts
Test Suites: 3 passed, 3 total
Tests:       82 passed, 82 total   (31 repository + 21 model + 30 migration)

All of lib/repositories/__tests__ (worktree):
Test Suites: 145 passed, 145 total
Tests:       3318 passed, 3318 total
Time:        85.877 s

Mutation probes (scratch copies, scratch Jest config extending the repo config):
baseline (repo copy) + model_baseline           PASS 52 / 52
m1  drop .eq('user_id')                         FAIL 2 / 31 (expected)
m7  drop .eq('id')                              FAIL 1 / 31 (expected)
m2  ...input spread before the fields           FAIL 2 / 31 (expected)
m2b ...input spread after the fields            FAIL 3 / 31 (expected)
m2c user_id from raw input                      FAIL 1 / 31 (expected)
m3  retry on any 23505                          FAIL 1 / 31 (expected)
m4  bound 3 -> 10                               FAIL 1 / 31 (expected)
m4  unbounded                                   HANG, killed at 120 s (timeout exit 124)
m5  UTF-16 length                               FAIL 1 / 31 (expected)
m6  Math.random byte source (two variants)      FAIL 1 / 21 each (expected)

Edge-case probe suite (scratch, imports the real worktree modules): 47 / 47 pass
```

### Final Status
- [x] All acceptance criteria pass: ready for commit once Barak has reviewed the diff. Edge Cases 1 to 3 are Low. 2 and 3 belong in the 1.2 workplan; 1 is optional
- [ ] Issues found — Dev must address before commit

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Created | Dev workplan for slice 1.1 (report storage), for Barak's review and then SA's. Covers the table design, reference generation, migration A with pre-check / checker / rollback, the regenerated cleanup function (migration B, a G-10 / anonymise coupling the requirement does not name), purge, ownership and export registration with every CI pin, the two-method repository, tests, files, risks and eight SA questions. No code written |
| 2026-11-27 | SA workplan review | Approved with changes against `origin/main` `ec66b04e`. Claims (a) and (b) confirmed; (c) mostly right, three misses. Q1 to Q8 ruled. RC-1 to RC-9: add the migration B checker; P-7 is the liveness proof; a missed include pin (37 to 38); the displaced file in the deletion-path guard is 20261130; the L8 allow-list in the credit-lots test; more cleanup test changes; Web Crypto; insert payload order; record the split. Optional split into 1.1a storage and 1.1b repository; export cannot be split off. Requirement wording fixes for 1.2, 1.3, §4.1 and 1.5 |
| 2026-11-27 | RC-1 to RC-9 folded in; split taken | Barak took SA's split: **1.1a storage** (model constants, migrations A and B with their checkers, every registration and pin) and **1.1b repository** (Web Crypto reference generator and `IssueReportRepository`). §3, §4, §5.2, §6.2, §7, §8, §9 and §14 updated; SA Review Notes kept as the record. Migration numbers re-checked: 20261136 is held by an open branch, so A = 20261137 and B = 20261138. 1.1a branch `feature/bos-issue-reporting-1-1a` |
| 2026-11-27 | 1.1a implemented (uncommitted) | Dev built 1.1a in its worktree: model constants, migration A + rollback + pre-check + checker, migration B regenerated (stamp e3796cce5c2b37a7) + its checker (RC-1), every registration and pin (RC-3 to RC-6), text tests. Four extra pin files recorded in §14.3. Nothing committed, pushed or applied; awaiting SA code review and Barak's diff review |
| 2026-11-27 | SA code review (1.1a) | ✅ Code Approved for QA. Verified independently: migration A against Q1 to Q8; migration B byte-identical to an in-memory regeneration, body md5 `44f20892…` matches checker row 9, and the only change from 20261134 is the `issue_reports` rows and the stamp; every checker row reads FAIL before its paste; pre-check read-only; both rollbacks complete; every registration and count pin (RC-3 to RC-6). Targeted Jest 98 suites / 4352 tests and dependents 49 / 1992, all green. Three Low, optional items: checker A rows 8 to 10 thinner than the post-condition; §2.4 wording names a fixed incident; RC-4 / RC-6 notes predate the renumbering |
| 2026-11-27 | QA (1.1a) | Pass with notes. Targeted Jest 110 / 110 suites, 4962 / 4962 tests; Tailwind guard 6 / 6. Generator re-rendered in memory: all five outputs byte-identical to disk and deterministic. Mutation probes caught a CHECK bound drift, a missing revoke, `issue_reports` dropped from the cleanup plan, and the 168 and 14 / 40 count pins off by one. Low edge case: the text test does not pin the table-level clauses of checker A rows 8 and 9, or the positive grants of rows 9 and 10. ASCII / LF / `.gitattributes`, backslash+hex, `console.*`, secrets and `on: false` all clean. No DB access |
| 2026-11-27 | 1.1a merged and applied; 1.1b started | 1.1a merged in PR #700 (`25eec10c`). Migrations 20261137 and 20261138 applied to the live database; checker B read 8 / 9, row 9 differing only by the CRLF of the editor paste (md5 without CR equals the committed body). 1.1b status set to In progress on branch `feature/bos-issue-reporting-1-1b` |
| 2026-11-28 | 1.1b implemented (uncommitted) | Dev built the Web Crypto reference generator and `IssueReportRepository` (`create` and `findByIdForUser`, RC-7, RC-8, SA Q5) with types, the barrel export and unit tests (§14.4). Targeted tests are green, and the typecheck and lint are clean for the touched files. One small addition: an optional `generateReference` constructor argument for the collision tests. Awaiting SA code review |
| 2026-11-28 | SA code review (1.1b) | ✅ Code Approved for QA. Verified independently: RC-7 (unbiased `byte & 31`, CHECK pattern, model module import-free), RC-8 (literal allow-list payload in the stated order, `user_id` from input only), SA Q5 (one `from`, no RPC), the retry (only `23505` on `issue_reports_reference_key`, 3 attempts, fresh reference each), Zod bounds equal to the 20261137 CHECKs in code points, `findByIdForUser` scoped by both ids. Dev's three departures accepted. Tests: 3 / 3 suites, 82 / 82; repository guards 11 / 11, 224 / 224. Four Low items, none blocking; two carry forward to the 1.2 workplan (session-bound `userId` with a route test; refuse NUL characters) |
| 2026-11-28 | QA (1.1b) | Pass with notes. Targeted 3 / 3 suites, 82 / 82 tests (31 repository, 21 model, 30 migration). All of `lib/repositories/__tests__` 145 / 145 suites, 3318 / 3318 tests. Mutation probes caught a dropped `user_id` (and `id`) filter, an input spread before or after the fields, `user_id` taken from raw input, a retry on any 23505, a bound of 10, UTF-16 length counting and a `Math.random` byte source. An unbounded retry shows only as a hang (Low edge case). 47 edge probes pass. NUL characters and whitespace-only messages carry over to 1.2. Hygiene clean. No DB access |
