# Workplan: Admin exchange rates, slice 1b (database record and lockdown)

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md) (on the slice 1a branch, PR #477, not yet on `main`)
**Branch:** `feature/admin-exchange-rates-1b` (cut from `origin/main` `c60e2f93`)
**Date:** 2026-10-19
**Status:** Code Complete (uncommitted, awaiting SA code review)

## Overview

Slice 1b records `public.exchange_rates` and `public.exchange_rate_history` in the repo and locks them down: both `profiles.role` policies dropped, browser writes revoked, the history table closed to the browser, the history trigger function pinned to `search_path = public, pg_temp`. One migration, one rollback, check 35 extended to PASS / FAIL rows, and migration source tests. Nothing is applied to any database by the session: the user applies the migration on prod by hand, after PR #477 (slice 1a) is deployed.

---

## 1. Approved scope (quoted verbatim from the requirement)

### 1.1 §1 Progress, slice 1b row

> | 1b | Database record + lockdown migration (both tables into the repo, `profiles.role` replaced, browser writes revoked) | ⬜ Not started | — | Full cycle. **User applies the prod migration by hand** — the session stops for that. Applied only after 1a is deployed, so the page never breaks. Supersedes finance follow-up FF-2 (BD-55) |

### 1.2 §5.2 Slice 1b — Database record and lockdown (migration)

> | Part | What |
> |---|---|
> | Record as-is | One migration that records both tables exactly as they are live (columns, defaults, constraints, indexes, the history trigger and its function if present), written idempotently (`IF NOT EXISTS`) so it is a no-op for structure on prod |
> | Replace `profiles.role` | Drop both `profiles.role` policies. Admin reads of `exchange_rate_history` and all writes go through the server route only |
> | Revoke browser writes | Revoke `INSERT`, `UPDATE`, `DELETE` on both tables from `anon` and `authenticated` |
> | Keep the legacy read | **Keep** `authenticated` `SELECT` of enabled rows on `exchange_rates` (`CurrencySelector`, `currencyHelpers`) |
> | History | Verify the history trigger exists and fires on update (§5.4) |
> | Scripts | Rollback script and a read-only check script (policies, grants, trigger present, legacy read still works, browser write refused), following the repo's existing migration-checker pattern |
> | Apply | **The user applies the prod migration by hand.** The session stops and hands over the scripts. Applied only after slice 1a is deployed |
>
> Whether an admin-read policy on `is_platform_admin()` is still wanted once all admin reads go through the server is an SA call (SQ-2).

### 1.3 §6 FR-11

> | FR-11 | After 1b, the browser roles cannot insert, update or delete either table; signed-in users can still read enabled rows | 1b |

### 1.4 §8 Acceptance criteria, slice 1b

> - [ ] Migration, rollback and check scripts exist in the repo; the check script passes on prod after the user applies the migration.
> - [ ] No policy on either table references `profiles.role`.
> - [ ] `anon` and `authenticated` cannot insert, update or delete either table (checked by the script).
> - [ ] A signed-in non-admin can still read enabled rates; `CurrencySelector` still works.
> - [ ] The history trigger is confirmed (or added), and one test update on prod writes a history row with old rate, new rate and time.
> - [ ] The slice 1a page still saves after the migration.

### 1.5 §13 SA rulings

> | SQ-1 | **Leave `CurrencyService.updateRatesFromApi` and `updateRate` in place, unwired** (no caller on `origin/main`). Add a short header note that both are browser-side writers that stop working once 1b revokes client writes, and must not be wired again: the admin route is the only writer. Do not extend `CurrencyService` (direct Supabase outside `lib/repositories/`, legacy) |
> | SQ-2 | **Server route alone. No `is_platform_admin()` policy on either table.** 1b drops both `profiles.role` policies and adds none. Keep only "Users can read enabled exchange rates" (`SELECT`, `authenticated`, `is_enabled = true`) for `CurrencySelector` / `currencyHelpers`. Fewer policies, nothing to keep in step with `admin_users` |
> | SA-R4 | **Reads move too** | After 1b the history table has no client policy or grant, so the browser history read would fail. 1a moves **both** reads to `GET`: rates (all rows, ordered by code) and the newest 50 history rows, plus a `readAt`. Add an FR for the history panel (BD-36 kept it). The page then holds no Supabase client at all |
> | SA-R14 | **1b migration shape** | One file, idempotent. **Record**: `CREATE TABLE IF NOT EXISTS` for both tables as live (columns, defaults, constraints, the `changed_by` / `updated_by` FKs, indexes), read with `business-os-schema-check`; trigger via `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. **Do not re-`CREATE` the function**: its body contains the SQL keyword after `INSERT`, which breaks the Supabase SQL editor when pasted (known hazard; FR-0.13 of the SECDEF stream forbids it), and the body is already captured in `SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md`. Instead: `ALTER FUNCTION public.log_exchange_rate_change() SET search_path = public, pg_temp` (safe: the body is schema-qualified and `NOW()` is `pg_catalog`), plus, in the same file, `REVOKE EXECUTE ON FUNCTION public.log_exchange_rate_change() FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE ... TO service_role`. That keeps the SECDEF CI guard (S6) satisfied and matches the stream's slice 5 pattern; the revoke is a no-op on prod. **Policies**: `DROP POLICY IF EXISTS` for both `profiles.role` policies. **Grants**: `REVOKE ALL` on both tables from `anon`; on `exchange_rates`, revoke `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `authenticated` (keep `SELECT`); `REVOKE ALL` on `exchange_rate_history` from `authenticated`. `TRUNCATE` is not governed by RLS, so it is revoked explicitly. **Pre-check**: function owner is `postgres` (SECDEF FR-0.10), `proconfig` is null, `pg_depend` shows only the trigger. **Checker**: reuse and extend check 35 rather than a new script; it asserts the policies, the grants, `proconfig` holds the `search_path`, no client EXECUTE, and that the trigger exists. Rollback under `supabase/SQL Scripts/`. Update the SECDEF requirement / inventory: this function leaves the parked S7 list (47 → 46) |
> | SA-R15 | **Migration number** | Highest on `origin/main` is `20261081` (`20261077` is already taken there). No remote branch (353 scanned), `supabase/held/` or `supabase/SQL Scripts/` holds `20261082` or higher. **Provisional: `20261082`.** Dev re-checks `origin/main`, open PR branches and `supabase/held/` at build time and takes the next free number |

---

## 2. Analysis summary

| Object | Live today (read-only, project `jgccgkyhpwirgknnceoh`, 2026-10-19) | After 1b |
|---|---|---|
| `exchange_rates` ACL | `postgres, anon, authenticated, service_role = arwdDxtm` | `postgres, service_role = arwdDxtm`, `authenticated = r` |
| `exchange_rate_history` ACL | same | `postgres, service_role = arwdDxtm` |
| Policy "Admins can manage exchange rates" (`exchange_rates`, ALL, `profiles.role`) | present | dropped |
| Policy "Admins can read exchange rate history" (`exchange_rate_history`, SELECT, `profiles.role`) | present | dropped |
| Policy "Users can read enabled exchange rates" (`exchange_rates`, SELECT, authenticated, `is_enabled = true`) | present | kept (re-recorded with the same definition) |
| RLS | on, both tables | on (recorded) |
| `log_exchange_rate_change()` | owner `postgres`, ACL `{postgres=X, service_role=X}`, `proconfig` none, definer rights | `proconfig = {search_path=public, pg_temp}`, ACL unchanged |
| Trigger `exchange_rate_change_trigger` | AFTER UPDATE, FOR EACH ROW, on `exchange_rates` | same, re-recorded |

**Callers after 1b:** the slice 1a admin route reads and writes through `supabaseServer` (service role, keeps its grants, bypasses RLS). `CurrencySelector` / `currencyHelpers` keep the `authenticated` enabled-row read. Nothing else in the product reads either table from the browser (SA-R5).

**History trigger (§5.4, AC 5):** the live definition (captured in [SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md](/docs/investigations/SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md)) writes `currency_code`, `old_rate`, `new_rate`, `changed_by` and `changed_at` whenever `rate_to_usd` changes. That is the three facts §5.4 needs, so **no new table and no new trigger body**; the migration only re-records the trigger. The "one test update on prod writes a history row" criterion is a user step in the runbook (§6, step 6).

**Pipeline phase:** none (no V6 / plugin code). No import from `lib/business-os/entitlements/` (SA-R16). No app code change: SQ-1 was done in 1a.

---

## 3. Implementation approach

1. **Number.** `20261082`. Re-checked at build time: highest on `origin/main` is `20261081`; no file numbered `20261082` or higher in the history of any of the 355 remote branches, in `supabase/held/` or in `supabase/SQL Scripts/`. The slice 1a branch (PR #477) adds no migration.
2. **Migration** `supabase/migrations/20261082_admin_exchange_rates_lockdown.sql`, in the house lockdown style (`20261051`, `20261059` to `20261062`): `BEGIN`, `SET LOCAL lock_timeout = '5s'`, a pre-check `DO` block that raises "so nothing was applied", the statements, a post-assert `DO` block, `COMMIT`. No comment lines, ASCII only, never the SQL editor word, no apostrophes.
   - **Pre-check:** the function exists, is owned by `postgres`, runs with definer rights, and its `proconfig` is null **or already the pinned value** (so a re-run is a no-op, not a failure; this widens SA-R14 "proconfig is null" only for an idempotent re-run). Exactly one `pg_depend` row references the function, and it is `exchange_rate_change_trigger` on `exchange_rates`. Both tables must exist and be owned by `postgres` (the record is documentary on prod; check 35 R1 / R2 prove it). The live trigger is AFTER UPDATE FOR EACH ROW, enabled, with no column list and no WHEN clause, so re-recording it changes nothing.
   - **Record:** `CREATE TABLE IF NOT EXISTS` for both tables with the live columns, defaults, checks, primary key, unique key, the four live secondary indexes (`CREATE INDEX IF NOT EXISTS`, DV-4) and the two FKs under their live names (`exchange_rates_updated_by_fkey`, `exchange_rate_history_changed_by_fkey`, from the purge schema dump). `ENABLE ROW LEVEL SECURITY` on both.
   - **Policies:** `DROP POLICY IF EXISTS` for the two `profiles.role` policies. "Users can read enabled exchange rates" is re-recorded with `DROP POLICY IF EXISTS` + `CREATE POLICY` (same definition, same transaction). No `is_platform_admin()` policy (SQ-2).
   - **Grants:** `REVOKE ALL ... FROM PUBLIC, anon` on both; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ... FROM authenticated` on `exchange_rates`; `REVOKE ALL ... FROM authenticated` on `exchange_rate_history`. `service_role` untouched.
   - **Function:** `ALTER FUNCTION ... SET search_path = public, pg_temp`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`. The function is never re-created.
   - **Trigger:** `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` with the live definition, the function now schema-qualified.
   - **Post-assert:** every grant, policy, `proconfig`, EXECUTE and trigger fact the checker checks, plus row security on and **not forced** on both tables (SA optional suggestion, taken: history has no policy after 1b, so FORCE could refuse the trigger insert and every rate save; live value false on both, TL read-only 2026-10-19); any miss raises and the whole transaction rolls back.
3. **Rollback** `supabase/SQL Scripts/20261082_admin_exchange_rates_lockdown_rollback.sql`: restores the live grants of §2 exactly (`GRANT ALL` to `anon` and `authenticated` on both tables gives back `arwdDxtm`) and `ALTER FUNCTION ... RESET search_path`. It does **not** re-create the two `profiles.role` policies (DV-6); their exact text is in §6 as a manual, gated step. It leaves the tables, the kept policy, RLS, the trigger and the function ACL alone (unchanged by the migration). Post-assert in the same transaction.
4. **Check 35** `scripts/check-bos-exchange-rates-write-access.sql`, extended in place and still one read-only statement: rows of `check_name`, `result` (`PASS` / `FAIL`), `detail`, a `VERDICT` row first (the slice 5 checker style). The original per-table, per-role facts stay, as `detail` text of the `D` rows. New rows: no `profiles.role` policy, anon has nothing, authenticated has SELECT only on rates and nothing on history, the enabled-rows policy present and exact, `search_path` pinned, EXECUTE only `postgres` and `service_role`, trigger present, service_role kept, RLS on and not forced (`C12`). 24 checks in all. Record rows (`R`) compare the live columns with the repo record: a FAIL there means the record is off, not that the lockdown failed.
5. **Tests** `supabase/migrations/__tests__/admin-exchange-rates-lockdown.migration.test.ts`: statement order, the exact grant / policy / function statements, the pre-check and post-assert raises, no function re-create, no `is_platform_admin()` policy, paste safety, rollback restores exactly the live ACL and policies, check 35 rows, number uniqueness, planted controls. The existing check 35 block in `business-os-finance-snapshots.migration.test.ts` (FF-1a) is updated to the new shape (its "FF-2 revokes writes only" header text is superseded by 1b).
6. **SECDEF docs:** `log_exchange_rate_change` leaves the parked S7 list (47 → 46) in the inventory §6 and the requirement FR-7 / S7 row. No code or test pins the 47 list (grep: only docs), and the S6 guard is unaffected (no file in this slice holds a definer-rights `CREATE` or `ALTER`).

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `supabase/migrations/20261082_admin_exchange_rates_lockdown.sql` | create | The migration (§3.2) |
| `supabase/SQL Scripts/20261082_admin_exchange_rates_lockdown_rollback.sql` | create | Rollback (§3.3) |
| `scripts/check-bos-exchange-rates-write-access.sql` | modify | Check 35 extended to PASS / FAIL rows (§3.4) |
| `supabase/migrations/__tests__/admin-exchange-rates-lockdown.migration.test.ts` | create | Source tests (§3.5) |
| `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts` | modify | Check 35 block follows the new shape |
| `docs/investigations/SECURITY_DEFINER_FUNCTIONS_INVENTORY.md` | modify | S7 list 47 → 46 |
| `docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md` | modify | S7 row / FR-7 note 47 → 46 |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md` | create | This workplan |

## Task List

- ✅ Step 1: Re-check the migration number (origin/main, 355 remote branches, held, SQL Scripts): `20261082` free
- ✅ Step 2: Workplan (this file)
- ✅ Step 3: Migration
- ✅ Step 4: Rollback
- ✅ Step 5: Check 35 extended
- ✅ Step 6: Migration source tests + finance check 35 block updated
- ✅ Step 7: SECDEF inventory and requirement S7 47 → 46
- ✅ Step 8: Run the new tests, the finance migration test, the SECDEF guard (`npm run test:authz-guard`) and the migration test folder

## 4. Deviations from the brief

| # | What | Why |
|---|---|---|
| DV-1 | `MAINTAIN` is revoked from `authenticated` on `exchange_rates` too, and `PUBLIC` is named in the anon revoke | Prod is PostgreSQL 17 (`m` in the live ACL). Without it, `authenticated` keeps `MAINTAIN` and "SELECT only" is false. Same as the `20261062` precedent, which checks `MAINTAIN`. `PUBLIC` holds nothing today, so naming it is a no-op |
| DV-2 | Pre-check accepts `proconfig` null **or** already `search_path=public, pg_temp` | Idempotent re-run. Any other value still raises |
| DV-3 | The kept policy is re-recorded (`DROP POLICY IF EXISTS` + `CREATE POLICY`, same definition) | So the repo holds it. Same transaction, so no window without it |
| DV-4 | ✅ **Resolved 2026-10-19.** Was: only the primary key and the unique key recorded, because the first live facts listed no other index | TL ran a read-only index query on prod (2026-10-19): four secondary indexes exist (`idx_exchange_rates_currency_code`, `idx_exchange_rates_enabled`, `idx_exchange_rate_history_changed_at`, `idx_exchange_rate_history_currency`). The migration now records all four with `CREATE INDEX IF NOT EXISTS`, same names and definitions. Check 35 row `R2` expects exactly 4 indexes on `exchange_rates` and 3 on `exchange_rate_history`, and the exact `pg_get_indexdef` text of the four. The migration test pins all of it |
| DV-5 | The main requirement (§1 progress row) is not updated in this branch | It lives on the slice 1a branch (PR #477), not on `main`; editing it here would conflict. TL splices the 1b status in after #477 merges |
| DV-6 | **The rollback script does not re-create the two `profiles.role` policies.** The brief asked for "today's state exactly" | The required admin authz guard (`lib/admin/__tests__/admin-authz-surface.guard.test.ts`, rule R5, FR-17) fails **any** `.sql` file under the scanned roots that creates a policy keyed on `profiles.role`, rollbacks included, and its allow-list is pinned at zero ("genuinely zero"). `profiles.role` is user-writable, so those policies are a self-promotion hole. Since slice 1a, no browser path needs them: the admin page reads and writes through the service-role route. Adding an R5 exemption or hiding the policy in dynamic SQL would defeat the guard, so neither was done. The exact statements are in §6, rollback step 4, as a manual step gated on SA and the user. **SA to rule** |

## 5. Risks

| Risk | Mitigation |
|---|---|
| Applied before 1a is deployed: the old page's browser history read fails | Runbook precondition: PR #477 deployed to prod |
| `CREATE TABLE IF NOT EXISTS` text differs from live | No-op on prod (tables exist). Check 35 `R` rows compare columns, types, nullability, defaults and indexes |
| Trigger re-create takes a short exclusive lock on `exchange_rates` | 43 rows, `lock_timeout = 5s`; on timeout nothing is applied, run again |
| `search_path` pin breaks the trigger body | Body is fully schema-qualified (`public.exchange_rate_history`) and `NOW()` is `pg_catalog`; runbook step 6 exercises the trigger once |

---

## 6. Apply runbook (user, by hand, Supabase SQL editor, production)

**Precondition:** PR #477 (slice 1a) is merged **and deployed to prod**, and the `/admin/exchange-rates` page saves a rate through the new route. Do not apply before that.

1. **Before:** new SQL editor tab, paste `scripts/check-bos-exchange-rates-write-access.sql` (check 35), run. Expected: **`VERDICT FAIL, 12 pass 12 fail`**. The 12 FAIL rows must be exactly the gaps 1b closes: `C1` x2 (`profiles.role` policies), `C2` x2 (anon grants), `C3`, `C4` (authenticated grants), `C6` (2 policies on rates, 1 on history), `C9` (`search_path` not pinned) and `D` x4. **Any other FAIL** (in particular `C5`, `C10`, `C11`, `C12` or any `R` row) means stop: do not apply, send the result to the session.
2. **Apply:** new tab, paste `supabase/migrations/20261082_admin_exchange_rates_lockdown.sql` in full, run. Expected: `Success. No rows returned`. Any error message ending in "so nothing was applied" means the transaction rolled back and nothing changed: send it to the session.
3. **Check:** new tab, paste check 35 again, run. Expected: **`VERDICT PASS, 24 pass 0 fail`**, every row `PASS`. Send the result to the session.
4. **Page:** on `/admin/exchange-rates`, save one rate and toggle one non-USD currency off and on. Both must work (AC 6).
5. **Picker:** as a signed-in non-admin, open Settings and confirm the currency picker lists the enabled currencies (AC 4).
6. **History (AC 5):** the save in step 4 changed a rate. In the SQL editor run `select currency_code, old_rate, new_rate, changed_by, changed_at from public.exchange_rate_history order by changed_at desc limit 1;` Expected: the row for that change, with the old rate, the new rate and the time. Put the rate back through the page if it was only a test.

**Rollback** (only if steps 3 to 6 fail and the session agrees):

1. New tab, paste `supabase/SQL Scripts/20261082_admin_exchange_rates_lockdown_rollback.sql`, run. It restores today's grants (`anon` and `authenticated` = `arwdDxtm` on both tables) and resets the function `search_path`. It does not put back the two `profiles.role` policies (DV-6).
2. Run check 35: expect **`VERDICT FAIL, 15 pass 9 fail`**. The 9 FAIL rows are exactly the restored grants and `search_path`: `C2` x2, `C3`, `C4`, `C9` and `D` x4. `C1`, `C5`, `C6` stay PASS (no `profiles.role` policy comes back), as do `C7`, `C8`, `C10`, `C11`, `C12` and the `R` rows.
3. Tell the session; the migration stays in the repo but is recorded as rolled back.
4. **Not an approved rollback step (SA, DV-6 / SQ-2).** The two statements below are kept only as the record of the live definitions of 2026-10-19. Re-creating them would need a new requirement decision by BA, SA and the user, because it re-opens the `profiles.role` self-promotion path (`profiles.role` is user-writable). They are not in a `.sql` file because the required R5 admin authz guard refuses them in any repo SQL file. Do not run them as part of this rollback.

```sql
CREATE POLICY "Admins can manage exchange rates" ON public.exchange_rates AS PERMISSIVE FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
CREATE POLICY "Admins can read exchange rate history" ON public.exchange_rate_history AS PERMISSIVE FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
```

---

## SA Review Notes

### SA code review

**Code Review by SA — 2026-10-19**
**Status:** ✅ Code Approved, with two small conditions (CR-1 and CR-2, docs only; no SQL change needed)

Reviewed in the worktree `neuronforge-fx-rates-1b` (branch `feature/admin-exchange-rates-1b` off `c60e2f93`, uncommitted): the migration, the rollback, check 35, the new migration test, the edited finance migration test, and the two SECDEF docs. Tests re-run by SA: the new test, the finance test and the admin authz guard (3 suites, 208/208); the SECDEF surface guard plus the whole `supabase/migrations/__tests__` folder (50 suites, 2704/2704). SA did not re-query prod. The live facts below were checked against §2, the slice 5 record (`20261051`) and the captured definitions. The migration's own pre-check and runbook step 1 are the live gate.

#### Rulings on the deviations

| # | Ruling |
|---|---|
| DV-1 | ✅ **Accepted.** Prod is PG17 (`m` in the ACL), so without `MAINTAIN` "authenticated holds SELECT only" would be false. Naming `PUBLIC` is a no-op today and closes the inherit path. Same as the `20261062` precedent |
| DV-2 | ✅ **Accepted.** Accepting `proconfig` as either null or exactly `{search_path=public, pg_temp}` is what keeps a re-run idempotent. Any other value still raises, which is the intent of SA-R14 |
| DV-3 | ✅ **Accepted.** Dropping and re-creating the kept policy in the same transaction leaves no window without it, and puts the policy in the repo. The post-assert pins its exact shape |
| DV-4 | ✅ **Accepted as resolved.** The four live secondary indexes are recorded, and R2 pins the count (4 / 3) and the exact `pg_get_indexdef` text. Optional, later: `idx_exchange_rates_currency_code` duplicates the unique-key index. Record it as-is now; do not drop it in this slice |
| DV-5 | ✅ **Accepted.** TL splices the 1b status into the main requirement after #477 merges (standing rule: always update the main requirement) |
| DV-6 | ✅ **Accepted. TL view confirmed.** The rollback needs only the grants and the `search_path` reset. Reasons: (a) SQ-2 already ruled that no admin policy exists after 1b; (b) since 1a, the admin page reads and writes only through the service-role route, so no product path uses the two policies; (c) `profiles.role` is user-writable, and CLAUDE.md § Security Rules forbids it as an admin source; (d) the required R5 guard rightly refuses the text in any repo `.sql`, and an exemption or dynamic SQL would defeat it. Note also that once the policies are gone, the rollback's `GRANT ALL` changes nothing a browser can do through PostgREST: RLS with no matching policy still refuses every row read or write except the enabled-rows read. The one change in the rollback that matters is the `search_path` reset, the only migration change that could break the trigger. That is the right shape for this rollback. See CR-1 for the §6 step 4 wording |

#### Verification of the review items

| # | Item | Result |
|---|---|---|
| 1 | Live ACL facts | ✅ Consistent. Tables owned by `postgres`, `anon` / `authenticated` / `service_role` = `arwdDxtm` (§2, the FF-1a check 35 history). Function `{postgres=X, service_role=X}` matches what `20261051` left, and `proconfig` is null (the definitions doc: no `SET search_path`). The pre-check refuses on any drift in owner, definer rights, config, trigger shape or dependents |
| 2 | 1a route still works | ✅ `ExchangeRatesRepository` writes through `supabaseServer` with `.update(` only, never touching history. `service_role` grants are untouched, the test pins that no REVOKE names it, and C8 plus the post-assert check SELECT/INSERT/UPDATE/DELETE. The trigger fires regardless of EXECUTE (EXECUTE is checked only at `CREATE TRIGGER`, as proven in slice 5's D1), and `service_role` keeps EXECUTE anyway. The function is SECURITY DEFINER and owned by `postgres`, the owner of `exchange_rate_history`, so its insert needs no grant or policy. It works today with no INSERT policy on history, which shows RLS is not forced there, and 1b does not change that. The `search_path` pin is safe: the body writes `public.exchange_rate_history`, and `NOW()` resolves through the implicit `pg_catalog` |
| 3 | CurrencySelector read | ✅ `authenticated` SELECT kept (the only `exchange_rates` revoke for it omits SELECT/ALL, pinned by the test). The enabled-rows policy is re-created and asserted exactly. One behaviour change, which SA accepts as correct: `CurrencySelector` calls `getAllRates()`, so an account with `profiles.role = 'admin'` used to see disabled currencies in the picker through the old ALL policy. After 1b it sees enabled ones only, like every other user |
| 4 | Idempotency / re-run | ✅ A second run passes the pre-check (DV-2). Every DROP is `IF EXISTS`, the revokes are no-ops, the ALTER sets the same value, the trigger is re-created identically, and the post-assert passes. By construction the `CREATE TABLE IF NOT EXISTS` statements never create anything, because the pre-check raises when either table is missing. That is fine, since the function is prod-only, and R1/R2 prove the record. The §3.2 wording "If the tables exist, they are owned by postgres" understates this (see the suggestions) |
| 5 | Transaction / lock_timeout | ✅ One `BEGIN ... COMMIT`, `SET LOCAL lock_timeout = '5s'` first. The access-exclusive locks (RLS enable, policy drop/create, trigger drop) are held only for the transaction, on a 43-row table. On timeout the whole thing rolls back. The rollback has the same shape |
| 6 | Editor-breaking word | ✅ None in the migration, the rollback or check 35 (SA grep, plus the test's `/into/i`). Migration and rollback are ASCII-only, with no comments, no doubled apostrophe and an allow-list of punctuated literals. Check 35 keeps `--` comments, which is acceptable for the checker style |
| 7 | Post-check block | ✅ It covers RLS on, no `profiles` policy, no column ACLs, all eight privileges for `public`/`anon`/`authenticated` (SELECT exempt only on rates for authenticated), service_role's four, the policy counts (1 / 0), the exact kept policy, the pinned config, no client EXECUTE, service_role EXECUTE, and the trigger present. Any miss raises inside the transaction |
| 8 | Check 35 | ✅ 23 checks plus the VERDICT row (C1×2, C2×2, C3, C4, C5, C6, C7×2, C8×2, C9, C10, C11, D×4, R1×2, R2×2). **Before:** VERDICT FAIL, **11 pass 12 fail**. The FAIL rows are C1×2, C2×2, C3, C4, C6, C9 and D×4. C5, C7, C8, C10, C11 and every R row PASS, provided the record matches live (that is what runbook step 1 checks). **After:** VERDICT PASS **23 pass 0 fail**. **After a rollback:** 14 pass 9 fail (C2×2, C3, C4, C9, D×4), as §6 rollback step 2 says. The checker is one read-only SELECT, still pinned by the finance test's read-only rule |
| 9 | Runbook order | ✅ The precondition is explicit: #477 merged **and deployed**, and the page saves through the new route. This matters because before 1a deploys, the old page reads history from the browser, and 1b removes that path |
| 10 | No authenticated history read after 1a | ✅ `git grep exchange_rate_history` on the 1a worktree (`12dde50e`) finds only the admin route header, `ExchangeRatesRepository` (service role), its test, the types, purge descriptors and baseline, the cleanup generator and scripts, and the operator cleanup migrations and rollbacks (SECURITY DEFINER `operator_test_account_cleanup`, owner rights). Nothing reads it as `authenticated`. `CurrencyService`'s `exchange_rates` writers (`:128`, `:238`) stay unwired (SQ-1) |

#### Code review comments

1. **CR-1** `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1B_WORKPLAN.md` §6 rollback step 4. Reword it so the policies are not an approved rollback step. Suggested lead: "Not an approved rollback step (SA, DV-6 / SQ-2). The two statements are kept only as the record of the live definitions of 2026-10-19. Re-creating them would need a new requirement decision by BA and SA and the user, because it re-opens the `profiles.role` self-promotion path." Keep the SQL text and the `DV-6` token, because the migration test pins both. Priority: **Medium**. This is a condition for commit, docs only.
2. **CR-2** §6 apply step 1. Add the exact expected numbers, so the user can compare without reading rows: before `VERDICT FAIL`, **11 pass 12 fail**, FAIL on C1×2, C2×2, C3, C4, C6, C9 and D×4 only; step 3 `23 pass 0 fail`. Any other FAIL row before the apply (in particular C5, C10, C11 or an R row) means stop and send the result. Priority: **Low**. This is a condition for commit, docs only.
3. No `console.*` in any touched file (all SQL, a Jest test and docs). No entitlements import, no route, no repository, no plugin, so no skill checklist applies beyond `business-os-schema-check` (done via the live column, constraint and index facts plus R1/R2).

#### Optimisation suggestions (non-blocking)

- Add `NOT relforcerowsecurity` for `exchange_rate_history` to the post-assert and check 35 (one row). History has zero policies after 1b. If anyone ever sets FORCE, the definer-rights insert would be refused, and every rate save would fail with it. Today's behaviour proves FORCE is off, so this is only a tripwire. Optional, and it can wait for a later slice.
- §3.2: change "If the tables exist, they are owned by postgres" to "Both tables must exist and be owned by postgres (the record is documentary on prod; R1/R2 prove it)".
- The rollback's read-me row says it gives "full write access" back. Given DV-6, the grants come back but RLS still refuses every browser row write. The wording is conservative and safe, so leave it unless it is being edited anyway.
- SECDEF requirement S7 row: the residual sentence still says "any of the 47". This is cosmetic, and it is fine to leave it until S7 is un-parked.

### Code Approved for QA: Yes, with CR-1 and CR-2 applied before RM commits (docs only, no re-review needed)

## QA Testing Report

### QA report

**QA — 2026-10-19**
**Test mode:** full
**Strategy used:** A (Jest source tests over the SQL text: there is no branch database) + static review of the three SQL files + a CRLF simulation. No database was touched, and QA ran no live query.
**Focus:** schema, security
**Skipped:** live apply and runbook steps 3 to 6 (user-only, prod by hand); live read-only queries (no DB tool in this session)
**Input source:** TL prompt

#### Test runs (worktree `neuronforge-fx-rates-1b`, uncommitted)

| Run | Result |
|---|---|
| `supabase/migrations/__tests__/admin-exchange-rates-lockdown.migration.test.ts` | ✅ 1 suite, **48 / 48** |
| `npm run test:authz-guard` (admin authz guard + SECDEF surface guard) | ✅ 2 suites, **203 / 203** |
| `supabase/migrations/__tests__` + `supabase/__tests__` + `scripts/__tests__` (all three present) | ✅ **58 suites, 3133 / 3133** |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` alone | ✅ 1 suite, **119 / 119** |
| `business-os-finance-snapshots.migration.test.ts` (edited check 35 block), alone | ✅ 41 / 41 (also inside the 3133) |
| CRLF simulation: the migration, rollback, check 35, definitions doc and this workplan copied to a scratch root with every line ending as CRLF, and the new test run against them (`process.cwd()` root) | ✅ 48 / 48. A planted extra statement in the CRLF migration was caught (1 failed), which proves the run read the CRLF copies |

#### Static checks

| Item | Migration `20261082` | Rollback `SQL Scripts/20261082_..._rollback.sql` | Check 35 |
|---|---|---|---|
| ASCII only, no BOM | ✅ (`file`: ASCII text; first bytes `BEG`) | ✅ (first bytes `SEL`) | ✅ (first bytes `-- `) |
| The SQL editor word (substring, case-insensitive) | ✅ 0 hits | ✅ 0 hits | ✅ 0 hits, comments included |
| Comments | none | none | `--` header comments only (checker style, accepted by SA) |
| Line endings on disk | LF (0 CR) | LF (0 CR) | LF (0 CR). `core.autocrlf=true`, so Windows checkouts will get CRLF. Every reader normalises `\r\n` (new test `read()`, finance test `read()`), and the CRLF run above passes |
| Single transaction | ✅ `BEGIN` → `SET LOCAL lock_timeout = '5s'` → pre-check `DO` → statements → post-assert `DO` → `COMMIT`. Any `RAISE` rolls everything back | ✅ same shape. The warning `SELECT` sits before `BEGIN`, read-only | n/a: one read-only `SELECT` |

The editor word appears only in places that are never pasted: the new test file (a header comment at line 15, the `/into/i` assertions, a planted `'INSERT INTO x'` string literal at line 158, and line 283, a regex over the definitions doc) and the function body in `SECDEF_PROD_ONLY_FUNCTION_DEFINITIONS.md` (the `INSERT INTO public.exchange_rate_history` keyword). That body is exactly why the migration never re-creates the function (SA-R14).

**Grants against the requirement and SA-R14:**

| Rule | Where | Result |
|---|---|---|
| anon has nothing | `REVOKE ALL ... FROM PUBLIC, anon` on both tables; the post-assert loops all 8 privileges for `public` / `anon`, plus no column ACLs | ✅ |
| authenticated: SELECT only on `exchange_rates` | `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ... FROM authenticated` (no SELECT / ALL); the post-assert exempts only that one cell and separately asserts SELECT is kept | ✅ |
| authenticated: nothing on history | `REVOKE ALL ON TABLE public.exchange_rate_history FROM authenticated`; post-assert | ✅ |
| service_role keeps its grants | no REVOKE names it (test-pinned); the post-assert requires S/I/U/D on both tables | ✅ |
| Function `search_path` pinned | `ALTER FUNCTION ... SET search_path = public, pg_temp`; the post-assert requires `proconfig = {search_path=public, pg_temp}`. Safe: the body writes `public.exchange_rate_history` and `NOW()` is `pg_catalog` | ✅ |
| Function EXECUTE for service_role only | `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role`; the post-assert loops `public` / `anon` / `authenticated`, and check 35 C10 requires the grantee set to be exactly `postgres service_role` (owner implicit) | ✅ |
| Policies | both `profiles.role` policies dropped; the kept enabled-rows policy re-created and asserted exactly; counts 1 / 0; no `is_platform_admin()` policy (SQ-2) | ✅ |
| Function not re-created | no `CREATE FUNCTION` / `DROP FUNCTION` / `SECURITY DEFINER` text (test-pinned) | ✅ |

`MAINTAIN` makes the migration, the rollback and check 35 PG17-only. That is correct for prod (DV-1). On a PG16 copy they would error, and the migration would roll back cleanly.

#### Rollback against the §2 live facts

| §2 fact before 1b | Migration changes it? | Rollback restores it? |
|---|---|---|
| `anon`, `authenticated` = `arwdDxtm` on both tables | yes | ✅ `GRANT ALL ... TO anon, authenticated` (PG17 ALL = `arwdDxtm`); the post-assert checks all 8 for both, plus service_role |
| `PUBLIC` holds nothing | no-op revoke | ✅ n/a |
| `service_role` = `arwdDxtm` | no | ✅ untouched |
| Function `proconfig` null | yes | ✅ `RESET search_path`; the post-assert requires null |
| Function ACL `{postgres=X, service_role=X}` | no-op revoke / grant | ✅ untouched |
| Kept enabled-rows policy | re-created, same definition | ✅ left as is; the post-assert checks it is present |
| RLS on, trigger, tables, indexes | re-recorded, identical | ✅ untouched |
| Two `profiles.role` policies | dropped | ⚠️ **Not restored. Known item DV-6**, accepted by SA. Their text is kept only in §6, rollback step 4 (CR-1 rewording still open) |

So, apart from DV-6, the rollback brings back exactly the §2 state. Check 35 after a rollback gives 14 pass, 9 fail (C2×2, C3, C4, C9, D×4), which matches §6 rollback step 2. QA recounted this independently and agrees with SA item 8.

#### Apply runbook walk (§6)

| Step | Pasteable in the SQL editor? | Expected result stated? |
|---|---|---|
| Pre: #477 deployed, the page saves | n/a (a check in the app) | ✅ |
| 1 Before: check 35 | ✅ one file, one SELECT | ⚠️ Partly. It says `VERDICT FAIL` and names the gaps, but it gives no counts and does not list C6 (2 policies on rates, 1 on history) or the D rows among the expected FAILs. QA recount: **11 pass 12 fail**, FAIL = C1×2, C2×2, C3, C4, C6, C9, D×4. This is SA **CR-2**, still open |
| 2 Apply | ✅ one file | ✅ `Success. No rows returned`, and any "so nothing was applied" error means nothing changed |
| 3 Check 35 again | ✅ | ✅ `VERDICT PASS`, every row PASS (add "23 pass 0 fail" per CR-2) |
| 4 Page save + toggle | n/a (UI) | ✅ both must work |
| 5 Picker as non-admin | n/a (UI) | ✅ lists the enabled currencies |
| 6 History row | ✅ a one-line lowercase `select`, with no editor word | ✅ old rate, new rate, time. `changed_by` comes from `NEW.updated_by`, so it holds whatever the route writes there |
| Rollback 1 to 3 | ✅ | ✅ (counts as above) |
| Rollback 4 | ✅ two statements, with no editor word | wording is CR-1 (open) |

#### Issues Found

**Bugs (must fix before commit):** none in the SQL, the check script or the tests.

**Docs conditions already raised by SA, still open (they block commit per SA, not new):**
1. CR-2: §6 step 1 lacks the expected counts (11 pass 12 fail), and its FAIL list omits C6 and the D rows. Step 3 lacks "23 pass 0 fail". Low.
2. CR-1: §6 rollback step 4 still reads as an approved step. Medium.

**Edge cases (nice to fix):**
1. The rollback's warning `SELECT 'WARNING ...' AS read_me_first` runs before `BEGIN`. The Supabase SQL editor shows only the last statement's result (`COMMIT`, no rows), so a user pasting the whole file will most likely never see the warning. The real safeguard is the runbook text. Moving the warning into §6 rollback step 1 wording (it is partly there already), or telling the user to read the file's first line, would make it effective. Low; no change to the script is required.
2. The PG17-only `MAINTAIN` privilege (see above) is correct for prod but would fail on any older-version copy. Informational.

#### Final Status
- [x] All slice 1b acceptance criteria that can be tested before apply pass at source level. The AC on "check passes on prod", the trigger test update, and the 1a page and picker still working are user steps after the prod apply (§6 steps 3 to 6)
- [ ] Ready for commit once SA CR-1 and CR-2 (docs only) are applied. No High or Medium code bug is open

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-19 | Created | Dev workplan and build for slice 1b; number `20261082`; deviations DV-1 to DV-6 |
| 2026-10-19 | DV-4 resolved | Four live secondary indexes (TL read-only query) recorded in the migration; check 35 R2 expects 4 and 3 indexes and their exact definitions; test updated |
| 2026-10-19 | SA code review | Code approved with two docs-only conditions (CR-1: reword §6 rollback step 4 as not an approved step; CR-2: add the expected check 35 counts, 11 pass 12 fail before and 23 pass 0 fail after). DV-1 to DV-6 accepted. DV-6 confirmed: the rollback restores the grants and `search_path` only. Tests re-run: 208/208 and 2704/2704 |
| 2026-10-19 | QA report | PASS-WITH-NOTES. New test 48/48, test:authz-guard 203/203, supabase/migrations + supabase + scripts tests 58 suites 3133/3133, admin authz guard 119/119, CRLF simulation 48/48. SQL is ASCII with no BOM and no editor word, runs in one transaction, and its grants match the requirement. The rollback restores §2 except DV-6. No code bugs; CR-1/CR-2 still open; one edge case: the rollback warning row is not visible in the editor |
| 2026-10-19 | SA CR-1, CR-2 and C12 (Dev) | CR-1: §6 rollback step 4 reworded, the policies are not an approved step. CR-2: §6 expected check 35 counts. SA optional suggestion taken: `C12` (row security not forced on either table) in check 35 and the forced check in the migration post-assert, so 24 checks: before `12 pass 12 fail`, after `24 pass 0 fail`, after rollback `15 pass 9 fail`. §3.2 pre-check sentence corrected |
