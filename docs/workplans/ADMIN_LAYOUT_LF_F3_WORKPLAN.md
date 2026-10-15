# Workplan: LF-F3, the Businesses page logs through the client logger (SA-F3) and pins newest-read-wins on the network branch (LF-F2-N1)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 LF-F3 row; §14 SA-F3 and LF-F2-N1
**Branch:** `fix/admin-layout-lf-f3-client-logger` (cut from `fix/admin-layout-lf4b-f1-double-give`, PR #366 open)
**PR:** [#367](https://github.com/AgentsPilot/neuronforge/pull/367)
**Date:** 2026-10-14
**Status:** PR #367 open — fast-track (SA approved, no separate QA); user merges

## Overview

Two client files on /admin/users, `page.tsx` and `useBusinessDetails.ts`, import the server `createLogger` from `@/lib/logger` (F-56 class). This slice moves both to `clientLogger` from `@/lib/logger/client`, the way the Audit trail page does, with every call's level, context object and message unchanged. In the same files' tests it adds SA N-1's missing pin: an older list read that is rejected (network error) after a newer read succeeded changes nothing.

No behaviour or request change.

## Analysis Summary

| Area | What |
|---|---|
| `app/admin/users/page.tsx` | 1 server import, 6 calls (`debug` x4, `error` x2) |
| `app/admin/users/useBusinessDetails.ts` | 1 server import, 6 calls (`error` x5, `debug` x1) |
| Test mocks | Ten test files render `UsersPage` and mock `@/lib/logger`; three are pin files. `tests/admin/drawerPinHarness.ts` has no logger mock |
| Network-branch ordering | `fetchUsers` catch: `if (isNewest()) fail(ADMIN_NETWORK_ERROR)`. T-K8 pins the 500 branch only; removing this `isNewest()` survives the suite today (SA-M2) |

## Implementation Approach

1. **Conversion.** `const logger = clientLogger.child({ module: 'AdminUsersPage' });` in both files (the hook keeps the page's module name, as today). Call sites untouched.
2. **Mocks.** `@/lib/logger/client` re-exports `clientLogger` from `lib/logger.ts`, the same module `@/lib/logger` resolves to, so each test file's existing `jest.mock('@/lib/logger', ...)` gains one key, `clientLogger: { child: () => ({ ... }) }`, mirroring its own `createLogger` object. `defaultFilter.render` routes `debug` to its `mockDebug`, so its E-3 privacy assertions keep reading the page's debug calls. No second `jest.mock` is added. `createLogger` stays: other modules on the page still import it.
3. **Pin files.** The three `businessDrawer.pins.*` files change in the logger mock only (requirement §1.3 amended first). The harness is not touched.
4. **N-1 pin.** In `businessDrawer.money.render`, a local rejectable deferred and a new `listFailNext` value `'heldNetwork'`. Two tests: T-K9 keep mode (post-Give read held, a newer Status read succeeds, then the held one rejects) and T-K10 normal mode (a Status read held, a newer Status read succeeds, then the held one rejects). Both expect rows kept, no error, no stale line.
5. **Guard.** `app/admin/users/__tests__/source.guard.test.ts` gains one case: no non-test file under `app/admin/users` imports `@/lib/logger` (the server entry); the two converted files import `@/lib/logger/client`. Modelled on the system-config G-7 and Messages G-2 logger checks.

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/users/page.tsx` | modify | client logger |
| `app/admin/users/useBusinessDetails.ts` | modify | client logger |
| 10 test files under `app/admin/users/__tests__/` | modify | `clientLogger` key in the logger mock |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | modify | also T-K9, T-K10 |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | server-logger guard |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1.3 amendment, §1 row, §14, Change History |

## Task List

- ✅ Step 1: workplan
- ✅ Step 2: §1.3 amendment (LF-F3 may change only the logger mock in the pin files)
- ✅ Step 3: convert `page.tsx` and `useBusinessDetails.ts`
- ✅ Step 4: the `clientLogger` key in the ten mocks; pin-file diff proof
- ✅ Step 5: T-K9 and T-K10; SA-M2 mutation run, file restored, checksum checked
- ✅ Step 6: source guard
- ✅ Step 7: test runs (see Results)
- ✅ Step 8: requirement §1, §14, Change History

## Results

| Check | Result |
|---|---|
| `jest app/admin/users app/admin/components` + authz, tailwind-css-escape, creditBands, creditFigures.fromConfig guards | 50 suites / 1,536 tests passed |
| `npm run test:bos-entitlements` | 259 suites / 7,619 tests passed (was 7,612: +2 T-K, +5 guard) |
| `npm run lint:hooks` | clean |
| Scoped `tsc` (the 13 changed code files plus a canary) | 1 error, the canary only |
| Pin files | `git diff --numstat`: `2 0` each (the mock key); harness no diff |
| SA-M2 (network branch `isNewest()` removed) | T-K9 fails (page stale line shown), T-K10 fails (rows emptied); T-K1 to T-K8 still pass, as SA found. File restored, sha256 matches |
| Guard mutation (server import planted in `useBusinessDetails.ts`) | "no file of the screen imports the server logger" fails naming the file; restored, sha256 matches |

## SA Review Notes

### SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** APPROVED (no fixes). No separate QA needed.

| # | Check | Finding |
|---|---|---|
| 1 | Logger conversion | `page.tsx` and `useBusinessDetails.ts` are `3 2` each: the import line, one comment line, and `const logger = clientLogger.child({ module: 'AdminUsersPage' })`. No `logger.*` call line is in the diff. Same pattern as `app/admin/audit-trail/page.tsx` (lines 18 and 61) |
| 1b | Client bundle | `lib/logger/client.ts` only re-exports `clientLogger` from `lib/logger.ts`. That is the same module both files already pulled in through `@/lib/logger`, so the client graph is unchanged: pino (browser build) plus `logger/config.ts`, which imports only pino. No new server-only code reaches the bundle. The bundle does not get smaller either, which is equally true of every existing `@/lib/logger/client` importer |
| 2 | Mock approach | Accepted. `@/lib/logger` resolves to `lib/logger.ts`, because a file wins over the directory. `../logger` from `lib/logger/client.ts` resolves to the same file, so one registry entry covers both paths. Positive evidence: `defaultFilter.render` routes `clientLogger.child().debug` to `mockDebug` and asserts that the page's E-3 debug line arrives (`hasSearch === true`). That check can only pass if the mock intercepts the client path |
| 3 | Pin files and harness | The three pin files are `2 0` each, inside the `@/lib/logger` mock only. `tests/admin/drawerPinHarness.ts` has no diff. §1.3 carries the LF-F3 permission, and the diff is consistent with it |
| 4 | New guard | Sound, and it can fail. The walk is recursive and skips `__tests__`. A coverage case stops it passing on an empty list. Planted samples cover both quote styles and a dynamic import, and pass the client entry. The Dev's planted-import mutation is recorded under Results. SA grep: no non-test file under `app/admin/users` names `@/lib/logger` |
| 5 | T-K9 / T-K10 | SA re-ran SA-M2: the network branch's `if (isNewest()) fail(...)` became `fail(...)`. Exactly T-K9 and T-K10 fail; the other 8 T-K cases pass. Restored: `page.tsx` is back to `3 2`, and the guarded line is present once |
| 6 | Behaviour and request | No request, URL, header or control-flow line changed in either product file. The LF-F2 lines (`isNewest`, keep mode, stale lines) are untouched. The new tests use a local rejectable deferred, and the harness is untouched |

**SA run:** `npx jest app/admin/users`: 24 suites / 592 tests passed. Jest printed a "worker failed to exit gracefully" warning. This slice adds no timers or handles, so the warning is not from this slice, and it is not a blocker.

### Optimisation Suggestions (non-blocking)
- The other admin screens mock `@/lib/logger/client` directly. Adding a key to the existing `@/lib/logger` mock is the smaller change here and is correct. If a later slice finds these suites no longer need the server-logger mock, switch them to the direct client mock then.

### Code Approved for QA: Yes
No separate QA needed: the suites are green, SA-M2 makes both new pins fail, and the change is a logger import with no behaviour change.

## QA Testing Report

## Commit Info

| Item | Value |
|---|---|
| Code commit | `90a4d40f` |
| Merge of `origin/main` | none needed (already contained) |
| PR | [#367](https://github.com/AgentsPilot/neuronforge/pull/367), open, contains #366 (LF-F2) |
| RM tests | targeted jest 50 / 1,536; `test:bos-entitlements` 259 / 7,619; `lint:hooks` clean; `typecheck:bos-llm` passed |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created and built (Dev) | Logger conversion, ten mock keys, T-K9 / T-K10, server-logger guard |
| 2026-10-14 | PR opened (RM) | Code commit `90a4d40f`; PR #367 open, fast-track (SA approved, no separate QA); user merges |
