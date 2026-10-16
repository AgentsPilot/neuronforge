# Workplan: Recent-grant warning on the Give credits confirm step

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Branch:** `feature/credits-recent-grant-warning`
**Requirement:** user approval, 2026-10-15 (the simple fix for an accidental double credit grant; the follow-up LF4B-F1 "double-give")
**Date:** 2026-10-15
**Status:** Code Complete

## Overview

An admin can give the same business credits twice by accident: two openings of the Give credits dialog mint two request ids, so the server records both. The approved fix is UI-only: on the confirm step of a Give, when the account already has an admin grant created in the last 15 minutes, show one amber line naming it. The line never blocks; Confirm works exactly as today.

## Analysis Summary

- `app/admin/users/components/CreditsBlock.tsx` already reads every lot (`CreditLotView`: `source`, `credits`, `createdAt`, `actorAdminId`) for the account.
- `app/admin/users/components/CreditFormDialog.tsx` owns the two steps (form, then confirm).
- No server change, no new request, no DB access.
- The current admin's id is not known on this screen (the block only gets `isOwnAccount` from the server). Per the brief, the "(by ...)" part is dropped rather than adding a request.

## Implementation Approach

| Decision | Choice | Why |
|---|---|---|
| Where the logic lives | Two pure functions in `app/admin/users/creditCopy.ts`: `mostRecentAdminGrant(lots, nowMs)` and `recentGrantWarning(lot, nowMs)` | Copy module, no JSX, unit-testable; already covered by the screen's source guards |
| Source of lots | `CreditsBlock` passes the lots from its last good read to the dialog as a new optional prop `lots` | No request added |
| Window | 15 minutes (`RECENT_GRANT_WINDOW_MS`) | The brief |
| Which lots count | `source === 'admin_grant'` only; any amount; a top-up purchase never counts | The brief |
| Several recent grants | The newest by `createdAt` is named | The brief |
| Clock skew | A `createdAt` up to 15 minutes in the future (admin clock behind the server) counts and reads "just now" | A grant the admin just made must not be missed because of a slow clock |
| Time words | Computed at render: "just now" under 1 minute, "1 minute ago", "N minutes ago" | The brief |
| Look | `AdminNotice` (amber, icon, no role) | The admin layout standard's caveat style |
| Where shown | Confirm step, Give only | The brief |

Warning text (example): `This business was already given 500 credits 3 minutes ago. Confirm only if you mean to give more.`

The grant request, its body, the request id, the confirmation flow and the in-flight rules are untouched.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `app/admin/users/creditCopy.ts` | modify | Window constant, `mostRecentAdminGrant`, `recentGrantWarning` |
| `app/admin/users/components/CreditFormDialog.tsx` | modify | Optional `lots` prop; the amber line on the Give confirm step |
| `app/admin/users/components/CreditsBlock.tsx` | modify | Pass the loaded lots to the dialog |
| `app/admin/users/__tests__/creditsBlock.recentGrant.render.test.tsx` | create | The six cases in the brief, plus time-word units |

## Task List

- ✅ Step 1: Rename the branch to `feature/credits-recent-grant-warning`
- ✅ Step 2: Helpers in `creditCopy.ts`
- ✅ Step 3: Dialog prop and the amber line
- ✅ Step 4: Block passes the lots
- ✅ Step 5: Tests (shown at 3 min, not at 16 min, not on Take back, not for a top-up only, newest named, request unchanged)
- ✅ Step 6: Mutations (window 15 to 150, warn on Take back, source filter dropped)
- ✅ Step 7: Guards, pins (unedited), lint:hooks, test:bos-entitlements, scoped tsc

## Dev Results

| Check | Result |
|---|---|
| New test file | 9 / 9 pass |
| jest app/admin/users + app/admin/components | 49 suites, 1336 tests pass |
| Pin suite (`businessDrawer.pins.*`, `tests/admin/drawerPinHarness.ts`) | Pass, unedited (`git diff` empty) |
| Mutation: window 15 to 150 minutes | Caught (4 fail) |
| Mutation: warn on Take back | Caught (1 fail) |
| Mutation: source filter dropped | Caught (1 fail) |
| Mutation: oldest named instead of newest | Caught (1 fail) |
| Authz, Tailwind, creditBands, creditFigures.fromConfig guards | 6 suites, 373 tests pass |
| test:bos-entitlements | 275 suites, 8215 tests pass |
| lint:hooks | Clean |
| Scoped tsc | Clean; a planted canary error was reported |

## SA Review Notes

### SA Code Review

**Code Review by SA, 2026-10-15**
**Status:** ✅ Code Approved

1. Grant path unchanged. The CreditFormDialog diff touches only the import, a new optional `lots` prop (default `[]`), two render-time consts and one `AdminNotice` line. The submit handler, body, `requestId`, confirm flow and in-flight rules are untouched. The new test also pins the POST as byte-identical with and without the warning.
2. Pins and harness unedited. Only `creditCopy.ts`, `CreditFormDialog.tsx` and `CreditsBlock.tsx` are modified, plus the one new test file.
3. Helpers are correct: the window is exclusive at 15 min, the newest is chosen by `createdAt` (not list order), a future time inside the window counts and reads "just now", a NaN date is skipped, and boost lots are excluded.
4. No new request. The test asserts that only the block's own GET happens before the POST.
5. `CreditsBlock` passes `[]` unless `extra.status === 'ok'`.
6. `creditCopy.ts` is clean: it is append-only plus the one type import, and its LF endings match HEAD. The git CRLF warning is just autocrlf, and no lines were mangled.
7. No `console.*` and no `any` in source. The test's `as any` on `global.fetch` has an eslint-disable comment with a reason.
8. The copy is plain and accurate. It names no admin and it does not block.

Verification: the `app/admin/users` Jest run gave 26 suites and 615 tests, all passing. tsc showed no errors under `app/admin/users`.

Optimisation suggestion (Low, non-blocking): "give them again" reads slightly oddly when the new amount differs from the earlier grant. Consider "give more" instead, if the user prefers it.

### Code Approved for QA: Yes

## QA Testing Report

## Commit Info

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-15 | Created | Workplan and build |
