# Workplan: Test-account cleanup — inbound FK drift guard (Jest)

> **Last Updated**: 2026-10-30

**Developer:** Dev
**Requirement:** [TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_REQUIREMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_REQUIREMENT.md) (SA: APPROVED WITH CONDITIONS, SA-1..SA-8)
**Branch:** written in worktree `claude/determined-tu-5450e6` (main at `b896d382`, **without** PR #580). Per SA-8 / Landing Order, RM cuts the real branch (suggested `feature/test-account-cleanup-inbound-fk-guard`) from `main` **after #580 merges** and carries these four files over. Not stacked on #580.
**Date:** 2026-10-30
**Status:** Code Complete, SA code review fixes 1–3 done (uncommitted). Red on this tree by design (AC-9). Awaiting SA delta re-review, then QA.

## Overview

A Jest guard in the existing `test:gate` replays every `supabase/migrations/*.sql` statically and fails a PR that leaves a foreign key into a cleanup-plan table unreviewed in `INBOUND_FOREIGN_KEYS`, the condition under which runtime guard G-18 blocks every check, hard delete and anonymise on prod. On this tree (main without #580) it is red on exactly one FK, `scheduling_meetings_replaces_meeting_id_fkey`, and green once #580's one `INBOUND_FOREIGN_KEYS` line is present.

## Table of Contents

- [Files and module API](#files-and-module-api)
- [Implementation approach](#implementation-approach)
- [Measured history (SA condition 2)](#measured-history-sa-condition-2)
- [Proposed exception entries (SA-4)](#proposed-exception-entries-sa-4)
- [Live checks owed (TL)](#live-checks-owed-tl)
- [G-10 measurement (SA-1, condition 4)](#g-10-measurement-sa-1-condition-4)
- [Red on main without #580 (AC-9, SA-8)](#red-on-main-without-580-ac-9-sa-8)
- [Green with #580 (AC-8)](#green-with-580-ac-8)
- [Timing (SA-7)](#timing-sa-7)
- [Typecheck](#typecheck)
- [Code review fixes (SA code review 1–3)](#code-review-fixes-sa-code-review-13)
- [Known limits and decisions](#known-limits-and-decisions)
- [Task list](#task-list)
- [SA Review Notes](#sa-review-notes)
- [SA Code Review](#sa-code-review)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Files and module API

| File | Action | Reason |
|---|---|---|
| `scripts/lib/migrationForeignKeys.ts` | create | SA-3 pure module: own tokenizer + FK replay. No `fs`, no DB |
| `scripts/__tests__/migrationForeignKeys.test.ts` | create | Unit tests: every SA-5 rule + tokenizer edge cases (47 tests) |
| `scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts` | create | The guard, the SA-4 exception lists, the check function, the negative controls (23 tests) |
| `docs/workplans/TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_WORKPLAN.md` | create | This file |

**Not changed (SA condition 6):** `scripts/generate-test-account-cleanup-sql.ts` (sha256 `c3d5b751…abf91` before and after), any generated file, any migration, `scripts/__tests__/testAccountCleanupSql.test.ts`, `jest.gate.config.js`, any workflow.

**Module API** (`scripts/lib/migrationForeignKeys.ts`):

| Export | Purpose |
|---|---|
| `interface MigrationFile { file; sql }` | Input, already CRLF-normalised by the caller |
| `tokenize(sql): { tokens: Token[]; error: TokenizeError \| null }` | Token kinds `word` (lower-cased) / `ident` (quoted, as written) / `string` / `dollar` (body) / `comment` / `punct` / `other`. Nested `/* */`, `E''` backslash escapes, `N''`/`B''`/`X''`/`U&''`, `""` escapes, `$tag1$` tags with digits, `$1` params. Never throws: unterminated comment / string / identifier / dollar body sets `error` |
| `replayMigrations(files, adjustments?): ReplayResult` | Replays in `compareFileNames` order. Returns `foreignKeys` (as they stand after the last file), `problems` (unterminated, unattributed FK syntax; file + line), `dynamic` (FK syntax in a string or non-DO dollar body; file + line + excerpt), `unmatched` (adjustments that found nothing) |
| `type ReplayAdjustment` | `inject` (add an FK), `rename` (constraint), `remove` (constraint), each applied right after its file's own statements. This is how the guard's SA-4 entries enter the replay |
| `interface ForeignKey` | `file, line, childSchema, childTable, childColumns, parentSchema, parentTable, parentColumns (null = PK), constraint, origin ('static' \| 'injected')` |
| `defaultForeignKeyName(table, cols, taken?)` / `makeObjectName(n1, n2, label)` | Postgres `ChooseForeignKeyConstraintNameAddition` + `makeObjectName` (63 bytes, longer part shortened, column part on a tie, multibyte-safe) + `_fkeyN` collision suffix |
| `compareFileNames(a, b)` | Plain code-unit order (SA-5.1) |

**Guard-internal (test file only):** `DYNAMIC_FK_MIGRATIONS`, `LIVE_NAME_ALIASES`, `NOT_ON_PROD`, `NEVER_EXCEPTED`, `checkInboundForeignKeys(input)` and `describeFailure(result)`. The guard and every negative control call the same `checkInboundForeignKeys`.

---

## Implementation approach

- **Replay (SA-5).** Statements split at `;` tokens. Recognised: `CREATE [modifiers] TABLE [IF NOT EXISTS]` (inline `REFERENCES`, `[CONSTRAINT n] FOREIGN KEY`), `ALTER TABLE [IF EXISTS] [ONLY]` (comma-separated `ADD [COLUMN] [IF NOT EXISTS]`, `ADD [CONSTRAINT n] FOREIGN KEY`, `DROP CONSTRAINT [IF EXISTS]`, `DROP [COLUMN] [IF EXISTS] [CASCADE]`, `RENAME CONSTRAINT`, `RENAME [COLUMN]`, `RENAME TO`), `DROP TABLE [IF EXISTS] a, b [CASCADE]`. `DO` bodies are re-tokenized and run as DDL; there the DDL may follow `IF … THEN` at paren depth 0. `RENAME TO` also moves FKs that point **at** the table (they follow the OID). `DROP COLUMN … CASCADE` also drops FKs that reference that parent column.
- **Fail closed.** Any `FOREIGN KEY` or `REFERENCES <name>` (not `REFERENCES ON`, not `REFERENCES,`) in code that no recognised statement claimed is an `unattributed` problem. `CREATE TABLE IF NOT EXISTS` on a known table and a skipped `ADD COLUMN IF NOT EXISTS` claim their FK syntax without adding it.
- **Dynamic detection (SA-4), token-based.** A string token anywhere (top level or DO body, except `COMMENT ON … IS`) or the code/strings of a non-DO dollar body (function bodies, recursively) is dynamic when it matches `FOREIGN KEY (`/`%`, or `REFERENCES <name|%I|"q">[.<name>]` followed by `(`, end of string, `,`, `)`, `ON DELETE/UPDATE`, `NOT VALID`, `DEFERRABLE`, `MATCH` or `INITIALLY`. `EXECUTE FUNCTION`, `GRANT … REFERENCES, …`, `REVOKE REFERENCES ON`, and prose like `'… references the agents table'` do not match.
- **Check (SA-6).** In scope: replayed FKs whose parent is `public.<table of buildCleanupPlan('hard')>`. Pass iff `childSchema = 'public'` and `(childTable, constraint)` ∈ `INBOUND_FOREIGN_KEYS`. Width ≠ 1 is reported separately whatever the review says. `PARENT_OWNED_REASONS` is not re-checked (already pinned by `testAccountCleanupSql.test.ts`). One direction only, stated in the guard header.
- **Speed (SA-7).** Char-code tokenizer, linear block-comment scan (an earlier `indexOf('/*')` version was quadratic), and a whole-word `\breferences\b|\bforeign\b` prefilter before re-tokenizing a function body: the 11 generated cleanup functions are 140–340 kB each and every one contains `user_preferences`.

---

## Measured history (SA condition 2)

Measured on this tree (291 `.sql` files, 4.0 MB, main `b896d382`):

| Measure | Count |
|---|---|
| FKs standing after the static replay (all parents) | 213 |
| …of which into a cleanup-plan table (static only) | 109 |
| …passing `INBOUND_FOREIGN_KEYS` directly | **107** |
| …failing | 2: `fk_payment_invoices_service` (alias, below) and `scheduling_meetings_replaces_meeting_id_fkey` (the #580 FK, never excepted) |
| Dynamic FK SQL found | 1 place: `20260916_business_data_ownership.sql:205` (the `business_owned` loop). Nothing else, at any depth |
| Unattributed FK syntax / unterminated text | 0 / 0 |
| Multi-column FKs into a plan table | 0 |
| Dynamic expansion injected (SA-4a) | 63 constraints `<t>_business_fk`; 57 new names (6 already declared statically by their own table's migration, same name); 61 reviewed, 2 not (`websites`, `insight_outcomes`, below) |
| **Final in-scope FKs, exceptions applied** | **164**: 163 pass, 1 fails (`scheduling_meetings_replaces_meeting_id_fkey`) |
| With #580 | 164 / 164 pass |

For information (one-direction rule, not an error): 40 `INBOUND_FOREIGN_KEYS` entries have no counterpart in the repo replay — tables or links created outside migrations (the agent / calibration / execution family, `sla_events`, `shared_agent_imports`, …). They stay G-18's runtime job.

---

## Proposed exception entries (SA-4)

Four entries (threshold ~10 not reached). SA reviews each one.

| # | Kind | Entry | Reason / evidence |
|---|---|---|---|
| E-1 | `DYNAMIC_FK_MIGRATIONS` | `20260916_business_data_ownership.sql`, sha256 `6d9cad766e5ce3655df454153975af7a637e7ffe11ce5d17ae15a6bcc303a7f6` (CRLF-normalised), expands the 63 tables of `business_owned` (copied by hand, in order, in `BUSINESS_OWNED_20260916`) to `<t>.user_id -> business_profiles` constraint `<t>_business_fk` | The only dynamic FK SQL in the repo (`EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id) …')`, line 204–206). `format()` not evaluated (SA-4 (c) rejected). **Maintenance note:** this file is edited whenever a business-owned table joins the array (`lib/business-os/__tests__/businessOwnedTables.test.ts` parses it; last edit `66767d74`), so the sha256 pin will turn the guard red on such PRs until the array copy and sha are updated. That is the re-review SA asked for. |
| E-2 | `LIVE_NAME_ALIASES` | `20260809214450_add_service_id_to_invoices.sql`, child `payment_invoices`, `fk_payment_invoices_service` → `payment_invoices_service_id_fkey` | The repo never drops or renames `fk_payment_invoices_service` (SA probe). `INBOUND_FOREIGN_KEYS` reviews `payment_invoices_service_id_fkey`, measured on prod 2026-10-06 with `purge_schema_introspect`. G-18 has passed on prod since (stamps up to `792d801e13101316`), which it could not do if an unreviewed `fk_payment_invoices_service` existed. ✅ **Live check 2026-10-30 (TL, prod jgccgkyhpwirgknnceoh): confirmed.** |
| E-3 | `NOT_ON_PROD` | `20260916_business_data_ownership.sql`, child `websites`, `websites_business_fk` | No migration creates `public.websites`; the 20260916 loop skips an absent table (`to_regclass … IS NULL → CONTINUE`), so the constraint was never created. G-18 passes on prod with it unreviewed. ✅ **Live check 2026-10-30 (TL, prod jgccgkyhpwirgknnceoh): confirmed.** |
| E-4 | `NOT_ON_PROD` | `20260916_business_data_ownership.sql`, child `insight_outcomes`, `insight_outcomes_business_fk` | `20261006g_insight_measurements.sql` header: "`public.insight_outcomes` DOES NOT EXIST". Same loop skip. G-18 passes on prod with it unreviewed. ✅ **Live check 2026-10-30 (TL, prod jgccgkyhpwirgknnceoh): confirmed.** |

`scheduling_meetings_replaces_meeting_id_fkey` is on **no** list; `NEVER_EXCEPTED` makes the guard fail if any list ever names it (SA-8).

Alternative for E-3/E-4 that SA may prefer: drop `websites` and `insight_outcomes` from the hand expansion instead of listing them as NOT_ON_PROD. I kept the expansion faithful to the array and put the absence on the explicit, stale-checked list, because a silent omission from a 63-line copy is easier to miss in review.

---

## Live checks owed (TL)

Read-only, per the `business-os-schema-check` skill. Run on prod; paste the result into the reasons of E-2..E-4 (replacing "LIVE CHECK OWED (TL)" with the date and result) before merge.

**TL result, 2026-10-30 (read-only, prod):** exactly as expected: one row `payment_invoices_service_id_fkey | payment_invoices | scheduling_services`; `to_regclass` NULL for both `websites` and `insight_outcomes`. The same query also showed `scheduling_meetings_replaces_meeting_id_fkey` is live on prod, so the G-18 block is real there until #580 is merged and 20261101 applied.

```sql
SELECT con.conname,
       rel.relname  AS child_table,
       frel.relname AS parent_table
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class      AS rel  ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace  AS nsp  ON nsp.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_class AS frel ON frel.oid = con.confrelid
WHERE con.contype = 'f'
  AND nsp.nspname = 'public'
  AND con.conname IN (
    'fk_payment_invoices_service',
    'payment_invoices_service_id_fkey',
    'websites_business_fk',
    'insight_outcomes_business_fk'
  )
ORDER BY con.conname;

SELECT to_regclass('public.websites') AS websites,
       to_regclass('public.insight_outcomes') AS insight_outcomes;
```

**Expected:** exactly one row, `payment_invoices_service_id_fkey | payment_invoices | scheduling_services`; both `to_regclass` NULL. Any other result means the matching entry is wrong and must not merge as written.

---

## G-10 measurement (SA-1, condition 4)

Same replay, FKs whose parent is `auth.users` and whose child schema is not `auth`, checked by `(schema, table, first column)` against `tenancyForeignKeys() ∪ ACTOR_FOREIGN_KEYS` (the key G-10 uses, `conkey[1]`):

| Measure | Result |
|---|---|
| FKs into `auth.users` standing after the replay | 89 |
| Reviewed | 89 |
| Exception entries G-10 would need | **0** (threshold ≤ 5: met) |
| Real unreviewed live FK found | **none** (threshold "no gap": met) |

Both SA-1 thresholds are met. SA code review comment 3 ruled that G-10 **joins this slice**, and it is now in the guard as a second pass over the same `replay.foreignKeys` (see [Code review fixes](#code-review-fixes-sa-code-review-13)). **Re-measured after the change, in-process under Jest: 89 into `auth.users`, 89 reviewed, 0 wider than one column.** The guard's red on this tree has no G-10 section.

---

## Red on main without #580 (AC-9, SA-8)

`node_modules/.bin/jest scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts` on this tree, verbatim (Jest marks trailing blank lines with `·`):

```text
  ● test-account cleanup: every FK into a cleanup-plan table is reviewed (G-18 at PR time) › finds no unreviewed, multi-column or unreadable foreign key

    expect(received).toBe(expected) // Object.is equality

    Expected: ""
    Received: "Unreviewed foreign key into a cleanup-plan table — G-18 will block every
    check, delete and anonymise on prod once this migration is applied.·
      20261097_a_session_knows_what_it_replaced.sql: public.scheduling_meetings.replaces_meeting_id
        -> public.scheduling_meetings  (constraint scheduling_meetings_replaces_meeting_id_fkey)·
    Fix in scripts/generate-test-account-cleanup-sql.ts:
      1. Add [child_table, constraint_name, owner_column | null] to INBOUND_FOREIGN_KEYS
         (null owner -> add a PARENT_OWNED_REASONS entry with the reason).
      2. Bump FUNCTION_MIGRATION as the comment block above it describes.
      3. Run: npx tsx scripts/generate-test-account-cleanup-sql.ts and commit the output.
      4. Ship the regenerated function as that new migration; never edit one already applied."

      at Object.<anonymous> (scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts:386:37)

Tests:       1 failed, 22 passed, 23 total
```

Exactly one offender, the #580 FK. Lines 1–3 of the procedure are the FR-7 wording; line 4 adds the "new migration, never edit an applied one" rule from the TL brief.

---

## Green with #580 (AC-8)

Without changing branch:

1. Generator sha256 before: `c3d5b7513a3c2f9cae31a14e486494516f2aaff110ee51a283e59d3af10abf91`.
2. Added the one line from `git show origin/fix/cleanup-g18-meeting-replaces:scripts/generate-test-account-cleanup-sql.ts` (line 650): `['scheduling_meetings', 'scheduling_meetings_replaces_meeting_id_fkey', 'user_id'],` after `scheduling_meetings_business_fk`.
3. Guard: `PASS … Tests: 23 passed, 23 total`.
4. Removed the line. sha256 after: `c3d5b751…abf91` (identical); `git diff --stat` empty for tracked files.

Supplementary (no repo change): a scratch replay of this tree **plus** #580's new migration `20261101_operator_test_account_cleanup_meeting_replaces.sql` (from `git show`), with the four exceptions and `INBOUND_FOREIGN_KEYS` + the #580 entry: 292 files, 164 in scope, 0 unreviewed, 0 problems, 0 unmatched exceptions, dynamic only `20260916…:205` (pinned). So #580's generated function file adds no FK syntax the guard trips on.

---

## Timing (SA-7)

Three runs each, local Windows machine shared with other sessions' node processes.

| Measure | Result |
|---|---|
| Replay alone (plain node via tsx, cold / warm) | ~370 ms / ~110–180 ms |
| Guard's own work inside Jest, measured in-process (generator import + read 291 files + replay + plan) | **714 / 739 / 1127 ms** (import 105–164, read 136–427, replay 406–457, plan 54–79) |
| Jest wall time, guard file | 4.57 / 4.71 / 4.87 s |
| Jest wall time, unit-test file | 3.73 / 4.01 / 4.50 s |
| Jest wall time, an **empty** one-assertion test file, same runs | 3.75 / 4.20 / 4.89 s |

The guard's own work is under the 2 s budget. Jest's per-file wall time on this machine is ~4 s even for an empty file (worker start + ts-jest), so the guard adds well under a second to it, inside the noise. **SA to rule** whether "measured local time of the guard file" means the work (≈0.7–1.1 s, under budget) or the Jest wall figure (≈4.6–4.9 s, of which ≈4 s is the empty-file floor). No new job, step or config: `jest.gate.config.js` already collects both files.

---

## Typecheck

| Run | Result |
|---|---|
| Full project: `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit -p tsconfig.json` (`**/*.ts` includes `scripts/`) | Completed (37 min on the loaded machine, exit 2, **no OOM / V8 trace**). 1922 pre-existing errors, 619 of them under `scripts/`; `grep -E "migrationForeignKeys\|InboundFk"` → **0** |
| Scoped: repo `tsconfig.json` extended, `files` = the three new `.ts` files (pulls in the generator and its imports) | 24 s, 1 error, in pre-existing `lib/types/plugin-types.ts` (React namespace; an artefact of narrowing `types` to jest + node). **0** in the new files |

Strict mode, no `any`, no `console.*` in any new file.

---

## Code review fixes (SA code review 1–3)

Delta for SA's re-review. Comment 4 was fixed by SA, and TL's live-check text in E-2..E-4 is kept as edited.

| # | Fix | Where | Tests |
|---|---|---|---|
| 1a | **Adjacent constants.** `tokenize` joins string constants separated only by whitespace (and `--` comments) holding a newline, the lexer's `quotecontinue` rule. A joined token carries `pieces` (text index → file offset), so a hit is reported at the line where the FK syntax starts. | `continuedQuote`, string branch of `tokenize`, `Token.pieces` | probe (a), plus 3 continuation tests (joins incl. `--`, E-string escapes kept, unterminated continuation fails) |
| 1b | **`\|\|` chains.** `stringChains` reads each `'a' \|\| x \|\| 'b'` chain as one text. A non-literal operand stands in as `%s`, ending at depth-0 `\|\|`, `,`, `;`, `)` or a clause word. This runs for statements and DO bodies (`statement()`, except `COMMENT ON`) and for function bodies (`scanDynamic()`). | `stringChains`, `chainOffset`, `scanChains` | probe (b): excerpt is `… FOREIGN KEY (c) REFERENCES %s(id)` |
| 1c | **Positional specifiers.** `NAME_PART` accepts `%(?:\d+\$)?[IiLsS]`. | `NAME_PART` | probe (c) |
| 1d | **`;` ending.** Added to the terminators after `REFERENCES <name>`. | references pattern | probe (d) |
| — | **Not loosened:** whole-word REFERENCES / FOREIGN KEY in a string still does not count (SA's ~40 false hits). | — | control: one-line `'a' 'b'`, a prose `\|\|` chain and `GRANT REFERENCES` give no hit |
| 2 | **`ALTER TABLE … SET SCHEMA s`.** `moveTable` (it replaces `renameTable`) moves the table key, its own FKs (a self-reference at both ends), its columns, and every FK pointing at it. RENAME TO uses the same path. | `alterTable`, `moveTable` | 2 tests: the move itself, and a later `DROP CONSTRAINT` under the new schema |
| 3 | **G-10 pass.** Filter: `parentSchema 'auth' && parentTable 'users' && childSchema !== 'auth'`. Key: `(childSchema, childTable, childColumns[0])`, checked against `tenancyForeignKeys() ∪ ACTOR_FOREIGN_KEYS` (`LOGIN_LINKS_REVIEWED`, passed in as `loginLinksReviewed`). Width ≠ 1 is reported separately, as G-10's `fk_rows.key_width <> 1` blocks. Each kind has its own FR-7-style section naming every offender, the generator, both ways to review (plan table → `tenancyForeignKeys()`, or an `ACTOR_FOREIGN_KEYS` entry), the `FUNCTION_MIGRATION` bump and the regenerate command. | guard: `checkInboundForeignKeys`, `describeFailure` | 6 controls: probes valid, unreviewed reported with procedure, every offender listed, tenancy + actor reviewed pass, `auth`-schema child ignored, multi-column width message |

**Re-verification on the real migrations (after all fixes):**

| Measure | Result |
|---|---|
| Dynamic hits | **exactly one: `20260916_business_data_ownership.sql:205`**. It is now judged as the joined text `ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id) ON DELETE CASCADE NOT VALID`, and the line is still the one where `FOREIGN KEY` sits. |
| Static replay | unchanged: 213 FKs, 109 into plan tables, 107 reviewed, 0 problems |
| G-10 | 89 / 89 reviewed, 0 multi-column |
| SA's other probes | `setschema` now gives `other.k`. `notnull` (`'… REFERENCES crm_contacts NOT NULL'` in a string) is **still not flagged**: it is not among shapes (a)–(d), and I did not widen the terminators without a ruling. **SA to decide** whether `NOT NULL` / `NULL` / `DEFAULT` should become terminators. |

**Tests after the fixes:** unit 57 / 57 (+10). Guard 28 / 29 (+6 G-10 controls), and the 1 failure is the AC-9 red on `scheduling_meetings_replaces_meeting_id_fkey` alone. With the #580 line applied in place the guard is 29 / 29; the line was then removed and the generator sha256 is still `c3d5b751…abf91`. `testAccountCleanupSql.test.ts` 217 / 217. All three together: 302 passed, 1 failed (the expected red), 303 total. The failing assertion is now at guard line 459, not 386.

**Timing after the fixes** (in-process under Jest: import + read + replay + plan + G-18/G-10 filters): **613 / 636 / 647 ms** (import 69–80, read 94–124, replay 392–420, check 40–51).

**Typecheck after the fixes:** the scoped run (the three new files with their imports) has **0** errors in the new files. The one error is the same pre-existing `lib/types/plugin-types.ts` artefact as before.

---

## Known limits and decisions

| # | Item |
|---|---|
| K-1 | **One direction** (SA-6): FKs only on prod are invisible; 40 reviewed entries have no repo counterpart. G-18 stays the runtime net. |
| K-2 | **Default-name collisions** are modelled per table (SA-5.5 as written). Postgres checks the whole schema; the two differ only when a truncated name collides with another table's constraint. |
| K-3 | A string literal that **ends** in `references <name>` is flagged as dynamic on purpose (it may be the first half of a concatenated FK). No migration does this today; the false positive is fail-closed. |
| K-4 | `search_path` is assumed `public` for unqualified names (SA-5.2). |
| K-5 | Dynamic-SQL file pin: any edit to `20260916_business_data_ownership.sql` turns the guard red until the expansion and sha256 are re-reviewed (see E-1). |

---

## Task list

- ✅ Read requirement + SA review, generator (G-10 / G-18 SQL, the reviewed arrays, `buildCleanupPlan`), existing cleanup test, `jest.gate.config.js`
- ✅ `scripts/lib/migrationForeignKeys.ts`: tokenizer, names, replay, adjustments
- ✅ Measured the history before writing any exception (109 static in scope / 107 pass; 4 entries total, under the ~10 stop line)
- ✅ Unit tests `scripts/__tests__/migrationForeignKeys.test.ts` (every SA-5 rule; nested comment, `E'\''`, `$fn1$`, quoted identifier with `--`; each unterminated kind; >63-byte names)
- ✅ Guard `scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts` with E-1..E-4 and `NEVER_EXCEPTED`
- ✅ Negative controls: AC-10, AC-12, AC-13, AC-14 (DO + function body), AC-15, stale alias / not-on-prod / dynamic, sha256 drift, multi-column, `DROP TABLE … CASCADE` (child and parent), unterminated text, SA-8 forbidden entry
- ✅ G-10 measurement (89 / 89 reviewed, 0 exceptions, 0 gaps)
- ✅ Red on this tree, captured verbatim (only the #580 FK)
- ✅ Green with the #580 line applied in place, then reverted; generator byte-identical
- ✅ `testAccountCleanupSql.test.ts` unchanged and green (217 / 217)
- ✅ Performance pass (quadratic comment scan removed, body prefilter)
- ✅ TL: the live checks for E-2..E-4, then their reasons updated (2026-10-30)
- ✅ SA: code review, exception list entry by entry (E-1..E-4 approved); G-10 ruled in
- ✅ SA comment 1: adjacent constants, `||` chains, `%n$I`, `;` (4 unit tests + continuation tests); dynamic still only `20260916…:205`
- ✅ SA comment 2: `ALTER TABLE … SET SCHEMA` followed (2 unit tests)
- ✅ SA comment 3: G-10 pass in the guard + 6 negative controls; re-measured 89 / 89; requirement SA-1 outcome recorded
- ✅ Re-run: unit 57 / 57, guard 28 / 29 (expected red only), cleanup 217 / 217; green with #580 re-proven; re-timed 613–647 ms
- ✅ SA: delta re-reviewed; `NOT NULL` and other column-constraint endings added by SA (R-0, 8 tests)
- ✅ SA R-1: EXECUTE backstop (a statement that runs EXECUTE, not EXECUTE FUNCTION/PROCEDURE, with a whole-word FOREIGN KEY / REFERENCES string is dynamic), `::type` casts skipped in `stringChains`, out-of-reach note in the module header, 3 unit tests (cast chain, `concat()`, backstop controls). Real migrations: dynamic still only `20260916…:205`; guard red still only the #580 FK. Unit 68/68, guard 28/29, cleanup 217/217
- ⬜ QA
- ⬜ RM: branch from main after #580 merges (SA-8); red output into the PR description

---

## SA Review Notes

See [SA Code Review](#sa-code-review) below.

## SA Code Review

**Code Review by SA — 2026-10-30**
**Status:** 🔄 Fix Required. The fixes are narrow. The architecture, the replay, the exception list and the check are approved as built. SA re-reviews only the delta.

**What SA ran and checked**
- Both test files: unit tests 47/47; guard 22/23. The one failure is the expected AC-9 red on `scheduling_meetings_replaces_meeting_id_fkey` (20261097). Output matches the verbatim block above and the FR-7 wording.
- **E-1 copy verified.** The `business_owned` array was extracted from `20260916_business_data_ownership.sql` (comments stripped) and diffed against `BUSINESS_OWNED_20260916`. Result: 63 = 63, identical in order. The sha256 of the CRLF-normalised file is `6d9cad76…a7f6`, which matches the pin.
- **Default names vs Postgres.** `makeObjectName` matches PG for overhead, byte budget, and the rule "shorten the longer part, name2 on a tie", then `pg_mbcliplen`. `ChooseForeignKeyConstraintNameAddition` matches too: each name is clipped to 63 and the loop stops at `buflen >= NAMEDATALEN`. The `_fkeyN` suffix follows `ChooseConstraintName`'s `label + ++pass`. The per-table collision scope (K-2) is accepted.
- **Replay of DROP / RENAME.** `DROP CONSTRAINT [IF EXISTS]`, `RENAME CONSTRAINT`, `DROP COLUMN [CASCADE]`, `RENAME COLUMN`, `RENAME TO` (parent references follow the table) and `DROP TABLE` (own FKs plus inbound FKs) all match SA-5.6.
- **One path for guard and controls.** The guard and every negative control call the same `checkInboundForeignKeys`, and through it the same `replayMigrations`. No control re-implements the check. Confirmed.
- **Stale detection.** The dynamic entry fails when its file is missing or holds no dynamic SQL. An alias or not-on-prod entry fails when it matches nothing after its file. `NEVER_EXCEPTED` fails the check from inside the function, and the guard asserts it again. Correct.
- **Tokenizer, static path.** No false-green path found. Comments, strings, E-strings, quoted identifiers, nested comments and dollar tags lex as Postgres lexes them, `AS$$` included. Every FK token that no recognised statement claims becomes `unattributed`, and the skipped `IF NOT EXISTS` forms claim their tokens only when Postgres would skip them. A BOM or NBSP inside a statement fails closed, or matches Postgres, which would reject that SQL anyway.
- **Hyphenated `2026-08-14_*` files sort first (SA-5.1).** `drop_payment_methods` replays before `20260722` creates the table, so the replay holds more than prod does. That is the safe direction. None of these files does a `CREATE TABLE` that could shadow a later one.
- **Style.** No `console.*` and no `any`. The comment density matches `testAccountCleanupSql.test.ts`. Generator, migrations and configs untouched (`git status`).

### Code Review Comments

1. **`scripts/lib/migrationForeignKeys.ts:349-359`: dynamic-SQL detection can be evaded, which gives a false green. Priority: High (the dangerous direction; FR-5 says an unparsed dynamic FK "must never pass silently").** SA probed four shapes. Each gave 0 FKs, 0 problems and 0 dynamic:
   - (a) **Adjacent string constants.** Postgres concatenates `'… FOREIGN KEY '`⏎`'(user_id) REFERENCES '`⏎`'public.crm_contacts(id)'`. 20260916 itself uses this form; it is caught today only because one fragment happens to hold the whole `REFERENCES t(` run.
   - (b) **`||` chains:** `'… FOREIGN KEY ' || '(c) REFERENCES ' || quote_ident(t) || '(id)'`.
   - (c) **Positional format specifiers:** `REFERENCES public.%2$I(id)`. `NAME_PART` accepts only `%I`.
   - (d) **`REFERENCES t;`** inside the string. `;` is not among the terminators.

   **Fix:**
   - In `tokenize`, merge string constants separated only by whitespace that contains a newline into one `string` token, which is the Postgres lexer rule.
   - In `statement()` / `scanDynamic()`, evaluate each `string || operand || string …` chain as one text, with `%s` for every non-literal operand, before matching.
   - Widen `NAME_PART` to `%(?:\d+\$)?[IiLsS]`.
   - Add `;` to the terminators.
   - Add one unit test per shape (a)–(d).

   **Do not** loosen to "any whole-word REFERENCES / FOREIGN KEY in a string". SA measured that: about 40 false hits (`'REFERENCES'` privilege arguments in the lockdown migrations, and post-condition prose). Re-measure after the fix: dynamic must still be exactly `20260916…:205`.
2. **`scripts/lib/migrationForeignKeys.ts` `alterTable`: `ALTER TABLE … SET SCHEMA` is not followed. Priority: Medium.** A child moved out of `public` keeps its FK under the old key, and the check reads it as a reviewed `public` child, which is a false green. G-18 requires `child_schema = 'public'`. No migration does this today (grep: 0). **Fix:** move the table key (own FKs) and the parent references to the new schema, the same as `renameTable`. Add a unit test. Reporting it as an `unattributed` problem instead is also acceptable.
3. **G-10 joins this slice (ruling (a) below). Priority: High (scope).**
   - **The filter:** run a second filter over the same `replay.foreignKeys`, with `parentSchema === 'auth' && parentTable === 'users' && childSchema !== 'auth'`. It mirrors `fk_catalog` at generator line ~985.
   - **The key:** `(childSchema, childTable, childColumns[0])`, checked against `tenancyForeignKeys() ∪ ACTOR_FOREIGN_KEYS`. Width ≠ 1 is reported, as for G-18.
   - **The message:** its own FR-7-style text, listing every offender. It names the generator, the two ways to review the link (add the table to the plan so it shows up in `tenancyForeignKeys()`, or add an `ACTOR_FOREIGN_KEYS` entry), the `FUNCTION_MIGRATION` bump, and the regenerate command.
   - **Negative controls:** an unreviewed `REFERENCES auth.users` is reported; a reviewed one passes; an `auth`-schema child is ignored; a multi-column link gets the width message.
   - **Records:** record 89/89 again after the change, and update the requirement's SA-1 outcome line.
4. **`testAccountCleanupInboundFk.guard.test.ts`: a drifted, listed dynamic file printed two problems. Priority: Low. FIXED BY SA.** The second one ("Add the file to DYNAMIC_FK_MIGRATIONS…") is wrong advice for a file that is already listed. Now only the drift is reported, and it carries the entry's reason, which says to re-copy the array and update the sha in the same PR. The sha256-drift control was updated to assert exactly that one problem.

### Exception list, entry by entry (SA condition 2)

| # | Ruling |
|---|---|
| E-1 `DYNAMIC_FK_MIGRATIONS` 20260916 | ✅ Approved. The copy and the sha256 were verified independently (see above). |
| E-2 `LIVE_NAME_ALIASES` `fk_payment_invoices_service` → `payment_invoices_service_id_fkey` | ✅ Approved. Live check 2026-10-30 (TL) is cited in the reason. |
| E-3 `NOT_ON_PROD` `websites_business_fk` | ✅ Approved. Live check 2026-10-30 (TL): `to_regclass` NULL. |
| E-4 `NOT_ON_PROD` `insight_outcomes_business_fk` | ✅ Approved. Live check 2026-10-30 (TL): `to_regclass` NULL. |

Keeping E-3/E-4 as stale-checked `NOT_ON_PROD` entries, rather than leaving them out of the 63-line copy, is the preferred form. `scheduling_meetings_replaces_meeting_id_fkey` is on no list.

### Rulings on the open points

- **(a) G-10: include it in this slice.** Both SA-1 thresholds are met: 0 exceptions and no live gap. G-10 drift is also the *more* likely class, because every new user-owned table carries `user_id REFERENCES auth.users`. The guard cannot merge before #580 anyway, so adding it costs no calendar time. Comment 3 gives the shape.
- **(b) Timing: meets SA-7.** The budget means the guard's own work: generator import, file reads, replay and plan, measured at 0.7–1.1 s. The ~4 s Jest per-file floor is paid by every suite in the gate, and an empty file measured the same. The gate is sharded 3 ways at `--maxWorkers=4`, so two more suites add about 1–2 s of worker time across 12 slots. That does not lengthen any shard, and it leaves `next build` as the critical path. No config change.
- **(c) The sha256 pin turning red on each business-owned table addition: acceptable, and in fact required.** A new array entry creates a new `<t>_business_fk` into `business_profiles`, which is a plan table. G-18 blocks that on prod unless it is reviewed. The pin is what turns that into a PR-time failure. After the dev re-copies the array and updates the sha, the normal check names the new FK with the FR-7 procedure. The drift message is now actionable (comment 4).
- **(d) The Dev's deviations.** The workplan has no numbered deviations list, so SA rules on each departure from the requirement it records:
  - FR-7 step 4 ("ship as a new migration; never edit an applied one"): ✅ accepted. AC-11 is still met.
  - K-2, per-table collision scope: ✅ accepted, as SA-5.5 is written.
  - K-3, a string ending in `references <name>` flagged as dynamic: ✅ accepted. It fails closed, and it is subsumed by comment 1.
  - E-3/E-4 as `NOT_ON_PROD` instead of omitting them from the copy: ✅ preferred.
  - The replay runs at describe time rather than in `beforeAll`: ✅ accepted.

### Optimisation Suggestions
- `ForeignKey.line` is `0` for injected FKs. `describeFk` prints the file only, so this is harmless. If a line is ever printed, show `(injected)` instead of `:0`.

### Code Approved for QA: No. After comments 1–3, SA re-reviews the delta only, then hands to QA.

### Re-review by SA — 2026-10-30 (delta only)

**Status:** ✅ Approved with fixes. Comments 1–3 are resolved. SA fixed the open `notnull` case itself (R-0). One small item, R-1, remains for Dev, and SA checks it from the diff, with no further full review.

**Verified by SA (re-run, not taken from the claims)**
- **Tests:**
  - Unit, guard and `testAccountCleanupSql` together: 302 passed and 1 failed, before SA's edit. The failure is the AC-9 red, which names `scheduling_meetings_replaces_meeting_id_fkey` and nothing else: no G-10 section, no dynamic problem.
  - After R-0: unit + guard give 93 passed, 1 failed (the same red). The guard alone is 28/29.
- **SA's original probes, re-run:**
  - Adjacent constants, the `||` chain, `%1$I`, `%2$I` and `;` are all flagged as dynamic now.
  - `SET SCHEMA` now gives `other.k`.
  - The BOM case still fails closed.
  - The static probes are unchanged.
- **`continuedQuote`** matches the lexer's `whitespace_with_newline` rule: horizontal whitespace and `--` comments, at least one newline, no block comment. When it over-joins, that only flags more.
- **`moveTable`** covers RENAME TO and SET SCHEMA: own FKs, self-references at both ends, columns, and inbound FKs.
- **The G-10 pass** mirrors `fk_catalog`: parent `auth.users`, child schema not `auth`, key `(schema, table, conkey[1])` against `tenancyForeignKeys() ∪ ACTOR_FOREIGN_KEYS`, and width ≠ 1 reported. It has its own FR-7-style section and runs inside the same `checkInboundForeignKeys` as the controls.

**R-0: the `notnull` ruling. Widen it. FIXED BY SA.**
- After `REFERENCES <name>`, the pattern now also stops at any column-constraint keyword: `NOT NULL`, `NULL`, `DEFAULT`, `CHECK`, `UNIQUE`, `PRIMARY KEY`, `CONSTRAINT`, `NOT DEFERRABLE`.
- Prose does not put a constraint keyword straight after a table name, while an inline FK can. So the widening adds coverage without adding noise.
- On the real tree the only dynamic hit is still `20260916…:205`; the guard's red is unchanged.
- Added 7 `it.each` cases and one prose control in `migrationForeignKeys.test.ts`, with a comment at `NAME_PART`.

**R-1: for Dev, Medium. An `EXECUTE` backstop.**
- **The gap:** two shapes still pass silently, because the joiner cannot see through them:
  - a `::text` cast inside a chain (`'… FOREIGN KEY '::text || '(c) REFERENCES '::text || t || '(id)'`);
  - `concat('… FOREIGN KEY ', '(c) REFERENCES ', t, '(id)')`.

  Both gave 0 FKs, 0 problems and 0 dynamic.
- **The rule:** a statement, at any depth, that contains the word `EXECUTE` (not followed by `FUNCTION` or `PROCEDURE`) and holds a string constant matching whole-word `foreign\s+key` or `references` is dynamic.
- **Measured noise:** SA measured it on all 291 files: **0 extra hits**. The only statement it matches is the known `20260916` loop.
- **Tests:** add a unit test for each shape.
- **Optional:** in `stringChains`, skip a `::type` cast after a string operand, which would also cover a cast chain assigned to a variable before `EXECUTE`.
- **What stays out of reach:** SQL assembled across several assignments through other functions. State that limit in the module header, next to the one-direction note.

### Code Approved for QA: Yes, once R-1 lands. SA confirms R-1 from the diff, and QA may prepare in parallel.

## QA Testing Report

**QA — 2026-10-30**
**Test mode:** full
**Strategy used:** A (Jest unit + guard suites), C (end-to-end controls done on real files: a probe migration dropped into `supabase/migrations/` and the real guard run, then the file deleted), plus a scratch replay script for the false-green probe batch (it runs the module's `replayMigrations` against the real migrations with and without each probe, and prints only what the probe adds)
**Focus:** schema / pipeline-adjacent CI guard (G-18 and G-10 at PR time)
**Skipped:** e2e (no UI), log-analysis (not needed)
**Input source:** TL prompt (steps 1–6 plus the TL note's R-0/R-1 re-run and two extra controls)

Final code under test (after Dev landed R-0 / R-1): `migrationForeignKeys.ts` sha256 `873bdffd…be069`, `migrationForeignKeys.test.ts` `7d756a79…0694a`, guard `d1afb65e…35833`.

### Suite results (final code)

| Suite | Result | Jest `Time` | Process wall |
|---|---|---|---|
| `scripts/__tests__/migrationForeignKeys.test.ts` | ✅ 68 / 68 | 3.5–5.0 s | 6.9–10.9 s |
| `scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts` | 28 / 29: the one failure is the expected AC-9 red, `scheduling_meetings_replaces_meeting_id_fkey` from `20261097_a_session_knows_what_it_replaced.sql`, alone | 4.3–6.8 s | 8.2–14.0 s |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | ✅ 217 / 217 | 5.3–9.1 s | 8.7 s |
| All three together (pre-R-1 run) | 302 passed, 1 failed (same red), 303 total | 12.3 s | 17.7 s |

Wall times come from a Windows machine that other sessions were also loading. In every run the guard file's Jest time is within about 1 s of the unit file's. That is the per-file floor Dev measured, and it matches SA's SA-7 ruling: the budget counts the guard's own work.

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| AC-9 red on main without #580, exactly one FK | ✅ | Pass | Only `scheduling_meetings_replaces_meeting_id_fkey`. The message matches FR-7, plus step 4 |
| AC-8 green with #580 (just the one `INBOUND_FOREIGN_KEYS` line) | ✅ | Pass | 29 / 29. The line was then removed and the generator sha256 is back to `c3d5b751…abf91` |
| AC-8 green on the full #580 file set (generator from `origin/fix/cleanup-g18-meeting-replaces` @ `4a3045de` + migration `20261101_…meeting_replaces.sql`) | ✅ | Pass | 29 / 29. Both overlays were removed and the sha256 checked afterwards |
| (a) E2E: `ALTER TABLE crm_tasks ADD COLUMN qa_contact_id uuid REFERENCES crm_contacts(id)` | ✅ | Pass (red) | The guard names `20269999_qa_probe.sql: public.crm_tasks.qa_contact_id -> public.crm_contacts (constraint crm_tasks_qa_contact_id_fkey)`, followed by fix steps 1–4. Both offenders are listed (AC-10) |
| (b) E2E: new `CREATE TABLE` with `user_id uuid REFERENCES auth.users(id)` | ✅ | Pass (red) | It gets its own G-10 section naming `public.qa_probe_widgets.user_id -> auth.users (constraint qa_probe_widgets_user_id_fkey)`, both review routes (`tenancyForeignKeys()` / `ACTOR_FOREIGN_KEYS`), the `FUNCTION_MIGRATION` bump and the regenerate command |
| (c) E2E: FKs to non-plan tables (`exchange_rates`, `ai_model_pricing`, checked as non-plan against `buildCleanupPlan('hard')`) | ✅ | Pass (no new red) | Only the baseline #580 red |
| (d) E2E: FK added and dropped in the same file | ✅ | Pass (no new red) | |
| (e) E2E: `--` comment, `/* */` comment, and a nested `/* /* */ */` | ✅ | Pass (no new red) | |
| (f) E2E: `DO` + `EXECUTE format('ALTER TABLE %I ADD CONSTRAINT x FOREIGN KEY (c) REFERENCES crm_contacts(id)', t)` | ✅ | Pass (red, dynamic) | `20269999_qa_probe.sql:4: foreign key syntax inside a string or function body (dynamic SQL): …`, with "Add the file to DYNAMIC_FK_MIGRATIONS … with its sha256 and the constraints it creates" |
| (g) E2E: one trailing space on line 10 of `20260916_business_data_ownership.sql` | ✅ | Pass (red) | The message reads "the file changed since its expansion was reviewed (sha256 36698a18…, pinned 6d9cad76…). Re-read its dynamic SQL, update the hand-written expansion and the sha256 in …guard.test.ts", plus the entry note. The file was restored and its raw sha256 is back to `dd2f6c12…a39f` |
| TL extra 1: `DO` + `EXECUTE concat('ALTER TABLE x ADD CONSTRAINT y FOREIGN KEY ', '(c) REFERENCES ', 'crm_contacts', '(id)')` | ✅ | Pass (red, dynamic) | Line 3 is reported. This is the R-1 EXECUTE backstop |
| TL extra 2: `'ALTER TABLE '::text \|\| quote_ident(t) \|\| ' … FOREIGN KEY (c) REFERENCES '::text \|\| 'crm_contacts' \|\| '(id)'` | ✅ | Pass (red, dynamic) | The excerpt `ALTER TABLE %s ADD CONSTRAINT y FOREIGN KEY (c) REFERENCES crm_contacts(id)` shows the cast-skip join |
| Gate collects both files | ✅ | Pass | `jest --config jest.gate.config.js --listTests` lists both. Neither is in `.github/ci/jest-quarantine.json` (11 entries) |
| A migration-only PR runs the gate | ✅ | Pass | `supabase/migrations/*.sql` is not a skippable path in `non-deploying-change.sh`, and `jest-gate-scope.sh` runs the gate for any non-`.md` `scripts/` change |
| No workflow / config / generator / migration changed | ✅ | Pass | `git diff --stat HEAD -- .github jest.config.js jest.gate.config.js package.json` is empty. `git status` shows only the 5 new untracked files |
| SA-7 runtime | ✅ | Pass | See the suite table |

### False-green probes (the dangerous direction)

26 probes were run through the scratch replay against the real migrations. 19 turn red as they should: a renamed reviewed constraint, a DROP inside an uncalled function body (that DROP is correctly not applied), a BOM prefix (it fails closed as unattributed), `search_path` (K-4, which fails closed), quoted identifiers, `CREATE TABLE IF NOT EXISTS` on a new table, an unnamed table-level FK, a non-`public` child, `RENAME TO`, `ALTER TABLE ONLY … NOT VALID`, an `EXECUTE` of a variable, `format('… REFERENCES %s')`, `concat()` with the FK in one piece, `CREATE TABLE AS` followed by `ADD CONSTRAINT`, an explicitly named second FK on the same column, an inline `CONSTRAINT n REFERENCES t ON DELETE`, a DROP CONSTRAINT on the wrong table, and G-10 via `ALTER TABLE … ADD COLUMN`. The 7 that stay green:

| Probe | Why it is green | Classification |
|---|---|---|
| `ADD COLUMN IF NOT EXISTS contact_id … REFERENCES` on an existing column | Postgres skips it too | Correct |
| `REFERENCES users(id)` (unqualified) | Resolves to `public.users`, not `auth.users` (K-4) | Correct |
| `DROP COLUMN qa_never CASCADE` | No such column, so nothing to drop | Correct |
| `DO $$ IF <never true> THEN ALTER TABLE … DROP CONSTRAINT … $$` after an unreviewed ADD | The replay treats DO bodies as executed (SA-5.3, by design) | Edge case 1 |
| `concat('… FOREIGN ', 'KEY (c) REF', 'ERENCES crm_contacts(id)')` | Keywords are split across fragments, so no fragment holds `FOREIGN KEY` or `REFERENCES` | Edge case 2 (adversarial only) |
| `CREATE TABLE … PARTITION OF <plan table>` | Postgres clones the parent's FKs onto the partition, and the replay does not | Edge case 3 |
| DROP a reviewed constraint, then re-add the same name on the same child pointing at a **different** plan table | Mirrors G-18, which keys on `(child, constraint)` only. The guard is exactly as strict as the runtime | Edge case 4 (inherent to G-18, not to the guard) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The guard's work is well inside SA-7.

#### Edge Cases (nice to fix / document)
1. **A conditional DO-block DROP is treated as executed** (SA-5.3). `ALTER TABLE crm_tasks ADD COLUMN qa_x uuid REFERENCES crm_contacts(id);` followed by `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename='never_there') THEN ALTER TABLE crm_tasks DROP CONSTRAINT crm_tasks_qa_x_fkey; END IF; END $$;` passes. A guard that is honest about this would apply only *additive* DO-body DDL unconditionally and ignore DROP / RENAME inside an `IF` (conservative, so a false red at worst). Severity Low: it needs an unusual migration. Suggest SA decide, or add it to Known limits.
2. **FK keywords split across `concat()` fragments evade detection** (`'… FOREIGN '`, `'KEY (c) REF'`, `'ERENCES …'`). This is adversarial, not a realistic authoring shape, and the module header already states the "assembled across …" limit. Severity Low. Document only.
3. **`PARTITION OF`.** A partition inherits cloned FKs (G-18 and G-10 would see them under the partition's name). The repo has no partitioned tables today (`grep "PARTITION (BY|OF)"` finds only window functions). Severity Low. Add to Known limits, or make `PARTITION OF` a plan parent fail closed.
4. Cosmetic: the offenders are listed in sorted (child table, constraint) order, not file order. That is fine, and arguably better.

### Test Outputs / Logs

```text
migrationForeignKeys.test.ts                 Tests: 68 passed, 68 total
testAccountCleanupInboundFk.guard.test.ts    Tests: 1 failed, 28 passed, 29 total
  ● … › finds no unreviewed, multi-column or unreadable foreign key
      20261097_a_session_knows_what_it_replaced.sql: public.scheduling_meetings.replaces_meeting_id
        -> public.scheduling_meetings  (constraint scheduling_meetings_replaces_meeting_id_fkey)
testAccountCleanupSql.test.ts                Tests: 217 passed, 217 total
Green (#580 line only)                       PASS  Tests: 29 passed, 29 total
Green (#580 generator + 20261101)            PASS  Tests: 29 passed, 29 total
jest --config jest.gate.config.js --listTests | grep -E "InboundFk|migrationForeignKeys"
  …\scripts\__tests__\testAccountCleanupInboundFk.guard.test.ts
  …\scripts\__tests__\migrationForeignKeys.test.ts
After all overlays: generator sha256 c3d5b7513a3c2f9cae31a14e486494516f2aaff110ee51a283e59d3af10abf91,
  20260916 raw sha256 dd2f6c124174f3f96572b091324c80da181686e30775cff82ee17b6318d2a39f,
  git diff --stat empty, git status = the 5 new untracked files only, no 20269999 / 20261101 file left.
```

Note on method: the first attempt at (g) used Git Bash `sed -i`. That silently rewrote the CRLF file as LF, which the guard's CRLF normalisation correctly treats as unchanged, so the run proved nothing. It was redone with a byte-exact Node edit, and that version turned red. The CRLF-insensitivity is the intended behaviour.

### Final Status
- [x] All acceptance criteria pass. The only red is the expected AC-9 red, which goes green once #580 is on the branch (SA-8 landing order).
- [ ] Issues found. None blocking. Edge cases 1–3 are Low, for SA to rule on or record in Known limits.

**Verdict: PASS.**

## Commit Info

_RM populates._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Created | Dev: module, unit tests, guard, measured history, 4 proposed exceptions, G-10 measurement, red / green proofs |
| 2026-10-30 | SA code review | Fix Required (narrow). E-1..E-4 approved; E-1 copy and sha verified. Comment 1 (High): dynamic detection evaded by adjacent literals, `\|\|` chains, `%n$I`, `;`. Comment 2 (Medium): `SET SCHEMA`. Comment 3: G-10 joins this slice. Comment 4 fixed by SA (drift message). Timing meets SA-7; sha pin accepted. |
| 2026-10-30 | SA re-review | Approved with fixes. Comments 1–3 verified by re-running tests and probes. R-0: the `notnull` case widened by SA (constraint keywords after `REFERENCES <name>`, +8 unit tests; still one dynamic hit). R-1 for Dev: an `EXECUTE` backstop for `::text` casts and `concat()` (measured noise 0). QA once R-1 lands. |
| 2026-10-30 | SA code review fixes | Dev: comment 1 (adjacent constants joined in `tokenize`, `\|\|` chains judged as one text with `%s` operands, `%n$I`, `;`), comment 2 (`SET SCHEMA` via `moveTable`), comment 3 (G-10 second pass + 6 controls, 89/89). Dynamic still only `20260916…:205`. Unit 57/57, guard 28/29 (expected red), cleanup 217/217; 613–647 ms. |
| 2026-10-30 | SA R-1 | Dev: EXECUTE backstop + `::type` cast skip + header limit note; 3 unit tests. Dynamic still only `20260916…:205`; only red the #580 FK. 314 tests, 313 pass. |
| 2026-10-30 | QA | PASS. Unit 68/68, guard 28/29 (expected #580 red only), cleanup 217/217. Green 29/29 with #580 (line only, and full generator + 20261101). E2E controls (a)–(g) plus the TL concat / `::text` chain controls behave as specified on real files. Gate lists both files, no config change. 26 false-green probes: no bug; 3 Low edge cases (conditional DO drop, split-keyword concat, PARTITION OF). |
| 2026-10-30 | Landing | PR #580 merged (a86e8535) with its migration renumbered 20261101 → 20261104; earlier rows that say 20261101 mean that file. Guard rebased onto main and green 29/29. |
