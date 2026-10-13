# Workplan: LF-F1, "Remove this account" closed mid-delete still re-reads the list

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §14 LF4A1-F1, §1 LF-F1 row
**Branch:** `fix/admin-layout-lf-f1` (from `origin/main`, LF-1 to LF-4a.2 merged)
**Date:** 2026-10-13
**Status:** PR #347 open — fast-track (SA + QA passed)

## Overview

On /admin/users, the Businesses drawer's "Remove this account" has no in-flight lock. Escape closes the drawer while the delete request is in flight, `TestAccountCleanupPanel` unmounts, and its unmount cleanup runs while `cleanPending` is still false. The CLEAN answer that lands afterwards sets `cleanPending` on a dead panel, so `onRemoved` never fires and the list keeps the removed account until a manual Refresh. Data is not at risk.

## Analysis Summary

| Item | Finding |
|---|---|
| File | `components/business-os/purge/TestAccountCleanupPanel.tsx` (one file, SA ruling) |
| Callers checked | `app/admin/users/components/BusinessDetail.tsx` (locked mode, `onRemoved` = `refreshList`), `components/business-os/purge/PurgeDangerZone.tsx` (/test-business-os Danger Zone: no `lockedEmail`, no `onRemoved`, only `onLog`) |
| Unlocked mode today | Calls `onRemoved?.()` straight from the answer, mounted or not, so it never lost the call. No caller passes `onRemoved` there today |
| Locked mode today | Parks CLEAN in `cleanPending` until Done or unmount; loses it when unmount came first |

## Implementation Approach

Add a `mounted` ref, set true in a mount effect and false in its cleanup (StrictMode safe: the setup runs again on the re-mount). In `runDelete`, on a CLEAN answer:

- panel already unmounted: call `onRemovedRef.current?.()` directly (the unmount cleanup has already run and will never run again, so this is the only call);
- mounted and locked: park it in `cleanPending` as today (Done or unmount fires it once);
- mounted and unlocked: call it at once as today, through the ref.

Not CLEAN or refused or network error: unchanged, nothing called. No request, body, confirmation or UX change. AdminDrawer is not touched (locking the drawer close is the rejected alternative).

Once-only argument: the post-unmount branch never sets `cleanPending`, and the mounted branch never calls directly in locked mode, so each CLEAN produces exactly one call on every path.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/purge/TestAccountCleanupPanel.tsx` | modify | The fix |
| `components/business-os/purge/__tests__/TestAccountCleanupPanel.unmountMidDelete.render.test.tsx` | create | Panel-level: CLEAN, not CLEAN, refused and network error after unmount, locked and unlocked |
| `app/admin/users/__tests__/businessDrawer.closeMidDelete.render.test.tsx` | create | Drawer-level pin "close mid-delete still reads the list once", plus refused and not-CLEAN after close read nothing |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-F1 row and Change History |

The LF-4a.1 pin files are not edited.

## Task List

- ✅ Step 1: Check every caller of the panel
- ✅ Step 2: The fix
- ✅ Step 3: Panel-level tests (new file)
- ✅ Step 4: Drawer-level pin (new file)
- ✅ Step 5: Mutations, each restored by checksum
- ✅ Step 6: Test runs, lint:hooks, test:bos-entitlements, scoped tsc with canary
- ✅ Step 7: Requirement row and Change History

## Results

### New tests

| File | Tests |
|---|---|
| `app/admin/users/__tests__/businessDrawer.closeMidDelete.render.test.tsx` | F1-1 close mid-delete, CLEAN after Escape: exactly one list read, row leaves (the pin); F1-2 refused after Escape: no read, row stays; F1-3 not-CLEAN after Escape: no read, row stays; F1-4 CLEAN before Escape, no Done: exactly one read. All assert the request list is exactly `[CHECK_POST, DELETE_POST]` |
| `components/business-os/purge/__tests__/TestAccountCleanupPanel.unmountMidDelete.render.test.tsx` | For locked mode and the Danger Zone (no `lockedEmail`): CLEAN after unmount calls `onRemoved` once; not-CLEAN, refused (409) and network error after unmount call nothing (8 tests) |

The mounted paths (CLEAN then Done reads once, DANGER-2; CLEAN then unmount fires once) stay pinned by the unedited LF-4a.1 pins and `TestAccountCleanupPanel.locked.render.test.tsx`.

### Mutations (product file restored after each, sha256 verified OK)

| Id | Mutation | Bites |
|---|---|---|
| M1 | Drop the post-unmount call (park in `cleanPending`, the old behaviour) | F1-1; panel CLEAN-after-unmount, locked and Danger Zone |
| M2 | Call it twice after unmount | F1-1 (two list reads); panel CLEAN-after-unmount, both modes |
| M3 | Never clear `mounted` on unmount | F1-1; panel CLEAN-after-unmount, locked |
| M4 | Call it after unmount on a refused answer too | F1-2; panel refused-after-unmount, both modes |
| M5 | Mounted and locked: call at once as well as parking | DANGER-2 (read before Done); F1-4; two `locked.render` tests |

M3 does not bite the Danger Zone case, correctly: unlocked mode calls at once whether mounted or not.

### Runs

| Run | Result |
|---|---|
| `jest app/admin/users` | 21 suites, 518 tests, pass |
| `jest components/business-os/purge` | 6 suites, 76 tests, pass |
| `jest app/admin/components` + `app/__tests__/tailwind-css-escape.guard.test.ts` | 23 suites, 694 tests, pass |
| `npm run test:authz-guard` | 2 suites, 203 tests, pass |
| `npm run test:bos-entitlements` | 252 suites, 7334 tests, pass |
| `npm run lint:hooks`; ESLint on the three touched code files | exit 0 |
| Scoped `tsc` (scratchpad tsconfig extending the worktree's, `incremental: false`, `plugins: []`, `include: []`, the three code files) | exit 0; with the canary: exactly `zz-canary.ts(1,7) TS2322`, exit 2 |
| LF-4a.1 pin files vs `origin/main` | byte-identical |

## SA Review Notes

### SA Code Review

**Code Review by SA, 2026-10-13**
**Status:** APPROVED WITH FIXES (F1, F2). Fix, then proceed to the user diff; no second SA pass needed if the new pin bites S1 below.

#### What was checked

| Item | Result |
|---|---|
| Once-only, CLEAN then Done | Mounted and locked: parked in `cleanPending`, Done fires once and clears it, unmount cleanup then sees false. One call |
| Once-only, CLEAN then Escape | Parked, unmount cleanup fires once. One call (F1-4, and the LF-4a.1 pins) |
| Once-only, Escape then CLEAN | Cleanup already ran with `cleanPending` false; `mounted` is false, so the direct call is the only one; `cleanPending` is never set on that branch. One call (F1-1, panel tests) |
| Once-only, StrictMode re-mount | The mount effect sets `mounted` true again after the simulated unmount; the simulated unmount runs with `cleanPending` false, so it fires nothing. Verified by an SA probe under `React.StrictMode` (CLEAN then Done, CLEAN then unmount, unmount then CLEAN: one call each). **Not pinned by the Dev's tests**, see F1 |
| Not-CLEAN, refused, network error | No call on any path, mounted or not (F1-2, F1-3, panel tests) |
| Requests, bodies, confirmation | Unchanged; the diff touches only the CLEAN branch and a new ref. F1-1 to F1-4 assert the whole POST list |
| Unlocked (Danger Zone) | Mounted or not it calls at once, as before; the only change is `onRemoved` read through `onRemovedRef` (the latest prop instead of the click-time one). `PurgeDangerZone` passes no `onRemoved`, so no visible change |
| LF-4a.1 pin files | `businessDrawer.pins.boost`, `pins.credits`, `pins.dangerReads`: byte-identical to `origin/main` (`0ccaec8b`, which is also the branch base) |
| `console.*`, `any` | None in the product file or the two new test files; ESLint on all three exit 0 |
| Pattern | No new pattern; the `mounted` ref sits beside the existing `cleanPending` / `onRemovedRef` mechanism and only fills its unmount-first gap |

#### SA mutations (product file restored after each, sha256 verified OK)

| Id | Mutation | Result |
|---|---|---|
| S1 | `mounted` starts true and the mount effect no longer sets it (a StrictMode re-mount leaves it false, so a mounted CLEAN calls at once and Done then has nothing to fire) | **Survives** every Dev and pin test (`components/business-os/purge` and `businessDrawer.*`: only the SA StrictMode probe and a QA probe failed). Hence F1 |
| S2 | Delete body drops `confirmEmail` | Bites: `locked.render`, `TestAccountCleanupPanel.render`, `pins.dangerReads`, and the new `closeMidDelete` file (9 tests) |

After restore: `TestAccountCleanupPanel*` and `businessDrawer*` suites, 121 tests, pass. The temporary probe file was deleted.

#### Fixes

1. **F1 (Medium):** `TestAccountCleanupPanel.unmountMidDelete.render.test.tsx`: add a locked-mode case rendered inside `React.StrictMode`: CLEAN lands, no call before Done, Done calls once, a later unmount adds none; and one case where unmount comes before CLEAN, also one call. The App Router runs StrictMode in dev, and the comment in the product file claims StrictMode safety, so it must be pinned. Acceptance: mutation S1 above bites it.
2. **F2 (Low):** `businessDrawer.closeMidDelete.render.test.tsx` header: replace "it cannot be shared as a module" with the actual position: a fourth copy, accepted for this slice by the SA, extraction to `tests/admin/` carried to LF-4b (ruling below). Optionally drop the `raw` parameter of `requestOf` and its reconcile comment, unused here.

#### Ruling: the fourth copy of the pin harness

This is the fourth file carrying the LF-4a.1 pin harness, which hits the trigger set in the LF-4a.1 review. **A reduced copy is accepted for this slice; extraction is not required here.** Reason: extracting means rewriting the three LF-4a.1 pin files to import the shared part, and this slice's guarantee is that those money and danger pins stay byte-identical. A one-file fix slice is the wrong place to move them. The trigger is carried, not dropped: **LF-4b must, as its first step, move the shared part (stub, deferred, settle, quiet, console guard, uuid counter) into one helper under `tests/admin/` and convert all four files**, as a pure refactor, keeping the per-file route tables, and prove the pins unchanged by re-running the LF-4a.1 mutations. Record this in the requirement's §1 LF-4b row. No fifth copy is accepted before then.

#### Optimisation suggestions

- In `runDelete`, the comment "Locked: the report stays until Done..." now sits between the `if` and its `else if`. Legal, but moving it above the chain would read better. Style only, not blocking.

### Code Approved for QA: Yes (with F1 and F2)

#### Dev response (2026-10-13)

- **F1: resolved.** Two locked-mode cases inside `React.StrictMode` added to `TestAccountCleanupPanel.unmountMidDelete.render.test.tsx`: (a) CLEAN on a live panel: no call before Done, Done calls once, a later unmount adds none; (b) unmount before CLEAN: exactly one call. Under S1 (`useRef(true)`, the mount effect no longer sets it), case (a) fails and case (b) passes. Case (b) passing is expected: S1 only leaves `mounted` false, and on the unmount-first path it is false anyway, so S1 cannot change that path's outcome. The product file was restored after S1 and its sha256 matched.
- **F2: resolved.** The header now records the fourth harness copy, accepted for this slice, and says it is extracted to `tests/admin/` as the first step of LF-4b, with no fifth copy. The unused `raw` parameter of `requestOf` and its reconcile comment are gone.
- **Optimisation: applied.** The "Locked: the report stays until Done" comment now sits above the if-chain (comment only).
- **Requirement:** §1 LF-4b row records the extraction first step; a Change History row was added.
- **Runs:** `components/business-os/purge` 6 suites / 78 tests; `app/admin/users` 21 / 518; `test:authz-guard` 2 / 203; tailwind-css-escape guard 1 / 6; `lint:hooks` and ESLint on the three code files exit 0; LF-4a.1 pin files byte-identical.

## QA Testing Report

### QA Report

**QA — 2026-10-13**
**Verdict:** PASS WITH NOTES (no bugs; three Low notes; QA agrees with SA F1)
**Test mode:** full
**Strategy used:** A + B (Jest render tests of the panel, and of the whole /admin/users page with a recording fetch stub), plus throwaway QA probes. No browser check: the delete is a real destructive action and is never run in prod (per the trigger).
**Focus:** ui, regression
**Skipped:** browser check (see above)
**Input source:** prompt keywords

#### Suite runs

| Run | Result |
|---|---|
| `jest app/admin/users` | 21 suites, 518 tests, pass |
| `jest components/business-os/purge` | 6 suites, 76 tests, pass (a first run showed 7 / 79 because SA's parallel probe file was present; re-run clean after it was gone) |
| `jest app/admin/components` | 22 suites, 688 tests, pass |
| `npm run test:authz-guard` | 2 suites, 203 tests, pass |
| Tailwind guard (`app/__tests__/tailwind-css-escape.guard.test.ts`) | 1 suite, 6 tests, pass |
| `npm run test:bos-entitlements` | 252 product suites, 7334 tests, pass. The run also picked up the QA drawer probe, whose two failures were a probe-harness wait (its settle waited for the held delete); fixed and re-run green on its own. No product suite failed |
| `npm run lint:hooks` | exit 0 (a first run hit ENOENT because SA's probe file was deleted mid-run; re-run clean) |
| Flakiness: the two new test files, 3 runs | 12 of 12 pass on each of 3 runs |

#### Order and outcome probes (locked drawer, whole page)

List reads are counted from just before Delete. On this page `onRemoved` is the only caller of `refreshList` during a removal, so list reads equal `onRemoved` calls; the panel-level probes count `onRemoved` directly.

| Case | List reads | onRemoved | Delete POSTs | Result |
|---|---|---|---|---|
| CLEAN then Done | 1 (after Done, none before) | 1 | 1 | Pass |
| CLEAN then Escape, no Done | 1 | 1 | 1 | Pass |
| Escape then CLEAN | 1, row leaves | 1 | 1 | Pass (the fix) |
| Escape then not-CLEAN | 0, row stays | 0 | 1 | Pass |
| Escape then 409 | 0 | 0 | 1 | Pass |
| Escape then network error | 0, row stays | 0 | 1 | Pass |
| Double Delete click, Escape, CLEAN | 1 | 1 | 1 | Pass |
| Escape, reopen Sara, then Dana's late CLEAN | 1, Dana's row leaves | 1 (the old panel's) | 1 | Pass: Sara's drawer stays open, its panel still shows sara@example.com, no report, no Deleting, Check offered |
| Escape, reopen Dana herself, then the late CLEAN | 1 | 1 | 1 | Pass: the row leaves, so the drawer closes (existing QA B-1 rule) |

Panel-level probes (8, all pass): locked CLEAN then Done fires once and unmount adds nothing; under React StrictMode, unmount mid-delete then CLEAN fires once; under StrictMode, CLEAN while mounted parks and Done fires once; double click then unmount then CLEAN gives one POST and one call; a keyed remount for another account mid-delete calls the old `onRemoved` once and the new one never, and the new panel is untouched; unlocked and mounted with `onRemoved`, it is called once at once, as before; the two Danger Zone cases below.

The StrictMode probes are the cases SA asks Dev to pin in F1; they pass on the current code, and QA agrees they should be pinned.

#### Danger Zone (unlocked, `PurgeDangerZone`)

`PurgeDangerZone.tsx` is unchanged against `origin/main` and renders the panel with `onLog` only. Probed: mounted, a CLEAN answer logs info then success, clears the email field and shows the report; unmounted mid-delete, a CLEAN answer throws nothing and still logs. The existing `TestAccountCleanupPanel.render`, `DangerZonePanel` and `PurgeDangerZone.commitCopy.guard` suites pass.

#### Issues Found

**Bugs:** none.

**Performance issues:** none.

**Edge cases / notes (Low, nice to have):**
1. **N-1 drawer-level pins are narrower than the probes.** `businessDrawer.closeMidDelete` pins CLEAN, 409 and not-CLEAN after Escape, but not a network error after Escape, or reopening another account while the old delete is in flight. The panel-level file covers the network error. Both passed in QA probes. Adding them is optional, and would need the shared harness (SA ruling: no fifth copy), so LF-4b is the natural place.
2. **N-2 a late CLEAN gives no visible confirmation.** The list refreshes and the row leaves, but the report is never shown because the panel is gone. In scope as written (no UX change); recorded only as known behaviour.
3. **N-3 leaving the page mid-delete (code reading, not run).** A late CLEAN calls `refreshList` of an unmounted page: one harmless list GET with no visible effect. The unmount cleanup path already behaved this way before this fix.

#### Hygiene

The QA probe files (`zzLfF1Drawer.probe.test.tsx`, `zzLfF1Panel.probe.test.tsx`) are deleted. `git status` shows only Dev's five files: the panel, the requirement, the two new test files and this workplan. No stash, reset or commit.

#### Final Status
- [x] All acceptance criteria pass — ready for commit once SA F1 and F2 are done
- [ ] Issues found — Dev must address before commit

## Commit Info

| Item | Value |
|---|---|
| Branch | `fix/admin-layout-lf-f1` |
| Code commit | `a200816c` |
| `origin/main` merge | Not needed (already up to date) |
| PR | [#347](https://github.com/AgentsPilot/neuronforge/pull/347), open, fast-track; the user merges |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created and built (Dev) | One-file fix plus two new test files |
| 2026-10-13 | SA code review | APPROVED WITH FIXES F1 (StrictMode pin; SA mutation S1 survived) and F2 (harness header). S2 bit. Fourth harness copy accepted here; extraction to `tests/admin/` is LF-4b's first step |
| 2026-10-13 | QA report (QA) | PASS WITH NOTES: no bugs; 9 drawer orders and 8 panel probes pass, StrictMode included; 3 Low notes |
| 2026-10-13 | PR opened (RM) | Code commit `a200816c`, PR #347 open (fast-track). Jest subset 51 suites / 1409 tests, `test:bos-entitlements` 252 / 7334, `lint:hooks` clean |
