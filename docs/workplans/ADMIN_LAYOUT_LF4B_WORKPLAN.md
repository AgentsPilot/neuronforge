# Workplan: Admin Layout LF-4b (Businesses drawer, inside the money blocks)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §1.2 (BD-5, BD-8, BD-9, BD-14, BD-15), §1.3 (PIN-a to PIN-k), §4 (the Businesses line), §7.3 (AC-4.5, AC-4.7, AC-4.8, AC-4.10), §8 (LF-4b row, including the D-20 exception removal), §13 (SA-C7, SA-C8), §14 (LF4A1-F2, LF4A2-F1)
**Branch:** `feature/admin-layout-lf4b`, cut from `feature/admin-layout-lf4a2` at `d8bbcd5e`. PR #343 (LF-4a.2) is merged (`e956e251` on `origin/main`). C1: `origin/main` merged into the branch before any product edit, merge commit `4c5d9a88`; on that base `app/admin/users` (pins included) ran green: 20 suites, 514 tests
**Path:** Full cycle. SA approved this workplan with conditions C1 to C11, applied below (see "SA conditions applied")
**Date:** 2026-10-13
**Status:** Built, awaiting SA code review + QA. Everything uncommitted

## Overview

Inside the two money blocks of the Businesses drawer (`CreditsBlock`, `BoostBlock`): money buttons move into a bordered action bar, apart from the figures; the credit lots and the top-ups show their newest 3 and fold the rest (hidden, never unmounted); the five `text-slate-500` information lines become `text-slate-400`; the two `h4`s become labels, so the D-20 Credits & billing heading exception goes; closing Give credits, Take back, Take back credits (top-up), Set limit or Back to default returns focus to its opener, or to the Credits & billing heading when the opener has gone (F-108); and after a successful Give or Take back the drawer calls the page's `refreshList` once, so the strip, the list row and the Credits block agree (BD-14).

**Money is the hard line.** No request, body, header, `cache` option, request id, confirm step, dialog word or in-flight rule changes. The reconcile button stays exactly where it is (LF-4c). The Escape-mid-delete defect stays with LF-F1. The only pin edits are the two the requirement names: the BD-14 list-read counts, and TOPUP-3 moving to the real fold.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [The new block layout](#the-new-block-layout)
4. [BD-14: one list read after Give or Take back](#bd-14-one-list-read-after-give-or-take-back)
5. [BD-15: focus return (F-108)](#bd-15-focus-return-f-108)
6. [Contrast and the D-20 exception](#contrast-and-the-d-20-exception)
7. [Files to Create / Modify](#files-to-create--modify)
8. [Permitted pin edits (the complete list)](#permitted-pin-edits-the-complete-list)
9. [Other existing tests edited](#other-existing-tests-edited)
10. [Tests to add](#tests-to-add)
11. [Mutation runs planned](#mutation-runs-planned)
12. [Browser checks (QB-x)](#browser-checks-qb-x)
13. [Logging and entitlements](#logging-and-entitlements)
14. [Size estimate](#size-estimate)
15. [Risks](#risks)
16. [Questions for SA](#questions-for-sa)
17. [Questions for the user](#questions-for-the-user)
18. [Task List](#task-list)
19. [SA Review Notes](#sa-review-notes)
20. [QA Testing Report](#qa-testing-report)
21. [Commit Info](#commit-info)
22. [Change History](#change-history)

---

## Analysis Summary

Read in full on 2026-10-13: the requirement (§1 to §14), the LF-4a.1 and LF-4a.2 workplans with their SA reviews, every product file under `app/admin/users/**` (page, hook, 15 components, copy files), the three pin files, `creditsBlock.render`, `boostBlock.render`, `boostBlock.actions.render`, `businessOsPanel.render`, `businessDetail.render` (D-20), `businessDrawer.layout.render`, `users/__tests__/source.guard`, `layoutFolder.guard` (Businesses entry), `contrast.lf1.source.guard`, `components/ui/dialog.tsx` and `AdminDrawer.tsx`.

| What | Where today | Relevance |
|---|---|---|
| Credits block | `CreditsBlock.tsx`: `h4` "Credits" (`:308`); success notice (`:313`); usage figures; extra credits; every lot in one `ul` (`:370-379`); "Dates are shown in UTC" in `text-slate-500` (`:380`); Give credits (emerald) at the very end (`:391-398`) or the own-account sentence | Action bar, lot fold, contrast, label, BD-14, focus |
| Credits dialog | Rendered only while open: `{dialog && limits && <CreditFormDialog open …/>}` (`:403`). No trigger, so on close Radix focuses nothing and focus falls to `<body>` (F-108). Closing (Escape, X, Close) and success both unmount it | `onCloseAutoFocus` |
| Take back from a top-up | `BoostBlock` `TakeBackAction` calls `takeBack.onTakeBack(lotId)`; the panel sets `takeBackRequest { lotId, seq }`; `CreditsBlock` opens its dialog on that lot from its loaded data (BD-9, `:281-292`) | The opener must travel with the request (SA-C8) |
| Top-ups block | `BoostBlock.tsx`: `h4` "Credit top-ups" (`:469`); notice; test-key note; every top-up in one `ul` (`:523-527`); truncated note `text-slate-500` (`:529`); `CapSection` (`boost-cap`) with "Spending limit", the value, then Set limit / Back to default (`:362-383`), then the Limit changes `details`; reconcile button at the end (`:550-560`) | Action bar, top-up fold, contrast, label, focus |
| Other slate-500 lines | `BoostBlock.tsx:259` ("Nothing left to take back"), `:277` ("Take back in Credits above"), `:325` (Session id) | Contrast |
| Top-ups re-read | `BoostBlock`'s effect sets `load` back to `loading` on every re-read (`:440`), so the whole `ok` branch, the Set limit and Back to default buttons included, unmounts while it runs | Focus after a Set limit / Back to default success (SQ-3) |
| Order of rows | The credits route sorts lots newest first (`credits/accounts/[accountId]/route.ts:75-79`); the boost route merges both modes newest first (`boostAdminView.ts:160-165`) | "Newest 3" is the first 3 as sent |
| `refreshList` | The page's `fetchUsers` (one identity, `useCallback` with no deps); `BusinessDetail` already holds it and calls it from `onRemoved` / `onDeleted`. `BusinessOsPanel` does not receive it today | BD-14 wiring |
| Remount safety | The page keys `BusinessDetail` by `selected.id`; the panel's reads key on `[accountId]`; the money blocks sit in one fixed slot (LF-4a.2 C7). A list Refresh keeps `bos-panel`, `credits-block` and `boost-block` as the same nodes (LF-4a.2 C7 identity test) | A list re-read sends no other read |
| Local fold | `components/drawerFolds.tsx` `ShowMoreList` (LF-4a.2): first 3, the rest in a second `ul` with `hidden`, a toggle with `aria-expanded` / `aria-controls`, `ADMIN_BUTTON` | Reused for lots and top-ups. No new fold code |
| Pins that pin position | GIVE-1: `credits-block` contains Give. TAKE-1: the first lot row contains its Take back. CAP-1, CAP-2: `boost-cap` contains Set limit / Back to default. REC-1: `boost-block` contains reconcile | The action bars must stay inside those elements, or a pin outside the permitted list would need an edit |
| `CreditsLeftCell` | The "no business" dash is `text-slate-500` (`:42`), LF4A2-F1 | Not assigned to LF-4b by the requirement; SQ-6 |

No file in scope imports `lib/business-os/entitlements/`, and this slice adds no such import.

---

## Implementation Approach

1. **Action bars inside the blocks, at the head of the part they act on.** Credits: one bar at the top of the Credits block, holding Give credits. Top-ups: the Spending limit part (`boost-cap`) opens with a bar holding Set limit and Back to default, before the current value and the Limit changes fold. Each bar is a bordered row (`MONEY_ACTION_BAR`), visually apart from the figures (BD-5). The per-row actions (Take back on a lot, Take back credits on a top-up) stay on their rows (BD-5, §5.8 D-8). The bars render under exactly today's conditions: Give only after a good read and not on the admin's own account; Set limit only when the limit read is ok and not own account; Back to default only when an admin limit is active. With no action to show, no bar renders, and the own-account sentences stay where they are today. The reconcile button is not moved or restyled (LF-4c).
2. **Folds reuse `ShowMoreList`.** Lots: `testId="credits-lots-more"`. Top-ups: `testId="boost-purchases-more"`. Both are already newest first from the server. With 3 or fewer there is no toggle. The rest is a `hidden` `ul`, so every lot row, its Take back button and every top-up row stay mounted (BD-8), and the BD-9 path from a top-up to a folded lot is untouched (its state is data, not DOM).
3. **BD-14 through one callback, called in one place.** `CreditsBlock` gains an optional `onCreditsChanged?: () => void`, called once inside `handleSuccess`, after `reload()`. `BusinessOsPanel` gains a required `onCreditsChanged: () => void` and passes it on. `BusinessDetail` passes `onCreditsChanged={() => { void refreshList(); }}`, the shape `onRemoved` already uses.
4. **BD-15 through a small local hook.** New file `components/moneyBlockUi.ts` (no JSX): `useReturnFocus`, `focusSectionHeading` and the `MONEY_ACTION_BAR` class. Each block keeps its own opener ref and passes the hook's `onCloseAutoFocus` to its dialog. `CreditFormDialog` and `BoostCapDialog` gain an optional `onCloseAutoFocus` prop, forwarded to `DialogContent`. No shared export changes.
5. **Labels, not headings.** The two `h4`s become `p` labels with the same classes, icon and words. Credits & billing then holds exactly one heading, so the D-20 exception is removed.
6. **Contrast.** Five information lines to `text-slate-400`. The contrast guard gains a Businesses entry.
7. **Decorative colour in the bars (SQ-5).** The bar buttons take the shared `ADMIN_BUTTON` class instead of emerald, and the Stripe links take the drawer's link style instead of emerald. Status tones (the Live badge, status chips, success notices, the "active" word in Limit changes) are unchanged.

---

## The new block layout

Inside section 1, Credits & billing (the `DrawerSection` and its `h3` are unchanged, LF-4a.2):

```text
credits-block
  p (label, was h4)        Coins icon + "Credits"
  credits-actions          bordered bar: [Give credits]            (only when today's Give shows)
  credits-success          notice (unchanged; outside the ok branch, QA11c-2)
  "Loading credits…" / credits-error                                (unchanged)
  credits-usage            allowance, used, plan left, over the plan (unchanged)
  credits-extra            "Extra credits" figure and note           (unchanged)
    credits-inconsistent                                             (unchanged)
    ul: newest 3 credits-lot rows, each with its own [Take back]
    ul credits-lots-more-rest (hidden): the rest, mounted
    [Show N more] credits-lots-more  (aria-expanded, aria-controls)
    p "Dates are shown in UTC."  text-slate-400
  credits-own-account      (own account only; same place as today)
  CreditFormDialog         (state-opened; onCloseAutoFocus from the hook)

boost-block
  p (label, was h4)        Receipt icon + "Credit top-ups"
  boost-notice / loading / boost-error                               (unchanged)
  boost-test-key-note                                                (unchanged)
  ul: newest 3 boost-purchase rows, each with Payment link, Session id
      (text-slate-400), its own [Take back credits] or its slate-400 line
  ul boost-purchases-more-rest (hidden): the rest, mounted
  [Show N more] boost-purchases-more
  boost-truncated          text-slate-400
  boost-cap                "Spending limit" label
    boost-cap-actions      bordered bar: [Set limit] [Back to default]
    boost-cap-override / boost-cap-default                           (unchanged)
    boost-cap-history      Limit changes (latest 20), details        (unchanged)
  boost-reconcile / boost-own-account                                (unchanged, not moved: LF-4c)
  BoostCapDialog           (state-opened; onCloseAutoFocus from the hook)
  BoostReconcileDialog     (unchanged: LF-4c moves it, with DialogTrigger)
```

Why the Set limit bar sits inside `boost-cap` and not at the top of the top-ups block: CAP-1 and CAP-2 assert `boost-cap` contains the opener. Moving the buttons out of it would need a pin edit that the requirement does not name, so it is out of scope (SQ-4).

---

## BD-14: one list read after Give or Take back

**Wiring.**

| File | Change |
|---|---|
| `BusinessDetail.tsx` | `<BusinessOsPanel user={user} allProducts={…} onCreditsChanged={() => { void refreshList(); }} />` |
| `BusinessOsPanel.tsx` | Prop `onCreditsChanged: () => void`, passed as `<CreditsBlock accountId={accountId} businessLabel={businessLabel} … onCreditsChanged={onCreditsChanged} />` (the two props the source guard matches stay first) |
| `CreditsBlock.tsx` | `handleSuccess(lines)`: `setDialog(null); setNotice(lines); reload(); onCreditsChanged?.();` and nowhere else |

**Why exactly one list read.**

- `handleSuccess` runs once per success: `CreditFormDialog.submit` is guarded by its `inFlight` ref, a double click sends one POST, and `onSuccess` is called once per answered success (PIN-f, GIVE-4, TAKE-5).
- The call is an event-time call, not an effect, so no re-render, re-read or prop change can fire it again.
- A failure, a close (Escape, X, Close, Back) and the Credits re-read never reach `handleSuccess`.
- The Take back from a top-up opens the same `CreditsBlock` dialog, so it takes the same path (TOPUP-1).
- Set limit, Back to default and reconcile do not change credits left, so they do not call it (SQ-8).
- `fetchUsers` has one identity, and a list read sends no other read: `BusinessDetail` is keyed by id, the panel's reads key on `[accountId]`, `CreditsBlock` on `[accountId, reloadToken]`, `BoostBlock` on `[url, reloadToken]`, and the money blocks keep their nodes across a list Refresh (LF-4a.2 C7). So the counts after a Give are credits 2, top-ups 1, list 2.

**Agreement.** After the list answer lands, the strip's Credits left (`CreditsLeftCell` from the row) and the list row's cell show the new row figure, and the Credits block shows its own re-read. A new test asserts all three after a Give (T-B3).

**AC-4.3 unaffected.** This is a post-action read. PIN-k (READS-1 to READS-4) stays unedited.

---

## BD-15: focus return (F-108)

**The hook** (`components/moneyBlockUi.ts`, local to the Businesses folder):

```typescript
export function useReturnFocus(rootRef: RefObject<HTMLElement | null>) {
  const opener = useRef<HTMLElement | null>(null);
  const guarding = useRef(false);

  /** Called by each opener's click handler with event.currentTarget. */
  const remember = useCallback((element: HTMLElement | null) => {
    opener.current = element;
  }, []);

  /** Passed to the dialog's DialogContent: Radix's own return would go to <body> (no trigger). */
  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const target = opener.current;
    if (target && target.isConnected) {
      target.focus();
      guarding.current = true;
    } else {
      focusSectionHeading(rootRef.current);
    }
  }, [rootRef]);

  // After every commit of the block: if the opener left the document after the
  // dialog closed (the re-read emptied the lot, or Back to default ended the
  // limit) and focus fell to <body>, move it to the section heading.
  useLayoutEffect(() => {
    if (!guarding.current) return;
    const active = document.activeElement;
    if (opener.current?.isConnected && active === opener.current) return;
    if (!opener.current?.isConnected && (active === null || active === document.body)) {
      focusSectionHeading(rootRef.current);
    }
    guarding.current = false;
  });

  return { remember, onCloseAutoFocus };
}

/** The Credits & billing h3, made focusable (tabIndex -1); never <body>. */
export function focusSectionHeading(from: HTMLElement | null): void {
  const heading = from?.closest('[role="group"]')?.querySelector('h3') ?? null;
  const target = heading ?? from; // a block rendered alone (unit tests): its own root
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}
```

(Shown for review; the build follows SA's rulings on SQ-1 and SQ-2.)

**Openers.**

| Dialog | Opener | How the opener reaches the hook |
|---|---|---|
| Give credits | `credits-give` | `onClick={(event) => { remember(event.currentTarget); openDialog({ kind: 'give' }); }}` |
| Take back (a lot) | that lot's `credits-take-back` | `LotRow`'s `onTakeBack(lot, event.currentTarget)` |
| Take back credits (a top-up) | that top-up's `boost-take-back` | `TakeBack.onTakeBack(lotId, event.currentTarget)`; the panel stores it in the request, `{ lotId, seq, opener }`; `CreditsBlock`'s request effect calls `remember(takeBackRequest.opener)` just before it opens the dialog (SA-C8: the opener travels with the request) |
| Set limit / Back to default | `boost-cap-set` / `boost-cap-end` | `remember(event.currentTarget)` in `BoostBlock`, then `setCapDialog(mode)` |
| Reconcile | not in scope | LF-4c moves it to Jobs with `DialogTrigger` |

**Why the layout effect catches the top-up case.** After a take-back that empties the lot, the top-up's button is replaced by "Nothing left to take back". That happens when the panel re-renders with the new take-back lots (the `onTakeBackableLots` call after the Credits re-read). `CreditsBlock` is not memoised, so it re-renders in that same commit, and its layout effect runs after all of the commit's DOM changes. A lot-row opener is removed in `CreditsBlock`'s own commit. Back to default's opener is removed in `BoostBlock`'s own commit.

**What the admin sees.**

| Close | Focus goes to |
|---|---|
| Escape, X, Close, Back then Close, on any of the five | its opener |
| Give success | Give credits (the Credits re-read keeps the button) |
| Take back success, lot still has credits | that lot's Take back |
| Take back success that empties the lot | the Credits & billing heading |
| Top-up Take back success, lot still has credits | that top-up's Take back credits |
| Top-up Take back success that empties the lot | the Credits & billing heading |
| Set limit / Back to default success | the Credits & billing heading: the top-ups re-read unmounts the bar while it runs (SQ-3) |
| A failed Credits re-read after a success (the Give button is gone) | the Credits & billing heading |

Never `<body>`. The dialog files gain only the forwarded prop, written `onCloseAutoFocus={onCloseAutoFocus}` (a named handler, not an inline arrow: the `source.guard` dialog-class matcher reads a `DialogContent` tag up to its first `>`).

---

## Contrast and the D-20 exception

**Information text to `text-slate-400` (T-5; requirement §4 Businesses line, §8 "their slate-500 lines").**

| File | Line today | Element |
|---|---|---|
| `CreditsBlock.tsx` | `:380` | "Dates are shown in UTC." (the browser check's element, BC-4) |
| `BoostBlock.tsx` | `:259` | `boost-take-back-none` "Nothing left to take back" |
| `BoostBlock.tsx` | `:277` | `boost-take-back-above` "Take back in Credits above" |
| `BoostBlock.tsx` | `:325` | `boost-session-id` "Session cs_…" |
| `BoostBlock.tsx` | `:529` | `boost-truncated` |
| `CreditsLeftCell.tsx` | `:42` | the "no business" dash (LF4A2-F1), **only if SA agrees (SQ-6)** |

No words change. `DeleteBusinessDialog.tsx:276` and `:509` are also slate-500, but that dialog is the hidden AD-1 entry (`SHOW_AD1_DELETE_ENTRY = false`) and is not money-block UI; it is named as an exclusion in the guard, not edited.

**Guard.** `app/admin/__tests__/contrast.lf1.source.guard.test.ts` gains a `Businesses` entry: `walk('app/admin/users')` minus the named exclusion `app/admin/users/components/DeleteBusinessDialog.tsx` (and `CreditsLeftCell.tsx` if SQ-6 is no). Walked, so a later file is covered.

**D-20.** The two `h4`s become `p` labels (same classes, icon `aria-hidden`, same words). In `businessDetail.render` D-20 the Credits & billing exception goes: every section except Plan & entitlements holds exactly one heading; Plan keeps its one named extra (the snapshot's `h3`). See "Other existing tests edited".

---

## Files to Create / Modify

### Product files

| File | Action | Reason |
|---|---|---|
| `app/admin/users/components/CreditsBlock.tsx` | modify | `h4` to label; `credits-actions` bar with Give (`ADMIN_BUTTON`); lots in `ShowMoreList`; dates note slate-400; `onCreditsChanged` called once in `handleSuccess`; opener refs and `onCloseAutoFocus` through `useReturnFocus`; `takeBackRequest.opener` remembered; root `ref`. `readPosition`, the dialog props that shape the request, and `isTakeBackable` are unchanged |
| `app/admin/users/components/BoostBlock.tsx` | modify | `h4` to label; top-ups in `ShowMoreList`; four slate-400 lines; `boost-cap-actions` bar at the head of `boost-cap` (Set limit, Back to default, `ADMIN_BUTTON`); Stripe link to the drawer link style (SQ-5); `TakeBack.onTakeBack(lotId, opener)`; opener ref and `onCloseAutoFocus` for `BoostCapDialog`; root `ref`. `readView`, `isAdminBoostView`, the reconcile button and `BoostReconcileDialog` are unchanged |
| `app/admin/users/components/CreditFormDialog.tsx` | modify | One optional prop `onCloseAutoFocus?: (event: Event) => void`, forwarded to `DialogContent`. Nothing else |
| `app/admin/users/components/BoostCapDialog.tsx` | modify | The same optional prop. Nothing else |
| `app/admin/users/components/BusinessOsPanel.tsx` | modify | Prop `onCreditsChanged`, passed to `CreditsBlock`; `takeBackRequest` gains `opener`; `onTakeBack(lotId, opener)` |
| `app/admin/users/components/BusinessDetail.tsx` | modify | Passes `onCreditsChanged={() => { void refreshList(); }}`. The danger area, the `isLoading` gate and everything else unchanged |
| `app/admin/users/components/moneyBlockUi.ts` | create | `useReturnFocus`, `focusSectionHeading`, `MONEY_ACTION_BAR`. No fetch, no JSX, no `lib/business-os` import |
| `app/admin/users/components/CreditsLeftCell.tsx` | modify, only if SQ-6 is yes | One class on the dash |

### Test and guard files

| File | Action | Reason |
|---|---|---|
| `app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx` | modify (permitted pin edits only) | BD-14 list counts, see the next section |
| `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx` | modify (permitted pin edits only) | BD-14 list counts; TOPUP-3 on the real fold |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | create | Bars, folds, BD-14 agreement, focus return, contrast, through the whole page |
| `app/admin/users/__tests__/moneyBlockUi.render.test.tsx` | create | The hook and the heading fallback on a small harness |
| `app/admin/users/__tests__/creditsBlock.render.test.tsx` | modify (add tests only) | `onCreditsChanged` once after a success, never after a failure, a close or the re-read |
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | modify (deliberate) | D-20 exception removed |
| `app/admin/users/__tests__/boostBlock.actions.render.test.tsx` | modify (deliberate) | One assertion: the top-up opener now passes itself |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | modify (deliberate) | The `panel()` helper passes `onCreditsChanged={jest.fn()}` |
| `app/admin/users/__tests__/source.guard.test.ts` | modify (strengthen) | `moneyBlockUi.ts` joins `SCREEN_FILES`; new checks listed in "Tests to add" |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | modify (strengthen) | The Businesses entry |

### Not touched

| File | Why |
|---|---|
| `app/admin/users/components/BoostReconcileDialog.tsx`, `boostCopy.ts` | Reconcile is LF-4c |
| `app/admin/users/components/DeleteBusinessDialog.tsx`, `components/business-os/purge/TestAccountCleanupPanel.tsx` | Danger area unchanged; Escape-mid-delete is LF-F1 |
| `app/admin/users/components/drawerFolds.tsx` | Reused as is |
| `app/admin/users/page.tsx`, `useBusinessDetails.ts` | `refreshList` is already passed to the drawer; SA-F3 not triggered |
| `app/admin/components/layout/**` (product files), `components/ui/**` | No shared change |
| `creditCopy.ts`, `types.ts`, `BusinessSummaryStrip.tsx`, `AllProductsUsage.tsx`, `BusinessAuditSection.tsx` | Not needed |
| `businessDrawer.pins.dangerReads.render.test.tsx` | No edit |

---

## Permitted pin edits (the complete list)

The requirement names exactly two kinds (§1.3, BD-14, SA-C7; §14 LF4A1-F2). Nothing else in the three pin files changes: no request, body, header, `cache`, request id, confirm step, dialog word, opener assertion, failure assertion or PIN-k list. QA checks with `git diff` on the three paths that the hunks are exactly these.

### A. BD-14: the list-read count after a successful Give or Take back

Each line is `await expectReads({ … })` after `quiet()`. Only `list` changes, and only after a success. Failure-only reads, OWN-1, CAP, REC and the danger file stay as they are, and now also pin that those paths send no list read.

| File | Test | Before | After |
|---|---|---|---|
| credits | GIVE-1 | comment "today no top-ups re-read and no list re-read (BD-14 adds the list read in LF-4b, by name)"; `expectReads({ credits: 2, boost: 1, list: 1 })` | comment "one Credits re-read and one list re-read (BD-14); no top-ups re-read"; `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | GIVE-2 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | GIVE-3 (two successes) | `expectReads({ credits: 3, boost: 1, list: 1 })` | `expectReads({ credits: 3, boost: 1, list: 3 })` |
| credits | GIVE-4 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | TAKE-1 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | TAKE-2 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | TAKE-3 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | TAKE-4, the second `expectReads` (after the retry succeeds) | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| credits | TAKE-5 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |
| boost | TOPUP-1 | comment as GIVE-1; `expectReads({ credits: 2, boost: 1, list: 1 })` | comment as GIVE-1 after; `expectReads({ credits: 2, boost: 1, list: 2 })` |
| boost | TOPUP-2 | `expectReads({ credits: 2, boost: 1, list: 1 })` | `expectReads({ credits: 2, boost: 1, list: 2 })` |

**Unchanged on purpose:** GIVE-5 (`list: 1`, a refusal), TAKE-4's first `expectReads` (`list: 1`, after `exceeds_remaining`), OWN-1, CAP-1 to CAP-5, REC-1 to REC-3, READS-1 to READS-4, DANGER-1 to DANGER-5.

That is 11 tests, 11 count lines and 2 comment lines.

### B. LF4A1-F2: TOPUP-3 on the real fold

**Before** (`businessDrawer.pins.boost`, TOPUP-3):

```typescript
const drawer = await openDrawer();
// BD-8: a fold hides, never unmounts. There is no fold control yet, so the rows are hidden by hand.
for (const row of within(drawer).getAllByTestId('credits-lot')) row.hidden = true;
fireEvent.click(button(topUpRow(drawer), 'boost-take-back'));
const dialog = await screen.findByTestId('credit-form-dialog');
expect(within(dialog).getByRole('heading').textContent).toBe(`Take back credits from ${BUSINESS}`);
expect(dialog.textContent).toContain('13,750 left on this gift.');
expect(within(dialog).getByTestId('paid-credits-confirm')).toBeTruthy();
expect(posts()).toEqual([]);
```

**After** (title "TOPUP-3 (folded lot, BD-8): with the top-up's lot inside the closed lot fold, the top-up opener still opens Take back on its lot"; C2 applied: the newer lots have their own figures, and the folded row is asserted to be the 13,750 one):

```typescript
// Three newer lots first (the route sends newest first), so PAID_LOT is the 4th: inside the fold.
// Their figures differ from PAID_LOT's (SA C2), so "13,750 left" can only be the folded lot.
const newer = (n: number): CreditLotView => ({
  ...PAID_LOT,
  id: `cccccccc-3333-4333-8333-00000000000${n}`,
  credits: n * 100,
  remaining: n * 100,
  createdAt: `2026-10-0${n + 1}T12:05:00.000Z`,
});
const data = credits([newer(3), newer(2), newer(1), PAID_LOT]);
creditsReply = () => ok(data);
const drawer = await openDrawer();
const toggle = button(drawer, 'credits-lots-more');
expect(toggle.textContent).toBe('Show 1 more');
expect(toggle.getAttribute('aria-expanded')).toBe('false');
const rest = within(drawer).getByTestId('credits-lots-more-rest');
expect(rest.hidden).toBe(true);
const lots = within(drawer).getAllByTestId('credits-lot');
expect(lots).toHaveLength(4); // hidden, never unmounted (BD-8)
expect(rest.contains(lots[3])).toBe(true);
expect(lots[3].textContent).toContain('13,750 left');
fireEvent.click(button(topUpRow(drawer), 'boost-take-back'));
const dialog = await screen.findByTestId('credit-form-dialog');
expect(within(dialog).getByRole('heading').textContent).toBe(`Take back credits from ${BUSINESS}`);
expect(dialog.textContent).toContain('13,750 left on this gift.');
expect(within(dialog).getByTestId('paid-credits-confirm')).toBeTruthy();
expect(toggle.getAttribute('aria-expanded')).toBe('false'); // the fold was never opened
expect(posts()).toEqual([]);
```

The dialog assertions are the same three lines as before. The `newer` ids and dates are exact at build time (whatever the fixture allows); the shape is as above.

**Nothing else.** If the build finds any other pin line that fails, that is a defect in the build, not a licence to edit: Dev stops and reports to TL.

---

## Other existing tests edited

Deliberate, not pins.

| Test | Before | After | Why |
|---|---|---|---|
| `businessDetail.render` D-20 | Credits & billing allows two extras, the `h4` inside `credits-block` and the one inside `boost-block`; `expectedExtras` is 2 for it | Credits & billing allows none: `expectedExtras` 0, `allowedExtra` returns `[]` for it; plus `credits-block` and `boost-block` each contain no `h1` to `h6`. The comment drops the LF-4b note. Plan & entitlements keeps its one named extra | §8 LF-4b: remove the exception when the `h4`s become labels |
| `boostBlock.actions.render` "the top-up's Take back calls the panel" (line 355) | `expect(onTakeBack).toHaveBeenCalledWith(LOT)` | `expect(onTakeBack).toHaveBeenCalledWith(LOT, screen.getByTestId('boost-take-back'))` | SA-C8: the opener travels with the request |
| `businessOsPanel.render` `panel()` helper | `<BusinessOsPanel user={…} allProducts={null} />` | adds `onCreditsChanged={jest.fn()}` | The panel's new required prop (SQ-10). Assertions unchanged |
| `source.guard` | — | strengthened, see below | |
| `contrast.lf1.source.guard` | four pages | adds the Businesses entry | §4 |

---

## Tests to add

### `businessDrawer.money.render.test.tsx` (whole page, opened from the row's Open button)

Route-table stub in the `businessDrawer.layout.render` style (with its `quiet()`), plus one queue for the entitlements POST and a list answer that can change between reads. Not the pin harness (SQ-9). `jest.setTimeout(30_000)`, `asyncUtilTimeout` 5 s, console guard, as the sibling files.

| Id | Asserts |
|---|---|
| T-A1 Credits bar | `credits-actions` is inside `credits-block`, before `credits-usage` in document order; it holds `credits-give` and no figure (no `dl`, no `credits-extra-figure`); `credits-usage` and `credits-extra` hold no button other than the lots' Take back and the fold toggle |
| T-A2 Spending limit bar | `boost-cap-actions` is inside `boost-cap`, before `boost-cap-default` / `boost-cap-override`; holds `boost-cap-set` (and `boost-cap-end` with an active limit); the reconcile button is still the block's last button, unmoved |
| T-A3 own account | No `credits-actions`, no `boost-cap-actions`; both own-account sentences shown where they are today |
| T-A4 bar buttons | Give, Set limit and Back to default carry `ADMIN_BUTTON` and no `emerald` class; a Stripe payment link has no `emerald` class (SQ-5) |
| T-F1 lot fold | 5 lots: 3 visible, `credits-lots-more` "Show 2 more" with `aria-expanded="false"` and `aria-controls` naming the hidden list; all 5 rows in the DOM; toggling shows them and reads "Show fewer"; no request after a quiet window; `credits-block` is the same node after toggling (C7) |
| T-F2 lot fold, 3 or fewer | 3 lots: no toggle, no hidden list |
| T-F3 top-up fold | 5 top-ups: 3 visible, "Show 2 more", the rest hidden and mounted; no request on toggle; opening the fold and pressing the 4th top-up's Take back credits opens the Credits dialog on its lot (BD-9 through the top-up fold) |
| T-F4 Take back on a folded lot | Opening the lot fold and pressing the 4th lot's own Take back opens its dialog (same dialog words as TAKE-1) |
| T-B1 BD-14 Give | After a successful Give and a quiet window: exactly one more list read than before the Give; credits reads 2; top-ups reads 1 |
| T-B2 BD-14 no read | A refused Give, an Escape close, a Set limit success and a Back to default success each add no list read |
| T-B3 BD-14 agreement | The list's second answer gives Dana a different `creditsLeft`: after the Give, `within(strip-credits-left)` and `within(row-credits-cell)` show the same new text and `data-band`; `credits-block` shows the re-read's figures; `bos-panel`, `credits-block`, `boost-block` are the same nodes (no remount) |
| T-B4 BD-14 top-up path | Take back credits on a top-up, success: one list read |
| T-R1 focus, Give | `credits-give` focused and clicked; Escape: `document.activeElement` is `credits-give`. Open again, success: after quiet, still `credits-give` |
| T-R2 focus, Take back | Close: that lot's Take back. Success with credits left: that lot's Take back. Success that empties the lot (the re-read sends `remaining: 0`): the Credits & billing `h3`, which has `tabindex="-1"` |
| T-R3 focus, top-up Take back | Escape: that top-up's `boost-take-back` (not anything in the Credits block). Success that empties the lot: the Credits & billing `h3` |
| T-R4 focus, Set limit / Back to default | Escape: its opener. Success: the Credits & billing `h3` (SQ-3) |
| T-R5 never body | In every case above, after quiet, `document.activeElement` is neither `document.body` nor `null` |
| T-C1 contrast | The five lines carry `text-slate-400`; no element inside `credits-block` or `boost-block` has `text-slate-500` or `text-slate-600` |

### `moneyBlockUi.render.test.tsx` (unit, small harness inside a `role="group"` with an `h3`)

- The opener still in the document: focus returns to it, and `preventDefault` was called on the event.
- The opener removed before the close: focus goes to the `h3`, which gains `tabindex="-1"`.
- The opener removed in a later commit while it holds focus: the next commit moves focus to the `h3`.
- Focus moved to another element before the opener is removed: focus is left alone and guarding stops.
- No `role="group"` ancestor: focus goes to the block root.

### `creditsBlock.render.test.tsx` (added cases only)

- `onCreditsChanged` is called once after a Give success and once after a Take back success; not after a refused POST, an Escape close, or the Credits re-read; and a replayed success calls it once.

### `source.guard.test.ts` (strengthened)

- `moneyBlockUi.ts` joins `SCREEN_FILES` (no `lib/business-os` import, no console, no repository) and the "no `fetch(`" list.
- `BusinessDetail` passes `onCreditsChanged={() => { void refreshList(); }}` to the panel (the `onRemoved` pattern).
- `CreditsBlock` names `onCreditsChanged?.()` exactly once, inside `handleSuccess`.
- `CreditFormDialog` and `BoostCapDialog` pass `onCloseAutoFocus={onCloseAutoFocus}` to `DialogContent`; the dialog-class check stays green.
- The existing CreditsBlock JSX regex and "no combined figure" checks stay unedited.

### Run set before handover

- The three pin files: the permitted edits only (`git diff` reviewed), green.
- Jest: `app/admin/users`, `app/admin/components`, `lib/admin/__tests__/admin-authz-surface.guard.test.ts`, `app/__tests__/tailwind-css-escape.guard.test.ts`, `lib/business-os/credits/__tests__/creditBands.guard.test.ts`, `lib/business-os/entitlements/__tests__/creditFigures.fromConfig.guard.test.ts`, `app/admin/__tests__/contrast.lf1.source.guard.test.ts`.
- `npm run test:bos-entitlements` (it collects `app/admin/users/__tests__`).
- `npm run lint:hooks`, ESLint on the touched files, scoped `tsc` with a canary (the LF-4a.1 method, `include: []`).
- `git diff --numstat`: no deletion-only file; `BoostReconcileDialog.tsx`, `boostCopy.ts`, `DeleteBusinessDialog.tsx`, `page.tsx`, the danger pin file absent from the diff.
- 0 backslashes in this workplan and the new test files.

---

## Mutation runs planned

The LF-4a.1 scratchpad runner: apply one single-line mutation (CRLF files), run the pins plus the new and edited tests, restore, compare SHA-256, then `git status`.

| # | File | Mutation | Expected to bite |
|---|---|---|---|
| MB1 | `CreditsBlock.tsx` | `onCreditsChanged` called twice in `handleSuccess` | GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2, T-B1, `creditsBlock.render` |
| MB2 | `CreditsBlock.tsx` | `onCreditsChanged` not called | the same pins, T-B1, T-B3 |
| MB3 | `CreditsBlock.tsx` | `onCreditsChanged` also called when the dialog closes without a success | T-B2, TOPUP-2 (Escape then success: list 3) |
| MB4 | `BusinessDetail.tsx` | passes a no-op instead of `refreshList` | T-B1, T-B3, GIVE-1 |
| MB5 | `BusinessOsPanel.tsx` | `key` on `CreditsBlock` from the row's `creditsLeft` (a remount on list refresh) | T-B3 (node identity), GIVE-1 (credits 3) |
| MB6 | `CreditsBlock.tsx` | lots back to one plain `ul` (no fold) | TOPUP-3, T-F1 |
| MB7 | `drawerFolds.tsx` usage in `CreditsBlock` | the rest dropped instead of hidden (render only the first 3) | TOPUP-3, T-F1, T-F4 |
| MB8 | `BoostBlock.tsx` | top-ups back to one plain `ul` | T-F3 |
| MB9 | `CreditFormDialog.tsx` | `onCloseAutoFocus` not forwarded | T-R1, T-R2, T-R3 |
| MB10 | `BusinessOsPanel.tsx` | `takeBackRequest.opener` always `null` | T-R3 |
| MB11 | `moneyBlockUi.ts` | the layout-effect guard returns at once | T-R2 (emptied lot), T-R3 (emptied lot), T-R4, unit "later commit" |
| MB12 | `moneyBlockUi.ts` | the fallback focuses nothing | T-R2, T-R4, T-R5, unit |
| MB13 | `BoostCapDialog.tsx` | `onCloseAutoFocus` not forwarded | T-R4 |
| MB14 | `CreditsBlock.tsx` | Give back below the figures, outside `credits-actions` | T-A1 |
| MB15 | `BoostBlock.tsx` | Set limit bar after the current value | T-A2 |
| MB16 | `CreditsBlock.tsx` | the dates note back to `text-slate-500` | T-C1, contrast guard |
| MB17 | `CreditsBlock.tsx` | the label back to an `h4` | D-20 |
| MB18 | `CreditFormDialog.tsx` | LF-4a.1 M1 re-run: Give `expiresAt` undefined | GIVE-1, GIVE-3, GIVE-4, GIVE-5 (proves the edited pins still bite on the request) |
| MB19 | `BoostCapDialog.tsx` | LF-4a.1 M5 re-run: `end_boost_cap` body gains `amountMinor` | CAP-2 |

---

## Browser checks (QB-x)

Read-only. A local dev server against production data, or production itself, signed in as an admin. **Open drawers, toggle folds, press Escape and the X. Never press Give credits, Take back, Take back credits, Set limit, Back to default, Run billing reconcile, Check or Delete**, and do not open their dialogs. Focus return and BD-14 therefore cannot be browser-checked without moving money; they are Jest-only (T-R1 to T-R5, T-B1 to T-B4) and QA records that.

| # | Check | Pass when |
|---|---|---|
| QB-1 | Open a Business OS account; look at Credits & billing | "Credits" and "Credit top-ups" read as labels (DevTools accessibility tree: one heading in the section, its `h3`); Give credits sits alone in a bordered bar above the figures |
| QB-2 | Spending limit | Set limit (and Back to default when an admin limit is active) sit in a bordered bar above the current value |
| QB-3 | Lots | An account with more than 3 lots shows 3 and "Show N more"; toggles with mouse, Enter and Space; Network shows no request. If no production account has more than 3, recorded as Jest-only (T-F1) |
| QB-4 | Top-ups | The same for top-ups (test-mode purchases count) |
| QB-5 | Contrast | DevTools contrast on "Dates are shown in UTC", a Session id, and "Take back in Credits above" or "Nothing left to take back" where shown: at least 4.5:1 |
| QB-6 | Money buttons present | Give, Take back, Take back credits, Set limit and the reconcile button are visible where expected. Looked at, never pressed |
| QB-7 | Strip | Credits left equals the row's cell |
| QB-8 | Close | Escape closes the drawer; focus returns to the row's Open button; no console error |

---

## Logging and entitlements

The touched product files (`CreditsBlock`, `BoostBlock`, `CreditFormDialog`, `BoostCapDialog`, `BusinessOsPanel`, `BusinessDetail`, `CreditsLeftCell`) have no `console.*` and no logger import (checked 2026-10-13). The new `moneyBlockUi.ts` has none. `page.tsx` and `useBusinessDetails.ts` are not touched, so SA-F3 is not triggered.

No import from `lib/business-os/entitlements/` is added (`business-os-entitlements` skill: nothing to register). `npm run test:bos-entitlements` runs anyway, because it collects the users tests and `creditFigures.fromConfig.guard` scans `app/admin/users/`.

---

## Size estimate

| Part | Estimate |
|---|---|
| Product code | about +190 / -60 lines over 7 files (6 modified, 1 new; 8 with SQ-6) |
| Tests | about +650 lines (2 new files, cases added to `creditsBlock.render`); pin edits 13 lines in A plus about 15 in B; about 25 lines in 3 other tests and 2 guards |
| Time | about 2 days, as §8: 1 day build and tests, half a day mutations, half a day browser checks and fixes |

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **A failed list read after a Give closes the drawer.** The page's `fail()` empties the list, so `selected` becomes null and the drawer closes; the success notice is lost (the credits were given, the list shows its error). Refresh does the same today | SQ-7. Not fixable without editing `page.tsx`, which is out of scope; proposed as finding LF4B-F1 |
| R-2 | jsdom focus semantics (Radix FocusScope's unmount timer, `activeElement` after a node is removed) may differ from a browser, and the browser cannot check focus without pressing a money button | Unit test of the hook plus whole-page tests; MB9 to MB13 must bite. Recorded as a Jest-only check |
| R-3 | The list re-read remounts a money block (a second Credits read, lost BD-9 state) | C7 identity in T-B3; exact counts in the pins; MB5 |
| R-4 | An inline arrow in a `DialogContent` tag hides `className` from the `source.guard` dialog-class matcher | Named handler `onCloseAutoFocus={onCloseAutoFocus}` |
| R-5 | Pins constrain where the bars can go (CAP-1, CAP-2: inside `boost-cap`) | Bars placed inside the asserted elements (SQ-4) |
| R-6 | A hidden lot row's Take back is unreachable by the admin until the fold opens | Intended (BD-8); BD-9 from the top-up still works on a folded lot (TOPUP-3) |
| R-7 | A request drifts while a money file is edited | Pins unedited on every request line; MB18 and MB19 re-run LF-4a.1 mutations after the edits |
| R-8 | CRLF line endings defeat a multi-line mutation | Single-line mutations only, SHA-256 restore |
| R-9 | `focusSectionHeading` sets `tabindex` on the shared `DrawerSection`'s `h3` from outside React | React does not manage that attribute on the element, so it is not overwritten; SQ-1 offers the alternative |

---

## Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| SQ-1 | The fallback target. `DrawerSection`'s `h3` has no `tabindex`, and BD-15 rules out a shared change | Focus the Credits & billing `h3`, found by `closest('[role="group"]')` from the block root, setting `tabindex="-1"` on it first (SA-C8 literally). Alternative: the block's own label (`p`, `tabindex="-1"`, React-owned), which is not "the section's heading" |
| SQ-2 | The opener can leave the document after the close (the re-read empties the lot; Back to default ends the limit) | The no-deps `useLayoutEffect` guard in `useReturnFocus`, as specified in BD-15 above: active only after a return to the opener, ends as soon as focus moves elsewhere |
| SQ-3 | `BoostBlock` sets `loading` on every re-read, so after a Set limit or Back to default success the bar unmounts and focus goes to the heading, not back to the button | Accept: the rule's fallback, never `<body>`. Keeping the old figures on screen during the re-read would change `BoostBlock`'s loading behaviour, which LF-4b does not own |
| SQ-4 | Bar placement. BD-5's sketch shows one bar at the top of Credits & billing with Give, Set limit and Back to default | One bar per block part, inside the elements the pins assert: Give at the top of `credits-block`; Set limit / Back to default at the top of `boost-cap`. One shared bar would mean lifting the cap state out of `BoostBlock` and editing CAP-1/CAP-2's `boost-cap.contains(opener)`, which the requirement does not permit |
| SQ-5 | Decorative colour inside the money blocks (BD-11, T-6). L-9 excluded the blocks in LF-4a.2 | Only what this slice rebuilds: bar buttons to `ADMIN_BUTTON`, Stripe links to the drawer link style. Status tones untouched; reconcile untouched (LF-4c). Or none, if SA reads the LF-4b row strictly |
| SQ-6 | LF4A2-F1, the `CreditsLeftCell` dash (`text-slate-500`), is recorded in §14 as a row-component follow-up with no slice | Include it here: one class, it shows in the drawer's strip, and the new Businesses contrast entry would otherwise need a second exclusion. If no, it is excluded by name in the guard and stays in §14 |
| SQ-7 | R-1: a failed list read after a Give closes the drawer | Accept and record as finding LF4B-F1 in §14 (a `page.tsx` change, its own small slice if wanted) |
| SQ-8 | BD-14 scope | Give and Take back only, including Take back credits from a top-up (same dialog). Not Set limit, Back to default or reconcile: they do not change credits left |
| SQ-9 | The new whole-page test file uses the `businessDrawer.layout.render` stub style, not the pin harness | So the LF-4a.1 "fourth file" extraction trigger is not hit. If SA rules it is, extract the shared part to `tests/admin/` in this slice |
| SQ-10 | `onCreditsChanged` required on the panel, optional on `CreditsBlock` | Required on the panel, so the drawer cannot forget it (one helper edit in `businessOsPanel.render`); optional on the block, so its standalone tests stay unedited |
| SQ-11 | Contrast guard scope | Walk `app/admin/users` with `DeleteBusinessDialog.tsx` excluded by name (the hidden AD-1 entry, two slate-500 lines, not money-block UI), plus `CreditsLeftCell.tsx` if SQ-6 is no |
| SQ-12 | The opener element is carried in the panel's `takeBackRequest` state | Yes, as SA-C8 says ("travels with the take-back request"). Alternative: a panel ref set beside the request |

---

## Questions for the user

None. Every open point is technical and goes to SA. The layout was decided in §1.2.

---

## Task List

- ✅ Step 1: Read the requirement (§1 to §14), the LF-4a.1 and LF-4a.2 workplans, every file under `app/admin/users/**`, the pin files and the guards
- ✅ Step 2: Write this workplan; update requirement §1 LF-4b row and Change History
- ✅ Step 3: SA workplan review; conditions C1 to C11 applied (C1: `origin/main` merged, `4c5d9a88`, `app/admin/users` green on it)
- ✅ Step 4: `moneyBlockUi.ts` with its unit test
- ✅ Step 5: `CreditFormDialog` / `BoostCapDialog` forwarded prop
- ✅ Step 6: `CreditsBlock`: label, bar, lot fold, contrast, BD-14 call, focus
- ✅ Step 7: `BoostBlock`: label, top-up fold, Spending limit bar, contrast, opener, focus
- ✅ Step 8: `BusinessOsPanel`, `BusinessDetail` wiring (BD-14, the opener in the request)
- ✅ Step 9: Permitted pin edits (A, B with C2); other test edits; guards
- ✅ Step 10: `businessDrawer.money.render.test.tsx`; `moneyBlockUi.render.test.tsx`; `creditsBlock.render` cases
- ✅ Step 11: Run set; mutations MB1 to MB21 with checksums
- ✅ Step 12 (separate step, its own commit; SA ruling while reviewing LF-F1): extract the pin harness into one helper under `tests/admin/`. Done; see "Step 12: the shared pin harness". Scope as ruled:
  - Move the shared part (stub, deferred, settle, quiet, console guard, uuid counter) into one file under `tests/admin/` without a `.test` suffix, so Jest does not collect it as a suite.
  - Convert the three pin files to it as a pure refactor. Each keeps its own route table.
  - LF-F1's `businessDrawer.closeMidDelete.render.test.tsx` is not converted here; it converts when it merges.
  - Re-run the LF-4a.1 mutations M1 to M15; all must still bite.
  - No fifth copy of the harness.
- ⬜ Step 13: SA code review of Step 12; TL browser checks QB-1 to QB-8 (the money step's SA code review and QA are done)

## Step 12: the shared pin harness

A separate step with its own commit (SA ruling while reviewing LF-F1). No product file changes. It is a pure refactor of the test harness: no assertion, count, fixture or route changes.

### The exact files of Step 12 (for the RM)

| File | Change |
|---|---|
| `tests/admin/drawerPinHarness.ts` | created. Holds the recording `fetch` stub (`setRoutes`, `installFetch`, `fromQueue`), `deferred`, `settle`, `quiet`, the uuid counter, and the console and unexpected-request guard (`installPinLifecycle({ countUuids, endQuiet? })`). It also holds the call readers the files shared word for word: `posts`, `getCount`, `listReads`, `bodyOf`, `requestOf`, `uuid`. Outside `__tests__` and with no `.test` suffix, so Jest's `testMatch` does not collect it. `calls`, `unexpected` and `minted` are exported arrays, emptied in place before each test, so the test bodies read them unchanged |
| `app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx` | harness removed, imports the helper; `countUuids: true`; keeps its route table, `ok` / `refused`, fixtures and `beforeEach` for its own state |
| `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx` | the same |
| `app/admin/users/__tests__/businessDrawer.pins.dangerReads.render.test.tsx` | the same, with `countUuids: false` (the original never stubbed `crypto`) |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | **converted (a clean fit):** its own stub, quiet, deferred, console guard and uuid counter are gone; the route table returns `Reply`s and gates the top-ups read with a promise; requests are compared as "METHOD url" lines through a local `line(call)`; `endQuiet: true` keeps this file's rule that a test ends quiet before the guard |

**Two commits, no interactive staging.** Three of these files also carry money-step changes: `businessDrawer.pins.credits` and `businessDrawer.pins.boost` (Group A and B), and `businessDrawer.money` (new in the money step). For the RM, the money-step version of each is ready in the Dev's scratchpad (`money-step-versions/`):
- the two pins are rebuilt as `HEAD` plus Group A and B;
- `businessDrawer.money` is the current file with Step 12 reversed;
- `businessDrawer.pins.dangerReads` needs none: its money-step version is `HEAD`.

Checks on those versions:
- Against `HEAD` they measure exactly the money step's numstat: credits +10 / -10, boost +25 / -6.
- Run in place under temporary `zz` names against the current product code, they passed: 3 suites, 43 tests. The temporary files were deleted.

Suggested order:
1. **Commit 1, the money step:** product files, the other tests and docs, and those three files at their money-step versions. `dangerReads` and `tests/admin/` are left out.
2. **Commit 2, Step 12:** `tests/admin/drawerPinHarness.ts`, the three pin files and `businessDrawer.money` at their current content.

Step 12's own diff, measured from the money-step versions:

| File | Step 12 lines |
|---|---|
| `businessDrawer.pins.credits` | +26 / -136 |
| `businessDrawer.pins.boost` | +28 / -139 |
| `businessDrawer.pins.dangerReads` | +29 / -124 |
| `businessDrawer.money` | +43 / -94 |
| `tests/admin/drawerPinHarness.ts` | +195, new |

Each diff is only the harness removal, the helper import, the header comment and the lifecycle lines.

### What did not change

- **Pure refactor.** In each pin file only the harness block, the imports, the header comment and the lifecycle lines changed. Every `it`, assertion, fixture and route line is as it was.
- **One behaviour detail, stated.** The recorded arrays are emptied in place instead of replaced. A request that answered after its test ended could only land in the next test's array. The `afterEach` guard waits for every request first, as before, so no test can see one.
- `refused` stays in each file. Its three versions differ (`details`, none, `extra` spread), so it belongs to the route table.
- **Not converted, other worktree:** LF-F1's `businessDrawer.closeMidDelete.render.test.tsx` (PR #347). It converts after it merges.
- **Not a copy of the pin harness:** `businessDrawer.layout.render.test.tsx` keeps its own simpler route-table stub. It records URLs only, with no headers, body, `cache` or uuid counter. LF-4a.2 SA ruled it is not the pin harness (SQ-F). It is unchanged.
- **No fifth copy:** `pending += 1` now appears only in the helper and in that layout stub.

### Step 12 verification

| Run | Result |
|---|---|
| The three pin files on the helper | 3 suites, 34 tests, all pass (the same 34 as before) |
| Pins plus `businessDrawer.money` on the helper | 4 suites, 52 tests, all pass |
| Run set: `app/admin/users`, `app/admin/components`, `contrast.lf1.source.guard`, `admin-authz-surface.guard`, `tailwind-css-escape.guard`, `creditBands.guard`, `creditFigures.fromConfig.guard` | 49 suites, 1,541 tests, all pass |
| `npm run test:bos-entitlements` | 253 suites, 7,367 tests, all pass |
| `npm run lint:hooks` | exit 0 |
| ESLint on the helper, the four converted files and `drawerFolds.tsx` | exit 0, no warning |
| Scoped `tsc` (the 20 code and test files plus `next-env.d.ts`) | with the canary: exactly `zz-canary.ts(1,7): error TS2322`, exit 2; without it: exit 0. Temporary config and canary deleted |
| `zz` files | none left in the worktree (`zzLf4bProbe.test.tsx` is not present) |
| Backslashes | 0 in the helper and the four converted files; 0 on any added line of the diff |

**Mutations: LF-4a.1 M1 to M15, plus MB18 and MB19.** Same scratchpad runner. Each run applied one mutation to a product file and ran the three pin files plus `businessDrawer.money` (52 tests). It then restored the file and compared SHA-256. All 17 restored "sha256 ok". **Every one bit**, and each still bites the pins it bit in LF-4a.1:

| # | Mutation (LF-4a.1 table) | Tests that failed |
|---|---|---|
| M1 | Give `expiresAt` undefined | GIVE-1, GIVE-3, GIVE-4, GIVE-5 |
| M2 | paid-credits gate removed from `formValid` | TAKE-3, TOPUP-1 |
| M3 | reconcile `cache: 'default'` | REC-1, REC-2, REC-3 |
| M4 | a new request id after a failed POST | GIVE-3, GIVE-5, TAKE-4 |
| M5 | `end_boost_cap` gains `amountMinor` | CAP-2, CAP-5 |
| M6 | in-flight guard removed from `submit` | GIVE-4, TAKE-5 (no knock-on) |
| M7 | close-while-in-flight refusal removed | GIVE-4, TAKE-5 |
| M8 | `canChange` ignores `isOwnAccount` | OWN-1; money T-A3 |
| M9 | the top-ups read re-runs when `takeBack` changes | READS-1, READS-3, READS-4, and every `expectReads` success and refusal in the credits and boost pins (24 in all) |
| M10 | `SHOW_AD1_DELETE_ENTRY = true` | DANGER-5 |
| M11 | `onRemoved` reads the list twice | DANGER-2 |
| M12 | money blocks mount for a non-Business OS account | READS-2 |
| M13 | `passesFailed` above 0 not a failure | REC-3 |
| M14 | cleanup panel not locked to the row's email | DANGER-1, DANGER-2, DANGER-3, DANGER-4 |
| M15 | reconcile in-flight guard removed | REC-2 |
| MB18 | Give `expiresAt` undefined (M1 again, as asked) | GIVE-1, GIVE-3, GIVE-4, GIVE-5 |
| MB19 | `end_boost_cap` gains `amountMinor` (M5 again, as asked) | CAP-2, CAP-5 |

M1 to M15 here are the LF-4a.1 mutations as written in its table, applied to today's code as one-line edits.

### SA Review (Step 12)

**Reviewed by SA, 2026-10-13. Status: APPROVED. No fixes required.**

| # | Check | Result |
|---|---|---|
| 1 | Pure refactor | ✅ Each converted file was diffed against its money-step version (scratchpad for credits, boost and money; `HEAD` for dangerReads). Only the header comment, the helper import, the removed harness block and the lifecycle lines differ. No `it`, assertion, fixture, route or queue line changed. In `businessDrawer.money`, three local readers inside the describe (`since`, `listCall`, `lists`) now map `Call` to its "METHOD url" line, and `deferred()` became `deferred<void>()`. The strings they compare are the same, so the assertions are unchanged |
| 2 | Helper equals the old harness | ✅ The `fetch` stub, `fromQueue` (an empty-queue POST is pushed to `unexpected` and answers 500), `deferred`, `settle`, `quiet`, the readers, the uuid format and counter, the browser shims, and the console guard with its `finally` restore all match the old code line for line. `endQuiet` reproduces the money file's quiet-before-guard rule. The arrays are emptied in place. In `businessDrawer.money`, `quiet()` now runs `settle()` first and a non-GET method now goes to `routePost`. Both are stricter than before, never looser. The money file's `ok` changed from status below 400 to 2xx, which makes no difference: it only answers 200, 404 and 409 |
| 3 | Not collected | ✅ `testMatch` is `**/__tests__/**` plus `*.test` / `*.spec`, so `tests/admin/drawerPinHarness.ts` matches neither. `jest --listTests` lists nothing under `tests/admin`. `tests/helpers/` already holds a shared non-suite helper (`bos-llm-admin-fixtures.ts`), so this follows an existing pattern. `tsconfig` includes `**/*.ts`, so the type-check job still covers it |
| 4 | No fifth copy | ✅ `unexpected.push` and the recording stub exist only in the helper and the four route tables. `businessDrawer.layout.render` keeps its URL-only stub (SQ-F), which is not the pin harness |
| 5 | Two-commit split | ✅ Against `HEAD`, the scratchpad money-step versions measure credits +10 / -10 and boost +25 / -6. Run on their own under temporary names against the current product code, they gave 3 suites and 43 tests, all passing. The temporary files were deleted. The current files differ from those versions only by the harness lines (check 1), so commit 2 is exactly Step 12 |
| 6 | Own mutation on the helper | ✅ A throwaway probe suite exercised the helper directly. With the helper intact, an unknown GET, an empty-queue POST and a `console.error` each failed in `afterEach`. Records, minted ids and the uuid counter started empty in the next test, with no bleed. **H1:** removing `expect(unexpected).toEqual([])` let the unknown-GET and empty-queue probes pass, so the guard is the thing that catches them. **H2:** removing `calls.length = 0` failed 15 of 17 (the probe's no-bleed test plus the credits pins). Both were reverted, and SHA-256 matched the original. The probe was deleted, and no `zz` file is left |

Current state: the three pin files plus `businessDrawer.money` give 4 suites and 52 tests, all passing.

**Scope note (accepted).** The SA review of the money step said `businessDrawer.money` should be listed as "not converted, why". The Dev converted it instead. SA accepts this. The file had grown its own `quiet`, `deferred`, console guard and uuid counter, which was a fifth copy in all but name. Converting it removes that copy and changes none of its assertions. SQ-9 still holds: the file asserts on "METHOD url" lines, not on bodies.

**Optimisation suggestion (non-blocking).** The helper header could say in one line that `setRoutes` must run at module top level, before `installPinLifecycle`. If it is missing, the stub throws inside `fetch`, and that shows up as a console error rather than a clear message.

## Implementation Notes

Built 2026-10-13 on `4c5d9a88` (C1). Everything is uncommitted. The money step (Steps 4 to 11) is complete. The harness extraction (Step 12) has not started and is kept apart so the RM can commit it on its own.

### Files

| File | Change (`git diff --numstat`) |
|---|---|
| `app/admin/users/components/moneyBlockUi.ts` | created: `MONEY_ACTION_BAR`, `focusSectionHeading` (C4), `useReturnFocus` with the C6 comment; an opener inside `[hidden]` counts as gone |
| `app/admin/users/components/CreditsBlock.tsx` | +71 / -25: label, `credits-actions` bar (`ADMIN_BUTTON`), lots in `ShowMoreList`, dates note slate-400, `onCreditsChanged?.()` once in `handleSuccess`, openers and `onCloseAutoFocus`, `TakeBackRequest` type with `opener`, `remember` inside the opening branch (C5) |
| `app/admin/users/components/BoostBlock.tsx` | +73 / -36: label, top-ups in `ShowMoreList`, four slate-400 lines, `boost-cap-actions` bar at the head of `boost-cap`, Stripe link class (C11), `onTakeBack(lotId, opener)`, opener and `onCloseAutoFocus` for `BoostCapDialog`. Reconcile untouched |
| `app/admin/users/components/CreditFormDialog.tsx` | +4 / -2: one optional prop, forwarded (C7) |
| `app/admin/users/components/BoostCapDialog.tsx` | +4 / -2: the same (C7) |
| `app/admin/users/components/BusinessOsPanel.tsx` | +14 / -6: `onCreditsChanged` (required) passed to `CreditsBlock`; `takeBackRequest` carries `opener` |
| `app/admin/users/components/BusinessDetail.tsx` | +5 / 0: `onCreditsChanged={() => { void refreshList(); }}` |
| `app/admin/users/components/CreditsLeftCell.tsx` | +1 / -1: the dash to slate-400 (C8) |
| `app/admin/users/__tests__/businessDrawer.money.render.test.tsx` | created, 18 tests |
| `app/admin/users/__tests__/moneyBlockUi.render.test.tsx` | created, 8 tests (uses `forbidRealNetwork`) |
| `app/admin/users/__tests__/creditsBlock.render.test.tsx` | +67 / 0: 3 tests added |
| `app/admin/users/__tests__/businessDrawer.pins.credits.render.test.tsx` | +10 / -10: Group A only |
| `app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx` | +25 / -6: Group A (TOPUP-1, TOPUP-2) and Group B (TOPUP-3, with C2) only |
| `app/admin/users/__tests__/businessDetail.render.test.tsx` | +12 / -11: D-20 exception removed, plus "no heading in either block" |
| `app/admin/users/__tests__/boostBlock.actions.render.test.tsx` | +2 / -1: `toHaveBeenCalledWith(LOT, the button)` |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | +2 / -1: `panel()` passes `onCreditsChanged={jest.fn()}` |
| `app/admin/users/__tests__/source.guard.test.ts` | strengthened: `moneyBlockUi.ts` in `SCREEN_FILES`; 5 new checks (no fetch; BD-14 wiring; once inside `handleSuccess` and in no dependency list; two dialogs forward the named handler); see DV-4 |
| `app/admin/__tests__/contrast.lf1.source.guard.test.ts` | +22 / 0: Businesses entry, one named exclusion asserted to exist (C8) |

Absent from the diff, as C7 requires: `BoostReconcileDialog.tsx`, `boostCopy.ts`, `DeleteBusinessDialog.tsx`, `page.tsx`, `useBusinessDetails.ts`, `businessDrawer.pins.dangerReads.render.test.tsx`. `drawerFolds.tsx` joined the diff with SA F2: its header comment only (DV-6), which C7's list does not name.

### Pin edits made

Exactly Group A and Group B, as listed in "Permitted pin edits".

- **Before any pin edit, after the product change:** exactly 11 pin tests failed: GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1 and TOPUP-2. Each failed only on `list: 1` against a received `list: 2`.
- **Group A:** 9 `expectReads` lines in the credits file (GIVE-3 is `list: 3`), 2 in the boost file, plus the 2 comments.
- **Group B:** TOPUP-3 as shown in that section, with C2.
- No other pin line changed. TOPUP-3, on its old hand-set `hidden`, still passed on the new code before it was rewritten.

### Verification

| Run | Result |
|---|---|
| `app/admin/users` on the merged base, before any edit (C1) | 20 suites, 514 tests, pass |
| Run set: `app/admin/users`, `app/admin/components`, `contrast.lf1.source.guard`, `admin-authz-surface.guard`, `tailwind-css-escape.guard`, `creditBands.guard`, `creditFigures.fromConfig.guard` | 49 suites, 1,541 tests, all pass (run again after the mutation runs, on the restored tree) |
| `npm run test:bos-entitlements` | 253 suites, 7,367 tests, all pass |
| `npm run lint:hooks` | exit 0 |
| ESLint on the 18 touched or new code files | exit 0 |
| Scoped `tsc` (`incremental: false`, `plugins: []`, `include: []`, `next-env.d.ts` plus the 18 files) | with the canary: exactly `zz-canary.ts(1,7): error TS2322`, exit 2; without it: exit 0. Temporary config and canary deleted |
| Backslashes | 0 in the new files, this workplan and the requirement; 0 on any added line of the diff |
| `console.*`, `any` | none in the product files or new tests (tests only spy on console for the guard) |

### Mutation runs

Scratchpad runner. For each run it applied one mutation, ran 9 files (the two money pin files, `businessDrawer.money`, `moneyBlockUi`, `creditsBlock.render`, `businessDetail.render`, `source.guard`, `boostBlock.actions.render`, the contrast guard; 324 tests), restored the file and compared SHA-256. All 21 restored "sha256 ok", and afterwards `git status` showed only the slice's own changes. **Every mutation bit.**

| # | Mutation | Tests that failed |
|---|---|---|
| MB1 | `onCreditsChanged` called twice | 16: source.guard BD-14 "exactly once"; GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2; `creditsBlock.render` Give and Take back cases; T-B1, T-B4 |
| MB2 | `onCreditsChanged` not called | 17: as MB1, plus T-B3 |
| MB3 | also called when the dialog closes without a success | 4: source.guard "exactly once"; TOPUP-2; `creditsBlock.render` "refusal, network error, Escape"; T-B2 |
| MB4 | `BusinessDetail` passes a no-op | 15: source.guard BD-14 wiring; GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2; T-B1, T-B3, T-B4 |
| MB5 | `key` on `CreditsBlock` from the row's `creditsLeft` (C10: expected T-B3) | 5: source.guard "the panel renders the block"; T-B3; T-R1, T-R2, T-R3 (the remount loses the opener). GIVE-1 did not bite, as SA predicted |
| MB6 | lots in one plain `ul` (no fold) | 3: TOPUP-3; T-F1; T-F4 |
| MB7 | the rest of the lots dropped (first 3 only) | 5: TOPUP-3; `creditsBlock.render` lot list (2 tests); T-F1; T-F4 |
| MB8 | top-ups in one plain `ul` | 1: T-F3 |
| MB9 | `CreditFormDialog` does not forward `onCloseAutoFocus` | 4: source.guard BD-15 (CreditFormDialog); T-R1, T-R2, T-R3 |
| MB10 | `takeBackRequest.opener` always null | 1: T-R3 |
| MB11 | the layout-effect guard returns at once | 6: unit "opener leaves in a later commit"; T-R2, T-R3, T-R4, T-R5; T-C1 (knock-on: the previous failure left the page mounted, so T-C1 found an empty body) |
| MB12 | the fallback focuses nothing | 10: unit (5 tests); T-R2, T-R3, T-R4, T-R5; T-C1 (the same knock-on) |
| MB13 | `BoostCapDialog` does not forward `onCloseAutoFocus` | 3: source.guard BD-15 (BoostCapDialog); T-R4; T-R5 |
| MB14 | the Credits bar loses its bordered class (DV-3) | 1: T-A1 |
| MB15 | the Spending limit bar loses its bordered class (DV-3) | 1: T-A2 |
| MB16 | dates note back to slate-500 | 2: contrast guard (`CreditsBlock.tsx`); T-C1 |
| MB17 | the Credits label back to an `h4` | 2: D-20; T-A1 |
| MB18 | LF-4a.1 M1 re-run: Give `expiresAt` undefined | 5: GIVE-1, GIVE-3, GIVE-4, GIVE-5; `creditsBlock.render` "posts exactly" (the edited pins still bite on the request) |
| MB19 | LF-4a.1 M5 re-run: `end_boost_cap` gains `amountMinor` | 3: CAP-2; CAP-5; `boostBlock.actions.render` end_boost_cap |
| MB20 | the take-back request opens the first take-back-able lot, not the one by id (C10) | 2: TOPUP-3 (after C2); T-F3 |
| MB21 | `LotRow` passes no opener (C10) | 1: T-R2 |

### Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| DV-1 | T-R4 holds the top-ups re-read behind a gate, and a new T-R5 covers Back to default with an immediate re-read. "Never body" is asserted inside every T-R test (`expectFocus`), not in a separate test | The stub answers inside the same `act` flush, so without a gate the "loading" render is batched away and the Set limit button never unmounts. A real read takes time, and the gate reproduces that. Both paths now end on the heading, as SQ-3 ruled |
| DV-2 | The Stripe links' class is the panel's `LINK_CLASS` followed by the existing `inline-flex items-center gap-1`, not the bare string | Keeps the external-link icon in line with its label. T-A4 asserts the class starts with `LINK_CLASS` and has no emerald |
| DV-3 | MB14 and MB15 strip the bar's bordered class instead of moving the bar | A single-line mutation cannot reorder JSX (CRLF files). T-A1 and T-A2 gained an assertion that the bar carries `MONEY_ACTION_BAR`, so the mutation bites. Order is still asserted by `expectInOrder` |
| DV-4 | `source.guard` "only the bodies call refreshList" goes from 2 to 3, rewritten without a regex | The third body is BD-14's. The line held a backslash, so it now uses a string count (the no-backslash rule) |
| DV-5 | MB6 to MB8 swap `ShowMoreList` for a plain list at the import line | A single-line mutation |
| DV-6 | `drawerFolds.tsx`'s header comment said "outside the money blocks" | **Fixed in this slice (SA F2):** it now names both uses, outside the money blocks (LF-4a.2) and the lot and top-up folds inside them (LF-4b). Comment only, no behaviour or test effect |
| DV-7 | The scoped `tsc` config was written in the worktree root for the run, then deleted | `extends` needs the worktree path; nothing is left behind |

## SA conditions applied

| # | How it is applied |
|---|---|
| C1 | `git fetch origin main`, then `origin/main` merged into `feature/admin-layout-lf4b` with merge commit `4c5d9a88`, which brings #343, #342 and #345. This was done before any product edit. On that base `app/admin/users` (the three pin files included) ran green: 20 suites, 514 tests. The header is updated |
| C2 | TOPUP-3's three `newer` lots have `credits` and `remaining` of 100, 200 and 300; a new line asserts that the folded 4th row shows "13,750 left". The three dialog lines are verbatim. MB20 bites TOPUP-3 |
| C3 | T-B1 and T-B4 compare the sorted list of every request sent from the Confirm click on with exactly `[POST ops, GET credits, GET list]` |
| C4 | `focusSectionHeading` takes the closest `[role="group"][aria-labelledby]` and focuses the element that its `aria-labelledby` id names. The block root is used only when no such group exists. The unit test puts an unlabelled `role="group"` with its own `h3` in between |
| C5 | `remember(takeBackRequest.opener)` sits inside the branch that opens the dialog (lot found and take-back-able) |
| C6 | A comment on `useReturnFocus` covers (a) `CreditsBlock` must not be memoised and (b) the layout effect runs before the drawer FocusScope's MutationObserver. It names T-R3 as the test that fails. A one-line pointer sits at the `CreditsBlock` call |
| C7 | `CreditFormDialog.tsx` and `BoostCapDialog.tsx` change only in the `Props` field, the destructure and the one `DialogContent` attribute (+4/-2 lines each). These files are absent from the diff: `BoostReconcileDialog.tsx`, `boostCopy.ts`, `DeleteBusinessDialog.tsx`, `page.tsx`, `useBusinessDetails.ts`, `businessDrawer.pins.dangerReads.render.test.tsx` |
| C8 | `CreditsLeftCell.tsx:42` is `text-slate-400`; §14 LF4A2-F1 is closed. The contrast guard's Businesses entry walks `app/admin/users` and excludes only `DeleteBusinessDialog.tsx`, with a comment saying why. It asserts that the excluded file exists. LF4B-F2 is recorded in §14 |
| C9 | LF4B-F1 is recorded in §14 as Medium, with the double-give risk stated. The RM names it under known limitations in the PR body |
| C10 | MB20 and MB21 are added; MB5's expected bite is corrected to T-B3. Actual bites are in "Mutation runs" |
| C11 | The payment and dispute links change only their `className`, to the drawer's link classes plus the existing icon layout (see DV-2); `href`, `target`, `rel`, `title` and the test id are unchanged. T-A4 pins it |

The optimisation suggestions are both taken. `useReturnFocus` treats an opener inside a `[hidden]` ancestor as gone, and a unit test covers it. `tests/helpers/noRealNetwork.ts` is used in `moneyBlockUi.render.test.tsx`, the only new file with no fetch stub of its own. The whole-page file sends unknown URLs to `unexpected`, which is checked in `afterEach`.

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-13**
**Status:** APPROVED WITH CONDITIONS (C1 to C11 below). No user question arises.

Read against the code at `d8bbcd5e`: `CreditsBlock.tsx`, `BoostBlock.tsx`, `CreditFormDialog.tsx`, `BoostCapDialog.tsx`, `BusinessOsPanel.tsx`, `BusinessDetail.tsx`, `drawerFolds.tsx`, `page.tsx` (`fetchUsers`, `fail`, `selected`), `AdminDrawer.tsx` (`DrawerSection`), `components/ui/dialog.tsx`, the installed Radix FocusScope (1.1.7) and Dialog (1.1.20), the three pin files, `businessDetail.render` D-20, `source.guard` and `contrast.lf1.source.guard`.

#### Review by check

| # | Check | Finding |
|---|---|---|
| 1 | Money requests and confirmations byte-identical | Holds. `readPosition`, `readView`, every dialog prop that shapes a request, the confirm steps, the in-flight rules and every dialog word are untouched. The only dialog change is the optional `onCloseAutoFocus` forwarded to `DialogContent`; `components/ui/dialog.tsx` spreads `...props` onto `DialogPrimitive.Content`, so no shared change is needed. Radix composes the caller's handler first and skips its own (`triggerRef.focus()`, null here, which is F-108) once the caller calls `preventDefault`. Reconcile button, `BoostReconcileDialog` and `boostCopy` stay out of the diff (C7) |
| 2 | Permitted pin edits | Group A matches BD-14 and SA-C7 exactly: every `expectReads` after a success in GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1, TOPUP-2 (11 lines, 2 comments); every failure-only line, OWN, CAP, REC, READS and DANGER unchanged, so they now also pin "no list read" on those paths. None weakens a pin: the counts rise, nothing else moves. Group B matches LF4A1-F2 and keeps both required proofs (4 rows in the DOM, the 4th inside the hidden rest; `aria-expanded` still false after the dialog opens). **One gap:** the three `newer` lots are copies of `PAID_LOT` with the same 13,750 remaining, so the kept dialog line "13,750 left on this gift." no longer proves the dialog opened on the folded lot. Fixed by C2 |
| 3 | BD-14: one list read per success | Sound. `handleSuccess` is the only success sink and `CreditFormDialog` calls `onSuccess` once per answered success behind its `inFlight` ref; an event-time call cannot re-fire. Retry (GIVE-3, TAKE-4), refusal (GIVE-5, CAP-4), close (TOPUP-2) and the Credits re-read never reach it. A list read keeps the drawer mounted: `fetchUsers` keeps `users` until the answer, `selected` is re-derived by id, `BusinessDetail` is keyed by id, the panel's reads key on `[accountId]`. C3 makes T-B1 prove no other drawer read rides along |
| 4 | F-108 focus design | Sound, and verified against the installed Radix: FocusScope fires the unmount auto-focus event in a `setTimeout(0)` on any unmount, including the parent dropping the dialog, so the handler runs for Escape, X, Close and success alike. Both orders are covered: if the re-read removes the opener before the timer, the handler finds it disconnected and goes to the heading; if after, the armed layout effect catches it. Layout effects run inside the commit, before the drawer FocusScope's MutationObserver microtask (which would otherwise move focus to the drawer container, not the heading). The top-up case relies on `CreditsBlock` re-rendering in the panel's commit; true today (not memoised), and T-R3 fails if that ever changes (C6). The heading lookup must be the group's labelled heading (C4). `tabindex="-1"` set at runtime on the `h3` is not a shared component change and React does not manage that attribute there |
| 5 | Contrast and guard scope | The five lines are right (the list matches a grep of `app/admin/users`). Walking `app/admin/users` is right. With SQ-6 yes, the only remaining dim text is `DeleteBusinessDialog.tsx:276` and `:509`, the hidden AD-1 entry; excluding it by name is acceptable (C8) |
| 6 | D-20 exception removed | Yes: `expectedExtras` 0 and `allowedExtra` empty for Credits & billing, plus no `h1` to `h6` inside either block; Plan & entitlements keeps its named extra. MB17 proves it bites |
| 7 | SQ rulings | Below |
| 8 | Tests and mutations | Adequate with C2, C3 and C10. T-R1 to T-R5 cover all five dialogs, the emptied-lot and re-read-unmount fallbacks and "never body"; T-B1 to T-B4 cover BD-14 and AC-4.10; MB18 and MB19 re-prove that the edited pins still bite on the request |
| 9 | Browser checks read-only | Yes. QB-1 to QB-8 open, toggle, Escape and look; no money button is pressed and no money dialog is opened. Focus return and BD-14 are correctly Jest-only |
| 10 | Size | Holds: about +190 / -60 product lines over 7 files, about +650 test lines, about 2 days, as §8 |

#### Conditions

1. **C1 Merge main first.** PR #343 is merged (`e956e251` on `origin/main`, with #342 and #345 after it). Merge `origin/main` into `feature/admin-layout-lf4b` before any product edit, run the three pin files and `app/admin/users` green on the merged base, and record the merge commit here. Update the header's "PR #343 open". (Only `tests/helpers/noRealNetwork.ts` differs under `app/admin`, `components/ui` and `tests` today, so no conflict is expected.)
2. **C2 TOPUP-3 must still identify the folded lot.** Give the three `newer` lots a different `credits` and `remaining` from `PAID_LOT` (for example 100, 200, 300), so "13,750 left on this gift." can only come from the 4th, folded lot. Add one assertion that the hidden rest holds the row showing 13,750 left. The three dialog lines stay verbatim. Add MB20 (C10), which must bite TOPUP-3.
3. **C3 T-B1 and T-B4 pin the whole request delta.** After the success and a quiet window, assert the exact list of requests sent since the Give or Take back was confirmed: one POST, one Credits read, one list read, and nothing else (no summary, entitlements, audit or other drawer read). Three counters alone would miss a read that BD-14 drags along.
4. **C4 Find the section heading by its label.** `focusSectionHeading` takes the closest `[role="group"][aria-labelledby]` and focuses the element named by its `aria-labelledby` id (how `DrawerSection` names itself), not the first `h3` under any `role="group"`. The block root is the fallback only when no such group exists. The unit test covers a labelled group with a second, unlabelled `role="group"` in between.
5. **C5 Remember the top-up opener only when the dialog opens.** In the `takeBackRequest` effect, `remember(takeBackRequest.opener)` sits inside the branch that calls `setDialog` (lot found and take-back-able), so a request that opens nothing cannot replace the remembered opener.
6. **C6 Say why it works, in the code.** A short comment in `useReturnFocus` (or at its `CreditsBlock` call) that (a) the top-up case depends on `CreditsBlock` re-rendering in the panel's commit, so it must not be memoised, and (b) the layout effect runs before the drawer FocusScope's MutationObserver. T-R3 is named as the test that fails if either stops being true.
7. **C7 Dialog diffs minimal.** `CreditFormDialog.tsx` and `BoostCapDialog.tsx` change only in the `Props` field, the destructure and the one `DialogContent` attribute. `BoostReconcileDialog.tsx`, `boostCopy.ts`, `DeleteBusinessDialog.tsx`, `page.tsx`, `useBusinessDetails.ts` and the danger pin file are absent from `git diff --numstat`. QA checks both.
8. **C8 Contrast scope (SQ-6, SQ-11).** `CreditsLeftCell.tsx:42` goes to `text-slate-400` in this slice and §14 LF4A2-F1 is marked closed by LF-4b. The Businesses guard entry excludes `DeleteBusinessDialog.tsx` only, with a comment naming why (the hidden AD-1 entry), and asserts the excluded file exists, so a rename cannot leave a stale exclusion. Record finding LF4B-F2 in §14: its two slate-500 lines go to slate-400 in the slice that shows the AD-1 entry.
9. **C9 R-1 is a finding, not in scope (SQ-7).** Record LF4B-F1 in §14, priority Medium, in plain words: after a successful Give or Take back, a failed list re-read empties the list and closes the drawer, so the success notice is lost; the credits were moved and audited, but an admin who did not see the notice could open Give again, and a new opening is a new request id, so the server would accept a second gift. Fix shape: a post-action list read that keeps the rows and the open drawer on failure (a `page.tsx` change, its own small slice). Name it under known limitations in the PR body.
10. **C10 Mutation list.** Add MB20: the `takeBackRequest` effect opens the first take-back-able lot instead of the one by id (must bite TOPUP-3, after C2). Add MB21: `LotRow` passes no opener (must bite T-R2). Correct MB5's expected bites to T-B3: the pin harness answers the second list read with the same `creditsLeft`, so a key built from it does not change there and GIVE-1 will not bite. Record the tests that actually bite for every MB; each must bite at least one.
11. **C11 Stripe link class only.** The payment and dispute links change `className` only (href, `target`, `rel`, `title`, test id unchanged), to the same class string as the panel's `LINK_CLASS`; T-A4 pins it.

#### SQ rulings

| # | Ruling |
|---|---|
| SQ-1 | **Approved**: the Credits & billing `h3` with a runtime `tabindex="-1"` (SA-C8 asks for the section's heading, not the block label). Found by its label (C4) |
| SQ-2 | **Approved**: the no-deps layout-effect guard, armed only after a return to the opener and disarmed once focus is elsewhere. C6 |
| SQ-3 | **Accepted**: after a Set limit or Back to default success the button is unmounted by the top-ups re-read, which is the "opener gone" case of AC-4.7; the heading is the correct target. QA records this reading of AC-4.7. Keeping the old figures during the re-read is not LF-4b's change |
| SQ-4 | **Approved**: one bar per money part, inside the elements the pins assert. BD-5 says "each money section opens with an action bar"; the Spending limit part opens with its bar. No CAP-1 / CAP-2 edit |
| SQ-5 | **Approved, both**: §1 P-7 names `CreditsBlock.tsx:395` (the emerald Give) as decoration, and BD-11 applies T-6 to touched files. Bar buttons to `ADMIN_BUTTON`; Stripe links per C11. Status tones and reconcile untouched |
| SQ-6 | **Yes**: one class, shown in the strip this slice owns, no test pins the old class, and it avoids a second guard exclusion. C8 |
| SQ-7 | **Record as finding LF4B-F1, do not fix in scope**. It is today's Refresh behaviour, the window is narrow (a list read failing seconds after a good one), money is never wrong (the lot is there on reopen), and the fix belongs in `page.tsx`, which this slice must not touch. But it is recorded with the double-give risk stated, not as cosmetic. C9 |
| SQ-8 | **Approved**: Give and Take back only, the top-up Take back included. Set limit, Back to default and reconcile do not change credits left; CAP and REC keep `list: 1` and now pin that |
| SQ-9 | **Approved**: the `businessDrawer.layout.render` stub style does not hit the LF-4a.1 extraction trigger. If the new file needs the pin harness's recorder (method, headers, body, `cache`, uuid counter), the trigger fires and the shared part moves to `tests/admin/` in this slice. A plain URL list for C3 does not trigger it |
| SQ-10 | **Approved**: required on the panel, optional on the block. `onCreditsChanged` appears in no hook dependency array (the source guard's "exactly once, inside `handleSuccess`" covers this) |
| SQ-11 | **Approved** with C8: `DeleteBusinessDialog.tsx` is the only exclusion |
| SQ-12 | **Approved**: the opener travels in the request state with its `seq`, so the two cannot drift apart. C5 |

#### Optimisation suggestions (not conditions)

- In `onCloseAutoFocus`, treat an opener inside a `[hidden]` ancestor as gone (`target.closest('[hidden]')`): a browser silently refuses to focus it, and jsdom does not. No path reaches it today, because the folds keep their state across the Credits re-read.
- The new test files may use `tests/helpers/noRealNetwork.ts` (#345, now on main) in place of a hand-written unknown-URL check.

### Approval

[x] Workplan approved. Proceed to implementation once C1 is done; C2 to C11 are applied during the build and checked at code review.

### SA Code Review

**Code Review by SA — 2026-10-13**
**Status:** APPROVED WITH FIXES (F1, F2 below; both doc or comment only, no code or test change)

Scope: the money step (Steps 4 to 11), uncommitted on `feature/admin-layout-lf4b` over `4c5d9a88`. Step 12 (the pin-harness extraction) is not reviewed here. Read: the full diff of the 8 product files, the 3 pin files against `origin/main`, the guards, `businessDetail.render`, `boostBlock.actions.render`, `businessOsPanel.render`, the two new test files and the requirement diff. Re-ran `app/admin/users` plus the contrast guard: 23 suites, 601 tests, all pass.

#### Review by check

| # | Check | Finding |
|---|---|---|
| 1 | Requests and confirmations byte-identical; C7 | Holds. `CreditFormDialog.tsx` and `BoostCapDialog.tsx` are +4 / -2 each: the `Props` field (with its doc line), the destructure and the one `DialogContent` attribute, nothing else. No request builder, body, confirm step, in-flight rule or dialog word moved in `CreditsBlock` or `BoostBlock`; the reconcile button and its dialog are untouched. `BoostReconcileDialog.tsx`, `boostCopy.ts`, `DeleteBusinessDialog.tsx`, `drawerFolds.tsx`, `page.tsx`, `useBusinessDetails.ts` and the danger pin file are absent from `git diff --numstat` |
| 2 | Pin edits only Group A and Group B | Verified line by line against `origin/main`. Credits file: 9 count lines (GIVE-1 to GIVE-4, GIVE-3 at `list: 3`, TAKE-1 to TAKE-5, TAKE-4's second line only) and 1 comment. Boost file: TOPUP-1 and TOPUP-2 count lines and 1 comment (Group A, 11 plus 2), and TOPUP-3 exactly as the "After" block with C2 (newer lots at 100, 200, 300; "13,750 left" asserted on the folded 4th row; the three dialog lines verbatim; `aria-expanded` still false). GIVE-5, TAKE-4's first line, OWN, CAP, REC, READS untouched. Danger pin file: no diff |
| 3 | BD-14: one list read per success, no remount (C3) | Sound. `onCreditsChanged?.()` is an event-time call, only in `handleSuccess`, in no dependency list (guarded). T-B1 and T-B4 pin the whole sorted request delta as exactly POST, Credits read, list read. T-B3 pins strip, row cell and block agreement and the identity of `bos-panel`, `credits-block`, `boost-block`. The Credits re-read does not go back to `loading`, so Give stays mounted through it, which is why the Give success returns to Give |
| 4 | F-108 focus (C4, C5, C6; never body; DV-1) | C4: `focusSectionHeading` resolves `[role="group"][aria-labelledby]` and focuses the element its id names; my mutation SA-M1 (`target = from`) failed 9 tests across the unit and whole-page files. C5: `remember(takeBackRequest.opener)` sits inside the opening branch, after the `handledSeq` check. C6: the comment is on `useReturnFocus`, names T-R3, with a pointer at the `CreditsBlock` call. Never body: `expectFocus` asserts it in every T-R case, and the fallback always has a target (heading, else the block root). The `[hidden]` opener rule from the optimisation note is in. **DV-1 is sound**: an instant stub batches the `loading` render away, so without the gate T-R4 would test a path a real network never takes; the gate reproduces a real read, and T-R5 keeps the instant path covered (Back to default ends the limit, so the button is gone either way). Both end on the heading, as SQ-3 ruled |
| 5 | Contrast and guard (C8) | The five lines and the `CreditsLeftCell` dash are `text-slate-400`; the Businesses entry walks `app/admin/users`, excludes only `DeleteBusinessDialog.tsx` with the reason, and asserts the excluded file exists. LF4A2-F1 is marked closed and LF4B-F2 is recorded in §14 |
| 6 | D-20 | The Credits & billing exception is gone (`expectedExtras` 0, no `allowedExtra` branch) and a new loop pins zero headings inside `credits-block` and `boost-block`. Plan & entitlements keeps its named extra |
| 7 | C9, C10, C11, DV-2 | C9: LF4B-F1 is in §14 as Medium with the double-give risk in plain words. C10: MB20 bites TOPUP-3 and T-F3, MB21 bites T-R2; MB5 recorded against T-B3. C11: on the Stripe links only `className` changes; `href`, `target`, `rel`, `title`, test id unchanged. My mutation SA-M2 (`rel` weakened to `noopener` only) failed 3 tests, so `rel` is pinned. **DV-2 is acceptable**: `inline-flex items-center gap-1` is layout, not decoration, and was already there for the icon; the panel's own links compose `LINK_CLASS` with a layout class the same way (`inline-block`). T-A4 pins the prefix and no emerald |
| 8 | DV-4 | Acceptable. 3 is the right count (onDeleted, onRemoved, onCreditsChanged). `detail` is `codeOf(...)`, so a comment naming `refreshList(` cannot inflate it, and the new BD-14 check pins the exact `onCreditsChanged` wiring separately. The string count is equivalent to the old regex and removes a backslash |
| 9 | DV-6 | Fix it in this slice (F2). The header now says the opposite of what the file is used for, in the module the money blocks import. It is a comment-only edit with no behaviour and no test effect, and C7's absent list does not name `drawerFolds.tsx` |
| 10 | `console.*`, `any` | None in the product files or new tests. The only `as any` in a touched test file (`creditsBlock.render.test.tsx:122`) is pre-existing, not on an added line. 0 backslashes in this workplan, the new files and every added diff line |

#### Code Review Comments (fixes)

1. **F1** `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` §1 — the LF-4a.2 row still reads "PR #343 open"; #343 is merged (C1 recorded it). Mark it MERGED (#343), as LF-1, LF-2 and LF-4a.1 are. — Priority: Low
2. **F2** `app/admin/users/components/drawerFolds.tsx:4` (DV-6) — the header says "folds outside the money blocks". Reword so it covers both uses (LF-4a.2 outside the money blocks; LF-4b the lot and top-up folds inside them). Comment only. Then update the "Absent from the diff" line in Implementation Notes and DV-6 to match. — Priority: Low

Neither fix needs a re-review; QA confirms both by reading the diff.

#### SA mutations (reverted, SHA-256 matched)

| # | File | Mutation | Result |
|---|---|---|---|
| SA-M1 | `moneyBlockUi.ts` | `const target = heading ?? from;` to `const target = from;` (C4 lookup lost) | 9 failed in `moneyBlockUi.render` plus `businessDrawer.money` |
| SA-M2 | `BoostBlock.tsx` | Stripe link `rel="noopener noreferrer"` to `rel="noopener"` (C11) | 3 failed in `app/admin/users` |

Both files restored and checked by SHA-256; `git status` showed only the slice's own changes, plus one untracked file that is not the Dev's or mine (see the note below).

#### Optimisation Suggestions (not fixes)

- `LINK_CLASS` is now the same literal in `BoostBlock.tsx`, `BusinessOsPanel.tsx` and the T-A4 test. Exporting it once (for example from `moneyBlockUi.ts` or a drawer style file) would stop drift; T-A4 already catches a drift in `BoostBlock`.
- Step 12 scope: `businessDrawer.money.render.test.tsx` carries its own `quiet`, `deferred`, console guard and uuid counter. Per SQ-9 it stays on the route-table stub and is not converted, but Step 12 should list it by name as "not converted, why", so the "no fifth copy" rule is checked against it.
- Before the PR: `origin/main` has moved to `8014ee73` since `4c5d9a88` (plan-payments work, no overlap with `app/admin/users`). The RM merges it in as usual before opening the PR.
- Note for TL: an untracked `app/admin/users/__tests__/zzLf4bProbe.test.tsx` appeared in the worktree during this review (QA's parallel probe, by its name). It must be deleted before the RM commits.

### Code Approved for QA: Yes (with F1 and F2 applied before commit)

## QA Testing Report

### QA Report

**QA — 2026-10-13**
**Verdict:** PASS WITH NOTES. No bugs found. The notes below are things to do or know before the commit; none blocks it.
**Test mode:** full, for the money step (Steps 4 to 11). Step 12 is not built and was not tested.
**Strategy used:** A and B (Jest: unit tests, plus whole-page render tests against a stubbed fetch); C (throwaway probe files, deleted); diff review against `HEAD` and `origin/main`.
**Focus:** ui, api (request bodies), security (own account, non-BOS gate)
**Skipped:** browser checks QB-1 to QB-8, which are TL's (read-only). Focus return and BD-14 cannot be checked in a browser without moving money, so they rest on Jest (jsdom) only. See R-2.
**Input source:** TL prompt

#### Runs

| Run | Result |
|---|---|
| Jest: `app/admin/users`, `app/admin/components` and the guards (`contrast.lf1.source.guard`, `admin-authz-surface.guard`, `tailwind-css-escape.guard`, `creditBands.guard`, `creditFigures.fromConfig.guard`) | 49 suites, 1,541 tests, all pass (69 s). Jest printed "a worker process has failed to exit gracefully" once (see N-5) |
| `npm run test:bos-entitlements` | 253 suites, 7,367 tests, all pass, exit 0 |
| `npm run lint:hooks` | exit 0 |
| Flakiness: the 3 pin files, `businessDrawer.money.render` and `moneyBlockUi.render`, run 3 times | 60 of 60 pass on every run (5 suites per run). Run times 48.9 s, 48.7 s, 48.4 s. No flake |
| `businessDrawer.money.render` per-test time (`--verbose`) | Slowest is T-R2 at 3.2 s, against a 30 s timeout. Plenty of margin |
| `origin/main`'s own credits and boost pin files, run against the new code (throwaway copies, deleted) | 25 tests: 11 fail, 14 pass. The 11 are exactly GIVE-1 to GIVE-4, TAKE-1 to TAKE-5, TOPUP-1 and TOPUP-2. Each fails only on `list` (expected 1, got 2, or 3 for GIVE-3). In every one of them the request assertions come before `expectReads`, and they passed. So every money POST body is byte-identical to `origin/main`. The old TOPUP-3, OWN, CAP and REC pins also pass |
| QA probe file (8 tests, throwaway, deleted) | 8 of 8 pass (QP-1 to QP-8 below) |

#### Test coverage

| Criterion / probe | Tested? | Result | Evidence |
|---|---|---|---|
| Give credits sits in the Credits action bar; shown only after a good read and not on the admin's own account | ✅ | Pass | T-A1, T-A3, QP-1, QP-2 |
| Set limit / Back to default sit in the limit bar inside `boost-cap`. Set limit only when not the own account; Back to default only while an admin limit is active | ✅ | Pass | T-A2 (limit active: both buttons); QP-1 (default limit: only `boost-cap-set`, no `boost-cap-end`); QP-2 (own account, limit active: no buttons, no bars, no Take back on lots or top-ups) |
| Non-BOS account: no money blocks, no Credits read | ✅ | Pass | QP-3: `bos-panel-not-bos` is shown; no `credits-block`, `boost-block` or bars; no `/credits/accounts/` request sent |
| Lots and top-ups show the newest 3 plus "Show N more"; the rest is hidden but stays mounted; toggling sends no request | ✅ | Pass | T-F1 to T-F3, TOPUP-3 |
| Take back on a folded lot, through the top-up path | ✅ | Pass | TOPUP-3 and T-F3. QP-7 also checks: the POST body is `reduce_credit_lot` on the folded lot's id with `confirmPaidCredits`, its keys are exactly `amount, confirmPaidCredits, lotId, op, reason, requestId`, there is one list read, and the fold stays closed |
| BD-14: exactly one list read after a successful Give, Take back or top-up Take back, and the strip's Credits left updates | ✅ | Pass | T-B1, T-B3, T-B4, the edited pins. QP-5 (lot Take back: list 2). QP-6 (top-up Take back: list 2, strip goes from 40% to 30%) |
| BD-14: no list read after a failed POST, Cancel or Escape | ✅ | Pass | T-B2 (refusal, Escape, Set limit, Back to default). QP-4 (Close button, X, network error on Give). QP-5 (lot refusal, then Escape). QP-6 (top-up 500 error, then Close). QP-8 (Set limit refusal, then Escape) |
| Focus goes back to the opener after Cancel, Escape, X or success | ✅ | Pass | T-R1 to T-R4. QP-4 (Close button and X, back to Give). QP-5 (lot button, after a refusal and Escape). QP-6 (Close, back to the top-up button; after success, still the top-up button). QP-8 (Close, back to Set limit) |
| Focus goes to the Credits & billing heading when the opener is gone, and never lands on body | ✅ | Pass | T-R2, T-R3 (lot emptied), T-R4 and T-R5 (re-read or ended limit), the `moneyBlockUi` unit tests. `expectFocus` asserts "not body" in every T-R case |
| AC-4.7 reading (SQ-3): after a Set limit or Back to default success, focus goes to the heading, not the button | ✅ | Pass, as ruled | T-R4, T-R5. Recorded as SA ruled: the top-ups re-read unmounts the bar, which is the "opener gone" case |
| Request bodies are unchanged versus `origin/main` for every money POST | ✅ | Pass | The pin files at `HEAD` are identical to `origin/main`, and their request lines are unedited (diff read line by line). `origin/main`'s own pins pass on every request assertion (see Runs). The two dialogs change only by the forwarded `onCloseAutoFocus` prop |
| Pin edits are Group A and Group B only | ✅ | Pass | `git diff` on the three pin files: 11 count lines, 2 comments and TOPUP-3 as specified. The danger pin file has no diff |
| Reconcile button and dialog untouched | ✅ | Pass | The only diff line that mentions reconcile is a header comment. `BoostReconcileDialog.tsx` and `boostCopy.ts` are not in the diff. T-A2 checks the reconcile button is still the block's last button. REC pins pass on both versions |
| C7: these files are absent from the diff: `BoostReconcileDialog.tsx`, `boostCopy.ts`, `DeleteBusinessDialog.tsx`, `drawerFolds.tsx`, `page.tsx`, `useBusinessDetails.ts`, the danger pin file, `TestAccountCleanupPanel.tsx` | ✅ | Pass | 0 numstat lines for each, against both `HEAD` and `origin/main`. No file is deletion-only against `HEAD`. See N-1 and N-2 |
| Contrast (slate-400) and D-20 | ✅ | Pass | T-C1, the contrast guard, D-20 in `businessDetail.render` |
| No backslash | ✅ | Pass | 0 in this workplan, the 2 new test files and `moneyBlockUi.ts`. 0 on any added diff line |
| No probe files left | ✅ | Pass | `git status` matches the start of QA. No `zz` file |

#### Issues found

**Bugs (must fix before commit):** none.

**Performance issues:** none. The money render file takes about 43 s as a suite (18 whole-page tests) and the slowest single test takes 3.2 s.

**Notes and edge cases:**

1. **N-1 (Low, process): `origin/main` has moved on.** `git diff origin/main --stat` lists 45 files. 29 of them belong to PR #346 (P-7b.1 plan upgrade, merged to `8014ee73` after C1's `4c5d9a88`), and appear as deletions only because the branch does not have them yet. They are not this slice's changes: `git diff HEAD --stat` shows the slice's real 16 tracked files. None of #346's files is under `app/admin`. RM should merge `origin/main` in before the PR (SA also noted this).
2. **N-2 (Low): SA's F1 and F2 were not applied when QA ran.** The requirement §1 LF-4a.2 row still says "PR #343 open". The `drawerFolds.tsx` header still says "outside the money blocks". Both are doc or comment only. When F2 lands, `drawerFolds.tsx` joins the diff. SA ruled that acceptable, because C7's list does not name that file. The "Absent from the diff" line in Implementation Notes must then drop it.
3. **N-3 (Medium, known, out of scope): LF4B-F1 is still open.** After a successful Give, a failed list re-read closes the drawer and the success notice is lost, so a double gift is possible. It is recorded in §14, and the RM must name it under known limitations in the PR body.
4. **N-4 (Low): focus is tested in jsdom only (R-2).** Radix focus timing and `activeElement` after a node is removed may behave differently in a real browser. The browser checks cannot cover this without pressing a money button. Worth a manual click-through on a test account when one is safe to use.
5. **N-5 (Low, not attributed):** the 49-suite run printed Jest's "worker process has failed to exit gracefully" warning once. All suites passed. The three focused runs of the new files did not print it. Not investigated further, and not shown to come from this slice.
6. **N-6 (edge, no defect today):** `ShowMoreList` renders the first three rows and the rest in two separate `ul`s. A row that crosses the boundary after a re-read is therefore remounted, for example when a Give adds a newer lot and pushes lot 3 into the hidden list. No current flow loses focus or state by this: the Give opener sits in the bar, and a Take back does not reorder the lots. It would matter only if a later flow kept the opener on a row that moves.

#### Final Status
- [x] All acceptance criteria in scope pass. Ready for commit once SA's F1 and F2 are applied and `origin/main` is merged in (N-1, N-2)
- [ ] Issues found — Dev must address before commit

## Commit Info

[RM will populate this section]

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Workplan written (Dev) | Action bars inside `credits-block` and `boost-cap`; lots and top-ups through the existing `ShowMoreList`; five slate-500 lines to slate-400 (sixth, `CreditsLeftCell`, pending SQ-6); `h4`s to labels, D-20 exception removed; BD-14 via `onCreditsChanged` called once in `handleSuccess`; BD-15 via a local `useReturnFocus` hook and a forwarded `onCloseAutoFocus` on two dialogs. Permitted pin edits: 11 BD-14 count lines plus 2 comments, and TOPUP-3 on the real fold. Mutations MB1 to MB19; QB-1 to QB-8; SA questions SQ-1 to SQ-12; no user question |
| 2026-10-13 | SA workplan review: APPROVED WITH CONDITIONS | C1 merge `origin/main` (PR #343 merged) before the build; C2 TOPUP-3's newer lots get distinct figures so the dialog still identifies the folded lot; C3 BD-14 tests pin the whole request delta; C4 heading found by `aria-labelledby`; C5 to C7 opener, comments, minimal dialog diffs; C8 `CreditsLeftCell` in scope, `DeleteBusinessDialog` the only guard exclusion, finding LF4B-F2; C9 R-1 recorded as finding LF4B-F1 (Medium, double-give risk); C10 MB20, MB21, MB5 corrected; C11 Stripe link class only. SQ-1 to SQ-12 ruled |
| 2026-10-13 | Conditions applied; built (Dev) | C1: `origin/main` merged (`4c5d9a88`), `app/admin/users` green on it (20 suites, 514 tests). C2 to C11 applied (see "SA conditions applied"). 8 product files changed or created, 2 test files created (26 tests), `creditsBlock.render` +3 tests. Pin edits are Group A and Group B only; before them exactly the 11 Group A tests failed, each only on the list count. Run set 49 suites / 1,541 tests; `test:bos-entitlements` 253 / 7,367; `lint:hooks`, ESLint and scoped `tsc` with the canary clean. MB1 to MB21 all bite, every file restored by SHA-256. Deviations DV-1 to DV-7. Step 12 (pin harness to `tests/admin/`, SA ruling while reviewing LF-F1) not started; TL told first |
| 2026-10-13 | SA code review: APPROVED WITH FIXES | Money step (Steps 4 to 11). F1: requirement §1 LF-4a.2 row to MERGED (#343). F2: `drawerFolds.tsx` header comment covers the money-block folds (DV-6, fixed in this slice). DV-1, DV-2 and DV-4 accepted. Pins: Group A and Group B only, verified against `origin/main`. SA-M1 and SA-M2 both bite. Step 12 not reviewed |
| 2026-10-13 | QA: PASS WITH NOTES | Money step only. Run set 49 suites / 1,541 tests; `test:bos-entitlements` 253 / 7,367; `lint:hooks` exit 0. The pin files plus the two new files ran 3 times: 60/60 each run, no flake. `origin/main`'s own pins, run against the new code, fail only the 11 Group A list counts, so every money POST body is unchanged. 8 throwaway probes passed and were deleted: button conditions, non-BOS, Close / X / network-error / refusal paths, folded-lot body. C7's absent files verified. No bugs. Notes N-1 to N-6: merge `origin/main` (#346) before the PR, apply SA's F1 and F2, LF4B-F1 still open, focus checked in jsdom only |
| 2026-10-13 | SA F1, F2 applied; Step 12 done (Dev) | F1: requirement §1 LF-4a.2 row MERGED (#343). F2: `drawerFolds.tsx` header names both uses; "Absent from the diff" and DV-6 updated. Step 12: one helper, `tests/admin/drawerPinHarness.ts` (no `.test` suffix, not collected); the three LF-4a.1 pin files and `businessDrawer.money` converted, each keeping its own route table; LF-F1's file not converted (other worktree, PR #347); no fifth copy. Pins 34/34 unchanged; LF-4a.1 M1 to M15 plus MB18 and MB19 all bite, files restored by SHA-256. Money-step versions of the overlapping files rebuilt in the scratchpad for a two-commit split, checked against `HEAD` and run green (43 tests). Run set 49 / 1,541; `test:bos-entitlements` 253 / 7,367; `lint:hooks`, ESLint, scoped `tsc` with the canary clean. No `zz` file |
| 2026-10-13 | SA review of Step 12: APPROVED | Pure refactor confirmed by diff against the money-step versions and `HEAD`. Helper behaviour matches the old harness. Not collected by Jest (`--listTests`). No fifth copy. The two-commit split versions pass on their own (3 suites / 43 tests). SA helper mutations H1 (unexpected guard removed) and H2 (calls not cleared) both bite, and the helper was restored by SHA-256. Converting `businessDrawer.money` was accepted. No fixes |
