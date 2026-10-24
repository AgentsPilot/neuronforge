# Workplan: Test-account cleanup — meeting links fix (20261092)

> **Last Updated**: 2026-10-24

**Developer:** Dev
**Branch:** `fix/cleanup-meetings-inbound-fks`
**Date:** 2026-10-24
**Status:** Code Complete (uncommitted). Awaiting SA code review and QA.

## Overview

Every Danger Zone check and delete on prod was refused by guard G-18. This change records the eight database links that cause it as reviewed, and ships the result as a **new** migration, `20261092`. The applied `20261081` goes back to its exact applied bytes and is pinned so nobody can change it again.

---

## Analysis Summary

| Item | Fact |
|---|---|
| Cause | Offir's commit `c21a4b0f` (merged ~2026-10-21) added `abandoned_bookings` and `scheduling_meetings` to the cleanup plan. It did not add their links to `INBOUND_FOREIGN_KEYS`, and it **regenerated the already-applied `20261081` in place** (stamp `2bd40a46795e4555`). |
| Effect | G-18 refuses every check and delete, because there are links into tables the plan empties that nobody has reviewed. |
| Bridge, 2026-10-23 | The user applied main's `20261081`, then a hand-made bridge: this branch's regenerated function with its stamp swapped back by hand to `2bd40a46…`, so the deployed app would accept it. **Live now:** the 8-argument function, stamp `2bd40a46795e4555`, carrying the 8 links. Its body matches **neither** committed file byte for byte. |
| The 8 links (owner column `user_id` for all) | `abandoned_bookings_booking_id_fkey`, `abandoned_bookings_business_fk`, `abandoned_bookings_service_id_fkey`, `email_sends_booking_id_fkey`, `email_sends_meeting_id_fkey`, `payment_plan_installments_meeting_id_fkey`, `scheduling_meetings_booking_id_fkey`, `scheduling_meetings_business_fk` (TL-verified on prod) |
| Newer migrations `20261082`–`20261091` | No new link into or out of any table the plan empties, and no new table owned by a user. Details: 82 creates `exchange_rates` / `exchange_rate_history`, whose links to `auth.users` are already classified (`ownerColumn: null`). 83, 84, 85, 86, 87 and 91 add only columns, CHECK constraints and exclusion constraints. 87 adds the `move_meeting` function. 88 re-declares `update_invoice_on_payment_trigger`, which fires on INSERT/UPDATE, not DELETE, on a table the plan deletes, so G-17 does not apply. 90 drops the `attempt_id` columns, which were added outside any migration file and never had a migration-declared link. |
| Migration number | `20261092` is above everything on origin/main, on all 386 remote branches and in every local worktree. `20261089` is absent everywhere and nothing reserves it. It is left unused, per SA-8. There are no open PRs. |

---

## Implementation Approach

1. Generator constants move on: `FUNCTION_MIGRATION = 20261092_operator_test_account_cleanup_meeting_links`, `PREVIOUS_FUNCTION_MIGRATION = 20261081_operator_account_cleanup_anonymise`.
2. Signature handling is now generic. `RETIRED_FUNCTION_SIGNATURE` is the 6-argument signature: every migration still drops it if it exists (a no-op on prod), and the order guard uses it. `PREVIOUS_FUNCTION_SIGNATURE` now equals `FUNCTION_SIGNATURE` (8 arguments), so the rollback grants on the signature it actually restores. Left as it was, the rollback would have issued `ALTER/GRANT` on a 6-argument function that does not exist, and failed.
3. The migration header is no longer hard-coded to DE-10b.1. It comes from `FUNCTION_MIGRATION_PURPOSE`, and the rollback header comes from `ROLLBACK_CONSEQUENCE`. Both are rewritten with each new version.
4. `20261081` and its rollback are restored from origin/main and pinned in `APPLIED` (sha256 `e08f76aa…`, `d7ecfbee…`).
5. A new read-only pre-check and checker are added for the apply.

### Rollback decision (flag for SA, Q1)

**The generated rollback restores `20261081` exactly as committed and pinned** (stamp `2bd40a46…`, **without** the 8 links). It does **not** restore the live bridge.

Why:
- The rollback must be reproducible from an applied file whose bytes a test pins. That is how every earlier rollback was built, and it is the only thing the drift test can prove. The bridge exists only as a hand-edited paste and is in no file.
- The bridge is the plan of `20261092` with an older stamp. If the reason for rolling back is a defect in this plan, rolling back to the bridge would bring the same defect back.
- Restoring `20261081` **fails closed**. The app (still pinning `2bd40a46` until a redeploy) accepts the stamp, and G-18 then refuses every check and delete. Nothing is removed. That is exactly the safe state prod was in on 2026-10-22.

Cost: rolling back loses a working Danger Zone until `20261092` is re-applied. The rollback header says so. If SA prefers "restore the bridge", the generator could render `renderFunctionSql('2bd40a46795e4555')` as the rollback body. It would be pinned by a test, but it breaks the "restores an applied file byte for byte" invariant.

Body md5 values (`md5(prosrc)` with LF line endings; useful to confirm what is live):

| Body | md5 |
|---|---|
| `20261081` committed | `d6c640ed71122d9844e952c67fa42125` |
| Bridge (plan of 92, stamp 2bd40a46) | `05fb1d35d1ee81fc07d4267acb48630b` |
| `20261092` | `c721f252594edd75ca91c7263f088412` |

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `scripts/generate-test-account-cleanup-sql.ts` | modify | 8 reviewed links; constants 92/81; `RETIRED_FUNCTION_SIGNATURE`; header and rollback-note constants |
| `supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql` | create (generated) | The fix. Stamp `ec34d5604055abfe` |
| `supabase/SQL Scripts/20261092_operator_test_account_cleanup_meeting_links_rollback.sql` | create (generated) | Restores `20261081` byte for byte |
| `supabase/migrations/20261081_operator_account_cleanup_anonymise.sql` + rollback | restored | Identical to origin/main (applied history) |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | regenerated | Carry the 8 links |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | regenerated | `ec34d5604055abfe` |
| `scripts/precheck-test-account-cleanup-meeting-links.sql` | create | Step 1 of the apply |
| `scripts/check-test-account-cleanup-meeting-links-migration.sql` | create | Step 3 of the apply |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | Pins 81 as APPLIED; previous = 81; retired-signature drop; new 20261092 describe (links, chaining, pre-check/checker pins and paste safety) |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify | 20261077 listed explicitly as older history; 81 allowed for the anonymise auth writes it introduced |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | modify | L8 re-pinned on purpose for 81 (same reason as every earlier cleanup version) |
| `supabase/migrations/__tests__/deletion-receipts.migration.test.ts` | modify | DE-10b.1 checker is point-in-time: pins the literal 81 stamp, cross-checked against the 81 file (the DE-8a precedent) |

## Task List

- ✅ Merge origin/main (fast-forward, kept the 8 entries)
- ✅ Schema review of 82–91 (no further links found; prod SQL for TL below)
- ✅ Migration number check across main, remotes and worktrees → 20261092
- ✅ Restore 20261081 and its rollback to main's bytes; pin them as APPLIED
- ✅ Generator writes 92; rollback restores 81
- ✅ Regenerate; update the drift, guard, L8 and DE-10b pins
- ✅ Pre-check and checker for the apply
- ✅ Tests and a scoped type-check

---

## Schema check owed on prod (read-only, for TL)

The migration files cannot show links that were added through the dashboard. Run this:

```sql
SELECT con.conname, src.relname AS from_table, dst.relname AS to_table, con.confdeltype
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
JOIN pg_catalog.pg_class AS dst ON dst.oid = con.confrelid
WHERE con.contype = 'f'
  AND src.relnamespace = 'public'::regnamespace AND dst.relnamespace = 'public'::regnamespace
  AND (dst.relname IN ('abandoned_bookings', 'scheduling_meetings', 'scheduling_bookings', 'email_sends', 'payment_plan_installments', 'payment_transactions', 'payment_invoices', 'payment_plan_subscriptions', 'exchange_rates')
    OR src.relname IN ('abandoned_bookings', 'scheduling_meetings'))
ORDER BY 3, 2, 1;
```

Every row should either be among the 8 links or already appear in `INBOUND_FOREIGN_KEYS`. The real proof comes after the deploy: a Danger Zone **check** on a `+test` account must not raise G-18.

---

## Apply plan (PROD)

0. **Gate (SA C-1, TL, before anything else):** run a Danger Zone **Check** on a `+test` account against the live bridge. The bridge runs exactly the plan of 20261092 (only the stamp differs) and carries the stamp the deployed build pins, so this check runs 92's G-18 against the live catalogue today. **G-18 must be absent.** If it is raised, stop: 92 would fail the same way and the plan needs another reviewed link. (Fallback: the read-only FK SQL above, with every row among the 8 or already in `INBOUND_FOREIGN_KEYS`.) Have the PR green and mergeable before step 2. It is migration-gated, so merge it by hand and do not use auto-merge.
1. **Pre-check:** run `scripts/precheck-test-account-cleanup-meeting-links.sql`. Rows 1–5 must be ok (stamp `2bd40a46` live, `ec34…` not yet, 8 links exist). Row 6 is information only: ok means the bridge is live.
2. **Apply** `supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql`. It runs in one transaction and refuses unless 20261041 and the required tables are present.
3. **Checker:** run `scripts/check-test-account-cleanup-meeting-links-migration.sql`. Rows 1–7 must be ok. Row 8 (`md5(prosrc)` = `c721f252…`) is information only and never a gate.
4. **Merge and deploy fast.** Between steps 2 and 4 the deployed build pins `2bd40a46` and the function returns `ec34…`, so the Danger Zone refuses on the version stamp. That is fail-closed, but it should be kept short.
5. Run a Danger Zone check on a `+test` account. G-18 must be absent.

**Rollback:** run `supabase/SQL Scripts/20261092_…_rollback.sql`, then redeploy a build that pins `2bd40a46`. G-18 then refuses again (see the rollback decision above).

---

## Proposed guard: an applied function migration can never be regenerated in place (for SA, rule 7)

> **Rule (CLAUDE.md-style note, proposed for the cleanup runbook and the Common Gotchas table):** a migration file that has been applied to prod is immutable. The test-account cleanup generator must refuse to write `FUNCTION_MIGRATION` if that name is applied history.

The existing test (`applied` does not contain `MIGRATION_FILE`) only works if someone remembers to pin the file once it is applied. With 20261081 nobody did, so `c21a4b0f` passed CI. Proposed, in order of strength:

1. **Pin the predecessor when you write the successor.** The drift test requires that **every** `supabase/migrations/*operator*cleanup*.sql` other than `FUNCTION_MIGRATION` is in `APPLIED`. You then cannot move on without pinning what came before, and nothing outside `FUNCTION_MIGRATION` can change unnoticed.
2. **The generator refuses to overwrite.** `main()` refuses to write `MIGRATION_FILE` when the existing file differs and its stamp is not the one being written, unless `--unapplied` is passed and the author confirms the file was never applied. A silent in-place regeneration then needs a deliberate flag, visible in review.
3. **CI diff guard.** A required check fails when a PR modifies (rather than adds) any file under `supabase/migrations/` that exists on `origin/main`, unless a reviewed allow-list names it. This covers every migration, not just the cleanup.

Recommendation: (1) now, as it is a test-only change. (3) as a separate slice, after SA rules on its CI runtime.

---

## SA Review Notes

_SA to populate._ Open questions: see the Dev report (Q1 rollback target, Q2 allow-listing 81 for auth writes, Q3 guard choice, Q4 the DE-10b.1 checker reading FAIL after 92 by design).

## SA Code Review — 2026-10-24

**Code Review by SA — 2026-10-24**
**Status:** ⚠️ Approved with conditions (C-1 to C-3 below). No architectural objection: the fix is in the right place (the generator's reviewed-link catalogue), ships as a new dated file per SA-8, and leaves applied history untouched.

### What SA verified (independently, in the worktree)

| # | Check | Result |
|---|---|---|
| V-1 | `20261081` migration and rollback vs `origin/main` | ✅ Identical (`git diff origin/main` empty). Pinned in `APPLIED` (LF-normalised sha256 `e08f76aa…`, `d7ecfbee…`) |
| V-2 | `20261092` vs `20261081` (LF-normalised `diff`) | ✅ Only: line 1 name, the 3 purpose lines (now `FUNCTION_MIGRATION_PURPOSE`), the rollback-pointer line, the 8 links in each of the 4 `inbound_review` blocks (8 × 4 = 32 lines), and the stamp `2bd40a46795e4555` → `ec34d5604055abfe`. No other change to plan, guards, grants or `search_path` |
| V-3 | Rollback function body vs `20261081` function body | ✅ Byte-identical (`cmp` of the `CREATE OR REPLACE … $operator_cleanup$;` span). One `DROP` (8-argument signature) before the `CREATE`; `ALTER OWNER` / `REVOKE` / `GRANT` on the 8-argument signature; one transaction. The bug Dev found (rollback grants on a 6-argument function that would not exist) is real and fixed by `PREVIOUS_FUNCTION_SIGNATURE = FUNCTION_SIGNATURE` |
| V-4 | Generator: 8 `INBOUND_FOREIGN_KEYS` entries, sorted, owner `user_id`; `RETIRED_FUNCTION_SIGNATURE`; order guard accepts either signature; headers from constants | ✅ Matches the TL-verified list. Header constants carry no `;` or `'` |
| V-5 | `test-account-cleanup-check.sql` / `-delete.sql` | ✅ Only the 8 links added |
| V-6 | Pre-check and checker | ✅ Single `SELECT`, one `;`, no `into`, no `'` or `;` in comments, read-only. The `quote_literal(conname)` substring test matches both the first `'…'::text` row and the plain rows |
| V-7 | `into` in migration and rollback | ✅ Only the `INSERT INTO` keywords (2 audit + 1 receipt in each), same as the applied 81 |
| V-8 | Migrations 82–91: new links, user-owned tables, DELETE triggers | ✅ Agrees with Dev. The only `REFERENCES` are 82's two `auth.users` links, already classified `ownerColumn: null` (generator lines 379–380). The 84/85 constraint changes are exclusion/CHECK. 88's trigger is INSERT/UPDATE. 91's `moved_by` is a CHECKed text column, not a link |
| V-9 | Tests | ✅ 4 suites, 360/360 pass locally. No type errors in touched files. No `console.*` in touched files |

### Rulings

**Q1 — rollback target: committed 20261081 (fail-closed). APPROVED.** The rollback must restore an applied file that a test pins byte for byte. The bridge exists in no file, and it *is* the plan of 92 with an old stamp, so rolling back to it would re-ship whatever defect caused the rollback. Restoring committed 81 fails closed (G-18 refuses, nothing is removed): the state prod was in on 2026-10-22. Do **not** render `renderFunctionSql('2bd40a46795e4555')` as the rollback. The rollback header already states the cost; keep it.

**Q2 — 20261081 in the auth-write allow-list via `PREVIOUS_MIGRATION_FILE`. APPROVED.** It is applied history carrying exactly the SA Review 2 §D writes, pinned by sha256. The "older versions hold none of the new writes" test is narrowed by the auth-write list itself, not by a hand-kept exception. Accepted consequence: at the next bump, 81 drops out of both lists and the guard fails loudly until it gets an explicit literal entry (the same pattern as 77 and 75 today). That loud failure is what we want.

**Q3 — guard. BUILD IN THIS PR (test-only, small): pin the generator target once it is on main, plus Dev's option 1 in content-marker form.** Note on Dev's proposal: option 1 as written would **not** have caught `c21a4b0f`. That commit regenerated the *current* `FUNCTION_MIGRATION` (81), and no rule about predecessors covers the current target. Pinning the target's own bytes would have caught it. In this project a cleanup migration is applied to prod before its PR merges (migration-gated, manual merge), so a target that is on main is applied history. Therefore:
1. **G-a (self-pin):** add an `APPLIED_TARGET` slot (`MIGRATION_FILE` and `ROLLBACK_FILE` with their sha256) to the applied-history describe. Relax the `not.toContain(MIGRATION_FILE)` assertion so `MIGRATION_FILE` may appear only through that slot. Any in-place regeneration then fails the sha pin with the existing message ("put the change in a NEW dated FUNCTION_MIGRATION"). The next bump moves the slot's pair into `APPLIED`. Pin 92 in this PR: its bytes are final, and the PR merges only after TL applies it.
2. **G-b (option 1, content-based):** every file in `supabase/migrations/` whose first line contains `GENERATED by scripts/generate-test-account-cleanup-sql.ts`, and every `supabase/SQL Scripts/*_rollback.sql` whose first line is `-- Rollback of supabase/migrations/<such a file>`, must appear in `APPLIED` ∪ `APPLIED_TARGET`. Use the content marker, **not** a filename glob: 81's name (`operator_account_cleanup`) already broke the `operator_test_account_cleanup` pattern.
3. **Option 2 (the generator refuses to overwrite) — REJECTED.** It adds a flag to every legitimate unapplied iteration and duplicates G-a.
4. **Option 3 (a CI diff guard on any modified migration that exists on main) — separate slice.** Worth doing, because it covers every migration, not just this generator. SA pre-ruling on runtime: acceptable only as a `git diff --name-status` step inside an existing required job (no new job, no added critical-path time, per the no-added-CI-time rule), and it must handle the merge-queue checkout depth. Needs its own SA review.
5. Add the one-line rule ("a migration file applied to prod is immutable; a changed plan goes in a new dated file") to the cleanup runbook. CLAUDE.md is TL/user territory: propose the Gotchas row, do not edit it.

**Q4 — the DE-10b.1 checker's row 11 reads FAIL after 92. ACCEPTED (point-in-time checker, DE-8a precedent).** The literal `2bd40a46795e4555`, cross-checked against the applied 81 file, is the right shape. Optional: note in the runbook that the DE-10b.1 checker is point-in-time and its row 11 fails by design once a later cleanup version is live. Not blocking.

**Q5 — must TL run the read-only prod FK SQL before apply? YES, as a gate (C-1).** The migration files cannot show links that were added in the dashboard. The cheapest proof that settles it is available *now*, before 92 is applied: the bridge is live with the same plan and the stamp the deployed build pins, so **a Danger Zone check on a `+test` account today runs exactly 92's G-18 against the live catalogue.** TL runs either (a) that Danger Zone check and confirms G-18 is absent, or (b) the workplan's FK SQL and confirms every row is one of the 8 or already in `INBOUND_FOREIGN_KEYS`. Prefer (a). If it raises G-18, stop: 92 would fail the same way and the plan needs another link.

**Q6 — migration number and deploy window. APPROVED as planned.** `20261092` stands. `20261089` stays unused (SA-8: a gap is harmless, reuse is not). The window between steps 2 and 4 fails closed on the version stamp, but keep it short: have the PR green and mergeable *before* step 2, and do not put this PR on auto-merge (migration-gated, manual merge only).
_SA did not have the Dev report's text. If its Q5/Q6 were different questions, TL should relay them._

### Code Review Comments

1. `scripts/__tests__/testAccountCleanupSql.test.ts` (applied-history describe) — build G-a and G-b per Q3, in this PR — Priority: **High** (C-2)
2. Workplan § Apply plan — add the C-1 gate (Danger Zone check against the live bridge, G-18 absent) as a step 0, **before** the pre-check — Priority: **High** (C-1)
3. `scripts/__tests__/testAccountCleanupSql.test.ts`, test "the pre-check requires the 20261081 stamp live and this stamp absent" — `toContain("position('ec34…' in p.prosrc) > 0")` passes whether it sits in `EXISTS` or `NOT EXISTS`. Assert the `NOT EXISTS (… position('${CLEANUP_FUNCTION_VERSION}' …` form, as the checker test already does for the 81 stamp — Priority: Medium (C-3)
4. `scripts/check-test-account-cleanup-meeting-links-migration.sql` — optional information-only row: `md5(prosrc)` = `c721f252594edd75ca91c7263f088412`, proving the exact body rather than stamp + links. Information only (it depends on the paste's line endings), never a gate — Priority: Low

### Optimisation Suggestions
- Migration header lines 10–14 still cite DE-10b.1's requirement and "SA Review 2 section D" as fixed text. They are accurate today; consider moving them into constants the next time the header is touched.
- The workplan's "Schema check owed on prod" SQL: add a `nspname = 'public'` filter on both sides.

### Conditions
- **C-1** (workplan step 0 + TL action before apply), **C-2** (G-a + G-b tests), **C-3** (pre-check assertion). C-2 and C-3 are test-only; nothing is regenerated.

### Code Approved for QA: Yes, once C-2 and C-3 are in (C-1 gates the apply, not QA)

## QA Testing Report

_QA to populate._

## QA Report — 2026-10-24

**QA — 2026-10-24**
**Test mode:** full (repository-side). Prod items are deferred, listed below
**Strategy used:** A (Jest: drift, pins, guards, paste safety) + C (scripted file checks: LF-normalised `diff`, `cmp`, sha256, generator re-run) + mutation probes for G-a, G-b and C-3. Option B/E are not applicable: no DB is touched before the apply
**Focus:** schema, security (paste safety, read-only SQL), regression of applied history
**Skipped:** prod checks 10–11. QA does not touch prod. They are listed as deferred, with exact steps
**Input source:** TL brief, items 1–9. This workplan has no "What QA must check" list; the brief's items were used as written
**Worktree:** `neuronforge-cleanupfk`, branch `fix/cleanup-meetings-inbound-fks`, HEAD `29963149` = origin/main, uncommitted

### Test Coverage

| # | Check | Tested? | Result | Notes |
|---|---|---|---|---|
| 1 | `20261081` migration and rollback vs origin/main, plus sha pins | ✅ | Pass | `git diff origin/main` on both files: 0 bytes. LF-normalised sha256 `e08f76aa400e964d…` and `d7ecfbeecc64c29b…` equal the `APPLIED` pins. 92's files hash `e858e9ae1bc1e1e2…` and `f86ef4e22c0bf2b6…`, equal to the `APPLIED_TARGET` pins (no CR in either) |
| 2 | LF-normalised `diff` of 92 vs 81 | ✅ | Pass | 10 lines removed, 42 added. 5 header lines (line 1 name, lines 4–6 purpose, line 9 rollback pointer). The 8 links × 4 `inbound_review` blocks = 32 lines. Stamp `2bd40a46795e4555` → `ec34d5604055abfe` (1 line). The other 4 removed / 4 added lines are the `advisor_reports_org_id_fkey` row: it loses its `::text` casts because `abandoned_bookings_booking_id_fkey` now sorts first and takes the typed first-row slot of the `VALUES` list. Same values, so not a plan change. Nothing else differs |
| 3 | Rollback function body vs 81's | ✅ | Pass | `cmp` of the `CREATE OR REPLACE FUNCTION … $operator_cleanup$;` span: equal (4549 lines each, md5 `f0d76a3a…` both). One `CREATE`. `DROP` / `ALTER OWNER` / `REVOKE` / `GRANT service_role` all on the 8-argument signature, inside `BEGIN; … COMMIT;` |
| 4 | The 4 named suites | ✅ | Pass | 4/4 suites, **364/364** tests (SA saw 360; the 4 added are the C-2/C-3 tests) |
| 5 | G-a negative: a temporary extra link (`abandoned_bookings_qa_probe_fkey`), regenerated in place | ✅ | Pass (guard fires) | The probe wrote 4 occurrences into 92. 3 tests failed: **`…20261092_….sql is byte-identical to what was applied`** (expected `e858e9ae…`, received `8571903e…`), plus the pre-check/checker stamp test and the checker md5 row test. The rollback pin stayed green, which is correct (it restores 81). Reverted: generator restored from backup and regenerated. `git status` and all 14 changed-file sha256 values match the baseline. `grep qa_probe` finds nothing. See E-1 for where the "new dated FUNCTION_MIGRATION" guidance appears |
| 6 | G-b negative: 81 dropped from `APPLIED` | ✅ | Pass (guard fires) | (a) Both 81 rows removed: G-b fails and lists both 81 files as unpinned. The order test fails too (`applied` must contain `PREVIOUS_MIGRATION_FILE`). (b) Only the 81 rollback row removed: **only G-b fails** (it lists the rollback), so G-b alone catches it. Test file restored, `cmp`-equal to the backup |
| 7 | C-3 negative: row 3 of the pre-check flipped from `NOT EXISTS` to `EXISTS` | ✅ | Pass (guard fires) | 1 failure: "the pre-check requires the 20261081 stamp live and this stamp absent…". The file was mutated in place from a backup copy and restored (`cmp`-equal). Tree back to baseline (status and sha256) |
| 8 | Generator re-run: no drift; version module | ✅ | Pass | `npx tsx scripts/generate-test-account-cleanup-sql.ts`: `git status --short` unchanged, and all 14 changed/new files sha256-identical before and after. `CLEANUP_FUNCTION_VERSION = 'ec34d5604055abfe'` |
| 9a | Paste safety: pre-check and checker | ✅ | Pass | Each is one statement (`WITH … SELECT … ORDER BY checks.ord;`), with 1 `;` at the end. `into` as a word: 0. Comment lines (4 each, header only, no inline `--`) hold no `'` or `;`. No CR. Read-only: the only write-like words are the `'CREATE'` privilege literal in pre-check row 5 and "delete" in a checker comment |
| 9b | `into` in migration and rollback | ✅ | Pass | 3 each, all `INSERT INTO`: 2 × `public.audit_trail`, 1 × `public.business_os_deletion_receipts`. Same as the applied 81 |
| 9c | Scoped `tsc --noEmit` | ✅ | Pass | A scratch tsconfig extends the repo's (strict). It covers the 6 touched TS files: generator, version module and the 4 test files, which pull in 30 project files. **0 errors**. Added `console.*` lines in touched TS: 0 |
| — | `npm run test:bos-entitlements` | ✅ | Pass | 306/306 suites, 9219/9219 tests (93 s). The diff imports nothing from `entitlements/`; run as asked |
| 10 | Prod: checker after the apply | ⬜ | Deferred | See the checklist below |
| 11 | Prod: Danger Zone check after the deploy, G-18 absent | ⬜ | Deferred | See the checklist below |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None.

#### Edge Cases (nice to fix)
1. **E-1: G-a's failure output does not say what to do** (Low). When the self-pin fails, Jest prints the test title ("… is byte-identical to what was applied") and the two hashes. The instruction "put the change in a NEW dated FUNCTION_MIGRATION" lives only in source comments, above `APPLIED` and in the `APPLIED_TARGET` docblock, so the next author must open the test to see it. Optional fix: put the instruction in the `it.each` title, or in a failure message. Not blocking.

### Deferred prod checklist (TL / user, in this order)
0. **Gate C-1, before anything else.** Run a Danger Zone **Check** on a `+test` account against the live bridge. **G-18 must be absent.** If it is raised, stop. (Fallback: the workplan's read-only FK SQL. Every row must be one of the 8 links or already in `INBOUND_FOREIGN_KEYS`.) Have the PR green and mergeable first. Manual merge only, no auto-merge.
1. Paste `scripts/precheck-test-account-cleanup-meeting-links.sql`. Rows 1–5 must be `ok`. Row 6 is information only (`ok` means the bridge is live).
2. Apply `supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql`.
3. **(QA item 10)** Paste `scripts/check-test-account-cleanup-meeting-links-migration.sql`. Rows 1–7 must be `ok`. Row 8 (`md5(prosrc)` = `c721f252594edd75ca91c7263f088412`) is information only and never a gate. Paste the output back to TL.
4. Merge by hand and deploy at once. Until the deploy, the Danger Zone refuses on the version stamp, which is fail-closed.
5. **(QA item 11)** After the deploy, run a Danger Zone **Check** on a `+test` account. G-18 must be absent, and no version-stamp refusal either.
6. Expected and accepted: row 11 of the DE-10b.1 checker (`scripts/check-de10b-deletion-receipts-migration.sql`) now reads FAIL by design (SA Q4).

### Test Outputs / Logs

```text
4 named suites:      Test Suites: 4 passed, 4 total | Tests: 364 passed, 364 total
G-a probe:           Tests: 3 failed, 188 passed, 191 total
                     x supabase/migrations/20261092_...meeting_links.sql is byte-identical to what was applied
                       Expected: "e858e9ae1bc1e1e2..."  Received: "8571903e5a0d72ca..."
G-b probe (a):       x the generator writes a newer file than every applied one... ; x G-b: every generated ... is pinned
G-b probe (b):       Tests: 1 failed (G-b only) -> + "supabase/SQL Scripts/20261081_..._rollback.sql"
C-3 probe:           Tests: 1 failed, 190 passed, 191 total (pre-check stamp test)
after every revert:  STATUS_SAME, SHA_SAME (14 files), NO_PROBE_LEFT
generator re-run:    STATUS_SAME, SHA_SAME; CLEANUP_FUNCTION_VERSION = 'ec34d5604055abfe'
rollback body cmp:   CMP_EQUAL (4549 lines each)
scoped tsc:          0 errors
test:bos-entitlements: Test Suites: 306 passed | Tests: 9219 passed
```

### Final Status
- [x] All repository-side criteria pass: ready for the user's diff review and RM. Gate C-1 must happen before the apply, and prod items 10–11 are owed after it
- [ ] Issues found — Dev must address before commit (none blocking; E-1 optional)

## Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-24 | Created (Dev) | 20261092, rollback to 20261081, pins, pre-check/checker, guard proposal |
| 2026-10-24 | SA code review | ⚠️ Approved with conditions C-1 to C-3; Q1–Q6 ruled; guard G-a + G-b to be built in this PR |
| 2026-10-24 | SA conditions applied (Dev) | C-1: step 0 gate in the apply plan. C-2: G-a (`APPLIED_TARGET` self-pin, 92 pinned: `e858e9ae…`, `f86ef4e2…`) and G-b (generated cleanup migrations and rollbacks, found by first-line marker, must be pinned), both in `testAccountCleanupSql.test.ts`. C-3: the pre-check test asserts the `NOT EXISTS` form. Optional: checker row 8 `md5(prosrc)` (information only, pinned by test). Schema SQL filtered to `public`. Runbook: immutability rule and the DE-10b.1 point-in-time checker note. Each guard's failing case was shown to fail, then reverted |
| 2026-10-24 | QA report | Items 1–9 pass; 364/364 in the 4 suites; G-a, G-b and C-3 probes fire and were reverted (tree back to baseline); entitlements 9219/9219; no bugs, 1 Low edge case (E-1); prod items 10–11 deferred |
