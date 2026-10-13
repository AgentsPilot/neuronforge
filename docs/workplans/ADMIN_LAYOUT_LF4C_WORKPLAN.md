# Workplan: Admin Layout LF-4c (reconcile moves to Scheduled jobs & queues)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1.2 (BD-6), §1.3 (the reconcile row, PIN-e, PIN-f, PIN-g), §3.3 (the reconcile row), §6 (Security), §7.3 (AC-4.6, AC-4.8), §8 (LF-4c row), §9 (Q-1, answered (a)), §10 and §13.2 (SQ-1, SQ-2), §13.3 (SA-C2, SA-C3)
**Branch:** `feature/admin-layout-lf4c`, cut from `feature/admin-layout-lf4b` at `567d7f50` (PR #349 open). Confirmed with `git branch --show-current` in worktree `neuronforge-admin-layout`. Before building: `git fetch origin main`; `origin/main` is `8014ee73` (#346), already contained in the branch (merged into LF-4b as `ccaab0bc`); #347, #348 and #349 not merged, so nothing to merge. **Update (SA F3):** #349 (LF-4b) is now MERGED (`ffb598ac` on `origin/main`, which is at `f302680f` after #352); RM merges `origin/main` into this branch before opening the PR
**Path:** Full cycle. SA approved this workplan with conditions SA-W1 to SA-W10, applied below (see "SA conditions applied"), plus all three non-blocking suggestions
**Date:** 2026-10-13
**Status:** PR #354 open — fast-track (SA code review approved with fixes F1 to F3, applied; QA PASS WITH NOTES). TL browser check QB-4 owed. The user merges

## Overview

"Run billing reconcile now (all accounts)" checks Stripe for unfinished top-ups of every business, yet it sits inside one business's drawer. This slice moves it to Scheduled jobs & queues, into the Billing reconcile job's row, as **"Reconcile top-ups now (all accounts)"**. The dialog and its words move into two new files in `app/admin/components/jobs/`; `boostCopy` loses its reconcile keys; the drawer keeps one pointer line with a link to the Jobs page.

**Money is the hard line.** The request is byte-identical: POST to `/api/admin/business-os/credits/boost/reconcile`, header `Content-Type: application/json`, body the literal string `'{}'`, `cache: 'no-store'`. The confirm step, the in-flight guard (Run disabled, Close disabled, Escape and outside clicks refused), and the "200 with `passesFailed` above 0 is a failure" rule (QA6b-M1) behave as today. The only deliberate copy changes are the ones BD-6 and SA-C2 name: the opener's label, and the dialog description.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [The Jobs row placement](#the-jobs-row-placement)
4. [The dialog and copy files](#the-dialog-and-copy-files)
5. [The drawer after the move](#the-drawer-after-the-move)
6. [Files to Create / Modify / Delete](#files-to-create--modify--delete)
7. [The Jobs source guard amendment](#the-jobs-source-guard-amendment)
8. [Moving REC-1 to REC-3 (the pin move)](#moving-rec-1-to-rec-3-the-pin-move)
9. [Other existing tests edited](#other-existing-tests-edited)
10. [Tests to add](#tests-to-add)
11. [Mutation runs planned](#mutation-runs-planned)
12. [Browser checks (read-only)](#browser-checks-read-only)
13. [Logging and entitlements](#logging-and-entitlements)
14. [Size estimate](#size-estimate)
15. [Risks](#risks)
16. [Questions for SA](#questions-for-sa)
17. [Questions for the user](#questions-for-the-user)
18. [Task List](#task-list)
19. [SA Review Notes](#sa-review-notes)
20. [QA Testing Report](#qa-testing-report)
21. [Commit Info](#commit-info)

---

## Analysis Summary

What exists today (read on the branch at `567d7f50`):

| Piece | Where | Today |
|---|---|---|
| Opener | `app/admin/users/components/BoostBlock.tsx:585-597` | `<button data-testid="boost-reconcile">` with `BOOST_ACTION_COPY.reconcileButton`, rendered instead of the own-account sentence (ternary). Pressing it clears the block's notice and sets `reconcileOpen` |
| Dialog mount | `BoostBlock.tsx:618-626` | `{reconcileOpen && <BoostReconcileDialog open … onFinished={finished} />}`; `finished` closes it, sets the block notice and re-reads the top-ups |
| Dialog | `app/admin/users/components/BoostReconcileDialog.tsx` (98 lines) | Controlled (`open`, `onOpenChange`). `inFlight` ref; `handleOpenChange` refuses a close while in flight; `fetch(RECONCILE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })`; body read with `response.json().catch(() => null)`; `reconcileOutcome(body.data)` only when `response.ok && body?.success === true`; any other outcome sets `reconcileFailed`. Test ids `boost-reconcile-dialog`, `-description`, `-error`, `-close`, `-run`. Description class `!text-slate-300`. No logger: the `catch` is silent |
| Copy | `app/admin/users/boostCopy.ts` | `BOOST_ACTION_COPY.reconcileButton`, `reconcileTitle`, `reconcileDescription`, `reconcileRun`, `reconcileRunning`, `reconcileFailed`; functions `reconcileOutcome`, `reconcileSentences`. The file imports `formatMinorAmount` from `@/lib/business-os/currency` at run time (line 6), so it cannot be imported by a Jobs client file (C-21) |
| Route | `app/api/admin/business-os/credits/boost/reconcile/route.ts` | `requireAdmin` first; strict Zod on an empty or `{}` body; runs `runReconcilePasses([boostReconcilePass], …)` under the 45 s budget; never writes a `bos_cron_runs` row (7d C7-11). **Not touched** |
| Cron job | `lib/cron/bosCronJobs.ts:540-549` | id `bos-billing-reconcile`, label "Billing reconcile", "Daily at 05:41 UTC". `BosCronJobId` (line 30) is the exported id union. **Not touched** |
| Jobs view | `app/admin/components/jobs/JobsQueuesView.tsx` | `JobRow` renders 7 cells per job, no button. The header's action sentence is `PURPOSE_ACTIONS` (line 64-65); the guard holds the same text as `VIEW_HEADER_SENTENCE` |
| Jobs guard | `app/admin/__tests__/jobsQueues.source.guard.test.ts` | `CLIENT_FILES` (6 files), `FILES` read-only rules for page, view and panel, a one-POST block per action dialog, the L-1b dialog-class block for the three dialogs |
| Pins | `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx:578-656` | REC-1, REC-2, REC-3 (LF-4a.1), on the shared harness `tests/admin/drawerPinHarness.ts` |
| Older tests | `app/admin/users/__tests__/boostBlock.actions.render.test.tsx:120-125`, `:277-349` | the button's label, and a "Run billing reconcile now (SA C-6)" describe with 6 cases (8 runs with the `it.each`) |

Every other reference to the reconcile in `app/admin` was listed with a repository grep: `businessDrawer.money.render.test.tsx:306-317` (T-A2, "reconcile is unmoved"), `businessDrawer.pins.credits.render.test.tsx:598`, `:605` (PIN-h, own account: zero reconcile buttons), `users/__tests__/source.guard.test.ts:476` (the dialog-class list), `layoutFolder.guard.test.ts:557` (a comment). No other file imports a reconcile key from `boostCopy`.

**Why the reconcile button is not "Run now" for the job (SA SQ-1).** The admin route runs the top-ups pass only; the cron will also run the plans pass after P-8b; and a press records no `bos_cron_runs` row, so the job row's Last run, status and counts do not change. The label says what it does, and the dialog says the press is not a run of the nightly job.

---

## Implementation Approach

1. Two new files in `app/admin/components/jobs/` (SA-C3): `ReconcileTopUpsDialog.tsx` (the dialog, owning its trigger button, its open state and its result notice) and `reconcileCopy.ts` (the words, `reconcileOutcome`, `reconcileSentences`; no imports at all).
2. `JobsQueuesView.tsx` renders `<ReconcileTopUpsDialog />` once, in the Job cell of the row whose id is `bos-billing-reconcile`, and updates its header sentence. The view itself still makes one request (the jobs GET) and has no button of its own, exactly as for Drain now.
3. `BoostBlock.tsx` loses the button, the state and the dialog mount, and gains one pointer line. `boostCopy.ts` loses its reconcile keys and functions and gains the pointer words. `BoostReconcileDialog.tsx` is deleted.
4. REC-1 to REC-3 and the older reconcile cases move to one new Jobs render test, with the same assertions; the only edits are the named BD-6 copy edits and the locators of elements that now live elsewhere (listed one by one in [Moving REC-1 to REC-3](#moving-rec-1-to-rec-3-the-pin-move)).
5. The Jobs guard is amended narrowly and the amendment is named in the guard's header and the PR body.

No new pattern: the dialog follows `DrainNowDialog` (own `DialogTrigger`, own state, `ADMIN_DIALOG_CLASS`), and the copy file follows `jobsFormat.ts` (no imports).

---

## The Jobs row placement

**Where:** `JobRow`, first cell (the Job cell), after the existing lines in this order: label, description, schedule line, time-limit note (when present), then the new block. Only the row whose `job.id` equals `RECONCILE_JOB_ID` gets it.

**File:** `app/admin/components/jobs/JobsQueuesView.tsx` (sketch, not final code)

```tsx
import type { BosCronJobId } from '@/lib/cron/bosCronJobs';
import { ReconcileTopUpsDialog } from './ReconcileTopUpsDialog';

// The one job whose row carries an on-demand action (BD-6, SA-C2). Typed against
// the registry's id union, so a renamed job id fails the type check.
const RECONCILE_JOB_ID: BosCronJobId = 'bos-billing-reconcile';

// in JobRow, first <td>, after the time-limit note:
{job.id === RECONCILE_JOB_ID && (
  <div className="pt-2">
    <ReconcileTopUpsDialog />
  </div>
)}
```

Why the Job cell, not a new column: a new column would add an empty cell to all other rows and change the table for every job; the Job cell is where an admin reads the job's name and what it does, just as Drain now sits beside a queue's name in its card header. The status, last-run and count cells stay pure facts.

Why `import type` only: the Jobs guard refuses any runtime import from `@/lib/cron` (C-21). `BosCronJobId` is a type; `DrainNowDialog` already imports `BosQueueId` the same way.

The trigger button uses the Drain now trigger's classes (`whitespace-nowrap rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700/50`), so the page's on-demand actions look alike. Its text is `Reconcile top-ups now (all accounts)`; test id `boost-reconcile` (kept, see SQ-3).

The result notice renders directly under the trigger, inside the same cell, as `<div data-testid="reconcile-notice" role="status">` with one `<p>` per sentence (the block's notice shape today). Opening the dialog again clears it, as pressing the drawer button cleared the block notice.

**The page does not re-read after a reconcile.** The press writes no `bos_cron_runs` row and touches no queue, so the jobs read would return the same figures. The drawer re-read the top-ups because the top-ups list was on screen; there is no such list here. Pinned (REC-1 to REC-3: the jobs GET count stays 1) and asked as SQ-2.

**The header sentence** (`PURPOSE_ACTIONS` and `VIEW_HEADER_SENTENCE`), proposed:

> Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; the Billing reconcile job has a Reconcile top-ups now button; everything else here is read-only.

It keeps exactly one "Drain", no capital-C "Cancel", no "Retry" and no "Requeue", so the 7b and 7c header checks hold unedited.

---

## The dialog and copy files

### `app/admin/components/jobs/reconcileCopy.ts` (new, no imports)

Moved from `boostCopy.ts`, unchanged except where marked:

| Key | Value | Change |
|---|---|---|
| `RECONCILE_COPY.button` | `Reconcile top-ups now (all accounts)` | **Deliberate (BD-6, Q-1):** was `Run billing reconcile now (all accounts)` |
| `RECONCILE_COPY.title` | `Reconcile top-ups now` | **Deliberate (BD-6, SA-W1):** was `Run billing reconcile now` |
| `RECONCILE_COPY.description` | see below | **Deliberate (BD-6, SA-C2)** |
| `RECONCILE_COPY.run` | `Run now` | unchanged |
| `RECONCILE_COPY.running` | `Running…` | unchanged |
| `RECONCILE_COPY.failed` | `The reconcile could not run. Nothing is lost: the nightly run will try again.` | unchanged |
| `reconcileOutcome(data)` | body unchanged | moved |
| `reconcileSentences(counts)` | body unchanged | moved |

Proposed description (SA-C2: drops "not only this one", adds that a press is not a run of the nightly job):

> This checks Stripe for unfinished credit top-ups of every business. It may add credits, close expired checkouts or mark failed payments, exactly as the nightly run at 05:41 UTC does for top-ups. A press is not recorded as a run of the Billing reconcile job: its last run and counts stay as they are.

(SA-W2: the exact words, replacing the first proposal, whose "that job's row does not change" was not strictly true.)

"for top-ups" is added so the sentence stays true after P-8b gives the nightly run a plans pass (SQ-1 ruling). SA rules on the exact words (SQ-1).

### `app/admin/components/jobs/ReconcileTopUpsDialog.tsx` (new)

The body of `BoostReconcileDialog` with these changes, and only these:

| Change | Why |
|---|---|
| Owns its state: `open`, `busy`, `error`, `notice`; renders `<DialogTrigger asChild><button …>` itself; no props | SA-C3 (opened by `DialogTrigger`, like Drain now); focus returns to the trigger on close for free (SQ-6) |
| `onOpenChange(next)`: refused while `inFlight.current`; on opening, clears `error` and `notice` | today: `handleOpenChange` refusal, plus `useEffect` clearing the error on open, plus the opener clearing the block notice |
| On success: `setNotice(lines)` and close | today: `onFinished(lines)` closed it and set the block notice |
| `fetch('/api/admin/business-os/credits/boost/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })` | the URL inlined as a literal, so the guard can pin it as it pins Drain's; the request is byte-identical. The exported `RECONCILE_URL` constant goes (no importer) |
| Words from `./reconcileCopy` | the copy moved |
| `clientLogger.warn` on a failed outcome, `clientLogger.error({ err })` in the `catch`, child module `AdminReconcileTopUpsDialog`; counts and status only, never the body | CLAUDE.md: never swallow errors silently; the Jobs dialogs already log this way. Adds no request. **Only if SA agrees (SQ-5)** |

Unchanged: the `inFlight` ref and the early return; `response.json().catch(() => null)` (a money file, not converted to `readJsonBody`, L-4b SA Q-5 precedent); the success test `response.ok && body?.success === true`; Run and Close disabled while busy; `Running…`; the Close button word (Close, not Cancel); `ADMIN_DIALOG_CLASS` and `ADMIN_DIALOG_TITLE_CLASS`; the description's `!text-slate-300` class and every `boost-reconcile-*` test id (SQ-3, SQ-4).

---

## The drawer after the move

**File:** `app/admin/users/components/BoostBlock.tsx`

- Removed: the `BoostReconcileDialog` import, `reconcileOpen` state, `setReconcileOpen(false)` in `finished`, the button branch, the dialog mount. `finished` stays for the cap dialog.
- The own-account sentence stays exactly where it is, now as `{load.data.isOwnAccount && <p data-testid="boost-own-account" …>}`.
- New pointer line, last in the block's `ok` branch (where the button was), for every account, own account included (it is a link, not a money action, so PIN-h still holds):

```tsx
<p data-testid="boost-reconcile-pointer" className="text-xs text-slate-400">
  {BOOST_ACTION_COPY.reconcilePointer}{' '}
  <Link href="/admin/jobs-queues" className={LINK_CLASS}>Scheduled jobs & queues</Link>
</p>
```

with `reconcilePointer: 'Reconcile top-ups for all accounts:'` and `reconcilePointerLink: 'Scheduled jobs & queues'` (the §1.2 diagram's words; both in `boostCopy`, SA suggestion 1, so REC-0 reads both from copy), and a new `import Link from 'next/link'` in `BoostBlock.tsx` (precedent: `BusinessOsPanel.tsx`). `LINK_CLASS` is the block's existing in-text link style. Shown only when the top-ups read succeeded, as the button was; asked as SQ-7.

- Header comment: the reconcile bullet becomes the pointer line; "the reconcile button is unchanged here (LF-4c moves it)" becomes "LF-4c moved the reconcile to Scheduled jobs & queues".

**File:** `app/admin/users/boostCopy.ts`: removes `reconcileButton`, `reconcileTitle`, `reconcileDescription`, `reconcileRun`, `reconcileRunning`, `reconcileFailed`, `reconcileOutcome`, `reconcileSentences`; adds `reconcilePointer`. The header line "Words and money for the admin Credit top-ups block and its actions" is unchanged.

---

## Files to Create / Modify / Delete

### Product files

| File | Action | Reason |
|---|---|---|
| `app/admin/components/jobs/ReconcileTopUpsDialog.tsx` | create | the moved dialog with its own `DialogTrigger` and notice (SA-C3) |
| `app/admin/components/jobs/reconcileCopy.ts` | create | the moved words and outcome functions; no imports (SA-C3) |
| `app/admin/components/jobs/JobsQueuesView.tsx` | modify | `RECONCILE_JOB_ID`, the dialog in the Billing reconcile row, the header sentence, the header comment |
| `app/admin/users/components/BoostBlock.tsx` | modify | button, state and mount removed; pointer line; header comment |
| `app/admin/users/boostCopy.ts` | modify | reconcile keys and functions removed; `reconcilePointer` added |
| `app/admin/users/components/BoostReconcileDialog.tsx` | **delete** | moved (the Businesses folder keeps no reconcile code beyond the pointer, SQ-2 ruling) |

### Test and guard files

| File | Action | Reason |
|---|---|---|
| `app/admin/__tests__/jobsQueues.reconcile.render.test.tsx` | create | REC-1 to REC-3 moved, the older reconcile cases moved, placement and focus tests |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | the narrow amendment (next section) |
| `app/admin/__tests__/jobsQueues.render.test.tsx` | modify | the button-count test (deliberate) |
| `app/admin/__tests__/jobsQueues.layout.render.test.tsx` | modify | its `PURPOSE` constant (deliberate) |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | modify | the walk's expected Jobs files gain the two new files (guards the scan) |
| `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx` | modify | REC-1 to REC-3 removed (moved), the reconcile route and fixtures removed, REC-0 added, header comment |
| `app/admin/users/__tests__/boostBlock.actions.render.test.tsx` | modify | the reconcile describe removed (moved); the button test asserts the pointer instead |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | modify | T-A2 "reconcile is unmoved" becomes "no reconcile button; the pointer is last" |
| `app/admin/users/__tests__/source.guard.test.ts` | modify | drops `BoostReconcileDialog.tsx` from `DIALOG_FILES` |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | comments only: the Businesses note drops `BoostReconcileDialog`; the Jobs entry notes that `ReconcileTopUpsDialog.tsx` is deliberately not listed (a money file that keeps its `.json(` read, SA-C12 precedent) |
| `tests/admin/drawerPinHarness.ts` | not edited | reused by the Jobs test (SQ-8); its `requestOf` already records headers, `cache` and the raw body |

### Not touched

The admin reconcile route and its tests, the cron route, `lib/cron/bosCronJobs.ts`, `lib/business-os/**`, `BoostCapDialog.tsx`, `CreditsBlock.tsx`, `businessDrawer.pins.credits.render.test.tsx` (PIN-h still passes: its zero-count checks on `boost-reconcile` and the old button name stay true, and pins are not edited without need), `businessDrawer.pins.dangerReads.render.test.tsx`, the other Jobs dialogs and the panel.

---

## The Jobs source guard amendment

**File:** `app/admin/__tests__/jobsQueues.source.guard.test.ts`. Every existing rule stays; the edits are:

| # | Edit | Kind |
|---|---|---|
| G-1 | Header: a new paragraph "Amended by Admin Layout follow-ups LF-4c (BD-6, SA-C2, SA-C3), narrowly: …" naming each edit below | comment |
| G-2 | `RECONCILE_DIALOG` and `RECONCILE_COPY` path constants; `RECONCILE_DIALOG` joins `CLIENT_FILES` (so: `'use client'`, the C-21 import rule, no green) | widened scope |
| G-3 | `VIEW_HEADER_SENTENCE` becomes the new sentence (the view's one allowance moves with it); the line "everything else here is read-only" now follows the reconcile clause | deliberate text edit |
| G-4 | New: `ReconcileTopUpsDialog.tsx` makes exactly one request: one `fetch(`, its first argument the literal `'/api/admin/business-os/credits/boost/reconcile'`, and exactly one method key, `method: 'POST'` | new rule |
| G-5 | New: its body is the literal `body: '{}'`; no `JSON.stringify(` in the file; the headers literal is `{ 'Content-Type': 'application/json' }` and the file contains `cache: 'no-store'` | new rule |
| G-6 | New: it names no account (`userId`, `accountId`, `ownerUserId`, `user_id` absent: SA C-6, no account id is ever sent); never says Retry, Requeue, Cancel or Drain; never "OK"; no console; never reads `.error`, `.details` or `.message` from a response | new rule |
| G-7 | New: it opens through `DialogTrigger`, imports `ADMIN_DIALOG_CLASS` from the alias and passes it to `DialogContent`, and takes its words only from `./reconcileCopy` (no import from `app/admin/users`) | new rule |
| G-8 | New: `reconcileCopy.ts` has no `import` and no `require(`, no console, no "OK" (the `jobsFormat.ts` rule) | new rule |
| G-9 | New: `JobsQueuesView.tsx` names `<ReconcileTopUpsDialog` exactly once, inside the `job.id === RECONCILE_JOB_ID` branch, and `RECONCILE_JOB_ID` is the literal `'bos-billing-reconcile'`; the view still has exactly one `fetch(` (existing test, unedited) | new rule |
| G-10 | The L-1b dialog-class block stays on the three queue dialogs only. The reconcile dialog keeps its `!text-slate-300` description and its `data-testid` on `DialogDescription`, which the L-1b regex would refuse; G-7 pins the two shared classes it does use (SQ-4) | decision recorded |

The `FILES` rule ("no action button, no POST, no console, never OK") still applies to the page, the view and the panel unedited: the view gets no button and no POST of its own, as with Drain now.

---

## Moving REC-1 to REC-3 (the pin move)

**Is the move permitted?** Yes, by the requirement's own words:

- §1.3: "LF-4a.2, LF-4b and LF-4c may edit those tests only where the opener's position changes, plus the named, deliberate edits (**BD-6 copy and move**, BD-14 re-read), never the request or the confirmation."
- BD-6 and SA-C3: "the reconcile cases … move to a Jobs render test with the **same** assertions." BD-6 names `boostBlock.actions.render`, which was the only suite when the requirement was written; LF-4a.1 then pinned the same action through the whole drawer and its describe title and file header say "moves to Jobs in LF-4c with the same request assertions (BD-6)". Both files' reconcile cases move. Flagged for SA as SQ-9 in case SA reads BD-6 as naming only the older file.

**Where:** `app/admin/__tests__/jobsQueues.reconcile.render.test.tsx`, rendering `AdminJobsQueuesPage` (the whole page, as the pins render the whole drawer), on the shared harness `tests/admin/drawerPinHarness.ts` (`setRoutes`, `installFetch`, `installPinLifecycle({ countUuids: false })`, `posts`, `requestOf`, `getCount`, `deferred`, `quiet`). The route table: GET `/api/admin/jobs-queues` answers the `buildJobsQueuesView` fixture the other Jobs tests use; POST to the reconcile URL answers from `reconcileQueue`; anything else is an unexpected request and fails the test. `RECONCILE_OK` and `RECONCILE_POST` are copied byte for byte.

Assertion by assertion (everything not listed is copied unchanged):

| Pin | Assertion today (drawer) | In the Jobs test | Kind of edit |
|---|---|---|---|
| REC-1 | opener `boost-reconcile` text `Run billing reconcile now (all accounts)` | text `Reconcile top-ups now (all accounts)` | **BD-6 label**, deliberate |
| REC-1 | opener inside `boost-block` | opener inside `job-bos-billing-reconcile`, and in no other job row or queue card | position (the move) |
| REC-1 | dialog heading `Run billing reconcile now` | heading `Reconcile top-ups now` | **BD-6 copy, deliberate** (SA-W1) |
| REC-1 | description, the old sentence | the new SA-C2 sentence, exact | **BD-6 copy**, deliberate |
| REC-1 | Run says `Run now`; `posts()` empty before Run | same | unchanged |
| REC-1 | notice `boost-notice` lines equal `['Reconcile finished: 3 stuck top-ups examined, 1 credited, 0 expired, 0 marked failed, 0 need a person, 0 left for the next run.']` | the same lines, read from `reconcile-notice` inside the reconcile row | locator only |
| REC-1 | dialog gone after success | same | unchanged |
| REC-1 | `posts().map(requestOf(…, true))` strictly equals `[RECONCILE_POST]` | same | unchanged (the request pin) |
| REC-1 | reads: credits 1, boost 2, list 1 (one top-ups re-read) | the jobs GET count stays 1 (no re-read), and the row's `last-run-outcome` text is the same before and after | **the re-read assertion, deliberate**: the page has no top-ups list to re-read, and the press is not a run of the job (SQ-2) |
| REC-2 | double click on Run sends once; Run `Running…` and disabled; Close disabled; Escape refused (dialog is the same element) | same | unchanged |
| REC-2 | the drawer stays `data-state="open"` | dropped: there is no drawer; replaced by "the reconcile row is still in the document" | locator only |
| REC-2 | after the answer, dialog gone; request list `[RECONCILE_POST]`; reads | same, reads as REC-1 | as REC-1 |
| REC-3 | 200 with `passesFailed: 1`: the failure words exact, dialog stays (same element), no notice, `[RECONCILE_POST]` | same; "no notice" reads `reconcile-notice` | locator only |
| REC-3 | Run again sends the same body: `[RECONCILE_POST, RECONCILE_POST]`; dialog gone | same | unchanged |
| REC-3 | reads after failure and after the retry | jobs GET count 1 both times | as REC-1 |

The older cases from `boostBlock.actions.render` ("Run billing reconcile now (SA C-6)", 6 cases) move into a second describe of the same file with the same assertions, except: `toContain('not only this one')` becomes `not.toContain('not only this one')` plus `toContain('not recorded as a run')` (**BD-6 copy**, deliberate); `BOOST_ACTION_COPY.reconcileDescription` and `.reconcileFailed` read from `RECONCILE_COPY`; `boost-notice` reads `reconcile-notice`; `sent[0].body` not containing the account id becomes `toBe('{}')` only, as there is no account on this page (the `toBe('{}')` was already there).

**On the drawer side**, the REC describe is replaced by one test:

- **REC-0 (LF-4c):** after the drawer settles on another business's account, the drawer has no `boost-reconcile`, no `boost-reconcile-dialog`, and no button whose accessible name matches "reconcile" (case-insensitive); `boost-reconcile-pointer` reads `Reconcile top-ups for all accounts: Scheduled jobs & queues` and its link's `href` is `/admin/jobs-queues`; the per-open request list is unchanged (no reconcile POST, PIN-k untouched).

The pin file's `routePost` loses its reconcile branch, so any reconcile POST from the drawer would land in `unexpected` and fail every test in the file.

---

## Other existing tests edited

| File | Test | Edit | Reason |
|---|---|---|---|
| `jobsQueues.render.test.tsx` | "the only buttons are Refresh, one Drain now and one View items per queue" | count `1 + 5 + 5` becomes `1 + 5 + 5 + 1`; adds: exactly one `Reconcile top-ups now (all accounts)` button, inside `job-bos-billing-reconcile`; every other job row has no button; the per-card list stays `['Drain now', 'View items']`; title and the amendment comment updated | **deliberate**: the page gains one action (SA-C3, "the jobs button count and render pins edited deliberately") |
| `jobsQueues.layout.render.test.tsx` | the header test using `PURPOSE` | `PURPOSE` constant becomes the new sentence | **deliberate**: the purpose sentence names the new action (G-3) |
| `jobsQueues.render.test.tsx` | file header comment | "read-only apart from one Drain now per queue" gains "and one Reconcile top-ups now on the Billing reconcile row" | comment |
| `boostBlock.actions.render.test.tsx` | "Set limit and the reconcile button for another account; …" | the reconcile line becomes: no `boost-reconcile`, and `boost-reconcile-pointer` present; title updated | the button moved |
| `boostBlock.actions.render.test.tsx` | own account | unchanged (`boost-reconcile` absent still holds); adds the pointer present | the pointer shows on every account (SQ-7) |
| `boostBlock.actions.render.test.tsx` | the reconcile describe and its `reconcile` route option | removed (moved, above) | the move |
| `businessDrawer.money.render.test.tsx` | T-A2 "…; reconcile is unmoved" | the last-button check becomes: the block has no `boost-reconcile`, and `boost-reconcile-pointer` is the block's last child | the button moved |
| `users/__tests__/source.guard.test.ts` | the dialog-class list | drops `BoostReconcileDialog.tsx` | file deleted (SA-C3) |

The Drain, Cancel, Retry and items tests render every job row, so they render the new button too. None of them counts page buttons or looks a button up by a name the new one could match ("Drain now", "View items", "Cancel item", "Retry item" are exact names); `[data-testid^="job-"]` counts are safe because no new test id begins with `job-` or `queue-`. The full Jobs set runs before handover to prove it.

---

## Tests to add

In `jobsQueues.reconcile.render.test.tsx`, beyond the moved cases:

| Test | Asserts |
|---|---|
| JREC-P1 placement | the button is in the Billing reconcile row's first cell, after the schedule line; it is still there when that row's status is Could not check (the fixture's read fails for runs) |
| JREC-P2 no other row | with a fixture that has no `bos-billing-reconcile` row, there is no reconcile button anywhere |
| JREC-F1 focus | Close returns focus to the trigger (DialogTrigger, F-108 equivalent); after a success, focus is on the trigger and the notice is under it |
| JREC-F2 notice cleared | a second opening clears the previous notice, as the drawer did |
| JREC-F3 outside click | a pointer-down outside the dialog while in flight leaves it open (Radix `onInteractOutside` routes through the refusing `onOpenChange`) |
| JREC-T1 type seam | `findBosCronJob('bos-billing-reconcile')` is defined and labelled "Billing reconcile" (the row the button keys on exists in the registry); its `schedule` is `'41 5 * * *'` and `scheduleWords` `'Daily at 05:41 UTC'`, and `RECONCILE_COPY.description` contains `05:41 UTC`, with a comment that a schedule change must update the copy (SA-W3) |

---

## Mutation runs planned

Each is applied to a product file, the named test must fail, and the file is restored by checksum.

| # | Mutation | Must fail |
|---|---|---|
| MC1 | body `'{"all":true}'` | REC-1 (request), G-5 |
| MC2 | headers removed | REC-1, G-5 |
| MC3 | `cache: 'no-store'` removed | REC-1, G-5 |
| MC4 | method `'PUT'` | REC-1, G-4 |
| MC5 | `inFlight` early return removed | REC-2 (two POSTs) |
| MC6 | close refusal removed from `onOpenChange` | REC-2 (Escape), JREC-F3 |
| MC7 | Close not disabled while busy | REC-2 |
| MC8 | `passesFailed` check removed from `reconcileOutcome` | REC-3, the moved QA6b-M1 case |
| MC9 | description reverted to the old sentence | REC-1, the moved "covers every business" case |
| MC10 | button label reverted | REC-1, `jobsQueues.render` button test |
| MC11 | the `job.id === RECONCILE_JOB_ID` condition dropped (button in every row) | JREC-P2, `jobsQueues.render` button count, G-9 |
| MC12 | success also calls a page re-read (a second `fetch('/api/admin/jobs-queues'…)` passed in) | REC-1 (jobs GET count), view one-fetch guard |
| MC13 | `import { formatMinorAmount } from '@/lib/business-os/currency'` added to `reconcileCopy.ts` | G-8, C-21 |
| MC14 | `PURPOSE_ACTIONS` changed without the guard constant | the view header guard, the layout `PURPOSE` test |
| MC15 | a second `fetch(` (a GET) in the dialog | G-4 |
| MC16 | the dialog renders `body.error` on failure | G-6 |
| MC17 | the reconcile button put back in `BoostBlock` (old ternary) | REC-0, T-A2 |
| MC18 | the pointer line removed | REC-0, `boostBlock.actions` button test |
| MC19 | an account id added to the body | REC-1, G-5, G-6 |
| MC20 | dialog title reverted to `Run billing reconcile now` (SA-W1) | REC-1 |
| MC21 | the notice not cleared on reopen (SA suggestion 2) | JREC-F2 |
| MC22 | `className={ADMIN_DIALOG_CLASS}` removed from `DialogContent` (SA suggestion 2) | G-7 |

---

## Browser checks (read-only)

**Never press Run now in any environment that reaches production data or Stripe.** A local dev server on this repo talks to the production Supabase project. The checks below never send the reconcile POST; QA confirms in the Network panel that no request to the reconcile URL was made.

| # | Check | Pass |
|---|---|---|
| QB-1 | Businesses: open a business's drawer | no reconcile button; the pointer line "Reconcile top-ups for all accounts: Scheduled jobs & queues" at the end of the top-ups block |
| QB-2 | Click the pointer's link | lands on Scheduled jobs & queues |
| QB-3 | Scheduled jobs & queues | "Reconcile top-ups now (all accounts)" appears once, in the Billing reconcile row's Job cell, under its schedule line; no other row has a button; the header sentence reads as proposed |
| QB-4 | Open the dialog (SA agreed, SQ-10, under SA-W10): Network panel open and filtered to `reconcile` **before** the dialog opens; dismiss with a mouse click on Close (or Escape); **never press Enter or Space** while the dialog is open (a focused Run would fire) | title, the new description and Run now are shown; focus returns to the trigger; the QA report records zero requests to the reconcile URL. Any POST seen is reported to TL at once |
| QB-5 | Narrow window (about 1024 px) | the button does not break the Job cell (`whitespace-nowrap`); the table scrolls sideways as today |
| QB-6 | Contrast | the new button, pointer line and dialog text are at or above 4.5:1 (the LF-1 measuring method) |

If SA does not agree to QB-4, the dialog is checked by the render tests only.

---

## Logging and entitlements

- No touched product file uses `console.*` today (`BoostBlock.tsx`, `boostCopy.ts`, `JobsQueuesView.tsx`: 0 each); the new files use none.
- The old dialog swallowed a network failure silently. The new one logs it through `clientLogger`, as the Jobs dialogs do, if SA agrees (SQ-5). No server text and no response body is logged.
- No import from `lib/business-os/entitlements/` is added or touched, so `npm run test:bos-entitlements` is not required by the skill; it runs anyway in the run set below, as it did for LF-4b, as a cheap check that nothing in the Businesses folder drifted.

### Run set before handover

`npx jest app/admin/__tests__ app/admin/users app/admin/components/layout` and `npm run test:bos-entitlements`; `npx tsc --noEmit -p .` scoped check of the changed files; `npm run lint` on the changed files.

---

## Size estimate

About 1.5 days, within SA's "about 2 days":

| Part | Effort |
|---|---|
| Two new files, view and BoostBlock edits, copy edits, delete | 0.3 day |
| Jobs reconcile test (moved pins, moved cases, six new tests) | 0.5 day |
| Guard amendment, other test edits | 0.3 day |
| Mutations MC1 to MC19, run set, workplan notes | 0.4 day |

Diff: 2 product files created, 3 modified, 1 deleted; 1 test file created, 9 modified. Net product lines about +60 (the dialog moves, so most lines are a move).

---

## Risks

| Risk | Mitigation |
|---|---|
| An admin presses Reconcile expecting the job's Last run to change | the dialog says so; the label is not "Run now" (SA-C2) |
| Someone presses Run now during the browser check | the checks forbid it; QB-4 only with SA's consent, and QA watches Network |
| The Jobs guard amendment widens more than intended | G-4 to G-9 are additive and exact; every existing rule is unedited apart from the header sentence constant; each is named in the PR body |
| P-8b later changes the cron's passes | the copy says "for top-ups"; the button runs the admin route, which stays top-ups only (SQ-1 ruling) |
| Stacked branch: LF-4b (#349) is still open | this branch starts from it; RM merges `origin/main` in after #349 merges, before the PR |

---

## Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| SQ-1 | Dialog title and description. BD-6 changes only the description; the title "Run billing reconcile now" now sits under a button that is deliberately not "Run now" for the job. Keep the title, or change it to "Reconcile top-ups now" (a second deliberate copy edit)? And are the proposed description words right? | Change the title to "Reconcile top-ups now" for consistency with SQ-1's ruling, as a named deliberate edit; if SA prefers the requirement's narrower edit, keep it. Description as proposed |
| SQ-2 | No page re-read after a reconcile; REC-1 to REC-3 assert the jobs GET count stays 1 in place of "one top-ups re-read". Agreed? | Yes: nothing on the page can change |
| SQ-3 | Keep the `boost-reconcile` and `boost-reconcile-*` test ids on the Jobs page, so the moved assertions are literally the same? | Yes; the notice gets the new id `reconcile-notice`, since `boost-notice` stays with the top-ups block's cap actions |
| SQ-4 | The dialog keeps `!text-slate-300` on its description and stays out of the L-1b dialog-class block (G-10), rather than switching to `ADMIN_DIALOG_DESCRIPTION_CLASS` (`!text-slate-400`). Agreed? | Yes: a money dialog, unchanged markup; slate-300 passes contrast |
| SQ-5 | Add `clientLogger` warn and error on a failed run, which the old dialog swallowed? | Yes: no request change, matches the Jobs dialogs, satisfies the logging rule |
| SQ-6 | The notice under the trigger inside the Job cell, rather than a page-level line above the table? | In the cell: next to the button that produced it |
| SQ-7 | The drawer pointer shows on every account, own account included, and only when the top-ups read succeeded (as the button did)? | Yes on both |
| SQ-8 | Reuse `tests/admin/drawerPinHarness.ts` for a Jobs test, though its name says drawer? | Yes, unedited; renaming is not this slice's job |
| SQ-9 | The pin move covers both `businessDrawer.pins.boost` (REC-1 to REC-3) and `boostBlock.actions` (the older cases), reading §1.3 "BD-6 copy and move" as permitting both. Agreed? | Yes |
| SQ-10 | Browser check QB-4: may QA open the dialog and press Close on the deployed or local page? | Yes, with Network open and never Run now |

---

## Questions for the user

None. Q-1 is answered (a); every open point above is technical.

---

## SA conditions applied

| # | Applied as |
|---|---|
| SA-W1 | `RECONCILE_COPY.title` is `Reconcile top-ups now`; REC-1's heading row re-marked BD-6 copy, deliberate; MC20 added |
| SA-W2 | The description is SA's exact sentence (dialog and copy file section); the moved case's `toContain('not recorded as a run')` holds |
| SA-W3 | JREC-T1 pins the registry's schedule and `scheduleWords` and that the description says `05:41 UTC`, with the comment |
| SA-W4 | The REC fixture gives `bos-billing-reconcile` a recorded last run; each REC test first asserts `last-run-outcome` exists in that row, then that it and the row's `status-badge` read the same before and after the press |
| SA-W5 | G-4 uses the 7b/7c method regex (counts GET too) and requires exactly `["method: 'POST'"]` and exactly the one fetch argument; `PURPOSE_ACTIONS` stays one contiguous literal |
| SA-W6 | G-6's word bans apply to `reconcileCopy.ts` too; `reconcileCopy.ts` joins the green-class check beside `jobsFormat.ts` |
| SA-W7 | G-7 carries the checks lost from `users/__tests__/source.guard`: alias import of `ADMIN_DIALOG_CLASS`; exactly one `<DialogContent`, passing it; `<DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>` once; no `DARK_DIALOG`, no `!bg-`; exactly one `<DialogTrigger asChild>` |
| SA-W8 | Only the view imports the registry type, with the statement form `import type { BosCronJobId } from '@/lib/cron/bosCronJobs';`; the dialog and copy import nothing from `@/lib/cron` (G-7 checks the dialog's imports) |
| SA-W9 | Step 10 splices the title, the final description, the two-suite move, the re-read change and REC-0 into the requirement (BD-6, §13.3 SA-C2/SA-C3, Change History) |
| SA-W10 | QB-4 rewritten with the Network-first, mouse-only, zero-requests rule |
| Suggestion 1 | Link words in `boostCopy` (`reconcilePointerLink`); `import Link from 'next/link'` in `BoostBlock` |
| Suggestion 2 | MC21 (notice not cleared on reopen) and MC22 (`className={ADMIN_DIALOG_CLASS}` removed) added |
| Suggestion 3 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` row 102 gains a one-line note that the button lives on Scheduled jobs & queues since LF-4c |

---

## Task List

- [x] ✅ Step 0: SA approved this workplan with SA-W1 to SA-W10; conditions and the three suggestions applied ("SA conditions applied")
- [x] ✅ Step 1: baseline on the branch before any edit: `app/admin/users`, `app/admin/components`, `app/admin/__tests__`: 57 suites, 1,573 tests, all green
- [x] ✅ Step 2: create `reconcileCopy.ts` (moved words, deliberate edits per SA-W1, SA-W2)
- [x] ✅ Step 3: create `ReconcileTopUpsDialog.tsx`
- [x] ✅ Step 4: `JobsQueuesView.tsx`: `RECONCILE_JOB_ID`, the row block, the header sentence and comment
- [x] ✅ Step 5: `BoostBlock.tsx` and `boostCopy.ts`: remove, pointer; `git rm` `BoostReconcileDialog.tsx`
- [x] ✅ Step 6: create `jobsQueues.reconcile.render.test.tsx` (moved REC-1 to REC-3, moved older cases, JREC tests)
- [x] ✅ Step 7: drawer tests: REC-0, pin file clean-up, `boostBlock.actions`, T-A2, users `source.guard`
- [x] ✅ Step 8: Jobs guard amendment G-1 to G-10; `jobsQueues.render`, `jobsQueues.layout` and `jobsQueues.retry` deliberate edits; contrast walk; `layoutFolder.guard` comments
- [x] ✅ Step 9: run set; mutations MC1 to MC22; results in Implementation Notes
- [x] ✅ Step 10: requirement updated (§1 LF-4c row, SA-W9 records in BD-6 and §13.3, Change History); access doc row 102 note; hand to SA code review

---

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-13**
**Status:** APPROVED WITH CONDITIONS (SA-W1 to SA-W10). No code is written until the conditions are folded into this workplan; none of them needs a second SA pass on the workplan, they are checked at code review.

#### What was verified against the code (branch at `567d7f50`)

| # | Claim | Result |
|---|---|---|
| V-1 | The request today: `fetch(RECONCILE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })`, `inFlight` ref with early return, close refused while in flight, success only on `response.ok && body?.success === true` and `reconcileOutcome` returning lines (`passesFailed > 0` is null) | Confirmed in `BoostReconcileDialog.tsx` and `boostCopy.ts:61-69`. Inlining `RECONCILE_URL` as the same literal changes nothing on the wire: `fetch` receives the identical string. The harness's `requestOf(p, true)` compares URL, method, headers, `cache` and raw body, so REC-1 to REC-3 prove it |
| V-2 | The nightly run is at 05:41 UTC | Confirmed twice: `lib/cron/bosCronJobs.ts` (`schedule: '41 5 * * *'`, `scheduleWords: 'Daily at 05:41 UTC'`) and `vercel.json` (`/api/cron/bos-billing-reconcile`, `41 5 * * *`) |
| V-3 | The admin route runs the top-ups pass only | Confirmed: `runReconcilePasses([boostReconcilePass], …)`. The cron runs `RECONCILE_PASSES`, today `[boostReconcilePass]` only; P-8b appends the plans pass there, not to the admin route |
| V-4 | A press is not recorded as a run | Confirmed: the cron route is `withCronRunRecord('bos-billing-reconcile', runJob)`; the admin route never calls it, and `reconcilePassRunner.ts` writes no `bos_cron_runs` row. A press IS recorded in the audit trail (`BOS_BOOST_RECONCILE_TRIGGERED`, system entity), which the copy does not deny |
| V-5 | Nothing else imports `BoostReconcileDialog` or the reconcile keys | Confirmed by grep over `app`, `lib`, `components`, `tests`, `scripts`: only `BoostBlock.tsx`, `boostCopy.ts`, the two drawer test files, `users/__tests__/source.guard.test.ts` (dialog list) and a comment in `layoutFolder.guard.test.ts`. Deleting the file is safe once those are edited as planned |
| V-6 | The 7b and 7c header checks pass unedited with the proposed sentence | Confirmed by reading the guard: the sentence has exactly one "Drain", contains "can be retried", and has no capital-word Retry, Cancel or Requeue. The FILES rule strips `VIEW_HEADER_SENTENCE` before its word scan, and `<ReconcileTopUpsDialog />` matches none of `Retry|Requeue|Cancel|Drain`, has no method key and no "OK". The 7d "Drain exactly once" and "one fetch" checks on the view also hold |
| V-7 | `import type { BosCronJobId } from '@/lib/cron/bosCronJobs'` is allowed | Confirmed: `runtimeImports` skips `import type` statements (negative lookahead on `type`), and `DrainNowDialog.tsx:41` already imports `BosQueueId` from the same module this way. See SA-W8 for the one form that would fail |
| V-8 | The view keeps rows mounted across a Refresh or a drain re-read | Confirmed: `view` is kept during `load()` and rows are keyed by `job.id`, so the dialog's in-flight state and its notice survive a page re-read; the view has no polling |
| V-9 | `clientLogger` adds no request | Confirmed: `lib/logger/client.ts` has no `fetch` or beacon. REC tests that fail on any unexpected request stay valid |

#### Rulings on SQ-1 to SQ-10

| # | Ruling |
|---|---|
| SQ-1 | **Title changes to "Reconcile top-ups now"**, a second named deliberate copy edit under BD-6. Reason: SA-C2 exists so the press does not read as a run of the job; a title "Run billing reconcile now" under a button that is deliberately not "Run now" reintroduces exactly that reading. The confirm button stays "Run now" (it confirms this dialog's action, unchanged per §1.3). **Description: the SA wording in SA-W2**, not the proposed one. See SA-W1 and SA-W2 |
| SQ-2 | **Agreed.** No page re-read: the press writes no `bos_cron_runs` row and touches no queue. The REC re-read assertion becomes "jobs GET count stays 1, no other read", which is stricter than the drawer's (any extra read is an unexpected request). It must not be vacuous: SA-W4 |
| SQ-3 | **Agreed.** Keep `boost-reconcile` and every `boost-reconcile-*` id so the moved assertions are literally the same; the notice gets `reconcile-notice` because `boost-notice` stays with the cap actions |
| SQ-4 | **Agreed.** The description keeps `!text-slate-300` (a money dialog's markup is not restyled in a move) and the file stays out of the L-1b three-dialog block. The checks it loses from `users/__tests__/source.guard` move into G-7: SA-W7 |
| SQ-5 | **Agreed**, with limits: child module `AdminReconcileTopUpsDialog`; `warn` on a failed outcome logs `{ status: response.status }` and, only when it is a number, `passesFailed`; the `catch` logs `{ err }`. Never the body, `error`, `details` or `message`. Not a behaviour change under §1.3 (nothing the admin sees or the server receives changes) |
| SQ-6 | **Agreed.** The notice under the trigger, in the Job cell |
| SQ-7 | **Agreed on both.** The pointer shows on every account (a link, not a money action, so PIN-h holds) and only when the top-ups read succeeded, as the button did |
| SQ-8 | **Agreed.** Reuse `tests/admin/drawerPinHarness.ts` unedited; the Jobs test's header says why a drawer-named harness is used. Renaming it is not this slice's job |
| SQ-9 | **Agreed, and recorded as a ruling (see "BD-6 names only boostBlock.actions" below).** Both suites' reconcile cases move |
| SQ-10 | **Agreed: read-only and acceptable**, on the deployed page or locally, under SA-W10. Opening the dialog is client state only (no request on open), and Close calls the refusing `onOpenChange`, which sends nothing. Even an accidental Run would be the same idempotent, row-locked, audited pass the nightly job runs (route header, SA Q-5), but it remains forbidden: it reaches Stripe and real purchases |

#### BD-6 names only `boostBlock.actions`: ruling

BD-6 and SA-C3 were written before LF-4a.1 existed, so they name the only reconcile suite of the time. **REC-1 to REC-3 move under §1.3 and BD-6.** Reasons: §1.3's reconcile row already says the action lives on Scheduled jobs & queues after LF-4c; PIN-e, PIN-f and PIN-g are properties of the action (request, single send, refused close, `passesFailed` failure), not of the drawer, so they must follow it; and §1.3 lets LF-4c edit those tests "where the opener's position changes, plus BD-6 copy and move". Leaving REC-1 to REC-3 in the drawer would pin a button that no longer exists there. What may change in them is exactly the workplan's assertion table plus SA-W1 (title): the BD-6 label, title and description, the locators, and the re-read assertion (part of the move: the Jobs page has no top-ups list). Nothing about the request, the confirm step, the single send, the refused close, or the failure path is edited. REC-0 is added on the drawer side, and PIN-h stays unedited (its zero-count checks stay true and, with REC-0, now guard against the button coming back). Recorded in the requirement by SA-W9.

#### Pin-move review (check 4)

Walked the assertion table against `businessDrawer.pins.boost.render.test.tsx:578-656` and `boostBlock.actions.render.test.tsx:277-349`. Every row is either unchanged, a locator, or a named BD-6 copy edit; none is weakened:
- REC-2's "drawer stays open" is replaced by "the row is still in the document"; the assertion that mattered (Escape refused, same dialog element) is kept.
- The older case's `not.toContain(ACCOUNT)` is dropped, but `toBe('{}')` already implies it; G-5 and G-6 add a source-level ban on account names.
- The older case's `toBe(BOOST_ACTION_COPY.reconcileDescription)` becomes `toBe(RECONCILE_COPY.description)`, which compares the copy with itself; it is acceptable only because REC-1 pins the exact sentence. Keep both.
- REC-0 is sound: it fails if the button, the dialog or any button named like "reconcile" returns to the drawer, and the pin file's `routePost` losing its reconcile branch makes any drawer reconcile POST an unexpected request in every test.

#### Deliberate Jobs test edits (check 5)

Justified. SA-C3 names "the jobs button count and render pins edited deliberately"; the `PURPOSE` constant must follow `PURPOSE_ACTIONS` or the layout header test fails for the right reason. The button-count rewrite is stricter than today (exactly one reconcile button, in one row, none in any other row).

#### Size (check 9)

About 1.5 days for 2 product files created, 3 modified, 1 deleted, 1 test file created and about 10 edited, 19 mutations. Within SA's 2-day estimate and proportionate for a money action moving pages. No re-slice.

### Conditions

| # | Condition | Where |
|---|---|---|
| SA-W1 | Dialog title becomes `Reconcile top-ups now` (`RECONCILE_COPY.title`). REC-1's heading row in the assertion table is re-marked **BD-6 copy, deliberate**. Add a mutation MC20: title reverted, REC-1 fails | copy file, pin table, mutations |
| SA-W2 | Description, exact words (SA ruling on SQ-1): "This checks Stripe for unfinished credit top-ups of every business. It may add credits, close expired checkouts or mark failed payments, exactly as the nightly run at 05:41 UTC does for top-ups. A press is not recorded as a run of the Billing reconcile job: its last run and counts stay as they are." Reason: "that job's row does not change" is not strictly true; the status ages with time and a Refresh after the nightly run changes the row. The moved case's `toContain('not recorded as a run')` still holds | `reconcileCopy.ts`, REC-1, moved case |
| SA-W3 | The copy cannot import the registry, so pin the time it states: JREC-T1 also asserts `findBosCronJob('bos-billing-reconcile')` has `schedule` `'41 5 * * *'` and `scheduleWords` `'Daily at 05:41 UTC'`, and that `RECONCILE_COPY.description` contains `05:41 UTC`, with a comment that a schedule change must update the copy | JREC-T1 |
| SA-W4 | The "last run unchanged" assertion must not be vacuous: the REC-1 to REC-3 fixture gives the Billing reconcile row a recorded last run (a `CronRunSummaryRow` for `bos-billing-reconcile`), and each test first asserts `last-run-outcome` exists in that row, then that its text and the row's `status-badge` text are the same before and after the press | REC-1 to REC-3 |
| SA-W5 | G-4 uses the 7b/7c method check (the same regex as the Cancel and Retry dialog blocks, which also counts a GET method key) and requires its matches to equal `["method: 'POST'"]`, and the fetch-argument list equal to exactly `["'/api/admin/business-os/credits/boost/reconcile'"]`. `PURPOSE_ACTIONS` stays one contiguous string literal (no concatenation), or the view's `toContain(VIEW_HEADER_SENTENCE)` and the FILES strip break | Jobs guard, view |
| SA-W6 | The word rules follow the words: G-6's bans (Retry, Requeue, Cancel, Drain as capital words; "OK"; `userId`, `accountId`, `ownerUserId`, `user_id`) apply to `reconcileCopy.ts` as well as the dialog, and `reconcileCopy.ts` joins the green-class check beside `jobsFormat.ts` | Jobs guard |
| SA-W7 | G-7 carries every check the file loses from `users/__tests__/source.guard`: `ADMIN_DIALOG_CLASS` imported from the alias, exactly one `<DialogContent` and it passes `className={ADMIN_DIALOG_CLASS}`, `<DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>` once, no `DARK_DIALOG`, no `!bg-`; plus exactly one `<DialogTrigger asChild>` | Jobs guard |
| SA-W8 | The registry type is imported with the statement form `import type { BosCronJobId } from '@/lib/cron/bosCronJobs';` only in the view. The inline form `import { type BosCronJobId }` counts as a runtime import for the guard and fails C-21; the dialog and copy files import nothing from `@/lib/cron` at all | view, dialog |
| SA-W9 | Step 10 splices into the requirement (BD-6 and SA-C3 in §13.3, plus Change History): the title edit (SA-W1), the final description (SA-W2), that the move covers both `businessDrawer.pins.boost.render` (REC-1 to REC-3) and `boostBlock.actions.render`, that the re-read assertion change is part of the move, and the new REC-0 | requirement |
| SA-W10 | QB-4 (SQ-10): Network panel open and filtered to `reconcile` before the dialog opens; dismiss with a mouse click on Close (or Escape); never press Enter or Space while the dialog is open (a focused Run would fire); record in the QA report that zero requests to the reconcile URL were made. Any POST seen is reported to TL at once | QA browser checks |

### Optimisation Suggestions (not blocking)

- Put the link words "Scheduled jobs & queues" in `boostCopy` beside `reconcilePointer`, so REC-0 can read both from copy. `BoostBlock.tsx` needs a new `import Link from 'next/link'` (precedent: `BusinessOsPanel.tsx`).
- Mutations worth adding cheaply: JREC-F2's notice not cleared on reopen; G-7's `className={ADMIN_DIALOG_CLASS}` removed.
- `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` row 102 ends "The button is slice 6's"; a one-line note that the button lives on Scheduled jobs & queues since LF-4c would keep that doc honest. Optional, docs only.
- Watch the drawer tests that check the top-ups block's order (T-A2, T-A3) when the pointer becomes the block's last child; the full Businesses run set already covers it.

### Approval
[x] Workplan approved with conditions SA-W1 to SA-W10 — proceed to implementation once they are folded in

### SA Code Review

**Code Review by SA — 2026-10-13**
**Status:** APPROVED WITH FIXES (F1 to F3, test or doc only; no product file changes). Code Approved for QA: **Yes**, in parallel with the fixes.

#### What was verified

| # | Check | Result |
|---|---|---|
| CR-1 | Request byte-identical to HEAD's deleted `BoostReconcileDialog.tsx` (`git show HEAD:…`) | ✅ Same `fetch` options object, token for token: `method: 'POST'`, `headers: { 'Content-Type': 'application/json' }`, `body: '{}'`, `cache: 'no-store'`. The URL is the same string, inlined instead of the `RECONCILE_URL` constant. Same `inFlight` ref with early return, same `response.json().catch(() => null)`, same success test `response.ok && body?.success === true`, and the same `reconcileOutcome` body (moved verbatim, `passesFailed > 0` still null). Close refusal while in flight: same `handleOpenChange` guard. The old `useEffect` error clear on open is now done in `handleOpenChange(true)`; Radix's `DialogTrigger` routes through it, so behaviour is the same (but see F2) |
| CR-2 | SA-W1 title | ✅ `RECONCILE_COPY.title` is `Reconcile top-ups now`; REC-1 pins it |
| CR-2 | SA-W2 description | ✅ Exact SA sentence in `reconcileCopy.ts`; REC-1 pins it with `toBe` |
| CR-2 | SA-W3 JREC-T1 | ✅ `schedule` `'41 5 * * *'`, `scheduleWords` `'Daily at 05:41 UTC'`, label, and the copy's `05:41 UTC`, with the comment |
| CR-2 | SA-W4 non-vacuous last run | ✅ The fixture gives the Billing reconcile row a real run (90 min ago, 4.2 s); REC-1 asserts `toContain('4.2 s')` before comparing `rowFacts` before and after; REC-2 and REC-3 compare the same facts. `getByTestId('last-run-outcome')` would throw if the cell were absent |
| CR-2 | SA-W5 G-4 | ✅ Method regex counts GET too and must equal `["method: 'POST'"]`; fetch-argument list must equal the one literal. `PURPOSE_ACTIONS` is one contiguous literal |
| CR-2 | SA-W6 G-6 | ✅ The word and account bans run on both `ReconcileTopUpsDialog.tsx` and `reconcileCopy.ts` (`it.each`); `reconcileCopy.ts` joins the green-class check |
| CR-2 | SA-W7 G-7 | ✅ Alias import of `ADMIN_DIALOG_CLASS`, one `<DialogContent` passing it, one `<DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>`, no `DARK_DIALOG`, no `!bg-`, one `<DialogTrigger asChild>`; plus an exact import list (stricter than asked) |
| CR-2 | SA-W8 | ✅ The view has the statement form `import type { BosCronJobId } from '@/lib/cron/bosCronJobs';`; G-9 pins it and bans the inline `import { type` form; the dialog's exact import list has nothing from `@/lib/cron`; the copy file has no imports (G-8) |
| CR-3 | Pin moves | ✅ Read REC-1 to REC-3 and the 6 `boostBlock.actions` cases (8 runs) side by side with HEAD. Every edit is one of: the BD-6 label, title or description; a locator (`job-bos-billing-reconcile` for `boost-block`, `reconcile-notice` for `boost-notice`, "row is the same element" for "drawer stays open"); or the re-read count (`expectReads({ credits: 1, boost: 2, list: 1 })` to "jobs GET stays 1" plus row facts unchanged). `RECONCILE_OK` and `RECONCILE_POST` are byte for byte. The `requestOf(p, true)` comparisons, the double-click single send, Running…, Close disabled, Escape refused, the `passesFailed: 1` failure words, and the second-run `[RECONCILE_POST, RECONCILE_POST]` are unchanged. The dropped `not.toContain(ACCOUNT)` is implied by `toBe('{}')` (as ruled). The `toBe(RECONCILE_COPY.description)` self-comparison is backed by REC-1's literal |
| CR-3 | REC-0 | ✅ Sound: no `boost-reconcile`, no dialog, no button named `/reconcile/i` in the drawer; pointer text and `href` exact; `posts()` empty and reads unchanged. The pin file's `routePost` lost its reconcile branch, so any drawer reconcile POST is an unexpected request in every test of the file |
| CR-3 | PIN-h | ✅ `businessDrawer.pins.credits.render.test.tsx` is not in the diff |
| CR-4 | Deviation 1 (U-12) | ✅ Justified. U-12 pins the full header sentence by `toContain`; the sentence changes by design (G-3), so U-12 had to follow, exactly like the layout `PURPOSE` constant SA-C3 already allowed. The 7c retry clause and the "no Retry item" assertion are unchanged. Process note only: the workplan's grep missed this third copy of the sentence. Deviations 2 to 5 accepted |
| CR-5 | SQ-5 logging | ✅ In code: `warn` logs `{ status, passesFailed }` (number only, else undefined), `error` logs `{ err }`; child module `AdminReconcileTopUpsDialog`. No body, `error`, `details` or `message` field is logged. Not pinned by any test: see SA-M1 and F1 |
| CR-6 | Leftover importers | ✅ Grep over `app`, `lib`, `components`, `tests`, `scripts`, `hooks`, `types`: no import of `BoostReconcileDialog` and no use of the removed `boostCopy` keys or functions; only comments name the old file |
| CR-7 | `console.*` and `any` | ✅ None in the five product files; ESLint on the eight changed product and test files is clean |
| CR-8 | Dead code | ✅ The trimmed test files still use every remaining import (`act`, `deferred`, `JSON_HEADERS`, `posts`, `requestOf`) |
| CR-9 | Run | ✅ 30 suites, 1,061 tests green (all Jobs suites, the drawer boost pins, `boostBlock.actions`, `businessDrawer.money`, users `source.guard`, the contrast walk, the layout folder) |

#### SA mutations (applied, run, restored by SHA-256: OK both times)

| # | Mutation in `ReconcileTopUpsDialog.tsx` | Result |
|---|---|---|
| SA-M1 | `logger.warn({ status, passesFailed, body }, …)`: the response body logged | **Survived** (8 Jobs suites, 239 tests green). The SQ-5 limit has no pin. F1 |
| SA-M2 | `setError(null)` removed from `handleOpenChange(true)`: a failure's words stay on the next opening | **Survived**. The drawer never needed this pin: it unmounted the dialog on close. On Jobs the dialog stays mounted, so the clear-on-open is now the only thing that stops an admin from seeing a stale "could not run" over a fresh confirm step. F2 |

#### Fixes

1. **F1 (Medium, test only), `app/admin/__tests__/jobsQueues.source.guard.test.ts`, LF-4c describe: pin SQ-5.** Every `logger.` call in `ReconcileTopUpsDialog.tsx` passes an object literal whose keys are only `status`, `passesFailed` or `err`; no `body` identifier is passed to a logger call. SA-M1 must then bite.
2. **F2 (Low, test only), `app/admin/__tests__/jobsQueues.reconcile.render.test.tsx`: JREC-F4.** A failed run (REC-3's `passesFailed: 1`), Close, open again: no `boost-reconcile-error`, Run says `Run now`, and nothing was sent by the reopen. SA-M2 must then bite.
3. **F3 (Low, doc only), `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` §1 LF-4c row and this workplan's Branch line:** say #349 (LF-4b) has merged and that RM merges `origin/main` into this branch before the PR; both still say "#349 open".

**Fixes applied (Dev, 2026-10-13), tests and docs only; no product file changed:**
- F1: `jobsQueues.source.guard`, LF-4c describe, new test G-11 (SA F1): every `logger.` call in the dialog is `logger.x({ … }, '…')` with keys only `status`, `passesFailed`, `err`, the number of matched calls equals the number of `logger.` occurrences, and no `body` identifier in any call. **SA-M1** (`body` added to the warn call): **bites**, G-11 fails; file restored, SHA-256 matches.
- F2: `jobsQueues.reconcile.render`, new JREC-F4: failed run (`passesFailed: 1`), Close, reopen: no `boost-reconcile-error`, Run reads `Run now` and is enabled, one POST in total (the reopen sent nothing) and no Jobs re-read. **SA-M2** (`setError(null)` removed from the open branch of `handleOpenChange`): **bites**, JREC-F4 fails; file restored, SHA-256 matches.
- F3: the Branch line above and the requirement §1 LF-4c row now say #349 is merged (`ffb598ac`) and that RM merges `origin/main` before the PR.

#### Ruling on the `test:bos-entitlements` flake (check 8)

**Not in this slice; LF-4d takes it as a named first item.** `businessDetail.render` and `businessesLayout.render` are not touched by LF-4c, and LF-4a.2 F2 raised a wait only because that slice already edited the file. Keeping a money slice's diff free of unrelated test edits keeps its review honest. LF-4d applies the LF-4a.2 F2 shape to both files: `jest.setTimeout(30_000)` and `configure({ asyncUtilTimeout: 5000 })` at file level, with the pin files' comment (both are needed: a 5 s wait inside the default 5 s test timeout only moves the failure). **One exception:** if this PR's required Jest gate fails in either suite, do not re-run blindly; apply that same test-only change here as its own commit, named in the PR body.

#### Optimisation Suggestions (not blocking)

- The notice maps lines with `key={line}`; the sentences are distinct today, so this is fine, but an index key would never warn if two lines ever matched.

### Code Approved for QA: Yes (F1 to F3 before RM; no SA re-review needed if SA-M1 and SA-M2 are shown to bite)

---

## Implementation Notes

**Built by Dev, 2026-10-13. Uncommitted** (per the standing rule: the user sees the diff first). `BoostReconcileDialog.tsx` is removed with `git rm`; the three new files are marked intent-to-add (`git add -N`) so `git diff --numstat HEAD` shows them. No stash, no reset. The other worktree was not touched.

### Files

| File | Change |
|---|---|
| `app/admin/components/jobs/ReconcileTopUpsDialog.tsx` | new: the moved dialog, own `DialogTrigger`, `open`, `busy`, `error`, `notice` state; the request byte-identical with the URL inlined; `clientLogger` warn (status, numeric `passesFailed`) and error (`{ err }`) per SQ-5 |
| `app/admin/components/jobs/reconcileCopy.ts` | new, no imports: `RECONCILE_COPY` (button, title, description, run, running, failed), `reconcileOutcome`, `reconcileSentences` (bodies unchanged) |
| `app/admin/components/jobs/JobsQueuesView.tsx` | `import type { BosCronJobId }`, `RECONCILE_JOB_ID`, the dialog in the Job cell of the Billing reconcile row, header sentence, header comment |
| `app/admin/users/components/BoostBlock.tsx` | button, state, mount and import removed; `import Link from 'next/link'`; the own-account sentence kept; pointer line `boost-reconcile-pointer` last in the `ok` branch; header comment |
| `app/admin/users/boostCopy.ts` | reconcile keys and the two functions removed; `reconcilePointer`, `reconcilePointerLink` added |
| `app/admin/users/components/BoostReconcileDialog.tsx` | deleted (`git rm`) |
| `app/admin/__tests__/jobsQueues.reconcile.render.test.tsx` | new: REC-1 to REC-3 (moved), 6 moved cases (8 runs), JREC-P1, P1b, P2, F1, F2, F3, T1: 17 tests |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | the LF-4c amendment: header paragraph, constants, `CLIENT_FILES`, `VIEW_HEADER_SENTENCE`, green check on the copy file, new describe (G-4 to G-9 and a self-test) |
| `app/admin/__tests__/jobsQueues.render.test.tsx` | button count `1 + 5 + 5 + 1`, the reconcile button in its row only; header comment |
| `app/admin/__tests__/jobsQueues.layout.render.test.tsx` | `PURPOSE` constant |
| `app/admin/__tests__/jobsQueues.retry.render.test.tsx` | U-12's header-sentence string (**deviation**, below) |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | walk expectation gains the two new files |
| `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx` | REC-1 to REC-3 removed (moved), the reconcile route, queue and fixtures removed, REC-0 added, header comment |
| `app/admin/users/__tests__/boostBlock.actions.render.test.tsx` | reconcile describe removed (moved), the `reconcile` route option removed, the buttons test asserts the pointer, own-account test asserts the pointer too |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | T-A2: no reconcile button; nothing in the block follows the pointer |
| `app/admin/users/__tests__/source.guard.test.ts` | dialog list drops the deleted file (comment says where its checks went) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | comments only |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | row 102: one sentence on the new home (SA suggestion 3) |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | §1 row, BD-6 and §13.3 SA-W9 records, Change History |

### Pin moves made

As the assertion table in "Moving REC-1 to REC-3", with SA-W1 and SA-W4. Edits beyond copying:

- REC-1: opener label, dialog title, description (BD-6, deliberate); opener checked inside `job-bos-billing-reconcile` instead of `boost-block`; notice read from `reconcile-notice` in the row; "one top-ups re-read" became "jobs GET stays 1", and the row's `last-run-outcome` and `status-badge` read the same before and after, the run being a real recorded one (90 minutes ago, 4.2 s; the test first asserts the cell contains `4.2 s`, SA-W4).
- REC-2: "the drawer stays open" became "the row is the same element, still on the page"; reads and row facts as REC-1.
- REC-3: "no notice" reads `reconcile-notice`; reads and row facts as REC-1. The request comparisons (`[RECONCILE_POST]`, `[RECONCILE_POST, RECONCILE_POST]`) are byte for byte the drawer's.
- Moved older cases: `not.toContain('not only this one')` plus `toContain('every business')` and `toContain('not recorded as a run')`; `BOOST_ACTION_COPY.reconcileDescription` and `.reconcileFailed` read from `RECONCILE_COPY`; `boost-notice` reads `reconcile-notice`; `not.toContain(ACCOUNT)` dropped (`toBe('{}')` kept, SA check 4).
- PIN-h (credits pin file) unedited.

### Verification

| Run | Result |
|---|---|
| Baseline before any edit: `app/admin/users`, `app/admin/components`, `app/admin/__tests__` | 57 suites, 1,573 tests, green |
| Same set after the build | **58 suites, 1,595 tests, green** |
| Authz guard, Tailwind escape guard, `creditBands` (guard and unit), `creditFigures.fromConfig` | 5 suites, 288 tests, green |
| `npm run test:bos-entitlements -- --maxWorkers=4` | **253 suites, 7,363 tests, green** (two default-worker runs flaked under load, note below) |
| `npm run lint:hooks` | clean (exit 0) |
| Scoped `tsc` (users, jobs, layout, Jobs tests, harness) with a canary | canary run fails on the canary only (TS2322), proving the scope type-checks; clean run exit 0 |

**Load note on `test:bos-entitlements`.** Two full runs each had one or two failures, in different tests each time, all whole-page renders in `businessDetail.render` and `businessesLayout.render` waiting with the default 1 s `findBy` while the machine ran 253 suites (and the other worktree is building). Neither suite touches the reconcile; both pass alone (59 tests) and inside the 58-suite admin run. A third run with `--maxWorkers=4` was fully green (253 / 7,363).

### Mutation runs

Runner: a scratchpad script; each mutation is an exact string replacement that must hit once; the named suites run; the file is written back from the in-memory original and its SHA-256 compared. All four product files were also checked against a `sha256sum` taken before the run: all OK.

| # | Mutation | Bites (failing tests) |
|---|---|---|
| MC1 | body `'{"all":true}'` | G-5; REC-1, REC-2, REC-3, the moved "covers every business" case |
| MC2 | header removed | G-5; REC-1 to REC-3 |
| MC3 | `cache` removed | G-5; REC-1 to REC-3 |
| MC4 | method `PUT` | G-4; REC-1 to REC-3, two moved cases |
| MC5 | `inFlight` early return removed | REC-2 |
| MC6 | close refusal removed | REC-2, JREC-F3 |
| MC7 | Close not disabled while busy | REC-2 |
| MC8 | `passesFailed` check removed | REC-3 |
| MC9 | description reverted | REC-1, moved "covers every business" |
| MC10 | button label reverted | `jobsQueues.render` button test, REC-1 |
| MC11 | button in every row | G-9, `jobsQueues.render` button test, JREC-P2 |
| MC12 | a jobs re-read after success | G-4; REC-1 to REC-3 |
| MC13 | `@/lib/business-os/currency` import in the copy | G-8 |
| MC14 | header sentence changed in the view only | Jobs guard (FILES strip, the "Drain once" check), layout `PURPOSE` |
| MC15 | an extra fetch on open | G-4; 13 render tests (unexpected request) |
| MC16 | reading `.error` from the body | G-6 server-text rule |
| MC17 | old button put back in `BoostBlock` | REC-0, T-A2, both `boostBlock.actions` button tests |
| MC18 | pointer removed | REC-0, T-A2, both `boostBlock.actions` button tests |
| MC19 | account id in the body | G-5, G-6; REC-1 to REC-3, moved case |
| MC20 | title reverted (SA-W1) | REC-1 |
| MC21 | notice not cleared on reopen | JREC-F2 |
| MC22 | `className={ADMIN_DIALOG_CLASS}` removed | G-7 |

22 of 22 bite; 22 of 22 restored by checksum.

### Deviations from the workplan

1. **`jobsQueues.retry.render.test.tsx` U-12 edited.** It also pins the full header sentence (a third purpose-sentence pin the workplan did not list). Edited deliberately to the new sentence, with a comment; the 7c retry clause is unchanged.
2. **Pointer link words** in `boostCopy` as `reconcilePointerLink` (SA suggestion 1, folded in before the build).
3. **JREC-P1 split** into P1 (placement, no button in the other cells) and P1b (runs unreadable, status Could not check, the button still shows).
4. **The Jobs test mocks `@/lib/logger/client`** silent, as the other Jobs tests do, so the harness's console guard sees only real warnings.
5. **Mutation IDs:** the TL message asks for "MC1..MC20 plus the 2 extra"; those are MC1 to MC22 here (MC20 is SA-W1's title mutation; MC21, MC22 the two SA suggestions).

---

## QA Testing Report

### QA Report

**QA — 2026-10-13**
**Test mode:** full
**Strategy used:** A + B (Jest render and source guards on the real page and drawer, with the shared recording fetch stub) plus throwaway probes. D (browser) not done by QA: QB-4 is TL's, per the trigger.
**Focus:** ui, security (money request), regression of the drawer money actions
**Skipped:** QB-1 to QB-6 browser checks (TL owns QB-4; the rest were not asked of QA)
**Input source:** prompt keywords (TL trigger)

**Verdict: PASS WITH NOTES.** No bugs. Two low notes below; neither blocks commit. The browser check QB-4 is still owed by TL.

#### Run counts (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-lf4c`, uncommitted)

| Run | Result |
|---|---|
| `npx jest app/admin/users app/admin/components app/admin/__tests__` | 58 suites, 1,595 tests, all green (matches Dev) |
| Guards: `admin-authz-surface.guard` + `security-definer-surface.guard` (the `test:authz-guard` pair), `tailwind-css-escape.guard`, `creditBands` (guard and unit), `creditFigures.fromConfig.guard` | 6 suites, 372 tests, all green. Dev's "5 suites, 288" left out `security-definer-surface.guard`; QA ran the whole `test:authz-guard` pair |
| `npm run lint:hooks` | exit 0 |
| `npm run test:bos-entitlements` (default workers) | 253 suites, 7,363 tests, all green, 224 s |
| `npm run test:bos-entitlements -- --maxWorkers=4` | 253 suites, 7,363 tests, all green, 200 s |
| Drawer money pins: `businessDrawer.pins.credits`, `.pins.boost`, `.pins.dangerReads`, `businessDrawer.money`, `boostBlock.actions` | 5 suites, 75 tests, all green |

**Flake check.** The 1 s `findBy` timeouts Dev saw in `businessDetail.render` and `businessesLayout.render` at default workers did **not** recur: both entitlements runs were fully green. The suite-level flake is load-related and does not touch the reconcile.

#### Probes (throwaway, deleted after the run)

`app/admin/__tests__/zzLf4cJobs.probe.test.tsx` (9 tests, all pass) on the whole Jobs page with the shared pin harness (any unknown request or console warning fails a test):

| # | Probe | Result |
|---|---|---|
| Q-J1 | Exactly one button named like "reconcile" on the whole page, text `Reconcile top-ups now (all accounts)`, inside the Billing reconcile row's first cell; none in any other job row or queue card | Pass |
| Q-J2 | Runs unreadable (status Could not check): the button is still there, exactly once, in the Job cell | Pass |
| Q-J3 | Title `Reconcile top-ups now`; description equals the SA-W2 sentence exactly; Close sends nothing (after a quiet window), focus back on the opener, jobs GET still 1 | Pass |
| Q-J4 | Escape when idle closes, sends nothing, focus back on the opener | Pass |
| Q-J5 | Two clicks plus a dblclick on Run send exactly one request, strictly equal to the pinned `{ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: '{}' }` | Pass |
| Q-J6 | In flight: Run and Close disabled; Escape (on the dialog and on the focused element), a Close click, and pointer-downs outside (body, the row) all leave the same dialog open; one POST; closes after the answer; focus not on body | Pass |
| Q-J7 | 200 with valid counts and `passesFailed: 2`: the failure line, no notice, no jobs re-read, the row's last run and status unchanged; Close returns focus to the opener; reopening clears the error; still one POST | Pass |
| Q-J8 | A network rejection, then a 200 with no JSON body: the failure line each time, Run re-enabled, two POSTs total, no notice, jobs GET still 1 | Pass |
| Q-J9 | Success shows the notice, focus on the opener (not body); reopening clears the notice; Escape without running leaves it cleared; jobs GET 1, row last run and status unchanged, one POST | Pass |

`app/admin/users/__tests__/zzLf4cDrawer.probe.test.tsx` (3 tests, all pass) on the whole Businesses page with the drawer open (route table knows no reconcile URL, so any reconcile POST fails the test):

| # | Probe | Result |
|---|---|---|
| Q-D1 | Another account, with a top-up and an active limit: no `boost-reconcile`, no reconcile dialog or notice, no button named like "reconcile" (new or old label); exactly one pointer, text `Reconcile top-ups for all accounts: Scheduled jobs & queues`, one link, `href` `/admin/jobs-queues`; no POST | Pass |
| Q-D2 | The admin's own account: same, the pointer and its `/admin/jobs-queues` link are present beside the own-account sentence; no POST | Pass |
| Q-D3 | Pressed every button in the top-ups block (Take back credits, Set limit, Back to default; each opened dialog dismissed with Escape): none is named like "reconcile", no reconcile POST and no POST at all | Pass |

#### Test Coverage

| Acceptance criterion (trigger and requirement BD-6, PIN-e/f/g, SQ-1 to SQ-7) | Tested? | Result | Notes |
|---|---|---|---|
| Button only in the Billing reconcile row's Job cell, also with runs unreadable | ✅ | Pass | JREC-P1, P1b, P2; Q-J1, Q-J2 |
| Title `Reconcile top-ups now`, exact SA-W2 description | ✅ | Pass | REC-1; Q-J3 |
| Close and Escape send nothing | ✅ | Pass | JREC-F1; Q-J3, Q-J4 |
| Run sends exactly the pinned request once, also on a double click | ✅ | Pass | REC-1, REC-2; Q-J5 |
| Cannot close while in flight | ✅ | Pass | REC-2, JREC-F3; Q-J6 |
| 200 with `passesFailed` above 0 shows the failure line | ✅ | Pass | REC-3 and the moved it.each; Q-J7 |
| Notice cleared on reopen | ✅ | Pass | JREC-F2; Q-J9 (error also cleared, Q-J7) |
| Focus returns to the button, never body | ✅ | Pass | JREC-F1; Q-J3, Q-J4, Q-J6, Q-J7, Q-J9 |
| No jobs re-read; row's last run and status unchanged | ✅ | Pass | REC-1 to REC-3 (SA-W4, non-vacuous); Q-J7, Q-J9 |
| Drawer: no reconcile button; pointer links to `/admin/jobs-queues` on every account incl. own | ✅ | Pass | REC-0, T-A2, `boostBlock.actions` own-account case; Q-D1, Q-D2 |
| Drawer: no reconcile POST can be sent | ✅ | Pass | pin route tables refuse it; Q-D3 |
| Give, Take back, Set limit and Back to default pins unchanged and green | ✅ | Pass | GIVE-1..5, TAKE-1..5, TOPUP-1..5, CAP-1..5, OWN-1 all pass; diff of the pin files touches only the reconcile block and T-A2's last-element check |
| Browser QB-4 (dialog opened on the real page, zero reconcile requests) | ⚠️ | Not run by QA | Owned by TL |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None.

#### Edge Cases (nice to fix)

1. **OWN-1 still names only the old label** — `businessDrawer.pins.credits.render.test.tsx` OWN-1 (PIN-h) checks zero buttons named `Run billing reconcile now (all accounts)` but not the new `Reconcile top-ups now (all accounts)`. Its `boost-reconcile` test-id count and REC-0 (another account) still catch a returning button, and Q-D2 confirmed the own-account drawer is clean, so this is cover drift, not a hole today. Severity: Low. Suggest adding the new label to OWN-1's name list in a later slice (pins are deliberately left unedited here).
2. **Guard count wording** — Implementation Notes' "5 suites, 288 tests" for the guards omits `security-definer-surface.guard`, which `npm run test:authz-guard` also runs (6 suites, 372 tests, green). Docs only. Severity: Low.

### Final Status

- [x] All acceptance criteria pass in Jest and probes — ready for commit once TL's QB-4 browser check is recorded
- [ ] Issues found — Dev must address before commit

`git status` after QA: only the Dev's 20 paths (19 modified or added, 1 deleted); both probe files removed, no `zz` file left.

---

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf4c` |
| Code commit | `5bc661da` feat(admin): reconcile top-ups moves from the Businesses drawer to Scheduled jobs & queues (LF-4c) |
| Merge of `origin/main` | `ecc9db37` (clean, no conflicts; brings #349, #350, #351, #352) |
| PR | [#354](https://github.com/AgentsPilot/neuronforge/pull/354), open, fast-track; the user merges |
| Runs after the merge | admin set + guards 63 suites / 1,854 tests; `test:bos-entitlements` 254 / 7,367; `lint:hooks` clean; `typecheck:bos-llm` passed (0 new) |
| Owed | QB-4 (TL browser check, read-only, never Run) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | QA report added | QA: PASS WITH NOTES, no bugs. Admin set 58 suites / 1,595 tests, guards 6 / 372, entitlements 253 / 7,363 at default and at 4 workers (no flake recurred), lint:hooks clean, 12 throwaway probes passed and deleted. Two Low notes (OWN-1 names only the old label; guard count wording). QB-4 owed by TL |
| 2026-10-13 | PR opened (RM) | Code commit `5bc661da`; `origin/main` merged in (`ecc9db37`, clean); PR #354 open, fast-track. Commit Info filled. QB-4 still owed |
