# Workplan: Admin "Credits left" wrong after a re-anchor

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ADMIN_CREDITS_LEFT_REANCHOR_FIX.md](/docs/requirements/BUSINESS_OS_ADMIN_CREDITS_LEFT_REANCHOR_FIX.md) (SA conditions C-1..C-4 and workplan conditions W-1..W-6 binding)
**Date:** 2026-10-12
**Status:** Merged: PR #331 (`fix/bos-admin-credits-left-reanchor`), merged to main 2026-10-13. The W-1 follow-up (leak-check fold, [§ Follow-up](#follow-up-fold-the-leak-check-onto-the-mirror-w-1)) is implemented, uncommitted, and awaiting SA code review.
**Branch:** `fix/bos-admin-credits-left-reanchor` (merged); the follow-up gets its own branch from RM

## Overview

The admin batched pass (`computePositions`) picks the current totals row with a range rule built from the row's own month. Once the anchor moves, an old-anchor row passes that rule. The fix: a TS mirror of `business_os_credit_period_start(anchor, now)` gives the expected key, and a row is current only if its key equals that key to the millisecond (SA ruling 2). The pass stays batched (SQ-42). No migration, UI change, new pattern or entitlements import change.

## Analysis Summary

| Area | Finding |
|---|---|
| `isCurrentPeriodRow` callers | One: `adminCreditPercent.ts` `computePositions`. It feeds both `readAdminCreditsLeft` (/admin/users) and `readAdminCreditPositions` (finance), so one fix covers both. |
| Existing TS twin | `creditLeakCheck.ts` `addMonthsUtc` + `creditPeriodStartAt` (ms label). It is **not** touched in PR #331 (W-1); a test-only parity table pinned it to the new mirror. **Folded 2026-10-13** (see the Follow-up section): `addMonthsUtc` is deleted and the parity table is replaced. |
| Source guard | `KEY_TO_DATE` flags `new Date(anchorMs)`, so `currentPeriodStartMs` joins the `withoutDisplayMaths` exclusion and the non-vacuity loop (W-2). `subMillisecondPart` builds no Date and needs no exclusion. `creditLeakCheck.ts` is **not** added to the file list. |
| SQL body | `20261015_business_os_credit_charges.sql` L138-169, the only definition (SA-verified; now pinned by test). |
| Per-account block (SA d) | It is already the owner path. It is covered by a test, with no code change. |
| `console.*` | None in any touched file. |
| Entitlements | No entitlements import changed. `npm run test:bos-entitlements` was run anyway. |

## Decisions (as built)

- **D-1** `currentPeriodStartMs(anchorIso, now): number | null` in `creditPeriod.ts`. It follows the SQL step for step: month difference in UTC → `addMonthsClampedUtc(anchor, months)` → step back one month if `candidate > now`. It is display maths / row selection only.
- **D-2** `isCurrentPeriodRow(anchorIso, periodStartIso, now, expectedStartMs = currentPeriodStartMs(anchorIso, now))`. It is exact-millisecond key equality, and the optional 4th parameter lets `computePositions` compute the key **once per account**.
- **D-3** Deferred per W-1 in PR #331. **Closed 2026-10-13** by the follow-up below: `creditPeriodStartAt` delegates to `currentPeriodStartMs`.
- **D-4** The sub-ms tie is handled exactly. `subMillisecondPart` reads `fraction.padEnd(6,'0').slice(3)`, and a missing fraction counts as 0. The step back happens when `candidateMs > nowMs || (candidateMs === nowMs && anchorMicros > 0)`. Two old assertions flipped (W-3): L208 `true → false` and L210 `false → true`. Both moved into the C-3 block with SQL comments.
- **W-5** An unreadable monthly anchor (the expected key is `null`) makes the account `UNKNOWN_POSITION`, not 100%.

## Files Modified

| File | Change |
|---|---|
| `lib/business-os/credits/creditPeriod.ts` | Adds `subMillisecondPart` and `currentPeriodStartMs`. Rewrites `isCurrentPeriodRow` as an exact-key match. C-4/W-6 comments on the module header, `nextPeriodStartUtc` (millisecond-truncated, display only, not the selector) and the selector. |
| `lib/business-os/credits/adminCreditPercent.ts` | Computes the key once per account; W-5 unknown; rewrites the header (C-4). |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` | Guard exclusion + non-vacuity, re-pointed selector tests, mirror vectors, C-3 block, W-1 parity table, C-2 SQL pin + single-definition check. |
| `lib/business-os/credits/__tests__/adminCreditPercent.test.ts` | Extracts the `ownerCardPercent` helper (from the existing R-3 test, unchanged behaviour); adds the "restarted period" block (repro, finance projection, case a, case b, re-anchor onto the 31st, unmoved, W-5). |
| `lib/business-os/credits/__tests__/adminCreditPositions.test.ts` | The re-anchored account: finance agrees with the list, used 0, not over the allowance. |
| `lib/business-os/credits/__tests__/creditPosition.test.ts` | SA (d): the per-account block reads the new key (used 0) and matches the owner card. |

## Task List

- ✅ 0. Branch `fix/bos-admin-credits-left-reanchor` confirmed.
- ✅ 1. Repro written first and run against the old code. **5 failed:** repro list `0%` (expected 100), repro finance `used 20276` (expected 0), case a `75%`, re-anchor onto the 31st `15%`, W-5 `100%` (expected unknown). Case b and unmoved passed on the old code too (they are regression nets).
- ✅ 2. `currentPeriodStartMs` + `subMillisecondPart` (D-1, D-4).
- ✅ 3. `isCurrentPeriodRow` rewritten; key computed once per account; W-5.
- ⬜ 4. Dropped (W-1): `creditLeakCheck.ts` is not modified.
- ✅ 5. C-1 tests, 5a-5f (5f: the owner card with the DB-function key `2026-10-12 18:21:50+00` reads 100%).
- ✅ 6. Finance agreement test.
- ✅ 7. C-2 pin (W-4): whitespace collapsed; months-diff, two clamped adds, the `IF … > … THEN … END IF;` block, and the UTC conversions. Also asserts that only `20261015_…sql` in `supabase/migrations/` defines the function ("re-pin to the new migration"). A TS-side structure check too.
- ✅ 8. C-3 tests, including a non-UTC-offset anchor with sub-ms digits.
- ✅ 9. Guard: `currentPeriodStartMs` excluded + in the non-vacuity loop; the `isCurrentPeriodRow` cut is kept, with a comment saying it is now harmless (W-2).
- ✅ 10. C-4 / W-6 comments.
- ✅ 11. SA (d) test.
- ✅ 12. Tests, tsc and lint run (results below).
- ✅ 13. Nothing committed.

## Test Results

| Command | Before fix | After fix |
|---|---|---|
| `npx jest …/adminCreditPercent.test.ts` | 5 failed / 26 passed | all pass |
| 6 targeted suites (creditPeriod, adminCreditPercent, adminCreditPositions, creditPosition, creditLeakCheck, credit-charges migration) | — | 6 suites, 266 tests pass |
| `npm run test:bos-entitlements` | — | 242 suites, 7,203 tests pass |
| `npx tsc --noEmit -p .` | — | The worktree's `node_modules` has no `@types`, so 2 environmental TS2688 errors appear. With `--typeRoots ../../../node_modules/@types` (the main checkout's): **0 errors** |
| `npx eslint` on the 6 touched files | — | clean |

Manual (QA, AC-5): on account `5f63adbd…`, `/admin/users` "Credits left" equals the owner's Credits card (100%).

## Risks

| Risk | Mitigation |
|---|---|
| The two TS twins drift | **Closed 2026-10-13:** there is one copy now. A source guard fails if `creditLeakCheck.ts` regains any `addMonths` code or stops calling `currentPeriodStartMs(`. |
| The SQL function is redefined later | The C-2 single-definition test fails with "re-pin to the new migration". |
| The 32-day range misses the current key | SA confirmed it does not (key ≤ now and > now − 31 d, also in case b). |
| Guard exclusion widens the Date allowance | It is limited to one named function body, and non-vacuity asserts the cut happened. |

## SA Review Notes

## SA Workplan Review

**Reviewed by SA — 2026-10-12**
**Status:** ✅ Approved with conditions (W-1..W-6 binding; no re-review needed if they are applied as written)

### Verified against the code and SQL

| Item | Finding |
|---|---|
| Branch | `fix/bos-admin-credits-left-reanchor` is checked out (task 0 done). The ⚠️ Branch line in the header is stale; update it. |
| Live SQL definition (C-2) | `business_os_credit_period_start` is defined **once**, as a plain `CREATE FUNCTION` in `20261015_business_os_credit_charges.sql` L138-169. No later migration contains a `CREATE OR REPLACE` of it (only the REVOKE/GRANT lines in the same file, the rollback script and the `scripts/check-*` probes mention it). Pinning that file is pinning the live body **today**. |
| D-4 tie at `creditPeriod.test.ts:208` | **Confirmed.** `ANCHOR` = `2026-09-14T09:31:07.123456+00`, `at` = `09:31:07.123000`. Months diff 0, candidate `.123456 > .123000`, so SQL steps back to 2026-08-14 and `PERIOD` is **not** current. Flipping to `false` is correct. |
| D-4, missed second flip | **`creditPeriod.test.ts:210` also flips.** At `2026-10-14T09:31:07.123Z`, the candidate `10-14 .123456` > `at`, so SQL steps back to `09-14` = `PERIOD`: the expectation goes from `false` to **`true`**. L212 (`.122Z`) stays `false`, and the two 31st/February cases at L216-218 stay as they are (checked by hand). |
| Guard exclusion | Acceptable. `currentPeriodStartMs` must build `new Date(anchorMs)`, which `KEY_TO_DATE` matches (`anchor…`). It is the same class as `nextPeriodStartUtc`, the cut is one named body, and non-vacuity proves the cut happened. A `subMillisecondPart` that only reads regex digits needs no exclusion. Don't add one. |
| Task 9, "add `creditLeakCheck.ts` to the guard file list" | **Would fail.** That file has `Date.parse(anchorIso)` (L152) and `Date.parse(row.created_at)` (L299, L349), and all three match `KEY_TO_DATE`. The latter two are legitimate window maths outside this slice. Dropped (W-2). |

### Ruling on D-3 (leak-check rewiring): defer it, pin parity by test instead

My requirement ruling 4 allowed "reuse it, **or record in the workplan why it does not**". Taking the second branch:
- `creditPeriodStartAt` is **not** part of this fault (requirement finding c). Rewiring it changes production behaviour of the nightly money-safety check: a new parser (`displayInstantMs` rejects formats `Date.parse` accepts), a different month-add helper (`Date.UTC` overflow vs explicit year roll), and the tie-break. That change has no user-visible gain in a display bug fix.
- The drift risk that ruling 4 targeted is closed more cheaply by a **test-only** parity table: the leak-check twin and the new mirror must agree on every shared non-tie vector. Neither copy can then drift from the other without a red test, and the SQL pin anchors the new mirror.
- Consolidating the two copies is logged as a follow-up (its own small slice, with the leak-check `it.each` as the net).

### Conditions

- **W-1 (D-3 deferred):** do not touch `creditLeakCheck.ts`. Instead, in `creditPeriod.test.ts`, add a shared fixed-vector table (unmoved anchor, re-anchor repro, case a, case b, the 31st across February, a December→January year roll, a non-UTC offset, ms-precision anchors only) asserting `creditPeriodStartAt(anchor, atMs) === new Date(currentPeriodStartMs(anchor, new Date(atMs))).toISOString()`. Record the follow-up "fold `creditLeakCheck.addMonthsUtc` onto `currentPeriodStartMs`" in the requirement's Out of Scope and in Risks here. Task 4 is dropped, and the `creditLeakCheck.ts` row comes out of the Files table.
- **W-2 (guard):** do not add `creditLeakCheck.ts` to the guard file list. Add `currentPeriodStartMs` to `withoutDisplayMaths` and to the non-vacuity name loop. If the new `isCurrentPeriodRow` body no longer builds a `Date`, keep its exclusion anyway (it is harmless), but say so in the comment.
- **W-3 (D-4 tests):** flip **both** L208 (`true` → `false`) and L210 (`false` → `true`), each with a one-line comment citing the SQL `>` on microseconds, and move them into the C-3 block. `subMillisecondPart` reads `fraction.padEnd(6,'0').slice(3)` from `TIMESTAMP_PARTS`, and a missing fraction counts as zero. Add a C-3 case with a non-UTC-offset anchor that has sub-ms digits.
- **W-4 (C-2 pin robustness):**
  - Collapse whitespace before matching the multi-line months-diff expression.
  - Add an assertion that **no other file** in `supabase/migrations/` contains `FUNCTION public.business_os_credit_period_start(` preceded by `CREATE` or `CREATE OR REPLACE`, so a future redefinition fails this test rather than leaving the pin on a dead body. The message should say "re-pin to the new migration".
  - The "calls `addMonthsClampedUtc` twice" source assertion is fine. The fixed vectors (W-1, plus the C-3 cases) carry the real weight.
- **W-5 (unreadable monthly anchor):** in `computePositions`, if the once-per-account expected key is `null`, the account becomes `UNKNOWN_POSITION`, not "no row → 100% left". Today it silently reads as 100%, and an unknown is the honest answer (it mirrors the trial branch, which already refuses an unreadable anchor). Add one test.
- **W-6 (C-4 wording):** the `nextPeriodStartUtc` header comment and the module header must stop calling the selector "the card's reset-date mirror". Also state there that the card's displayed reset instant is millisecond-truncated (display only), while the selector is exact to the SQL tie.

### Also confirmed

- D-1 steps match the SQL line for line. `addMonthsClampedUtc` keeps the time of day, and its `Date.UTC` month-index overflow handles negative and >11 month indices (cases b and year roll). W-1 vectors cover both.
- D-2: one caller, computed once per account. No new round trip, so SQ-42 holds and the NFR performance item is met.
- SA (d) test (task 11): approved as planned. Trials (`isAtOrAfter`) are untouched, so FR-5 holds.
- No migration, no UI, no new pattern, no entitlements import change. `test:bos-entitlements` stays in the run list.

### Approval
[x] Workplan approved — proceed to implementation once W-1..W-6 are applied to the task list

## SA Code Review

**Code Review by SA — 2026-10-12**
**Status:** ✅ Code Approved

### Verified

| Item | Finding |
|---|---|
| Mirror vs SQL (C-2) | The SQL converts both inputs with an explicit `AT TIME ZONE 'UTC'` and takes `extract(year/month)` from those UTC timestamps, so session tz plays no part. The TS `getUTCFullYear/getUTCMonth` diff is the same basis. `timestamp + make_interval(months)` clamps to the month end and keeps the time of day, and `addMonthsClampedUtc` does the same (no DST on a tz-less timestamp). Step back once, on strict `>`. Exact match. |
| Tie rule (C-3) | `now` has 0 µs, so SQL `candidate > now` ⇔ `candMs > nowMs` or (`candMs == nowMs` and anchor µs > 0). Correct. Mutation `>=` (dropping the µs clause) → 3 tests fail. |
| C-2 pin on drift | The flattened body asserts the UTC conversions, the month expression, two `make_interval` adds and the exact `IF … > … END IF` block. Changing `>`→`>=`, removing `'UTC'` or changing the clamp fails it. Single-definition: a new `CREATE OR REPLACE FUNCTION public.business_os_credit_period_start(` in any `supabase/migrations/*.sql` makes `defining` two files and fails it. The rollback lives in `supabase/SQL Scripts/`, not scanned, which is correct. |
| Guard exclusion | Not vacuous. The loop asserts `export function currentPeriodStartMs` is present in the source and absent after the cut. The cut is one named body: lazy up to the first column-0 `}`, and the body has none. |
| Repro | Exact dates: anchor `2026-10-12T18:21:50Z`, row `2026-10-04 15:15:01+00` / 20276. Checked for list (100%), finance (used 0), owner card and the per-account block. |
| Deviations | Optional 4th arg: fine (one caller, computed once per account, the default keeps the old 3-arg contract). The helper extraction does not change behaviour. `jest.mock('@/lib/supabaseServer')` in the test is acceptable. It is only there for the W-1 parity import. |
| W-5 | Unreadable monthly anchor → `UNKNOWN_POSITION`. Tested. |
| Standards | No `console.*`, no `any`, no DB/migration/UI/entitlements change. |
| Tests (SA run) | 6 targeted suites: 266/266 pass. |

### Optimisation Suggestions (non-blocking)
- The C-2 `DEFINITION` regex requires the literal `public.` prefix. A redefinition written as `"public"."business_os_credit_period_start"` or without the schema would slip past. Consider `/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+("?public"?\.)?"?business_os_credit_period_start"?\s*\(/i`.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-12**
**Test mode:** full
**Strategy used:** A (Jest unit, injected deps), plus a scratch old-code run and a temporary edge-probe suite. The fix is pure selection logic over rows already read, so unit tests with injected repositories cover it completely. No live or prod DB access.
**Focus:** api, schema (period maths)
**Skipped:** the AC-5 manual browser check. It needs the user's admin session on the test account, so it is listed below for the user.
**Input source:** prompt keywords (TL trigger)

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-1 Repro: anchor `2026-10-12T18:21:50Z`, old row 2026-10-04 / 20,276 → 100% left, used 0 | ✅ | Pass | List and finance both pass. On origin/main code the same test **fails** (see below) |
| AC-2 Unmoved anchor still selects its current row | ✅ | Pass | Existing test passes. Probe: exact-boundary and 1 ms-before cases match the SQL |
| AC-3 Finance agrees with list, not over allowance | ✅ | Pass | `adminCreditPositions.test.ts` + repro finance projection. Probe: 3 rows (two old-anchor, one new) → used 2000 in both readers |
| AC-4 Per-account admin block agrees with owner card | ✅ | Pass | `creditPosition.test.ts` SA (d) case; no code change needed |
| AC-5 Manual: `/admin/users` equals owner card on `5f63adbd…` | ⬜ | Owed by user | Steps below |
| FR-5 Trials unchanged | ✅ | Pass | Probe: trial sums from its anchor (90%, trial true). Trial accounts never take the W-5 unknown path |
| SA C-1 / C-3 edge cases | ✅ | Pass | 16 mirror vectors: the 31st across Feb/Mar (incl. Mar 15 → clamped Feb 28 key, Mar 31 → Mar 31), µs anchor `2026-10-12 18:21:50.123456+00` incl. the sub-ms tie, leap day 2028-02-29 (→ 2029-02-28 clamp), exact boundary, Dec→Jan roll, `+03:00` offset |

### Old-code verification (done, not taken from Dev's record)
`git show origin/main:` copies of `creditPeriod.ts` and `adminCreditPercent.ts` went to temp `*.qaold.ts` files, with a copy of `adminCreditPercent.test.ts` pointed at them. Result: **5 failed / 26 passed**. The failures were repro list, repro finance, case a, the 31st re-anchor and W-5. This is the same result Dev recorded. Case b and the unmoved case pass on the old code too, as Dev said: they are regression nets. The temp files are deleted. The working tree was not touched: no stash, no checkout.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The key is computed once per account, with no new round trip (SQ-42 holds).

#### Edge Cases (nice to fix)
1. (Carried from SA, non-blocking) The C-2 single-definition regex needs the literal `public.` prefix. A quoted or schema-less redefinition would get past it. Low.

### Test Outputs / Logs
```text
6 targeted suites ............................ 6 passed, 266 tests passed
npx jest lib/business-os/credits lib/business-os/finance ... 44 suites, 1,834 tests passed
npm run test:bos-entitlements ................ 242 suites, 7,203 tests passed
old-code run (origin/main copies) ............ 5 failed, 26 passed (expected)
QA edge-probe suite (temp, deleted) .......... 20 passed
npx eslint (6 touched files) ................. clean (exit 0)
console.* in touched files ................... 0 (none added)
```

### Manual check owed by the user (AC-5)
1. Sign in as a platform admin and open `/admin/users`.
2. Find account `5f63adbd-7297-4e93-b0c7-b12cc2198e85` (champion) and note "Credits left". Expected: 100%, or the same figure as step 4 if it has been used since.
3. Optional: open the admin finance page and confirm the account is not counted as over its allowance.
4. In another browser or profile, sign in as that account's owner and open the Business OS Credits card. Note the percent left.
5. Pass when the figures in steps 2 and 4 are the same. Before the fix the list showed 0%.

### Final Status
- [x] All automated acceptance criteria pass. The code is ready for commit once the user has done the AC-5 manual check and approved the diff.
- [ ] Issues found — Dev must address before commit

## Commit Info

PR #331, `fix(business-os): admin Credits left ignores the old period after a re-anchor`, merged to main 2026-10-13.

---

## Follow-up: fold the leak check onto the mirror (W-1)

**Date:** 2026-10-13 · **Status:** Implemented (uncommitted), awaiting SA code review, then QA, then the user's view of the diff

The nightly leak check's `creditPeriodStartAt` (`creditLeakCheck.ts`) had its own copy of the period rule: `addMonthsUtc`, `Date.parse`, and no sub-millisecond tie. It now reuses `currentPeriodStartMs`. Its signature and its no-plan-row calendar-month branch are unchanged.

### SA ruling (plan review, 2026-10-13): approved with F-1..F-7

| Item | Ruling |
|---|---|
| P-1 delegate | Approved. Signature kept; the `Number.isFinite(atMs)` guard stays first; `addMonthsUtc` deleted. |
| P-2 (a) sub-ms tie | **Accepted, label only.** A µs anchor on a millisecond tie now steps back a month, like the SQL `>`. `periodOf` feeds only the `periodStart` label of uncharged groups and the first ungrouped call, plus `leakPeriodStarts`. Case, USD and account status never read it. The label is exact to the SQL for a millisecond `at`; it is not the recorder's stored key (that is read verbatim when a charge exists). |
| P-2 (b) parser narrowing | **Accepted, label only.** `period_anchor` is a PostgREST `timestamptz` and always has an offset. A zone-less string was read as server-local time (wrong); it now gives null, the documented "period unknown". |
| P-2 (c) month helper | Equivalent: `Date.UTC` month overflow vs an explicit year roll. Covered by the year-roll rows. |
| Q3 calendar month | Reuse `calendarMonthStartUtc` (output byte-identical for years 0000–9999, and already pinned to the migration). |
| P-3 guard | `creditLeakCheck.ts` gets its own rule, `LEAK_KEY_TO_DATE` (`KEY_TO_DATE` without `created_at`/`createdAt`), with no display-maths cut. `Date.parse(row.created_at)` (row instants for the window, ms by design) and `Date.parse(period)` (a label dedupe/sort key) are deliberate carve-outs, asserted explicitly. It cannot join the shared `it.each` list while those parses remain. |
| P-4 parity table | Replaced: a source assertion (no `addMonths`, calls `currentPeriodStartMs(`) and new leak-check rows for both sides of the tie and a zone-less anchor. |

Conditions: **F-1** the existing period rows pass unchanged. **F-2** doc comments (delegation, label never a key, zone-less → null, no claim to replay the stored key; the `creditPeriod.ts` header and `currentPeriodStartMs` name the leak check as a consumer). **F-3** guard planted matches and non-matches plus non-vacuity. **F-4** a comment on `Date.parse(period)`. **F-5** `/addMonths/` absent, `currentPeriodStartMs(` present; delete the W-1 describe. **F-6** drop the `creditLeakCheck` import and the `supabaseServer` mock from `creditPeriod.test.ts`. **F-7** record the closure in this workplan, the requirement and both Change Histories.

### Files modified

| File | Change |
|---|---|
| `lib/business-os/credits/creditLeakCheck.ts` | `creditPeriodStartAt` delegates to `calendarMonthStartUtc` and `currentPeriodStartMs`; `addMonthsUtc` deleted; F-2 doc comment; F-4 comment on the label dedupe key. |
| `lib/business-os/credits/creditPeriod.ts` | Comments only (F-2): the header and `currentPeriodStartMs` name the leak check's labels as a consumer. |
| `lib/business-os/credits/__tests__/creditPeriod.test.ts` | W-1 parity describe deleted; `creditLeakCheck` import and `supabaseServer` mock removed (F-6); new leak-check guard block (F-3, F-5). |
| `lib/business-os/credits/__tests__/creditLeakCheck.test.ts` | 3 NEW rows: µs anchor on the tie steps back; ms anchor on the tie keeps the candidate; zone-less anchor → null. Existing rows untouched. |

### Task list

- ✅ F1. Fold `creditPeriodStartAt`; delete `addMonthsUtc`.
- ✅ F2. **F-1 check, run before any test file was edited:** `npx jest …/creditLeakCheck` gave 3 suites, **58/58 pass**. Every existing period row passes unchanged.
- ✅ F3. Guard (F-3, F-5). Non-vacuity checked against the pre-fold file (`git show HEAD:`): `LEAK_KEY_TO_DATE` matches it and `/addMonths/` matches it, so both assertions would have been red on the old code.
- ✅ F4. Parity table replaced (P-4); F-6 cleanup.
- ✅ F5. Comments (F-2, F-4).
- ✅ F6. Docs (F-7).
- ✅ F7. Tests, eslint and tsc (below).
- ✅ F8. Nothing committed.
- ✅ F9. After SA's code review, both optional suggestions taken: `creditPeriodStartAt` returns null when `atMs` is outside the `Date` range (it had returned a `NaN-NaN-01…` string; before the fold it threw `RangeError`), and the F-4 comment is wrapped.

### Test results

| Command | Result |
|---|---|
| `npx jest …/creditLeakCheck` (before any test edit) | 3 suites, 58 tests pass |
| `npx jest lib/business-os/credits lib/business-os/finance` | 44 suites, 1,831 tests pass. Was 1,834: −9 parity rows, +3 guard tests, +3 leak-check rows |
| `npm run test:bos-entitlements` | 244 suites, 7,224 tests pass |
| `npx eslint` (4 touched files) | clean |
| `npx tsc --noEmit -p .` | 0 errors from the change. The 2 TS2688 errors (missing `@types` for jest and node) are environmental: the worktree's `node_modules` has no `@types` (same as PR #331) |
| `console.*` in touched files | 0 |

## SA Code Review — W-1 follow-up

**Code Review by SA — 2026-10-13**
**Status:** ✅ Code Approved (one condition: the tsc cell must show a clean result before QA starts)

### Conditions F-1..F-7

| Item | Verdict | Evidence |
|---|---|---|
| F-1 existing rows unchanged | ✅ | `git diff` adds only 3 new rows to `creditLeakCheck.test.ts`, with no edits or deletions. The SA run of the `creditPeriod` + `creditLeakCheck` suites gives 4 suites and 116/116 passing. |
| F-2 doc comments | ✅ | `creditPeriodStartAt` states the delegation, "label, never a key", zone-less → null, and makes no claim to replay the stored key. The `creditPeriod.ts` header and the `currentPeriodStartMs` doc both name the leak check as a consumer. |
| F-3 guard | ✅ | There are planted matches (anchor, `row.period_start`) and planted non-matches (`row.created_at`, `Date.parse(period)`), and the file is asserted to contain `creditPeriodStartAt` after comment stripping. |
| F-4 comment on `Date.parse(period)` | ✅ | `creditLeakCheck.ts` dedupe loop. |
| F-5 one mirror | ✅ | `/addMonths/` is absent, `currentPeriodStartMs(` is present, and the W-1 parity describe is deleted. |
| F-6 test cleanup | ✅ | The `creditLeakCheck` import and the `supabaseServer` mock are gone from `creditPeriod.test.ts`. |
| F-7 docs | ✅ | The requirement's Out of Scope item is struck through and closed. The status line and both Change Histories are updated. |

### Mutation proof (SA, temporary edits, restored byte-identical, md5 checked, `git diff --numstat` unchanged)

| Mutation | Result |
|---|---|
| The tie clause is removed from `currentPeriodStartMs` | The µs-tie leak-check row goes red (1 failed) |
| `Date.parse(anchorIso)` is planted in `creditPeriodStartAt` | The leak guard goes red |
| `new Date(row.period_start)` is planted | The leak guard goes red |
| An `addMonthsUtc` helper is re-added | The one-mirror assertion goes red |
| `Date.parse(period)` is planted | It stays green, which is the declared carve-out, as intended |

### Behaviour equivalence (outside the accepted P-2 (a)/(b))

The month difference, clamping and step-back are identical. `displayInstantMs` truncates to ms exactly as V8's `Date.parse` did, `Date.UTC` month overflow equals the explicit year roll (P-2 (c)), and the null-anchor branch is identical for real instants. The remaining deltas are all unreachable for PostgREST `timestamptz` strings and current-era `created_at` instants:

1. The parser is narrowed to `TIMESTAMP_PARTS`. A fraction longer than 6 digits now gives null (Postgres never emits one). A space separator and `+HH` / `+HHMM` offsets are accepted, which widens it toward the SQL. — Priority: Low, no action.
2. The calendar-month branch is byte-identical for years 1000–9999, not 0000–9999 as the plan ruling said: `calendarMonthStartUtc` does not zero-pad years below 1000. This corrects the SA ruling text. — Priority: Low, no action.
3. A finite `atMs` beyond the `Date` range (> 8.64e15) used to throw `RangeError` on the null-anchor branch. It now returns `"NaN-NaN-01T00:00:00.000Z"`. The anchored branch returns null, as before it threw. This is unreachable because `atMs` comes from `Date.parse(row.created_at)` or the window. — Priority: Low; see the suggestion.

### Code Review Comments

1. `docs/workplans/…_WORKPLAN.md` Test results — the tsc cell is still the `TSC_RESULT` placeholder. Fill it with the real result before QA. — Priority: Medium (condition)

### Optimisation Suggestions

- In `creditPeriodStartAt`, `if (Number.isNaN(at.getTime())) return null;` after `new Date(atMs)` would close delta 3 and make "null when unusable" hold on both branches. This is optional.
- The F-4 comment in the dedupe loop is a single long line. Wrapping it is style only.

### Code Approved for QA: Yes (once the tsc cell shows clean)

## QA Testing Report — W-1 follow-up

**QA — 2026-10-13**
**Test mode:** full (focus on behaviour equivalence)
**Strategy used:** A (Jest, no DB). A throwaway old-vs-new differential test, plus the existing suites
**Focus:** pipeline of the leak check's period label (`creditPeriodStartAt`), schema of anchor strings
**Skipped:** DB and live runs. Out of scope: the change is pure TS and its output is a label that is never sent to the database
**Input source:** prompt (TL brief)

### 1. Old-vs-new differential

A temporary test (`lib/business-os/credits/__tests__/leakPeriod.qatmp.test.ts`, now deleted) held a verbatim copy of the pre-change `creditPeriodStartAt` + `addMonthsUtc` (from `git show HEAD:`). It compared that copy with the new export.

**Grid.** 21,672 anchors:
- years 2023 / 2024 (leap) / 2026 / 2028 (leap)
- months Jan / Feb / Mar / Dec
- days 1 / 15 / 28 / 29 / 30 / 31, where the day exists
- 3 times of day
- fractions none / `.000` / `.123` / `.123456` / `.000001` / `.999999` / `.5`
- offsets `Z` / `+00:00` / `+03:00` / `-02:00` / `+00` / `+0300`
- separators `T` and space

The `at` instants for each anchor were: the anchor ±26 months (clamped like Postgres) at −1 ms, exactly, +1 ms and +3 days; the anchor itself ±1 ms; and the bounds of the anchor's calendar month. On top of the grid: a null anchor across ±26 calendar-month boundaries ±1 ms, zone-less, date-only and garbage anchors, and a 7-digit fraction. About 4.7 M comparisons in total.

| Category | Count | Verdict |
|---|---|---|
| Identical | 3,851,188 | — |
| µs anchor whose ms-truncated candidate equals `at`: new = old(`at` − 1 ms), one period back | 473,880 | SA-accepted P-2 (a). Each one is checked to equal the old answer one ms earlier, not merely "earlier" |
| Old null → new value (`+00` / `+0300` offsets, and any separator with those offsets): V8 `Date.parse` rejects them, the new parser accepts them | 391,902 | SA low delta 1, a widening toward the SQL. Every one is checked to equal the old function run on the normalised anchor (`T`, `+HH:MM`), with the µs tie applied where it fits. **No wrong value** |
| Zone-less anchor (`…T10:00:00`, `… 10:00:00.123456`, date-only `2026-01-31`) → new null, old read it as local time or UTC | 21 | SA-accepted P-2 (b) |
| Any other difference | **0** | — |

The null anchor (calendar month) matched old at every boundary. `atMs` NaN / Infinity gave null on both. Once the temporary file was deleted, `git status --short` showed only the 6 changed files.

### 2. Suites

| Command | Result |
|---|---|
| `npx jest lib/business-os/credits lib/business-os/finance` | 44 suites, **1,831 / 1,831 pass** (matches Dev's count) |
| `npm run test:bos-entitlements` | 245 suites, **7,225 / 7,225 pass**. This run happened while the temporary differential file existed, and it was picked up by the `credits/__tests__` glob. Without that file it is Dev's 244 suites / 7,224 tests |
| `npx jest creditLeakCheck ac31` (`creditLeakCheck.test.ts`, `.ac31.test.ts`, `.wireTypes.test.ts`) | 3 suites, **61 / 61 pass**. Classification (case, USD, account status) is unaffected |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| F-1 existing period rows unchanged | ✅ | Pass | The leak-check suites are green. The differential shows no unaccepted change in the period label |
| P-2 (a) µs tie steps back (happy + tie path) | ✅ | Pass | New unit row, plus 473,880 differential cases that each equal old(`at` − 1) |
| P-2 (b) zone-less → null (failure path) | ✅ | Pass | New unit row, plus 21 differential cases |
| One mirror (F-5) / guard (F-3) | ✅ | Pass | In `creditPeriod.test.ts`, inside the 1,831 |
| Leak classification unaffected | ✅ | Pass | creditLeakCheck + ac31: 61 / 61 |
| Entitlements registration | ✅ | Pass | 7,225 / 7,225 |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None.

#### Edge Cases (nice to fix)
None new. Where the new code differs from the old, it either matches the SQL more closely or returns the documented "period unknown" null.

### Final Status
- [x] All acceptance criteria pass — ready for commit (after the user has seen the diff)
- [ ] Issues found — Dev must address before commit

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Created | Dev workplan against SA conditions C-1..C-4 |
| 2026-10-12 | SA workplan review | Approved with conditions W-1..W-6: D-3 deferred (test-only parity table), second tie flip at L210, guard list unchanged for creditLeakCheck, C-2 pin guards against redefinition, unreadable monthly anchor → unknown |
| 2026-10-12 | Implemented | W-1..W-6 applied; code complete, uncommitted; task list and test results updated |
| 2026-10-13 | PR #331 merged | Status line and Commit Info updated (the status line had still said uncommitted) |
| 2026-10-13 | W-1 follow-up | SA plan ruling F-1..F-7; leak-check `creditPeriodStartAt` folded onto `currentPeriodStartMs`; parity table replaced by a guard; implemented, uncommitted |
| 2026-10-13 | SA code review (W-1 follow-up) | Approved: F-1..F-7 met and mutation-proven; tsc placeholder to be filled before QA; three unreachable low-priority deltas recorded |
| 2026-10-13 | QA (W-1 follow-up) | PASS. Old-vs-new differential over about 4.7 M cases: 0 unaccepted differences (µs tie 473,880, `+HH`/`+HHMM` widening 391,902 all correct, zone-less 21). Suites: credits+finance 1,831/1,831, entitlements 7,225/7,225, leak check+ac31 61/61. No bugs |
| 2026-10-13 | Follow-up: C-2 redefinition regex widened | SA/QA Low finding closed: the "defined in exactly one migration" check now matches any case/spacing, optional `public`/`"public"` schema and quoted name, anchored to line start (comments ignored); inline fixtures prove each variant is caught and `_v2`, other-schema, call, REVOKE/GRANT/DROP lines are not. Still scans `supabase/migrations` only |
