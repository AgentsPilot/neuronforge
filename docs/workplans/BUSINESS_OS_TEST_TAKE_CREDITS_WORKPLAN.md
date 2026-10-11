# Workplan: Take credits from an account (test harness only), slice TC-1

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [BUSINESS_OS_TEST_TAKE_CREDITS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_TEST_TAKE_CREDITS_REQUIREMENT.md) (SA approved with C-1 to C-6; Q-1 decided: any account)
**Branch:** `feature/test-harness-take-credits` (worktree `neuronforge-take-credits`)
**Date:** 2026-10-11
**Status:** Code Complete (uncommitted, awaiting SA code review)

## Overview

One switched-off, admin-only route records a test charge of N credits on the existing ledger through `BusinessOsCreditChargeRepository.recordCharge`, plus a "Test credits" tab on `/test-business-os`. No migration, no new table, no new repository, no new read route. Short path per the user: no separate workplan review round.

## Files

| File | Action | Reason |
|---|---|---|
| `lib/business-os/credits/testCreditToolsFlag.ts` | create | `isTestCreditToolsEnabled()`, `BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED`, default off (planCheckoutFlag precedent) |
| `app/api/admin/business-os/test/take-credits/route.ts` | create | TEST ONLY route, order per requirement §3 |
| `app/api/admin/business-os/test/take-credits/__tests__/route.test.ts` | create | Route tests |
| `components/test-business-os/TestCreditsPanel.tsx` | create | The tab: reused `BusinessPicker`, position before/after via the existing GET, confirm step with company name + account id |
| `app/test-business-os/page.tsx` | modify | Register the tab |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts`, `lib/audit/ownerVisibility.ts` (comment only) | modify | `BOS_TEST_CREDITS_TAKEN` (warning, SOC2, `bos`) |
| `lib/business-os/credits/aiActivity.ts`, `aiActivityTypes.ts`, `app/admin/business-os-llm/activityTypes.ts`, `activityCopy.ts`, `components/activity/RecordStateMarker.tsx` | modify | C-1: `not_applicable` entry state for a non-AI effective service, never counted as lost |
| `lib/business-os/credits/__tests__/aiActivity.test.ts` | modify | C-1 unit test |
| `lib/repositories/BusinessOsCreditChargeRepository.ts` + its test (`ALLOWED`) | modify | C-4: widen the sole-caller guard to the route + its test; header updated |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | C-4: `KNOWN_NON_GATE_IMPORTERS` entry for the route |
| `.env.example`, `docs/feature_flags.md`, `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`, the requirement | modify | AC-7, C-5, status + Change History |

## Task List

- ✅ 1. Flag file
- ✅ 2. Audit event registration (events, audience, count pin, ownerVisibility comment)
- ✅ 3. Route: `requireAdmin` → switch 404 `not_enabled` → Zod `.strict()` → lower-case + `resolveAccountId` → platform 409 (`refuseCreditOpForPlatformAccount`) → own 403 → tenant 404 `not_a_tenant` → `recordCharge` → audit via `logAndFlush` only when `recorded: true` → 200 `{ credits, periodStart, recorded }`
- ✅ 4. Guards: charge-repo `ALLOWED`, `KNOWN_NON_GATE_IMPORTERS`
- ✅ 5. C-1 tripwire in `joinAuditEntries` + UI label + test
- ✅ 6. Harness tab
- ✅ 7. Docs

## Test Plan

| Test | Covers |
|---|---|
| Route suite | 200 happy path (exact RPC fields, one audit entry flushed), replay (`recorded: false`, no audit, "already recorded"), 401, non-admin 403, switch off 404 `not_enabled` (before the body is read), 400 (amount 0 / fraction / over ceiling / short reason / extra key / bad uuid), own account 403, platform 409, not a tenant 404 `not_a_tenant`, tenant check failure 500, write failure 500. None of the refusals writes or audits |
| `aiActivity.test.ts` | C-1: a non-AI row is `not_applicable`, not in `noEntry.lost` |
| Guards | `npm test -- lib/repositories lib/business-os/entitlements lib/business-os/credits lib/audit lib/admin`, `npm run test:bos-entitlements` |
| Type check | `npx tsc --noEmit -p .` (ts-jest does not type-check) |
| Manual (QA) | AC-1 to AC-4 on `/test-business-os` with the switch on in `.env.local` |

## SA Review Notes

### SA Code Review — 2026-10-11

**Status:** APPROVED WITH FIXES (one should-fix, no must-fix). Code approved for QA: yes, after SF-1.

**Verified:** `requireAdmin` is the first statement; the switch returns 404 `not_enabled` before the body is read; Zod `.strict()` with uuid `accountId` and `requestId`; refusals run in order: platform 409 (`refuseCreditOpForPlatformAccount`), own account 403, then tenant 500 / 404 `not_a_tenant`, all before any write. Charge fields match requirement §1: `test_harness` / `test_take_credits` / `external` / `succeeded` / $0 / `currentCreditValue().version`. The request id is used as both `action_id` and `group_id`, so the RPC is idempotent on it. The audit is written only on `recorded: true`, through `logAndFlush`, on the operator-only entity. C-1 is generic: it uses `resolveEffectiveFields(...).effectiveService !== AI_CHARGE_SERVICE`, with no raw service filter and no named action type. Page rows are charges only, so an unresolved adjustment cannot be misread as "not applicable". The guard edits are minimal and marked TEST ONLY. No `console.*` in touched files. Rules 1–6 hold. Targeted Jest: 19 suites / 412 tests green. `tsc` reports no errors in the changed files.

**Deviations ruled on:** (1) `BOS_TEST_CREDITS_` filter prefix: accepted, it is needed for grouping. (2) Entitlements imports-guard `ALLOWED` entry: accepted. The route passes the plan repository to `isBusinessOsTenant`, the same as the 11c route. (3) A replay returns `credits: null, status: 'already_recorded'`: accepted. (4) The panel probes the switch with an empty POST: accepted. It is admin-gated, answers 400 when on and writes nothing. (5) `not_applicable` is not counted in `noEntry`: accepted, this is what C-1 asked for.

**Should-fix:**
- **SF-1 (Medium), `components/test-business-os/TestCreditsPanel.tsx:175,308`.** The company name in the confirm step comes only from the loaded list, which is capped at 50 rows. A pasted id outside that page shows "(no name)", and a mistyped paste is exactly the risk that Q-1's confirm step is there to catch. When the name is unknown, say so plainly in the confirm, e.g. "Company name unknown (not in the loaded list): check the account id". Or look the name up by searching the list for the id. Do not add a new read route.

No other changes requested. The scope is proportionate to the requirement.

## QA Testing Report

**QA — 2026-10-11** · **Verdict: PASS WITH NOTES** for the automated checks. AC-1 to AC-4 still need the manual browser run below.
**Mode:** full · **Strategy:** A + B (Jest, mocked route integration) + code reading; D (manual browser) handed to the user. No live write was made: the dev environment points at production.

### Test runs (in the worktree, uncommitted code)

| Command | Result |
|---|---|
| `npm test -- app/api/admin/business-os/test lib/business-os/credits lib/repositories lib/audit lib/business-os/entitlements components/test-business-os app/admin/business-os-llm` | 191/191 suites, 4,617/4,617 tests pass |
| `npm run test:bos-entitlements` | 233/233 suites, 6,387/6,387 tests pass |
| `npm test -- lib/admin app/api/admin/business-os/test` (incl. `admin-authz-surface.guard`) | 20/20 suites, 725/725 tests pass. Route suite alone: 21/21 |
| `npx tsc --noEmit -p .` | No errors in any changed or new file. The remaining errors are already on main, in unrelated files |

### AC coverage

| AC | Covered by | Result |
|---|---|---|
| AC-1 take 50: plan left −50, extra unchanged, "Other activity" for the owner | Route test: the exact RPC fields (`test_harness` / `test_take_credits` / `external` / $0 / 50 credits). The balance effect is the RPC's job | ⚠️ Jest passes; the balance and the owner's view are **manual** |
| AC-2 over plan | No server cap. Code read: there is no balance check | ⚠️ **Manual** |
| AC-3 same request id → one charge, one audit | Route test: `recorded:false` → "already recorded", no audit entry. The panel keeps the id until a success, so a double click or a retry is safe | ⚠️ Jest passes; the real RPC replay is **manual** |
| AC-4 one `BOS_TEST_CREDITS_TAKEN`, warning, `business_os_credit_period`, admin-only | Route test (entry shape); the `eventAudience`, `filterOptions` and `ownerVisibility` (operator) suites | ⚠️ Jest passes; both audit views are **manual** |
| AC-5 refusals 401/403/404/409/403/404/400, nothing written | Route test: every case, and each asserts no charge and no audit entry | ✅ Pass |
| AC-6 route integration test (happy path + auth + invalid input) | `take-credits/__tests__/route.test.ts` | ✅ Pass |
| AC-7 docs | `BUSINESS_OS_TEST_PAGE_SCOPE.md` "Tab: Test credits"; `feature_flags.md` row and section; `.env.example` | ✅ Pass |
| SA C-1 AI Activity tripwire | New case in `aiActivity.test.ts` (`not_applicable`, not counted); `EntryMarker` handles the new state | ✅ Pass |

### Edge cases reviewed (code + tests)

- **Amount and reason.** 0, a fraction and more than 100,000 are tested (400). A negative amount is rejected by `.positive()` but has no test of its own. A short reason is tested. A reason over 500 characters is rejected by `.max()` but has no test.
- **Malformed input.** A non-uuid request id, a non-uuid account, a non-JSON body and an extra key are all tested (400).
- **Switch off** (unset, `''`, `'false'`, `'yes'`): 404 `not_enabled`. It answers before the body is read and before the tenant check.
- **Refusals.** A non-admin gets 403 before anything runs. Own account (with an upper-cased id) and the platform account are tested. Not a tenant gives 404, and a tenant check that cannot answer (null) gives 500. Both are tested.
- **RPC failure.** 500 and no audit entry. Tested.
- **Audit failure.** `logAndFlush` never rejects: it is bounded at 2 s, logs the failure and continues. The charge stands and the request still answers 200. This is not tested in the route suite; the helper's own contract covers it.
- **Panel.** It is admin-only. The business list doubles as the admin probe (403 → "Admins only"), and the switch probe fires only after admin access is confirmed. The confirm step names the amount, the company name and the full account id, and says "This cannot be undone". The intro text also says "There is no undo".

### Issues found

**Bugs:** none.

**Edge cases (nice to fix):**
1. **The confirm can show "(no name)" for a real business.** Same finding as SA SF-1. `components/test-business-os/TestCreditsPanel.tsx`. The name comes only from the loaded list, so a pasted id, or a pick that a later search filtered out, shows "(no name)". That weakens the Q-1 safeguard. Fix as SF-1 describes.
2. **Two cases are rejected by the schema but not tested:** a negative amount and a reason over 500 characters. One line each would pin them.
3. **Doc nit.** The `feature_flags.md` example says "on only while testing" but shows `=false`.

### Manual browser checks (user, with `BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED=true` in `.env.local`, then restart `npm run dev`)

1. As an admin, open `/test-business-os` → "Test credits". The form loads, with no "Not enabled" message.
2. Pick a **test** account and note "Before". Take 50 with a reason. The confirm shows the company name, the account id and "cannot be undone", then "Took 50 credits". "After" shows used +50, plan left −50 and extra credits unchanged (AC-1).
3. As that test account's owner: the card's plan credits left fell by 50. The credit history shows one "Other activity" (automatic) line, not `test_take_credits` (AC-1).
4. Take more than is left. It succeeds, "After" shows over plan, and the owner's card shows over plan (AC-2).
5. Double-click "Yes, take credits". Only one take is recorded: used rises once (AC-3).
6. In `/admin/audit-trail`, there is exactly one `BOS_TEST_CREDITS_TAKEN` per take, with severity warning and entity `business_os_credit_period`. The owner's own audit view does not show it (AC-4).
7. In the `/admin/business-os-llm` AI Activity view, the test row shows "Not an AI action", not "lost".
8. Pick your own account: "You cannot take credits from your own account" (403). Paste the platform account id: refused (409).
9. As a non-admin, the tab shows "Admins only". Remove the switch and restart: the tab shows "Not enabled on this deployment".

### Final Status
- [ ] All acceptance criteria pass — ready for commit (waiting on the manual run of AC-1 to AC-4 above)
- [x] No High bug open. SF-1 / edge case 1 should be fixed before commit, because it backs the Q-1 safeguard

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-11 | Created and implemented (Dev) | Compact workplan; implemented directly per the user's short-path instruction |

### SF-1 fix — 2026-10-11

`TestCreditsPanel.tsx` confirm step: when the account id is not in the loaded business list, the company reads "an unknown company" and a bold **Company name unknown — check the account id** line is shown. No new read route. SA SF-1 / QA main note closed.
