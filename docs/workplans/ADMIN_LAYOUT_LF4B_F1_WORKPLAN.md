# Workplan: LF-F2, a failed list re-read after a Give or Take back no longer closes the drawer (fixes LF4B-F1)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §14 LF4B-F1, §1 LF-F2 row. Background: [ADMIN_LAYOUT_LF4B_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF4B_WORKPLAN.md) R-1, SQ-7, SA C9
**Branch:** `fix/admin-layout-lf4b-f1-double-give` (from `origin/main` `799f8018`; every follow-up slice merged)
**Date:** 2026-10-14
**Status:** Code Complete — built, awaiting SA code review + QA, uncommitted. SA approved the workplan with conditions C1 to C7, all applied. Money UI, so full cycle; commit timing per user fast-track rule (TL, see C7).

## Overview

On /admin/users, after a successful Give credits or Take back, the drawer re-reads the business list once (BD-14). If that one read fails, the page's `fail()` empties the list. The open row leaves `shownUsers`, `selected` becomes null, the drawer closes, `BusinessDetail` unmounts and the Credits block's success notice (local state in `CreditsBlock`) is lost. The credits did move and are audited. But an admin who missed the notice may open Give again; every opening mints a new request id (pinned by GIVE-3), so the server accepts a second gift.

This slice makes the post-action read keep the rows when it fails: the drawer stays open, the notice stays, and one quiet line says the list could not be refreshed. Manual Refresh, Try again, and filter or search reads keep today's behaviour.

## Table of Contents

- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
- [The exact state change in page.tsx](#the-exact-state-change-in-pagetsx)
- [Files to Create / Modify](#files-to-create--modify)
- [Tests](#tests)
- [Pins and guards that change](#pins-and-guards-that-change)
- [Mutations](#mutations)
- [Logger conversion (SA-F3)](#logger-conversion-sa-f3)
- [Second guard against a double gift (design goal 4)](#second-guard-against-a-double-gift-design-goal-4)
- [Browser checks](#browser-checks)
- [Size](#size)
- [Questions for SA](#questions-for-sa)
- [Task List](#task-list)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Analysis Summary

| Item | Finding (read on this branch, 2026-10-14) |
|---|---|
| List read | `app/admin/users/page.tsx` `fetchUsers` (useCallback, no deps, reads `query.current`). Newest-read-wins via `readSeq` / `isNewest()` (SA M-5) |
| `fail()` | Lines 164 to 170: `setError(message)`, `setUsers([])`, `setStats(null)`, `setSearchInfo(null)`, `setHasLoaded(false)`. Called from the network catch (194) and on `!result.ok` (222) |
| How the drawer closes | `selected = shownUsers.find(id === openId) ?? null` (345). `AdminDrawer open={isOpen && selected !== null}` (639). The effect at 378 to 383 (QA B-1, L-1d) then clears `isOpen` and `openId`. `{selected && <BusinessDetail key={selected.id} .../>}` unmounts the body, and with it `CreditsBlock`'s `notice` |
| Callers of `fetchUsers` | Mount / status change effect (250), search debounce (260), Refresh (`onRefresh`, 409), Try again (`AdminError onRetry`, 454), and the drawer via `refreshList={fetchUsers}` (656) |
| Callers of `refreshList` inside `BusinessDetail` | Three, pinned by `source.guard` (`occurrences(detail, 'refreshList(')` is 3): `onCreditsChanged` (BD-14, line 102 to 106), `onDeleted` (AD-1 dialog, hidden by `SHOW_AD1_DELETE_ENTRY = false`), `onRemoved` (AU-1 hard delete) |
| BD-14 chain | `CreditsBlock.handleSuccess` sets the notice, reloads its own position, then calls `onCreditsChanged` once. `BusinessOsPanel` passes it through unchanged (`onCreditsChanged={onCreditsChanged}`, guarded). `BusinessDetail` maps it to `void refreshList()` |
| Credits block on a failed list read | Unaffected while mounted: it reads `/api/admin/business-os/credits/accounts/[id]` itself, so its figures are current. Only the strip's Credits left and the list row's cell come from the list row and would stay at the old figure |
| Refresh-button pins today | `businessDetail.render` D-10 ("a failed Refresh closes the drawer through its open prop, shows the error, focus on the content area") and `businessesLayout.render` U-6 ("Refresh fails (rows and tiles go); Try again succeeds") |
| Read-count pins | `businessDrawer.pins.credits` `expectReads({ ..., list: 2 })` after one success; `businessDrawer.money.render` T-B1 and T-B4 pin the exact request delta (POST, one Credits GET, one list GET) |
| Logger | `page.tsx` imports the server `createLogger` (1 import, 6 `logger.*` calls); `useBusinessDetails.ts` the same (1 import, 6 calls). No `console.*` in either. See SA-F3 below |

Nothing touches a route, the database, a request body, a header, a cache option or the server. No money file (`CreditsBlock`, `BoostBlock`, `CreditFormDialog`, `BoostCapDialog`) is edited.

---

## Implementation Approach

**One option on `fetchUsers`: `keepRowsOnFail`.** When set and the read fails (network rejection or a non-ok answer), the page keeps `users`, `stats`, `searchInfo`, `hasLoaded` and `readAt` as they are, does not set `error`, and sets a new flag `listStale = true`. Everything else in `fetchUsers` is unchanged: the same request, the same newest-read-wins rule, the same `loading` and `settledReads` handling, the same log lines.

**Only the money path uses it.** A new prop on `BusinessDetail`, `refreshListAfterCredits`, carries `fetchUsers({ keepRowsOnFail: true })`. Only `onCreditsChanged` calls it. `onDeleted` and `onRemoved` keep calling `refreshList` (`fetchUsers`, replace mode), so the danger paths behave exactly as today, and so do Refresh, Try again, the mount read, the status change and the search debounce.

Why not make every drawer-started read keep rows (alternative A, page-only)? Because after a hard delete (`onRemoved`) a kept row would leave the drawer open on an account that no longer exists, a behaviour change in the danger area that this finding does not ask for. Alternative A would touch only `page.tsx` and one guard line; this plan (B) adds one prop to `BusinessDetail` and edits the BD-14 guard. SA rules (SQ-1).

**Design goal 2, Refresh: keep today's behaviour.** A manual Refresh is the admin asking "what is the list now", and an error with empty rows is the honest answer; D-10 and U-6 pin it, and nothing about money depends on it (the admin cannot have a dialog open when pressing Refresh, because the drawer is modal). One consequence pinned explicitly: a failed Refresh after a stale line shows the error, not the stale line (`fail()` clears `listStale`).

**Design goal 3, requests.** No request changes. The post-action read is the same single `GET /api/admin/users?status=...&search=...` with the same options; there is no retry. After a successful Give or Take back exactly one list read follows, success or failure, so every `list: 2` pin stays green unedited.

**The quiet line.** While `listStale` is true:

- inside the drawer, as the first child of `AdminDrawer` (above `BusinessDetail`), rendered only when `listStale && selected`, page-rendered, `data-testid="drawer-list-stale"`, `role="status"`, slate-400 text, no colour alarm. Copy (SA C4, as built): "The business list could not be refreshed, so the credits at the top of this panel and in the list may show an older figure." It names no change, because `listStale` is page-wide and can show in another business's drawer; the Credits block's own notice says what the change was.
- on the page, inside the loaded branch above the count line, an `AdminNotice` (amber, no live role, like `business-search-failed`) with `testId="users-list-stale"`. Copy (SA C5, as built): "The business list could not be refreshed. These rows are from {formatUtc(readAt)}. Press Refresh to try again." The middle sentence is dropped if `readAt` is null.

Both are cleared by the next list read that succeeds (any caller) and by a replace-mode failure (which shows the error instead). Only the drawer line is a live region, so nothing is announced twice. Both lines are page-rendered, so no money file and no `BusinessOsPanel` edit is needed. The copy is shown to the user with the diff (SQ-3).

**C1, as built.** The `keepRowsOnFail` branch sits inside `fail()`, which both callers reach only after `isNewest()`. It skips only the state reset and sets `listStale`; it does not touch `loading` or `settledReads`, and both existing `logger.error` lines still fire. Its comment says a 401 / 403 "session ended" answer is not shown in keep mode, on purpose.

**Focus.** The read is not started from the content area (focus is in the drawer, which is portaled), so `focusWasInside` is false and the S-5 focus fallback does not run; BD-15 focus return (to Give credits, or the lot's button, or the section heading) is untouched. Pinned in T-K1.

---

## The exact state change in page.tsx

New state, beside `error`:

```typescript
/** LF-F2 (LF4B-F1): a list read after a Give or Take back failed; the rows on screen are the last good read. */
const [listStale, setListStale] = useState(false);
```

`fetchUsers` takes one optional argument; nothing else in its body moves:

```typescript
const fetchUsers = useCallback(async (options: { keepRowsOnFail?: boolean } = {}) => {
  // ... unchanged up to fail() ...

  const fail = (message: string) => {
    if (options.keepRowsOnFail) {
      // LF4B-F1: the rows stay, so the open drawer and its success notice stay.
      // The Credits block reads its own figures; only the strip and the row may lag.
      setListStale(true);
      return;
    }
    setError(message);
    setUsers([]);
    setStats(null);
    setSearchInfo(null);
    setHasLoaded(false);
    setListStale(false);
  };

  // ... unchanged; on success, beside setHasLoaded(true) and setReadAt(...):
  setListStale(false);
}, []);
```

Both failure paths already go through `fail()` and both already check `isNewest()` first, so an older keep-mode read that fails after a newer Refresh changes nothing. The existing `setError(null)` at the start of every read stays (harmless in keep mode: a drawer can only be open over loaded rows, so no error is showing).

The drawer's callback, beside `fetchUsers`:

```typescript
/** BD-14 after a Give or Take back: one read that keeps the rows if it fails (LF4B-F1). */
const refreshAfterCredits = useCallback(() => fetchUsers({ keepRowsOnFail: true }), [fetchUsers]);
```

and in the JSX: `refreshList={fetchUsers}` stays; `refreshListAfterCredits={refreshAfterCredits}` is added; the two lines described above render on `listStale`.

Callers that pass no argument (`void fetchUsers()` in the two effects, Refresh, Try again, `refreshList`) get `{}`, i.e. today's behaviour. `refreshList`'s type `() => Promise<void>` still matches.

`BusinessDetail.tsx`: add `refreshListAfterCredits: () => Promise<void>` to the props (required, documented as BD-14 plus LF4B-F1), and change only the body of `onCreditsChanged` from `void refreshList();` to `void refreshListAfterCredits();`, keeping its BD-14 comment and adding one line naming LF4B-F1.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/users/page.tsx` | modify | `listStale` state, `keepRowsOnFail` option, `refreshAfterCredits`, the two quiet lines, the new prop |
| `app/admin/users/components/BusinessDetail.tsx` | modify | New prop; `onCreditsChanged` calls it (one line) |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | modify (add tests only) | New describe T-K on its route table (a switch to fail the next list read); no existing test edited |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | BD-14 guard text and the `refreshList(` count, plus new pins for the new prop (listed below) |
| `docs/workplans/ADMIN_LAYOUT_LF4B_F1_WORKPLAN.md` | create | This file |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-F2 row, §14 LF4B-F1 action, Change History |

Not touched: `CreditsBlock.tsx`, `BusinessOsPanel.tsx`, `CreditFormDialog.tsx`, `BoostBlock.tsx`, `useBusinessDetails.ts`, `AdminDrawer.tsx`, any route, `tests/admin/drawerPinHarness.ts`, any `businessDrawer.pins.*` file.

---

## Tests

New `describe('T-K: a failed list re-read after a Give or Take back keeps the rows and the drawer (LF4B-F1)')` in `businessDrawer.money.render.test.tsx`. The route table gains `let listFailNext: 'http' | 'network' | 'held' | null` and `heldList`, reset in `beforeEach`; when set, the next list GET answers 500 with `{ success: false, error: 'Failed to fetch users' }`, rejects with `TypeError('Failed to fetch')` for `network`, or waits on a held promise the test answers (`held`, T-K8), and the switch clears. The harness already counts a rejected route as an answered request, and every test ends quiet under the console and unexpected-request guard.

| Test | Steps | Asserts |
|---|---|---|
| T-K1 Give, list read 500 | Open drawer, Give 100, set `listFailNext = 'http'`, confirm | Both stale lines absent before the confirm (C3); request delta exactly POST + one Credits GET + one list GET (same shape as T-B1); the post-Give list URL equals the mount read's URL byte for byte (C3); total list reads 2; drawer still open (`users-drawer` present, row `row-business` still 1); `credits-success` visible with the server's lines; `drawer-list-stale` with the C4 text and `role="status"`; `users-list-stale` present behind the drawer (C3); no `users-error`; focus on Give credits (BD-15 unchanged); `bos-panel`, `credits-block`, `boost-block` are the same nodes as before (nothing remounted) |
| T-K2 Take back on a lot, list read 500 | Take back on `lot(1)` | Same as T-K1 for the Take back path (request delta, list 2, drawer open, notice visible, stale line) |
| T-K3 Take back on a top-up, list read rejected | `boost-take-back` on the paid top-up, `listFailNext = 'network'` | Same, through the network-rejection branch of `fail()` |
| T-K4 honest figures | After T-K1's failure | The strip and the list cell still read the old figure (40%) while `credits-extra-figure` reads the new one (the block's own read); this is what the stale line explains |
| T-K5 the line clears | After a kept failure, close the drawer (Escape), then Refresh succeeds | Rows still on screen after the close; `users-list-stale` reads the C5 sentence with a UTC time; after Refresh, both stale lines gone, no error, rows updated (30%), list reads 3. (`readAt` is shown to the minute, so a change inside one test is not assertable; dropped) |
| T-K6 Refresh keeps today's behaviour | After a kept failure, close the drawer, Refresh fails | `users-error` shown, rows empty, `users-list-stale` not shown alongside the error, list reads 3. Passes on the unchanged code too: it pins today's Refresh |
| T-K7 a refused Give is untouched | Refused Give (409) with `listFailNext` set | No list read sent at all (list 1), `listFailNext` still set at the end: the option changes failure handling only, never whether a read is sent |
| T-K8 newest read wins (C2) | Give succeeds; its list read is held; Escape closes the drawer; a newer read succeeds; then the held read answers 500 | Rows are the newer read's (30%), `users-list-stale` and `users-error` both absent, list reads 3. **Deviation from C2's steps:** Refresh is disabled while any read is in flight (`AdminFilterBar` sets `disabled={busy}`), so the held read blocks it. The newer read an admin can actually start at that moment is a status change, so T-K8 changes Status to All (the test asserts Refresh is disabled first). Same ordering, same pin for MF10 |

Refresh-button behaviour stays pinned by the existing D-10 (`businessDetail.render`) and U-6 (`businessesLayout.render`), both unedited; T-K6 adds the stale-then-Refresh case.

Run set before hand-over: `npx jest app/admin/users tests/admin` and `npm run test:bos-entitlements` (the drawer imports from `lib/business-os/entitlements/` through the panel; nothing there changes, but the skill asks for it), plus `npx tsc --noEmit -p .` filtered to touched files and `npm run lint` on the two product files.

---

## Pins and guards that change

**Pin suite (`businessDrawer.pins.credits`, `.boost`, `.dangerReads`, `tests/admin/drawerPinHarness.ts`): none.** All `expectReads` counts (`list: 2` after a success, `list: 1` after a refusal) stay true because the number of list reads does not change. GIVE-3 (a new request id on each opening) stays as it is: this slice removes the trigger, not the id rule.

**`businessDrawer.money.render` T-A, T-F, T-B, T-R, T-C: unedited.** Only T-K is added.

**`source.guard.test.ts`: three named edits, all because of the new prop.**

| Guard | Today | After |
|---|---|---|
| BD-14 (line 142 to 146) | detail contains `onCreditsChanged={() => { void refreshList(); }}` | contains `onCreditsChanged={() => { void refreshListAfterCredits(); }}` |
| Danger-area count (line 469) | `occurrences(detail, 'refreshList(')` is 3 | is 2 (onDeleted, onRemoved), plus `occurrences(detail, 'refreshListAfterCredits(')` is 1 |
| Page mount (line 441) | `refreshList={fetchUsers}` once | unchanged, plus `refreshListAfterCredits={refreshAfterCredits}` once, and `keepRowsOnFail: true` appears exactly once in `page.tsx` (only the money path asks for it) |

The `onDeleted` and `onRemoved` regexes (lines 462, 465, 500, 504) stay byte-identical: they are what proves the danger paths still use replace mode.

---

## Mutations

Each applied alone, the named test must fail, then the file restored by checksum.

| # | Mutation | Must fail |
|---|---|---|
| MF1 | In `fail()`, drop the `keepRowsOnFail` early return | T-K1, T-K2, T-K3 (drawer closes, notice gone) |
| MF2 | Refresh passes `{ keepRowsOnFail: true }` | D-10, U-6, T-K6 |
| MF3 | `onCreditsChanged` calls `refreshList` again | T-K1 to T-K3, BD-14 guard |
| MF4 | `onRemoved` calls `refreshListAfterCredits` | `onRemoved` guard regex, the danger-area count |
| MF5 | Keep mode sets `error` as well | T-K1 (`users-error` must be absent) |
| MF6 | `setListStale(true)` removed | T-K1 (`drawer-list-stale`), T-K5 |
| MF7 | `setListStale(false)` removed from the success path | T-K5 |
| MF8 | `setListStale(false)` removed from replace-mode `fail()` | T-K6 |
| MF9 | Keep mode retries the read once on failure | T-K1 request delta and list count |
| MF10 | Keep mode skips the `isNewest()` check (older failure lands after a newer success) | T-K8 (required, C2) |
| MF11 | The money path sends no list read when the option is set | T-K1 count, T-B1 |

---

## Logger conversion (SA-F3)

Flag, per CLAUDE.md § Logging: `app/admin/users/page.tsx` imports the server `createLogger` from `@/lib/logger` into a `'use client'` file (1 import, 6 `logger.*` calls). `app/admin/users/useBusinessDetails.ts` does the same (1 import, 6 calls). Neither has `console.*`. This slice touches `page.tsx`; it does not touch `useBusinessDetails.ts`.

Proposal: convert both files to `clientLogger.child({ module: 'AdminUsersPage' })` from `@/lib/logger/client`, as `app/admin/audit-trail/page.tsx` does, keeping the module name so log queries still match.

What it costs: `@/lib/logger/client` re-exports from `lib/logger.ts`, and ten test files under `app/admin/users/__tests__/` mock `@/lib/logger` with only `createLogger`. After the conversion `clientLogger` would be undefined in all ten and the page would throw on import. So each mock gains a `clientLogger` entry, and three of those ten are the pin files `businessDrawer.pins.credits`, `.boost` and `.dangerReads`. What it buys at runtime: little. `clientLogger` is `createLogger({ service: 'client' })` from the same module and the same Pino browser build, so the output gains `service: 'client'` and nothing else changes.

Recommendation: **convert in its own follow-up slice (proposed LF-F3, UI short path, test-mock edits only plus the two imports), not in this money fix.** That keeps this diff to the fix, leaves every pin file byte-identical, and lets SA review a ten-file mock edit on its own. The user has the final say (CLAUDE.md: convert unless the user declines).

**Ruling (SA C6, TL 2026-10-14): separate slice LF-F3, started directly after this one.** Not converted here; `page.tsx` keeps its server `createLogger` import and this slice adds no new logger call. TL is confirming with the user and will say if the answer changes. The flag is recorded in the requirement (§1 LF-F3 row).

---

## Second guard against a double gift (design goal 4)

The fix above removes the cause: after a success the drawer can no longer close by itself, so the notice stays until the admin dismisses it or closes the drawer. What remains is ordinary use (an admin closes the drawer, reopens it and gives again on purpose), which no client guard can tell from a mistake.

Options, none built in this slice. **Ruling (SA SQ-6):** G-1 recorded as a Low residual of LF4B-F1 in the requirement §14; G-3 recorded there as the only guard that can tell a mistake from a deliberate second gift, for a future credit-route slice; G-2 rejected.

| # | Option | Cost | Recommendation |
|---|---|---|---|
| G-1 | The Give dialog shows "Given N credits a moment ago" when reopened within the same drawer session | Not cheap: `CreditsBlock` must keep the last success apart from `notice` (which `openDialog` clears today) and pass it to `CreditFormDialog`, two money files; GIVE-1 pins the dialog's words, so a pin edit | Option for SA; if wanted, its own slice |
| G-2 | `CreditsBlock` stops clearing the notice when Give opens | One line in a money file, but the notice sits behind the modal dialog, so it guards nothing while the dialog is open; changes pinned notice behaviour | Not recommended |
| G-3 | The server refuses a same-admin, same-account, same-amount grant within N seconds without an explicit "give again" | Server and route change, new error code, new copy | Out of scope (no server change); record as an option only |

---

## Browser checks

Read-only. Never Give or Take back in production, and localhost writes to the production database too (no branch database), so the keep-rows path itself is proven only in Jest (T-K1 to T-K7). The browser checks prove nothing else moved.

| # | Check | Pass |
|---|---|---|
| B-1 | Open /admin/users, open any business's drawer | Drawer as before; no stale line |
| B-2 | Close the drawer, press Refresh | Rows reload, "Read at" changes, no stale line |
| B-3 | DevTools, block request URL `/api/admin/users?*`, press Refresh, then unblock and press Try again | Today's behaviour: error, empty rows, drawer closed if open; Try again restores rows |
| B-4 | Console | No new errors or warnings on load, open, close, Refresh |
| B-5 | Give and Take back buttons | Present and unchanged on a non-own account; not pressed |

---

## Size

Small. About +35 / -3 lines in `page.tsx`, +6 / -1 in `BusinessDetail.tsx`, about +10 / -3 in `source.guard.test.ts`, about +200 in `businessDrawer.money.render.test.tsx`. Two product files, one test file with additions only, one guard file with three named edits. Under a day including mutations.

---

## Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| SQ-1 | B (money path only, new `refreshListAfterCredits` prop on `BusinessDetail`, BD-14 guard edited) or A (every drawer-started read keeps rows, `page.tsx` only, but a hard-deleted row then stays on screen after a failed read)? | B |
| SQ-2 | Manual Refresh: keep today's (empty rows plus error) behaviour? | Keep; D-10 and U-6 unedited, T-K6 added |
| SQ-3 | The two quiet lines: both (drawer and page) or the drawer line only? Copy as proposed, or does it need the user? | Both; copy to the user with the PR, as LF-5 did |
| SQ-4 | Logger conversion: separate slice LF-F3 (recommended), or in this slice with the ten logger mocks edited (three pin files)? | Separate slice |
| SQ-5 | Pin the ordering case (T-K8, an older failed keep-mode read after a newer good Refresh)? | Yes if cheap; it reuses `deferred` from the harness |
| SQ-6 | Second guard G-1: record as a finding for a later slice, or drop? | Record as a finding (LF4B-F1 residual, Low) |
| SQ-7 | Path: full cycle as briefed (SA workplan review, build, SA code review, QA, user sees the diff, RM). Fast-track allowed after SA and QA, as the earlier LF slices? | As TL rules. **TL ruling 2026-10-14:** full SA code review + QA cycle; commit timing per user fast-track rule (TL owns that call, as with LF-4b). Note: SA's C7 text says the fast-track does not apply to this slice; TL has taken the call, and Dev leaves everything uncommitted either way |

---

## Task List

- [x] ✅ Step 0: On `fix/admin-layout-lf4b-f1-double-give`. `origin/main` moved to `49b66feb` (#360, exposed-views slice 1b: migrations, scripts and docs only, no file under `app/admin`, `components` or `tests/admin`). **Not merged:** a merge is a commit and this slice stays uncommitted; RM merges at PR time. Baseline `npx jest app/admin/users`: 24 suites / 577 tests green. Checksums of the pin files, the harness, `CreditsBlock`, `BusinessOsPanel` and `useBusinessDetails.ts` recorded before any edit.
- [x] ✅ Step 1: T-K1 to T-K8 added first. On the unchanged code T-K1 to T-K5 fail (the drawer closes and the notice goes); T-K6, T-K7 and T-K8 pass, as they should: T-K6 pins today's Refresh, T-K7 a refusal, and T-K8 an ordering the old code already handled.
- [x] ✅ Step 2: `page.tsx`: `listStale`, `keepRowsOnFail`, `refreshAfterCredits`, the two quiet lines (C4 / C5 copy), the new prop. C1 comment included.
- [x] ✅ Step 3: `BusinessDetail.tsx`: the prop and the one-line `onCreditsChanged` change.
- [x] ✅ Step 4: `source.guard.test.ts`: the three named edits (plain-string `occurrences` for the new pins, no new regex).
- [x] ✅ Step 5: Run set green (results below).
- [x] ✅ Step 6: Mutations MF1 to MF11, each restored by checksum (results below).
- [x] Step 7: not run, per the SQ-4 ruling (LF-F3).
- [x] ✅ Step 8: Requirement §1 LF-F2 row (built), new LF-F3 row, §14 LF4B-F1 marked fixed by LF-F2 plus G-1 and G-3 rows, Change History row. Everything uncommitted.

### Build results (2026-10-14)

**Files changed:** `app/admin/users/page.tsx` (+39 / -1), `app/admin/users/components/BusinessDetail.tsx` (+9 / -2), `app/admin/users/__tests__/source.guard.test.ts` (+10 / -5), `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` (+211 / -0: the route-table switch and T-K1 to T-K8; no existing test edited).

**Byte-identical (SHA-256 checked before the edit and after the mutations):** `tests/admin/drawerPinHarness.ts`, `businessDrawer.pins.credits.render.test.tsx`, `businessDrawer.pins.boost.render.test.tsx`, `businessDrawer.pins.dangerReads.render.test.tsx`, `CreditsBlock.tsx`, `BusinessOsPanel.tsx`, `useBusinessDetails.ts`.

| Run | Result |
|---|---|
| `jest app/admin/users app/admin/components` + authz guards (`admin-authz-surface.guard`, `security-definer-surface.guard`) + `tailwind-css-escape.guard` + `creditBands.guard` + `creditBands` + `creditFigures.fromConfig.guard` | 52 suites / 1,650 tests, all pass |
| `npm run test:bos-entitlements` | 255 suites / 7,443 tests, all pass |
| `npm run lint:hooks` | clean |
| Scoped `tsc` (the four touched TS files and their imports, through a scratch tsconfig that extends the repo's) with a canary file | only the canary's TS2322 reported, so the run type-checks and the touched files are clean |
| Added lines | no `console.*`, no `any`, no backslash |

**Mutations** (each run against `businessDrawer.money.render`, `source.guard`, `businessDetail.render`, `businessesLayout.render`, `businessDrawer.pins.credits`; file restored and checksum confirmed after each):

| # | Mutation | Bites |
|---|---|---|
| MF1 | drop the keep-mode early return | T-K1, T-K2, T-K3, T-K4, T-K5 |
| MF2 | Refresh passes `keepRowsOnFail: true` | D-10, U-6, T-K6, page-mount guard (`keepRowsOnFail: true` once) |
| MF3 | `onCreditsChanged` calls `refreshList` | BD-14 guard, danger-area count guard, T-K1 to T-K5 |
| MF4 | `onRemoved` calls `refreshListAfterCredits` | danger-area count guard, AU-C2 / AU-C3 guard |
| MF5 | keep mode also sets `error` | T-K1 to T-K5 |
| MF6 | `setListStale(true)` removed | T-K1, T-K2, T-K3, T-K5 |
| MF7 | success path no longer clears `listStale` | T-K5 |
| MF8 | replace-mode `fail()` no longer clears `listStale` | **survives: an equivalent mutant.** After a replace-mode failure the rows are gone, so neither line can render (the page line sits inside `!error && hasLoaded`, the drawer line needs `selected`), and the only way back to rows is a successful read, which clears the flag. Kept as state hygiene; SA may rule it removed |
| MF9 | a second list read after the money read | 19 tests: T-B1, T-B4, T-K1 to T-K6, T-K8, the pin suite's GIVE-1 to GIVE-4 and TAKE-1 to TAKE-5 (`list: 2`), the page-mount guard |
| MF10 | keep mode ignores `isNewest()` on a failed answer | T-K8 |
| MF11 | the money path sends no list read | 19 tests: T-B1, T-B3, T-B4, T-K1 to T-K3, T-K5, T-K6, T-K8, GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, the page-mount guard |

**Deviations from the approved plan**

1. T-K8 starts the newer read with a Status change, not Refresh (C2 named Refresh). Refresh is disabled while any read is in flight, so it cannot be pressed during the held read; the test asserts that and then uses the read an admin can actually start. Same ordering, and it bites MF10.
2. T-K5 does not assert that `readAt` changed: the bar shows it to the minute, so it would be flaky inside one test. It asserts the C5 sentence with its UTC time instead.
3. T-K6 passes on the unchanged code too (it pins today's Refresh), so Step 1's "T-K1 to T-K6 fail" became "T-K1 to T-K5 fail".
4. MF8 survives as an equivalent mutant (above).
5. `origin/main` moved (#360) and was not merged, to keep the slice uncommitted; no overlap.

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-14**
**Status:** APPROVED WITH CONDITIONS (C1 to C7 below). Proceed to Step 0 once TL has the user's answer on SQ-4; nothing else waits on the user.

Verified on `fix/admin-layout-lf4b-f1-double-give` at `799f8018` (working tree: only this workplan and the requirement are changed): `fetchUsers` and `fail()` in `page.tsx` (lines 152 to 237), the `selected` / QA B-1 close chain (345, 378 to 383), the single `<AdminDrawer>` mount (639 to 659), the three `refreshList()` bodies in `BusinessDetail.tsx` (105, 259, 272), the `source.guard` lines cited (144, 441, 462 to 469, 500 to 504), `AdminDrawer` (children inside one `space-y-6` div), `AdminNotice` (amber, no live role), `lib/logger/client.ts` (re-exports `clientLogger` from `../logger`) and the ten `@/lib/logger` mocks under `app/admin/users/__tests__/`. Every Analysis Summary row matches the code.

#### Check results

| # | Check | Result |
|---|---|---|
| 1 | Version B sound and minimal (SQ-1) | ✅ **B ruled.** A would leave a hard-deleted account's drawer open after a failed read, a danger-area behaviour change the finding does not ask for. B costs one prop and one guard edit. `fetchUsers` keeps `[]` deps, so its identity, the mount effect `[filter, fetchUsers]` and `refreshAfterCredits` (`[fetchUsers]`) are all stable. `refreshList={fetchUsers}` still type-checks: an optional-argument function is assignable to `() => Promise<void>`, and all callers call it with no argument |
| 2 | Requests unchanged; one list read per success; newest-read-wins untouched | ✅ The option is read only inside `fail()`. The URL, options, `readSeq`, both `isNewest()` call sites, `loading` and `settledReads` are untouched. MF9 and MF11 pin "exactly one, never zero". See C3 for the URL equality pin |
| 3 | Pin suite and harness need no edits; three `source.guard` edits | ✅ `list: 2` / `list: 1` counts hold because the read count does not change. The three edits are justified and the minimum: BD-14 must name the new callee; `'refreshList('` is not a substring of `'refreshListAfterCredits('`, so the count honestly drops to 2 and the new count of 1 is added; the page pin gains the new prop. The `onDeleted` / `onRemoved` regexes stay byte-identical, which is the proof the danger paths stay in replace mode. The L-4b page guard (`page.slice(drawer, detail)` contains the `open` prop; the loaded-branch brace check) stays green with the drawer line placed between `<AdminDrawer` and `<BusinessDetail` |
| 4 | Drawer stays mounted, notice survives, nothing remounts (C7) | ✅ In keep mode `users` is not set, so `shownUsers` and `selected` keep their identity, `open` stays true, the B-1 effect does not fire and `BusinessDetail key={selected.id}` does not remount. T-K1's same-node assertion on `bos-panel`, `credits-block`, `boost-block` is the right pin |
| 5 | T-K tests and MF1 to MF11 | ✅ Adequate with C2 and C3. Each mutation names a test that would genuinely fail. **SQ-5: yes, T-K8 is required** (C2) |
| 6 | Refresh keeps today's behaviour (SQ-2) | ✅ **SQ-2: keep.** D-10 and U-6 unedited; T-K6 adds the stale-then-failed-Refresh case; `fail()` in replace mode clears `listStale` so the error never shows beside a stale line |
| 7 | The two quiet lines (SQ-3) | ✅ **SQ-3: both lines**, with C4 (drawer copy) and C5 (page copy). Placement approved: drawer line as the first child of `AdminDrawer`, rendered only when `listStale && selected`; page line inside the loaded branch above the count line. No money file and no `BusinessOsPanel` edit |
| 8 | Logger (SA-F3, SQ-4) | **SQ-4: separate slice LF-F3**, see C6. The user decides |
| 9 | Second guard G-1 (SQ-6) | **SQ-6: record, do not build.** Record G-1 as a Low residual finding of LF4B-F1 in the requirement §14. G-2 rejected. G-3 (server-side guard) recorded as the only guard that can tell a mistake from a deliberate second gift, for a future credit-route slice; not this one |
| 10 | Size | ✅ Small and proportionate: two product files (about +40 / -4), one guard file (three named edits), one test file (additions only). No route, schema, request, header or money file |

#### Conditions

1. **C1, keep mode is failure-only, and documented.** The `keepRowsOnFail` branch in `fail()` may only skip the state reset and set `listStale`; it must not return early before `isNewest()`, must not touch `loading` or `settledReads`, and must leave both existing `logger.error` lines firing. Its code comment must also say that a 401 / 403 "session ended" answer is swallowed in keep mode on purpose (the Give just succeeded; the next Refresh or filter read surfaces it). No new test needed for that.
2. **C2, T-K8 is required (SQ-5).** Steps: Give succeeds, the list read is held with `deferred`, the admin closes the drawer (Escape), presses Refresh, Refresh succeeds, then the held read fails. Asserts: rows are Refresh's rows, `users-list-stale` and `users-error` both absent, total list reads 3. This is the one ordering an admin can actually reach (Refresh is not reachable while the modal drawer is open, but it is the moment the drawer closes), and it is the only pin for MF10.
3. **C3, pin the request itself, not just the count.** T-K1 asserts that the post-Give list URL equals the URL of the first (mount) list read, byte for byte, and that both stale lines are absent before the confirm. T-K1 also asserts `users-list-stale` is present (behind the drawer) as well as `drawer-list-stale`.
4. **C4, drawer copy must stay true in any drawer.** `listStale` is page-wide and outlives the drawer session, so after a kept failure the admin can close and open a different business and see the same line there. The drawer line therefore must not say "this change" or "the change was saved" (the Credits block's own success notice, which now survives, already says that). Use: "The business list could not be refreshed, so the credits at the top of this panel and in the list may show an older figure." Keep `role="status"` and slate-400 text on this line only.
5. **C5, page copy.** Use: "The business list could not be refreshed. These rows are from {formatUtc(readAt)}. Press Refresh to try again." Rendered with `AdminNotice` (amber, no live role, matching `business-search-failed`), so only the drawer line is a live region and nothing is announced twice. If `readAt` is null (cannot happen in keep mode, since rows are loaded), drop the middle sentence rather than print an empty time.
6. **C6, logger (SQ-4).** SA's ruling: convert `page.tsx` and `useBusinessDetails.ts` to `clientLogger.child({ module: ... })` in its own slice, LF-F3, started directly after this one (not parked). Reason: the runtime gain is nil (`clientLogger` is the same Pino module with `service: 'client'`), while the cost here is ten mock edits including three pin files that this money fix otherwise leaves byte-identical. CLAUDE.md lets the user decide; TL puts it to the user. If the user wants it in this slice, it becomes Step 7 and the only allowed pin-file change is adding a `clientLogger` key to the existing `@/lib/logger` mock (no other line in a pin file), and the "Pins change: none" line is reworded to "pin files: logger mock key only". Either way, record the flag (file, 1 import, 6 calls each) in the requirement.
7. **C7, path and record (SQ-7).** Money UI: full cycle. SA code review, QA, then the user sees the diff before any commit. The admin-layout fast-track (RM commits after SA and QA without waiting) does **not** apply to this slice. Step 6 records each mutation with the failing test name in this workplan. Step 8 records G-1 and G-3 (per the SQ-6 ruling) in the requirement §14.

#### SQ rulings

| # | Ruling |
|---|---|
| SQ-1 | B |
| SQ-2 | Keep today's Refresh behaviour |
| SQ-3 | Both lines; copy per C4 and C5; shown to the user with the diff, not a blocking question |
| SQ-4 | Separate slice LF-F3 (SA recommendation); user decides via TL; C6 governs either answer |
| SQ-5 | Yes, T-K8 required (C2) |
| SQ-6 | Record G-1 as a Low residual; G-3 as the real guard for a future server slice; G-2 rejected |
| SQ-7 | Full cycle, no fast-track (C7) |

### Approval
[x] Workplan approved with conditions C1 to C7 — proceed to implementation (Step 7 only if the user rules SQ-4 "in this slice")

### SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** ✅ APPROVED (no required fixes). One follow-up finding (N-1) and two Low suggestions below, none blocking.

Reviewed in the worktree `neuronforge-admin-layout`, branch `fix/admin-layout-lf4b-f1-double-give`, uncommitted, base `799f8018`. Diff: `page.tsx` (+39 / -1), `BusinessDetail.tsx` (+9 / -2), `source.guard.test.ts` (+10 / -5), `businessDrawer.money.render.test.tsx` (+211 / -0), the requirement and this workplan. Nothing else changed.

**Commit timing.** C7 is superseded by the TL ruling: the user's admin-layout fast-track rule applies to this slice (as it did to LF-4b). After SA and QA pass, RM commits and opens the PR; the user reviews and merges.

#### Check results

| # | Check | Result |
|---|---|---|
| 1 | C1 | ✅ The keep branch sits first in `fail()`, sets `listStale` and returns; it skips only the five-line reset. `fail()` is reached only through `if (isNewest()) fail(...)` (network catch) and after `if (!isNewest()) return;` (non-ok answer), so newest-read-wins is respected on both paths. `setLoading(true)`, `setError(null)` and the `finally` block (`setLoading(false)`, `setSettledReads`) are unchanged. Both `logger.error({ err }, ...)` and `logger.error({ status }, ...)` still run before `fail()`. The 401 / 403 comment is present and says why |
| 2 | C2, T-K8 | ✅ Present. **Deviation 1 accepted:** Refresh is `disabled={busy}` while the held read is in flight, so C2's steps were not reachable; the Status change is the read an admin can actually start at that moment, the test asserts Refresh is disabled first, and the ordering (older keep-mode read fails after a newer read succeeded) is the same. It bites MF10 |
| 3 | C3, T-K1 | ✅ `listUrls()` equals `[mountUrl, mountUrl]`; the request delta is exactly one Credits GET, one list GET, one POST; both stale lines are asserted absent at mount and again with the dialog open, before the confirm; after it, `expectKept` asserts `drawer-list-stale` (C4 text, `role="status"`) and `users-list-stale` |
| 4 | C4 / C5 copy | ✅ Drawer line is C4 word for word, slate-400, the only element with `role="status"`. Page line uses `AdminNotice` (amber, no live role) with C5 word for word; JSX whitespace checked: with `readAt` null it renders "The business list could not be refreshed. Press Refresh to try again." with one space, and T-K5 pins the full sentence with a UTC time |
| 5 | Requests and byte-identical files | ✅ No change to URL, method, headers or `cache`. `git hash-object` on `tests/admin/drawerPinHarness.ts`, the three `businessDrawer.pins.*` files, `CreditsBlock.tsx`, `BusinessOsPanel.tsx` and `useBusinessDetails.ts` equals both `799f8018` and current `origin/main` (`f3ab6a5c`). `origin/main` has moved by #360 and #361; under `app`, `components` and `tests/admin` the only change is one `AdminSidebar.tsx` description string, no overlap |
| 6 | Danger paths | ✅ `onDeleted` and `onRemoved` still call `refreshList()` (`fetchUsers`, replace mode); their `source.guard` regexes are byte-identical; `refreshList(` count 2 and `refreshListAfterCredits(` count 1 are pinned; `keepRowsOnFail: true` appears once in `page.tsx` |
| 7 | MF8 | **Ruling: keep the line.** It is an equivalent mutant today only because the render guards (`!error && hasLoaded`, `selected`) happen to hide the flag after a replace-mode failure. Clearing it in `fail()` keeps the invariant "`listStale` means the rows on screen are a last good read" true in state, not just in render, so a future layout change cannot show a stale line beside an error. One line, documented in the state's doc comment. Recorded as an accepted equivalent mutant, not dead code |
| 8 | Standards | ✅ No `console.*`, no `any` in any added line (the two text hits are the English word in comments). All `fetchUsers` callers are arrow wrappers or the no-argument `refreshList`, so no event object can reach `options`. `fetchUsers` keeps `[]` deps; `refreshAfterCredits` is stable. No backslash in either MD. Logger: unchanged server `createLogger` import, no new call; conversion is LF-F3 (C6) |
| 9 | SA's own mutations | See below. Both reverted; `page.tsx` SHA-256 `473dca17...f21f2d` before and after each |

Baseline run by SA: `businessDrawer.money.render`, `source.guard`, `businessDetail.render`, `businessesLayout.render`: 4 suites / 182 tests pass.

#### SA mutations

| # | Mutation (`page.tsx`) | Result |
|---|---|---|
| SA-M1 | Drop `role="status"` from the drawer line | Bites: T-K1, T-K2, T-K3 |
| SA-M2 | Network catch calls `fail(ADMIN_NETWORK_ERROR)` without its `isNewest()` check | **Survives** all of `app/admin/users` (585 tests). See N-1 |

#### Findings

1. **N-1 (Low, pre-existing, follow-up, not a fix for this slice).** The network-rejection branch's newest-read-wins check (SA M-5) is not pinned anywhere: T-K8 and every older ordering test use an HTTP answer. In keep mode the worst case is a spurious stale line over fresh rows (no data lost, no drawer closed); in replace mode, which this slice does not change, an older rejected read could empty a newer good list. Pin it with a reject-capable deferred local to `businessDrawer.money.render` (the harness `deferred` has no `reject`, and the harness stays byte-identical). Suggested home: LF-F3 or the next follow-up slice; record it in the requirement §14 beside LF4B-F1.

#### Optimisation suggestions (Low, optional)

- T-K8 resets the URL with `window.history.replaceState(null, '', '/')` as its last line, so a failure earlier in the test leaves `?status=all` for the tests after it and turns one red test into several. A `try` / `finally`, or a reset in the T-K `beforeEach`, would contain it.
- T-K7 clears `listFailNext` at its end; the top-level `beforeEach` already does that, so the line is harmless but redundant.

### Code Approved for QA: Yes

## QA Testing Report

### QA Report

**QA — 2026-10-14**
**Test mode:** full
**Strategy used:** A + B (Jest render through the whole page on the shared pin harness, plus a throwaway probe file). No browser check: a Give on localhost writes to production (TL instruction), so the keep-rows path is proven in Jest only.
**Focus:** ui, money path, danger-area regression
**Skipped:** Option D (browser), by instruction. B-1 to B-5 stay owed to the user as read-only checks.
**Input source:** prompt (TL brief)
**Verdict:** PASS WITH NOTES. No bugs.

#### Run set (worktree `neuronforge-admin-layout`, branch `fix/admin-layout-lf4b-f1-double-give`, uncommitted)

| Run | Result |
|---|---|
| `jest app/admin/users app/admin/components` + `admin-authz-surface.guard` + `security-definer-surface.guard` + `tailwind-css-escape.guard` + `creditBands.guard` + `creditBands` + `creditFigures.fromConfig.guard` | 52 suites / 1,650 tests, all pass (matches Dev) |
| `npm run test:bos-entitlements` | 255 suites / 7,443 tests, all pass (matches Dev) |
| `npm run lint:hooks` | exit 0, clean |
| `businessDrawer.money.render` x3 (flakiness) | 26 / 26 each run (119.7 s, 97.8 s, 93.5 s). No flake |
| QA probe `app/admin/users/__tests__/zzLfF2.probe.test.tsx` (29 tests, deleted after the run) | 29 / 29 pass |

#### Test Coverage

| Acceptance criterion / brief item | Tested? | Result | Notes |
|---|---|---|---|
| Give, Take back on a lot, Take back on a top-up, each with a list read that fails with 500 and with a network error (6 cases) | ✅ | Pass | Each case: request delta exactly POST + 2 GET (Credits, list); list reads exactly 2, the second URL equal to the first; drawer the same node and open; one row kept; `credits-success` non-empty; `bos-panel`, `credits-block`, `boost-block` the same nodes; `drawer-list-stale` exact C4 text with `role="status"`; `users-list-stale` C5 text (head and " UTC. Press Refresh to try again." tail) with no live role; no `users-error`. Focus equal to the focus a good-read run of the same action ends on (one baseline per action), never body |
| Strip and row old, Credits block new | ✅ | Pass | Top-up + network: strip and row 40%, `credits-extra-figure` 13,950. Lot + 500: strip and row 40%, block 14,040. Dev's T-K4 covers Give |
| A following good read clears both lines and updates figures | ✅ | Pass | Close, good Refresh: row 30%, no line, no error; reopening shows strip 30% and no drawer line (3 list reads). Also a second Give in the same open drawer whose read succeeds clears both lines and moves the strip to 30% without closing the drawer. Two kept failures in a row: still one line each, drawer open, 3 reads |
| A failed Refresh still empties the list and shows the error | ✅ | Pass | Network failure on Refresh after a kept failure: `users-error`, 0 rows, no stale line beside it. Plain failed Refresh (no money action): same as today |
| A refused or failed Give sends no list read | ✅ | Pass | 409, 400, 500 and a network rejection of the POST: `credit-form-error` shown, list reads stay 1, the failure switch is never consumed, no stale line |
| Remove this account and the hidden Delete still use `refreshList` | ✅ | Pass | `TestAccountCleanupPanel` stubbed to call `onRemoved`: a 500 on that read shows `users-error`, empties the rows and closes the drawer, no stale line. Same after an earlier kept failure (network on the remove read): replace mode wins, no stale line leaks. Hidden Delete: `SHOW_AD1_DELETE_ENTRY = false` and its `onDeleted` body calls `refreshList()`, not the keep-rows read (source check; it cannot be rendered) |
| 401 / 403 on the post-credit read is hidden until the next read | ✅ | Pass, recorded | Both: stale lines show, no `users-error`, no "session" text on the page. The next Refresh with the same 401 / 403 shows "Your admin session has ended. Sign in again." and drops the stale line. By design (C1); see QA-N1 |
| Stale line in another business's drawer | ✅ | Pass, recorded | Two rows (Dana, Omer). Give on Dana, read fails, close, open Omer: the line reads "The business list could not be refreshed, so the credits at the top of this panel and in the list may show an older figure." Omer's drawer has no success notice, its strip reads 70%. True in that drawer because of "may"; see QA-N2 |
| Ordering: an older failed read lands after a newer good one | ✅ | Pass | Held post-Give read; drawer closed; a search ("dana") starts a newer read that succeeds (30%); then the held read answers 500, and in a second run is rejected (network branch). Rows stay 30%, no stale line, no error, 3 reads, Refresh enabled. Complements Dev's T-K8 (Status change, 500 only). Also: while the held read is pending the drawer stays open, and a late 500 still keeps the rows, the notice and the line |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. Request count and shape unchanged (exactly one list read per successful money action, none after a refusal or failure).

**Notes (no action required unless TL / SA want it)**

1. **QA-N1, Low, by design (C1): a 401 / 403 on the post-credit read is not shown.** The admin keeps a drawer and a stale line while their session has in fact ended. Measured: the next Refresh shows "Your admin session has ended. Sign in again." Any further money action hits its own route and is refused there. Accepted as built; recorded so it is not rediscovered as a bug.
2. **QA-N2, Edge: the drawer line is page-wide.** In another business's drawer it still says the figures "may show an older figure", even though that business was not touched. The wording stays true because of "may" and names no change, so it is acceptable; a reader may briefly wonder why it shows there. Cleared by any good read.
3. **QA-N3, on SA's N-1 (network-branch ordering unpinned).** QA's probe P9 exercised exactly that case in keep mode (held read rejected after a newer good read): it behaves correctly today. The probe was deleted as instructed, so it is still not a pin; SA's follow-up stands.
4. **QA-N4, MF8.** Agree with Dev and SA: equivalent mutant today. Probe P6b confirms no stale line leaks after a replace-mode failure that follows a kept failure.

#### Repository state after QA

`git status`: only the Dev's files are changed (`businessDrawer.money.render.test.tsx`, `source.guard.test.ts`, `BusinessDetail.tsx`, `page.tsx`, the requirement) plus this untracked workplan. The probe file is deleted; no `zz*` file remains. No stash, reset or commit.

#### Final Status

- [x] All acceptance criteria pass in Jest — ready for commit (browser checks B-1 to B-5 are read-only and owed to the user; never Give or Take back on localhost)
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Workplan written (Dev) | Fix for LF4B-F1: a `keepRowsOnFail` option on `fetchUsers`, used only by the post-Give / post-Take-back read through a new `BusinessDetail` prop; Refresh unchanged; two quiet "list could not be refreshed" lines; T-K1 to T-K7; pins unchanged, three named `source.guard` edits; logger conversion proposed as its own slice; second guard options G-1 to G-3 for SA. Awaiting SA |
| 2026-10-14 | Built (Dev) | SA approved with C1 to C7, applied: C4 / C5 copy as given, T-K8 added (via a Status change, because Refresh is disabled while a read is in flight), C3 assertions in T-K1, logger left for LF-F3 (C6), commit timing per user fast-track rule (TL, C7). 52 suites / 1,650 tests; `test:bos-entitlements` 255 / 7,443; `lint:hooks` clean; scoped tsc clean with the canary reported. MF1 to MF11: ten bite, MF8 is an equivalent mutant. Pin files, harness and money files byte-identical. Uncommitted |
| 2026-10-14 | SA workplan review | APPROVED WITH CONDITIONS C1 to C7: version B; Refresh unchanged; T-K8 required; URL equality pin in T-K1; drawer copy made true in any drawer; page copy; logger as its own slice LF-F3 (user decides); G-1 recorded as Low residual; full cycle, no fast-track |
| 2026-10-14 | SA code review | APPROVED, no required fixes. C1 to C5 verified; deviation 1 (T-K8 via Status change) accepted; MF8 line kept as state hygiene; protected files byte-identical to `origin/main`; fast-track commit timing per TL ruling. SA-M1 bites, SA-M2 survives: N-1 follow-up (network-branch ordering unpinned, pre-existing). Two Low test suggestions |
| 2026-10-14 | QA (full, Jest only) | PASS WITH NOTES, no bugs. 52 suites / 1,650 tests; `test:bos-entitlements` 255 / 7,443; `lint:hooks` clean; `businessDrawer.money.render` 26 / 26 three times. Probe (29 tests, deleted): 3 actions x (500, network) keep rows, drawer, notice, focus and both lines with exact copy, 2 list reads; refused / failed Give sends no read; Remove still empties on failure; 401 / 403 hidden by design (QA-N1); line in another drawer reads true (QA-N2); older failed read (500 and network) after a newer good one changes nothing |
