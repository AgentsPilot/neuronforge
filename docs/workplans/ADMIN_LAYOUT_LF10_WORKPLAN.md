# Workplan: Admin Layout LF-10 (Businesses money dialogs: Give credits and Take back credits onto the shared confirmation dialog)

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1 LF-10; later-adopter list in §14 LF3B-F1, [ADMIN_LAYOUT_LF7_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF7_WORKPLAN.md) §9 and [ADMIN_LAYOUT_LF9_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_LF9_WORKPLAN.md)
**Branch:** `feature/admin-layout-lf10-money-dialogs` (from `origin/main` `dfd2d9da`, which contains LF-9, PR #426, merged 2026-10-16)
**Path:** SA reviews this workplan (money dialog, pinned). If SA accepts the recommendation, the slice closes with no code: this workplan, the §1 row and the §14 note are the whole output
**Date:** 2026-10-16
**Status:** Workplan, awaiting SA review

## Overview

Give credits and Take back credits are one component, `app/admin/users/components/CreditFormDialog.tsx`, opened from `CreditsBlock.tsx` with a `mode` (`give` or `take_back` with a lot). It is a **two-step form inside one dialog**: a form step (amount, end date or "everything left", reason, paid-credits tick) with Close and Continue, then a confirm step (summary, recent-grant warning, Ends or From the gift of, Reason) with Back and Confirm. A refusal returns to the form step with the error line, in the same dialog.

`AdminConfirmDialog` owns only the asking: one title, content, Cancel and Confirm, where Cancel always means close. The check below finds that neither the whole dialog nor the confirm step alone fits without editing the pin suite or bending the shared contract. **Recommendation: close LF-10 with no code** and record `CreditFormDialog` as a permanent non-adopter (a form, not a confirmation), as LF-9 did for Drain, Cancel item and Retry item. Its money guarantees today are already at least as strong as the shared dialog's (§2).

LF-9 dependency: none outstanding. PR #426 merged at `dfd2d9da` before this branch was cut, so the four optional props (`description`, `busyLabel`, `confirmTestId`, `cancelTestId`) are available. They do not change the outcome.

---

## 1. What the dialog is today

| Part | Today | Pinned by |
|---|---|---|
| Content | one `<DialogContent data-testid="credit-form-dialog" ... onCloseAutoFocus={onCloseAutoFocus}>`, the same DOM node across both steps | pins.credits GIVE-1 to GIVE-5, TAKE-1 to TAKE-5 (`within(dialog)` after Continue; `toBe(dialog)` after a refusal); source.guard BD-15 (exactly one `<DialogContent ` with the named handler) |
| Title, description | per mode; description names the ceiling or the lot's remainder | pins.credits, creditsBlock render |
| Form step | Close (`credit-form-close`) and Continue (`credit-form-continue`, disabled until `formValid`), both `type="button"`; no `<form>`, so Enter in a field does nothing | GIVE-1, TAKE-3 |
| Confirm step | summary, `credit-confirm-recent-grant` (PR #423), Ends or From the gift of, Reason; Back (`credit-form-back`) returns to the form step; Confirm (`credit-form-confirm`) reads "Saving…" in flight | GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, creditsBlock.recentGrant |
| Send once | `inFlight` ref checked and set before the await; Confirm disabled while busy | GIVE-4, TAKE-5 |
| No close in flight | `handleOpenChange` refuses every close while `inFlight`; Close and Back disabled | GIVE-4, TAKE-5 |
| Request id | minted on open, kept across every failure, new only on the next opening | GIVE-3, TAKE-4, pins.boost |
| Request | `postJson`: POST, `Content-Type: application/json`, `JSON.stringify(body)`, `cache: 'no-store'`, to `/api/admin/business-os/entitlements/accounts/{id}` | pins.credits `opsPost` / `requestOf`; source.guard |
| Initial focus | Radix default: the first focusable field (Give: Credits input; Take back: "A number of credits" radio) | not pinned |
| Focus return | the block's `useReturnFocus` handler through `onCloseAutoFocus` (F-108, BD-15) | money render, BD-15 |

## 2. Options checked

| Option | What it takes | Why it does not fit |
|---|---|---|
| (a) Confirm step only on `AdminConfirmDialog`; form step stays a local dialog | Two dialogs swapped on Continue, Back and on a refusal | The pins hold one dialog node across steps: after Continue they read `within(dialog)` for the summary and Confirm, and after a refusal they assert `screen.getByTestId('credit-form-dialog')` is the **same** node, now on the form step. A swap gives a new node every step, so GIVE-1 to GIVE-5 and TAKE-1 to TAKE-5 fail unless edited, which this slice forbids. It also breaks BD-15 (two contents), and closing the form dialog for the swap fires the block's focus-return handler, sending focus to the Give button while the confirm dialog opens |
| (b) Whole dialog on `AdminConfirmDialog`, props switched per step | `cancelLabel` Close or Back, `confirmLabel` Continue or Confirm, `confirmTestId` per step, `onConfirm` doing "go to confirm, return `false`" on the form step, `onClose` doing "Back" on the confirm step | Bends the shared contract: `onClose` would mean "go back" on one step and "close" on the other, so **Escape and an outside click on the confirm step would go Back instead of closing** (a behaviour change). Continue would pass through the send path (busy, spinner, the send-once ref) for a step change. The shared `<form>` makes Enter in the Credits field submit (Continue, today nothing). Initial focus moves to Close unless an `initialFocusRef` is wired per mode. BD-15 must be edited, and the dialog keeps `onCloseAutoFocus` while the shared one takes `onReturnFocus` with no event. Doing it cleanly needs a new shared "back" or "secondary action" prop for one consumer: a new pattern (CLAUDE.md rule 7) |
| (c) **No code. Record as a permanent non-adopter** | §14 LF3B-F1 note only | None. The dialog is a form with a review step, not a confirmation. Its guarantees already match the shared ones (send-once ref set before the await, no close on any path in flight, both secondary buttons disabled) and add one the shared dialog does not have: the request id kept across failures |

**Dev recommendation: (c).** Same reasoning as LF-9's Drain, Cancel item and Retry item: fitting it would make the shared component own more than the asking.

Not considered by this slice: `BoostCapDialog.tsx` and `DeleteBusinessDialog.tsx` (§14 LF3B-F1 names them with the money dialogs). They stay on the later-adopter list unless SA rules otherwise in SQ-3.

## 3. Visible changes

**Under (c): none.** No file under `app/`, `components/`, `lib/` or `tests/` changes.

For SA's comparison, (b) would have shown: Confirm and Continue in the shared sky tone with a spinner instead of `ui/button`'s default; Close and Back in `ADMIN_BUTTON` instead of the outline button; focus on Close when the dialog opens instead of the first field; Enter in the Credits field moves to the confirm step; Escape on the confirm step goes Back instead of closing.

## 4. Files

| File | Action | Reason |
|---|---|---|
| `docs/workplans/ADMIN_LAYOUT_LF10_WORKPLAN.md` | create | this workplan |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-10 row; Change History; after SA rules, one sentence in §14 LF3B-F1 |

Not touched: `CreditFormDialog.tsx`, `CreditsBlock.tsx`, `creditCopy.ts`, `AdminConfirmDialog.tsx`, every pin file (`businessDrawer.pins.credits`, `.boost`, `.dangerReads`), `tests/admin/drawerPinHarness.ts`, `source.guard.test.ts`, `layoutFolder.guard.test.ts`, every route.

## 5. Empty-diff proof (at close)

| Check | Expected |
|---|---|
| `git diff --stat origin/main -- app/ components/ lib/ tests/` | empty |
| `git diff origin/main -- app/admin/users/components/CreditFormDialog.tsx` (the `postJson` fetch block included) | empty: URL, method, headers, body and `cache` byte-identical |
| `git diff --stat origin/main -- app/admin/users/__tests__/ tests/admin/drawerPinHarness.ts` | empty |
| `npx jest app/admin/users app/admin/components/layout` | green, unchanged from `origin/main` (sanity run only; nothing changed) |

## 6. Questions for SA

| ID | Question | Dev default |
|---|---|---|
| SQ-1 | Accept (c): close LF-10 with no code, `CreditFormDialog` a permanent non-adopter (a form with a review step, not a confirmation)? | Yes |
| SQ-2 | If SA prefers (b) anyway, it needs a new shared prop (a "back" action distinct from close) and edits to BD-15. Confirm that is out of bounds for a layout follow-up | Out of bounds |
| SQ-3 | `BoostCapDialog` and `DeleteBusinessDialog` remain on the later-adopter list, unassessed. Check them in a later slice, or close the list here? | Leave on the list; check only if a future change touches them |

## Task List

- ✅ Step 1: branch `feature/admin-layout-lf10-money-dialogs` from `origin/main` `dfd2d9da` (LF-9 merged)
- ✅ Step 2: read the requirement (§1, §14, LF-7 and LF-9 entries), the LF-7 and LF-9 workplans, `CreditFormDialog.tsx`, `CreditsBlock.tsx`, `AdminConfirmDialog.tsx`, the pin suite and harness, `source.guard` BD-15
- ✅ Step 3: this workplan; §1 LF-10 row and Change History in the requirement
- ⬜ Step 4: SA review of the recommendation
- ⬜ Step 5: if (c) is accepted, add the non-adopter sentence to §14 LF3B-F1 and set the §1 row to "Closed, no code"; run the §5 proof

## SA Review Notes

**Reviewed by SA — 2026-10-16**
**Status:** ✅ Approved: option (c), LF-10 closed without code

### Comments
1. §1 claims — verified against `CreditFormDialog.tsx`: one `<DialogContent data-testid="credit-form-dialog" ... onCloseAutoFocus={onCloseAutoFocus}>` across both steps (`step` state); `handleOpenChange` refuses every close while `inFlight`; `inFlight` set before the await in `submit`; a refusal calls `setStep('form')` in the same node; request id minted only on open; Close and Back are `type="button"` with no `<form>`. — SA: resolved
2. Pins — verified: `businessDrawer.pins.credits` asserts `screen.getByTestId('credit-form-dialog')` is `toBe(dialog)` after Escape in flight and after a refusal (GIVE-4, GIVE-5 and the TAKE equivalents). Option (a) breaks these. — SA: resolved
3. BD-15 — verified: `source.guard.test.ts` requires exactly one `<DialogContent ` carrying the named `onCloseAutoFocus` handler in `CreditFormDialog.tsx` (and `BoostCapDialog.tsx`). Options (a) and (b) both need it edited. — SA: resolved
4. Shared contract — verified: `AdminConfirmDialog` Cancel always calls `onClose`, it is always a `<form>` (Enter submits), and focus return is `onReturnFocus` with no event. Option (b) would make `onClose` mean Back on one step and need a new shared back prop (CLAUDE.md rule 7) for one consumer. Out of bounds for a layout follow-up (SQ-2). — SA: resolved

### Rulings
- **SQ-1:** Accept (c). `CreditFormDialog` is a form with a review step, not a confirmation; permanent non-adopter. Its money guarantees already meet or exceed the shared ones.
- **SQ-2:** Confirmed out of bounds.
- **SQ-3:** Close the list. `BoostCapDialog` is the same two-step form shape (one node, same `toBe(dialog)` pins, same BD-15 guard) and `DeleteBusinessDialog` is a preview, typed-confirmation and result dialog (ask-then-report); both are permanent non-adopters. The LF3B-F1 later-adopter list is closed and the shared-dialog stream ends here.

### Approval
[x] Workplan approved — close LF-10 with no code; no QA needed; §5 proof is the empty `app/ components/ lib/ tests/` diff

## QA Testing Report

Not needed under (c): no code changes.

## Commit Info

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan written (Dev) | Options (a) to (c) checked; recommendation (c), close with no code. LF-9 already on `origin/main` |
| 2026-10-16 | SA review (SA) | Dev's claims verified against the dialog, the credits pins and BD-15. (c) accepted: LF-10 closed without code. SQ-3: BoostCapDialog and DeleteBusinessDialog permanent non-adopters; later-adopter list closed |
