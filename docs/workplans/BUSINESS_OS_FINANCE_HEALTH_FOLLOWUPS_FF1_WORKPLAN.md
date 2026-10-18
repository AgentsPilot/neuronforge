# Workplan: Finance follow-ups FF-1

> **Last Updated**: 2026-10-18

**Developer:** Dev
**Requirement:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md) §0.4, §11J (FU-M8-1, SA-Q80, BD-34), §11M.9 (checks 31 to 34); [8.1 workplan](/docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_8_1_SNAPSHOTS_MIGRATION_WORKPLAN.md) QA-81-N1; retrospectives [8.1](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_8_1_RETROSPECTIVE.md), [8.2](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_8_2_RETROSPECTIVE.md), [8.3](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_8_3_RETROSPECTIVE.md), [M-8](/docs/retrospectives/BUSINESS_OS_FINANCE_HEALTH_M8_RETROSPECTIVE.md)
**Branch:** `feature/bos-finance-followups` (from main `f7429b57`)
**Worktree:** `neuronforge-finance-m8` (node_modules is a junction: no `git worktree remove`, no `git stash`)
**Date:** 2026-10-18
**Status:** In Progress (FF-1b, FF-1c, FF-1d code complete, uncommitted; FF-1a waits for BQ-20)
**Path:** about 1 day. No migration, no API route, no money or figure change. Approval flow BD-33 (SA, QA and TL approve, then RM commits, opens the PR and turns on auto-merge), **except** that FF-1a carries BQ-20 (below); if TL treats BQ-20 as needing the user, FF-1a is split out and FF-1b to FF-1d ship alone.

## Overview

A small bundle of low-risk leftovers flagged by SA and QA across the finance slices, now that every slice through 8.3 is merged. FF-1 makes the redundant Exchange rates admin page read-only (FU-M8-1) and adds a read-only check that tells whether a browser session can still write the rate tables; adds the missing exact-pattern row for the metric CHECK to check 32 (QA-81-N1); extracts checks 33 and 34 from the requirement into script files (8.2 retrospective); and, subject to an SA ruling, adds a source guard against one-shot reads wider than the PostgREST 1,000-row cap (8.3 retrospective).

---

## Table of Contents

- [1. Inventory of open follow-ups](#1-inventory-of-open-follow-ups)
- [2. The bundle](#2-the-bundle)
- [3. Analysis Summary](#3-analysis-summary)
- [4. Implementation Approach](#4-implementation-approach)
- [5. Files to Create / Modify](#5-files-to-create--modify)
- [6. SQL](#6-sql)
- [7. Tests](#7-tests)
- [8. Guards and frozen pins](#8-guards-and-frozen-pins)
- [9. Acceptance criteria (proposed)](#9-acceptance-criteria-proposed)
- [10. Business question and SA-W questions](#10-business-question-and-sa-w-questions)
- [11. Verification Plan](#11-verification-plan)
- [12. Risks](#12-risks)
- [13. Estimate](#13-estimate)
- [14. Task List](#14-task-list)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Inventory of open follow-ups

Verified against the code at `f7429b57` on 2026-10-18. "Size" is Dev effort if taken.

| ID | Source | What it is | State in code at `f7429b57` | Size | In FF-1? |
|---|---|---|---|---|---|
| **FU-M8-1** | §11J SA-Q80; M-8 retro | Exchange rates page writes `exchange_rates` from the browser | **Open.** `app/admin/exchange-rates/page.tsx` still has `handleToggleEnabled` (direct `supabase.from('exchange_rates').update`, `:147-150`), `handleEditSave` (`CurrencyService.updateRate`, `:121-127`) and a dead `handleFetchCurrentRates` (third-party fetch plus writes, `:165-210`, no button calls it). The only callers of `updateRate` in the repo are this page (`:122`, `:191`) | 🟢 0.4 d | ✅ FF-1a |
| **QA-81-N1** | 8.1 workplan QA; 8.1 retro | Check 32 pins the dimension CHECK pattern (E-93) but not the metric CHECK; a hand-widened metric CHECK on prod passes check 32 and the self-test | **Open.** `scripts/check-bos-finance-snapshots-migration.sql` has 16 rows, only `dimension check is exactly the E-86 pattern`; the repo copy is pinned only by the migration test | 🟢 0.2 d | ✅ FF-1b |
| **Checks 33, 34 as files** | 8.2 retro (Low follow-up) | Checks 33 and 34 live only in §11M.9 text; checks 31 and 32 are script files | **Open.** No script file; the §11M.9 bodies were run through the paste-safety rules of the migration test: ASCII only, no editor word, no doubled quote, no quote in a comment, one statement each, LF | 🟢 0.15 d | ✅ FF-1c |
| **1,000-row paging guard** | 8.3 retro (C-1 lesson) | Mechanically flag a single `.range()` wider than the PostgREST 1,000-row cap | **Open (proposal only).** Today no non-test file under `lib/` or `app/` has a literal `.range(a, b)` span above 1,000, and the one paging constant (`FINANCE_SNAPSHOT_READ_PAGE_SIZE = 1000`) is at the cap, so a guard starts at zero offences | 🟢 0.25 d | ✅ FF-1d, **SA rules** (new pattern) |
| FU-4B2-1 | 4b.2 workplan DV-3 | Section 6 frame copy | ✅ **Done in slice** (SA-CR-4b2 CR-1) | — | No |
| FU-4B2-2 | 4b.2 workplan DV-5 | SQL checks 19 and 20 on the event rule | ✅ **Done in slice** (SA-CR-4b2 CR-2) | — | No |
| FU-4B-1 | 4b.1 workplan SA-W112; 4b.1 retro | A late `dispute.created` for a closed dispute reopens a paid boost row, so check 25 shows `dispute_ok = false` | Open, existing `20261031` webhook state-machine behaviour (RV-8). A webhook / money write change, not low risk | 🟡 | No (own slice with the boost module) |
| FU-M5-2 | M-5 SA-W9 | Refresh the costs components' header comments when the files move | Open, but moot until the SA-Q59 move happens | — | No |
| FU-M5-4 | M-5 retro | Optional: JSDoc comments still saying "AI cost & usage" | Open (optional). 44 hits of the phrase in `app/`, `lib/`, `components/`, comments and strings mixed; many files outside finance, some with `console.*` (would trigger the touched-file rule) | 🟡 | No (noise outside the finance page; separate copy chip if wanted) |
| FU-M5-6 | M-5 retro | Remove the temporary `?tab=costs` redirect once old links age out | Open; time-gated, nothing says the links have aged | — | No |
| FU-M4-3 | M-4 retro | Stale `typecheck:bos-llm` baseline entry for `app/api/onboarding/build/route.ts` | Entry still in `scripts/typecheck-bos-llm.baseline.json:4`; not a finance file, outside this stream | 🟢 | No (onboarding owner) |
| FU-4 | 1a / 1b retros | Share one ledger read for Section 3 and K-1 | Parked by design until the ledger grows | — | No |
| FU-1c-5 | 1c retro | A second billing row past a 1,000-row page boundary is not detected by R-c | Recorded residual, accepted under BD-16 (SA) | — | No |
| FU-4a-4 | 4a retro | Currencies off `refundMath`'s decimals lists are treated as two-decimal | Recorded (SA); boosts are USD only | — | No |
| FU-1b-3 | 1b retro | "No allowance" vs "Unknown" for a zero allowance | Product call for the user | — | No (business decision) |
| FU-1b-4 | 1b retro | Optional `metricParams` typing on the deps | Optional SA note; touching finance deps types risks the AC-173 / AC-145 surface for no behaviour gain | 🟢 | No |
| FU-6 / FU-1b-6 | 1a / 1b retros | Requirement header Status line stale | BA item; this plan does not edit the requirement | — | No (BA, at the next requirement edit) |
| FU-2b-5 / FU-M5-3 / F-layout FU-1 | retros | Wall-clock flaky tests (`qa-slice5-pr2`, `bosLens.render` P-8) | Chip already spawned elsewhere | — | No |
| FU-2b-6 | 2b retro | `schema:check` from a credentialed checkout | Needs credentials; user / QA | — | No |
| BQ-13, BQ-15 to BQ-19 | §0.4 | Business questions | Open with defaults | — | No (skipped as instructed) |
| Slices 3, 5b, 7; DF-3, DF-7, DF-9 | §0.1, §0.4 | Blocked or deferred streams | Blocked on volume / plan payments | — | No |

---

## 2. The bundle

| Item | What ships | Path |
|---|---|---|
| **FF-1a** | Exchange rates page read-only: the per-row enable toggle becomes a static status badge, the edit (pencil) control and its Save / Cancel are removed, the three write handlers and the `CurrencyService` import go. Reads, the history panel, Refresh and the page copy are unchanged. Plus **check 35**, a read-only SQL check of who can write `exchange_rates` and `exchange_rate_history` | BQ-20 default; UI plus one SQL file |
| **FF-1b** | Check 32 gains a 17th row, `metric check is exactly the shape pattern`, the metric twin of E-93 | SQL file plus its test |
| **FF-1c** | `scripts/check-bos-finance-history-days.sql` (check 33) and `scripts/check-bos-finance-history-newest.sql` (check 34), byte for byte from §11M.9 | Two SQL files plus tests |
| **FF-1d** | A source guard over `lib/repositories/` and `lib/business-os/`: no literal `.range(a, b)` spanning more than 1,000 rows, and no `*PAGE_SIZE` numeric constant above 1,000 | SA-W-FF-1 rules guard vs skill note vs both |

Not in FF-1: closing the write **in the database** (revoking INSERT / UPDATE / DELETE from `authenticated`). That is a production migration and depends on what check 35 shows; if check 35 shows a browser session can write, BA specifies it as FF-2 (one migration, user-applied, with its own pre and post checks).

---

## 3. Analysis Summary

| # | Fact | Where |
|---|---|---|
| VL-1 | `/admin/*` is gated server-side by `requireAdminPage()` in the admin layout; the Exchange rates page is a client component inside it, so FF-1a adds no route and no auth surface | `app/admin/layout.tsx:30`, `:41` |
| VL-2 | The page's reads are direct browser Supabase SELECTs on `exchange_rates` and `exchange_rate_history` (`:74-76`, `:90-92`). That is a CLAUDE.md rule 1 deviation, pre-existing; FF-1a leaves the reads as they are (BD-34: do not extend the page). Recorded, not widened | page |
| VL-3 | Write paths: `handleToggleEnabled` (direct UPDATE), `handleEditSave` and `handleFetchCurrentRates` (via `createCurrencyService(supabase).updateRate`). `handleFetchCurrentRates` has no caller in JSX (dead) | page `:113-210` |
| VL-4 | No other caller of `CurrencyService.updateRate`; `CurrencySelector` (user settings) only reads rates through `CurrencyService`, so the DB SELECT grant must stay | grep at `f7429b57` |
| VL-5 | The page has **0** `console.*` (M-8 RP-7). `lib/services/CurrencyService.ts` has 9 and `components/settings/CurrencySelector.tsx` 3; **neither is touched**, so the touched-file rule does not trigger. Flagged here for visibility only | grep |
| VL-6 | The page has 5 `catch (err: any)`. FF-1a removes the 3 in the write handlers; the 2 in the read loaders stay (no unrelated reformatting) | page `:81`, `:98` |
| VL-7 | M-8 guard `redundantPages.source.guard.test.ts` G-1 to G-5 apply to the page: the REDUNDANT header line must stay exact, `'use client'` first, no `AdminNotice` / redundant notice (G-3, BD-34 "no visible notice"), no `console.` (G-5). FF-1a adds no notice | guard `:51-80` |
| VL-8 | Check 32's dimension row uses `position(pattern in pg_get_constraintdef(c.oid)) > 0`, and the migration test pins it with `SNAPSHOT_DIMENSION_SHAPE.source`; the metric constraint is `^[a-z][a-z0-9_]{0,47}$`, equal to `SNAPSHOT_METRIC_SHAPE.source` | `scripts/check-bos-finance-snapshots-migration.sql:61-65`; `migration.test.ts:206-251`; `financeSnapshotShape.ts:19` |
| VL-9 | The migration test pins check 32's item list exactly (16 items, `:224-243`) and runs the paste-safety rules on checks 31 and 32 (`PASTED`, `:180`) | migration test |
| VL-10 | The metric pattern string is not a substring of the dimension constraint text (that one starts `^(`), so the new row cannot be satisfied by the wrong constraint; the row also filters by `conname` | migration |
| VL-11 | No literal `.range()` span above 1,000 exists today in `lib/` or `app/` (non-test); 57 `.range(` calls in `lib/repositories` and `lib/business-os/finance` use variables | grep |
| VL-12 | The seven frozen pins match at `f7429b57` (git blob, LF): AC-173 `3a1a2dd4…f6f8`, helper `b84e0c96…aabf`, A `30f5fc24…2e01`, B `24ff0da7…df9f`, C `98ea0507…1e4b`, helper `02813360…5bd8`, D `1f7cf07a…f144`. AC-145 baseline `39b35743…56ea` lives in `app/api/admin/business-os/finance/__tests__/route.test.ts` | `git show HEAD:<file> \| sha256sum` |

---

## 4. Implementation Approach

### FF-1a: Exchange rates read-only (FU-M8-1, BQ-20 default)

Minimal, subtractive edit of one file, no new component, no new pattern:

1. Delete `handleEditStart`, `handleEditCancel`, `handleEditSave`, `handleToggleEnabled`, `handleFetchCurrentRates`, and the state they alone use (`saving`, `editingRate`, `editedValue`, `fetchingRates`).
2. Remove `import { createCurrencyService } from '@/lib/services/CurrencyService'` and the icon imports that become unused (`Save`, `Edit`, `Check`, and any other the lint reports). `X` stays (alert dismiss).
3. The status cell: the toggle `<button>` becomes a `<span>` with the same classes minus the hover / cursor ones and the same "Enabled" / "Disabled" text. The actions cell keeps only the History button.
4. Header comment line 5 changes from "FU-M8-1: this page still writes exchange_rates from the browser; left as is by M-8." to "FU-M8-1 (FF-1, 2026-10-18): read-only; reads stay in the browser; whether the database still allows browser writes is check 35." The G-1 REDUNDANT line (line 3) is not touched.
5. Page copy ("Manage currency exchange rates for international billing"), the table, the history panel and Refresh stay byte-identical. **No visible notice** (BD-34, G-3).
6. `docs/MULTI_CURRENCY_SYSTEM.md`: the §11J pointer note and the Admin Management / Test Admin Panel notes say the page is read-only since FF-1, plus one Change History row.

Why not move the reads behind an admin API route: that extends a page BD-34 says not to extend, adds a route, a repository and tests (about 1 day on its own) for a page nobody uses. Recorded as residual R-2.

### FF-1a: check 35

`scripts/check-bos-exchange-rates-write-access.sql`, read only, one result set: one row per table (`exchange_rates`, `exchange_rate_history`) and role (`anon`, `authenticated`), showing whether the table exists, whether RLS is on, the role's SELECT / INSERT / UPDATE / DELETE grants, and the names of the write policies that apply to the role. The user runs it once; if any write grant is true **and** RLS is off, or a write policy applies, a browser session can still change rates, and BA opens FF-2. SQL in §6.1.

### FF-1b: check 32 metric row (QA-81-N1)

Insert one row after `dimension check is exactly the E-86 pattern`, in the same shape (§6.2). The 16-item test becomes 17 items (a ruled test edit, listed in §7) and gains a pin that check 32 contains `position('${SNAPSHOT_METRIC_SHAPE.source}' in pg_catalog.pg_get_constraintdef(c.oid))`. The header ("Every row must show ok = true") already covers the new row. Residual: like E-93, `position` proves the pattern is present, not that nothing was OR-ed onto it (SA-W-FF-2).

### FF-1c: checks 33 and 34 as files

Copy the §11M.9 fenced bodies byte for byte (LF). File names follow the `check-bos-*` convention: `scripts/check-bos-finance-history-days.sql` (check 33) and `scripts/check-bos-finance-history-newest.sql` (check 34). The requirement still says "pasted from here"; the pointer edit is a BA item at the next requirement edit (§12 R-5).

### FF-1d: 1,000-row paging guard (SA rules)

Default (SA-W-FF-1 option a): a Jest source guard `lib/repositories/__tests__/rangeCap.source.guard.test.ts` that walks `lib/repositories/` and `lib/business-os/` (non-test `.ts`), strips comments, and fails on (1) any `.range(<int>, <int>)` with `b - a + 1 > 1000`, and (2) any `const <NAME>PAGE_SIZE = <int>` above 1,000. Planted controls for each rule plus a walk-sanity assertion (it found `BusinessOsFinanceSnapshotReadRepository.ts`). It cannot judge variable spans; the header says so. Runtime is a file walk, well under a second, in the existing Jest job, which is not the critical path (`next build` is), so no added CI time. Option b, a note in the `new-repository` skill, is a configuration file change and needs the user's own go-ahead, so it is not in the default.

---

## 5. Files to Create / Modify

| File | Action | Item | Reason |
|---|---|---|---|
| `app/admin/exchange-rates/page.tsx` | modify | FF-1a | Remove the write handlers, state, imports and controls; line 5 comment. Subtractive except the status `<span>` |
| `app/admin/__tests__/redundantPages.source.guard.test.ts` | modify (additions only) | FF-1a | New `describe` G-6: the Exchange rates page has no write path, with planted controls. G-1 to G-5 untouched |
| `scripts/check-bos-exchange-rates-write-access.sql` | create | FF-1a | Check 35 |
| `docs/MULTI_CURRENCY_SYSTEM.md` | modify | FF-1a | Pointer notes say read-only; Change History row |
| `scripts/check-bos-finance-snapshots-migration.sql` | modify | FF-1b | One row added |
| `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts` | modify | FF-1b, FF-1c | 16 → 17 item list (ruled edit); metric pin; checks 33 and 34 added to `PASTED` and to a new describe |
| `scripts/check-bos-finance-history-days.sql` | create | FF-1c | Check 33 |
| `scripts/check-bos-finance-history-newest.sql` | create | FF-1c | Check 34 |
| `lib/repositories/__tests__/rangeCap.source.guard.test.ts` | create | FF-1d | Guard (if SA picks option a) |
| this workplan | modify | all | Audit trail |

Not touched: the requirement MD (BA owns it), the 20261078 migration and rollback, the self-test, `CurrencyService`, `CurrencySelector`, any finance route, page, deps, repository or pin file, `app/admin/components/layout/**`.

---

## 6. SQL

All three files: read only, ASCII only, no apostrophe in any comment, no doubled quote, the editor word never used, one final result set, LF. The migration test's paste-safety rules run on all of them (§7).

### 6.1 Check 35 (new file)

**File:** `scripts/check-bos-exchange-rates-write-access.sql`

```sql
-- Finance check 35: who can read or write the exchange rate tables, read only.
-- One row per table and role. The page is read only since FF-1, but a browser session
-- can still change rates when the role holds a write grant and either row level security
-- is off or a write policy applies to the role. Send the result to the session.
with t as (
  select v.tbl_name, to_regclass('public.' || v.tbl_name) as tbl
  from (values ('exchange_rates'), ('exchange_rate_history')) as v(tbl_name)
),
r as (
  select v.role_name, v.role_name::regrole::oid as role_oid
  from (values ('anon'), ('authenticated')) as v(role_name)
)
select t.tbl_name,
       r.role_name,
       t.tbl is not null as table_exists,
       coalesce((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t.tbl), false) as rls_on,
       case when t.tbl is null then null else has_table_privilege(r.role_name, t.tbl, 'SELECT') end as grant_select,
       case when t.tbl is null then null
            else has_table_privilege(r.role_name, t.tbl, 'INSERT') or has_any_column_privilege(r.role_name, t.tbl, 'INSERT') end as grant_insert,
       case when t.tbl is null then null
            else has_table_privilege(r.role_name, t.tbl, 'UPDATE') or has_any_column_privilege(r.role_name, t.tbl, 'UPDATE') end as grant_update,
       case when t.tbl is null then null else has_table_privilege(r.role_name, t.tbl, 'DELETE, TRUNCATE') end as grant_delete,
       (select string_agg(p.polname, ' ' order by p.polname)
          from pg_catalog.pg_policy p
         where p.polrelid = t.tbl
           and p.polcmd in ('a', 'w', 'd', '*')
           and (0::oid = any(p.polroles) or r.role_oid = any(p.polroles))) as write_policies
from t
cross join r
order by t.tbl_name, r.role_name;
```

Reading it: a browser write is possible when `grant_insert`, `grant_update` or `grant_delete` is true **and** (`rls_on` is false **or** `write_policies` is not null). Otherwise the write was already closed in the database and FF-1a is the whole fix.

### 6.2 Check 32, the new row

**File:** `scripts/check-bos-finance-snapshots-migration.sql` (inserted after the dimension row)

```sql
union all
select 'metric check is exactly the shape pattern',
  coalesce((select position('^[a-z][a-z0-9_]{0,47}$' in pg_catalog.pg_get_constraintdef(c.oid)) > 0
            from pg_catalog.pg_constraint c
            where c.conrelid = t.tbl and c.conname = 'business_os_finance_snapshots_metric_shape'), false) from t
```

### 6.3 Checks 33 and 34

Copied unchanged from requirement §11M.9 (the fenced bodies at the "check 33" and "check 34" headings). Not repeated here so there is one source until BA repoints the requirement.

---

## 7. Tests

| Test | Item | Kind | What it proves |
|---|---|---|---|
| G-6a in `redundantPages.source.guard.test.ts` | FF-1a | addition | Exchange rates code (comments stripped) has no `.update(`, `.insert(`, `.upsert(`, `.delete(`, `.rpc(`, `updateRate`, `createCurrencyService` or `fetch(` |
| G-6b | FF-1a | addition | Its only `supabase` calls are `.from('exchange_rates')` and `.from('exchange_rate_history')` with `.select(` |
| G-6 planted | FF-1a | addition | Each G-6 rule fails on a planted snippet (one per forbidden token) |
| G-1 to G-5 | FF-1a | unchanged | Header, no sidebar link, no notice, no product link, no `console.` still pass |
| Check 35 paste-safety | FF-1a | addition | The file is added to `PASTED`-style rules (in the migration test, or a sibling `scripts` test if SA prefers): ASCII, no editor word, no quote in a comment, no doubled quote, one statement, header names "Finance check 35" |
| `check 32 has its seventeen items` | FF-1b | **ruled edit** of the existing 16-item test: the title and the list gain `metric check is exactly the shape pattern` after the dimension row | The item list is exact |
| Metric pin | FF-1b | addition to the existing "names the six CHECKs" test | Check 32 contains `position('${SNAPSHOT_METRIC_SHAPE.source}' in pg_catalog.pg_get_constraintdef(c.oid))` |
| Checks 33 and 34 paste-safety | FF-1c | addition (`PASTED` gains `check33`, `check34`) | Same rules as 31 and 32 |
| Checks 33 and 34 shape | FF-1c | addition | One statement each; header line `-- Finance check 33:` / `-- Finance check 34:`; check 33 reads `bos_cron_runs` with `job = 'finance-snapshot'`; check 34 reads only `business_os_finance_snapshots`, `business_os_credit_lots`, `business_os_credit_lot_draws`, `business_os_account_plans`; neither has `insert`, `update`, `delete`, `alter`, `drop`, `create`, `grant`, `truncate` outside comments |
| `rangeCap.source.guard.test.ts` | FF-1d | new | Rules 1 and 2, planted controls, walk sanity |

Only one existing test line set changes (the 16-item list and its title). Everything else is additive. The suite count goes up; no test is deleted.

---

## 8. Guards and frozen pins

| Guard | Effect of FF-1 |
|---|---|
| AC-173 (and helper), Pins A, B, C (and helper), D | **Never opened.** Re-hashed at Step 0 and at handover with `git show HEAD:<file> \| sha256sum` and `git diff --quiet -- <file>`; must equal VL-12 |
| AC-145 baseline `39b35743…56ea` | No finance payload change; `route.test.ts` untouched |
| M-8 `redundantPages.source.guard` | G-1 to G-5 keep passing; G-6 added |
| OV-1 vocabulary guard (AST), M-5 wording pin D | No finance string changes |
| Admin layout guards (C-14 registry, contrast `PAGES`) | Exchange rates is a parked page outside them; no layout component touched |
| Finance source guard (`finance.source.guard.test.ts`) | No finance file touched; its `exchange_rates` ban is about finance files and is unaffected |
| Entitlements guard | No import from `lib/business-os/entitlements/` |
| Repository guards (RC-15 and the 8.2-R2 importer pin) | The new guard file reads files only; it imports no repository |
| CLAUDE.md rules | No new DB access path (rule 1; the remaining browser reads are pre-existing, R-2); no API route (rule 2, `requireAdmin` n/a); no `console.*` added (rule 3); no hardcoded model (rule 5); no new `any` (rule 6); FF-1d is a new guard pattern for SA (rule 7) |
| CI time | Source scans and SQL text tests only, in the Jest job; nothing added to the `next build` critical path |

---

## 9. Acceptance criteria (proposed)

Numbered FF-AC here; BA assigns AC numbers when splicing into the requirement.

| # | Criterion |
|---|---|
| FF-AC-1 | The Exchange rates page shows the same rates, status text, history and copy as before, with no control that changes a rate or a status; it issues no INSERT, UPDATE, DELETE, RPC or third-party fetch |
| FF-AC-2 | The page still carries the exact REDUNDANT header line and no visible notice; G-1 to G-5 pass |
| FF-AC-3 | Check 35 exists, is paste-safe and read only, and returns 4 rows (2 tables × 2 roles) |
| FF-AC-4 | Check 32 has 17 rows; on a database with the 20261078 CHECKs all 17 are true; with the metric CHECK widened (for example `^[a-zA-Z][a-z0-9_]{0,47}$`) the new row is false |
| FF-AC-5 | Checks 33 and 34 exist as script files, byte-identical to the §11M.9 bodies, and pass the paste-safety rules |
| FF-AC-6 | (If SA picks FF-1d option a) the range-cap guard passes at HEAD and each planted control fails |
| FF-AC-7 | The seven frozen pins and the AC-145 baseline are unchanged |

---

## 10. Business question and SA-W questions

**BQ-20 (business, attached to FF-1a; default used to build):** should the redundant Exchange rates page stop allowing edits?
- **Default: yes, read-only.** BD-34 says the page is redundant and not used, and no figure on the platform uses an exchange rate (BD-12); an unused page that can change shared rate data from the browser is risk with no benefit. Rates can still be changed by an operator in the database if ever needed.
- Alternative: keep the edit controls as they are (FU-M8-1 stays open).
- Why it is a question: BD-34's words were "just add comments it is redundant for now and not use them". Removing controls is a visible change beyond comments, so this is the user's call, not an obvious one.

| # | Question | Default |
|---|---|---|
| SA-W-FF-1 | FF-1d: source guard (a), `new-repository` skill note (b), or both? (b) is a configuration file change needing the user's own go-ahead | (a) only |
| SA-W-FF-2 | FF-1b: mirror E-93 exactly (`position`, proves presence) or also assert the constraint text has no ` OR ` (proves nothing was added beside it), on both the metric and dimension rows? | Mirror E-93, metric row only; the OR assertion recorded as residual R-4 |
| SA-W-FF-3 | Check 35: in the migration test's `PASTED` set, or a new `scripts/__tests__/financeChecks.sql.test.ts` beside it? | Migration test, beside 31 and 32, for one rule set |
| SA-W-FF-4 | The one ruled test edit (16 → 17 item list): accepted? | Yes |
| SA-W-FF-5 | Status cell: a `<span>` with the same classes minus hover / cursor, so the look is the same and only the click goes | Yes |

---

## 11. Verification Plan

1. **Step 0:** `git branch --show-current` = `feature/bos-finance-followups`; hash the seven pins (VL-12).
2. **Scoped Jest:** `npx jest app/admin/__tests__/redundantPages.source.guard.test.ts supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts lib/repositories/__tests__/rangeCap.source.guard.test.ts`, then the full `npm test`.
3. **Type and lint:** scoped `npx tsc --noEmit -p` on a temp config including `app/admin/exchange-rates/page.tsx` and the new test (canary error planted then removed, as in 6b V-8); `npx eslint` on the touched files (no unused imports).
4. **PGlite proof for FF-1b and check 35** in the session scratchpad only (`@electric-sql/pglite` installed there, never in the repo): apply `20261078`, run check 32 → 17 true; `ALTER` the metric CHECK to the widened pattern → the new row false, all others true; restore. Create stand-in `exchange_rates` / `exchange_rate_history` tables with the roles, run check 35 under (i) RLS on, no policy and (ii) RLS off with a grant, and confirm the reading rule in §6.1 gives "closed" and "open".
5. **Byte check FF-1c:** `diff` each new file against the §11M.9 body extracted with `sed`; empty diff.
6. **Browser (local dev, admin account):** open `/admin/exchange-rates`; rates and history render; no edit or toggle control; the History button still filters. Recorded in Implementation Notes. (Parked page; no user browser look is requested.)
7. **Handover:** pins re-hashed; `git diff --stat` shows only the §5 files, no deletion-only file.

**Owed to the user after merge (optional, read only):** run check 35 once on production and send the result (decides FF-2); re-run check 32 to see 17 true.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | FF-1a removes a capability someone still uses | BD-34 says not used; BQ-20 surfaces it; reverting is one file |
| R-2 | The page still reads from the browser (rule 1 deviation) and, until check 35 says otherwise, the DB may still accept browser writes outside the page | Recorded; check 35 measures it; FF-2 migration if open |
| R-3 | Removing icons or state leaves an unused import or a type error | ESLint and scoped `tsc` on the file (§11 step 3) |
| R-4 | `position` rows prove presence, not exactness (an OR-ed widening passes) | SA-W-FF-2; same accepted residual as E-93 |
| R-5 | The requirement keeps saying checks 33 and 34 are "pasted from here", so two copies can drift | BA repoints §11M.9 to the files at the next requirement edit; until then the files are byte-identical (§11 step 5) |
| R-6 | The range-cap guard false-positives on a legitimate wide literal later | The guard header names the escape: page the read; any exemption is an SA-ruled allow-list entry |
| R-7 | CRLF in the Windows working copy breaks byte equality or `'\n'` scans | New files written LF; tests split on `/\r?\n/` (the #394 pattern) |

---

## 13. Estimate

| Item | Days |
|---|---|
| FF-1a page read-only plus G-6 | 0.3 |
| FF-1a check 35 plus PGlite proof | 0.15 |
| FF-1b check 32 row, test edit, PGlite mutation | 0.2 |
| FF-1c checks 33 and 34 files and tests | 0.15 |
| FF-1d guard (option a) | 0.2 |
| **Total** | **about 1 day** |

If BQ-20 is held for the user, FF-1b to FF-1d (about 0.55 day) ship first and FF-1a (about 0.45 day) follows.

---

## 14. Task List

- [x] T0: Branch and pin check (VL-12)
- [ ] T1: FF-1a page edit (§4 steps 1 to 5)
- [ ] T2: FF-1a guard G-6 with planted controls
- [ ] T3: FF-1a check 35 file and its paste-safety test
- [ ] T4: FF-1a `MULTI_CURRENCY_SYSTEM.md` notes
- [x] T5: FF-1b check 32 row, ruled 17-item test edit, metric pin
- [x] T6: FF-1c checks 33 and 34 files, byte diff, tests
- [x] T7: FF-1d guard (per SA-W-FF-1)
- [x] T8: PGlite proofs (§11 step 4): FF-1b done; check 35 part goes with FF-1a
- [x] T9: Scoped Jest, eslint (FF-1b to FF-1d; the full suite and the browser look go with FF-1a)
- [x] T10: Handover: pins re-hashed, `git diff --stat`, Implementation Notes

---

## Implementation Notes

**2026-10-18, Dev. FF-1b, FF-1c and FF-1d implemented, uncommitted, per SA-WR-FF1. FF-1a not started (it waits for BQ-20 and ships as its own PR); check 35 belongs to FF-1a and is not written yet.**

### Files

| File | Change |
|---|---|
| `scripts/check-bos-finance-snapshots-migration.sql` | FF-1b: one row `metric check is exactly the shape pattern` after the dimension row (16 → 17 rows) |
| `scripts/check-bos-finance-history-days.sql` | FF-1c: check 33, new |
| `scripts/check-bos-finance-history-newest.sql` | FF-1c: check 34, new |
| `supabase/migrations/__tests__/business-os-finance-snapshots.migration.test.ts` | Header note; `CHECK_33` / `CHECK_34` added to `PASTED`; the ruled 16 → 17 item-list edit (SA-W-FF-4); new metric pin test; new describe "FF-1c" (one statement and header, read only, tables read, planted control) |
| `lib/repositories/__tests__/rangeCap.source.guard.test.ts` | FF-1d: new guard |

No other file changed. `console.*` count in touched files: 0 (all are tests or SQL).

### FF-1d guard (FF1-R1)

- **Rules:** R1 `.range(a, b)` span above 1,000; R2 `.limit(n)` above 1,000; R3 `X_PAGE_SIZE` / `PAGE_SIZE` above 1,000, as a `const` and as an object key. Each rule works in the literal form and the constant form: a same-file `const X = n`, `const X: number = n` or `KEY: n` object key, with `1_000` read, resolved through `A`, `OBJ.A` and `A ± n` expressions. Anything that does not resolve (parameters, loop offsets, imports) is not judged; the header says so.
- **Scope:** non-test `.ts` / `.tsx` under `lib/` and `app/api/`. Comments are stripped and strings blanked with the shared `tests/helpers/source-scan` primitives, so there is no third normaliser. `.tsx` is included, which is slightly wider than "`.ts`" and catches more.
- **Planted controls:** every rule in both forms, plus the clean cases: at the cap, a paging loop, an unresolved value, a comment, a string.
- **Baseline (may only shrink):** each entry is file plus exact call text plus count, never a line number. The test fails if an entry is found more often **or** less often than listed, so a fix forces its entry out. Each entry has an FF-3 comment.
- **D-1 (deviation, for SA): there are 8 literal `.limit` call sites in 6 files, not 3.** SA's three are there. The other five are in the insight detectors: `BaseDetector.ts` `.limit(2000)` and `.limit(5000)`, `ConvServiceRateDropDetector.ts` `.limit(2000)` ×2, `ConvStageDropoffDetector.ts` `.limit(2000)`. They are multi-line chains (`.limit(` begins its own line, often ending in `,`), which is probably why a grep for one line missed them.
- **D-2 (deviation, for SA): the constant form finds 12 more call sites in 6 files.** All of them are real values:
  - `app/api/payments/money/route.ts` `GROUPING_CAP = 2000` ×3;
  - `lib/business-os/bizql/compiler.ts` `AGGREGATE_SCAN_CAP = 5_000` +1 ×3 and `ANTI_JOIN_CAP = 10_000` +1 ×1;
  - `lib/business-os/insight/repository/InsightRepository.ts` `VISITOR_SCAN_LIMIT = 5000`;
  - `lib/repositories/AuditTrailRepository.ts` `OWNER_ACTIVITY_SCAN_CAP = 5000`;
  - `lib/repositories/BusinessPurgeRepository.ts` `VIA_PARENT_CAP = 5000` ×2;
  - `lib/repositories/SmartLinkRepository.ts` local `CAP = 20000`.

  All are in the baseline with FF-3 comments. **Two may be live defects, not just style.** BizQL's cap-plus-one probe can never see the extra row above `max-rows`, so its truncation flag may never fire. A purge that reads a cut list may leave rows behind. Both are recorded in the baseline comments for FF-3, and they belong to their owners (not finance files; the `console.*` rule applies if touched).
- No R1 or R3 offence exists today. Every `PAGE_SIZE` in scope is at most 1,000.
- **CI time:** the guard runs in about 10 s wall time, mostly ts-jest start-up, inside the existing Jest job. It is not on the `next build` critical path.

### QA-FF1-1 fix (Low): the baseline could grow

Fixed by Dev. The baseline is now pinned with `BASELINE_ENTRIES = 14` and `BASELINE_CALL_SITES = 20`. A new test asserts the entry count, the sum of the counts, and that the 14 entries are distinct. Adding an entry, raising a count or duplicating an entry now fails. A comment beside the pins says that removing an entry or lowering a count after a fix means lowering the pins in the same change, and that the pins are never raised without an SA ruling.

**Proof:**
1. Baseline run: 21 of 21 passed (sha256 `9556c9a3…59e8f`).
2. I planted an extra entry (`lib/planted/Planted.ts` `.limit(9999)`): 2 failed, 20 passed out of 22. The failures were the new pin test and the existing "entry still present" test.
3. I restored the file from a scratch copy. `cmp` showed it identical and the sha256 was the same.
4. Re-run: 21 of 21 passed.

### FF-1b proof (PGlite 0.5.8, PG 18.3, scratchpad only)

I applied `20261078` to a fresh PGlite with the three roles and ran check 32:

| State | Rows | True | False |
|---|---|---|---|
| As migrated | 17 | 17 | — |
| Metric CHECK widened to `^[a-zA-Z][a-z0-9_]{0,47}$` | 17 | 16 | `metric check is exactly the shape pattern` |
| Metric CHECK widened to `{0,63}` | 17 | 16 | `metric check is exactly the shape pattern` |
| Restored | 17 | 17 | — |

`pg_get_constraintdef` reads `CHECK ((metric ~ '^[a-z][a-z0-9_]{0,47}$'::text))`. The OR-widening residual R-4 is accepted (SA-W-FF-2).

### FF-1c byte diff (FF1-R3)

The bodies were extracted from the committed requirement blob (`git show HEAD:<requirement>`), lines 3151-3191 (check 33) and 3197-3236 (check 34), the lines inside the `sql` fences.

```text
$ git show HEAD:$R | sed -n 3151,3191p | cmp - scripts/check-bos-finance-history-days.sql     -> identical
$ git show HEAD:$R | sed -n 3197,3236p | cmp - scripts/check-bos-finance-history-newest.sql   -> identical
(same result against the working copy of the requirement)
check 33: 1705 bytes, sha256 b05dd5ea4801656c84c7bc7304019d10ae7415a99c0f464b360926dd1db19d18
check 34: 2058 bytes, sha256 3151f03fc9f85711d1ac6213073598836966da226a9cf30cc3a092eb93a30044
```

Both files are LF and ASCII, and pass the `PASTED` rules. When BA repoints §11M.9 to the files, the requirement copies are deleted, not kept in parallel.

### Verification

| Run | Result |
|---|---|
| New guard `rangeCap.source.guard.test.ts` | 1 suite, 21 tests passed (20 before the QA-FF1-1 pin) |
| `lib/business-os/finance` | 20 suites, 1953 passed |
| `app/admin/finance` | 20 suites, 687 passed |
| `lib/repositories` | 110 suites, 2628 passed |
| `supabase/migrations/__tests__` + `scripts` | 58 suites, 2920 passed (the migration test alone: 35) |
| `test:authz-guard` | 2 suites, 203 passed |
| `test:bos-entitlements` | 293 suites, 8845 passed |
| `lint:hooks` | clean (exit 0, max-warnings 0) |
| ESLint on the two changed test files | clean |

**Pins (FF1-R4)** were checked at handover with `git diff --quiet` and the HEAD blob hash. None of the files was touched:
- AC-173 `3a1a2dd4…`
- helper `b84e0c96…`
- A `30f5fc24…`
- B `24ff0da7…`
- C `98ea0507…`
- helper `02813360…`
- D `1f7cf07a…`
- AC-145 baseline file `route.test.ts` unchanged.

No finance file, page or route was touched.

A note from the build: an inline Node edit once wrote raw backspace bytes into two regexes (`\b`). The read-only test then passed vacuously. The bad bytes were found and fixed, and the file now contains no 0x08 byte. The planted control is what caught it.

## SA Review Notes

### SA Workplan Review

**Reviewed by SA, 2026-10-18, at `f7429b57`.**
**Status: APPROVED WITH CONDITIONS (SA-WR-FF1).** FF-1b, FF-1c and FF-1d may start now. **FF-1a is technically approved but waits for BQ-20.** It has no code coupling to the other three, so it can ship as its own PR once the user answers.

#### What FF-1a's read-only would break (verified)

**Nothing functional.**
- The only other reader of `exchange_rates` is `components/settings/CurrencySelector.tsx` (user settings), through `CurrencyService.getAllRates()`. That reads **every** row, ignoring `is_enabled`, and uses only `currency_code` / `currency_name` to list currencies.
- `getEnabledRates` has no caller, so the enable toggle changes nothing anywhere.
- No code converts money with a stored rate (BD-12, no FX).
- `updateRate`'s only callers are this page's two handlers, one of them dead.

What is lost is the admin's ability to edit stored rate values and the enabled flag, which nothing consumes. **Consequence for FF-2:** the browser `SELECT` on `exchange_rates` must stay for `authenticated`, because the settings currency picker reads it from the browser. Any later revoke is writes only.

#### Rulings

| # | Ruling |
|---|---|
| SA-W-FF-1 | **(a) only, widened (FF1-R1).** A Jest source guard is the right tool. A skill edit is a configuration change and is out of scope |
| SA-W-FF-2 | **Mirror E-93 (`position`), metric row only.** The OR-widening residual R-4 is accepted, as for E-93. An exact `pg_get_constraintdef` equality is version-fragile |
| SA-W-FF-3 | **The migration test's `PASTED` set**, so there is one rule set. Check 35 joins it |
| SA-W-FF-4 | **Accepted:** the one ruled 16 → 17 item-list edit |
| SA-W-FF-5 | **Accepted:** a `<span>` with the same classes minus hover / cursor; no visible notice (BD-34, G-3) |
| BQ-20 | It is a genuine business question: BD-34 said comments only. The default (read-only) is sound and blocks nothing else |

#### Conditions

- **FF1-R1 (FF-1d scope; the guard must catch the real failure).**
  - **Rules.** The C-1 failure was a single read asking for more than 1,000 rows. The guard therefore checks three things:
    - (1) a literal `.range(a, b)` spanning more than 1,000 rows;
    - (2) a literal **`.limit(n)` with n above 1,000**, because PostgREST's `max-rows` cuts any response;
    - (3) a page-size literal above 1,000, in **both** forms: `const X_PAGE_SIZE = n` **and** object keys `PAGE_SIZE: n` / `…_PAGE_SIZE: n`, with `1_000` underscores read.
  - **Scope.** All non-test `.ts` under `lib/` and `app/api/`, comments stripped.
  - **Baseline.** SA's grep at `f7429b57` finds **three existing `.limit` offences**, outside finance:
    - `app/api/business-os/stats/route.ts:1627` `.limit(2000)`;
    - `lib/business-os/bizql/telemetry/ChatBudget.ts:165` `.limit(20000)`;
    - `lib/business-os/insight/detectors/catalog/AcqLowConversionDetector.ts:149` `.limit(5000)`.

    They go in an explicit **baseline allow-list** (file and the exact call text, not a line number), which may only shrink, with a test that each entry still exists. Each one becomes a follow-up for its owner (**FF-3**, not fixed here: they are not finance files, and touching them triggers the `console.*` rule).
  - **Escapes and CI time.** The header states the limits: variable spans are not judged, and any new exemption is SA-ruled. CI cost is a file walk inside the existing Jest job, not the `next build` critical path, so no added CI time.
  - **Controls.** A planted control for each of the three rules.
- **FF1-R2 (check 35).** Add a column `select_policies` (the policy names with `polcmd in ('r', '*')` for the role). The reader can then confirm that the settings picker's browser read stays possible after any FF-2 revoke. The reading rule in §6.1 gains: "FF-2 revokes writes only; `grant_select` for `authenticated` must stay true." The SQL as written is otherwise paste-safe: ASCII, no apostrophe in a comment, never the editor word, and one result set, with the missing-table cases guarded by `case`.
- **FF1-R3 (FF-1c).** The byte diff (§11 step 5) is pasted in Implementation Notes. If BA later repoints §11M.9 to the files, the requirement copies are deleted, never kept in parallel.
- **FF1-R4.** At handover, re-hash the seven pins and the AC-145 baseline. No finance file, page or route is touched.

#### Checked and fine

- No new DB path: FF-1a only removes writes, and the remaining browser reads are the pre-existing R-2, recorded, not widened.
- The M-8 guards G-1 to G-5 stay as they are; G-6 adds planted controls.
- PGlite proofs stay in the scratchpad.
- No migration. Pins untouched by construction.
- **Estimate:** about 1 day, accepted. FF1-R1's wider rules and baseline add about 0.1 day.

### SA Code Review (FF-1b, FF-1c, FF-1d)

**Code Review by SA, 2026-10-18. Reviewed: the uncommitted tree on `feature/bos-finance-followups`.**
**Status: Code Approved (SA-CR-FF1).** FF-1a is not built (BQ-20).

#### Checked

| Item | Result |
|---|---|
| FF-1b, check 32 row 17 | ✅ `metric check is exactly the shape pattern`, `position('^[a-z][a-z0-9_]{0,47}$' in pg_get_constraintdef(c.oid)) > 0`, filtered by `conname`, `coalesce(…, false)`. The item list is now 17 (the ruled edit), and the metric pin is tied to `SNAPSHOT_METRIC_SHAPE.source`. The PGlite mutation proof is recorded (two widenings each turn only this row false) |
| FF-1c, checks 33 and 34 | ✅ **Byte-identical** to the §11M.9 fenced bodies: SA extracted both independently from the requirement and `cmp` says identical. They are in `PASTED`, with read-only and table-list tests |
| FF-1d guard | ✅ Three rules (range span, `.limit`, page size in `const` and object-key form), resolved for literals and same-file constants. Comments are stripped and strings blanked with the shared scanner. Every rule has a planted control and a clean case |
| False positives | None found. A `CAP + 1` probe resolving above 1,000 **is** the defect pattern: PostgREST returns at most 1,000 rows, so a "+1 to detect truncation" probe can never see the extra row. Unresolvable values are not judged, as the header says |
| CI time | ✅ One more suite in the existing Jest job: SA's run of the guard plus the migration test was 29 s for 55 tests, mostly ts-jest start-up. The Jest job is not the `next build` critical path, so there is no added critical-path time (the standing rule) |
| Seven pins (SA recomputed) | ✅ `3a1a2dd4` `b84e0c96` `30f5fc24` `24ff0da7` `98ea0507` `02813360` `1f7cf07a`. No finance file is touched |

#### Ruling: the 20-entry baseline

**Accepted, as a shrink-only allow-list.** The guard should not be narrowed: every entry is a read whose limit sits above PostgREST's 1,000-row `max-rows`, so the extra rows are silently dropped. Narrowing would hide real defects. The entry format (file, exact call text, exact count, fails on more **or** fewer) makes every fix remove its entry. A new entry needs an SA ruling. **FF-3 is split per owner:** BizQL, insight detectors, payments money route, audit trail, purge, smart links. The two items below go first.

#### The two suspected bugs

| # | Evidence | Classification |
|---|---|---|
| B-1, BizQL compiler | Two kinds of read in `lib/business-os/bizql/compiler.ts` are affected:<br>• **Aggregates:** `:85` `AGGREGATE_SCAN_CAP = 5_000`. Parents at `:1538` `.limit(AGGREGATE_SCAN_CAP + 1)` with `:1543` `parentsTruncated = parentRows.length > AGGREGATE_SCAN_CAP`; children at `:1560` / `:1564`, the same shape.<br>• **Anti-join:** `:82` `ANTI_JOIN_CAP = 10_000` (comment `:79` "a silently truncated NOT-IN produces a WRONG answer"), at `:821` `.limit(ANTI_JOIN_CAP + 1)` and `:832` `ids.length > ANTI_JOIN_CAP`.<br>The project's `max-rows` is 1,000 (`AuditTrailRepository.ts:206-211`, `FINANCE_READ_LIMITS` comments). So the response is at most 1,000 rows, the `> CAP` tests can never be true, `approximate` / `ResultSetTooLargeError` never fire, and sums, counts and NOT-IN filters are computed over the first 1,000 rows only, **presented as exact** | **Latent, wrong answers when it fires.** It reaches users only for an account with more than 1,000 rows in one queried entity. No SA live check was possible (no credentials), so the separate task must measure it first |
| B-2, purge repository | `lib/repositories/BusinessPurgeRepository.ts:61` sets `VIA_PARENT_CAP = 5000`.<br>• The parent ids are read with `.limit(VIA_PARENT_CAP)` in the preview count (`:181`) and the snapshot read (`:417`), so at most 1,000 come back.<br>• The preview's `truncated: parentIds.length >= VIA_PARENT_CAP` (`:200`) never fires, so the count under-reports.<br>• `readAllRows` (`:400-450`) pages the child rows but only for the first 1,000 parents, so the **pre-delete forensic snapshot** misses child rows of later parents.<br>**The delete itself is not affected:** it is the SQL function `purge_business_data` (`:542-548` `executePurge` → `.rpc`). No rows are left behind by this code | **Latent, not a "rows left behind" bug.** An under-counted preview and an incomplete snapshot need an account with more than 1,000 rows in one `via` parent table. Reset and Purge are not yet switched on (the data-purge stream), so no user is hit today |

**Hand-off descriptions (for separate tasks; not fixed here):**

- **B-1.** BizQL compiler: the truncation checks can never fire because PostgREST caps responses at 1,000 rows. Aggregate scans (`compiler.ts:1538`, `:1560`) and the anti-join id read (`:821`) request `CAP + 1` rows (5,001 / 10,001), but at most 1,000 come back. So `parentsTruncated` / `childrenTruncated` (`:1543`, `:1564`) and `ResultSetTooLargeError` (`:832`) are never set, and an account with more than 1,000 rows gets sums, counts and NOT-IN results over the first 1,000 rows, reported as exact. **Fix:** page each read in 1,000-row keyset pages up to the cap, or make the probe `limit(1000)` with "reached 1,000 = truncated". **First:** measure live which accounts exceed 1,000 rows per BizQL entity. Add a test with a mock capped at 1,000 rows. The file is not in finance; check its `console.*` count per the logging rule.
- **B-2.** Purge repository: the `via`-parent id reads use `.limit(5000)`, which PostgREST cuts to 1,000. The cuts are at `BusinessPurgeRepository.ts:181` (preview count) and `:417` (snapshot read). The preview under-counts with `truncated` never set (`:200`), and the pre-delete snapshot omits child rows of parents beyond the first 1,000. The delete (`purge_business_data` RPC) is unaffected. **Fix:** keyset-page the parent ids at 1,000. Send the `.in()` filter in chunks of 100 ids, because one URL with 1,000 uuids is about 37 KB. Make "truncated" mean the true ceiling. Test with a 1,000-row capped mock. **This must land before Reset or Purge is switched on.**

#### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-18** (FF-1b, FF-1c, FF-1d; FF-1a is not built and is not tested)
**Test mode:** full
**Strategy used:**
- **A + C:** Jest suites, run one at a time.
- **PGlite 0.5.8** in the QA scratchpad, never production:
  - FF-1b: check 32 against live drift of the metric CHECK;
  - FF-1c: checks 33 and 34 run from the new script files against seeded snapshots, lots and a draw.
- An independent byte comparison of checks 33 and 34 against the requirement, and a paste-safety tokeniser.
- **Temporary source edits** to prove the FF-1d guard bites and to probe its baseline rule. Every edit was restored with `cp` and checked with `cmp` (byte-identical); `git status` shows only the FF-1 files.

**Focus:** schema, pipeline (guards)
**Skipped:** FF-1a (waits for BQ-20).
**Input source:** prompt + workplan

**Verdict: PASS WITH ISSUES: one Low bug (QA-FF1-1), not blocking.** FF-1b and FF-1c pass fully. The FF-1d guard catches every form asked for, but its "may only shrink" baseline rule can be bypassed by adding an entry (below).

### Suite runs (each alone, worktree `neuronforge-finance-m8`, branch `feature/bos-finance-followups`, uncommitted)

| Suite | Result |
|---|---|
| Guard `rangeCap.source.guard.test.ts` | 1/1, 20/20 (22.7 s wall, mostly ts-jest start-up) |
| `lib/business-os/finance` | 20/20, 1953/1953 |
| `app/admin/finance` | 20/20, 687/687 |
| `lib/repositories` | 110/110, 2628/2628 |
| `supabase/migrations/__tests__` + `scripts` | 58/58, 2920/2920 (the migration test alone: 35/35). With `scripts/__tests__` only: 55/55, 2894/2894 |
| `npm run test:authz-guard` | 2/2, 203/203 |
| `npm run test:bos-entitlements` | 293/293, 8845/8845 |
| `npm run lint:hooks` | exit 0 |

These match Dev's counts.

**Pins (LF-normalised):** AC-173 `3a1a2dd4…f6f8` ✅, helper `b84e0c96…aabf` ✅, A `30f5fc24…2e01` ✅, B `24ff0da7…df9f` ✅, C `98ea0507…1e4b` ✅, C helper `02813360…5bd8` ✅, D `1f7cf07a…f144` ✅. `git diff --quiet HEAD` is clean on all tracked `app/` and `lib/` files, `20261078`, the rollbacks, and the AC-145 file `route.test.ts`.

### FF-1b: check 32 row 17 (PGlite, `20261078` applied)

| State of `business_os_finance_snapshots_metric_shape` | Rows | Row 17 | Other false rows |
|---|---|---|---|
| As migrated | 17 | **true** | none (17/17 ok) |
| Widened, first character `[a-zA-Z]` | 17 | **false** | — |
| Widened, length `{0,63}` | 17 | **false** | — |
| **Narrowed**, length `{0,30}` | 17 | **false** | — |
| **Narrowed**, no digits `[a-z_]` | 17 | **false** | — |
| **Dropped** | 17 | **false** | "the six checks are present" |
| Renamed (same pattern) | 17 | **false** | "the six checks are present" |

**Paste-safe:** 0 CR, 0 non-ASCII, 0 "into", 0 apostrophes in comments, one `;` (one result set), no `SET`, no unclosed string. Its 23 privilege words (`INSERT`, `UPDATE`, …) are all inside `has_*_privilege` string literals; there are **0** outside strings and comments. The accepted residual R-4 (an OR-ed widening passes `position`) is unchanged.

### FF-1c: checks 33 and 34 as files

- **Byte-identical.** QA extracted the fenced bodies by heading (`**File:** \`check 33` / `check 34`, not by line number), from both the working copy and `git show HEAD:` of the requirement. `cmp` says identical for both files in both sources. sha256 `b05dd5ea…` (1,705 bytes) and `3151f03f…` (2,058 bytes), as Dev recorded.
- **Paste-safe:** both are LF (0 CR), ASCII, 0 "into", 0 apostrophes in comments, one `;`, no `SET`, and **0** write verbs.
- **Run on PGlite** (`20261011`, `20261017`, `20261078` applied; 3 nights of the real 8.2 builder rows; lots of gifted 100 + 50 and bought 4,000; one 20-credit admin reversal draw):
  - **check 33** gives 3 rows (one per day), 36 snapshot rows each, `groups_match_total` **true** and `taken_after_day_end` **true**;
  - **check 34** gives 1 row, `rebuilt_gifted` **130 = `snapshot_gifted` 130** (150 granted − 20 drawn), `rebuilt_bought` **4000 = 4000**, `plan_rows_then` **3 = `snapshot_accounts` 3**.

### FF-1d: the range-cap guard

**Every form asked for is caught.** Each was planted at the end of `BusinessOsFinanceSnapshotReadRepository.ts`, which is not in the baseline:

| Planted | Guard |
|---|---|
| `q.range(0, 1500)` | **1 failed** |
| `.limit(` / `2000` / `)` split over three lines | **1 failed** |
| `export const PAGE_SIZE = 5000;` | **1 failed** |
| `const QA_ROWS = 3000; q.range(0, QA_ROWS)` | **1 failed** |
| `const QA_ROWS = 1_500; q.limit(QA_ROWS)` | **1 failed** |
| Control at the cap: `q.limit(1000).range(0, 999)` | 20/20 passed |
| **The current tree** | **20/20 passed** |

**Baseline behaviour.** The scenarios used the `SmartLinkRepository.ts` `.limit(CAP)` entry (`CAP = 20000`) and temporary baseline edits in the guard:

| Scenario | Guard | Reading |
|---|---|---|
| Offence fixed (`CAP = 1000`), entry kept | **1 failed** | a stale entry forces its removal ✅ |
| Offence fixed **and** entry removed | 19/19 passed | the list shrinks ✅ |
| Entry removed, offence still there | **1 failed** | ✅ |
| Entry added with no offence behind it | **1 failed** | ✅ |
| **A new offence plus a matching new entry** | **21/21 passed** | ❌ the list **can grow**. See QA-FF1-1 |

**CI time:** one more suite in the existing Jest job (22.7 s wall here, about 10 s per Dev, 29 s for guard plus migration test per SA). It is not on the `next build` critical path, so there is **no added critical-path time** (the standing rule).

### Test Coverage

| Criterion | Verdict | Evidence |
|---|---|---|
| FF-AC-4 (check 32, 17 rows; row 17 false on drift) | PASS | PGlite table above: widened, narrowed and dropped |
| FF-AC-5 (checks 33 and 34 files, byte-identical, paste-safe) | PASS | `cmp` vs working copy and HEAD; tokeniser; PGlite run |
| FF-AC-6 (guard passes at HEAD; each planted control fails) | PASS | 20/20 at HEAD; 5 temporary plants each fail; own planted controls green |
| FF-AC-7 (seven pins, AC-145 unchanged) | PASS | hashes above; `route.test.ts` untouched |
| SA FF1-R1 "baseline may only shrink" | **PARTIAL** | shrinking is enforced; growing is not (QA-FF1-1) |
| FF-AC-1 to FF-AC-3 (FF-1a, check 35) | NOT-TESTED | FF-1a not built (BQ-20) |

### Issues Found

#### Bugs
1. **QA-FF1-1: the FF-1d baseline can grow without the guard noticing.** Low. File: `lib/repositories/__tests__/rangeCap.source.guard.test.ts:56-88` (`BASELINE`) and `:186-197`.
   - **Steps:** add a new over-cap read (for example `q.limit(4000)` in any `lib/` file) **and** a matching `{ file, text: '.limit(4000)', count: 1 }` entry. The guard passes, 21/21.
   - **Expected (SA-WR-FF1 FF1-R1, SA-CR-FF1):** "it may only shrink; a new entry needs an SA ruling".
   - **Actual:** that rule is enforced by code review only. Each entry is checked for "found exactly `count` times", and every offence for "is listed"; nothing pins the list's size.
   - **Suggested fix (one assertion):** pin the totals beside the list, for example `expect(BASELINE).toHaveLength(14)` and `expect(BASELINE.reduce((s, b) => s + b.count, 0)).toBe(20)`, with a comment that these numbers may only go down and that raising either needs an SA ruling. A grown list then has to edit a pinned number in the same diff, which is conspicuous in review.
   - Today the list is 14 entries, 20 call sites.

#### Performance Issues
None.

#### Edge Cases (nice to fix)
None new. SA's B-1 (BizQL truncation flags never fire) and B-2 (purge via-parent preview and snapshot incomplete) are recorded by SA as separate FF-3 tasks. QA agrees: B-2 must land before Reset or Purge is switched on.

### Manual steps for the user (after merge; optional, read-only)
- Supabase SQL editor, new tab: paste `scripts/check-bos-finance-snapshots-migration.sql` (check 32) and expect **17 rows, all `ok = true`**.
- After the next night's snapshot: paste `scripts/check-bos-finance-history-days.sql` (check 33) and `scripts/check-bos-finance-history-newest.sql` (check 34), each in a new tab, and read them as §11M.9 says.

### Final Status
- [x] FF-1b, FF-1c and FF-1d meet their criteria. One Low bug (QA-FF1-1) is recorded and not blocking; Dev may add the two-line pin before RM commits, or SA may rule it into FF-3. No High or Medium issue is open.
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (Dev) | Inventory of open finance follow-ups verified at `f7429b57`; bundle FF-1a (Exchange rates read-only plus check 35, BQ-20 default), FF-1b (check 32 metric row, QA-81-N1), FF-1c (checks 33 and 34 as files), FF-1d (range-cap guard, SA rules); SA-W-FF-1 to SA-W-FF-5. No code written |
| 2026-10-18 | Implemented FF-1b to FF-1d (Dev) | Uncommitted. Check 32 metric row (PGlite proof), checks 33 and 34 as files (byte-identical), range-cap guard with an FF-3 baseline of 20 call sites in 12 files (D-1, D-2 for SA). Pins unchanged |
| 2026-10-18 | SA workplan review | APPROVED WITH CONDITIONS (SA-WR-FF1): FF-1b to FF-1d may start; FF-1a technically approved, waits for BQ-20, can ship separately (read-only breaks nothing: the settings picker reads all rows, no FX). FF1-R1 widen the guard to .limit and object PAGE_SIZE keys, baseline 3 existing .limit offences (FF-3); FF1-R2 check 35 select_policies and keep authenticated SELECT; FF1-R3, FF1-R4 |
| 2026-10-18 | SA code review (FF-1b to FF-1d) | Code Approved (SA-CR-FF1). 20-entry shrink-only baseline accepted (FF-3 split per owner). B-1 BizQL truncation flags never fire: latent, wrong answers above 1,000 rows. B-2 purge via-parent cap: latent; preview and snapshot incomplete, delete unaffected; must land before Reset or Purge is switched on |
