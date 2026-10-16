# Workplan: Admin Layout LF-9 (Jobs and Archive dialogs onto the shared confirmation dialog)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 LF-9 (user request 2026-10-16); later-adopter list in [ADMIN_LAYOUT_LF7_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF7_WORKPLAN.md) §9 and §14 LF3B-F1
**Branch:** `feature/admin-layout-lf9-shared-confirm-jobs-archive` (from `origin/main` `067c4a3e`)
**Path:** SA reviews this workplan (it changes a shared component and a pinned money dialog), then Dev builds, then SA code review, then user diff, then RM
**Date:** 2026-10-16
**Status:** Built, awaiting SA code review (uncommitted). Build results in §11

## Overview

LF-7 left five dialogs as "later adopters": four on Scheduled jobs & queues and the Archiving confirm. LF-9 checks each one against `AdminConfirmDialog` as it is today and migrates only those that fit without changing a request, a word or an in-flight rule. Result of the check: **one fits (Reconcile top-ups), with four small optional props; four stay as they are**, for reasons that are about what the dialog is, not about effort.

---

## 1. What AdminConfirmDialog is today

It owns only the asking: title, optional `children` inside a `<form>`, Cancel and Confirm (tone), focus on Cancel by default or `initialFocusRef`, one send per confirm (ref set before the await), no close in flight, focus back through `onReturnFocus` (no Radix trigger). `onConfirm` resolving `false` means "the dialog does not call `onClose`". No description (SA C-3: the first adopter that needs one adds it, with its test). The confirm keeps its words while busy and shows a spinner.

## 2. Per-dialog decision

| Dialog | Shape today | Mismatches with the shared dialog | Decision |
|---|---|---|---|
| `DrainNowDialog.tsx` | `DialogTrigger`; description; reason field; **after the request the result (counts and time) is shown inside the dialog**, the reason field and Confirm disappear and the dismiss changes from "Cancel" to "Close" | Result phase inside the dialog; busy label "Draining…" (pinned); description; Enter in the reason field would start a drain (the shared form submits on Enter; today it does not) | **Stays.** It is an ask-then-report dialog, not a confirmation. Fitting it would need a "result phase" in the shared component (hide Confirm, relabel Cancel), which breaks LF-7's "owns only the asking" |
| `CancelQueueItemDialog.tsx` | Same ask-then-report shape; refreshes the page on Close after an outcome; `aria-label` on the content; button test ids | Result phase; busy label "Cancelling…" (U-4); content `aria-label`; two button test ids; Enter would submit | **Stays**, same reason as Drain |
| `RetryQueueItemDialog.tsx` | Same shape as Cancel, plus the window note rendered between the trigger and the content | As Cancel, busy label "Retrying…" | **Stays**, same reason as Drain |
| `ReconcileTopUpsDialog.tsx` | `DialogTrigger`; description; no field; Run; on success the dialog closes and the counts show **under the button** (outside the dialog); on failure an error line shows inside and the dialog stays open; send-once ref; no close in flight | Opened by `DialogTrigger` (see §3); description; busy label "Running…" (REC-2 and "one run at a time"); button test ids `boost-reconcile-run` / `boost-reconcile-close` (read by every REC and JREC test) | **Migrates**, with four small optional props (§4). Its contract is exactly the shared one: success closes (`onConfirm` resolves void), failure stays open (resolves `false`) |
| `ArchiveConfirmDialog.tsx` | `DialogTrigger` with page-held `open`; description; facts list; busy comes from the page; "Not switched on yet" note under Confirm and its accessible description (G-4 pin); **no in-flight lock**: Escape and Cancel work during the POST | Migrating adds no-close-in-flight and a send-once ref, which changes the in-flight rules (forbidden by this slice); also needs a confirm-note prop and busy label "Archiving…" | **Stays.** The only way to fit it changes its in-flight behaviour (SQ-4 asks whether SA wants that as its own slice) |

## 3. Reconcile without DialogTrigger

The shared dialog has no trigger: the consumer owns `open` and returns focus by hand. For Reconcile that means:

- The opener stays the same `<button data-testid="boost-reconcile">` with the same classes and words, now a plain button with a `ref` and `onClick` that clears `error` and `notice` and opens (what `handleOpenChange(true)` does today).
- `onReturnFocus` focuses the opener ref. The opener never unmounts while the dialog is open (it lives in the job row, and the page does not re-read after a reconcile, SA-W4), so no fallback target is needed. JREC-F1 pins focus on the opener after Close and after a success, unedited.
- Initial focus: today Radix focuses the first focusable element, which is Close (no field, no error on open). The shared default is Cancel, here labelled Close. Same element.
- **Pins:** Jobs G-7 asserts exactly one `<DialogTrigger asChild>` and an exact import list containing `@/components/ui/dialog` and `@/components/ui/button`. Both must be edited (§6). What `DialogTrigger` gave (focus back to the button) stays pinned by the render test JREC-F1, unedited.

## 4. Shared API addition (all optional; Messages and Revoke unchanged)

| Prop | Why | Default |
|---|---|---|
| `description?: ReactNode` | Every one of the five has a description; Reconcile's is pinned word for word (REC-1). Rendered as `DialogDescription` inside the header with `ADMIN_DIALOG_DESCRIPTION_CLASS`. When given, `aria-describedby` is left to Radix (the content is described by it); when absent, it stays `undefined` as today (AC-1 unedited) | none |
| `busyLabel?: string` | In-flight words. All five dialogs change their confirm words while busy; Reconcile's "Running…" is pinned (REC-2 and "one run at a time"; JREC-F4 reads "Run now" after) | `confirmLabel` (today's behaviour) |
| `confirmTestId?: string`, `cancelTestId?: string` | Reconcile's tests find both buttons by test id; adding the props keeps every REC and JREC test unedited | none |

The header comment's "No description prop (SA C-3)" sentence is replaced by one naming LF-9 as the first adopter. No new import in the shared file (`DialogDescription` is from `@/components/ui/dialog`, the class from `./adminDialog`), so the layoutFolder S-3 allow-list does not change.

Reconcile mapping: `title` RECONCILE_COPY.title; `description` RECONCILE_COPY.description (see SQ-2 for its test id and colour); `cancelLabel` "Close"; `confirmLabel` RECONCILE_COPY.run; `busyLabel` RECONCILE_COPY.running; `tone` primary; `testId` "boost-reconcile-dialog"; `confirmTestId` "boost-reconcile-run"; `cancelTestId` "boost-reconcile-close"; `children` the error line (`boost-reconcile-error`, `role="alert"`, unchanged); `onConfirm` the existing fetch block unchanged byte for byte (URL, `method`, `headers`, `body: '{}'`, `cache: 'no-store'`, `.json(` read, `reconcileOutcome`, both logger calls), returning `false` with `setError(RECONCILE_COPY.failed)` on failure and void after `setNotice(lines)` on success. The local `inFlight` ref, `busy` state and `handleOpenChange` go: the shared dialog carries them.

## 5. Files

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/AdminConfirmDialog.tsx` | modify | four optional props (§4), header comment |
| `app/admin/components/layout/__tests__/AdminConfirmDialog.render.test.tsx` | modify (add only) | AC-15 to AC-17; existing cases unedited |
| `app/admin/components/jobs/ReconcileTopUpsDialog.tsx` | modify | renders `AdminConfirmDialog`; request block byte-identical; header comment updated |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | the two G-7 tests (§6) and an "Amended by LF-9" header note |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 row, Change History |

Not touched: the other three Jobs dialogs, `ArchiveConfirmDialog.tsx`, `reconcileCopy.ts`, `JobsQueuesView.tsx`, every route, `components/ui/*`, `adminDialog.ts`, the layoutFolder guard (Reconcile stays out of `MIGRATED_PAGES` because it still reads with `.json(`; no new shared file).

## 6. Guard and test edits

| Guard / test | Edit | Reason |
|---|---|---|
| Jobs G-7 imports (exact list) | becomes `@/app/admin/components/layout/AdminConfirmDialog`, `@/lib/logger/client`, `./reconcileCopy`, `react` (plus `@/app/admin/components/layout/adminDialog` only if SQ-2 keeps a local description class) | the file no longer imports `ui/dialog`, `ui/button` or the dialog classes |
| Jobs G-7 dialog classes + one `DialogTrigger asChild` | rewritten: exactly one `<AdminConfirmDialog` with `testId="boost-reconcile-dialog"`; no `@/components/ui/` specifier; no `<DialogTrigger`, `<DialogContent`, `DARK_DIALOG` or `!bg-`; exactly one `data-testid="boost-reconcile"` opener. The class check moves to where the class now lives (shared AC-1, unedited) | the trigger and content are no longer in this file; focus return stays pinned by JREC-F1 |
| Jobs G-4, G-5, G-6, G-8, G-9, G-11, C-21, client, green, L-1b block | **unedited** and must stay green | the request, words, logger calls and the other three dialogs do not change |
| `jobsQueues.reconcile.render.test.tsx` (REC-1 to REC-3, the four unnamed reconcile cases, JREC-P1 to P2, JREC-F1 to F4, JREC-T1) | **unedited** | the behaviour proof |
| drain, cancel, retry, items, layout, render Jobs suites; Archiving `page.render` and `source.guard`; Messages and Invites suites; `contrast.lf1.source.guard` | **unedited** | not migrated, or new props are optional |

Pin proof at code review: `git diff --stat origin/main --` on every file in the "unedited" rows, empty output.

## 7. New tests (shared unit suite)

| ID | Case |
|---|---|
| AC-15 | `busyLabel`: in flight the confirm reads it (spinner aria-hidden); after settle it reads `confirmLabel` again; without the prop the words do not change |
| AC-16 | `description`: rendered inside the header with `ADMIN_DIALOG_DESCRIPTION_CLASS`, and the content's accessible description is its text |
| AC-17 | `confirmTestId` and `cancelTestId` land on the two buttons |

## 8. Mutations (each must turn at least one suite red)

| ID | Mutation | Expected red |
|---|---|---|
| M1 | shared ignores `busyLabel` | AC-15, REC-2, "one run at a time" |
| M2 | shared drops the description | AC-16, REC-1 |
| M3 | shared keeps `aria-describedby={undefined}` even with a description | AC-16 |
| M4 | shared drops `confirmTestId` | AC-17, every REC test |
| M5 | Reconcile resolves void on failure (closes) | REC-3 (failure stays open) |
| M6 | Reconcile resolves `false` on success | REC-1 (dialog gone after success) |
| M7 | Reconcile `onReturnFocus` does nothing | JREC-F1 |
| M8 | opener does not clear the notice | JREC-F2 |
| M9 | opener does not clear the error | JREC-F4 |
| M10 | Reconcile imports `@/components/ui/dialog` again | rewritten G-7 |
| M11 | body becomes `JSON.stringify({})` | G-5 (proves the request pins are live) |

## 9. Size

About +20 lines in the shared file, +60 in its unit suite, about -35 net in `ReconcileTopUpsDialog.tsx`, about plus or minus 30 in the Jobs guard. One commit. Runs: `app/admin/components`, `app/admin/__tests__/jobsQueues.*`, `app/admin/messages`, `app/admin/business-os-invites`, `app/admin/archiving`, `contrast.lf1`, `lint:hooks`, scoped `tsc`. No entitlements, schema, route or LLM area touched. No `console.*`, no `any`.

**Visible changes (Reconcile only):** Run takes the shared primary tone (sky, spinner while running) instead of `ui/button`'s default; Close takes `ADMIN_BUTTON` instead of the outline button; the description colour per SQ-2.

## 10. Questions for SA

| ID | Question | Dev default |
|---|---|---|
| SQ-1 | Four optional props for one adopter. Is the migration worth it, or should LF-9 close with no code and the five recorded as permanent non-adopters? | Migrate Reconcile. `description` and `busyLabel` are needed by every dialog on the later list, so they are not single-use; the test-id props are what keeps the money pins unedited |
| SQ-2 | Reconcile's description is `!text-slate-300` with `data-testid="boost-reconcile-description"` (REC-1 and "the confirm says it covers every business" read it). The shared `description` uses `ADMIN_DIALOG_DESCRIPTION_CLASS` (`!text-slate-400`). | Pass `description` as `<span data-testid="boost-reconcile-description">{copy}</span>` (no extra prop, text unchanged) and accept slate-400 as the one admin look; contrast is the same as the other Jobs dialogs. Alternative: a `descriptionTestId` prop and keep slate-300 through the span's class |
| SQ-3 | Drain, Cancel and Retry stay because they show their result inside the dialog. Confirm this is a permanent "not a confirmation" ruling, so they leave the later-adopter list. | Yes; record it in §14 LF3B-F1 |
| SQ-4 | Archive stays because migrating adds the in-flight lock it does not have today. Is that lock wanted as its own small behaviour slice (then Archive can adopt), or is the current behaviour intended? | Leave as is; SA's call |
| SQ-5 | The rewritten G-7 drops the `DialogTrigger asChild` pin; focus return rests on JREC-F1 alone. Enough? | Yes; M7 proves JREC-F1 bites |

## 11. Build results (2026-10-16)

All uncommitted on `feature/admin-layout-lf9-shared-confirm-jobs-archive`. C-1 to C-6 and the SQ rulings applied.

### Files (numstat)

| File | Change |
|---|---|
| `app/admin/components/layout/AdminConfirmDialog.tsx` | 35 / 6: `description`, `busyLabel`, `confirmTestId`, `cancelTestId`; header sentence replaced (C-6) |
| `app/admin/components/layout/__tests__/AdminConfirmDialog.render.test.tsx` | 102 / 1: a new describe block with its own harness (AC-15 x2, AC-16 x2, AC-17); the one removed line is the import gaining `ADMIN_DIALOG_DESCRIPTION_CLASS`; LF-7 cases byte-identical |
| `app/admin/components/jobs/ReconcileTopUpsDialog.tsx` | 52 / 68: plain opener (C-3), `AdminConfirmDialog`, request block byte-identical (C-2) |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | 20 / 16: the two G-7 tests and the LF-9 header note only (C-4) |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | §1 LF-9 row, §14 LF3B-F1, Change History (C-6) |
| `docs/workplans/ADMIN_LAYOUT_LF7_WORKPLAN.md` | §9 update note (C-6) |

How the conditions were met:

- **C-1:** `{...(description === undefined ? { 'aria-describedby': undefined } : {})}`. AC-16 checks that `aria-describedby` names the description element and its text, and that there is no attribute without a description. M3 turns AC-16 red.
- **C-2:** `run()` starts with `setError(null)`, then the unchanged fetch block. A failure returns `false`, a success returns void. The try/catch is unchanged.
- **C-5:** with no new props passed, Messages and Revoke render as before. Their suites are unedited and green.
- **SQ-2:** the description is `<span data-testid="boost-reconcile-description">`, inside the shared slate-400 `DialogDescription`.

### C-4 pin proof

`git diff --stat origin/main --` over the files below printed nothing (exit 0):

- **Jobs tests:** `jobsQueues.reconcile.render`, `render`, `drain.render`, `cancel.render`, `retry.render`, `items.render`, `layout.render`, and `contrast.lf1.source.guard`.
- **Businesses tests that reference `boost-reconcile` (five, not four):** `boostBlock.actions.render`, `businessDrawer.layout.render`, `businessDrawer.money.render`, `businessDrawer.pins.boost.render`, `businessDrawer.pins.credits.render`.
- **Whole folders:** `app/admin/archiving`, `app/admin/messages`, `app/admin/business-os-invites`.
- **Jobs sources:** `DrainNowDialog.tsx`, `CancelQueueItemDialog.tsx`, `RetryQueueItemDialog.tsx`, `reconcileCopy.ts`, `JobsQueuesView.tsx`.
- **Shared and UI:** `layoutFolder.guard.test.ts`, `adminDialog.ts`, `components/ui`.

### Runs

| Run | Result |
|---|---|
| Jest `app/admin/components`, `app/admin/__tests__`, `app/admin/messages`, `app/admin/business-os-invites`, `app/admin/users` | 77 suites, 2,323 tests, all pass |
| Jest `app/admin/archiving` + tailwind-css-escape guard | 3 suites, 87 tests, pass |
| `npm run test:authz-guard` | 2 suites, 203 tests, pass |
| `npm run lint:hooks` | clean (no output) |
| ESLint on the four touched code files | exit 0 |
| Scoped `tsc` (scratchpad tsconfig: the four touched files, Messages `page.tsx`, `RevokeDialog.tsx`) | with the canary: only `zz-canary.ts(1,7): error TS2322`; without it: exit 0 |
| AdminConfirmDialog unit suite, three clean runs | 24 / 24 each |
| `console.` or `any` in touched code; backslashes in the MDs | none |

### Mutations (each applied by script, targeted suites run, file copied back, `git hash-object` equal: all restored)

| ID | Bites | Red tests |
|---|---|---|
| M1 shared ignores `busyLabel` | yes | AC-15; REC-2; "one run at a time" |
| M2 shared drops the description | yes | AC-16; REC-1; "the confirm says it covers every business" |
| M3 `aria-describedby={undefined}` always | yes | AC-16 (re-run alone: AC-16 only. The first run also showed AC-13 red once, a timing failure under parallel load; AC-13 passed 3 of 3 clean runs) |
| M4 shared drops `confirmTestId` | yes | AC-17 and 14 Reconcile tests |
| M5 Reconcile resolves void on failure | yes | REC-3, three QA6b-M1 cases, "one run at a time" |
| M6 Reconcile resolves `false` on success | yes | REC-1, REC-2, REC-3, JREC-F1, JREC-F3 |
| M7 `onReturnFocus` does nothing | yes | JREC-F1 |
| M8 opener does not clear the notice | yes | JREC-F2 |
| M9 opener does not clear the error | yes | JREC-F4 |
| M10 Reconcile imports `@/components/ui/dialog` | yes | both G-7 tests |
| M11 body `JSON.stringify({})` | yes | G-5 |

11 of 11 bite.

### Visible changes (Reconcile dialog only)

- **Run:** the shared sky primary button, with a spinner beside "Running…". It was the `ui/button` default.
- **Close:** `ADMIN_BUTTON`. It was the `ui/button` outline.
- **Description:** slate-400. It was slate-300 (SQ-2), and slate-400 is what the other Jobs dialogs use.
- **Buttons:** `rounded-lg py-1.5`, as on Messages and Revoke.
- **Unchanged:** the opener, the words, the request and the notice.

## Task List

- [x] Step 1: SA approves this workplan (SQ-1 to SQ-5)
- [x] Step 2: shared props + AC-15 to AC-17
- [x] Step 3: Reconcile migration; G-7 rewrite and header note
- [x] Step 4: run the suites, pin proof, M1 to M11
- [x] Step 5: requirement §1 row and Change History

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-16**
**Status:** ✅ Approved, option (a), with conditions C-1 to C-6 below

**Verified against the code** (`067c4a3e`): `AdminConfirmDialog.tsx`, `ReconcileTopUpsDialog.tsx`, `DrainNowDialog.tsx`, `CancelQueueItemDialog.tsx`, `RetryQueueItemDialog.tsx`, `ArchiveConfirmDialog.tsx` and the Archiving `page.tsx` (`sendRun`, `SourceCard`), the runs route header, `jobsQueues.source.guard.test.ts` G-7 and `jobsQueues.reconcile.render.test.tsx`. The §2 table is accurate for all five.

- Drain keeps `result` and `problem` inside the dialog and hides the reason field and Confirm after an answer; Cancel and Retry keep `outcome` inside and refresh on Close (`REFRESH_AFTER`). All three are ask-then-report. Confirmed.
- Reconcile's contract is the shared one: send-once ref, no close in flight, success closes and the counts show under the button, failure stays open with an error line. Confirmed.
- Archive has no lock of its own: Cancel is never disabled and `onOpenChange` is the page's plain `setDialogOpen`. Confirmed.

#### SQ rulings

| ID | Ruling |
|---|---|
| SQ-1 | **Option (a): migrate Reconcile with all four props** (the user confirmed this choice on 2026-10-16). `description` and `busyLabel` are generic: any future confirmation with a sentence of context or "…ing" words needs them, so they do not exist for one caller only. The two test-id props are two lines each, and they keep every REC and JREC money pin unedited. Without them the pins would need editing, which costs more than the props. Option (c) saves nothing for the same reason. Option (b) would leave the one dialog that fits on its own look (`ui/button` default and outline) next to Messages and Revoke, which goes against the user's consistency goal. With Drain, Cancel and Retry ruled out (SQ-3) and Archive left as it is (SQ-4), this migration empties the later-adopter list, so LF-9 closes the LF-7 thread. The churn is bounded: 5 files, one commit, a request block that stays byte-identical and is pinned by G-5. |
| SQ-2 | **Dev default accepted.** Pass the description as `<span data-testid="boost-reconcile-description">{RECONCILE_COPY.description}</span>`; REC-1 and line 271 read only `textContent`, and no test reads the colour. Take `ADMIN_DIALOG_DESCRIPTION_CLASS` (slate-400), the same as Drain, Cancel, Retry and Archive. No `descriptionTestId` prop. List the colour change under "Visible changes" for the user diff. |
| SQ-3 | **Confirmed, and permanent.** Drain, Cancel and Retry are ask-then-report dialogs, not confirmations. Fitting them would add a result phase to the shared component and break LF-7's "owns only the asking". Take them off the later-adopter list in the LF-7 workplan §14 LF3B-F1 and in the requirement §1 LF-9 row, with this reason. If a second ask-then-report dialog ever appears, a separate shared "ask-then-report" shell is the place to consider it. Not in this slice. |
| SQ-4 | **Leave Archive as it is. Grade: Low. No slice of its own.** Details below. Record Archive as "not an adopter: its in-flight gap is graded Low and accepted". If a future Archiving change touches this dialog anyway, it may adopt the shared dialog then. Do not reopen it on its own. |
| SQ-5 | **Enough.** JREC-F1 is a render test of the actual behaviour, and M7 proves it bites. The rewritten G-7 must keep the "exactly one `data-testid="boost-reconcile"` opener" check and the "exactly one `<AdminConfirmDialog`" check, so a second opener or a second dialog cannot slip in. |

#### SQ-4 in plain words: Archive while a run is in progress

What happens today when an admin presses Confirm on Archive:

- **A second click cannot start a second run.** Confirm turns grey as soon as the page marks itself busy, and the busy flag is shared by every source card's Confirm and by every Continue button. Even if two requests did get through, the server refuses the second with "run in progress" (409 `run_in_progress` from `createRun`). And a second archive of the same cutoff would find nothing left to move. Double-archiving is not possible.
- **Closing the dialog mid-run loses nothing.** The request belongs to the page, not to the dialog, so it carries on. When it answers, the outcome notice ("archived N" or the error) shows at the top of the page, outside the dialog, and the page re-reads every number. The page does not go stale.
- **What the admin can actually notice:** after pressing Confirm they can press Escape or Cancel and the dialog disappears while the run is still going. The only clue is the outcome banner appearing a moment later. If they reopen the dialog during the run, Confirm reads "Archiving…" and is greyed out, and the dialog closes by itself when the run ends. That is a little surprising, but it does no harm.

**Grade: Low.** No data risk, no lost outcome, no stale page. It is a small inconsistency with the other admin confirmations. A slice of its own is not worth it.

#### Conditions (Dev must meet these; SA checks them at code review)

- **C-1 (`aria-describedby`).** When `description` is given, leave the `aria-describedby` key out of `DialogContent` with a conditional spread. Do not pass `aria-describedby={undefined}`: Radix spreads props after its own `descriptionId`, so an explicit `undefined` would remove the link. AC-16 must assert that the content's accessible description is the text, and M3 must turn it red. When there is no description, keep today's explicit `undefined` (AC-1 unedited).
- **C-2 (Reconcile `onConfirm`).** Start with `setError(null)`, as `run()` does today. Then the fetch block, byte-identical: URL, `method`, `headers`, `body: '{}'`, `cache: 'no-store'`, the `.json(` read, `reconcileOutcome`, both logger calls and their messages. On failure, `setError(RECONCILE_COPY.failed)` and return `false`. On success, `setNotice(lines)` and return void. It must never reject: keep the existing try/catch around everything that can throw.
- **C-3 (opener).** Keep a plain `<button type="button" data-testid="boost-reconcile">` with the same classes and words. Its `onClick` clears `error` and `notice`, then opens. `onClose` sets `open` to false. `onReturnFocus` focuses the opener ref. `cancelLabel="Close"`, `tone="primary"`.
- **C-4 (guards narrow).** Edit only the two G-7 tests and add the "Amended by LF-9" header note. G-4, G-5, G-6, G-8, G-9, G-11, C-21 and the rest stay byte-unedited. Pin proof at code review: `git diff --stat origin/main --` over every file in the §6 "unedited" rows, plus `jobsQueues.reconcile.render.test.tsx`, `jobsQueues.render.test.tsx`, `contrast.lf1.source.guard.test.ts` and the four `app/admin/users/__tests__` files that reference `boost-reconcile`, with empty output. Run M11 to show the request pins are live.
- **C-5 (shared defaults).** `busyLabel` defaults to `confirmLabel`. With none of the four new props, Messages and Revoke must render exactly as today; their suites run unedited.
- **C-6 (records).** Add a §14 LF3B-F1 note in the LF-7 workplan, plus the requirement §1 LF-9 row and Change History. Record: Reconcile migrated; Drain, Cancel and Retry are permanent non-adopters (ask-then-report); Archive is not an adopter (in-flight gap graded Low, accepted). The later-adopter list is now empty. Replace the "No description prop (SA C-3)" sentence in the shared header comment, as §4 says.

#### Approval

[x] Workplan approved. Proceed to implementation under C-1 to C-6.

### SA Code Review

**Reviewed by SA, 2026-10-16** (uncommitted tree, base `origin/main` `067c4a3e`)
**Status:** ✅ Code Approved, no fixes

| Check | Result |
|---|---|
| C-1 | No description: explicit `'aria-describedby': undefined` (AC-1 path unchanged). With a description: the key is left out by the conditional spread, so Radix's own id holds. AC-16 asserts the link and the text |
| C-2 | `run()` starts with `setError(null)`; the block from `let lines` to the catch is byte-identical to `origin/main` (SA `diff` of the extracted block: identical). Failure returns `false`, success returns void; nothing outside the try can throw. The shared `submit` closes on anything but `false` in its `finally` |
| C-3 | Plain `<button type="button" data-testid="boost-reconcile">`, same classes and words; `onClick` clears error and notice, then opens; `onClose` sets `open` false; `onReturnFocus` focuses the opener ref; `cancelLabel="Close"`, `tone="primary"` |
| C-4 | SA re-ran `git diff --stat origin/main --` over all §11 pin files (8 Jobs tests, the 5 Businesses tests that read `boost-reconcile`, the Archiving, Messages and Invites folders, the Jobs sources, `adminDialog.ts`, `layoutFolder.guard`, `components/ui`): empty, exit 0. The guard diff touches only the two G-7 tests and the header note |
| C-5 | Without the new props: `busyLabel ?? confirmLabel` only when busy, `data-testid={undefined}` renders no attribute, no `DialogDescription`, `aria-describedby` undefined. Messages and Revoke pass none of the four and are unedited |
| C-6 | Requirement §1 LF-9 row, §14 LF3B-F1 and Change History; LF-7 workplan §9 note; shared header sentence replaced |
| G-7 / G-5 | G-7 is narrow: exact import list of four, one `<AdminConfirmDialog` with `testId="boost-reconcile-dialog"`, one opener, no `ui/` import, trigger, content or palette. G-5 is unedited and still pins the body |
| `console.*` / `any` | None in the four touched code files |
| Visible changes | Only the four in §11. Initial focus is unchanged: Radix used to land on the first tabbable (the footer Close, which precedes the X), and the shared dialog focuses Cancel ("Close"). Enter cannot confirm differently: there is no field and focus starts on Close |

**SA mutations** (file backed up to the scratchpad, restored by copy, `git hash-object` equal):

| ID | Mutation | Result |
|---|---|---|
| SA-M1 | Shared confirm shows `busyLabel ?? confirmLabel` at rest | 3 red (AC-15 and the Reconcile "Run now" readers) |
| SA-M2 | Reconcile never renders the error line (`false && error`) | 6 Reconcile tests red: REC-3, three QA6b-M1 cases, "one run at a time", JREC-F4 |

**Noise, not a finding:** under parallel load, Drain U-4, the items-tab U-4 and W7A-2 failed once (files untouched by this slice); the three suites passed 58/58 twice in isolation. One Give credits OP-32 timing failure appeared during SA-M2 under the same load. Same class as the AC-13 flake noted in §11.

**Optimisation suggestion (non-blocking):** `description !== undefined` treats `null` as a description (an empty `DialogDescription` plus a link). No caller passes `null`; leave it unless a future adopter does.

**QA needed:** a short QA pass only. The pins are unedited and green, and every mutation bites. QA should do one manual check in the browser: open Reconcile on Jobs, see the four visible changes, and check Close, then focus back on the button. A full QA cycle is not needed.

#### Code Approved for QA: Yes

## QA Testing Report

_QA populates._

## Commit Info

_RM populates._

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan written (Dev) | Five dialogs checked; Reconcile migrates with four optional shared props; Drain, Cancel, Retry and Archive stay; Jobs G-7 rewritten; awaiting SA |
| 2026-10-16 | SA workplan review | Approved option (a): Reconcile migrates with four optional props; Drain, Cancel, Retry permanent non-adopters; Archive in-flight gap graded Low, accepted; conditions C-1 to C-6 |
| 2026-10-16 | Built (Dev) | C-1 to C-6 met; §11 results: 77 suites / 2,323 tests pass, M1 to M11 all bite, pin proof empty; uncommitted, awaiting SA code review |
| 2026-10-16 | SA code review | Code approved, no fixes: C-1 to C-6 verified, fetch block byte-identical, pin proof re-run empty, SA-M1 and SA-M2 bite; short QA pass |
