# Workplan: Admin Layout LF-4a.1 (Businesses drawer pin suite)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1.2 BD-13, §1.3 (PIN-a to PIN-k), §7.3 AC-4.1 and AC-4.3, §13 SA-C4, SA-C5, SA-C6
**Branch:** `feature/admin-layout-lf4a1` (cut from `feature/admin-layout-lf2`; PRs #338 and #339 open)
**Path:** Test-only PR. SA reviews the pin list below before merge (SA-C4)
**Date:** 2026-10-13
**Status:** PR #340 open — fast-track (SA pin review passed); the user merges

## Overview

A characterisation suite for the Businesses drawer on `/admin/users`. It renders the whole page, opens the drawer from the row's Open button, and pins every money and danger action exactly as it works today: the opener, the dialog words, the confirm step, the request (URL, method, headers, body, `cache` option), the request id, one send per double click, no close while a request is in flight, one failure path, the success notice and the re-read. It also pins the per-open request list for three kinds of account. It is green on the unchanged code and changes no product file. LF-4a.2, LF-4b and LF-4c may edit these tests only where an opener moves, plus the named, deliberate edits (BD-6 reconcile copy and move, BD-14 re-read).

---

## Analysis Summary

Read in full on 2026-10-13: every file under `app/admin/users/**` (page, hook, 12 components, copy files, 14 existing test files), `components/business-os/purge/TestAccountCleanupPanel.tsx`, `app/admin/components/layout/AdminDrawer.tsx`, `hooks/useLatestArchiveCutoff.ts`.

| What | Where today | Notes |
|---|---|---|
| Drawer body | `BusinessDetail.tsx` | `BusinessOsPanel` first, danger area last; `SHOW_AD1_DELETE_ENTRY = false` (`:39`) |
| Panel's two reads | `BusinessOsPanel.tsx:423-437` | entitlements + summary, `cache: 'no-store'`, once per mount. `CreditsBlock` and `BoostBlock` mount only when both settled and neither says `not_a_business_os_account` (`:483`). A 500 on either read still mounts both blocks |
| Give / Take back | `CreditsBlock.tsx` + `CreditFormDialog.tsx` | POST to the entitlements admin route; `requestId` minted per opening, kept across failures; `inFlight` ref + `handleOpenChange` refuse a close mid-POST |
| Take back on a top-up | `BoostBlock.tsx:255-281` | Through the panel's `takeBackRequest` (seq), opened from the Credits block's loaded data, not from the lot row |
| Set limit / Back to default | `BoostBlock.tsx:362-381` + `BoostCapDialog.tsx` | `set_boost_cap` / `end_boost_cap`, no request id |
| Reconcile | `BoostBlock.tsx:550-560` + `BoostReconcileDialog.tsx` | POST, header, literal `'{}'`, `cache: 'no-store'`; `reconcileOutcome` turns `passesFailed > 0` into a failure |
| Remove this account | `BusinessDetail.tsx:292-301` + `TestAccountCleanupPanel` | Locked to the row email; check then typed confirmation then delete; `onRemoved` on Done after a CLEAN report calls `refreshList` (the page's `fetchUsers`) |
| Detail reads | `useBusinessDetails.ts` | login-stats, audit-logs, stats: `fetch(url)` with no init |
| Other per-open reads | `useLatestArchiveCutoff` (`/api/admin/archiving`, no init), the cleanup panel's probe (`GET /api/admin/test-account-cleanup/check`, no init) | |

No file imports `lib/business-os/entitlements/`; the suite imports types only from `app/admin/users/types` and `lib/business-os/boost/boostAdminViewTypes`, plus the existing `recordedAccountBody.json` fixture.

## Implementation Approach

- **Whole drawer, never a block alone (§1.3).** Each test renders `UsersPage`, waits for the list, clicks the row's Open button and drives the drawer. `next/navigation` and `@/lib/logger` are mocked as in `businessDetail.render.test.tsx`.
- **One recording fetch stub per file.** Every call is recorded with URL, method, headers, raw body string and `cache` option, so request pins compare against what was actually passed to `fetch`. Answers are routed by URL and method; POST answers come from per-route queues and can be held open with a deferred promise (double click, close in flight). An in-flight counter lets each test wait until every request has answered before it ends.
- **`crypto.randomUUID` is a counter** that records every id it mints, so "one id per opening, the same id on retry, a new id on the next opening" is checked against what was minted.
- **A true double click.** Two `click()` calls inside one `act`, so React has not re-rendered (and not disabled the button) between them: the second click reaches the handler and only the `inFlight` ref can refuse it.
- **No console errors.** Every test spies on `console.error` and `console.warn` and fails if either was called (the `adminUsersLayout.render` pattern), which also catches stray `act` warnings.
- **No regex backslashes, no `any`.** Paths are matched with string methods; `global.fetch` is assigned through `as unknown as typeof fetch`.
- **Three files, split by area.** Jest collects every file under `__tests__`, so a shared harness file would run as an empty suite; each file carries its own copy of the harness, as the sibling suites do.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx` | create | Give, Take back, the paid gate, request id, double click, close in flight, failures, own account (both blocks) |
| `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx` | create | Take back on a top-up (BD-9), Set limit, Back to default, Reconcile |
| `app/admin/users/__tests__/businessDrawer.pins.dangerReads.render.test.tsx` | create | Remove this account, the hidden Delete… entry, the per-open request list for three accounts (PIN-k, AC-4.3), non-Business OS drawer (BD-13 today) |
| `docs/workplans/ADMIN_LAYOUT_LF4A1_WORKPLAN.md` | create | This workplan |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-4a.1 row, Change History |

No product file and no existing test is edited.

## PIN coverage

Test names are the `it(...)` titles, prefixed by file: **C** = `businessDrawer.pins.credits`, **B** = `businessDrawer.pins.boost`, **D** = `businessDrawer.pins.dangerReads`.

### Per action

| Action | Opener + words + confirm step | Request (URL, method, headers, body, cache) | Notice + re-read | Request id (PIN-a) | Double click + no close in flight (PIN-f) | Failure (PIN-g) |
|---|---|---|---|---|---|---|
| Give credits, no end date | C: `GIVE-1` | C: `GIVE-1` | C: `GIVE-1` | C: `GIVE-3` | C: `GIVE-4` | C: `GIVE-5` |
| Give credits, dated | C: `GIVE-2` | C: `GIVE-2` | C: `GIVE-2` | — | — | — |
| Take back, a number | C: `TAKE-1` | C: `TAKE-1` | C: `TAKE-1` | C: `TAKE-1` | C: `TAKE-5` | C: `TAKE-4` |
| Take back, `'rest'` | C: `TAKE-2` | C: `TAKE-2` | — | — | — | — |
| Take back, paid gate | C: `TAKE-3` | C: `TAKE-3` | — | — | — | — |
| Take back credits on a top-up | B: `TOPUP-1` | B: `TOPUP-1` | B: `TOPUP-1` | B: `TOPUP-2` | (same dialog as Take back) | (same dialog as Take back) |
| Set limit | B: `CAP-1` | B: `CAP-1` | B: `CAP-1` | n/a, no id today (body pinned exactly) | B: `CAP-3` | B: `CAP-4` |
| Back to default | B: `CAP-2` | B: `CAP-2` | B: `CAP-2` | n/a, no id today (body pinned exactly) | B: `CAP-5` | B: `CAP-5` |
| Run billing reconcile | B: `REC-1` | B: `REC-1` | B: `REC-1` | n/a, no id today (body is the literal `'{}'`) | B: `REC-2` | B: `REC-3` |
| Remove this account | D: `DANGER-1` | D: `DANGER-2` | D: `DANGER-2` (one list read on Done) | n/a, no id today | D: `DANGER-3` (double click only; see F-1) | D: `DANGER-4` |
| Delete… (hidden) | D: `DANGER-5` | D: `DANGER-5` (no preview request) | — | — | — | — |

### PIN-a to PIN-k

| Pin | Covered by |
|---|---|
| PIN-a request id: one per opening, same on retry, new on the next opening | C: `GIVE-3`, C: `TAKE-1`, C: `TAKE-4`, B: `TOPUP-2` |
| PIN-b Take back bodies: number and `'rest'`; `confirmPaidCredits` only when the lot needs it; submit blocked until ticked | C: `TAKE-1`, C: `TAKE-2`, C: `TAKE-3`, B: `TOPUP-1` |
| PIN-c Give bodies: `expiresAt` null and dated | C: `GIVE-1`, C: `GIVE-2` |
| PIN-d exact `set_boost_cap` and `end_boost_cap` bodies | B: `CAP-1`, B: `CAP-2` |
| PIN-e headers and `cache` on every POST | C: `GIVE-1`, C: `TAKE-1`, B: `CAP-1`, B: `CAP-2`, B: `REC-1`, D: `DANGER-2` (cleanup POSTs: header, no `cache` option, pinned as today) |
| PIN-f one send per double click; Credit, Cap and Reconcile dialogs refuse to close in flight | C: `GIVE-4`, C: `TAKE-5`, B: `CAP-3`, B: `CAP-5`, B: `REC-2`, D: `DANGER-3` |
| PIN-g one failure path per action, mapped sentence, `exceeds_remaining` with the figure, reconcile 200 with `passesFailed` | C: `GIVE-5`, C: `TAKE-4`, B: `CAP-4`, B: `CAP-5`, B: `REC-3`, D: `DANGER-4` |
| PIN-h no money button on the admin's own account | C: `OWN-1` (both blocks: no Give, Take back, Set limit, Back to default, Reconcile or top-up take-back line, with lots, a top-up lot and an active limit present) |
| PIN-i BD-9: top-up Take back on a folded lot and on a lot not loaded; "Take back in Credits above"; "Nothing left to take back" | B: `TOPUP-1`, B: `TOPUP-3` (folded), B: `TOPUP-4a` (not loaded: Credits read failed), B: `TOPUP-4b` (not loaded yet: Credits read still running, then the button appears), B: `TOPUP-5` (nothing left) |
| PIN-j danger: email lock, last block, `onRemoved` reads the list once, no Delete… | D: `DANGER-1`, D: `DANGER-2`, D: `DANGER-5` |
| PIN-k per-open request list: Business OS, non-Business OS, failed entitlements or summary read | D: `READS-1`, D: `READS-2`, D: `READS-3`, D: `READS-4` |

## Task List

- ✅ Step 1: Read the requirement (§1.2, §1.3, §7.3, §13) and every file under `app/admin/users/**`
- ✅ Step 2: Write this workplan with the pin list
- ✅ Step 3: Credits file (Give, Take back, own account)
- ✅ Step 4: Top-ups file (BD-9, Set limit, Back to default, Reconcile, own account)
- ✅ Step 5: Danger and reads file (Remove, Delete…, PIN-k)
- ✅ Step 6: Mutation runs on product files, each reverted, checksums compared
- ✅ Step 7: Jest set, guards, `lint:hooks`, scoped `tsc` with a canary, `git diff --numstat`
- ✅ Step 8: Requirement §1 row and Change History

## Findings

Recorded, not fixed (test-only slice).

| # | Finding | Why it is not pinned |
|---|---|---|
| F-1 | **Remove this account has no in-flight close lock.** The drawer closes on Escape while the cleanup delete is in flight, which unmounts `TestAccountCleanupPanel`. Its unmount cleanup runs before the answer arrives, so `cleanPending` is set after the cleanup already ran: a CLEAN delete answered after the close never calls `onRemoved`, and the list keeps showing the removed account until the next refresh. | Pinning it would freeze a defect. The suite pins only the double-click guard for the delete (D: `DANGER-3`). Proposed for LF-4a.2 or a separate fix: refuse the drawer's close while the panel is busy, or fire `onRemoved` from the answer when the panel is gone |
| F-2 | **There is no lot fold today.** PIN-i asks for a top-up Take back "on one whose lot is folded"; BD-8 adds the fold in LF-4b. | B: `TOPUP-3` simulates the fold the way BD-8 defines it (rows hidden, never unmounted) by setting `hidden` on every lot row, and pins that the top-up path still opens the dialog. LF-4b must switch the test to the real fold control |
| F-3 | Set limit, Back to default, Reconcile and Remove send **no request id** today; only the two credit ops do (OP-32). | Their bodies are pinned exactly, so adding an id later is a visible, deliberate edit |
| F-4 | The two cleanup POSTs send the `Content-Type` header but **no `cache` option**, unlike every money POST. | Pinned as today (absent) in D: `DANGER-2` |
| F-5 | The three detail reads, the archive cutoff read and the cleanup probe call `fetch(url)` with no init (no `cache: 'no-store'`). | Pinned as today in PIN-k |

## Implementation Notes

### Tests

| File | Tests | Covers |
|---|---|---|
| `businessDrawer.pins.credits.render.test.tsx` | 11 | `GIVE-1` to `GIVE-5`, `TAKE-1` to `TAKE-5`, `OWN-1` |
| `businessDrawer.pins.boost.render.test.tsx` | 14 | `TOPUP-1`, `TOPUP-2`, `TOPUP-3`, `TOPUP-4a`, `TOPUP-4b`, `TOPUP-5`, `CAP-1` to `CAP-5`, `REC-1` to `REC-3` |
| `businessDrawer.pins.dangerReads.render.test.tsx` | 9 | `READS-1` to `READS-4`, `DANGER-1` to `DANGER-5` |
| **Total** | **34** | |

Two pins exist only so a later, named edit is visible: `GIVE-1` and `TOPUP-1` assert that a Give or a Take back reads neither the top-ups block nor the list today. BD-14 (LF-4b) adds one list read and must edit those two lines by name.

Each file sets `jest.setTimeout(30_000)` and an RTL wait timeout of 5 s. The first full run, made while `lint:hooks` was running in parallel, timed out in two of the three files (GIVE-1 alone takes about 3 s, against Jest's 5 s default). After the change, three full runs under the same parallel load were green.

### Verification

| Run | Result |
|---|---|
| Jest: `app/admin/users`, `app/admin/components`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/__tests__/tailwind-css-escape.guard.test.ts` | 41 suites, 1,282 tests, all pass (three runs under parallel lint load, all green) |
| Pin files alone | 3 suites, 34 tests, all pass |
| `npm run test:bos-entitlements` (collects `app/admin/users/__tests__`) | 248 suites, 7,273 tests, all pass |
| `npm run lint:hooks` | Clean, exit 0 |
| ESLint on the three new files | Clean, exit 0 |
| Scoped `tsc` (scratchpad tsconfig extending the worktree's, `incremental: false`, `plugins: []`; `next-env.d.ts` plus the three new files) | Run 1 with a canary: exactly `zz-canary.ts(1,7): error TS2322`, exit 2. Run 2 without it: exit 0. Scratch files deleted |
| Backslashes in the three test files and this workplan | 0 |
| `git status` | Only the three new test files, this workplan and the requirement are changed; no product file |

### Mutation runs

A scratchpad script applied each mutation to the product file, ran the three pin files, restored the file and compared its SHA-256 before and after. Every checksum matched; `git status` showed no product file changed afterwards.

| # | Product file | Mutation | Pins that failed |
|---|---|---|---|
| M1 | `CreditFormDialog.tsx` | Give body: `expiresAt` undefined instead of null (the key drops out) | `GIVE-1` |
| M2 | `CreditFormDialog.tsx` | Paid-credits gate removed from `formValid` | `TAKE-3`, `TOPUP-1` |
| M3 | `BoostReconcileDialog.tsx` | `cache: 'no-store'` changed to `'default'` | `REC-1` |
| M4 | `CreditFormDialog.tsx` | A new request id minted after a failed POST | `GIVE-3`, `TAKE-4` |
| M5 | `BoostCapDialog.tsx` | `end_boost_cap` body gains an `amountMinor` key | `CAP-2` |
| M6 | `CreditFormDialog.tsx` | In-flight guard removed from `submit` | `GIVE-4`, `TAKE-5` (6 more failed as a cascade: `act` warnings from the aborted held request leaked into the next tests' console spies) |
| M7 | `CreditFormDialog.tsx` | Close-while-in-flight refusal removed | `GIVE-4`, `TAKE-5` |
| M8 | `BoostBlock.tsx` | `canChange` ignores `isOwnAccount` | `OWN-1` |
| M9 | `BoostBlock.tsx` | The top-ups read also re-runs when `takeBack` changes (one extra read per open) | `READS-1`, `READS-3`, `READS-4` |
| M10 | `BusinessDetail.tsx` | `SHOW_AD1_DELETE_ENTRY = true` | `DANGER-5` |
| M11 | `BusinessDetail.tsx` | `onRemoved` reads the list twice | `DANGER-2` |
| M12 | `BusinessOsPanel.tsx` | The money blocks mount for a non-Business OS account | `READS-2` |
| M13 | `boostCopy.ts` | `passesFailed` above 0 no longer treated as a failure | `REC-3` |
| M14 | `BusinessDetail.tsx` | Cleanup panel not locked to the row's email | `DANGER-1`, `DANGER-2`, `DANGER-3`, `DANGER-4` |
| M15 | `BoostReconcileDialog.tsx` | In-flight guard removed from `run` | `REC-2` (`REC-3` as a cascade) |

## SA Review Notes

### SA Review (pin list)

**Reviewed by SA — 2026-10-13** (SA-C4 pin-list review against SA-C5, PIN-a to PIN-k)
**Status:** APPROVED WITH FIXES (fixes 1 to 4 below, then proceed to QA; no second SA pass, the TL confirms the two re-run mutations bite)

#### What was checked

| Check | Result |
|---|---|
| Scope: `git status`, `git diff` | Only the three new test files, this workplan and the requirement (§1 row and Change History, 2 lines) changed. No product file, no existing test. |
| Baseline | 3 suites, 34 tests, green on the unchanged code (about 30 to 40 s per file, 48 s wall time in parallel). |
| PIN-a to PIN-k, every SA-C5 item | Each is asserted in the tests themselves, not only named in the titles (detail below). |
| Harness | Unknown GET or POST URL goes into `unexpected`, checked in `afterEach`. The console guard fails on any `console.error` or `console.warn`. `crypto.randomUUID` is a recording counter. The double click is two clicks inside one `act`, so it is real. |
| Timeouts | 30 s per test and 5 s for RTL waits. Justified: GIVE-1 takes about 3 s alone and the first run under parallel lint load hit Jest's 5 s default. A wait timeout can only turn a pass into a fail, so it cannot hide a regression. The files add about 40 s of worker time to one Jest shard; RM should confirm the shard still finishes inside the Build critical path. |

#### Assertion read-through

- **PIN-a (request id):** pinned correctly. GIVE-3 checks one id minted on the opening, none on a failed retry, a new one on the next opening, and the sent ids `[first, first, second]`. TAKE-4 checks reuse after `exceeds_remaining`. TOPUP-2 checks renewal through the top-up opener. The dialog mounts on each opening (`{dialog && <CreditFormDialog open …/>}`), so "mint once per mount" is equivalent to the code today. If LF-4b keeps the dialog mounted, GIVE-3 and TOPUP-2 will catch a lost renewal.
- **PIN-b, PIN-c, PIN-d:** bodies are compared with `toStrictEqual`, and `confirmPaidCredits` is present only for the paid lot (TAKE-1 against TAKE-3, TOPUP-1). The paid gate checks that Continue is disabled before the tick and enabled after it.
- **PIN-e (URL, method, headers, cache, body compared exactly):** partly met. GIVE-1, TAKE-1, TOPUP-1, CAP-1, CAP-2, REC-1 and DANGER-2 compare all five fields. GIVE-2 and TAKE-2 skip URL and method. TAKE-3 compares the body only. The retries in GIVE-3, TAKE-4, TOPUP-2 and REC-3 compare only the request id, or only URL and body. Headers use `toEqual`, which ignores a key whose value is undefined. See fix 1.
- **PIN-f:** met for the Credit, Cap and Reconcile dialogs. Escape is the close path the test drives, and every close path, including outside click, goes through the same `handleOpenChange` guard. DANGER-3 pins only the double click, which is correct given F-1.
- **PIN-g:** met. The mapped sentences are compared exactly, including `Only 120 are left on this gift.` and the reconcile failure words for a 200 with `passesFailed: 1`.
- **PIN-h:** met. OWN-1 checks eight test ids and six role names, with take-back lots, a top-up and an active limit present.
- **PIN-i:** met. TOPUP-3 is simulated (F-2). TOPUP-4a covers a failed read, TOPUP-4b a read still running, and TOPUP-5 both "Nothing left to take back" and a top-up with no lot.
- **PIN-j:** met, with one gap. Danger is the last block, the cleanup panel is the last child of the danger area, both fields are locked and read-only, and Delete… plus its preview are absent. M11 proves a double read after Done is caught, but a read at report time is not: see fix 3.
- **PIN-k:** met, and strongly. Every opening's requests are compared as a sorted list of `method url cache headers` strings, so an extra or missing read fails (my mutation S4 bit 4 of 9). The count is taken after `settle()`, so a read that comes late is only caught if it lands before the settle tick. Fix 2 also covers this.

#### SA mutation runs (not tried by the Dev)

Each run copied the product file to the scratchpad, applied the mutation, ran the pin files, restored the file and compared SHA-256. All four restored OK, and `git status` showed no product file afterwards.

| # | Product file | Mutation | Result |
|---|---|---|---|
| S1 | `TestAccountCleanupPanel.tsx` | Locked mode reads the list on the CLEAN report and again on Done (two list reads per removal) | **Survived**, 9 of 9 pass. DANGER-2 takes its list baseline after the report. Fix 3 |
| S2 | `BusinessDetail.tsx` | The audit section moved below the danger area (danger no longer last) | Bit, 1 of 9 fail (DANGER-1) |
| S3 | `CreditsBlock.tsx` | After a success, a second Credits re-read 150 ms later | **Survived**, 34 of 34 pass. "One re-read" is checked only as the first `waitFor` reaches it, never after the drawer goes quiet. Fix 2 |
| S4 | `BusinessOsPanel.tsx` | The panel's two reads lose `cache: 'no-store'` | Bit, 4 of 9 fail (READS-1 to READS-4) |

#### Fixes required (test files only; no product change)

1. **Compare the whole request on every POST, retries included.** Use one helper per file that checks the recorded call with `toStrictEqual` against `{ url, method, headers, cache, body }`, with the body parsed. Reconcile keeps the raw string `'{}'`. Cleanup POSTs state `cache: undefined` explicitly. Apply it in GIVE-2, TAKE-2, TAKE-3, TOPUP-2, CAP-3, CAP-5, REC-2, DANGER-3, and to every retry in GIVE-3, TAKE-4 and REC-3. This is PIN-e "on every POST", and it makes BD-14 and LF-4c edits visible as one assertion each.
2. **Exact read counts after the drawer goes quiet.** Add a `quiet()` helper: no request in flight and `calls.length` unchanged for a fixed window (about 300 ms, real timers). After it, assert the final Credits, top-ups and list counts with `toBe`. Use it after the success in GIVE-1, TAKE-1, TOPUP-1, CAP-1, CAP-2 and REC-1, after the failure in GIVE-5, TAKE-4, CAP-4 and REC-3, and in `requestsOfOneOpen` for PIN-k. Re-run S3: it must bite.
3. **DANGER-2: one list read per removal, measured across the whole delete.** Take the list baseline before the Delete click. Assert no list read between the CLEAN report and Done, and exactly one after Done (with fix 2's `quiet()`). Re-run S1: it must bite.
4. **A POST to a known URL with an empty queue goes into `unexpected`** in all three files, as well as getting its 500 answer. Today it returns `'not queued'` silently, so an unplanned extra POST is caught only where a test happens to count POSTs.

Record S1 to S4, and the re-runs of S1 and S3 after the fixes, in the mutation table. The TL confirms both bite. No further SA pass is needed unless a fix changes what a pin asserts.

#### Rulings on the findings

| # | Ruling |
|---|---|
| F-1 | **A separate small fix slice (call it LF-F1), not LF-4a.2 and not record-only.** It is a real defect on a danger path: the account is removed but the list still shows it until the next refresh. Data is not at risk, so it is Low to Medium and does not block LF-4a.1. LF-4a.2 moves the danger area as a whole unit and must not change its behaviour, so the fix cannot ride along. Preferred fix: inside `TestAccountCleanupPanel`, when a CLEAN answer arrives after unmount, call `onRemovedRef.current` directly. This is one file, has no UX change, and leaves the shared Danger Zone use unaffected. Locking the drawer's close while the panel is busy is the alternative, but it changes `AdminDrawer` behaviour for every drawer, so it is not preferred. The fix slice adds the pin that closing mid-delete still reads the list once. The TL records F-1 in the requirement §14 findings, with this ruling. |
| F-2 | **Accepted, with a named obligation on LF-4b.** In jsdom, `hidden` only proves the top-up path does not depend on the lot row being visible, which is weak. LF-4b must replace TOPUP-3's hand-set `hidden` with the real fold control (folded state), and assert the folded lot rows are still in the DOM (BD-8: hide, never unmount). It is a named, deliberate edit, so add it to LF-4b's list of permitted pin edits beside BD-14. |
| F-3 | **Pinned as-is, accepted.** The bodies are exact, so adding a request id later is a visible, deliberate edit with its own requirement line. |
| F-4 | **Pinned as-is, accepted.** A missing `cache` on a POST has no practical effect, because browsers do not cache POST responses. Changing it is not layout work. |
| F-5 | **Pinned as-is, accepted.** Any change to these reads' init is a named edit of PIN-k. A possibly stale detail read is a candidate for a later data-freshness item, not this requirement. |

#### Duplicated harness

**Acceptable now; not required.** Each of the three copies is about 250 lines, and their route tables differ on purpose (one account against four, the reconcile queue, the held Credits read). A shared module under `__tests__` would be collected as an empty suite. A module elsewhere is a new test-helper location, which is a pattern needing its own decision. The repo's `tests/` root is already outside `testMatch` when the file has no `.test` suffix, so it would be the natural home. Fixes 1 to 4 must be applied identically in all three files. **Trigger to extract:** if LF-4a.2, LF-4b or LF-4c adds a fourth file using this harness, move the shared part (stub, deferred, settle, quiet, console guard, uuid counter) into one helper under `tests/admin/`, keeping the per-file route tables, in that slice.

#### Optimisation suggestions (non-blocking)

- Restore the console spies in a `finally` (or before the `expect` lines) in `afterEach`. A failed guard then cannot leak a spy into the next test, which is part of the cascade seen in M6 and M15.
- Danger area for a login with no email ("This login has no email, so it cannot be removed here.") is not pinned. It is outside SA-C5 but is a one-line `it` if convenient.
- PIN-f drives Escape only. That is enough today, because all close paths share `handleOpenChange`. If LF-4b adds `onInteractOutside` or `onEscapeKeyDown` handlers, it should add an outside-click case.

### Approval
[x] Pin list approved, with fixes 1 to 4 applied before QA. Merge stays test-only and must precede any drawer code change (SA-C4).

### SA fixes applied (Dev, 2026-10-13)

Fixes 1 to 4 and the optional console-spy suggestion are applied identically in all three pin files. Only test files changed.

| Fix | What changed |
|---|---|
| 1. Whole-request comparison | `requestOf(call)` gives `{ url, method, headers, cache, body }` with the body parsed (raw for reconcile). Every POST, retries included, is compared with `toStrictEqual` against `opsPost(body)`, `RECONCILE_POST` (body the literal `'{}'`) or `CHECK_POST` / `DELETE_POST` (`cache: undefined` stated). This now covers GIVE-1 to GIVE-5, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2, CAP-1 to CAP-5, REC-1 to REC-3 and DANGER-2 to DANGER-4 |
| 2. Quiet-state read counts | `quiet()`: nothing in flight and no new call for 300 ms, repeated until a window passes with no new call. `expectReads({ credits, boost, list })` asserts the final exact counts after it. Used after every success and failure in the credits and top-ups files, and in OWN-1. PIN-k's `requestsOfOneOpen` takes its list only after `quiet()` |
| 3. DANGER-2 list reads | Baseline taken before the Delete click; `quiet()` then no list read between the CLEAN report and Done; `quiet()` then exactly one after Done |
| 4. Unexpected POSTs | `fromQueue(queue, url)`: a POST to a known URL with an empty queue goes into `unexpected` (and still answers 500) |
| Optional | `afterEach` restores both console spies in a `finally` |

**Re-runs (same scratchpad runner; each product file restored, SHA-256 matched before and after; `git status` shows no product file):**

| # | Mutation | Before the fixes | After the fixes |
|---|---|---|---|
| S1 | `TestAccountCleanupPanel.tsx`: locked mode also calls `onRemoved` when the CLEAN report arrives (two list reads per removal) | Survived | **Bites:** DANGER-2 (list reads 2, expected 1) |
| S3 | `CreditsBlock.tsx`: a second Credits re-read 150 ms after success | Survived | **Bites:** 11 tests, every Credits success path (GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2), each on `expectReads` (credits 3, expected 2) |
| M1 | Give body `expiresAt` undefined | GIVE-1 | GIVE-1, GIVE-3, GIVE-4, GIVE-5 |
| M6 | Credit dialog in-flight guard removed | GIVE-4, TAKE-5 (+6 knock-on) | GIVE-4, TAKE-5 only: no knock-on failures any more, thanks to fix 4 and the `finally` |
| M14 | Cleanup panel not locked to the email | DANGER-1 to DANGER-4 | DANGER-1 to DANGER-4 |

S3 is applied as a single-line edit (`setNotice(lines); setTimeout(reload, 150);`). The product file has CRLF line endings, so a two-line pattern never matched; the behaviour is the one SA described.

**After the fixes:** pin files 3 suites, 34 tests. Jest on `app/admin/users`, `app/admin/components`, the authz guard and the tailwind guard: 41 suites, 1,282 tests, all pass. `lint:hooks` exit 0; ESLint on the three files exit 0; scoped `tsc` with the canary gives exactly `zz-canary.ts(1,7) TS2322` (exit 2), then exit 0 without it. Backslashes in the three files: 0.

## QA Testing Report

[QA will populate this section]

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf4a1` (cut from `feature/admin-layout-lf2`) |
| Code commit | `14ef6d46` test(admin): pin every money and danger action in the Businesses drawer (LF-4a.1) |
| `origin/main` | Already contained (`808939ef`), nothing to merge |
| PR | [#340](https://github.com/AgentsPilot/neuronforge/pull/340), base `main`; contains #338 and #339 while those are open |
| Checks before push | Admin Jest scope 41 suites / 1,282 tests pass; `test:bos-entitlements` 248 suites / 7,273 tests pass; `lint:hooks` clean; pin files alone `--runInBand` 34 tests, about 37 s of suite time (credits 16.1 s, boost 12.5 s, dangerReads 8.3 s) |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Workplan written; suite built | Dev: pin list PIN-a to PIN-k mapped to tests; three test files, 34 tests; 15 mutations bite; no product file edited; findings F-1 to F-5 |
| 2026-10-13 | SA pin-list review | SA: APPROVED WITH FIXES 1 to 4. SA mutations S1 (an extra list read at report time on removal) and S3 (delayed second Credits re-read) survived; S2 and S4 bit. F-1 to its own fix slice LF-F1; F-2 a named LF-4b edit; F-3 to F-5 accepted as pinned; duplicated harness acceptable until a fourth file |
| 2026-10-13 | SA fixes 1 to 4 applied (Dev) | Whole-request `toStrictEqual` on every POST incl. retries; `quiet()` and exact final read counts; DANGER-2 baseline before Delete; unexpected POST on an empty queue; console spies restored in `finally`. S1 and S3 now bite (DANGER-2; 11 Credits success paths); M1, M6, M14 still bite. 41 suites / 1,282 tests green |
| 2026-10-13 | Committed, PR opened (RM) | Code commit `14ef6d46`; PR #340 open — fast-track (SA pin review passed); the user merges |
