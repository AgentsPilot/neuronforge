# Workplan: SECURITY DEFINER Lockdown, Slice 6 (CI ratchet guard)

> **Last Updated**: 2026-10-08

**Developer:** Dev
**Requirement:** [SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md](/docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md) (FR-6, §5 CI cost, §6 S6, SA C-5, SQ-2, SQ-5, SQ-6)
**Evidence:** [SECURITY_DEFINER_FUNCTIONS_INVENTORY.md](/docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md); slice 1: [SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md](/docs/workplans/SECDEF_LOCKDOWN_SLICE1_WORKPLAN.md)
**Branch:** `feature/secdef-guard-slice-6` (worktree `neuronforge-secdef-s6`, off `origin/main` `06b77d1b`)
**Date:** 2026-10-08
**Status:** In Progress. SA code review fixes C-1 to C-3 and lows 4 to 7 done; SA re-check APPROVED WITH NITS; QA re-run PASS (2026-10-08). Awaiting user diff review, then RM. Left uncommitted

## Overview

Slice 6 adds a static CI guard so that the set of open SECURITY DEFINER functions cannot grow back while slices 2 to 5 close the existing ones. It is a second Jest file, run by the existing **required** `Admin authz surface guard` job (SA C-5). It scans every `.sql` file in `supabase/migrations/`, `supabase/SQL Scripts/` and `supabase/held/`. For every function a file creates or alters as `SECURITY DEFINER`, the same file must also (a) `REVOKE` EXECUTE on `public.<name>` from `PUBLIC`, `anon` and `authenticated`, and (b) pin `search_path`. The 70 existing non-compliant (file, function) pairs go on a frozen baseline that can only shrink. A typed allow-list (SQ-5) starts empty. No SQL, no database, no migration and no application code changes. CI time is unchanged: the job already runs in parallel with Build and finishes at least 68 s before it.

## Table of Contents

1. [Analysis](#1-analysis)
2. [Approach](#2-approach)
3. [Files](#3-files)
4. [Task list](#4-task-list)
5. [Test plan](#5-test-plan)
6. [Acceptance](#6-acceptance)
7. [Risks](#7-risks)
8. [Open questions for SA](#8-open-questions-for-sa)
9. [SA Review Notes](#sa-review-notes)
10. [QA Testing Report](#qa-testing-report)
11. [Appendix A: measured baseline](#appendix-a-measured-baseline)
12. [Change History](#change-history)

---

## 1. Analysis

### 1.1 The host job (read, not assumed)

| Fact | Where | Value |
|---|---|---|
| Workflow | `.github/workflows/admin-authz-guard.yml` | `Admin Authz Guard`, on `pull_request` and `push` to `main`, **no `paths:` filter** |
| Job name (the required check) | `jobs.admin-authz-guard.name` | `Admin authz surface guard`. Renaming it un-gates `main`, so this slice does **not** rename it |
| Required on `main`? | `gh api .../branches/main/protection` (read 2026-10-08) | **Yes.** Required contexts: `Admin authz surface guard`, `Type check (Business OS LLM attribution)`, `Build (next build)`, `React hooks rules guard`, `Business OS entitlements invariants`, `Gate tests (jest)`. `strict: true`, `enforce_admins: true` (admins cannot bypass) |
| How it runs the tests | step `Run the admin authz surface guard` | `npm run test:authz-guard` |
| Script | `package.json` | `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci` (one file) |
| Docs-only skip | `.github/ci/non-deploying-change.sh` | Skips only `docs/**`, root `*.md`, `scripts/**` (root-anchored) and `.claude/**`. `supabase/**` is never skippable, so a PR that only adds a migration always runs the guard. The job still reports on a skip, so it stays requireable |
| SQL it already scans | `SQL_SCAN_ROOTS` in the guard | `supabase/migrations` and `supabase/SQL Scripts` (rule R5, `profiles.role` in policies). **Not** `supabase/held` |
| Its SQL comment stripper | `stripSqlComments` | Regex: strips `--` only at line start and non-nested `/* */`; it does not know strings or dollar bodies. **Not reusable** for this rule (see §2.2) |
| Ratchet precedent | `CAPS` + `the ratchet` describe block | Per-rule `parked` / `permanent` exemption lists, each with a cap asserted by **equality** ("a slack cap is as bad as no cap"), and a `RATCHET_HINT` in every failure. Anti-vacuity via `CORPUS_FLOORS` (scanned-file floors) |

**Existing similar tests (reuse, do not duplicate):** none scans the repo for SECURITY DEFINER. `scripts/__tests__/inventory-security-definer-functions.test.ts` only checks the inventory SQL file is paste-safe and read-only. `supabase/migrations/__tests__/secdef-lockdown-slice1.migration.test.ts` and `scripts/__tests__/testAccountCleanupSql.test.ts` check one package each. `supabase/held/__tests__/purgeBusinessData.held.test.ts` checks the held purge function's body. None of them is a repo-wide ratchet, so slice 6 is new code, as FR-6 expects. It reuses the authz guard's ratchet shape (equality cap, hint text, corpus floors) rather than inventing one.

### 1.2 Runtime, measured (no-added-CI-time rule)

Seven PR runs on 2026-10-08, same head SHA for both workflows (from `gh run view --json jobs`):

| Head | Guard job (start to end) | of which `Run the guard` step | Build job | Build finishes after guard by |
|---|---|---|---|---|
| `065f11c9` | 86 s | 7 s | 209 s | 123 s |
| `3cb38cdd` | 119 s | 9 s | 207 s | 88 s |
| `89bbeb88` | 121 s | 9 s | 191 s | 70 s |
| `bc93c3f1` | 90 s | 8 s | 224 s | 134 s |
| `ea7ccda2` | 114 s | 9 s | 182 s | 68 s |
| `f0267897` | 116 s | 9 s | 222 s | 106 s |
| `8dcbdf8d` | 119 s | 10 s | 218 s | 99 s |

Both jobs start within a second of each other. The guard job is dominated by `npm ci` (65 to 96 s). Its test step is 7 to 10 s. **Headroom: at least 68 s** before Build ends.

The prototype parser (§2.2), run with plain Node over all 310 `.sql` files on this Windows machine, takes **0.9 s** (Windows file I/O is slower than the Linux runner). Adding a second, small Jest file to the same `jest` invocation adds that plus ts-jest compile of one file, an estimated 2 to 3 s on the step, well inside the 68 s headroom. **Budget for the new file: under 3 s on CI** (asserted indirectly by comparing the step time before and after on the PR, §6). The new file is also collected by the required `Gate tests (jest)` shards, where it adds the same seconds to one shard; that job also runs in parallel with Build.

### 1.3 Baseline, measured by running the prototype parser over the repo (2026-10-08, `06b77d1b`)

| Directory | `.sql` files | Files with a SECDEF definition | SECDEF (file, function) pairs | Compliant pairs | **Non-compliant pairs** | **Non-compliant files** |
|---|---|---|---|---|---|---|
| `supabase/migrations/` | 223 | 35 | 67 | 5 | **62** | **31** |
| `supabase/SQL Scripts/` | 86 | 7 | 9 | 2 | **7** | **5** |
| `supabase/held/` | 1 | 1 | 1 | 0 | **1** | **1** |
| **Total** | **310** | **43** | **77** | **7** | **70** | **37** |

- 69 distinct function names. Every one appears in the inventory doc. No SECDEF definition is in a schema other than `public` (0). 126 of the 173 `CREATE FUNCTION` statements in the corpus are not schema-qualified.
- **Why the 70 fail:** all 70 lack a single `REVOKE` on `public.<name>` naming all three client roles; 40 of them also lack a pinned `search_path`. 15 have a revoke that names the function **unqualified** (the claim/reap, verified-questions, auth-handoff and purge functions), most of them also without `PUBLIC`. One (`20261013_business_os_invite_existing_account.sql`) revokes `PUBLIC`, `anon` and `authenticated` in **three separate statements**, so it fails only the single-statement reading of C-5 (Q-2).
- **The 7 compliant pairs:** `20261005_business_os_entitlements.sql` (`business_os_plan_fact_onboarding`, `business_os_plan_fact_profile`), `20261041`, `20261042` and `20261043` (`operator_test_account_cleanup`), and the `20261042` / `20261043` rollbacks in `SQL Scripts` (they re-create the previous body). Slice 1's `20261044` defines no function (revokes only), so it has 0 pairs and 0 violations.
- **Anomaly scan:** 2 `SECURITY DEFINER` mentions sit inside single-quoted strings (both `COMMENT ON FUNCTION` text, `20260915a` line 174 and `20260920a` line 155) and are correctly ignored. **0** mentions sit inside a dollar-quoted body, **0** sit in a statement the parser does not recognise, and the lexer found **0** unterminated strings, comments or dollar bodies.
- The full per-file list is [Appendix A](#appendix-a-measured-baseline).

The baseline will **not** shrink as slices 2 to 5 land: those migrations revoke in a **new** file, and the old files never become compliant (the rule is same-file, C-5). Progress is measured on prod by the slice checkers, not by this list. The list shrinks only when a baselined file is deleted, archived, or edited into compliance (only plausible for `SQL Scripts` and `held`).

### 1.4 Skills and rules consulted

| Item | Applies? |
|---|---|
| CLAUDE.md rule 7 (no new pattern without SA review) | A second file in an existing required job is SA-approved (C-5). The ratchet shape copies the authz guard's |
| `feedback-no-added-ci-time` | Yes, §1.2 |
| `business-os-schema-check` | No claim about prod columns. The guard reads repo files only |
| `new-api-route`, `new-repository`, `new-plugin`, `tenant-isolation-guard`, `bos-llm-call-standards`, `business-os-entitlements`, `durable-queue-drain` | Not applicable: no route, repository, plugin, LLM call or entitlements import |
| Logging (`console.*`) | The new test file uses none. The workflow and `package.json` have no logging |

---

## 2. Approach

### 2.1 Placement

- **New file:** `supabase/__tests__/security-definer-surface.guard.test.ts`. Not in `supabase/migrations/__tests__/`, because `test:bos-entitlements` runs that whole directory and the guard would then run in a third job for no gain. Not in `lib/admin/__tests__/`, because it is not about admin. (Q-1.)
- **`package.json`:** `test:authz-guard` becomes `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts supabase/__tests__/security-definer-surface.guard.test.ts --ci`. Same job, same step, same job name.
- **Workflow:** comment-only edit to the header of `admin-authz-guard.yml`: name the second file, add `supabase/held` to the scanned list, and point at this workplan. No change to `name:`, triggers, steps or the scope rule.
- `non-deploying-change.sh` is unchanged: `supabase/**` is already never skippable.

### 2.2 Parser: a small SQL lexer, then statements

Regex on raw text is not enough: function bodies (`$$ ... $$`, `$body$ ... $body$`) contain semicolons, `REVOKE` text and the words `SECURITY DEFINER`; comments can hold a commented-out revoke; strings can hold anything. The guard therefore lexes first.

1. **Normalise** CRLF to LF.
2. **Lex** left to right, one pass, with these states. The output is a *scaffold* the same length as the input (line numbers survive for messages):
   - `-- ...` to end of line: blanked.
   - `/* ... */`, **nested** (Postgres allows nesting): blanked.
   - `'...'` with `''` escapes: contents blanked, quotes kept. **W-4:** backslash escapes apply only to an `E'...'` / `e'...'` whose `E` is its own token (not preceded by an identifier character, so `some_name'x'` is a plain string). `U&'...'`, `B'...'`, `X'...'` and `N'...'` are plain `''` strings.
   - `"..."` quoted identifiers with `""` escapes: kept (they are names), except that a `;` inside one is blanked (**W-2**), so it cannot split the statement.
   - `$tag$ ... $tag$` where the tag is empty or `[A-Za-z_][A-Za-z0-9_]*`, and the `$` does not follow an identifier character (so `$1` and `a$b` are not openers): contents blanked, delimiters kept.
   - An unterminated string, quoted identifier, comment or dollar body is **recorded as a finding** (fail closed), not skipped.
3. **Split** the scaffold on `;`. Every top-level semicolon is real, because the ones inside bodies and strings are gone. Collapse whitespace, so line breaks and indentation stop mattering.
4. **Recognise**, case-insensitively, at the start of a statement:
   - `CREATE [OR REPLACE] FUNCTION <qname> (` . It is a SECDEF definition when `SECURITY\s+DEFINER` (word-bounded) appears anywhere in the statement's collapsed scaffold, which holds only the header and trailer clauses (the body is blank). So clauses **after** `AS $$...$$` and `LANGUAGE` count, and `EXTERNAL SECURITY DEFINER` is covered (**W-5**). It is pinned when the same scaffold has `SET search_path` followed by `=`, `TO` or `FROM CURRENT`; the value is not judged (**W-5**).
   - `ALTER FUNCTION <qname> ...`: a SECDEF definition if it says `SECURITY DEFINER`, and a pin if it says `SET search_path` as above. A later `ALTER ... SECURITY INVOKER` in the same file needs no special case: the pair stays (fail closed, **W-5**).
   - `GRANT ... ON ALL FUNCTIONS IN SCHEMA <s> TO ...` (for R-d).
   - `REVOKE [GRANT OPTION FOR] {EXECUTE | ALL [PRIVILEGES]} ON FUNCTION <sig>[, <sig>...] FROM <role>[, ...] [CASCADE | RESTRICT]`. The signature list is split at top-level commas (argument lists contain commas).
   - `GRANT {EXECUTE | ALL [PRIVILEGES]} ON FUNCTION <sig>[, ...] TO <role>[, ...]`.
   - `DROP FUNCTION` (position only).
   - `<qname>` is `ident` or `ident.ident`. **W-1:** one function, `canonicalIdent`, compares every name (schema, function and role). A quoted identifier loses its quotes, keeps its case and has `""` unescaped; a bare one is lower-cased. So `"public"."f"` equals `public.f` and `"anon"` equals `anon`, while `"F"` does not equal `f`. Only a **bare** `PUBLIC` in a grantee list is the pseudo-role (`"PUBLIC"` is a role name). Whitespace around the dot is allowed. An unqualified `CREATE` name is taken as `public`.
5. **Anti-vacuity, fail closed.** Every `SECURITY DEFINER` in a file must be accounted for. Each of these is a finding:
   - (F-1) `SECURITY DEFINER` in the scaffold of a statement that is not a recognised `CREATE FUNCTION` / `ALTER FUNCTION` (for example `CREATE PROCEDURE`, `ALTER ROUTINE`, or a shape the regex misses); and **any** `CREATE [OR REPLACE] FUNCTION|PROCEDURE ... BEGIN ATOMIC` (**W-3**), with or without SECURITY DEFINER, because a SQL-standard body has unquoted top-level semicolons that the splitter cannot handle. None exists today;
   - (F-2) `SECURITY DEFINER` inside a **dollar-quoted** region (a `DO` block or a body that builds a function with `EXECUTE`), which the guard cannot check. Comments inside the body are ignored (the body is re-lexed with comments blanked); strings inside it are not;
   - (F-3) an unterminated string, comment or body.

   Mentions inside **single-quoted** strings are ignored: at top level these are `COMMENT ON` text (the 2 measured cases), and a single-quoted string cannot define a function by itself. Measured today: F-1, F-2 and F-3 are all **0**, so they start with no baseline. A future F-finding has to be resolved in the file (or allow-listed with `fn: 'F-1' | 'F-2' | 'F-3'`, §2.4), never baselined (asserted).

**Stated limits** (what the parser does not see, and why that is acceptable):

| Limit | Effect | Why acceptable |
|---|---|---|
| `SECURITY` and `DEFINER` built by string concatenation inside a `DO` block | Missed | Deliberate evasion, not an accident. Code review is the control. Ordinary dynamic DDL in a dollar body trips F-2 |
| A revoke issued by dynamic SQL (`EXECUTE 'REVOKE ...'`) | Not counted, so the function is flagged | Fails closed. Write the revoke as a plain statement |
| An unqualified `CREATE` in a file that changed `search_path` earlier, so the function lands outside `public` | Treated as `public` | No file does this today. The revoke must still be `public.`-qualified, which then fails safe if the function is elsewhere |
| Overloads | Matched by name: a revoke on `public.f(int)` credits `public.f(text)` in the same file | SA ruling: there are no overloads. Each finding prints the name |
| The `search_path` value is not judged (`''`, `public`, `pg_catalog, public, pg_temp`, `FROM CURRENT` all pass) | A weak pin passes | FR-6 asks for presence. Choosing the value is slice 7's job, per function |
| `scripts/**/*.sql`, `supabase/seeds/`, `supabase/tests/`, `supabase/functions/` are outside the rule | Not baselined, not ratcheted | FR-6 names three directories (Q-5). **O-1 tripwire:** the same analyser runs over them and asserts 0 SECDEF pairs and 0 F-findings, so the day one of them defines a SECDEF function the guard goes red and Q-5 is reopened. Measured: 0 and 0. Caveat: a PR touching only `scripts/` skips the job (`non-deploying-change.sh`), so the `scripts/` part of the tripwire fires on the next non-skippable PR. Accepted: nothing applies those files |
| Whether a file was actually applied in prod | Not known | The guard governs what the repo asks for; the slice checkers govern prod |

### 2.3 The rule, per (file, function) pair

For every function a file defines as SECURITY DEFINER (via `CREATE` or `ALTER`), **all** of these must hold in **that file**:

| # | Requirement | Source |
|---|---|---|
| R-a | A `REVOKE EXECUTE` (or `ALL [PRIVILEGES]`) `ON FUNCTION` statement whose target list includes the **schema-qualified** `public.<name>` (quoted or not, any case) and whose grantee list names **`PUBLIC`, `anon` and `authenticated`** in one statement. `REVOKE GRANT OPTION FOR` does not count (it leaves EXECUTE in place) | FR-6, C-5 |
| R-b | That `REVOKE` comes **after** the last `CREATE` of the function in the file. A revoke before a `DROP` and re-`CREATE` revokes nothing, because the new function gets fresh default grants (Dev addition, Q-3) | Postgres semantics |
| R-c | `SET search_path` with a value, on the last `CREATE` of the function, or in an `ALTER FUNCTION [public.]<name> ... SET search_path` in the file | FR-6, C-5 |
| R-d | No `GRANT EXECUTE` / `ALL` on the function **to `PUBLIC` or `anon`** after that revoke. A grant to `authenticated` or `service_role` is allowed (slices 3 and 4a keep `authenticated` on purpose) (Dev addition, Q-3) | Closes "revoke, then grant back" |

A file that only revokes, grants or `ALTER ... SET search_path` (slices 1 to 5, and slice 7) defines no SECDEF function and has no pairs to check. Moving a file (for example releasing the held purge into `migrations/`) creates a **new** (file, function) pair, which must comply.

### 2.4 Baseline, allow-list and the ratchet

```ts
interface BaselineEntry { readonly file: string; readonly fn: string }          // file is repo-relative, '/' separators
const SECDEF_BASELINE: ReadonlyArray<BaselineEntry> = [ /* 70 entries, Appendix A */ ];
const SECDEF_BASELINE_CAP = 70;                                                  // equality, may only go down
const SECDEF_BASELINE_FROZEN_THROUGH = '20261044';                               // last migration number when frozen (O-2)

interface AllowListEntry {
  readonly file: string;
  readonly fn: string;                                                           // '<schema>.<name>', or 'F-1' | 'F-2' | 'F-3' for a finding
  readonly reason: string;
  readonly saApprovedOn: string;                                                 // YYYY-MM-DD, recorded in the requirement SA Review (SQ-5)
}
const SECDEF_ALLOW_LIST: ReadonlyArray<AllowListEntry> = [];
const SECDEF_ALLOW_LIST_CAP = 0;
```

Assertions (each failure prints the rule, the file, the function, what is missing, and the ratchet hint):

1. **No new violation.** Every non-compliant pair is in the baseline or the allow-list. **O-3:** the message names the file, line and function, says which of R-a to R-d fails and why, and prints ready-to-paste lines with the last `CREATE`'s identity argument types filled in: `REVOKE EXECUTE ON FUNCTION public.<name>(<types>) FROM PUBLIC, anon, authenticated;`, `GRANT EXECUTE ... TO service_role;` and, for R-c, `ALTER FUNCTION public.<name>(<types>) SET search_path = public, pg_temp;` with a reminder to read the body first. The types are a heuristic (modes, names, defaults and `OUT` arguments removed; multi-word types kept), so the message says to check them against the prod signature.
2. **No stale entry (the decision asked for in the task).** Every baseline and allow-list entry must still be a non-compliant pair that the scan finds. An entry that has become compliant, or whose file or function is gone, **fails** until it is deleted and the cap lowered in the same commit. Reason, from the authz precedent: a stale entry is a pre-signed exemption. It would silently cover the next non-compliant definition of that name in that file (an edited `SQL Scripts` or `held` file, or a file re-created at the same path), which is exactly "room nobody signed for".
3. **Caps by equality.** `SECDEF_BASELINE.length === SECDEF_BASELINE_CAP` and `SECDEF_ALLOW_LIST.length === SECDEF_ALLOW_LIST_CAP`. With rule 2 this makes the baseline equal to the measured set, so it can shrink only.
4. **Frozen means frozen (O-2).** The freeze date of a baselined file is the first 8 digits of its base name after removing `-` (`2026-08-14_x` reads `20260814`, `20260915a_x` reads `20260915`, `20251117000003_x` reads `20251117`). It must be at or before `SECDEF_BASELINE_FROZEN_THROUGH`, and a baselined file with no such date **fails** (fail closed). The author chooses the file name, so this is a speed bump; the equality cap plus review is the real control (K-3), as the constant's comment says. New exceptions go on the allow-list with an SA date.
5. **Allow-list entries are well-formed:** `saApprovedOn` matches `^\d{4}-\d{2}-\d{2}$`, `reason` is at least 20 characters, and no pair is in both lists.
6. **F-findings** (§2.2 step 5) must be zero, except allow-listed. A test asserts that no baseline entry is an F-finding. Allow-listed findings count as measured for the stale check.
7. **Corpus floors (anti-vacuity, as `CORPUS_FLOORS` in the authz guard):** each directory exists and has at least 200 / 80 / 1 `.sql` files; the scan finds at least 77 SECDEF pairs and 43 files with one. A parser regression that finds nothing turns red instead of green. Floors are lower bounds, so new files never break them.
8. **The `20261013` pair stays baselined (SA Q-2)**, with an inline comment that it is closed in effect by three separate revokes, so nobody reads it as open.

### 2.5 Self-tests (fixtures inside the test file, as strings)

Fixtures are inline strings, never `.sql` files on disk, so the scanner never sees them. Each fixture runs through the same `analyseSql(file, text)` used by the scan.

| # | Fixture | Expect |
|---|---|---|
| S-1 | Compliant: `CREATE OR REPLACE FUNCTION public.f(uuid) ... SECURITY DEFINER SET search_path = public AS $$...$$;` then `REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon, authenticated;` and `GRANT ... TO service_role;` | 1 pair, compliant |
| S-2 | Same, revoke **without `PUBLIC`** (the 10 queue functions' real bug) | R-a |
| S-3 | Revoke **without `anon`** (`is_platform_admin`'s real bug) | R-a |
| S-4 | Revoke without `authenticated` | R-a |
| S-5 | **No `SET search_path`** | R-c |
| S-6 | Pin supplied by `ALTER FUNCTION public.f(uuid) SET search_path = public` in the same file | compliant |
| S-7 | Revoke with an **unqualified name** (`ON FUNCTION f(uuid)`) | R-a |
| S-8 | **Revoke in a different file**: the CREATE file and the REVOKE file analysed separately | the CREATE file fails R-a; the REVOKE file has 0 pairs |
| S-9 | `REVOKE GRANT OPTION FOR EXECUTE ...` | R-a |
| S-10 | Revoke **before** `DROP FUNCTION` + `CREATE` | R-b |
| S-11 | Revoke, then `GRANT EXECUTE ... TO anon` / `TO PUBLIC` | R-d; `TO authenticated` and `TO service_role` stay compliant |
| S-11b | Revoke, then `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon` | R-d |
| S-12 (W-1) | Lower case, newlines between every token, extra spaces, `REVOKE ALL PRIVILEGES`. A **quoted** `"public" . "f"` CREATE against a **bare** REVOKE; a bare CREATE against a quoted `"public"."f"` REVOKE with `"anon"`, `"authenticated"`; `public."F"` (other case); quoted `"PUBLIC"` | compliant, compliant, R-a, R-a |
| S-13 | The revoke appears only in a `--` comment, a nested `/* /* */ */` comment, or a string | R-a (comment and string are not code) |
| S-14 | The revoke and the words `SECURITY DEFINER` appear only **inside** a `$body$ ... $body$` that also holds `;` and a lone `$$` | 0 SECDEF pairs from the body; the outer statement is parsed correctly |
| S-15 | `DO $$ BEGIN EXECUTE 'CREATE FUNCTION ... SECURITY DEFINER ...'; END $$;` | F-2 |
| S-15b | A `/* runs as SECURITY DEFINER */` comment inside a function body | no finding |
| S-16 | `CREATE PROCEDURE public.p() ... SECURITY DEFINER` | F-1 |
| S-16b | `ALTER ROUTINE public.f(uuid) SECURITY DEFINER` | F-1 |
| S-17 (W-4) | `E'...'` and `e'...'` with backslash-escaped quotes and `;`, `U&'...'` with a backslash, `B''`, `X''`, `N''` with `;`, and `some_name'x'` (not an E prefix), before a compliant CREATE | no finding, compliant |
| S-17b | An unterminated `$$` | F-3 |
| S-18 | `ALTER FUNCTION public.f(uuid) SECURITY DEFINER;` alone | 1 pair, R-a and R-c |
| S-19 | One `REVOKE` naming two functions, `public.a(int), public.b(text, int)` | both compliant |
| S-20 | `COMMENT ON FUNCTION ... IS '... SECURITY DEFINER ...'` | ignored, no finding |
| S-21 | Lexer unit tests: output length equals input length, line count preserved, `$1` and `a$b$c` are not dollar openers | |
| W-2 | `public."odd;name"` in the CREATE and the REVOKE | no finding, 1 compliant pair |
| W-3 | `CREATE FUNCTION ... SECURITY DEFINER BEGIN ATOMIC ...; ...; END;` and `CREATE OR REPLACE PROCEDURE ... BEGIN ATOMIC ...` | F-1 for both |
| W-5 | `EXTERNAL SECURITY DEFINER` and `SET search_path FROM CURRENT` **after** `AS $$...$$` and `LANGUAGE`; `SET search_path TO ...`; a later `ALTER ... SECURITY INVOKER` | compliant, compliant, pair kept (R-a) |
| Q-6 | `private.f` with a `public.f` revoke, then with a `private.f` revoke; an unqualified CREATE | R-a, compliant; unqualified is `public.f` |
| O-3 | Message for a CREATE with parameter names, `DEFAULT`, an `=` default, an `OUT` argument and `timestamp with time zone`; `identityArgTypes` on `double precision`, `character varying`, `VARIADIC` | the exact paste lines; types kept |
| **Real files** | `supabase/migrations/20261044_secdef_lockdown_slice1_drains_locks.sql` | 0 pairs, 0 findings |
| | `20261041`, `20261042` and `20261043` `operator_test_account_cleanup*.sql` | exactly 1 compliant pair each (`operator_test_account_cleanup`), 0 findings |
| | `20260922_verified_questions.sql` (a known real failure) | 2 pairs, both R-a, and both unlisted once removed from the baseline |
| O-1 | `supabase/seeds`, `supabase/tests`, `supabase/functions`, `scripts` | 0 pairs, 0 findings |
| Ratchet | Baseline hint and messages | a synthetic stale entry and a synthetic new violation produce the documented messages (pure functions, no repo mutation) |

Mutation checks (done by hand during T-6, results in §4): (1) a probe file with no revoke and no pin; (2) a copy of `20261041` with `PUBLIC` removed from its revoke. Each was placed temporarily in `supabase/held/`, the guard was run, and the file was deleted. The real files were not touched.

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `supabase/__tests__/security-definer-surface.guard.test.ts` | create | The guard: lexer, statement parser, rule, baseline (70), allow-list (empty), caps, floors, self-tests |
| `package.json` | modify (one line) | Add the file to `test:authz-guard` |
| `.github/workflows/admin-authz-guard.yml` | modify (header comments only) | Name the second file and `supabase/held`. Job name, triggers and steps unchanged |
| `docs/workplans/SECDEF_LOCKDOWN_SLICE6_WORKPLAN.md` | create | This workplan |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify (later, T-10) | §4.3 S6 row: PR, merge, block proof |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify (later, T-10) | §6 row 6 status |

No SQL file, migration, rollback, checker or application file changes.

---

## 4. Task list

- ✅ T-0: Branch confirmed (`feature/secdef-guard-slice-6`). Requirement FR-6, C-5, SQ-2, SQ-5, SQ-6 read. The authz guard workflow, script, test, ratchet and skip rule read. Branch protection read (§1.1)
- ✅ T-1: Runtime measured on 7 PR runs (§1.2)
- ✅ T-2: Prototype parser run over the repo; baseline measured (§1.3, Appendix A)
- ✅ T-3: Workplan written
- ✅ T-4: SA workplan review (approved with conditions W-1 to W-6; Q-1 to Q-6 ruled as proposed). W-1 to W-5 folded into §2.2, §2.4 and §2.5; W-6 into §6; O-1, O-2 and O-3 taken
- ✅ T-5: Self-tests written (§2.5)
- ✅ T-6: Lexer, statement parser and rule implemented; self-tests green. Mutation checks, each file placed temporarily in `supabase/held/` and deleted after: (1) a probe `CREATE FUNCTION public.throwaway_secdef_probe(p uuid) ... SECURITY DEFINER` with no revoke or pin: guard **red** (1 failed, 58 passed), message `fails R-a, R-c` with the paste lines `REVOKE EXECUTE ON FUNCTION public.throwaway_secdef_probe(uuid) FROM PUBLIC, anon, authenticated;` and the `ALTER ... SET search_path` line. (2) a copy of `20261041` with `PUBLIC` removed from its revoke: **red**, `fails R-a`, paste signature `public.operator_test_account_cleanup(text, text, text, text, uuid, text)`, which matches the real revoke in the file
- ✅ T-7: 70 baseline entries generated from the scan, sorted, and compared with Appendix A: the same 70 pairs. The `20261013` entry carries the SA Q-2 comment
- ✅ T-8: `package.json` `test:authz-guard` now runs both files. `admin-authz-guard.yml`: header comments only (second file, `supabase/held`, the `scripts/` tripwire caveat). Job name, triggers and steps unchanged
- ✅ T-9: **Done 2026-10-08.** Local Windows runs about 3 to 4 times slower than the CI runner (the authz file takes 30 s here against its 7 to 10 s CI step).
  - New file alone: 59/59 passed, Jest time 7.5 to 9.2 s locally.
  - `npm run test:authz-guard`: 2 suites, **178/178** passed (119 authz + 59 new), Jest time 69.7 s locally. The two files run in parallel workers: authz 30.1 s, new file 7.5 s, so on CI the new file should finish inside the authz file's time.
  - `npx eslint` on the new file: clean. `npx tsc --noEmit --strict` on the new file: clean.
  - Regressions: purge `no-deletion-paths` guard and `tailwind-css-escape` guard, 20/20 passed.
  - Tailwind escape decoder (the guard's own regex) run on every changed or new file: 0 undecodable escapes (153 backslash sequences in the new file, all safe). `app/globals.css` also has `@source not "../supabase"`, so Tailwind does not scan the file at all.
- ✅ T-9b: **SA code-review fixes, 2026-10-08.** All are in `supabase/__tests__/security-definer-surface.guard.test.ts`, each with fixtures in the describe block `SA code-review fixes`.
  - **C-1:** the lexer records top-level single-quoted string spans. `SECURITY DEFINER` inside one is F-2 unless its statement starts with `COMMENT ON`. Fixtures C-1a (`DO '...'`), C-1b (`AS '...'`, reported on line 2) and C-1c (multi-line COMMENT ON, exempt). The 2 real COMMENT ON cases stay ignored, and no file in the three directories newly fails.
    - Exemption, tripwire only: 6 read-only checkers under `scripts/` print `'security definer '` labels. They are exempt when their first statement is `SET default_transaction_read_only = on`. Fixture: `C-1 tripwire exemption is for read-only scripts only`.
  - **C-2:**
    - REVOKE and GRANT accept `ON FUNCTION|ROUTINE|PROCEDURE`.
    - The pseudo-role test is `canonicalIdent(name) === 'public'`: `"public"` is PUBLIC, `"PUBLIC"` is a role.
    - `ON ALL FUNCTIONS|ROUTINES|PROCEDURES IN SCHEMA` splits the schema list and accepts `GRANTED BY`.
    - Any other `GRANT ... ON [ALL] FUNCTION(S)|ROUTINE(S)|PROCEDURE(S)` is F-1.
    - Fixtures: C-2a (ROUTINE to anon, PROCEDURE to PUBLIC, REVOKE ON ROUTINE), C-2b, C-2c, C-2d and the C-2 backstop.
  - **C-3:** the allow-list is a union of two entry shapes: a pair allowance `{file, fn, reason, saApprovedOn}` and a finding allowance `{file, finding, count, reason, saApprovedOn}`. `evaluateFindingAllowances` requires measured count == `count` per (file, kind): more is a new finding, fewer or zero is stale. 4 pure fixtures.
  - **Lows:**
    - 4: `ALTER ... RESET search_path`, `RESET ALL`, `SET search_path TO DEFAULT` and `= DEFAULT` remove the pin. The last pin-affecting ALTER after the last CREATE decides. 5 fixtures.
    - 5: `splitTopLevel` skips commas and parens inside `"..."`.
    - 6: F-3 findings carry the line they opened on.
    - 7: R-b text now reads "a later CREATE follows the REVOKE: move the REVOKE after the last CREATE".
  - **QA edge cases:** paste lines re-quote names that are not lower-case (`public."MyFn"(uuid)`, via `quoteIdent`). An R-d message says "remove that GRANT" with its line(s), and no longer suggests a REVOKE.
  - **SA optional tripwire, taken:**
    - Scope: every `.sql` from `git ls-files --cached --others --exclude-standard` outside the three directories. That is 63 files today: `scripts/`, `supabase/seeds`, `supabase/tests`, `archive/`, the root and so on.
    - Asserts 0 pairs and 0 findings, with a floor of more than 20 files.
    - Cost about 1.0 s locally, 0.7 s of it `git ls-files` on Windows. Expected well under that on the Linux runner.
  - **Results:**
    - New file **84/84** (was 59), 5.5 to 7.8 s locally.
    - `npm run test:authz-guard`: **203/203** (119 + 84), Jest 38.5 s locally, of which the authz file 21.3 s.
    - eslint clean. `tsc --noEmit --strict` clean after one Map typing fix (ts-jest does not type-check, so this run matters).
    - Purge and Tailwind guards pass. Tailwind decoder: 0 bad escapes out of 192 sequences.
  - **Temp probes**, each deleted after (`git status` shows none):

    | Probe | Result |
    |---|---|
    | QA e | R-a |
    | QA g | R-d |
    | QA m | F-2 |
    | C-1 `DO '...'` | F-2 |
    | C-2a ROUTINE, C-2b `"public"`, C-2c schema list, C-2d GRANTED BY | R-d each |
    | C-2 `GRANT USAGE, EXECUTE` | F-1 |
- ⬜ T-10: Hand to SA for code review (re-check of C-1 to C-3 pending), then the user's diff (uncommitted). After merge: requirement §4.3 and inventory §6 updated; throwaway-PR block proof recorded (§6)

---

## 5. Test plan

| Layer | What | How |
|---|---|---|
| Unit | Lexer, statement parser, rule R-a to R-d, F-1 to F-3 | Fixtures S-1 to S-21 |
| Real-file | Slice 1 and the operator cleanup migrations pass; a known-bad file fails | Read from disk in the test |
| Repo scan | 0 unlisted violations, 0 stale entries, caps equal, frozen-through, floors | The guard itself, on every PR |
| Mutation | A scratch copy with one role removed goes red | By hand, T-6, recorded under QA |
| Runtime | Step time on the PR versus the 7 to 10 s baseline in §1.2 | `gh run view --json jobs` on the PR |
| Regression | `test:authz-guard` original 119 tests still pass | T-9 |

Jest cannot show that the required check blocks a merge. That is §6 step 3, done by the user.

---

## 6. Acceptance

1. CI green on the slice 6 PR, including `Admin authz surface guard`, with the step log showing both test files ran.
2. The guard step stays inside the 68 s headroom (expected about +3 s). Record the PR's guard job and Build durations.
3. **Block proof (user, after merge to `main`).** "Red" is not enough; the merge must be blocked (C-5, §6 S6):
   1. From an up-to-date `main`, create a throwaway branch, for example `throwaway/secdef-guard-block-proof`.
   2. Add one file, **`supabase/held/29991231_throwaway_secdef_probe.sql`** (W-6, see below), holding only `CREATE FUNCTION public.throwaway_secdef_probe() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;` (no revoke, no `search_path`). **Never apply it to any database.**
   3. Open a PR to `main`. Wait for `Admin authz surface guard` to finish red, with the failure naming `throwaway_secdef_probe` and R-a and R-c.
   4. Record the merge box text. Pass = it says merging is blocked because a required status check failed, and **no** merge button is enabled. `enforce_admins` is on (§1.1), so the owner should not be offered a bypass either. If a bypass is offered, record it: the protection is weaker than measured.
   5. Close the PR without merging and delete the branch. Record the PR number, the failing test name and the merge-box text in the QA section and in requirement §4.3.
4. Requirement §4.3 (S6 row) and inventory §6 row 6 updated with PR, merge and block proof (user rule: every slice stage goes into the main requirement).

**W-6 finding (Dev, 2026-10-08): no auto-apply path in the repo, but the repo cannot prove the dashboard side, so the probe goes in `supabase/held/`.**

| Checked | Result |
|---|---|
| `supabase/config.toml` | 11 lines: only `[functions.run-scheduled-agents]`. No `project_id`, no `[db]`, no `[remotes]`, no branching section |
| `.github/workflows/*.yml` | None runs the Supabase CLI (`supabase db push`, `migration`, `link`, `setup-cli`) or uses a Supabase access token |
| `package.json` scripts | No `db push` |
| `vercel.json` | `ignoreCommand` and crons only. No Supabase build step |
| Check runs on PR #261 (a migration PR) | Only the GitHub Actions jobs, `Vercel Preview Comments` and the Vercel status. No Supabase check, which the Supabase GitHub integration posts when branching is on |
| Prod behaviour | Slice 1's `20261044` was not applied by its PR. The user applied it by hand on 2026-10-08, and the pre-check before that showed the open state |
| `supabase/.temp/cli-latest` | A tracked CLI version cache only, not a project link |

The Supabase dashboard can turn on a GitHub integration with no file in the repo, so the repo cannot prove it is off. The throwaway PR is never merged, so a "deploy on merge" setting would not fire, and a preview branch would only touch a throwaway branch database. Even so, W-6 says to use `supabase/held/` when this cannot be confirmed. Nothing applies `held/`, the guard scans it, and `29991231` is past the freeze date, so the probe cannot be baselined. Step 3.2 therefore uses `supabase/held/29991231_throwaway_secdef_probe.sql`. Measured locally (T-6): a probe of that shape turns the guard red with `fails R-a, R-c`.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | A false positive on a required check gets the check switched off (the authz guard's own warning) | Lexer rather than regex; 21 fixtures; fail messages show the exact fix; the allow-list exists for real exceptions |
| K-2 | A lexer bug blanks real code, so a violation goes unseen (the authz guard's stripper had exactly this bug) | Length- and line-preserving lexer with unit tests; F-3 for anything unterminated; corpus floors on pairs found |
| K-3 | Someone baselines a new file to get green | Equality cap plus frozen-through date (§2.4 rule 4); allow-list needs an SA date |
| K-4 | Merge order: another PR adds a SECDEF migration before this lands | That PR is reviewed by SA for this (requirement R-8). If it merges first and is compliant, nothing changes; if not, this PR's scan goes red and the pair is either fixed in that file or argued onto the allow-list, never the baseline |
| K-5 | `strict: true` protection: a PR merged after this one but branched before it must re-run against the new `main`, so it cannot dodge the guard | Already enforced by `strict` |
| K-6 | The `Gate tests (jest)` quarantine could drop the file from the gate | The authz job runs it by explicit path, not through the gate (C-5). `Gate tests (jest)` is now also a required check (§1.1), so the file is gated twice |
| K-7 | Rule R-b or R-d (Dev additions) turn out stricter than SA intended | Both hold for all 7 compliant pairs today; Q-3 |

---

## 8. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | File location: `supabase/__tests__/` (new directory) or inside `lib/admin/__tests__/` next to the authz guard? | `supabase/__tests__/`: the guard is about SQL, and it stays out of `test:bos-entitlements` (which runs all of `supabase/migrations/__tests__/`) |
| Q-2 | R-a as written in C-5 is **one** statement naming all three roles. `20261013_business_os_invite_existing_account.sql` revokes `PUBLIC`, `anon` and `authenticated` in three statements, which is equally effective. Accept the union of revokes in the file, or keep one statement? | Keep **one statement**: it is what C-5 says, it is the shape every slice uses, and it is easy to see in review. The cost is one extra baseline entry (70 instead of 69) |
| Q-3 | Approve the two Dev additions: R-b (revoke after the last `CREATE`) and R-d (no later grant to `PUBLIC` / `anon`)? | Yes. Both close a real bypass, cost nothing today (all 7 compliant pairs pass), and stay off `authenticated` grants |
| Q-4 | Stale baseline entries **fail** (§2.4 rule 2), following the authz equality-cap precedent. Agree? Also: pin a content hash per baselined file, so any edit to a baselined `SQL Scripts` / `held` file forces it to be made compliant? | Fail on stale: yes. Content hash: **no** for now. Pair-level matching already catches a new function in an old file; a hash adds friction to harmless edits for little gain |
| Q-5 | Scope: also scan `scripts/*.sql` and `supabase/seeds/`, `supabase/tests/`, `supabase/functions/`? | No. FR-6 names three directories; the others hold no SECDEF definition today (the `scripts/` hits are text in read-only checkers). Revisit if that changes |
| Q-6 | Functions in schemas other than `public`: none exist today. Apply the same rule with that schema (fail closed), or ignore them? | Apply the rule with the function's own schema: costs nothing today and covers a future exposed schema |

---

## SA Review Notes

**Reviewed by SA — 2026-10-08**
**Status:** ✅ Approved with conditions (W-1 to W-6). Fold them in at T-4, then proceed to T-5. No re-review of the workplan needed; SA checks them at code review.

### Verified (read, not assumed)

| Claim | Result |
|---|---|
| Host job is required | ✅ `gh api .../branches/main/protection`: 6 required checks incl. `Admin authz surface guard` and `Gate tests (jest)`; `strict: true`; `enforce_admins: true` |
| Workflow shape | ✅ No `paths:` filter; skip rule (`non-deploying-change.sh`) never skips `supabase/**`; job still reports on a skip |
| Runtime | ✅ Spot-checked `ea7ccda2`: guard job 114 s, test step 9 s, Build ends 68 s after the guard. +2 to 3 s fits. The Jest gate shards also run in parallel with Build. No-added-CI-time rule met |
| Corpus spot checks | ✅ 310 `.sql` files; `20261013` revokes in 3 statements (and also from `service_role`); no `CREATE PROCEDURE`, no `ALTER ... SECURITY`, no `BEGIN ATOMIC` today; no SECDEF in `seeds/`, `tests/`, `functions/`; no open PR touches `supabase/` |
| Placement | ✅ `supabase/__tests__/` matches `testMatch` and `tsconfig` `include`; outside `test:bos-entitlements` |

### Rulings on Q-1 to Q-6

| # | Ruling |
|---|---|
| Q-1 | ✅ `supabase/__tests__/`, as proposed |
| Q-2 | ✅ **One statement**, as C-5 says. Keep the `20261013` pair on the baseline, with an inline comment that it is closed in effect by three statements, so nobody reads it as open |
| Q-3 | ✅ R-b and R-d approved. R-d stays off `authenticated` and `service_role` |
| Q-4 | ✅ Stale entries **fail** (equality precedent). ✅ **No** content hash: pair matching already catches a new function in an old file |
| Q-5 | ✅ Three directories only (FR-6). See optimisation O-1 for a cheap tripwire |
| Q-6 | ✅ Apply the rule with the function's own schema; an unqualified `CREATE` is `public` |

### Conditions

1. **W-1 Identifier canonicalisation.** One function compares every name: strip quotes, keep case inside quotes, lower-case bare identifiers (`""` unescaped). Apply it to schema, function and role names, so `"public"."f"` equals `public.f` and `"anon"` equals `anon`. Bare `PUBLIC` in a grantee list is the pseudo-role. S-12 must cover a quoted CREATE against a bare REVOKE and the reverse.
2. **W-2 `;` inside a quoted identifier.** Quoted identifiers are kept, so a `;` inside `"a;b"` would split the statement. Splitting must skip quoted identifiers (or the lexer blanks `;` inside them). Add a fixture.
3. **W-3 `BEGIN ATOMIC` bodies (PG14+ SQL-standard body).** They hold top-level semicolons with no dollar quote, so the splitter would break the statement. Any `CREATE FUNCTION|PROCEDURE ... BEGIN ATOMIC` is an **F-1** finding (fail closed). There are none today. Add a fixture.
4. **W-4 String prefixes.** `E'...'` / `e'...'` takes backslash escapes only when the `E` is its own token (not preceded by an identifier character); `U&'...'`, `B'...'` and `X'...'` are plain `''` strings. Extend S-17.
5. **W-5 Clause matching on the collapsed scaffold.** Match `\bSECURITY\s+DEFINER\b` (this also covers `EXTERNAL SECURITY DEFINER`) wherever it sits in the header or after the body. `SET search_path` counts with `=`, `TO` or `FROM CURRENT`: the value is not judged (§2.2). A later `ALTER ... SECURITY INVOKER` in the same file needs no special case (the pair stays; fail closed). Add one fixture where `SECURITY DEFINER` and `SET search_path` come **after** `AS $$...$$` and `LANGUAGE`.
6. **W-6 Block-proof safety.** Before step 3 of §6, confirm that no Supabase GitHub integration or branching auto-applies `supabase/migrations/**` from a PR. If that cannot be confirmed, put the probe in `supabase/held/` instead (it is scanned, and nothing applies it). Record which one was used.

### Optimisation suggestions (not blocking)

- **O-1:** Run `analyseSql` over `supabase/seeds`, `supabase/tests`, `supabase/functions` and `scripts/*.sql`, and assert 0 SECDEF pairs and 0 F-findings. This makes Q-5's "revisit if that changes" fail by itself, and costs milliseconds.
- **O-2:** Read the freeze date from the first 8 digits of the base name (after removing `-`), and fail closed if a baselined file has none. The filename is chosen by the author, so the equality cap plus review stays the real control (K-3). Say that in the constant's comment.
- **O-3:** Make the failure message print the exact one-line `REVOKE` with the `CREATE`'s argument list filled in, ready to paste.

### Approval
[x] Workplan approved, with conditions W-1 to W-6. Proceed to implementation

### Code Review by SA — 2026-10-08

**Status:** 🔄 Fix Required (three small fixes, C-1 to C-3; re-review limited to them and their fixtures)

**Verified (run, not assumed)**

| Check | Result |
|---|---|
| New file alone on a clean tree | ✅ 59/59. `test:authz-guard` 178 tests; the only reds seen were from QA's transient mutation probes (`29991231_qa_*.sql`), each naming the probe |
| eslint / tsc `--strict` (ES2017+ target, as `tsconfig`) on the new file | ✅ clean |
| Workflow diff | ✅ header comments only; `name:`, triggers, steps, scope rule unchanged |
| `package.json` | ✅ one line, both files in one step |
| Tailwind | ✅ `app/globals.css:28` `@source not "../supabase"` |
| W-1 to W-5, O-1 to O-3 in code | ✅ present with fixtures (one W-1 correction, C-2) |
| Ratchet | ✅ F-findings never baselinable (asserted, and the F test ignores the baseline anyway); stale entries fail; equality caps 70 / 0; freeze date fails closed; floors 200/80/1 and 77/43 |
| Adversarial probes (scratch copy of `analyseSql`) | `ALTER FUNCTION ... SECURITY DEFINER` alone in a later file: pair, R-a + R-c ✅. `DO $$ ... EXECUTE format('... SECURITY DEFINER ...') $$`: F-2 ✅. `FROM PUBLIC, anon, authenticated, service_role`: compliant ✅ (over-revoking is safe). `REVOKE ALL` and `REVOKE EXECUTE` both count ✅. `ON FUNCTION public.f` without args counts ✅. `REVOKE ... ON ALL FUNCTIONS IN SCHEMA` does not count: R-a, fail closed, accepted. 3-part name: F-1 ✅ |

**Code Review Comments**

1. **C-1** `security-definer-surface.guard.test.ts:142-168, 399-409` — F-2 only looks inside dollar bodies. A single-quoted body evades it: `DO 'BEGIN EXECUTE ''CREATE FUNCTION public.h() ... SECURITY DEFINER ...''; END';` and `CREATE FUNCTION public.mk() ... AS 'BEGIN EXECUTE ''... SECURITY DEFINER ...''; END'` both give 0 pairs, 0 findings (probed). The stated reason ("a single-quoted string cannot define a function by itself") is wrong for `DO '...'` and for `AS '...'`. Fix: record string spans in the lexer; `SECURITY DEFINER` inside a single-quoted string is F-2 unless the statement starts with `COMMENT ON` (the 2 measured cases). Add both fixtures. — Priority: High
2. **C-2** `:246-252, 318-330, 470-471` — R-d (later grant back) misses four shapes, all probed as compliant: (a) `GRANT EXECUTE ON ROUTINE|PROCEDURE public.f ... TO anon|PUBLIC`; (b) `TO "public"`: Postgres treats a quoted lower-case `"public"` as the PUBLIC pseudo-role (gram.y `RoleSpec`: `strcmp(name, "public")` after dequoting), so the pseudo-role test must be `canonicalIdent(name) === 'public'`, not "bare". `"PUBLIC"` stays a role, so S-12's last case still holds. This corrects my W-1 wording; it also makes `FROM "public", anon, authenticated` count for R-a (correct, today fail closed); (c) `IN SCHEMA public, extensions` (schema list not split); (d) `GRANTED BY` on the ALL-IN-SCHEMA form. Fix all four; accept `ROUTINE|PROCEDURE` in the REVOKE regex too. Fail-closed backstop: a statement starting `GRANT` that names `FUNCTION|FUNCTIONS|ROUTINE|ROUTINES|PROCEDURE` but matches neither grant regex is F-1. One fixture per shape. — Priority: High
3. **C-3** `:662, 754-757, 769-776` — **Ruling on Dev's flagged shape:** an allow-list entry `fn: 'F-n'` covers every finding of that kind in the file, including future ones: the pre-signed exemption the stale rule exists to stop. Line-level ids are too brittle (harmless edits shift lines). Require an exact count: a finding entry carries `count: number`, and the test asserts the measured number of that kind in that file **equals** it (more = new finding, fewer = stale). Pair entries unchanged. Cheap now, while the list is empty. — Priority: Medium
4. `:451-454, 503` — R-c credits a pin even when a later `ALTER FUNCTION ... RESET search_path`, `RESET ALL` or `SET search_path TO DEFAULT` removes it (probed). Make the last pin-affecting statement after the last CREATE decide. — Priority: Low (fix with C-2 if cheap; else note as a stated limit)
5. `:256-270` — `splitTopLevel` is not quote-aware: `FROM anon, authenticated, "x, PUBLIC, y"` passes R-a. Not reachable in practice (the role must exist or the migration errors). Skip `,` and parens inside `"..."`. — Priority: Low
6. `:397` — F-3 findings carry `line: 0` (the line is only in `detail`). Pass the line through. — Priority: Low
7. `:528` — R-b text says the revoke "revokes nothing"; true after `DROP` + `CREATE`, not after `CREATE OR REPLACE` (ACL survives; the guard still flags it, fail closed, as approved). Reword: "a later CREATE follows it: move the REVOKE after the last CREATE". — Priority: Low

### Optimisation Suggestions
- `:66` TRIPWIRE_DIRS: `archive/*.sql`, repo-root `*.sql` and `docs/**/*.sql` are outside both scan and tripwire (0 SECDEF today, never applied). Optional: make the tripwire "every tracked `.sql` outside SCAN_DIRS".

### Code Approved for QA: No — after C-1 to C-3 (and 4 to 7 if cheap) with fixtures, SA re-checks only those; no full re-review

### Code Re-check by SA — 2026-10-08 (T-9b fixes only)

**Status:** ✅ Code Approved (with nits)

| Item | Result (my probes re-run against the fixed analyser) |
|---|---|
| C-1 | ✅ `DO '...'` and `AS '...'` → F-2; `''` unescaped before matching; `COMMENT ON` (incl. multi-line) exempt; a `COMMENT ON` does not shield a following `DO '...'` |
| C-2 | ✅ `ON ROUTINE`, `ON PROCEDURE ... TO PUBLIC`, `TO "public"`, `IN SCHEMA extensions, public`, `GRANTED BY` → R-d each. `FROM "public", anon, authenticated` now counts for R-a (correct). Backstop: unreadable routine GRANT → F-1; table/schema grants (`ON public.functions_log`, `ON SCHEMA`) give no false F-1 |
| C-3 | ✅ Finding allowances are `{file, finding, count}`; measured count must equal `count` (more = new, fewer/zero = stale); `count > 0` asserted; pair allowances may not use `F-n` |
| Lows 4 to 7 | ✅ `RESET search_path` / `RESET ALL` / `TO DEFAULT` / `= DEFAULT` unpin, last ALTER decides; quote-aware split (`"x, PUBLIC, y"` now R-a); F-3 carries its line; R-b text reworded |
| QA `quoteIdent`, R-d text | ✅ non-lower-case names re-quoted in paste lines; R-d says remove the GRANT, with its line(s), and gives no REVOKE paste |
| Widened O-1 tripwire | ✅ every `.sql` from `git ls-files --cached --others --exclude-standard` outside the 3 dirs, `.claude/` excluded; floor > 20; no fallback if git fails (fails closed). CI: `actions/checkout@v4`, `fetch-depth: 2`, no container, so `ls-files` reads the index fine on a shallow clone; untracked files only matter locally. Runtime: ls-files about 1.3 s here on Windows (373 paths), far less on Linux, inside the 68 s headroom |
| **Ruling: read-only exemption** | ✅ **Acceptable.** Tripwire only, single-quoted-string F-2 only, and only when the FIRST statement is `SET default_transaction_read_only = on`. Probed: a later `CREATE ... SECURITY DEFINER` in such a file is still a pair (tripwire red), and a dollar-body F-2 is still raised |
| Runs | New file 84/84; `npm run test:authz-guard` 203/203 (63.5 s local); eslint clean; tsc `--strict` (ES2017) clean |

**Nits (not blocking)**
- N-1 `.github/workflows/admin-authz-guard.yml:53` still says the tripwire reads `scripts/*.sql`; it now reads every `.sql` outside the three directories. Update the comment.
- N-2 Read-only exemption: void it if a later statement turns writes back on (`SET default_transaction_read_only = off`, `SET TRANSACTION READ WRITE`, `BEGIN READ WRITE`). Tripwire files are never applied, so optional.

### Code Approved for QA: Yes

---

## QA Testing Report

**QA — 2026-10-08**
**Test mode:** targeted (clean-tree run + black-box mutation testing)
**Strategy used:** A (Jest guard run as-is) + C (temporary probe `.sql` files dropped into scanned directories, guard re-run, file deleted)
**Focus:** security, schema
**Skipped:** database (none needed: the guard is pure fs + string scan); r) was reasoned from code, not run (the test file is not edited by QA)
**Input source:** TL prompt

> **Revision tested:** the uncommitted tree as of this QA pass, which does **not** yet contain SA code-review fixes C-1 to C-3 (no string-span F-2, no `count` on allow-list F entries, no ROUTINE/PROCEDURE grant shapes). The results below hold for this revision; cases e, g, m and the R-d shapes should be re-run after Dev lands C-1 to C-3.

### Clean tree

`npm run test:authz-guard`: ✅ 2 suites, 178 tests pass (secdef suite 5.8 s, admin suite 35.4 s, 59.5 s jest total).

### Mutation results

Each probe was `supabase/migrations/29991231_qa_<case>.sql` (b, g, l in `supabase/held/`; tripwire in `scripts/zz_qa.sql`), run with `npx jest supabase/__tests__/security-definer-surface.guard.test.ts --ci`, then deleted.

| Case | Probe | Expected | Result | Message (abridged) |
|---|---|---|---|---|
| a | SECDEF, no revoke, no search_path | red | ✅ red | `public.qa_fn fails R-a, R-c` |
| b | revoke missing anon (held/) | red | ✅ red | `fails R-a` |
| c | revoke missing PUBLIC | red | ✅ red | `fails R-a` |
| d | revoke split over 3 statements | red (SA Q-2) | ✅ red | `fails R-a` |
| e | unqualified `ON FUNCTION qa_fn(...)` | red | ✅ red | `fails R-a` |
| f | compliant (pin + revoke + grant service_role) | green | ✅ green | 59/59 |
| g | compliant + later `GRANT ... TO anon` (held/) | red | ✅ red | `fails R-d` |
| h | compliant + later `GRANT ... TO authenticated` | green | ✅ green | 59/59 |
| i | revoke before the CREATE | red | ✅ red | `fails R-b` |
| j | `SECURITY DEFINER` after `LANGUAGE ... AS $$...$$` | detected | ✅ red | `fails R-a, R-c` (pair found) |
| k | `"MyFn"` created, revoke on bare `myfn` | red | ✅ red | `public.MyFn fails R-a` (quoted keeps case) |
| l | `BEGIN ATOMIC` body (held/) | red F-1 | ✅ red | `F-1 BEGIN ATOMIC body ...` |
| m | `DO $$ EXECUTE 'CREATE FUNCTION ... SECURITY DEFINER ...' $$` | red F-2 | ✅ red | `F-2 SECURITY DEFINER inside a dollar-quoted body` |
| n | `ALTER FUNCTION public.x() SECURITY DEFINER;` alone | red | ✅ red | `public.x fails R-a, R-c` |
| o | `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` | green | ✅ green | `REVOKE ALL` counts as R-a |
| p | no pin on CREATE, `ALTER FUNCTION ... SET search_path = public` after it | green | ✅ green | 59/59 |
| q1 | `private.qa_fn` created, revoke on `public.qa_fn` | red | ✅ red | `private.qa_fn fails R-a` |
| q2 | `private.qa_fn` created, revoke on `private.qa_fn` | green | ✅ green | own-schema rule holds |
| r | new-file entry added to baseline | red | ✅ by code | `freezeDateOf('…/29991231_…')` = `29991231` > `20261044`, so the freeze test fails; the equality cap (71 ≠ 70) also fails. A file named ≤ 20261044 would slip the date check: known limit K-3, the cap + review is the control |
| tripwire | `scripts/zz_qa.sql` with a SECDEF fn | red | ✅ red | `scripts/zz_qa.sql:1 defines public.qa_fn: bring this directory into SCAN_DIRS (Q-5)` |

### O-3 paste lines

- a: `REVOKE EXECUTE ON FUNCTION public.qa_fn(uuid, integer) FROM PUBLIC, anon, authenticated;` + `GRANT ... TO service_role;` + `ALTER FUNCTION public.qa_fn(uuid, integer) SET search_path = public, pg_temp;`. ✅ Valid SQL; the `DEFAULT 1` was stripped from the identity args correctly.
- j: `public.qa_fn(uuid)`. ✅ Correct.
- n: `public.x(<identity args>)` placeholder (no CREATE in the file). This is intended, and the hint tells the author to check prod.
- k: `public.MyFn(uuid)` is **not** correct SQL for that function. Unquoted, Postgres folds it to `myfn`. See Edge Case 1.

### Issues Found

#### Bugs (must fix before commit)
None in the tested scope. SA code-review items C-1 to C-3 are still open (see the revision note above).

#### Performance Issues
None. Rule tests take 3 to 13 ms. The O-1 tripwire test is the slowest at 382 to 747 ms (a recursive walk of `scripts/`). The suite takes about 6 s with the ts-jest transform, inside the existing `test:authz-guard` step.

#### Edge Cases (nice to fix)
1. **Paste line drops the quotes on a quoted name.** `describeViolation` prints `pair.fn` canonicalised (quotes stripped), so for `"MyFn"` the suggested `REVOKE ... public.MyFn(uuid)` would target `myfn` and still fail. Fix: re-quote any name part that is not all lower-case `[a-z_][a-z0-9_$]*`. File: `supabase/__tests__/security-definer-surface.guard.test.ts` (`describeViolation`). Severity: Low.
2. For an R-d failure, the paste suggests the REVOKE/GRANT pair but does not say to remove the offending GRANT. Severity: Low (wording only).

### Re-run after C-1..C-3 (2026-10-08)

**Revision tested:** the uncommitted tree after Dev's C-1 to C-3 and lows 4 to 7 (SA re-check APPROVED WITH NITS). Same method as above: each probe copied in, `npx jest supabase/__tests__/security-definer-surface.guard.test.ts --ci` run, the file deleted.

**Clean tree:** `npm run test:authz-guard` ✅ 2 suites, 203/203 (41.5 s jest total). The new file alone: 84/84.

| Case | Probe | Expected | Result | Message (abridged) |
|---|---|---|---|---|
| a to q2, tripwire | the 19 earlier cases, unchanged | as before | ✅ 19/19 same as before | a `R-a, R-c`; b, c, d, e `R-a`; f, h, o, p, q2 green; g `R-d`; i `R-b` (new wording: "move the REVOKE after the last CREATE"); j `R-a, R-c`; k `public.MyFn fails R-a`; l `F-1 BEGIN ATOMIC`; m `F-2 ... dollar-quoted body`; n `public.x fails R-a, R-c`; q1 `private.qa_fn fails R-a`; tripwire `scripts/zz_qa.sql:1 ... bring this directory into SCAN_DIRS` (now found via `git ls-files --others`) |
| C-1 DO | `DO 'BEGIN EXECUTE ''CREATE FUNCTION public.qa() ... SECURITY DEFINER ...''; END';` | F-2 | ✅ red | `F-2 SECURITY DEFINER inside a single-quoted string (DO block, AS body or dynamic DDL) cannot be checked` |
| C-1 AS | `CREATE FUNCTION public.mk() ... AS 'BEGIN EXECUTE ''... SECURITY DEFINER ...''; END';` | F-2 | ✅ red | same F-2 message, line 1 |
| C-1 COMMENT | `COMMENT ON TABLE ... IS '... security definer ...';` | green | ✅ green | 84/84 |
| C-2 ROUTINE | compliant + `GRANT EXECUTE ON ROUTINE public.qa_fn(uuid, integer) TO anon` | R-d | ✅ red | `fails R-d` + `remove the GRANT to PUBLIC/anon on line(s) 4` |
| C-2 `"public"` | compliant + `... TO "public"` | R-d | ✅ red | `fails R-d`, line 4 |
| C-2 `"PUBLIC"` | compliant + `... TO "PUBLIC"` | green (ordinary role) | ✅ green | 84/84 |
| C-2 schema list | compliant + `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions, public TO anon` | R-d | ✅ red | `fails R-d`, line 4 |
| C-2 odd shape | compliant + `GRANT USAGE, EXECUTE ON FUNCTION public.qa_fn(...) TO anon` | F-1 or R-d | ✅ red, **F-1** | `:4 F-1 GRANT on a routine in a shape the guard cannot read` (fails closed via the backstop) |
| low 4 | compliant + `ALTER FUNCTION public.qa_fn(uuid, integer) RESET search_path` | R-c | ✅ red | `fails R-c` + `paste: ALTER FUNCTION ... SET search_path = public, pg_temp;` |
| QA EC-1 | `public."MyFn"(p uuid)` SECDEF, no revoke, no pin | paste keeps quotes | ✅ | `paste: REVOKE EXECUTE ON FUNCTION public."MyFn"(uuid) FROM PUBLIC, anon, authenticated;` (also on the GRANT and ALTER lines) |
| QA EC-2 | any R-d case | says remove the GRANT, with its line | ✅ | `R-d: a later GRANT gives EXECUTE back to PUBLIC or anon: remove that GRANT` / `remove the GRANT to PUBLIC/anon on line(s) 4`, no REVOKE paste |

**Main moved on (rebase readiness).** `origin/main` is now `24d5ab6e` (#269), which contains `790e2ca8` (#267, #268). I copied in, temporarily, every `.sql` file main changed since `06b77d1b`. That covers `supabase/migrations/20261045_retire_crm_contact_created_trigger.sql` from #268 (DROP only). It also covers three things from #269: `supabase/migrations/20261046_operator_test_account_cleanup_notnull_order.sql`, `supabase/SQL Scripts/20261046_..._rollback.sql` (these two add `SECURITY DEFINER` functions) and the edits to `scripts/test-account-cleanup-{check,delete}.sql`. Result: ✅ 84/84 green. 20261045 alone was also run: ✅ 84/84. Afterwards every file was deleted or restored.

Edge cases from the first pass: EC-1 and EC-2 are fixed (rows above). No new bugs. SA nits N-1 (workflow comment line 53) and N-2 (read-only exemption toggle) belong to SA and were not re-tested.

### Final Status
- [x] All targeted mutation cases behave as specified: first pass 19/19 + r by code; re-run 19/19 unchanged + 11 new cases as expected. Clean tree green (203/203). Green against main's newer `.sql` files. Every temporary file deleted (`git status --short` shows only the slice's own changes).
- [x] Ready for commit: **yes** (after the user has seen the diff).

**Verdict: PASS.**

---

## Appendix A: measured baseline

Measured 2026-10-08 on `06b77d1b` by the prototype parser. 37 files, 70 (file, function) pairs. "No pin" counts the pairs that also lack `search_path`. Every pair fails R-a. `*` marks a pair that also fails R-c. Paths are relative to `supabase/`.

| File | Pairs | No pin | Functions |
|---|---|---|---|
| `migrations/2026-08-14_payment_automation_executions_claim.sql` | 2 | 0 | `claim_due_payment_automation_executions`, `reap_stale_payment_automation_executions` |
| `migrations/2026-08-14_payment_reminders_claim.sql` | 2 | 0 | `claim_due_payment_reminders`, `reap_stale_payment_reminders` |
| `migrations/20260615_add_organizations.sql` | 2 | 2 | `get_or_create_user_organization`*, `auto_set_agent_org_id`* |
| `migrations/20260629_enhance_behavior_rules.sql` | 3 | 3 | `record_behavior_rule_result`*, `match_behavior_rules`*, `auto_disable_ineffective_behavior_rules`* |
| `migrations/20260629_error_patterns_table.sql` | 2 | 2 | `upsert_error_pattern`*, `record_auto_fix_result`* |
| `migrations/20260629_execution_optimization_tables.sql` | 3 | 3 | `update_execution_baseline`*, `check_execution_anomaly`*, `record_execution_anomaly`* |
| `migrations/20260629_intent_examples_table.sql` | 3 | 3 | `upsert_intent_example`*, `find_similar_intent_examples`*, `record_intent_example_usage`* |
| `migrations/20260629_platform_learning_tables.sql` | 4 | 4 | `upsert_workflow_pattern`*, `record_global_failure`*, `get_similar_patterns`*, `get_active_failures`* |
| `migrations/20260629_plugin_performance_table.sql` | 1 | 1 | `upsert_plugin_performance`* |
| `migrations/20260722_create_contact_documents.sql` | 1 | 1 | `log_document_activity`* |
| `migrations/20260722_crm_contact_creation_activity.sql` | 1 | 0 | `log_crm_contact_created` |
| `migrations/20260723_enhance_payments.sql` | 1 | 1 | `update_overdue_installments`* |
| `migrations/20260726_enhance_website_tables.sql` | 2 | 2 | `check_subdomain_available`*, `generate_subdomain`* |
| `migrations/20260802_add_dismissed_setup_steps_to_business_profiles.sql` | 1 | 1 | `dismiss_setup_step`* |
| `migrations/20260824_add_conversion_layer.sql` | 1 | 1 | `increment_smart_link_click_count`* |
| `migrations/20260826_business_chat_plan_cache.sql` | 2 | 2 | `search_business_chat_plans_semantic`*, `record_business_chat_plan_outcome`* |
| `migrations/20260911_daily_briefing.sql` | 2 | 0 | `claim_due_daily_briefings`, `reap_stale_daily_briefings` |
| `migrations/20260914_lead_responses.sql` | 2 | 0 | `claim_due_lead_responses`, `reap_stale_lead_responses` |
| `migrations/20260915a_purge_schema_introspect.sql` | 1 | 0 | `purge_schema_introspect` |
| `migrations/20260917_insight_actions.sql` | 2 | 0 | `claim_due_insight_actions`, `reap_stale_insight_actions` |
| `migrations/20260918_promote_client_on_confirmed_booking.sql` | 1 | 1 | `promote_contact_on_confirmed_booking`* |
| `migrations/20260920_pipeline_transitions.sql` | 3 | 3 | `advance_contact_stage`*, `promote_contact_on_payment`*, `advance_contact_on_completed_booking`* |
| `migrations/20260920a_lock_system_settings_and_pricing_rls.sql` | 1 | 0 | `is_platform_admin` |
| `migrations/20260922_verified_questions.sql` | 2 | 0 | `match_verified_questions`, `increment_verified_question_uses` |
| `migrations/20260930_marketing_consent.sql` | 1 | 1 | `marketing_consent_project`* |
| `migrations/20260931_business_subscribers.sql` | 1 | 1 | `link_subscriber_to_contact`* |
| `migrations/20261003_codify_create_user_settings_trigger.sql` | 1 | 1 | `create_user_settings`* |
| `migrations/20261005_auth_handoff_codes.sql` | 1 | 0 | `claim_auth_handoff_code` |
| `migrations/20261006_business_event_triggers.sql` | 5 | 0 | `record_business_event`, `tg_booking_events`, `tg_invoice_events`, `tg_transaction_events`, `tg_proposal_events` |
| `migrations/20261006c_close_remaining_event_gaps.sql` | 7 | 0 | `tg_page_view_events`, `tg_contact_events`, `tg_activity_reply_events`, `tg_service_events`, `tg_booking_events`, `tg_invoice_events`, `tg_proposal_events` |
| `migrations/20261013_business_os_invite_existing_account.sql` | 1 | 0 | `business_os_auth_email_has_account` |
| `SQL Scripts/20251030_create_audit_log_function.sql` | 1 | 1 | `insert_audit_log`* |
| `SQL Scripts/20251117000003_add_execution_quotas.sql` | 1 | 1 | `increment_executions_used`* |
| `SQL Scripts/20251117_complete_quota_system.sql` | 2 | 2 | `update_user_storage_used`*, `increment_executions_used`* |
| `SQL Scripts/20260129_add_advisory_lock_functions.sql` | 2 | 2 | `pg_try_advisory_lock`*, `pg_advisory_unlock`* |
| `SQL Scripts/20260601_fix_execution_insights_schema.sql` | 1 | 1 | `get_top_insights`* |
| `held/20260916b_purge_business_data.sql` | 1 | 0 | `purge_business_data` |
| **Total (37 files)** | **70** | **40** | |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-08 | Created (Dev) | Slice 6 workplan. Host job, required-check status and skip rule read; runtime measured on 7 PR runs (guard step 7 to 10 s, at least 68 s headroom before Build); prototype lexer run over 310 `.sql` files: 77 SECDEF pairs, 70 non-compliant in 37 files (62/31 migrations, 7/5 SQL Scripts, 1/1 held), 0 unparseable. Rule R-a to R-d, frozen baseline with equality cap and frozen-through date, empty typed allow-list, 21 fixtures, block-proof steps. 6 open questions for SA |
| 2026-10-08 | SA workplan review | APPROVED WITH CONDITIONS W-1 to W-6 (identifier canonicalisation, `;` in quoted identifiers, `BEGIN ATOMIC` as F-1, string prefixes, clause matching incl. after the body, block-proof safety). Q-1 to Q-6 ruled as Dev proposed. Required-check, strict and enforce_admins status confirmed via the branch-protection API. Runtime confirmed. Requirement FR-6 and C-5 wording on the Jest gate corrected |
| 2026-10-08 | SA workplan review | APPROVED WITH CONDITIONS W-1 to W-6; Q-1 to Q-6 ruled as Dev proposed; optional O-1 to O-3 |
| 2026-10-08 | SA conditions folded in; implementation T-4 to T-9 (Dev) | W-1 one identifier canonicalisation, bare PUBLIC only; W-2 `;` in quoted identifiers; W-3 BEGIN ATOMIC is F-1; W-4 string prefixes; W-5 trailing clauses, EXTERNAL, FROM CURRENT, later SECURITY INVOKER; W-6 no auto-apply path in the repo, probe moved to `supabase/held/`. Taken: O-1 tripwire over seeds, tests, functions and scripts; O-2 freeze date from the first 8 digits, fails closed; O-3 paste-ready fix lines. `supabase/__tests__/security-definer-surface.guard.test.ts` (59 tests) wired into `test:authz-guard` (178/178); workflow header comments only. eslint, tsc, purge and Tailwind guards clean. Left uncommitted for SA code review |
| 2026-10-08 | SA code review (T-10) | FIX REQUIRED: C-1 single-quoted `DO '...'` / `AS '...'` bodies evade F-2; C-2 R-d misses `ON ROUTINE/PROCEDURE`, quoted `"public"` (is the pseudo-role), multi-schema and `GRANTED BY` grants; C-3 allow-listed F-findings need an exact count. Low: RESET search_path, quote-aware split, F-3 line, R-b wording. Tests, eslint, tsc, workflow, Tailwind exclusion verified |
| 2026-10-08 | SA code-review fixes (Dev) | C-1 single-quoted SECURITY DEFINER is F-2 (COMMENT ON exempt; read-only scripts exempt in the tripwire only); C-2 ROUTINE/PROCEDURE, quoted "public", schema lists, GRANTED BY, F-1 backstop; C-3 exact-count finding allowances; lows 4 to 7; QA quoting and R-d wording; tripwire widened to every .sql outside the three directories. 84 tests in the new file, 203/203 in test:authz-guard; eslint and tsc clean. QA report kept as written. Awaiting SA re-check |
| 2026-10-08 | SA code re-check (T-9b) | APPROVED WITH NITS: C-1 to C-3, lows 4 to 7, QA quoteIdent / R-d text and the git ls-files tripwire verified by probe; read-only-script exemption ruled acceptable (tripwire only, string F-2 only; a later SECDEF CREATE is still a pair). 84/84, 203/203, eslint and tsc clean. Nits: workflow comment line 53; void the exemption on a later read-write toggle |
| 2026-10-08 | QA re-run after C-1 to C-3 | PASS. test:authz-guard 203/203; 19 earlier mutation cases unchanged; 11 new as expected (single-quoted DO/AS F-2, COMMENT ON green, ROUTINE / "public" / schema-list R-d, "PUBLIC" green, USAGE+EXECUTE F-1, RESET search_path R-c, quoted paste line, R-d remove-the-GRANT text). Green with main's newer .sql files (#268 20261045, #269 20261046 pair). Ready for commit: yes |
