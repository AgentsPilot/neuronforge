# Workplan: Admin Layout LF-7 (Shared admin confirmation dialog)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 LF-7 (user request 2026-10-14) and §14 LF3B-F1 (SA ruling: a shared dialog is its own slice once there are real consumers)
**Branch:** `feature/admin-layout-lf7-shared-confirm` (from `origin/main` `3b300f58`)
**Path:** SA reviews this workplan (new file in the shared layout folder), then Dev builds, then SA code review and QA, then user diff, then RM
**Date:** 2026-10-14
**Status:** PR #374 open — fast-track (SA passed). SA approved the workplan with C-1 to C-6 and the code with no fixes; no separate QA (SA ruling). Code commit `1f2cadc6`

## Overview

Two screen-local dialogs repeat the same discipline today: `MessagesConfirmDialog` (Messages, LF-3b) and `RevokeDialog` (Signup Invites, LF-3a). LF-7 moves that discipline into one shared `AdminConfirmDialog` in `app/admin/components/layout/` and migrates exactly these two users. Requests, words, focus rules and test ids do not change. The Businesses money dialogs, the Jobs dialogs and Archiving are left as they are and recorded as later adopters.

---

## 1. Analysis summary

What both dialogs already share (the parts that move):

| Rule | Messages | Revoke |
|---|---|---|
| `ui/dialog` + `ADMIN_DIALOG_CLASS` / `ADMIN_DIALOG_TITLE_CLASS`, `aria-describedby={undefined}` | yes | yes |
| Send-once ref, set before any await | yes | yes |
| No close in flight: Escape, outside click, corner X, Cancel (disabled) | yes | yes |
| Initial focus by hand (`onOpenAutoFocus` prevented) | Cancel | reason field |
| Focus return by hand through `onReturnFocus` (page picks opener or fallback, never body) | yes | yes |
| `aria-busy` on the content and on the confirm button | yes | yes |

What differs (stays with the consumer, or becomes a prop):

| Difference | Where it goes |
|---|---|
| Extra content (Revoke's reason label, input, error line) | `children` |
| Confirm blocked until the reason is long enough | `canConfirm` prop |
| Messages closes once the request settles; Revoke stays open on a refusal | `onConfirm` resolves `false` to stay open |
| Revoke submits from the field on Enter, and its tests submit the `<form>` (`dialog.querySelector('form')`, R-6) | the shared component always renders a `<form>` |
| Cancel words ("Cancel" / "Keep it") | `cancelLabel` prop |
| Revoke's fetch, error map, `openKey` remount | stay in `RevokeDialog.tsx` |

Not touched: any route, any request, `components/ui/dialog.tsx`, `adminDialog.ts`.

## 2. Component or hook: one component

One component, `AdminConfirmDialog.tsx`. A hook (send-once + focus handlers) would leave each consumer importing `@/components/ui/dialog` and rendering the shell itself, so the two narrow screen-guard exceptions (Messages G-2, Invites G-8) would have to stay, and the shell markup would still be copied. A component removes both exceptions: after LF-7 no file under `app/admin/messages` or `app/admin/business-os-invites` names `@/components/ui/`. `@/components/ui/dialog`, `react` and `lucide-react` are already on the shared folder's S-3 allow-list, so the folder guard's rules do not change.

## 3. API

**File:** `app/admin/components/layout/AdminConfirmDialog.tsx` (`'use client'`)

```typescript
export type AdminConfirmTone = 'danger' | 'primary';

export interface AdminConfirmDialogProps {
  open: boolean;
  /** The question. No description prop (SA C-3): aria-describedby stays undefined. */
  title: ReactNode;
  /** Default 'Cancel'. */
  cancelLabel?: string;
  confirmLabel: string;
  /** Default 'primary'. */
  tone?: AdminConfirmTone;
  /** On DialogContent. */
  testId: string;
  /** Extra content between the header and the buttons (Revoke's reason field and error line). */
  children?: ReactNode;
  /** Focused on open. Default: the cancel button, so Enter on open never sends anything. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Default true. False disables the confirm button and makes a submit do nothing. */
  canConfirm?: boolean;
  /**
   * The request. Resolve `false`: the dialog does not call onClose; the
   * consumer decides whether it closes (SQ-4). Anything else closes through
   * onClose. Must not reject; if it does, the dialog still resets and closes
   * (today's Messages `finally`).
   */
  onConfirm: () => Promise<boolean | void>;
  /** Cancel, Escape, an outside click, the corner X, or a settled confirm. Never in flight. */
  onClose: () => void;
  /** Called after the dialog has closed; the page focuses the opener or its fallback. */
  onReturnFocus: () => void;
}
```

Behaviour, in the order Revoke and Messages do it today: submit calls `event.preventDefault()` first, unconditionally (SA C-1), then checks the send-once ref, then `canConfirm`; sets the ref and busy state; awaits `onConfirm`; in `finally` clears the ref and busy; then calls `onClose` unless the result was `false`. Buttons: cancel `type="button"`, `disabled={isBusy}`, `ADMIN_BUTTON`; confirm `type="submit"`, `disabled={isBusy || !canConfirm}`, `aria-busy`, a `Loader2` spinner (aria-hidden) while busy. Footer is `DialogFooter className="gap-2"` for both users (SA C-2; Revoke's own `flex justify-end gap-2` div goes). The form (`space-y-3`) wraps `children` and the footer; `DialogHeader` stays outside it (SQ-2). Tone classes (SQ-1): danger `bg-rose-700 hover:bg-rose-600`, primary `bg-sky-600 hover:bg-sky-500`, both `inline-flex items-center gap-2`, `disabled:cursor-not-allowed disabled:opacity-60` and the purple focus ring. The shared dialog is rendered inside `RevokeDialogOpenOnce`, below `key={openKey}`, never hoisted (SA C-5).

Mapping of the two users:

| Prop | Messages Delete / Mark All Read | Revoke |
|---|---|---|
| `title` | unchanged strings | `Revoke the invite for {email}?` |
| `cancelLabel` | default | `Keep it` |
| `confirmLabel` / `tone` | `Delete` danger / `Mark All Read` primary | `Revoke invite` danger |
| `testId` | `delete-confirm-dialog` / `mark-all-confirm-dialog` | `revoke-dialog` |
| `initialFocusRef` | default (Cancel) | the reason input |
| `canConfirm` | default | reason trimmed length at least 3 |
| `onConfirm` | the page handler (void, so it closes) | clears the error, posts, on refusal sets the error and returns `false`; on success calls `onRevoked` (the page closes it, as today) and returns `false` so `shutRevoke` runs once, in today's order |

## 4. Files

| File | Action | Reason |
|---|---|---|
| `app/admin/components/layout/AdminConfirmDialog.tsx` | create | the shared dialog |
| `app/admin/components/layout/__tests__/AdminConfirmDialog.render.test.tsx` | create | unit tests (§6) |
| `app/admin/messages/page.tsx` | modify | two `<AdminConfirmDialog>` in place of `<MessagesConfirmDialog>`; `isDanger` becomes `tone="danger"` |
| `app/admin/messages/components/MessagesConfirmDialog.tsx` | delete | fully replaced; it held nothing screen-specific |
| `app/admin/business-os-invites/components/RevokeDialog.tsx` | modify | keeps props, `openKey` remount, reason, fetch, error map; renders `AdminConfirmDialog`; no `ui/dialog` import. `page.tsx` unedited |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | §5 |
| `app/admin/messages/__tests__/source.guard.test.ts` | modify | §5 |
| `app/admin/business-os-invites/__tests__/source.guard.test.ts` | modify | §5 |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 row, §14 LF3B-F1 status, Change History |

## 5. Guard changes

| Guard | Change |
|---|---|
| layoutFolder part (a) | `AdminConfirmDialog.tsx` joins `EXPECTED_SOURCES`. S-3 allow-list unchanged (`@/components/ui/dialog`, `react`, `lucide-react` already there). Header gains an "Amended by LF-7" note |
| layoutFolder part (b) registry | Messages entry drops `MessagesConfirmDialog.tsx` (deleted). Invites entry keeps `RevokeDialog.tsx` (still no `.json(`, reads with `readJsonBody`) |
| Messages G-1 | file list drops `components/MessagesConfirmDialog.tsx` |
| Messages G-2 | the `DIALOG_FILE` exception line and its two LF-3b tests are removed. Replaced by: (a) `escapes()` refuses `@/components/ui/dialog` from every file; (b) no Messages file names `@/components/ui/`; (c) liveness: `page.tsx` imports `@/app/admin/components/layout/AdminConfirmDialog` |
| Invites G-8 | the exception line in `escapes()` is removed. The two G-8 tests are rewritten: every file, `RevokeDialog.tsx` included, is refused the primitive; no Invites file names `@/components/ui/`; liveness: `RevokeDialog.tsx` imports `AdminConfirmDialog` |
| Invites G-7 | positive control gains `app/admin/components/layout/AdminConfirmDialog.tsx`; `components/ui/dialog.tsx` stays (now reached through it). Additive only |

So the exceptions do not point at the shared component: they are deleted. The shared folder's existing alias rule already lets both screens import it.

## 6. Tests

Unedited (must stay byte-identical, `git diff --stat` empty on these): `messages.confirmDialog.render.test.tsx`, `messages.baseline.render.test.tsx`, `messages.layout.render.test.tsx`, `invites.requestPins.render.test.tsx`, `invites.openRule.render.test.tsx`, `page.render.test.tsx` (Invites). These render the pages, so they are the behaviour proof of the migration.

New `AdminConfirmDialog.render.test.tsx` (about 14 cases):

| ID | Case |
|---|---|
| AC-1 | title, labels, default cancel "Cancel", `testId`, `ADMIN_DIALOG_CLASS` on the content; no `aria-describedby` |
| AC-2 | dropped with the `description` prop (SA C-3) |
| AC-3 | default initial focus is Cancel; Enter on open (user-event, SA C-4) sends nothing and closes |
| AC-4 | `initialFocusRef` focuses the given element |
| AC-5 | a double click and two same-tick submits call `onConfirm` once |
| AC-6 | in flight: Escape, outside click and X do nothing; both buttons disabled; `aria-busy` true; spinner shown |
| AC-7 | resolve void closes (`onClose` once); resolve `false` stays open and re-enables |
| AC-8 | reject still resets and closes |
| AC-9 | `canConfirm=false`: confirm disabled, a form submit calls nothing |
| AC-10 | Cancel (user-event click, SA C-4), Escape, X call `onClose` and send nothing |
| AC-11 | after close `onReturnFocus` is called and focus is not on body |
| AC-12 | tone `danger` and `primary` give the two button classes |
| AC-13 | after a settled confirm a reopen can send again (ref reset) |
| AC-14 | `children` render inside the form, before the buttons |

## 7. Mutations (each must turn at least one suite red)

| ID | Mutation | Expected red |
|---|---|---|
| M1 | drop the send-once ref check | AC-5, Messages C-5, Invites R-6 |
| M2 | drop the `onEscapeKeyDown` guard | AC-6, Messages C-6, Invites R-5 |
| M3 | drop the `onInteractOutside` guard | AC-6, R-5 |
| M4 | `onOpenChange` ignores the ref | AC-6 (X), R-5 |
| M5 | ignore `initialFocusRef` | AC-4, Invites focus test |
| M6 | default focus on confirm | AC-3, Messages C-1 / C-2 |
| M7 | no `onReturnFocus` in `onCloseAutoFocus` | AC-11, Messages C-7, Invites R-4 |
| M8 | close even on `false` | AC-7, Invites R-9 |
| M9 | submit ignores `canConfirm` | AC-9, Invites short-reason test |
| M10 | swap the tone classes | AC-12 |
| M11 | Messages `page.tsx` imports `ui/dialog` | Messages G-2 |
| M12 | `RevokeDialog.tsx` imports `ui/dialog` | Invites G-8 |
| M13 | rename the shared file | layoutFolder expected files, Invites G-7 |
| M14 | `RevokeDialog` renders `RevokeDialogOpenOnce` without `key={openKey}` (SA) | Invites reopen-starts-fresh test |

## 8. Size

About +150 lines (component, mostly the why-comment), +250 (unit test), -145 (`MessagesConfirmDialog.tsx`), about -70 in `RevokeDialog.tsx`, about plus or minus 40 across the three guards. One commit. Runs: `app/admin/components`, `app/admin/messages`, `app/admin/business-os-invites`, `lint:hooks`, `tsc` on the touched files. No entitlements, schema, route or LLM area touched.

## 9. Later adopters (not in this slice)

Recorded in §14 LF3B-F1: `app/admin/users/components/CreditFormDialog.tsx`, `BoostCapDialog.tsx`, `DeleteBusinessDialog.tsx` (Businesses money and danger dialogs, held by the LF-4a.1 and LF-4b pin suites); `app/admin/components/jobs/DrainNowDialog.tsx`, `CancelQueueItemDialog.tsx`, `RetryQueueItemDialog.tsx`, `ReconcileTopUpsDialog.tsx` (Jobs guard pins); `app/admin/archiving/components/ArchiveConfirmDialog.tsx`. Each adoption is its own slice with its pins unedited.

## 10. Questions for SA (ruled 2026-10-14)

Rulings: SQ-1 approved, one look with the Messages classes plus `inline-flex items-center gap-2` and the spinner in both tones; SQ-2 accepted (form wraps children and footer, header outside, `space-y-3`); SQ-3 delete; SQ-4 `false`, worded as "the dialog does not call onClose; the consumer decides". Full text in SA Review Notes §4.

| ID | Question | Dev default |
|---|---|---|
| SQ-1 | The two danger buttons differ today (Messages `bg-rose-700`, disabled `opacity-60`; Revoke `bg-rose-600`, disabled `opacity-40`, with a spinner). One shared tone means one look. | Use the Messages classes for both tones, plus the spinner for both: Revoke's red is one shade darker, Messages gains a spinner while in flight. No test pins either class |
| SQ-2 | Messages' content gains a `<form>` around its buttons (Revoke's tests need the form). Enter on Cancel still only cancels. | Accept |
| SQ-3 | Delete `MessagesConfirmDialog.tsx` rather than keep a thin wrapper | Delete |
| SQ-4 | `onConfirm` resolving `false` to stay open, rather than a separate `closeOnSettle` prop | `false` |

## 11. Build results (2026-10-14)

All uncommitted on `feature/admin-layout-lf7-shared-confirm`. C-1 to C-6 and the SQ rulings applied as written in §3.

### Files

| File | Change (numstat) |
|---|---|
| `app/admin/components/layout/AdminConfirmDialog.tsx` | new, 167 lines |
| `app/admin/components/layout/__tests__/AdminConfirmDialog.render.test.tsx` | new, 290 lines, 19 tests |
| `app/admin/messages/components/MessagesConfirmDialog.tsx` | deleted with `git rm` (0 / 141) |
| `app/admin/messages/page.tsx` | 5 / 5 |
| `app/admin/business-os-invites/components/RevokeDialog.tsx` | 51 / 88 |
| `app/admin/messages/__tests__/source.guard.test.ts` | 30 / 14 |
| `app/admin/business-os-invites/__tests__/source.guard.test.ts` | 31 / 21 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | 7 / 2 |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | 3 / 0 |

Invites `page.tsx` unedited.

### C-6 pin proof

Command (against `origin/main` `99fb09a0`, fetched after the build; the branch base is `3b300f58`):

```bash
git diff --stat origin/main -- app/admin/messages/__tests__/messages.confirmDialog.render.test.tsx app/admin/messages/__tests__/messages.baseline.render.test.tsx app/admin/messages/__tests__/messages.layout.render.test.tsx app/admin/business-os-invites/__tests__/invites.requestPins.render.test.tsx app/admin/business-os-invites/__tests__/invites.openRule.render.test.tsx app/admin/business-os-invites/__tests__/page.render.test.tsx app/admin/business-os-invites/__tests__/invites.paymentLine.render.test.tsx app/admin/messages/__tests__/messagesFormat.test.ts
```

Output: empty (exit 0).

### Runs

| Run | Result |
|---|---|
| Jest `app/admin/messages`, `app/admin/business-os-invites`, `app/admin/components` | 34 suites, 1,153 tests, all pass |
| `npm run test:authz-guard` | 2 suites, 203 tests, pass |
| `app/__tests__/tailwind-css-escape.guard.test.ts` | 1 suite, 6 tests, pass |
| `npm run lint:hooks` | exit 0 |
| ESLint on the seven touched code files | exit 0 |
| Scoped `tsc` (scratchpad tsconfig extending the worktree's, `incremental: false`, `plugins: []`, `include: []`, the eight touched code files; the worktree has no `next-env.d.ts`, so it is not listed) | with the canary: exactly `zz-canary.ts(1,7): error TS2322`, exit 2; without it: exit 0. Scratch files deleted |
| Backslashes in the new files and this workplan | 0 |
| `console.` or `any` in the new or rewritten files | none |

### Mutations

Each applied by script to one file, the targeted suites run, the file copied back and its `git hash-object` compared with the value before: all 14 restored, checksums equal.

| ID | Bites | Red tests |
|---|---|---|
| M1 | yes | AC-5 (both); Messages C-5 Delete and Mark All Read; Invites R-6 |
| M2 | no, equivalent | none. Escape not prevented reaches `onOpenChange(false)`, which the same ref still refuses, so the dialog stays open. Same two layers as the LF-3b and LF-3a dialogs; M4 is the layer the tests can see |
| M3 | no, equivalent | none, for the same reason as M2 (an outside click also ends in `onOpenChange(false)`) |
| M4 | yes | AC-6; Messages C-6 Delete and Mark All Read; Invites R-5 |
| M5 | yes | AC-4, AC-9, AC-14; Invites R-2, R-3 |
| M6 | yes | AC-3; Messages C-1 (both), C-2 (both) |
| M7 | yes | AC-11; Messages C-7 (four), C-8; Invites R-4 (three), R-7, R-8, R-9 |
| M8 | yes | AC-7; Invites R-9 |
| M9 | yes | AC-9 only. The Invites short-reason test (R-3) stays green: the disabled submit button already stops implicit submission, so only the unit test's direct form submit reaches the guard |
| M10 | yes | AC-12 (three) |
| M11 | yes | Messages G-2 `page.tsx` imports, LF-7 no `@/components/ui/` |
| M12 | yes | Invites import rule for `RevokeDialog.tsx`, G-8 liveness |
| M13 | yes | layoutFolder expected files; the Invites guard suite fails to run (G-7 cannot resolve the import) |
| M14 | yes | Invites R-10 (a reason never carries over to the same row reopened) |

12 bite, M2 and M3 equivalent (masked by the `onOpenChange` ref guard, not removable without M4).

### Deviations

| ID | Deviation | Why |
|---|---|---|
| D-1 | AC-8 (a rejecting `onConfirm` still resets and closes) dropped from the unit suite | The rejection leaves the dialog through `void submit()` as an unhandled rejection (as in the LF-3b dialog), which Jest fails as the test's own error. The JSDoc now says "must not reject (both consumers catch)". Catching it in the dialog would need a logger in the shared file, which would pull `lib/logger` into the Invites G-7 walk; not worth it for a case no consumer has |
| D-2 | M2 and M3 do not bite | Equivalent mutants, see the table |
| D-3 | M9 bites the unit suite only, not the Invites short-reason test as planned | See the table |
| D-4 | Scoped `tsc` without `next-env.d.ts` | The file is not in this worktree |

## Task List

- [x] Step 1: SA approves this workplan (C-1 to C-6, SQ rulings, M14)
- [x] Step 2: `AdminConfirmDialog.tsx` + unit tests; layoutFolder expected files
- [x] Step 3: Messages migration; delete `MessagesConfirmDialog.tsx`; Messages guard and registry edits
- [x] Step 4: Revoke migration; Invites guard edits
- [x] Step 5: run the three folders, confirm pin files unedited, run M1 to M14
- [x] Step 6: requirement §1 row and Change History updated

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-14**
**Status:** ✅ APPROVED WITH CONDITIONS (C-1 to C-6). Dev may build; the conditions are checked at code review.

Read against: `MessagesConfirmDialog.tsx`, `RevokeDialog.tsx`, Invites `page.tsx` (`shutRevoke`, `onRevoked`), `components/ui/dialog.tsx` (`DialogFooter`), `layoutFolder.guard.test.ts` (S-2 to S-8, L-1e F-1, `EXPECTED_SOURCES`), both screen source guards (Messages G-1/G-2, Invites G-7/G-8), `messages.confirmDialog.render.test.tsx` and `invites.openRule.render.test.tsx`.

#### 1. API and the shared folder

Sound. Everything screen-specific stays with the consumer: Revoke's fetch, `readJsonBody`, error map, reason field and `openKey` remount stay in `RevokeDialog.tsx`; the shared file has no request, no route, no screen words beyond the default "Cancel". Its imports (`react`, `lucide-react`, `@/components/ui/dialog`, and the `adminDialog` / `adminTable` siblings through the alias or `./`) are all on the S-3 allow-list, so the folder rules do not change. No `fetch` in the folder: L-1e F-1 keeps `AdminBusinessPicker.tsx` as the one fetching file, and that test will prove it. No `.json(`, no green, no `dark:`, no `console`, no special file name. One component rather than a hook is right: it is what lets the two `ui/` exceptions be deleted.

LF3B-F1 asked for a design against three real consumers. Messages Delete, Messages Mark All Read and Invites Revoke are three real uses with the two shapes that matter (no extra content and close on settle; extra content, gated confirm, stay open on refusal). With the user's request, that is enough. It is also why C-3 drops the one prop no consumer uses.

#### 2. Behaviour stays the same

Checked line by line against today's two files:

- Requests and the error map: untouched (stay in `RevokeDialog.tsx`; Messages handlers stay in `page.tsx`).
- Words and test ids: mapped one to one in §3. Messages C-1 reads the buttons' `textContent` as `['Cancel', 'Delete', 'Close']`; the spinner is an aria-hidden svg shown only in flight, so it adds no text and the order is unchanged.
- Send-once, no close in flight, focus by hand, `aria-busy`: same handlers, same order (ref first, then `canConfirm`; ref and busy set before the await; cleared in `finally`).
- Revoke success: `onConfirm` calls `onRevoked`, the page runs `replaceRow` then `shutRevoke`, then `onConfirm` returns `false`, then the shared `finally` clears the ref and busy, and `onClose` is not called. That is today's order exactly, and `shutRevoke` runs once. Revoke refusal: `setError` then `false`, dialog stays open with the reason. Same as today.
- `openKey`: the shared dialog sits inside the keyed inner part, so its ref and busy state remount with the reason and the error (C-5).
- Messages: the confirm becomes `type="submit"` inside a form. A click still sends once (C-5 double click: the ref holds even if the second click lands); Enter on the focused Cancel (`type="button"`) only cancels, which Messages C-2 pins with user-event.

The pin suites stay unedited; that is the behaviour proof (C-6).

#### 3. G-2 / G-8 replacement

Sound, and better than re-pointing. Deleting the exception lines means both screens go back to "no `@/components/ui/` at all", which is the stricter rule they had before LF-3a/LF-3b. The liveness tests (the page or `RevokeDialog.tsx` really imports `@/app/admin/components/layout/AdminConfirmDialog`) stop the new refusal tests from being vacuous. Keep the near-miss specifiers of today's G-8 test (`dialogX`, `dialog/index`, `button`, `sheet`, the relative `components/ui/dialog` path) as refusals for every file, so the rewrite loses no case. The G-7 positive control gaining `AdminConfirmDialog.tsx` is additive and right: it proves the walk now reaches the primitive through the shared file.

#### 4. SQ rulings

| ID | Ruling |
|---|---|
| SQ-1 | **Approved: one look, the Messages classes.** Danger `bg-rose-700 hover:bg-rose-600`, primary `bg-sky-600 hover:bg-sky-500`, both `disabled:cursor-not-allowed disabled:opacity-60` and the purple focus ring; the spinner in both tones. Add `inline-flex items-center gap-2` to both tone classes so the spinner sits beside the words (today's Revoke has `flex items-center gap-2`). The visible changes are: Revoke's red one shade darker and its disabled state less faded; Messages shows a spinner in flight; Revoke's buttons take the `DialogFooter` layout (see C-2). All small and consistent; record them in the requirement's Change History entry as the slice's only visible changes |
| SQ-2 | **Accepted.** The form wraps `children` and the footer; `DialogHeader` stays outside it, as Revoke has it today. Form class `space-y-3` (Revoke's today; no effect on Messages, whose form holds only the footer). See C-1 for the submit handler |
| SQ-3 | **Delete** `MessagesConfirmDialog.tsx`. A thin wrapper would be a second name for the same thing and would keep a `ui/` reason alive in the Messages guard |
| SQ-4 | **`false`, not a second prop**, but word the contract as "resolve `false`: the dialog does not call `onClose`; the consumer decides whether it closes" rather than "stay open". Revoke's success path returns `false` and closes through the page, so "stay open" would describe it wrongly. The JSDoc on `onConfirm` and the comment in `RevokeDialog.tsx` say this in one sentence each |

#### 5. Tests and mutations

Adequate, with C-3 and C-4. The page-level pin suites carry the behaviour proof; the unit suite pins the component's own contract so a later adopter cannot quietly change it. M1 to M13 each name a red suite that really reads the mutated rule; I checked M4 (the corner X is not disabled in flight, so only the `onOpenChange` ref guard stops it), M6 (focus on a submit button makes Enter send, Messages C-2 red) and M8 (Invites refusal test). Add M14: `RevokeDialog` renders `RevokeDialogOpenOnce` without `key={openKey}`; expected red: the Invites reopen-starts-fresh test. It proves the remount still reaches the shared dialog's ref and busy state.

#### 6. Size

Proportionate: one component, one unit suite, two migrations, three guard edits, net roughly plus 150 lines once the deleted file is counted. One commit is fine. No entitlements, schema, route, LLM or money area is touched.

#### Conditions

1. **C-1 Submit handler order.** `onSubmit` calls `event.preventDefault()` first, unconditionally, then checks the send-once ref, then `canConfirm`. A guard that returns before `preventDefault` lets the browser submit the form.
2. **C-2 Footer.** Use `DialogFooter className="gap-2"` for both users (Messages' layout); Revoke's own `flex justify-end gap-2` div goes. This is part of the SQ-1 visible change and is recorded with it.
3. **C-3 Drop `description`.** No consumer uses it; per LF3B-F1 the API is designed against real consumers. `aria-describedby={undefined}` stays fixed. AC-2 goes; the first adopter that needs a description adds the prop and its test in its own slice.
4. **C-4 Keyboard tests use user-event.** AC-3 (Enter on open) and the Cancel part of AC-10 drive the keyboard and clicks through `@testing-library/user-event`, as Messages C-2 does. A `fireEvent.keyDown` Enter on a button does nothing in jsdom and would pass against the M6 mutation.
5. **C-5 Keep the shared dialog inside the keyed part.** `AdminConfirmDialog` is rendered by `RevokeDialogOpenOnce`, never hoisted above `key={openKey}`; M14 above proves it.
6. **C-6 Pin proof.** At code review Dev shows `git diff --stat origin/main --` on the six pin files named in §6, plus `invites.paymentLine.render.test.tsx` and `messagesFormat.test.ts`, with empty output, and the M1 to M14 results in the workplan.

### Approval
[x] Workplan approved with conditions C-1 to C-6 — proceed to implementation

### SA Code Review

**Code Review by SA — 2026-10-14**
**Status:** ✅ APPROVED (no fixes)

Read: `AdminConfirmDialog.tsx`, its unit suite, the `RevokeDialog.tsx` and Messages `page.tsx` diffs, the three guard diffs and Invites `page.tsx` (`shutRevoke`, `onRevokeClosed`).

#### 1. Conditions

| ID | Met | Evidence |
|---|---|---|
| C-1 | ✅ | `submit` runs `event.preventDefault()`, then the `isSending` ref check, then `canConfirm`, then sets the ref and busy state before the await |
| C-2 | ✅ | One `DialogFooter className="gap-2"` serves both users; Revoke's own `flex justify-end gap-2` div is gone |
| C-3 | ✅ | No `description` prop; `aria-describedby={undefined}` is fixed on the content |
| C-4 | ✅ | AC-3 (Enter on open) and AC-10 (Cancel, Escape, Close) go through `userEvent.setup()`; every case in the suite does |
| C-5 | ✅ | `AdminConfirmDialog` is rendered by `RevokeDialogOpenOnce`, below `key={openKey}`; M14 bites (R-10) |
| C-6 | ✅ | Re-run by SA: `git diff --stat origin/main` over the three screen folders shows only the two `source.guard.test.ts` files, `RevokeDialog.tsx`, Messages `page.tsx` and the deleted `MessagesConfirmDialog.tsx`. Every behaviour suite is byte-identical, and Invites `page.tsx` is unedited |

#### 2. Behaviour

The behaviour is unchanged. Messages: the props map one to one (`isDanger` becomes `tone="danger"`), and the request handlers are untouched. Revoke: the request, the error map and the reason gate are the same. The old `canSubmit` also checked `!submitting`, and the shared `disabled={isBusy || !canConfirm}` now covers that. On success, `onRevoked` runs `replaceRow` and then `shutRevoke`, the result is `false`, and `onClose` is not called a second time: the same order as before. The only visible changes are the ones SQ-1 and C-2 approved. SA re-ran the three folders: 34 suites and 1,153 tests pass.

#### 3. Guards

The guards are stricter and still live. Messages G-2 and Invites G-8 lose their exception lines. Every file is now refused the primitive and its look-alikes, and no file names `@/components/ui/`. The liveness tests pin that each screen really imports the shared dialog, and Invites G-7 gains the shared file as a positive control. In layoutFolder, `AdminConfirmDialog.tsx` joins `EXPECTED_SOURCES` and the S-3 allow-list is unchanged. The L-1e F-1 test still runs on every source file, so the new file is held to "no fetch" (it has none). The Messages registry drops the deleted file.

#### 4. Deviation rulings

| ID | Ruling |
|---|---|
| D-1 | **Accepted, no catch required.** Neither caller can reject. Messages `deleteMessage` catches the fetch and returns on a non-ok status. `markAllRead` awaits `updateMessageStatus`, which catches and returns a boolean, and voids the re-read. Revoke catches everything. A catch in the shared file would need a logger, which would pull `lib/logger` into the Invites G-7 walk, and it would be for a case no consumer has. The JSDoc states the contract. A later adopter whose request can throw catches it in its own handler, as both of these do |
| D-2 | **Accepted.** M2 and M3 are equivalent mutants: Escape and an outside click both end in `onOpenChange(false)`, which refuses while the ref is set. M4 is the observable layer, and it bites in all three suites. Keep both layers. They are cheap, and they stop Radix starting its close animation |
| D-3 | **Accepted.** In Revoke, the disabled submit button already stops implicit submission, so the `canConfirm` check inside `submit` is defence in depth, and only a direct form submit reaches it. AC-9 pins it |
| D-4 | **Accepted.** The scoped `tsc` canary proves the run was live |

#### 5. Hygiene

No `console.*` and no `any` in the new or rewritten files. No backslashes in this workplan. No dead imports: `RevokeDialog.tsx` dropped `Loader2`, `FormEvent` and the `ui/dialog` imports. The why-comments are accurate.

#### 6. SA mutations (both reverted, `git hash-object` equal before and after)

| ID | Mutation | Result |
|---|---|---|
| SA-M1 | Cancel button `disabled={isBusy}` becomes `disabled={false}` (Cancel live in flight) | Bites: 3 red (AC-6 and the in-flight disabled checks in the screen suites) |
| SA-M2 | Revoke's success path returns `true`, so the shared dialog also calls `onClose` | Survives, but it is equivalent: `shutRevoke` is idempotent (it sets a ref to false and the state to false), so a second call changes nothing the user can see. No test needed |

#### 7. QA

No separate QA needed. Both screens' behaviour suites are unedited and green. QA covered both dialogs exhaustively in LF-3a and LF-3b, and those same suites, re-run here, are the proof. The only visible changes (one shade of red, a spinner on Messages, the footer layout) were approved by SA under SQ-1 and C-2 and are pinned by no test. The user sees them in the diff review.

### Code Approved for QA: Yes (no separate QA pass needed; proceed to the user diff, then RM)

## QA Testing Report

_QA populates._

## Commit Info

_RM populates._

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Workplan written (Dev) | Shared `AdminConfirmDialog`, two users migrated, G-2 and G-8 exceptions removed; awaiting SA |
| 2026-10-14 | SA approved; built (Dev) | C-1 to C-6, SQ rulings and M14 folded in; built uncommitted; §11 results. Awaiting SA code review + QA |
| 2026-10-14 | SA code review: APPROVED | C-1 to C-6 met; D-1 to D-4 accepted; SA mutations: 1 bites, 1 equivalent; no separate QA needed |
| 2026-10-14 | PR opened (RM) | PR #374 open, fast-track; code commit `1f2cadc6`, merged `origin/main` `8bf86fd2` cleanly; 36 suites / 1,278 tests passed, `lint:hooks` clean |
