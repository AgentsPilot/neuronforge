# Workplan: Admin Layout LF-2 (Plans & entitlements boxes)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §2, §7.2 (AC-2.1 to AC-2.4), §9 Q-2, §13 (SA-C1, V-2, V-3, V-8)
**Branch:** `feature/admin-layout-lf2` (cut from `feature/admin-layout-lf1`, PR #338 open)
**Path:** UI short path plus `npm run test:bos-entitlements`
**Date:** 2026-10-13
**Status:** PR #339 open — fast-track (SA + QA passed); user merges

## Overview

The user answered Q-2 (a): remove "Look up an account" from Plans & entitlements and shrink "Changing any of this" to one footnote line. The Businesses drawer already shows the same snapshot, so the lookup is a second, weaker way to the same view.

## Analysis Summary

Read of the worktree on 2026-10-13.

| Check | Result |
|---|---|
| The drawer shows the same snapshot | Yes. `app/admin/users/components/BusinessOsPanel.tsx` reads the same route (`/api/admin/business-os/entitlements/accounts/{id}`), renders the same `EntitlementSnapshot`, and words a failure through the same `ENTITLEMENT_ERROR_COPY` (fallback "The plan could not be read."). A non-Business OS account shows the panel's one-line note instead |
| Who imports `AccountLookup` | `page.tsx`, `accountLookup.render.test.tsx`, `accountLookup.contract.test.tsx`; `layoutFolder.guard.test.ts` lists the file path. No product code elsewhere |
| Entitlements imports | `AccountLookup.tsx` imports nothing from `lib/business-os/entitlements`; none is added. The contract test (a test, exempt from registration) keeps its three existing imports |
| Tiers `source.guard` | Walked list goes from 8 files to 7, still at or above its floor of 6; it is not edited |

## Implementation Approach

1. **Pointer line** at the end of the plans content, after the not-built panel: the SA-C1 sentence with a `next/link` to `/admin/users` on the word "Businesses". It names name, business name and account id, never email (V-3).
2. **Footnote** in place of the "Changing any of this" box: "This page only reads. Per-account changes are audited API operations, not buttons:" followed by the existing `writeOpsNotOnThisPage` id chips. No file path, no doc text (V-8). Rendered as a plain `div` (a `ul` cannot sit inside a `p`) with the chips inline, no card shell and no heading.
3. **Delete** `components/AccountLookup.tsx` (`git rm`).
4. **Tests**, per §2.2's list plus two forced edits found in the analysis (deviations, below).

### Deviations from §2.2's test-edit list

| Item | Why |
|---|---|
| `accountLookup.contract.test.tsx` is edited, not left untouched | It renders `<AccountLookup />`, so it cannot survive the deletion as is. Kept under the same name with the same assertions: the recorded-body cases render `EntitlementSnapshot` directly with the recording's `data` (what the drawer passes); the refusal cases assert every route code has a sentence in `ENTITLEMENT_ERROR_COPY` that does not contain the code. This is stricter than before: the old path would have accepted the generic fallback |
| `layoutFolder.guard.test.ts` loses one path | Its Plans & entitlements entry lists `AccountLookup.tsx`; the file no longer exists. The entry comment drops "the account lookup" |

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-tiers/page.tsx` | modify | Pointer line, footnote, drop the lookup import |
| `app/admin/business-os-tiers/components/AccountLookup.tsx` | delete | AC-2.1 |
| `app/admin/business-os-tiers/components/EntitlementSnapshot.tsx` | modify (comment only) | Its comments name the lookup as a user; now the drawer is the only one |
| `app/admin/business-os-tiers/__tests__/page.render.test.tsx` | modify | Lookup case replaced by the Businesses-line case; S-2 pending-lookup case removed; "Changing any of this" assertion becomes the footnote words |
| `app/admin/business-os-tiers/__tests__/accountLookup.render.test.tsx` | delete | Its component is gone |
| `app/admin/business-os-tiers/__tests__/accountLookup.contract.test.tsx` | modify | See deviations |
| `app/admin/business-os-tiers/__tests__/payload.contract.test.tsx` | modify (comment only) | Names `AccountLookup` as the accounts-route consumer |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | See deviations |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-2 row, Change History |

## Task List

- ✅ Step 1: Confirm the drawer renders the same snapshot and nothing else imports the lookup
- ✅ Step 2: Page: pointer line, footnote, remove the lookup
- ✅ Step 3: Delete `AccountLookup.tsx` and `accountLookup.render.test.tsx`
- ✅ Step 4: Test edits (`page.render`, `accountLookup.contract`, `layoutFolder.guard`) and stale comments
- ✅ Step 5: Jest set, `test:bos-entitlements`, `lint:hooks`, scoped tsc with a canary
- ✅ Step 6: Requirement §1 row and Change History
- ⬜ Step 7 (owed, AC-2.4): browser check that a Businesses search by full account id finds an account outside the first 100 rows; record the result here

## F-39

Not closed here. §2.2 says F-39 closes when LF-2 merges; the closing edit to the standard's §9 belongs with the merge.

## Implementation Notes

| Run | Result |
|---|---|
| Jest: `app/admin/business-os-tiers`, `app/admin/components`, `lib/admin/__tests__/admin-authz-surface.guard`, `app/__tests__/tailwind-css-escape.guard` | 29 suites, 913 tests, all pass |
| `npm run test:bos-entitlements` | 245 suites, 7,239 tests, all pass |
| `npm run lint:hooks` | Clean |
| ESLint on the tiers folder and `layoutFolder.guard` | Clean |
| Scoped `tsc` (tiers folder, `layoutFolder.guard`, `BusinessOsPanel.tsx`, plus a canary) | Only the canary error |
| `git diff --numstat` | Deletions-only rows are exactly `AccountLookup.tsx` (157) and `accountLookup.render.test.tsx` (135); every other row has insertions |

Page order inside the content: banner, no-gate summary, plans, not-built panel, the footnote (`write-ops-footnote`), the pointer line (`businesses-pointer`, last). Tiers `source.guard` unedited and green with 7 walked files.

Not edited, flagged for SA: `app/admin/users/components/BusinessOsPanel.tsx` comments still say the Plans page renders `EntitlementSnapshot` "open, unchanged". Left for LF-4a.2, which owns that file.

## SA Review Notes

### SA Code Review — 2026-10-13

**Status:** 🔄 Fix Required (two small fixes, both in scope; no design change). After C-1 and C-2 the slice is approved for QA re-run and PR without a second SA pass; TL confirms the two items in the diff.

**Verified**

| # | Check | Result |
|---|---|---|
| 1 | Page follows Q-2 (a), SA-C1, V-8 | ✅ Lookup gone; pointer line is the last child of `plans-content`, words exactly "…Search Businesses by name, business name or account id.", no email, `next/link` to `/admin/users`; no doc text added, the page comment names `BUSINESS_OS_ENTITLEMENTS.md` |
| 2 | Footnote names the write operations | ✅ `write-ops-footnote` keeps the `writeOpsNotOnThisPage` chips from the payload, so the operations stay named |
| 3 | No importer of the deleted component | ✅ Only comment and doc mentions remain; no product code, guard list or registry names `AccountLookup.tsx` or `accountLookup.render` |
| 4 | Deviation 1 (`accountLookup.contract`) | ✅ Equivalent for the recorded-body half: the drawer passes `body.data` to the same `EntitlementSnapshot` (`BusinessOsPanel.tsx:219`), so rendering it directly pins the same seam. Stricter for the refusal half: the drawer words a failure as `ENTITLEMENT_ERROR_COPY[code] ?? fallback` (`:226`), and the old lookup path would have passed on the fallback; a missing key now fails. Accepted |
| 5 | `layoutFolder.guard` edit | ✅ One path removed, comment updated; nothing else in the guard changed |
| 6 | Entitlements rules | ✅ No new entitlements import (the contract test keeps its existing three, test-exempt); tiers `source.guard` unedited and walks 7 files, floor 6; no route, payload or logic change |
| 7 | F-39 and `BusinessOsPanel` comments | ✅ Both acceptable: F-39 closes with the merge per §2.2; the panel's stale comments belong to LF-4a.2, which owns the file |
| 8 | Hygiene | ✅ No `console.*`, no `any`, no backslash in added lines or this workplan |

**Code Review Comments**

1. **C-1** `accountLookup.render.test.tsx` (deleted) took with it T-12, which pinned `EntitlementSnapshot` itself, not the lookup: the table is named "Capabilities in force", its headers are `Capability`/`Value`/`Decided by` with `scope="col"` and `ADMIN_TH`, and a set end date prints as `2026-12-31 23:30 UTC` with a missing one as "no end date". The component survives and the drawer renders it; nothing else pins those (checked `businessOsPanel.render`). Port the two T-12 cases into `accountLookup.contract.test.tsx`, rendering `EntitlementSnapshot` with the recording's `data`, same assertions. — Priority: Medium
2. **C-2** `lib/admin/health/evaluateHealth.ts:726`: the Health page link reads "Open Plans & entitlements (plans and account lookup)". After LF-2 that page has no account lookup, so the link promises a feature that is gone. Change it to "Open Plans & entitlements" (or "(plans)"), and update the deliberate pins with it: `lib/admin/health/__tests__/evaluateHealth.test.ts:610`, `lib/admin/health/__tests__/qa-slice5.test.ts:176`, `app/admin/__tests__/health.render.test.tsx:108` and `:183`, `app/admin/__tests__/health.qa-slice5.render.test.tsx:111`, `app/api/admin/health-summary/__tests__/route.test.ts:184`, and the example in `lib/admin/health/healthTypes.ts:87`. Name the edit in the PR. — Priority: Medium
3. `app/admin/business-os-tiers/types.ts:62` comment says "What the account lookup shows"; make it the snapshot (comment only, screen folder). — Priority: Low

**Optimisation Suggestions**

- Implementation Approach step 2 says the footnote is "a plain `<p>`"; the code is a `div` (correct, since a `ul` cannot sit inside a `p`). Align the workplan text.
- `lib/business-os/entitlements/capabilityDisplay.ts:7` also mentions "the account lookup" in a comment. Leave it: editing the entitlements module for a comment is out of proportion for this slice; whoever next touches that file can update it.

**Code Approved for QA:** Yes, conditional on C-1 and C-2 (C-3 is a comment). Re-run the tiers folder, `app/admin/__tests__/health*`, `lib/admin/health`, the health-summary route test and `npm run test:bos-entitlements` after the fixes.

## QA Testing Report

[QA will populate this section]

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf2` (cut from `feature/admin-layout-lf1`) |
| Code commit | `e53e30a3` |
| PR | [#339](https://github.com/AgentsPilot/neuronforge/pull/339), base `main`; contains #338 (LF-1) while that is open |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Workplan written and built | Dev: LF-2 per §2.2; two forced test edits recorded as deviations |
| 2026-10-13 | SA Fix Required applied (Dev) | C-1: the two T-12 cases ported into `accountLookup.contract.test.tsx`, rendering `EntitlementSnapshot` with the recording's data, same assertions. C-2: Health link text "Open Plans & entitlements (plans and account lookup)" to "Open Plans & entitlements" in `lib/admin/health/evaluateHealth.ts` and its pins (`evaluateHealth.test.ts`, `qa-slice5.test.ts`, `health.render.test.tsx` x2, `health.qa-slice5.render.test.tsx`, `health-summary/__tests__/route.test.ts`) and the `healthTypes.ts` example; no other code occurrence (older requirement and workplan docs keep it as history). C-3: `types.ts` comment now describes the snapshot. Step 2 says `div`. `capabilityDisplay.ts` left alone per SA |
| 2026-10-13 | PR opened (RM) | Code commit `e53e30a3`, PR #339 open (fast-track, SA + QA passed). Scoped Jest 49 suites / 1521 tests, `test:bos-entitlements` 245 / 7239, `lint:hooks` clean, `typecheck:bos-llm` passed |

## QA Report (TL, browser) — 2026-10-13

**Verdict: PASS.** Local dev server on this branch, signed-in admin, read-only.

| Check | Result |
|---|---|
| "Look up an account" box gone; no input on the page | ✅ 0 inputs |
| "Changing any of this" heading gone; one footnote line names the operations | ✅ "This page only reads. Per-account changes are audited API operations, not buttons:" + chips |
| Pointer line wording (SA-C1), no email | ✅ "…Search Businesses by name, business name or account id." Only other "email" words on the page are capability names |
| Businesses link | ✅ href /admin/users |
| AC-2.4 full-id search on Businesses | ✅ GET /api/admin/users?status=all&search=<full id> returned exactly that account. Production has 12 accounts in total, so "beyond the first 100 rows" cannot occur today; the server exact-id path (SA V-2) was exercised directly |

Note for SA-F1: production has 12 accounts (all statuses), well under the 50-user default page, so the unpaged listUsers() call loses nobody today.
