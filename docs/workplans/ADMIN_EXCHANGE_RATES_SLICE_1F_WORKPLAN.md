# Workplan: Admin Exchange Rates — Slice 1f (Rates last checked: by whom)

> **Last Updated**: 2026-10-25

**Developer:** Dev
**Requirement:** [ADMIN_EXCHANGE_RATES_REQUIREMENT.md](/docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md): §1 row 1f, D-11, FR-56 to FR-59, §8 slice 1f, SA §13.9 (SQ-53 to SQ-58)
**Branch:** `feature/admin-exchange-rates-last-check-by` (worktree `neuronforge-fx-1f`, off `origin/main` `e0d64fb2`, which includes 1e #511)
**Date:** 2026-10-25
**Status:** Code Complete (UNCOMMITTED; awaiting SA code review and QA)
**Workplan review:** none required (§13.9: "Dev builds from the step list below. There is no separate workplan review.")

## Overview

The user asked (2026-10-25): "add a small PR, that similar to the Last rate change, add by whom what the last check performed. not just teh date". Slice 1f makes the "Rates last checked" tile name the admin who ran that sync, the same way "Last rate change" names its editor. The task list is SA §13.9's Dev step list, followed exactly; this file only records what was built, the deviations and the checks. No migration, no new request, no new pattern.

---

## In plain words

- On Finance → Exchange rates, the **Rates last checked** tile's small line now reads **"by Anna Admin · ECB rates of 2026-10-23"**, not just "ECB rates of 2026-10-23".
- The name follows the same rule as "Last rate change": the admin's name, else their admin email, else "Unknown user".
- If the name lookup fails, the tile shows the admin's short id (as "Last rate change" does), because "we could not look it up" is not "nobody".
- An old sync entry with no recorded admin reads "by Unknown user".
- Right after you press **Sync rates**, the tile names **you**, with no extra request, and a reload shows the same name.
- Nothing else changes: the tile's time, "No sync on record", "Could not check", the sync itself and its audit entry. No name or email is ever written to a log.

---

## Task list

Steps are SA §13.9's Dev step list.

- ✅ Step 1: `exchangeRateRules.ts`: `editorLabel(id, lookup)`; `labelHistory` rewritten on top of it (no behaviour change). Five `editorLabel` tests appended; the existing `labelHistory` tests unedited.
- ✅ Step 2: `rateSyncRules.ts`: `LastRateSyncWire` `ok` gains `checkedBy` / `checkedByLabel`; new `LastRateSyncRecord`, `RateViewerWire`, `labelLastSync`; `ExchangeRatesReadPayload` gains `viewer`; `lastSyncFromSync(answer, viewer)`; header line for 1f. Tests: `labelLastSync` (ok, none / unavailable, failed lookup, null actor) and `lastSyncFromSync` (viewer, viewer with null label, null).
- ✅ Step 3: `AuditTrailRepository.ts`: `ADMIN_EXCHANGE_RATE_SYNC_COLUMNS` = `'created_at, rate_date:details->>rateDate, checked_by:actor_id'`; mapping (string → `checkedBy`, null → null, other type → error); `AdminExchangeRateSyncRun.checkedBy`; header and constant comments per SQ-53. Test: exact select, ban list drops `actor`, adds `user_id`; null actor and non-string actor cases.
- ✅ Step 4: `app/api/admin/exchange-rates/route.ts`: `resolveLookup(ids, logger)`; `settleLastSync` returns `LastRateSyncRecord`; the plain read's one lookup covers history editors, `lastChange`, the sync actor and `gate.user.id`; payload gets `labelLastSync(...)` and `viewer`; `?currency=` passes `historyEditorIds(records)`; header updated; logs unchanged.
- ✅ Step 5: route test: forced edits (happy body, ids test, "only null editors", "no history at all", exact keys) and a new `describe('slice 1f: who ran the last check')`; SA-1c-7 log test extended with the sync actor's and the caller's name and email, and `checkedBy` never logged.
- ✅ Step 6: `ExchangeRatesKpis.tsx`: sub-line `by {changedByText(...)} · ECB rates of {rateDate}`, `?? null` for a pre-1f answer; header line. `changedByText.ts`: comment only.
- ✅ Step 7: `ExchangeRatesView.tsx`: `viewerRef` set beside `setPayload(result.data)` for the current request only; `runSync` calls `lastSyncFromSync(answer, viewerRef.current)` (deps stay empty); no new `fetch(`; header line.
- ✅ Step 8: render test fixtures (forced edit) and a new `describe('slice 1f')`; `KpiStrip.callers.pin` per SQ-57.
- ✅ Step 9: checks (below).
- ✅ Step 10: this workplan, and §1 row 1f in the requirement.

---

## Files

| File | Action | Commit |
|---|---|---|
| `lib/admin/exchangeRates/exchangeRateRules.ts` | modify | C1 |
| `lib/admin/exchangeRates/__tests__/exchangeRateRules.test.ts` | modify (import line + appended describe) | C1 |
| `lib/admin/exchangeRates/rateSyncRules.ts` | modify | C1 |
| `lib/admin/exchangeRates/__tests__/rateSyncRules.test.ts` | modify | C1 |
| `lib/repositories/AuditTrailRepository.ts` | modify | C1 |
| `lib/repositories/__tests__/AuditTrailRepository.latestExchangeRateSync.test.ts` | modify | C1 |
| `app/api/admin/exchange-rates/route.ts` | modify | C1 |
| `app/api/admin/exchange-rates/__tests__/route.test.ts` | modify | C1 |
| `app/admin/exchange-rates/components/ExchangeRatesKpis.tsx` | modify | C1 |
| `app/admin/exchange-rates/components/changedByText.ts` | modify (comment only) | C1 |
| `app/admin/exchange-rates/components/ExchangeRatesView.tsx` | modify | C1 |
| `app/admin/exchange-rates/__tests__/exchangeRates.render.test.tsx` | modify | C1 |
| `app/admin/components/layout/__tests__/KpiStrip.callers.pin.render.test.tsx` | modify | C1 |
| `docs/requirements/ADMIN_EXCHANGE_RATES_REQUIREMENT.md` | modify (BA + SA edits already present, plus §1 row 1f) | C2 |
| `docs/workplans/ADMIN_EXCHANGE_RATES_SLICE_1F_WORKPLAN.md` | create | C2 |

Untouched, as ruled: the sync route, `ecbFeed.ts`, `ecbRates.ts`, `app/admin/finance/**`, `lib/business-os/**`, the audit registry, `eventAudience`, `rateSync.source.test`, `redundantPages.source.guard` (G-6 still 4 `fetch(`), `adminReadMethods.guard`. No migration.

---

## Commit plan (RM)

One PR, two commits (SQ-58), on `feature/admin-exchange-rates-last-check-by`:

| Commit | Message | Files |
|---|---|---|
| C1 | `feat(admin): name who ran the last exchange rate check` | the 13 code and test files above |
| C2 | `docs(admin): record exchange rates slice 1f` | the requirement and this workplan |

Exchange-rates fast-track: SA code review and QA approve, then RM commits, opens the PR and turns on auto-merge (`--merge`), with no wait for the user to see the diff.

---

## Deviations

| # | Deviation | Why |
|---|---|---|
| DV-1 | The view also maps a missing `viewer` (a pre-1f answer) with `?? null`, like SQ-56's `?? null` for the checker fields | Same deploy-skew reason; it then shows "Unknown user", which SQ-55 already rules for `viewer === null` |
| DV-2 | The repository maps a missing `checked_by` key (undefined) the same as null | `row.checked_by ?? null`; PostgREST always returns the alias, so this only matters for a malformed row, which then reads "Unknown user" rather than erroring |
| DV-3 | Extra tests beyond the step list: route "the viewer is the session admin" and "`?currency=` never sends a viewer"; render "a pre-1f answer reads Unknown user", "after a sync, a viewer whose label failed shows the short id", "after a sync with no viewer reads Unknown user"; route log test also asserts `checkedBy` never appears in a log | Cheap pins for SQ-55 and SQ-57 edges |
| DV-4 | In the route test's forced edits, "the ids looked up come from…" now uses a distinct sync actor (`SYNCER`), and "only null editors" sets the sync actor to null | So each test still proves what its title says now that the caller and the actor are in the lookup |
| DV-5 | `exchangeRateRules.test.ts` gained one import line (`editorLabel`) in its shared import block | Needed by the appended tests; no `labelHistory` test was edited |
| DV-6 | Step 9's `npm run lint` and `npm run build` were not run; eslint ran on the 13 touched files and `npm run lint:hooks` on the repo | The TL brief listed the narrow checks; the full build is ship drill step 1 for RM / QA |

---

## Checks

| Check | Result |
|---|---|
| Narrow Jest: `lib/admin/exchangeRates`, `app/api/admin/exchange-rates`, `app/admin/exchange-rates`, `AuditTrailRepository.latestExchangeRateSync`, `adminReadMethods.guard`, `rateSync.source`, `redundantPages.source.guard`, `KpiStrip.callers.pin`, audit-trail `filterOptions.guard` | 18 suites / 904 tests, all green |
| `tsc --noEmit -p tsconfig.json` (8 GB heap), filtered to the touched files | 0 errors in touched files; the run finished with its usual pre-existing diagnostics elsewhere (no OOM, no V8 trace) |
| `eslint` on the 13 touched code files | 0 errors, 0 warnings |
| `npm run lint:hooks` | clean |
| `console.*` in touched non-test files | 0 |
| `KpiStrip.callers.pin` | 4 re-hashed (two tiles, no history, name lookup failed, old rate null); 3 unchanged (loading, last sync none, last sync unavailable); 2 appended (last sync checker label failed, last sync no checker). The loading hash did not move |

---

## SA Review Notes

### SA code review

**Code Review by SA — 2026-10-26**
**Status:** ✅ Code Approved (no fix required; two Low notes, neither gating)

Read as `git diff` in `neuronforge-fx-1f` against §13.9 (SQ-53 to SQ-58). Re-ran the step-9 Jest list myself: 17 suites / 895 tests green (the Dev's 18 / 904 also ran `filterOptions.guard`).

#### Against the rulings

| Ruling | Check | Result |
|---|---|---|
| SQ-53 | `ADMIN_EXCHANGE_RATE_SYNC_COLUMNS` is exactly `'created_at, rate_date:details->>rateDate, checked_by:actor_id'`; the test asserts the constant and the `.select(...)` argument | ✅ |
| SQ-53 | Mapping: string → `checkedBy`; null (and missing, DV-2) → `null`; any other type → the existing throw-and-return-error path. Filters, order, limit, admin context unchanged | ✅ |
| SQ-53 | Ban regex drops `actor`, keeps `details` / `email` / `ip_address` / `hash`, adds `user_id`. Header and constant comments updated | ✅ |
| SQ-54 | `resolveLookup(ids, logger)`; zero-id early return kept. Plain read: one `Set` over `historyEditorIds(allRecords)`, the `ok` non-null sync actor, and `gate.user.id`. `?currency=` passes `historyEditorIds(records)` and builds no viewer | ✅ |
| SQ-54 | All or nothing: a failed lookup nulls history, `lastChange`, `lastSync.checkedByLabel` and `viewer.label` together, still 200 (route test) | ✅ |
| SQ-54 | `editorLabel` is the old `labelHistory` body for one id, line for line (no id → "Unknown user", failed → null, trimmed name, else email, else "Unknown user"). `labelHistory` now maps through it; its tests are unedited and green | ✅ |
| SQ-54 | Record / wire split: `settleLastSync` → `LastRateSyncRecord`; `labelLastSync` is the only place the label is added | ✅ |
| SQ-55 (a′) | `viewer` = `{ userId: gate.user.id, label: editorLabel(...) }`: session id plus the same label rule, no email field, no other PII. Never from the request | ✅ |
| SQ-55 (a′) | `viewerRef.current` is set after `if (!isCurrent()) return` and after the `!result.ok` return, so only the newest successful plain read writes it. `runSync` reads the ref; its deps stay empty | ✅ |
| SQ-55 (a′) | No new `fetch(`: the only added `fetch(` text in the view is inside the header comment, and G-6 counts after `stripComments`; `redundantPages.source.guard` green and unedited. Sync route: no diff | ✅ |
| SQ-56 | Sub-line `by ${changedByText(...)} · ECB rates of ${rateDate}` with `?? null` for a pre-1f answer; value, label, `testId`, "No sync on record" and "Could not check" unchanged. `changedByText.ts`: comment only | ✅ |
| SQ-57 | `KpiStrip.callers.pin`: 4 re-hashed (two tiles, no history, name lookup failed, old rate null); 3 unchanged (`loading` `aa4935d0…`, none, unavailable); 2 appended (checker label failed, no checker) = 9 Exchange rates hashes. No other caller's hash in the diff; dated amendment line present | ✅ |
| SQ-57 | Logging: no `logger.*` line added or changed anywhere in the diff. The SA-1c-7 test now covers the sync actor's and the caller's name and email, proves the labels resolved first (non-vacuous), and asserts `checkedBy` never appears in a log | ✅ |
| SQ-57 | `rateSync.source.test`, `adminReadMethods.guard`, G-6: unedited, green | ✅ |
| — | `requireAdmin` is still the first statement of `GET`, and nothing above it touches the database | ✅ |
| — | Hooks: one `useRef` at the top level beside the existing refs; no conditional hook; `lint:hooks` clean (Dev) | ✅ |
| — | Domain: no entitlements import, no LLM call, no cron, no caller-supplied id, no migration, 0 `console.*` in touched files | ✅ |

#### Deviations

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** `result.data.viewer ?? null` is the same deploy-skew guard SQ-56 ruled for the checker fields, and it lands in the case SQ-55 already rules ("Unknown user") |
| DV-2 | **Accepted.** A missing alias key is treated as null. PostgREST always returns the alias, so this only affects a malformed row, and "Unknown user" is the right reading there. A non-string value still fails |
| DV-3 | **Accepted.** These are cheap edge pins and they guard exactly the SQ-55 and SQ-57 behaviour. The `checkedBy`-not-logged assertion is worth keeping |
| DV-4 | **Accepted, and required.** Without a distinct `SYNCER`, and without a null actor in "only null editors", those tests would pass for the wrong reason now that the caller (ADMIN) is always in the lookup |
| DV-5 | **Accepted.** One import name in the shared block is not an edit to a `labelHistory` test |
| DV-6 | **Accepted with a condition.** The narrow checks are enough for code review. `npm run build` (ship drill step 1) and `npm run lint` must still pass before the PR opens, run by QA or the RM. This slice adds a field to a type that both server and page import, and a build is the check that catches a missed consumer |

#### Code Review Comments

1. `lib/repositories/AuditTrailRepository.ts:86-88`: the header comment reflows into a stray short line ("returns at / most one / row"). Cosmetic. Priority: Low (optional; not a blocker).
2. `lib/admin/exchangeRates/__tests__/exchangeRateRules.test.ts:26`: `editorLabel` is inserted after `labelHistory`, out of the block's order. Cosmetic. Priority: Low (optional).

#### Optimisation Suggestions

- None. The added cost is the one SQ-54 accepted: on the plain read the lookup now always runs, as two small `.in()` reads in parallel.

#### Commit plan

C1 / C2 as in the table above and SQ-58: C1 = the 13 code and test files (they cannot split, because `LastRateSyncWire` and `lastSyncFromSync` cross server and page); C2 = the requirement and this workplan. **Approved.** This SA review goes in C2. Update the requirement's §1 row 1f with the SA and QA results before C2 is cut. The exchange-rates fast-track applies (SQ-58): after QA approves and the DV-6 build and lint pass, the RM commits, opens the PR and turns on auto-merge (`--merge`).

### Code Approved for QA: Yes

---

## QA Testing Report

**QA — 2026-10-26**
**Test mode:** full
**Strategy used:** A (Jest unit: `editorLabel`, `labelLastSync`, `lastSyncFromSync`, repository mapping) and B (Jest route and render tests with mocked repositories), plus the production build. The change is read-only and fully mockable, so no live script was needed.
**Focus:** api, ui, security (logs), guards
**Skipped:** the §8 "Manual check" (sync, see your name, reload). QA has no browser session; this is owed as a click-through after deploy.
**Input source:** TL prompt (QA brief for slice 1f)
**Verdict:** **PASS-WITH-NOTES** (no bugs; notes N-1 and N-2 below)

### Test Coverage (§8 slice 1f)

| Acceptance criterion | Tested? | Result | Test(s) |
|---|---|---|---|
| After a reload: "by {name} · ECB rates of {rateDate}"; no name → email; neither → "Unknown user"; no actor → "Unknown user" | ✅ | Pass | render `slice 1f` "after a reload", "no actor on the entry"; route `slice 1f` "a sync actor in no history row…" (name), "…also a history editor…" (email fallback); `editorLabel` "a blank name falls back to the email", "neither a name nor an email"; route "a null actor"; repo "a null actor → checkedBy null" |
| Failed lookup: short id, never "Unknown user"; every label null together; still 200 | ✅ | Pass | route "a failed lookup nulls the lastSync label, the viewer label, every history label and lastChange together; still 200"; render "a failed name lookup shows the short id"; `labelLastSync` "a failed lookup"; pin "last sync checker label failed" |
| After a sync: names the admin at once, no second GET; a later re-read does not move it back | ✅ | Pass | render "after a sync: the viewer's label, with no second GET" (plain-GET count unchanged), "a later re-read carrying an older lastSync by another admin does not replace the visit's name", "a viewer whose label failed shows the viewer's short id", "an answer from before 1f (no viewer)"; `lastSyncFromSync` 3 cases |
| One lookup: each source called once with history editors, `lastChange` editor, sync actor and caller, de-duplicated; never a request id; `?currency=` unchanged | ✅ | Pass | route "the ids looked up come from … de-duplicated, never from the request", "a sync actor who is also a history editor is looked up once", "the viewer is the session admin", "?currency= never sends a viewer, and never looks the caller up" |
| Read shape: columns exactly `created_at, rate_date:details->>rateDate, checked_by:actor_id`; no `details`, hash, email, ip, `user_id` | ✅ | Pass | repo test exact-select and ban-list test ("never scopes by user_id, never selects details, user_id, the email, the ip or the hash"); non-string actor → error path |
| Unchanged states: "No sync on record", "Could not check", loading | ✅ | Pass | `KpiStrip.callers.pin`: `loading`, `last sync none`, `last sync unavailable` hashes unchanged (verified in the diff: only the 4 named hashes changed, 2 appended); route "lastSync none / unavailable still gets a viewer" |
| Logs: no name or email in any log line | ✅ | Pass | route SA-1c-7 test: plain read (success), `?currency=` read, and a failed lookup; asserts no history editor, sync actor or caller name / email, and no `checkedBy` key. Client: the view's 7 logger calls log status, counts, codes and outcome only (read by QA) |
| Guards green and unedited: G-6 (4 `fetch(`), `rateSync.source`, `adminReadMethods.guard`; pin 4 moved, 2 appended | ✅ | Pass | all green; `git status` shows those guard files and the sync route untouched; the view still has 4 `fetch(` call sites |
| Manual check: sync, see your name; reload, the same name | ⚠️ | Not run | Owed after deploy (see the "Skipped" line). The automated tests above cover both halves |

### Edge-case probes (TL brief)

| Probe | Result | Evidence |
|---|---|---|
| A reload shows the actor's name | Pass | render "after a reload"; route "a sync actor in no history row is named…" |
| Right after a sync: the caller's own name, no second GET | Pass | render "after a sync: the viewer's label, with no second GET" |
| A failed name lookup shows the short id | Pass | render (reload and after-sync variants); pin case |
| A null actor shows "Unknown user" | Pass | route, render, repo, `labelLastSync`, pin "last sync no checker" |
| A pre-1f answer (no `viewer` / `checkedBy`) shows "Unknown user" | Pass | render "an answer from before 1f (no checker fields)" and "…(no viewer)"; `?? null` in `ExchangeRatesKpis.tsx` and `ExchangeRatesView.tsx` |
| "No sync on record" and "Could not check" unchanged | Pass | pin hashes kept |
| `?currency=` returns no viewer | Pass | route "?currency= never sends a viewer" |
| No name or email in any log | Pass | SA-1c-7 route test; client log calls read |

No test gaps were found, so no tests were added.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. As SA §13.9 SQ-54 ruled, the plain read now always runs the name lookup (the caller is always in it). That is two small `.in()` reads, accepted.

#### Edge Cases / Notes
1. **N-1 `npm run lint` repo-wide exits 1** with 449 errors and 9,790 warnings, all in files this slice does not touch. **0 findings in any of the 13 touched files.** The SA's DV-6 condition ("`npm run lint` pass") can only mean "clean for the touched files" on this repo, the same reading as the ship drill's typecheck rule. QA reads it as met.
2. **N-2 Manual click-through owed** (the §8 "Manual check"), after deploy.

### Test Outputs / Logs

- **Narrow Jest (`--ci`)**: `lib/admin/exchangeRates`, `app/api/admin/exchange-rates` (plain, `[currencyCode]`, `sync`), `app/admin/exchange-rates`, `AuditTrailRepository.latestExchangeRateSync`, `adminReadMethods.guard`, `redundantPages.source.guard`, `KpiStrip.callers.pin`, `audit-trail/filterOptions.guard`, `lib/audit/filterOptions`, `layoutFolder.guard` → **Test Suites: 20 passed, 20 total; Tests: 1323 passed, 1323 total.** This is more than Dev's 18 / 904 because QA also ran `lib/audit/__tests__/filterOptions.test.ts` and `layoutFolder.guard`.
- **CI-parity guards**: `redundantPages.source.guard` (G-6 asserts 4 `fetch(`) PASS; `rateSync.source` PASS; `adminReadMethods.guard` PASS; `KpiStrip.callers.pin` PASS; `filterOptions.guard` and `lib/audit/filterOptions` PASS; `layoutFolder.guard` PASS.
- **`npm run build`** (`NODE_OPTIONS=--max-old-space-size=8192`): **exit 0.** "✓ Compiled successfully", "✓ Generating static pages (318/318)", route table printed (incl. `/api/admin/exchange-rates`). No OOM: 0 matches for `heap out of memory` / `FATAL ERROR` / V8 trace. Only pre-existing noise: Edge-runtime warnings from `@supabase/realtime-js` via `lib/security/onboardingVerdict.ts`, and "Dynamic server usage" logs during static generation (e.g. `/api/admin/execution-stats`), none in the slice's files.
- **`npm run lint`**: see N-1.

### Final Status
- [x] All acceptance criteria pass (manual click-through owed after deploy) — ready for commit
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_RM to populate (PR number, commits)._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Created and built (uncommitted) | Built from SA §13.9 Dev steps 1 to 10. 13 code / test files, 2 docs. Narrow Jest 18 suites / 904 tests green; tsc 0 errors in touched files; eslint and `lint:hooks` clean; pin 4 moved, 3 kept, 2 appended. DV-1 to DV-6 recorded. Awaiting SA code review and QA |
| 2026-10-26 | SA code review | **Code Approved** against §13.9 SQ-53 to SQ-58; step-9 Jest re-run 17 suites / 895 tests green. DV-1 to DV-5 accepted; DV-6 accepted on condition that `npm run build` and `npm run lint` pass before the PR. Two Low cosmetic comments, not gating. C1 / C2 plan approved. Ready for QA |
| 2026-10-26 | QA | **PASS-WITH-NOTES.** Narrow Jest `--ci` 20 suites / 1323 tests green; every §8 1f criterion mapped to a test (manual click-through owed after deploy); 8 edge-case probes pass; no gaps, no tests added. `npm run build` exit 0 (8 GB heap, no OOM). CI-parity guards green (G-6 = 4, `rateSync.source`, `adminReadMethods.guard`, KpiStrip pin, `filterOptions`, `layoutFolder`). `npm run lint`: 0 findings in the touched files; repo-wide it exits 1 on pre-existing errors (N-1). No bugs |
