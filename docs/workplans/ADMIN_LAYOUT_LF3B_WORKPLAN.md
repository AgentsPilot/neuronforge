# Workplan: Admin Layout LF-3b (Messages: admin dialogs instead of `confirm()`)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §3.2 (OR-3, OR-6), §3.3 (Messages rows, LF-3b rules), §3.4, AC-3.3, §8 LF-3b, §13 SA-C11
**Branch:** `feature/admin-layout-lf3b` (from `origin/main` at `8014ee73`), worktree `neuronforge-admin-layout-2`
**Path:** UI short path
**Date:** 2026-10-13
**Status:** PR #348 open — fast-track (SA approved, QA PASS WITH NOTES)

## Overview

Messages still asks two questions with the browser's `confirm()`: Delete (a row) and Mark All Read (the header). OR-3 says a confirmation is an admin dialog (`ui/dialog` with `ADMIN_DIALOG_CLASS`) opened from a named button, with focus back on that button. This slice swaps the confirmation surface only. The words, the requests and the D-19 failure lines do not change.

## Analysis Summary

| Item | Today |
|---|---|
| Delete | `page.tsx` `deleteMessage`: `confirm('Are you sure you want to delete this message?')`, then one `DELETE /api/admin/messages/{id}`; failure sets `deleteFailedId` (row line "Could not delete the message. Try again.") |
| Mark All Read | `page.tsx` `markAllRead`: `confirm('Mark all messages as read?')`, then one status PATCH per unread row (`Promise.all`), the header line on any failure, then one re-read |
| Delete opener | `MessagesTable` row button "Delete message from {name}"; `onDelete(message)` gives the page no button |
| Mark All Read opener | Header button, rendered only while a loaded message is unread, so it can unmount in the middle of the fan-out |
| Shared pieces | `@/app/admin/components/layout/adminDialog` (classes) and `@/components/ui/dialog` (Radix). No shared file is added or edited |
| Guards | `source.guard` G-2 refuses `@/components/ui/dialog` everywhere in the screen; G-1 pins the exact file list. Neither names `confirm`, but both must change for a dialog file to exist. The tests that stub `window.confirm` are in `messages.baseline.render` (B-10, B-11, setup) and `messages.layout.render` (setup, T-12 "confirm false", and every test that clicks Delete or Mark All Read) |

## Implementation Approach

1. **New screen-local component** `app/admin/messages/components/MessagesConfirmDialog.tsx` (not in the shared folder). A controlled `Dialog` with `ADMIN_DIALOG_CLASS`, the title constants, a Cancel button (`ADMIN_BUTTON`) and the action button. It owns the in-flight state:
   - initial focus: `onOpenAutoFocus` prevented, Cancel focused (SA-C11). Enter on open therefore activates Cancel.
   - one send: a ref set synchronously on the first click (a double click's second event returns at once), plus `disabled` and `aria-busy` while in flight.
   - no close in flight: `onOpenChange(false)`, Escape and an outside click are ignored while busy; Cancel is disabled.
   - focus return: `onCloseAutoFocus` prevented and the page's callback runs. The page focuses the opener when it is still connected, otherwise the content area (`messages-content`, `tabIndex={-1}`, the D-6 fallback the drawer already uses). Never body.
   - after the action settles (success or failure) the dialog closes. The page's handlers never throw (each `fetch` is in a `try`), so the close always runs.
2. **Page** keeps both dialogs mounted at page level, outside the header and the table, so the Mark All Read dialog survives its opener unmounting. `deleteMessage` and `markAllRead` lose only their `confirm(...)` line and become the dialogs' `onConfirm`. Their request code is unchanged. New state: the message awaiting Delete, whether Mark All Read is asked, and one opener ref.
3. **Table**: `onDelete(message, button)`, passing `event.currentTarget` (the same way `onOpen` passes its button).
4. Words: titles are exactly the old `confirm` strings; buttons are "Cancel" and "Delete" / "Mark All Read". No description, so `aria-describedby={undefined}` (the `AdminDrawer` precedent).

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/messages/components/MessagesConfirmDialog.tsx` | create | The confirm dialog (screen-local) |
| `app/admin/messages/page.tsx` | modify | Remove `confirm()`, open the dialogs, focus return |
| `app/admin/messages/components/MessagesTable.tsx` | modify | Pass the Delete button as the opener |
| `app/admin/messages/__tests__/source.guard.test.ts` | modify | G-1, G-2 amendments; new G-10 (no `confirm`) |
| `app/admin/messages/__tests__/messages.baseline.render.test.tsx` | modify | B-10, B-11 drive the dialog instead of a `confirm` stub |
| `app/admin/messages/__tests__/messages.layout.render.test.tsx` | modify | Remove the `confirm` stub; Delete / Mark All Read clicks go through the dialog |
| `app/admin/messages/__tests__/messages.confirmDialog.render.test.tsx` | create | The SA-C11 cases |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Messages registry entry lists the new file |

## Task List

- [x] Step 1: workplan
- [x] Step 2: `MessagesConfirmDialog.tsx`
- [x] Step 3: page and table
- [x] Step 4: deliberate test edits (listed in Results)
- [x] Step 5: new dialog suite and G-10
- [x] Step 6: mutations, runs, requirement row

## Results

### Deliberate test edits

| File | Edit | Why |
|---|---|---|
| `messages.baseline.render` | `confirmSpy` and its `beforeEach` / `afterEach` removed; helper `answerDialog` added (the click runs inside `act`) | There is no native box to stub; the dialog is answered by its words |
| `messages.baseline.render` B-10 | Was "confirm false, then true"; now Cancel in the dialog, then Delete. The `toHaveBeenCalledWith` on the stub becomes the dialog found by the same question | Same two halves (nothing sent, then the DELETE); the request assertions are unedited |
| `messages.baseline.render` B-11 | Same change, Cancel then Mark All Read | The fan-out and one re-read assertions are unedited |
| `messages.layout.render` | `confirmSpy` removed; `answerDialog`, `DELETE_QUESTION`, `MARK_ALL_QUESTION` added | As above |
| `messages.layout.render` T-12 "confirm false" | Now: Delete opens only the delete question (no drawer), Cancel sends nothing | The case pinned "Delete does not open the drawer"; it now opens its own question, so the check is that the only dialog is that one |
| `messages.layout.render` T-14, T-17, T-21 (both), T-22, T-24 | Each Delete or Mark All Read click is followed by `answerDialog(..., 'Delete' / 'Mark All Read')` | The click alone now only asks; no assertion changed |
| `source.guard` G-1 | `components/MessagesConfirmDialog.tsx` joins the exact list ("three components") | New screen-local file |
| `source.guard` G-2 | `escapes()` lets exactly `@/components/ui/dialog` into exactly the dialog file; two new cases: negative controls (page, table, `ui/dialogX`, `ui/button`, `ui/sheet` refused) and a liveness check that the file really imports it | Before, G-2 refused the dialog primitive everywhere, which is what kept the native box (the Q-8 deviation); a narrow named amendment, like the Invites G-8 one (SA-C10) |
| `source.guard` G-10 (new) | Walks `app/admin/messages` (tests included, this guard file excluded) on raw source; refuses `window.confirm`, `confirm(`, and the quoted name used by a jest stub. Plain substrings, no pattern, with a self-test | AC-3.3 "no `confirm(` left"; covering the tests too stops a stub coming back |
| `layoutFolder.guard` | Messages registry entry lists `MessagesConfirmDialog.tsx` | It imports the shared folder, so S-1 (alias only), no own h1, no `.json(` apply to it |

### New suite `messages.confirmDialog.render.test.tsx` (22 tests)

C-0 words (both dialogs: title and buttons Cancel, action, Close) · C-1 focus on Cancel at open (both) · C-2 Enter on open sends nothing (both; Mark All Read also no re-read) · C-3 Cancel and Escape send nothing (both) · C-4 Delete sends exactly `fetch('/api/admin/messages/msg-1', { method: 'DELETE' })`; Mark All Read sends one PATCH per unread row with the same init keys, headers and body, then exactly one re-read · C-5 two clicks before a re-render send once (both), and a real `dblClick` sends one DELETE · C-6 Escape, Cancel and the corner close do nothing while in flight; it closes once the request settles (both) · C-7 focus: cancelled returns to the row's Delete or the header button; done returns to the content area (the opener left) and never body · C-8 failures: a failed or rejected DELETE closes the dialog, keeps the row with "Could not delete the message. Try again." and focus on its Delete; a failed PATCH shows "Could not mark every message as read. Try again." and still reads once; route words never shown.

### Mutations (each restored, SHA-256 equal before and after)

| # | Mutation | Bites |
|---|---|---|
| M1 | Initial focus on the action button | C-1 (2), C-2 (2) |
| M2 | Ref guard removed from `send` | C-5 two-clicks (2). The real `dblClick` case stays green: `disabled` alone stops it after the first re-render, so the ref is the guard only for same-tick clicks |
| M3 | Dismissable in flight (`onOpenChange` and Escape guards removed) | C-6 (2) |
| M4 | Focus fallback removed (`confirmOpener.focus()` only) | C-7 done cases (2) |
| M5 | No D-19 line on a non-ok DELETE | C-8, T-21 |
| M6 | DELETE init gains `cache: 'no-store'` | C-4 Delete |
| M7 | A `window.confirm` call put back in `deleteMessage` | G-10 page.tsx plus 12 behaviour tests |

### Runs

| Check | Result |
|---|---|
| `jest app/admin/messages app/admin/components` plus the two authz guards and `tailwind-css-escape.guard` | 30 suites, 1,059 tests, all pass; Messages alone 5 suites, 161 tests; no act or console warnings |
| `npm run lint:hooks` | clean |
| ESLint on `app/admin/messages` and `layoutFolder.guard` | clean |
| Scoped `tsc` (scratchpad tsconfig extending the worktree's, `include: []`, the 8 touched files) | with canary: exactly `zz-canary.ts(1,7) TS2322`, exit 2; without: exit 0 |

### Notes

- No request change: `deleteMessage` and `markAllRead` lose only their native-box line. `git diff` on `page.tsx` shows no edit inside either function body.
- No shared-folder file added or edited. Destructive fill is a local `bg-rose-700` class (the `DeleteBusinessDialog` colour); Mark All Read uses the sky fill the Jobs and Archiving dialogs use.
- `MessagesTable` `onDelete` now also passes the button (`event.currentTarget`), the way `onOpen` does, so focus can return to it.

## SA Review Notes

UI short path: no workplan review stage; the code review below is the SA gate.

### SA Code Review

**Code Review by SA — 2026-10-13**
**Status:** ✅ Code Approved (APPROVED, no required fixes)

Reviewed against `origin/main` at `8014ee73` (the branch base; uncommitted diff, 7 modified files plus 3 new).

#### 1. SA-C11

| Rule | Where | Verdict |
|---|---|---|
| Initial focus on Cancel | `onOpenAutoFocus` prevented, `cancelRef` focused; C-1 (both dialogs), mutation M1 bites | ✅ |
| Enter on open sends nothing | Enter lands on Cancel; C-2 drives a real Enter keypress and checks no write and (Mark All Read) no re-read | ✅ |
| One send per confirmation | `isSending` ref set synchronously before any re-render, plus `disabled`; C-5 same-tick double click and real `dblClick` | ✅ |
| No close in flight | `onOpenChange`, `onEscapeKeyDown`, `onInteractOutside` all check the ref; Cancel disabled; the corner close routes through `onOpenChange`. C-6. SA mutation S2 (close on click, before the request) bites 2 tests | ✅ |
| Focus to opener, else `messages-content`, never body | `onCloseAutoFocus` prevented, page `returnConfirmFocus` uses `isConnected`; C-7 both ways, M4 bites | ✅ (see observation O-1) |
| D-19 lines kept | `deleteFailedId` and `markAllFailed` paths untouched; C-8, T-21, T-22, M5 bites | ✅ |

#### 2. Requests byte-identical

Extracted `deleteMessage`, `markAllRead` and `updateMessageStatus` from `origin/main` and from the worktree and diffed them. The only difference in each of the first two is the removal of the comment line and the `confirm(...)` guard line; `updateMessageStatus` is identical. The DELETE (`{ method: 'DELETE' }`), the `Promise.all` PATCH fan-out and the single `void fetchMessages()` re-read are unchanged. C-4 pins the exact init objects (keys, headers, body) and the one re-read. ✅

#### 3. Page-local `MessagesConfirmDialog.tsx`, and the shared-dialog ruling

Page-local is the right call for this slice. It follows the established pattern: eight admin confirmations already live next to their screen (`ArchiveConfirmDialog`, the three Jobs dialogs, `BoostCapDialog`, `BoostReconcileDialog`, `CreditFormDialog`, `DeleteBusinessDialog`), all built from `ui/dialog` plus the shared `adminDialog` classes. No `AdminConfirmDialog` exists, and creating one would be a shared-folder change (full cycle), which this UI short-path slice must not carry.

**Ruling for LF-3a (Invites Revoke):**
- LF-3a must **not** import `MessagesConfirmDialog`. It is screen-local, a cross-screen import breaks both screens' import-isolation guards (Messages G-2, the Invites guard), and it does not fit: Revoke has a reason field, its own words ("Revoke invite", "Keep it") and opens with focus on the reason field (§3.3), while this dialog is title-only with focus on Cancel.
- LF-3a builds its own screen-local Revoke dialog, copying the in-flight discipline proven here (synchronous ref guard, no dismiss in flight, `onCloseAutoFocus` to the opener or a content fallback). That keeps LF-3a inside its stated "no shared code change" scope (§3.3 LF-3a rules).
- A shared `AdminConfirmDialog` (or a smaller shared hook for the in-flight and focus-return part, which is the part these dialogs repeat) is **not** made now and **not** in LF-3a. Record it as a follow-up candidate for its own full-cycle slice once LF-3a and LF-4b (F-108 focus return on the Businesses dialogs) have landed, so it is designed against three real consumers instead of one.

#### 4. G-2 amendment and G-10

- G-2: the exception is exact on both sides (`relative === DIALOG_FILE` and `specifier === '@/components/ui/dialog'`), sits before the generic `@/` rule, has negative controls (page, table, `ui/dialogX`, `ui/button`, `ui/sheet`) and a liveness check. SA mutation S1 (drop the file condition) bites the negative control. Narrow. ✅
- G-10: raw-source walk of the whole screen including tests, excluding only itself, with a self-test and a reachability check. Case-sensitive substrings, so `onConfirm(` and `confirmLabel` pass while `confirm(`, `window.confirm` and a quoted `confirm` jest stub are caught. Sound for its purpose. ✅

#### 5. Test edits

All edits replace the `window.confirm` stub with answering the real dialog by its question text. No `expect` on a request was removed or loosened: B-10 and B-11 keep their write counts, URLs and re-read count; T-12 gains a stronger check (the only dialog is the delete question, not the drawer); T-14, T-17, T-21, T-22, T-24 only add `answerDialog`. The one dropped assertion is the stub's `toHaveBeenCalledWith(question)`, replaced by `findByRole('dialog', { name: question })`, which is equivalent and stricter. ✅

#### 6. Dialog placement

Both dialogs render as siblings of `AdminDrawer` at page level, outside `headerActions` and the table, with their state (`deleteTarget`, `isMarkAllAsked`) in the page. The Mark All Read button unmounts as the optimistic `setMessages` marks rows read mid fan-out; the dialog stays mounted and closes after the fan-out settles. C-7 "Mark All Read done" covers it. ✅

#### 7. console and any

No `console.*` in any touched file (the Messages guard also pins it). No `any` in source; the one `(global as any).fetch` in the new test carries the same eslint-disable comment as the two existing suites. ✅

#### SA runs and mutations

| Check | Result |
|---|---|
| `jest app/admin/messages` plus `layoutFolder.guard` | 6 suites, 514 tests, all pass (one jest "worker failed to exit gracefully" notice, not a failure) |
| S1: G-2 exception broadened to any file (file condition dropped) | Bites: 1 test (the negative control). Restored, SHA-256 match |
| S2: `onClose()` called right after `setIsBusy(true)` in `send` (closes before the request settles) | Bites: 2 tests (C-6). Restored, SHA-256 match |

Worktree diff stat identical before and after (7 files, 190 insertions, 29 deletions).

#### Observations (non-blocking, no fix required)

- O-1 (Low): Mark All Read with a partial failure returns focus to the header button (some rows stay unread locally). If the re-read then shows nothing unread (a PATCH that failed to the client but committed on the server), the button unmounts after focus returned to it, and the A-3 rescue does not fire because focus was inside the dialog portal when the read started. Rare and not a regression versus the native box; record it, do not fix in this slice.
- O-2 (Low): the `onInteractOutside` guard is defence in depth behind the `onOpenChange` guard and has no isolated test. Acceptable.

### Code Approved for QA: Yes

## QA Testing Report

**QA — 2026-10-13**
**Test mode:** full
**Strategy used:** A (Jest render tests against the real page with a mocked `fetch`) plus throwaway probes. No browser check, per TL: Delete and Mark All Read are destructive on real messages.
**Focus:** ui, api requests sent by the page
**Skipped:** browser check (TL instruction)
**Input source:** prompt keywords

### Verdict: PASS WITH NOTES

No bugs. Notes below are observations only.

### Runs

| Check | Result |
|---|---|
| `jest app/admin/messages app/admin/components` plus `admin-authz-surface.guard`, `security-definer-surface.guard`, `tailwind-css-escape.guard` | 30 suites, 1,059 tests, all pass (run twice, the second with no probe present) |
| Messages alone (`jest app/admin/messages`) | 5 suites, 160 tests, all pass |
| The three guards alone | 3 suites, 209 tests, all pass |
| `npm run lint:hooks` | clean (0 warnings) |
| Flakiness: messages suites, 3 sequential runs (verbose) | 3 of 3 green, 160 of 160 each |
| Flakiness under load: messages suites plus QA probe, 3 runs in parallel | 3 of 3 green, 181 of 181 each |
| QA probe suite alone, 3 runs | 3 of 3 green, 20 of 20 each |

Two red runs early in the session (1 test in `source.guard`, then 2 in `messages.confirmDialog`) match exactly SA mutations S1 (bites 1, the G-2 negative control) and S2 (bites 2, C-6) running in the same worktree at that moment. Not reproduced in 9 later runs, sequential or parallel. Not flaky.

Count note: the Dev Results table says "Messages alone 5 suites, 161 tests". The clean count is 160. The combined 1,059 is right. G-10 adds one test per file under `app/admin/messages`, so any file present during a run (a canary or probe) moves that number by one.

### Test Coverage

Q-numbers are QA probes (throwaway file `zzQaProbe.test.tsx`, deleted). Every probe also spied on the native box and asserted it was never called.

| Item | Tested? | Result | Evidence |
|---|---|---|---|
| Delete opens a dialog with the same words as the old box | ✅ | Pass | C-0; title is exactly "Are you sure you want to delete this message?" (old `page.tsx` line 257 at HEAD); Mark All Read title is exactly "Mark all messages as read?" (old line 284) |
| Cancel sends nothing | ✅ | Pass | C-3, Q14 setup |
| Escape sends nothing | ✅ | Pass | C-3 (fireEvent), Q2 (real keyboard Escape, both dialogs) |
| X button sends nothing | ✅ | Pass | Q1 (both dialogs, idle): no request, focus back on the opener |
| Outside click (idle) | ✅ | Pass | Q10b: closes, no request |
| Enter right after open sends nothing | ✅ | Pass | C-2; Q3 and Q3b: Enter on the opener then Enter again at once, no write, no extra re-read |
| Confirm sends exactly the DELETE of today | ✅ | Pass | C-4, Q4: `fetch('/api/admin/messages/msg-1', { method: 'DELETE' })` and nothing else. See note N-1 on "then one re-read" |
| Mark All Read sends exactly the PATCH fan-out of today, then one re-read | ✅ | Pass | C-4, Q5, Q9: one PATCH per unread row, same headers and body keys, then exactly one GET |
| A double click sends once | ✅ | Pass | C-5 (same-tick and `dblClick`, Delete); Q9 (`dblClick` on Mark All Read action) |
| Cannot be closed while in flight | ✅ | Pass | C-6 (Escape, Cancel, X); Q10 (outside pointer, Delete); Q11 (Cancel disabled and inert, Mark All Read); `aria-busy="true"` on the dialog while busy |
| Focus back to the row's Delete, or content when the row is gone | ✅ | Pass | C-7, Q1, Q2 (cancelled: the Delete button); Q4, Q14 (deleted: `messages-content`); C-8 (failed: the Delete button) |
| Same for the header button | ✅ | Pass | Q1, Q2 (cancelled: header button); Q12 (rejected fan-out, rows still unread: header button); C-7, Q5c (done, button gone: content); Q5b (done, button still connected: header button). Never body (Q13) |
| Failed DELETE shows the D-19 line | ✅ | Pass | C-8 (non-ok and rejected); Q14: retry through the dialog clears the line, sends one more DELETE, row leaves |
| Failed fan-out shows the D-19 line | ✅ | Pass | C-8 (partial 500); Q12 (all rejected): "Could not mark every message as read. Try again.", still one re-read |
| Keyboard-only: Tab to Delete, Enter, Tab to action, Enter | ✅ | Pass | Q4: real `user.tab()` from page start to the row's Delete, Enter opens with focus on Cancel, one Tab reaches Delete, Enter sends the one DELETE, focus lands on content, no drawer. Q5: same for Mark All Read with Space. Q6: Tab is trapped (Cancel, action, Close, back to Cancel) |
| L-7 / D-17: Delete click does not open the drawer | ✅ | Pass | T-12; Q7 (real `user.click`): only the delete question is open, no PATCH |
| L-7 / D-17: whole-row click unchanged | ✅ | Pass | T-12; Q8: row text click opens the drawer and sends the one mark-read PATCH |
| Admin dialog surface | ✅ | Pass | Q16: carries every `ADMIN_DIALOG_CLASS` class, no `aria-describedby`, no console error or warning |
| No native box left | ✅ | Pass | G-10 (screen and tests); `grep` on the diff |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. Request counts are unchanged.

#### Edge Cases (nice to fix)

1. **N-1, the brief vs the code (no defect).** The QA brief asked for "the DELETE, then one re-read". The DELETE on `main` never re-read: on success it drops the row locally (`setMessages(prev => prev.filter(...))`). That is still the case, and C-4 and Q4 pin exactly one GET (the first load) after a Delete. Only Mark All Read re-reads. Unchanged behaviour, recorded so nobody "fixes" it.
2. **N-2, where Mark All Read sends focus depends on timing (Low, within spec).** After a successful fan-out, focus lands on the content area when the header button has unmounted (C-7, Q5c), or on the header button when it is still mounted at close time (Q5b, the keyboard path, where the re-read brings unread rows back). Both are allowed targets and neither is body. This is SA O-1 seen from the other side. Not a regression.
3. **N-3, Dev count typo (Low, docs only).** Results says 161 Messages tests; the clean count is 160 (see Runs).

### Test Outputs / Logs

```text
Test Suites: 30 passed, 30 total
Tests:       1059 passed, 1059 total
Test Suites: 5 passed, 5 total          (app/admin/messages)
Tests:       160 passed, 160 total
Test Suites: 3 passed, 3 total          (authz, security-definer, tailwind guards)
Tests:       209 passed, 209 total
lint:hooks: no output, exit 0
QA probe: Tests: 20 passed, 20 total (x3)
Q5b trace: focus on header "Mark All Read", connected=true, same opener node
Q5c trace: focus on messages-content, opener gone
```

`git status` after QA: only the Dev's 7 modified and 3 new files; no `zz` file left.

### Final Status

- [x] All acceptance criteria pass — ready for commit
- [ ] Issues found — Dev must address before commit

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf3b` |
| Code commit | `5ecfbfd6` feat(admin): Messages asks in admin dialogs instead of the browser box (LF-3b) |
| `origin/main` merge | Not needed (already up to date) |
| PR | [#348](https://github.com/AgentsPilot/neuronforge/pull/348), open, fast-track; the user merges |
| RM pre-PR run | jest (messages, components, authz-surface guard, tailwind escape guard): 29 suites, 975 tests pass; `lint:hooks` clean |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created and built (Dev) | Workplan, build and results |
| 2026-10-13 | QA report (QA) | PASS WITH NOTES: 1,059 of 1,059 combined, Messages 160 of 160, guards 209 of 209, lint:hooks clean; 3 sequential and 3 parallel runs green; 20 throwaway probes green and deleted; no bugs, notes N-1 to N-3 |
| 2026-10-13 | PR opened (RM) | Code commit `5ecfbfd6`, PR #348 open (fast-track); Commit Info filled; status updated |
