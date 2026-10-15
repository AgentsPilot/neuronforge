# Workplan: Finance F-3, the finance page reads its response through the shared reader

**Developer:** Dev
**Requirement:** finance standardisation review of 2026-10-15, slice F-3 (brief from TL)
**Branch:** `fix/finance-f3-read-response` (from origin/main)
**Date:** 2026-10-15
**Status:** Code Complete

## Analysis Summary

One client hook, `app/admin/finance/useFinanceData.ts`, reads the finance route.

- It parses the body with `response.json()` itself, so a 401 or 403 shows the route's word or the page fallback, and a network failure shows the page fallback instead of the shared network sentence.
- It imports the server `createLogger` in a `'use client'` file (FU-5a-2, CLAUDE.md § Logging).

No route, no repository, no table and no money arithmetic is touched.

## Implementation Approach

1. Only the `fetch` sits in its own `try` (the archiving and analytics shape). A rejection there is a network failure: log it, clear the data, show `ADMIN_NETWORK_ERROR`.
2. The body goes through `readAdminResponse<FinancePayload>(response, { what: 'the finance page', sessionEndedCopy: true })`. Outcomes:
   - 401 or 403: the shared "session ended" sentence.
   - The route's own error string: shown as today.
   - Non-JSON, malformed body, or no error string: the shared fallback, "Could not read the finance page. Try again in a moment."
3. The abort guard (newest read wins) stays. Each async step checks `controller.signal.aborted` before it writes state.
4. On failure the data is cleared, as today. On success the data is set from `body.data`, as today.
5. The logger becomes `clientLogger.child({ module: 'AdminFinancePage' })`. The module name and the one `logger.error` call stay the same.
6. The hook keeps its signature `useFinanceData(queryString, fallbackError)`, so `components/FinanceView.tsx` (an F-1 file) is not edited. `fallbackError` now names only an unexpected throw in the hook's outer `catch`, a defensive path. Dropping the parameter is left until F-1 has landed.
7. The request is unchanged: the same URL template, the same query string, and the same init `{ cache: 'no-store', signal }`. A test pins this, written before the code change and run against the unchanged code.

The C-14 shared-folder registry is not edited. Finance joins it in F-2.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `app/admin/finance/useFinanceData.ts` | modify | shared reader, network sentence, client logger |
| `app/admin/finance/__tests__/useFinanceData.render.test.tsx` | create | request pin, success, 401, 403, 500, network, non-JSON, newest-read-wins, logger guard |
| `docs/workplans/FINANCE_F3_READ_RESPONSE_WORKPLAN.md` | create | this workplan |

Existing pins checked:
- `app/admin/finance/__tests__/*`: no pin on `.json(`, the logger or the page fallback. The 404 test in `financePage.render.test.tsx` expects the route's words ("Business not found"). That outcome is unchanged, so no edit is needed.
- `lib/business-os/finance/__tests__/finance.source.guard.test.ts`: no pin on `.json(`, the logger or the error copy.
- No finance test mocks `@/lib/logger`, so there is no mock to give a `clientLogger` key.

## Task List

- ✅ Step 1: write the request-pin and success tests, then run them against the unchanged hook (green)
- ✅ Step 2: write the failure-path tests (401/403, 500, network, non-JSON) and the newest-read-wins tests
- ✅ Step 3: migrate the hook to `readAdminResponse` and `ADMIN_NETWORK_ERROR`
- ✅ Step 4: switch the logger to `clientLogger.child`, and add a no-server-logger guard for the finance folder
- ✅ Step 5: run the suites, the guards, lint:hooks and a scoped tsc with a canary
- ✅ Step 6: run 3 mutations and confirm that each one fails a test

## SA Review Notes

### SA Code Review

**Code Review by SA, 2026-10-15**
**Status:** APPROVED (no fixes required)

Reviewed: the uncommitted diff of `app/admin/finance/useFinanceData.ts` and the new `app/admin/finance/__tests__/useFinanceData.render.test.tsx` on `fix/finance-f3-read-response` (base e2f0f4d5).

#### Checks

| # | Check | Result |
|---|---|---|
| 1 | Request byte-identical | ✅ Same template URL `${FINANCE_API_PATH}?${queryString}`, same init `{ cache: 'no-store', signal: controller.signal }`, one fetch per read. Pinned by the first test (URL, init keys exactly `cache` and `signal`). |
| 2 | Newest read wins | ✅ Abort check kept on all four exits: the fetch catch, after `readAdminResponse`, the outer catch, and the `finally` (loading). Four race tests cover route error, 401, network and late success. |
| 3 | Failure clears data, success unchanged | ✅ Every failure path calls `setData(null)`; success sets `result.data`, which is `body.data`, the same value the old cast passed. |
| 4 | Same use as migrated pages | ✅ Matches archiving (`what`, `sessionEndedCopy: true`, inner try around fetch only, `ADMIN_NETWORK_ERROR`) and analytics (logs the rejected fetch through `clientLogger.child`). |
| 5 | Copy per §5.10 | ✅ 401/403 now session-ended; route string verbatim (the 404 "Business not found" pin in `financePage.render.test.tsx` still passes); non-JSON, malformed and whitespace-only errors fall to "Could not read the finance page. Try again in a moment."; a rejected fetch shows the network sentence, never the browser text. The whitespace change is the shared rule 1 (trimmed), and is correct. |
| 6 | clientLogger conversion | ✅ `clientLogger.child({ module: 'AdminFinancePage' })` from `@/lib/logger/client`, same form as analytics and agentspilot-billing. Context first, `{ err }`, no query values logged. |
| 7 | Tests honest | ✅ Behaviour tests drive the real hook through `renderHook` with a stubbed fetch; only the logger is mocked. Source guards are acceptable in this file, and the planted-sample test proves the detectors bite. |
| 9 | No `console.*`, no `any` | ✅ Hook is clean. The one `(global as any)` in the test is a fetch stub with an eslint-disable and a reason, per rule 6. |
| 10 | No conflict with #418 (F-1) | ✅ #418 does not touch `useFinanceData.ts` or the new test file; it adds no file under `app/admin/finance` that imports the server logger, so the walked guard stays green after it lands. Its own copy pin (404 route words) is unaffected. |

Runs by SA: `app/admin/finance` plus `app/admin/components/layout`, 28 suites, 1004 tests, all green. A full `tsc --noEmit` reports no error in either changed file.

#### SA mutations (copy-and-restore, file hash checked before and after)

| Mutation | Result |
|---|---|
| M-1: remove the abort check after `readAdminResponse` | Killed (3 tests fail: the late route-error, late 401 and late success races) |
| M-2: the fetch catch shows `fallbackError` instead of `ADMIN_NETWORK_ERROR` | Killed (1 test fails) |

#### Rulings on the Dev's points

1. **`fallbackError` kept.** Accepted as is. Do not edit `FinanceView.tsx` now, because #418 is queued against it. Dropping the parameter (and `PAGE_LOAD_FAILED` from the call, if nothing else uses it) is a **follow-up after #418 merges**. Fold it into F-2, which touches the finance folder anyway. Not blocking: the parameter is a stable constant, so keeping it in the effect deps causes no extra fetches.
2. **One `logger.error` became two.** Accepted. The two sites are different exits, and only one fires per read. Optional only: give the fetch-reject site its own message (for example "Could not reach the finance route", as analytics does) so that logs separate a network failure from an unexpected throw. Style only, not a fix.
3. **C-14 left to F-2.** Accepted. Registering Finance in the shared-folder registry belongs with F-2's scope.

#### Optimisation suggestions (non-blocking)

- See ruling 2 on the distinct log message.

### Code Approved for QA: Yes

QA is needed, but it is light. This is a full-cycle slice, and the copy the admin sees changes on 401/403, network and malformed-body paths. Expected QA: run the finance suites and guards, and do one browser check of the finance page happy path. Optionally, take the network offline and check that the network sentence shows.

## QA Testing Report

## Commit Info
