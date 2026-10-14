# Workplan: Admin Layout LF-3a (Signup Invites: "New invite" in a drawer form, Revoke in a dialog)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md) §3.2 (OR-1 to OR-6), §3.3 (the "New invite" and Revoke rows, LF-3a rules), §3.4 (D-7, the Invites guard amendment G-8), AC-3.1, AC-3.2, AC-3.4, §8 LF-3a, §13 SA-C9, SA-C10, SQ-4, SQ-5, §14 LF3B-F1 (SA shared-dialog ruling)
**Standard:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md) §5.8 (the drawer, D-1 to D-8), §7.9 and decision D-7 (a) (Signup Invites writes nothing to the URL)
**Precedents:** [ADMIN_LAYOUT_L6_WORKPLAN.md](/docs/workplans/ADMIN_LAYOUT_L6_WORKPLAN.md) (the page, its guard and the G-7 walker), the LF-3b workplan on `origin/feature/admin-layout-lf3b` (`MessagesConfirmDialog`: in-flight lock, one send, focus return)
**Branch:** `feature/admin-layout-lf3a` (cut from `origin/main` at `8014ee73`), worktree `neuronforge-admin-layout-2`
**Path:** Full cycle (SA SQ-4: a form inside `AdminDrawer` is a new pattern, CLAUDE.md rule 7)
**Date:** 2026-10-13
**Status:** PR #353 open — fast-track (SA + QA passed); TL browser checks B-1 to B-8 owed; the user merges

## Overview

Signup Invites still opens two things inline. "New invite" pushes a 9-field form into the top of the content, and Revoke opens a small form under its row. OR-2 says a create form lives in the right-side drawer, and OR-3 says a confirmation that asks for one reason is a modal dialog. This slice moves both and changes nothing the server sees: the create and revoke requests stay byte-identical, and so do the words, the error maps and the shown-once link panel. The panel stays on the page, outside the drawer, so closing the drawer can never lose the link. It also puts OR-1 to OR-6 into the standard's §5.8, closes F-41 (`RevokeDialog` finally is a dialog) and F-110 (each Revoke button names its invite), and makes one narrow, named guard amendment (G-8).

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Decisions](#2-decisions)
- [3. Component tree](#3-component-tree)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Request pins (characterisation, written first)](#5-request-pins-characterisation-written-first)
- [6. Guard edits](#6-guard-edits)
- [7. Tests](#7-tests)
- [8. Mutations](#8-mutations)
- [9. Browser checks](#9-browser-checks)
- [10. Size](#10-size)
- [11. Task List](#11-task-list)
- [12. Risks](#12-risks)
- [13. Questions for SA](#13-questions-for-sa)
- [14. Questions for the user](#14-questions-for-the-user)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Code read at `8014ee73` (branch base, equal to `origin/main`).

### 1.1 The screen today

| File (lines) | What it does that this slice touches |
|---|---|
| `page.tsx` (278) | `creating` flag; "New invite" in the header actions, `disabled={!payload or creating}`; renders `CreateInviteForm` inline between the created-link panel and the list (`:239-249`); `onCreated` sets `created`, prepends the row, clears `creating`. `replaceRow` handles a revoke. No URL, history or storage anywhere (D-7 (a)) |
| `components/CreateInviteForm.tsx` (324) | Holds all 10 draft values in its own `useState` (email, inviteType, grantId, accessKind, months, expiryDays, language, note, reason, sendEmail) plus `submitting` and `error`. Initial values come from `options` (first available type, `defaultExpiryDays`, `defaultLanguage`). Builds `CreateInviteRequest` and POSTs it (`:87-107`). Own `h2` "New invite" and a card border. Cancel is enabled while a request is in flight. No same-tick double-submit guard (only `disabled` after the re-render) |
| `components/RevokeDialog.tsx` (113) | Despite the name, an inline form (F-41). Reason (min 3 characters, by code point), POST to `/api/admin/business-os/invites/{encodeURIComponent(id)}/revoke` with `{ reason: reason.trim() }`, error map of four codes. Words "Revoke invite" / "Keep it". No focus management |
| `components/InviteList.tsx` (231) | Local `revoking` id; each revocable row (pending or expired) shows a button named "Revoke" (the same name on every row: F-110); while revoking, the button is replaced by the inline form in the same cell |
| `components/CreatedLinkPanel.tsx` (116) | The shown-once link, Copy, Close. Imports React, lucide and its own types only (SA-R-5 (2)). Not focusable today |
| `__tests__/source.guard.test.ts` (402) | Exact file list (9 files), per-file `escapes()` (screen, React, lucide, the shared layout folder only), G-3 to G-7. `escapes()` refuses `@/components/ui/dialog` everywhere today |
| `__tests__/page.render.test.tsx` (1238) | Create cases, revoke cases, Slice 2a, Slice 5a and the L-6 T-cases. Several pin the old names and positions (listed in §7.2) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | Registry entry for Signup Invites (7 files). No file is added, so it is not edited |

### 1.2 Shared pieces used (none edited, except one comment)

| Piece | Use |
|---|---|
| `@/app/admin/components/layout/AdminDrawer` | The drawer. The page owns `open` and ignores `onClose` while the create request is in flight (SA-C9: no shared code change). Only its header comment gains the create-form use |
| `@/components/ui/dialog` | The Revoke dialog primitive, imported in `RevokeDialog.tsx` only (G-8) |
| `@/app/admin/components/layout/adminDialog` | `ADMIN_DIALOG_CLASS`, `ADMIN_DIALOG_TITLE_CLASS` |
| `@/app/admin/components/layout/adminTable` | `ADMIN_BUTTON` for "Keep it" (no `ui/button`, SA-C10) |

No shared `AdminConfirmDialog` and no import of `MessagesConfirmDialog` (SA ruling, §14 LF3B-F1). The Revoke dialog copies the LF-3b discipline: a ref set synchronously on the first send, no dismiss while in flight, `onCloseAutoFocus` prevented and focus returned by hand.

### 1.3 Tests that pin what moves

Listed with the reason for each edit in §7.2. In short: four tests click a button named exactly "Revoke"; T-14 pins the form's position inside the content and queries by role after opening it (the open drawer hides the page from the accessibility tree); every other create test reaches the form by its test id, which does not change.

---

## 2. Decisions

### 2.1 "New invite" as a drawer form (OR-2, SA-C9)

| # | Decision | Why |
|---|---|---|
| N-1 | `AdminDrawer` with `title="New invite"`, `testId="create-invite-drawer"`, rendered once at page level (after the content `div`), `open={creating}`. Its body is `CreateInviteForm`, still `data-testid="create-invite-form"` | OR-2; the form's test id stays so every existing create test keeps finding it |
| N-2 | The form loses its own `h2` "New invite" and its card border and padding: the drawer's title is the `h2`, the drawer is the surface | One heading per drawer (D-5); styling only |
| N-3 | **The draft lives in page state** (SA recommendation). `CreateInviteForm` becomes controlled: props `draft` and `onDraftChange`. The draft is the 10 values listed in §1.1, as one `InviteDraft` object. `submitting` and `error` stay local to the form | Escape or an overlay click closes the drawer, which unmounts the form; the draft must outlive that. An error is about one attempt, so it does not carry over |
| N-4 | `InviteDraft` and `initialInviteDraft(options)` are exported from `CreateInviteForm.tsx`, not a new file | Same initial values as today (first available type, `defaultExpiryDays`, `defaultLanguage`, `months` "12", `sendEmail` true). No new file, so the exact file list and the registry stay as they are (§3.4) |
| N-5 | Opening: "New invite" sets `draft` to `draft ?? initialInviteDraft(payload.formOptions)`, then `creating` true | A kept draft is reopened as it was left |
| N-6 | **Escape, overlay click, corner X** call the drawer's `onClose`. The page: if the create request is in flight, ignore it (the drawer stays open); otherwise close and **keep the draft** | SA-C9 |
| N-7 | **Cancel**: clears the draft and closes. Disabled while the request is in flight | SA-C9 "until Cancel or success". Today Cancel is clickable mid-request; it can no longer close the drawer in flight (SQ-D) |
| N-8 | **In flight**: the form reports it through a new prop `onBusyChange(isBusy)`, called synchronously before the `fetch` and in `finally`. The page keeps it in a ref (read by `onClose`) | A ref is read correctly in the same tick as a click; a state value may be one render behind |
| N-9 | **One send per Create**: the form's `submit` gains the same synchronous ref guard as Revoke (SQ-C). The ref check is the first statement after `preventDefault`; the ref is set and `onBusyChange(true)` called before any `await`; `onBusyChange(false)` runs in `finally` (it writes a page ref only, so it is safe after unmount) (C5 a) | A double Create makes two invites and can send two real emails. The request bytes do not change |
| N-10 | **Success**: the page sets `created`, prepends the row (as today), sets a "focus the panel" ref and a "clear the draft" ref, and closes the drawer by setting `creating` false directly, never through the busy-guarded `onClose` (the busy ref is still true until the form's `finally`; C4 c). `onReturnFocus` then focuses the panel's heading | SA-C9: the shown-once link is announced and one Tab from Copy |
| N-11 | **Failure**: the drawer stays open, the form shows the mapped error (`role="alert"`) as today, the draft is intact, Create enabled again | Unchanged behaviour, now inside the drawer |
| N-12 | **Focus return** (`onReturnFocus`): after success, the panel heading (`tabIndex={-1}`); otherwise the "New invite" button; else the content area (`invites-content`, which gains `tabIndex={-1}`); never `<body>`. A target is used only if it is non-null, connected and not `disabled`; after `focus()`, if `document.activeElement` is not the target, focus falls to `invites-content` (C4 b). The "focus the panel" flag is cleared in `onReturnFocus` whichever branch runs (C4 a) | D-6, standard D-7 last sentence |
| N-16 | **Draft cleared after the close finishes** (SA suggestion): Cancel and success set a "clear the draft" ref; `onReturnFocus` clears the draft and the ref. The drawer body renders while the draft is non-null, so nothing blanks during the close animation | No exit flash |
| N-17 | **Stale draft** (SA suggestion): on opening, a kept draft whose `inviteType` is no longer an available type in the current `formOptions` is replaced by `initialInviteDraft(formOptions)` | A Refresh may withdraw a type; the server and the form already refuse it, this is friendlier |
| N-13 | The panel stays on the page, outside the drawer, keyed by invite id as today | §3.4: a drawer close can never lose the link |
| N-14 | `CreatedLinkPanel` gains one optional prop, `headingRef`, put on its `h2` together with `tabIndex={-1}` and the A-1 focus ring. It still imports only React, lucide and its own types | The heading, not the `section`: naming the `section` to make it focusable and announced would make it a landmark region (A-9). SQ-B |
| N-15 | "New invite" stays `disabled={!payload or creating}` | Unchanged; while the drawer is open the page behind it is inert anyway |

### 2.2 Revoke as a dialog (OR-3, SA-C10, F-41, F-110)

| # | Decision | Why |
|---|---|---|
| R-1 | `RevokeDialog.tsx` becomes a controlled `Dialog` (`@/components/ui/dialog`) with `ADMIN_DIALOG_CLASS`. Props: `open`, `invite: InviteRow` (never null), `openKey` (a number bumped on every open), `onRevoked`, `onClose`, `onReturnFocus`. The page keeps the last target after closing (`open` is held apart from the target), so the exit render never dereferences null and the title does not blank (C5 b). `data-testid="revoke-dialog"` moves to `DialogContent` | F-41 closed with no rename and no new file |
| R-2 | **Owned by the page**, rendered once at page level next to the drawer. The page holds `revokeTarget` and one opener ref. `InviteList` loses its local `revoking` state and its `onRevoked` prop, and gains `onRevoke(invite, button)` | The LF-3b placement SA approved: a dialog outside the table survives its opener unmounting. Here the opener always unmounts on success (the row becomes Revoked, so it has no Revoke button), and with a State filter of Pending the whole row leaves the list; if `InviteList` owned the dialog, its empty-list branch would unmount it mid-close |
| R-3 | Words: the reason label is word for word today's ("Why are you revoking the invite for {email}? (at least 3 characters)"); the buttons are "Revoke invite" (rose fill, submit) and "Keep it" (`ADMIN_BUTTON`). One new string: the dialog title "Revoke the invite for {email}?" (SQ-F). No description (`aria-describedby={undefined}`, the `AdminDrawer` and LF-3b precedent) | §3.3 "same words"; a dialog must have a title |
| R-4 | **Initial focus on the reason field**: `onOpenAutoFocus` prevented, the input focused through a ref | SA-C10 |
| R-5 | **One send per confirm**: `isSending` ref set synchronously at the top of `submit`, plus `disabled` and `aria-busy` while in flight | LF-3b discipline |
| R-6 | **No close while in flight**: `onOpenChange(false)`, `onEscapeKeyDown`, `onInteractOutside` all check the ref; "Keep it" is disabled; the corner X goes through `onOpenChange` | SA-C10 |
| R-7 | **Success**: `onRevoked(updated)`; the page replaces the row (as today) and clears `revokeTarget`. **Failure**: the dialog stays open, the mapped error shows in it (`role="alert"`), the reason is kept, "Revoke invite" is enabled again | Today's failure behaviour (the inline form stays with its error). Differs from Messages, which closes on settle, because here the admin may fix the reason and retry (SQ-H) |
| R-8 | **Focus return**: the opener when still connected (Keep it, Escape, X; or a failure the admin then cancels); else the content area (`invites-content`); never `<body>` | OR-3, standard D-7. After a success the opener is always gone |
| R-9 | Reason, error, busy state and the `isSending` ref live in a body keyed by `openKey`, so they reset on every open, including a reopen of the same row after "Keep it" (C5 c) | A reason typed for one invite must never be sent for another; today the inline form unmounted on Keep it, so the reason was always cleared |
| R-10 | **F-110**: each row's button keeps the visible text "Revoke" and gets `aria-label` "Revoke invite for {email} (created {YYYY-MM-DD HH:mm:ss} UTC)", built from `createdAt` by a local helper `secondUtc()` next to `day()` (same UTC ISO assumption, no shared formatter). The accessible name starts with the visible word (WCAG 2.5.3) | C1: the create route has no one-pending-per-email rule, so two pending invites for one email on the same day are realistic; a date alone is not unique (SQ-E) |
| R-11 | The request is unchanged: same URL builder, same init object (`method`, `headers`, `body`), same `readJsonBody` reading and the same error map | §3.3 "same request" |

### 2.3 D-7 (a) holds

The drawer and the dialog never write the URL (an open drawer is not in the URL, U-10). No new file names history, storage, the router, search params or `useAdminFilters`. The link stays in page state only. The G-7 walker now also walks `components/ui/sheet.tsx`, `components/ui/dialog.tsx` and `lib/utils.ts` (verified: no history, storage, router or search params in any of them; they import only React, Radix, `class-variance-authority`, lucide and `@/lib/utils`) and the guard proves it reaches the first two (§6).

### 2.4 What does not change

The GET, the filter bar, KPIs, banner, table columns, chips, the panel's words and Copy, the create and revoke request bytes, both error maps, `readJsonBody` use, the `CreatedInvite` handling (prepend the row, no new read), `types.ts`, `inviteFilter.ts`, `InviteKpis.tsx`, `InviteFilters.tsx`.

---

## 3. Component tree

```text
BusinessOsInvitesPage (page.tsx)
  state: payload, loading, error, readAt, filter, created,
         creating, draft (InviteDraft or null), revokeTarget (InviteRow or null)
  refs:  newInviteButton, createBusy, focusPanelNext, panelHeading, revokeOpener, content
  AdminPageHeader
    actions: "New invite" button (ref newInviteButton; opens the drawer)
  InviteKpis
  InviteFilters
  div data-testid="invites-content" tabIndex=-1 (ref content)
    AdminError / AdminLoading
    stopped-halfway banner
    CreatedLinkPanel key=invite.id (headingRef=panelHeading)        <- stays on the page
    section "Invites (newest first)"
      count line, truncation notice
      InviteList (onRevoke(invite, button))
        row ... action cell: "Revoke" button, aria-label "Revoke invite for {email} (created {date time} UTC)"
  AdminDrawer title="New invite" testId="create-invite-drawer" open=creating
    onClose: ignored while createBusy; else close, draft kept
    onReturnFocus: panel heading after success, else "New invite", else content
    CreateInviteForm (draft, onDraftChange, onBusyChange, onCreated, onCancel)
      form data-testid="create-invite-form" (no own h2)
  RevokeDialog open=revokeOpen invite=revokeTarget (the last one, kept for the exit) openKey (portal)
    Dialog / DialogContent data-testid="revoke-dialog" (ADMIN_DIALOG_CLASS)
      DialogTitle "Revoke the invite for {email}?"
      form: reason label + input (initial focus), alert, "Revoke invite", "Keep it"
    onReturnFocus: opener if connected, else content
```

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-invites/__tests__/invites.requestPins.render.test.tsx` | create (first, before any product edit) | Characterisation pins of both requests and both error maps; green on the unchanged code, byte-identical afterwards (§5) |
| `app/admin/business-os-invites/page.tsx` | modify | Drawer at page level, draft state, in-flight close refusal, focus routing, Revoke dialog state at page level, `invites-content` focusable; header comment (Layout and LF-3a notes) |
| `app/admin/business-os-invites/components/CreateInviteForm.tsx` | modify | Controlled by `draft`, exports `InviteDraft` and `initialInviteDraft`, `onBusyChange`, ref guard, Cancel disabled in flight, no own `h2` or card; request builder and error map untouched |
| `app/admin/business-os-invites/components/RevokeDialog.tsx` | modify | A real dialog (§2.2); request and error map untouched; header comment (F-41 closed) |
| `app/admin/business-os-invites/components/InviteList.tsx` | modify | Local revoke state removed; `onRevoke(invite, button)`; per-row accessible name (F-110); header comment (D-8 note replaced by OR-3) |
| `app/admin/business-os-invites/components/CreatedLinkPanel.tsx` | modify | Optional `headingRef`; the `h2` gets `tabIndex={-1}` and the focus ring |
| `app/admin/components/layout/AdminDrawer.tsx` | modify (comment only) | SA-C9: the header comment gains the create-form use (OR-2: a form body, the page owns `open` and may ignore `onClose` while a request is in flight) |
| `app/admin/business-os-invites/__tests__/source.guard.test.ts` | modify | G-8 amendment and its controls; G-7 positive control gains `sheet.tsx` and `dialog.tsx`; header comment (§6) |
| `app/admin/business-os-invites/__tests__/page.render.test.tsx` | modify | Deliberate edits listed in §7.2 |
| `app/admin/business-os-invites/__tests__/invites.openRule.render.test.tsx` | create | The SA-C9 and SA-C10 behaviour cases (§7.3) |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §5.8 gains OR-1 to OR-6 (AC-3.4); §1 row 11 and the Messages row: the L-6 Q-7 and L-7 Q-8 page deviations retired; §9 F-41 and F-110 closed by LF-3a; Change History |
| `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` | modify | §1 LF-3a row at each stage; Change History |
| `docs/workplans/ADMIN_LAYOUT_LF3A_WORKPLAN.md` | create | This file |

Not edited: `types.ts`, `inviteFilter.ts`, `InviteKpis.tsx`, `InviteFilters.tsx`, `inviteKpis.test.ts`, `layoutFolder.guard.test.ts` (no file added), `components/ui/*`, any route.

Logging check: no Invites file and not `AdminDrawer.tsx` contains `console.*` (the Invites guard pins it), so there is nothing to flag.

---

## 5. Request pins (characterisation, written first)

New file `invites.requestPins.render.test.tsx`, written and run **before any product edit**, green on the unchanged code, then left byte-identical (SHA-256 recorded before the build and checked after). It reaches the controls only in ways that are true both before and after: the form by `create-invite-form`, the opener "New invite" by role, the row's revoke opener by `within(row).getByRole('button', { name: /^Revoke/ })` (one match before and after), the revoke form by `revoke-dialog`, its field by role `textbox`, its confirm by "Revoke invite". Inputs are set with `fireEvent.change` (speed); radios and buttons with `userEvent`. The create form and the revoke surface are always reached through `screen` (`getByTestId` / `findByTestId`), never through `within(list)` or `within(invites-content)`, so the same query is true inline (before) and portalled (after) (C3 b). The SHA-256 is recorded in this workplan at Step 4 and again at Step 11 (C3 c).

Each pin asserts the exact `fetch` arguments: the URL string, `Object.keys(init)` exactly `['method', 'headers', 'body']` in that order, `headers` exactly `{ 'content-type': 'application/json' }`, and `init.body` **as the exact string** (so key order is pinned, which a draft refactor could silently change).

| Pin | Case | Exact body string (or result) |
|---|---|---|
| RP-1 | Create: free type, access "No end date", note, email ticked (default) | `{"inviteType":"fixture-free","email":"x@example.com","linkExpiryDays":30,"language":"en","reason":"QA pin","sendEmail":true,"personalNote":"Welcome","access":{"kind":"open_ended"}}` |
| RP-2 | Create: access by months, 18 typed; expiry 60; language `he`; email unticked; no note | `{"inviteType":"fixture-free","email":"x@example.com","linkExpiryDays":60,"language":"he","reason":"QA pin","sendEmail":false,"access":{"kind":"months","months":18}}` (no `personalNote` key) |
| RP-3 | Create: an available type with grants and no access decision (fixture `fixture-granted`), default grant | `...,"sendEmail":true,"grantId":"tier-b"}` (no `access` key) |
| RP-4 | Create: the same type, the other grant chosen in Plan | `"grantId":"tier-c"` |
| RP-5 | Create: email, reason and note padded with spaces | All three trimmed in the body; a note of only spaces sends no `personalNote` |
| RP-6 | Create sends exactly one POST and no list read after it | `calls` gains exactly one entry |
| RP-7 | Create refusals: each code in the form's map (`invalid_input`, `paid_invites_not_available`, `invite_type_not_allowed`, `grant_not_available`, `could_not_create_invite`), an unknown code, a 500 that is not JSON, a rejected fetch | Each shows its exact sentence in `role="alert"` inside `create-invite-form`; unknown, non-JSON and rejected show "The invite could not be created. Try again."; no route code ever shown |
| RP-8 | Revoke: id with characters that need encoding (`inv/1 a`) and a padded reason | URL `/api/admin/business-os/invites/inv%2F1%20a/revoke`; body exactly `{"reason":"QA pin reason"}` |
| RP-9 | Revoke sends exactly one POST and no list read after it | as RP-6 |
| RP-10 | Revoke refusals: `invalid_input`, `invite_not_found`, `invite_not_revocable`, `could_not_revoke_invite`, unknown code, non-JSON, rejected | Exact sentences in `role="alert"` inside `revoke-dialog`; the three fallbacks show "The invite could not be revoked. Try again." |
| RP-11 | Revoke reason rule: 2 code points disabled, 3 enabled, 3 emoji (3 code points, 6 UTF-16 units) enabled, `"  ab "` disabled | Confirm button `disabled` state |
| RP-13 | Create: on `fixture-granted` choose `tier-c`, switch to another type and back, send (C3 a) | The body carries the default `"grantId":"tier-b"` (a type change resets the grant) |
| RP-12 | Create rule: Create disabled until email, a reason of 3 code points and (for a type that needs it) an access choice; months outside 1 to `championAccessMonthsMax` keeps it disabled | Create `disabled` state |

The fixture adds one type, `fixture-granted` (available, `requiresAccess: false`, grants `tier-b` default and `tier-c`), invented names only (the guard's plan-name rule applies to source files, and the tests already use invented ids).

---

## 6. Guard edits

All in `app/admin/business-os-invites/__tests__/source.guard.test.ts`, named in its header comment as "Amended by Admin Layout Follow-ups LF-3a".

| # | Edit | Detail |
|---|---|---|
| G-1 | Exact file list | **Unchanged** (no file added or removed). Stated in the header so a reader does not look for it |
| G-8 | `escapes()` gains one line, first: `if (relative === DIALOG_FILE and specifier === '@/components/ui/dialog') return false;` with `DIALOG_FILE = ROOT + '/components/RevokeDialog.tsx'` | SA-C10: exact on both sides. Every other file, and every other `@/components/ui/*` specifier, is still refused by the existing `@/` line |
| G-8a | New test "G-8: exactly ui/dialog, in exactly RevokeDialog.tsx" | Allowed: `(RevokeDialog.tsx, '@/components/ui/dialog')` is false. Refused (true): page.tsx, `CreateInviteForm.tsx` and `InviteList.tsx` with `@/components/ui/dialog`; `RevokeDialog.tsx` with `@/components/ui/dialogX`, `@/components/ui/dialog/index`, `@/components/ui/button`, `@/components/ui/sheet`, `../../../../components/ui/dialog` |
| G-8b | New test: liveness | `RevokeDialog.tsx`'s code imports `@/components/ui/dialog` (so the exception is not dead), and no other Invites file names `@/components/ui/` at all |
| G-7 | Positive control list gains `components/ui/sheet.tsx` and `components/ui/dialog.tsx` | SA-C10: the walk is proven to reach them, so the per-file URL and storage ban runs over them (it is an `it.each` over everything reached, so they join it automatically) |
| G-3 | Unchanged | Its `next/navigation` and look-alike controls still hold |

`layoutFolder.guard.test.ts` is not edited: no file joins or leaves the Signup Invites registry entry, and `RevokeDialog.tsx` already meets S-1 (alias only for the shared folder), no own `h1`, no direct `.json(`.

---

## 7. Tests

### 7.1 Order

1. Write `invites.requestPins.render.test.tsx`; run it on the unchanged code; all green; record its SHA-256.
2. Build.
3. Deliberate edits to `page.render.test.tsx` and the guard (below), each named in the PR.
4. Write `invites.openRule.render.test.tsx`.
5. Re-run the pins file unedited (SHA-256 equal).

### 7.2 Deliberate edits to existing tests

| Test (`page.render.test.tsx`) | Edit | Reason |
|---|---|---|
| `revoking` / "asks for a reason of at least 3 characters…" | Opener found by its new name "Revoke invite for first@example.com (created 2026-10-01)"; the dialog is found with `screen.getByRole('dialog', { name: 'Revoke the invite for first@example.com?' })` as well as by test id | F-110 pinned test 1. The dialog is in a portal, so `screen`, not `within(list)`; the rest is unchanged |
| `revoking` / "offers no Revoke for an accepted or revoked invite" | The fixture gains a pending row; exactly one button in the list matches `name: /^Revoke/`, inside the pending row; then `within(row)` on the accepted and revoked rows finds none (C2) | F-110 pinned test 2. Without the edit it would pass for the wrong reason (no button is named exactly "Revoke" any more); the pending row is the positive control that proves the matcher live |
| Slice 5a "an admin can revoke a champion's pending friend invite" | Opener by its new name | F-110 |
| L-6 "T-5: a revoke moves the row from Pending to Revoked" | Opener by its new name | F-110 |
| L-6 "T-14: header, strip, bar, then the banner, the created link, the form and the list" | Renamed "…the created link and the list; the form is in the drawer". The order list drops the form; the elements are collected before the drawer is opened; then, with the drawer open, it asserts `create-invite-form` is inside `create-invite-drawer` and not inside `invites-content` | The form left the content (OR-2). While the drawer is open the page is hidden from the accessibility tree, so `getByRole('search')` cannot run then |
| "creating an invite" / `openForm` and the Slice 2a and L-6 `createInvite` helpers | No edit expected: they reach the form by test id and the drawer renders it when opened. If jsdom needs it, an `await screen.findByTestId('create-invite-form')` instead of `getByTestId` (timing only, no assertion change) | Listed so a reviewer knows it was checked |

No other existing assertion is edited or removed. `inviteKpis.test.ts` is untouched.

### 7.3 New suite `invites.openRule.render.test.tsx`

Uses the page with a mocked `fetch` and the `holdNextFetch` pattern from `page.render` to hold a request in flight.

| Case | What it proves |
|---|---|
| D-1 | "New invite" opens a dialog named "New invite" (`create-invite-drawer`) containing `create-invite-form`; the form is not inside `invites-content`; there is exactly one `h2` named "New invite" |
| D-2 | Escape closes the drawer with nothing sent; reopening shows every typed value (email, type, access months, expiry, language, note, reason, email unticked) |
| D-3 | An overlay click (pointer down outside) and the corner X do the same as D-2 |
| D-4 | Cancel closes it and clears the draft: reopening shows the defaults |
| D-5 | In flight (held POST): Escape, overlay click and X leave the drawer open; Cancel is disabled; one POST only; after it settles with success the drawer closes |
| D-6 | Two Create submits in the same tick send one POST (ref guard) |
| D-7 | Success: drawer closed, the panel shows the link, focus is on the panel heading ("Invite created for x@example.com"), the draft is cleared (reopen shows defaults), the row is prepended, no list read |
| D-8 | Failure (409): drawer stays open, the sentence shows inside it, the draft is intact, Create is enabled again; then Cancel returns focus to "New invite" |
| D-9 | Escape (idle) returns focus to "New invite"; never `document.body` |
| D-10 | A second create while the first panel is shown: the new panel replaces it and focus goes to the new heading |
| D-12 | Create succeeds, reopen, Escape: focus on "New invite", not the panel heading (the flag was consumed, C4 a) |
| D-13 | A kept draft whose type is no longer offered after a Refresh reopens as the defaults (N-17) |
| D-11 | Nothing writes the URL, history or storage during open, Escape, reopen, Cancel, create (spies as T-10) |
| R-1 | Each revocable row's button has its own name: two pending rows with the same email on the same day, seconds apart, give two different names, each starting with "Revoke" (C1); visible text "Revoke" |
| R-2 | The opener opens a dialog named "Revoke the invite for {email}?", the `revoke-dialog` test id is on it, focus is on the reason field, the label text is today's |
| R-3 | Enter in the empty reason field sends nothing |
| R-4 | "Keep it", Escape and X close with nothing sent and return focus to that row's opener |
| R-5 | In flight: Escape, outside click, X do nothing; "Keep it" is disabled; `aria-busy` true; one POST |
| R-6 | Two submits in the same tick, and a real `dblClick` on "Revoke invite", send one POST |
| R-7 | Success: dialog closed, row Revoked with the reason, focus on `invites-content` (the opener left), never body |
| R-8 | Success with the State filter on Pending (the row leaves the list): same, and the empty state shows |
| R-9 | Failure: dialog stays open with the sentence, the reason kept, confirm enabled; "Keep it" then returns focus to the opener |
| R-10 | Opening the dialog for row B after cancelling row A shows an empty reason; reopening the same row after "Keep it" also shows an empty reason (C5 c) |
| R-11 | The dialog carries every `ADMIN_DIALOG_CLASS` class and no `aria-describedby` |

Run time: `fireEvent.change` for text, `userEvent` for clicks and keys, so the new suite stays well under the page suite's 30 s.

---

## 8. Mutations

Each on a product or shared file, run against the suites, then restored and checked by SHA-256.

| # | Mutation | Expected to bite |
|---|---|---|
| M1 | Page `onClose` without the in-flight check | D-5 |
| M2 | Page `onClose` also clears the draft | D-2, D-3 |
| M3 | Success focus goes to "New invite" instead of the panel heading | D-7, D-10 |
| M4 | Cancel left enabled in flight | D-5 |
| M5 | Create ref guard removed | D-6 |
| M6 | Request body key order changed in `CreateInviteForm` (`sendEmail` before `reason`) | RP-1 to RP-4 |
| M7 | Revoke init gains `cache: 'no-store'` | RP-8 |
| M8 | Revoke initial focus on "Keep it" | R-2 |
| M9 | Revoke ref guard removed | R-6 (same-tick case) |
| M10 | Revoke dismissible in flight (guards removed from `onOpenChange` and `onEscapeKeyDown`) | R-5 |
| M11 | Revoke focus fallback removed (opener only) | R-7, R-8 |
| M12 | Row button `aria-label` removed (all named "Revoke" again) | R-1, the edited F-110 tests |
| M13 | G-8 file condition dropped | G-8a negative controls |
| M14 | `import { Dialog } from '@/components/ui/dialog'` added to `CreateInviteForm.tsx` | the per-file import rule on that file, G-8b |
| M15 | A `window.history.replaceState(null, '', '?x=1')` call added inside a function in `components/ui/sheet.tsx` | G-7's per-file ban on `components/ui/sheet.tsx` (proves the walk really reaches it) |
| M15b | The same history line in `components/ui/dialog.tsx` (SA suggestion) | G-7's per-file ban on `components/ui/dialog.tsx` |
| M16 | `CreatedLinkPanel` rendered inside the drawer instead of the page | D-7, T-14 |

---

## 9. Browser checks

Read-only on production (the local dev server uses the production database too, so the same rules apply there). **Never press Create, never press "Revoke invite", never type in the Reason field of either form** (Enter there could submit). Signed-in admin, DevTools Network open.

| # | Check | Pass |
|---|---|---|
| B-1 | `/admin/business-os-invites`: header, strip, bar and list as before; no inline form under the header | Same page as today minus the form section |
| B-2 | Click "New invite": a right-side drawer titled "New invite" opens, dark surface, focus inside it, the page behind is inert; the fields and their defaults are as before (expiry default, language pre-selected, email ticked) | Visual and focus |
| B-3 | Press Cancel: the drawer closes, focus is on "New invite". **No POST in Network** | Network shows no request but the page's GET |
| B-4 | Open again, type a made-up address in Email only, press Escape, open again: the address is still there; press Cancel, open again: Email is empty; Cancel | Draft kept on Escape, cleared on Cancel; no POST |
| B-5 | Light and dark OS scheme emulation: the drawer stays dark, the X and focus rings are visible | Visual |
| B-6 | Accessibility tree on a pending row: the button reads "Revoke invite for {email} (created {YYYY-MM-DD HH:mm:ss} UTC)" | DevTools Accessibility pane; nothing clicked |
| B-7 | **TL only** (C7), never an automated driver: an expired revocable row if one exists, else a pending row; Network open before opening; check focus is in the reason field and the words; close with a mouse click on "Keep it"; no key pressed while the dialog is open. Any POST seen is reported at once as an incident | Also covered by R-2 and R-4 in Jest |
| B-8 | The URL never changes through B-2 to B-7 | Address bar |

---

## 10. Size

About 2 days, as §8 of the requirement says.

| Part | Estimate |
|---|---|
| Request pins (§5), green on unchanged code | 0.4 day |
| Drawer form: page, controlled form, panel heading, focus routing | 0.5 day |
| Revoke dialog: dialog, page ownership, list changes, F-110 | 0.4 day |
| Guard G-8 and G-7, existing test edits | 0.2 day |
| New open-rule suite | 0.4 day |
| Mutations, runs, standard and requirement text | 0.3 day |

Product diff estimate: about 250 lines changed across 6 product files (the form's request builder and the revoke request block are untouched). Tests: about 450 new lines in two files, about 30 lines edited.

---

## 11. Task List

- [x] Step 1: Read the requirement sections, the standard's D-7 (a) and §5.8, the screen and its tests, the L-6 and LF-3b workplans
- [x] Step 2: This workplan; requirement §1 LF-3a row "Workplan written, awaiting SA"
- [x] Step 3: SA workplan review; conditions C1 to C7 applied (table "SA conditions applied" after the SA review)
- [x] Step 4: Request pins file, green on the unchanged code, SHA-256 recorded
- [x] Step 5: `CreateInviteForm` controlled by the draft, `onBusyChange`, ref guard, Cancel disabled in flight, no own heading
- [x] Step 6: Page: drawer, draft, in-flight refusal, focus routing, `invites-content` focusable; `CreatedLinkPanel` heading ref
- [x] Step 7: `RevokeDialog` as a dialog; page-owned revoke state; `InviteList` `onRevoke` and per-row names
- [x] Step 8: `AdminDrawer` header comment (OR-2 use)
- [x] Step 9: Guard G-8 and G-7 edits; deliberate `page.render` edits (§7.2)
- [x] Step 10: New open-rule suite (§7.3)
- [x] Step 11: Mutations M1 to M16; runs (Invites suites, `app/admin/components`, `layoutFolder.guard`, the authz and tailwind escape guards, `npm run lint:hooks`, ESLint on touched files, scoped `tsc` with a canary)
- [x] Step 12: Standard §5.8 OR-1 to OR-6, the L-6 Q-7 deviation retired, F-41 and F-110 closed; the L-7 Q-8 deviation only if #348 is on `origin/main` (C6; checked again by RM at PR time); requirement row and Change History

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| The draft refactor changes the request (key order, a trim, the grant default) | Pins RP-1 to RP-5 assert the exact body string, written and green before the refactor |
| A Create or Revoke sent twice | Synchronous ref guards (D-6, R-6) |
| The shown-once link lost by a drawer close | The panel is on the page, outside the drawer (D-7, M16) |
| Focus lands on `<body>` after a revoke (the opener always unmounts) | Content-area fallback (R-7, R-8, M11) |
| The G-8 exception widens later by accident | Exact file and exact specifier, negative controls and a liveness check (G-8a, G-8b, M13) |
| Conflicts with LF-3b (#348), LF-F1 (#347) and LF-4b in the requirement's §1 and Change History | Only the LF-3a row and new Change History rows are touched; no shared code file except the `AdminDrawer` comment; RM merges `origin/main` before the PR |
| Radix leaves the page `aria-hidden` while the drawer is open, which breaks role queries in existing tests | T-14 is re-ordered (§7.2); the other create tests use test ids |

---

## 13. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| SQ-A | Draft model: the whole 10-value draft lifted into page state as one `InviteDraft`, the form controlled; `submitting` and `error` stay in the form. `InviteDraft` and `initialInviteDraft` exported from `CreateInviteForm.tsx` (no new file) | Yes, as planned (N-3, N-4) |
| SQ-B | Focus target on success: the panel's `h2` with `tabIndex={-1}` (announced as "Invite created for …", Copy one Tab away), not the `section` (a named section is a landmark region, A-9) | The heading |
| SQ-C | Add a synchronous one-send guard to Create too (not required by SA-C9, but a double Create makes two invites and two emails) | Yes; the request bytes are unchanged |
| SQ-D | Cancel disabled while the create request is in flight. Today it is clickable mid-request (the form vanishes and the panel still appears) | Yes, as SA-C9 requires the drawer not to close in flight |
| SQ-E | Row button name: "Revoke invite for {email} (created {YYYY-MM-DD})", or the email alone? The same email often has two revocable rows (expired plus re-issued) | Email plus created date |
| SQ-F | New dialog title "Revoke the invite for {email}?" (a dialog needs a title); the reason label and both button words stay as they are; no description | As planned |
| SQ-G | Revoke dialog state owned by the page (LF-3b placement), `InviteList` reduced to `onRevoke(invite, button)` | Yes (R-2: otherwise the empty-list branch can unmount it mid-close) |
| SQ-H | On a revoke failure the dialog stays open with the error and the reason (today's behaviour), unlike the Messages dialog which closes on settle | Stay open |
| SQ-I | Focus fallback for both surfaces: `invites-content` gains `tabIndex={-1}` (the Messages `messages-content` precedent, standard D-7) | Yes |
| SQ-J | G-7 positive control: exactly `components/ui/sheet.tsx` and `components/ui/dialog.tsx` as SA-C10 names, or also `AdminDrawer.tsx` and `lib/utils.ts`? | The two named; the others are walked anyway and add nothing to the proof |
| SQ-K | The standard edit in this PR: §5.8 gains OR-1 to OR-6 as a table after D-8, D-8's "inside the drawer or the row's action cell" stays true; §1 row 11 drops the Q-7 deviation and the Messages row drops the Q-8 deviation; §9 F-41 and F-110 marked "closed by LF-3a" | As planned; TL may prefer to word the §1 rows |
| SQ-L | The pins file stays byte-identical through the build (checksum), as LF-4a.1 did for the Businesses drawer | Yes |

---

## 14. Questions for the user

None. Every choice above is a code-level decision for SA. The only new visible words are the Revoke dialog's title and the per-row screen-reader name, both covered by SQ-E and SQ-F.

---

## Results (Dev, 2026-10-13)

### Base

`git fetch origin main`: `origin/main` is still `8014ee73` (the branch base); `git merge origin/main` answered "Already up to date", so there is no merge commit. `gh pr view 348`: OPEN; `gh pr view 347`: OPEN. Per C6 the standard's L-7 Q-8 deviation is not retired; the requirement's LF-3b row records it as owed on #348's merge.

**Update for SA F-1 (2026-10-13):** `git fetch origin main` gave `origin/main` `f302680f` (#347, #348 and #349 merged, plus #352). `git merge origin/main` was a **fast-forward to `f302680f`**: the branch had no commits of its own, so there is no merge commit and LF-3a stays uncommitted on top of `f302680f`. The one locally edited file main also changed, `docs/requirements/ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md`, was copied to the scratchpad and restored to HEAD before the merge (a dirty file blocks it), then the LF-3a rows were put back with Edit: the LF-3b row keeps main's "MERGED (#348)" text, this branch's "owed on #348's merge" note is dropped, and the Change History keeps the rows from both sides. No file outside the docs conflicted. Q-8 is now retired in the standard's §1 row 12 (F-1).

### Request pins (C3 c)

| When | SHA-256 of `__tests__/invites.requestPins.render.test.tsx` |
|---|---|
| Step 4, written and green on the unchanged code (26 tests) | `c51803175b1ee8a91d21772a2eaec735feb78b4dfd418ab48f25358ac8f52828` |
| Step 11, after the build, every mutation and the final runs | `c51803175b1ee8a91d21772a2eaec735feb78b4dfd418ab48f25358ac8f52828` (identical; the mutation runner also checked it after each mutation) |

26 tests: RP-1 to RP-6, RP-13, RP-7 (8 cases), RP-12, RP-8, RP-9, RP-10 (7 cases), RP-11.

### What was built

| File | Change |
|---|---|
| `components/CreateInviteForm.tsx` | Controlled by `draft` / `onDraftChange`; exports `InviteDraft` and `initialInviteDraft`; the type radio writes `inviteType` and the grant reset in one update (RP-13); send-once ref checked first and set with `onBusyChange(true)` before any await, `onBusyChange(false)` in `finally` (C5 a); Cancel disabled while submitting; no own `h2` or card. Request builder, error map and `readJsonBody` read unchanged |
| `components/RevokeDialog.tsx` | A modal `ui/dialog` with `ADMIN_DIALOG_CLASS`; props `open`, `invite` (never null), `openKey`; an inner part keyed by `openKey` owns the Dialog root, reason, error, busy and the send-once ref, so every open starts fresh (C5 b, c); focus to the reason field; no dismiss in flight; stays open on a refusal; title "Revoke the invite for {email}?". Request and error map unchanged |
| `components/InviteList.tsx` | Local revoke state removed; `onRevoke(invite, button)`; `aria-label` "Revoke invite for {email} (created {YYYY-MM-DD HH:mm:ss} UTC)" from a local `secondUtc()` (C1) |
| `components/CreatedLinkPanel.tsx` | Optional `headingRef`; the `h2` gets `tabIndex={-1}` and the A-1 ring |
| `page.tsx` | Drawer at page level (`create-invite-drawer`, title "New invite"); draft in page state, kept on Escape, overlay and X, cleared by Cancel or success once the close has finished (N-16); a stale type resets the draft on reopen (N-17); `onClose` ignored while the create is in flight; success closes through page state (C4 c); `focusIfAble()` skips a null, detached or disabled target and checks `document.activeElement` (C4 b); the panel flag is consumed in every branch (C4 a); one page-level `RevokeDialog`; `invites-content` gets `tabIndex={-1}` and `focus:outline-none` (the Audit trail precedent) |
| `app/admin/components/layout/AdminDrawer.tsx` | Header comment only: the create-form use (SA-C9) |
| `__tests__/source.guard.test.ts` | G-8 line in `escapes()`; G-8 and G-8 liveness tests; G-7 positive control gains `components/ui/sheet.tsx` and `components/ui/dialog.tsx`; header comment |
| `__tests__/page.render.test.tsx` | The §7.2 edits: three F-110 openers by full name, the absence test with its pending-row positive control (C2), T-14 re-ordered with the drawer assertions. The create helpers needed no edit |
| `__tests__/invites.openRule.render.test.tsx` (new) | D-1 to D-13 and R-1 to R-11 (26 tests) |

### Runs

| Check | Result |
|---|---|
| `jest app/admin/business-os-invites` | 5 suites, 271 tests, all pass |
| `jest app/admin/business-os-invites app/admin/components` plus `lib/admin/__tests__/admin-authz-surface.guard.test.ts` and `app/__tests__/tailwind-css-escape.guard.test.ts` | 29 suites, 1,084 tests, all pass. No act or React warnings. One run of five had 1 failure in `page.render` while that suite took 194 s under machine load (normally 56 to 110 s); not reproduced in the next three runs. The failing test name was not captured, so QA should watch for a timeout there |
| `npm run lint:hooks` | exit 0 |
| ESLint on `app/admin/business-os-invites` and `AdminDrawer.tsx` | exit 0 |
| Scoped `tsc` (scratchpad tsconfig extending the worktree's, `include: []`, the 10 touched or new TS files) | with canary: exactly `zz-canary.ts(1,7) TS2322`, exit 2; without: exit 0 |
| Backslash, `console.*`, `: any` in added lines | none |

### Mutations (each restored, SHA-256 equal before and after; the pin file checked after each)

| # | Bites |
|---|---|
| M1 onClose without the in-flight check | 1: D-5 |
| M2 onClose also clears the draft | 2: D-2, D-3 |
| M3 success focus not sent to the panel | 3: D-7, D-10, D-12 |
| M4 Cancel enabled in flight | 1: D-5 |
| M5 create send-once ref removed | 1: D-6 |
| M6 body key order (`sendEmail` before `reason`) | 6: RP-1, RP-2, RP-3, RP-4, RP-13, RP-5 |
| M7 revoke init gains `cache: 'no-store'` | 1: RP-8 |
| M8 revoke initial focus on "Keep it" | 2: R-2, R-3 |
| M9 revoke send-once ref removed | 1: R-6 |
| M10 revoke dismissible in flight | 1: R-5 |
| M11 revoke focus fallback removed | 2: R-7, R-8 |
| M12 row `aria-label` removed | 16: R-1 to R-11 (13) and the three edited F-110 tests in `page.render` |
| M13 G-8 file condition dropped | 1: G-8 |
| M14 `ui/dialog` imported into `CreateInviteForm.tsx` | 2: the per-file import rule on that file, G-8 liveness |
| M15 history write in `components/ui/sheet.tsx` | 1: G-7 ban on `sheet.tsx` |
| M15b history write in `components/ui/dialog.tsx` | 1: G-7 ban on `dialog.tsx` |
| M16 link panel rendered in the drawer instead of the page | 16: D-5, D-6, D-7, D-10, D-12 and 11 `page.render` create cases (T-10, T-14 among them) |

M13 to M15b were run a second time after the G-8 liveness test was rewritten to use the G-7 extractor (no regex of its own); same bites.

### Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| V-1 | Two extra refs in the page, `isCreateOpen` and `isRevokeOpenRef`: the close-finished callbacks do nothing when the surface has been reopened meanwhile | Radix calls `onCloseAutoFocus` after the exit animation; a reopen during it must not have focus pulled out of the new drawer or dialog |
| V-2 | The Revoke dialog's buttons are in the order "Keep it", "Revoke invite" (the inline form had the confirm first) and its label is slate-300, not rose-100 | The LF-3b dialog order (Cancel first) and the dark dialog surface. Words unchanged |
| V-3 | The G-8 liveness check uses the G-7 `valueSpecifiersOf` extractor instead of a new pattern | No new regex in the guard, and no backslash |
| V-4 | `invites-content` carries `focus:outline-none` | The Audit trail content area precedent; it is a script-only focus target (SA SQ-I) and nothing is suppressed globally |
| V-5 | While running the mutations I mistyped one command that briefly widened the G-8 line to the file alone (no specifier check). It was seen at once and restored to the exact condition before any further run; M13 then re-ran and bit as before | Recorded for the reviewer; `git diff` shows the exact two-sided condition |

### Browser checks

B-1 to B-6 and B-8 are listed in §9 for TL / QA (read-only; never Create, never "Revoke invite", never a Reason typed). **B-7 is TL's (C7); Dev did not run it.**

## SA Review Notes

### SA Review (workplan)

**Reviewed by SA — 2026-10-13**
**Status:** APPROVED WITH CONDITIONS (C1 to C7 below; apply them to this workplan before Step 4, then build)

Code read at `8014ee73` in this worktree: `page.tsx`, all six components, `source.guard.test.ts`, the revoke and create cases and T-14 in `page.render.test.tsx`, `AdminDrawer.tsx`, `components/ui/sheet.tsx`, `components/ui/dialog.tsx`, `lib/utils.ts`, the Signup Invites entry in `layoutFolder.guard.test.ts`, `MessagesConfirmDialog.tsx` on `origin/feature/admin-layout-lf3b`, and `adminInviteOps.ts` (create path). Path: full cycle stands (SQ-4).

#### What was checked

| # | Check | Finding |
|---|---|---|
| 1 | Request bytes unchanged; pins first, SHA-identical | **Holds, with C3.** RP-1 to RP-12 pin the URL string, `Object.keys(init)` exactly and in order, `headers` exactly, the body as the exact string (so key order is pinned; RP-1 matches the builder's order at `CreateInviteForm.tsx:87-98`), every error map entry plus unknown, non-JSON and rejected, the trims (RP-5, RP-8), `encodeURIComponent` (RP-8 with `inv/1 a`), one send and no list read (RP-6, RP-9), and both enable rules (RP-11 by code point, RP-12). Written first, green on unchanged code, checksum before and after: correct order. Missing: the grant reset on a type change (`setGrantId('')` at the type radio), the one draft behaviour a lift can silently drop; and the pins must be written so they find portalled content (C3) |
| 2 | SA-C9 drawer form | **Holds, with C4 and C5.** Draft in page state as one `InviteDraft`, form controlled (N-3); Escape, overlay and X go through `AdminDrawer` `onOpenChange` to `onClose`, which the page ignores while busy, and `open` is controlled so Radix stays open (verified in `AdminDrawer.tsx:62-76`, no shared change); Cancel disabled in flight (N-7); send-once on Create (N-9); success focus to the panel heading (N-10, N-14); fallback chain ends at `invites-content`, never body (N-12); panel stays inside `invites-content`, outside the drawer (N-13, M16). Gaps: the "focus the panel next" flag is never said to be consumed, and the "New invite" fallback is checked for connection but not for `disabled` (C4) |
| 3 | Revoke dialog | **Holds, with C1 and C5.** Screen-local in `RevokeDialog.tsx`, built on `ui/dialog` plus the `adminDialog` classes, copying the LF-3b discipline (sync ref, no dismiss in flight, `onCloseAutoFocus` prevented, focus by hand) with no import of `MessagesConfirmDialog` and no shared component: matches LF3B-F1. Focus to the reason field (R-4), stays open on failure with the reason kept (R-7, today's behaviour, SQ-H), focus to the opener or `invites-content` (R-8). Page ownership (R-2) is right: on success the opener always unmounts, and with State = Pending the list can go to its empty branch. Row names are not unique as planned (C1). The `invite: InviteRow or null` prop leaves the exit render undefined (C5) |
| 4 | D-7 (a) | **Holds.** Neither surface writes the URL; no new file; G-6 and the per-file storage ban keep covering every Invites file; G-7 extends to `sheet.tsx` and `dialog.tsx` (both import only React, `@radix-ui/react-dialog`, `class-variance-authority`, lucide and `@/lib/utils`; `lib/utils.ts` is a two-line `cn` with no imports). Draft (email, reason, note) lives in memory only |
| 5 | G-8, G-7 | **Holds.** G-8 is one line, exact file and exact specifier, placed before the `@/` line in `escapes()` (`source.guard.test.ts:76-82`); G-8a negative controls cover other files, look-alike specifiers (`dialogX`, `dialog/index`), other `ui/*` and the relative spelling; G-8b liveness proves the exception is used and that no other Invites file names `@/components/ui/`. G-7's positive control gains both files, and M15 proves the walk reaches `sheet.tsx` and the per-file ban runs on it. `layoutFolder.guard` needs no edit (`RevokeDialog.tsx` is already registered at `:604`; S-1 concerns the shared folder's spelling only) |
| 6 | Test edits | **Do not weaken, with C2.** The F-110 tests change only the opener's name; T-14 moves the form assertion from "in order in the content" to "inside the drawer, not in the content", which is stronger for OR-2. The absence test moving from the exact name "Revoke" to `/^Revoke/` is necessary (the exact name would match nothing after F-110, so it would pass for the wrong reason) and broader, but it is still an absence test with no positive control in the same render (C2) |
| 7 | Standard edit in this PR | **Appropriate for OR-1 to OR-6, Q-7, F-41, F-110** (AC-3.4 and requirement §3.4 put it here). **Not yet for Q-8:** the Messages `confirm()` deviation is removed by LF-3b, PR #348, which is open and does not edit the standard. Retiring Q-8 before #348 is on `origin/main` would make the standard state something false (C6) |
| 8 | SQ-A to SQ-L | Ruled below |
| 9 | B-7 | **Read-only and acceptable without asking the user**, under the limits in C7: opening a Radix dialog sends nothing, the confirm is disabled until a 3-character reason exists (R-3, RP-11), and "Keep it" sends nothing |
| 10 | Size | About 2 days, about 250 product lines across 6 files and about 480 test lines. Proportionate to the requirement's estimate and to the risk (the form grants plans and sends real email). No new file in the product, no shared code change beyond a comment |

Logging: verified, no `console.*` in any Invites product file or `AdminDrawer.tsx`; nothing to flag. Entitlements: no import from `lib/business-os/entitlements/`. No route, repository, Zod or RLS surface is touched: the requests are byte-identical and pinned.

#### Conditions

| # | Condition | Where |
|---|---|---|
| C1 | **SQ-E, row names must be unique.** The create route has no one-pending-per-email rule (`adminInviteOps.ts` create path), so the realistic case is two pending invites for the same email created the same day (the admin re-issues to fix a note, then revokes the first): email plus date gives both rows the same name. Use the created time to the second, in UTC: `aria-label` "Revoke invite for {email} (created {YYYY-MM-DD HH:mm:ss} UTC)", built from `createdAt` by a local helper next to `day()` with the same UTC ISO assumption (no shared formatter). R-1 uses two revocable rows with the same email on the same day, seconds apart, and asserts two different names, each starting with "Revoke". The §7.2 edits and B-6 use the new form | R-10, R-1, §7.2, B-6 |
| C2 | **Positive control for the absence test.** "offers no Revoke for an accepted or revoked invite" gains a pending row in its fixture and asserts exactly one button in the list matches `/^Revoke/`, inside the pending row; then the accepted and revoked rows (by `within(row)`) have none. The matcher is then proven live in the same render | §7.2 |
| C3 | **Pins.** (a) Add RP-13: choose `tier-c` on `fixture-granted`, switch to another type and back, send: the body carries the default `"grantId":"tier-b"`. (b) The pins reach the create form and the revoke surface through `screen` (`getByTestId` or `findByTestId`), never through `within(list)` or `within(invites-content)`, so the same query is true before (inline) and after (portalled). (c) Record the SHA-256 in this workplan at Step 4 and again at Step 11 | §5, §7.1 |
| C4 | **Focus routing, both surfaces.** (a) The "focus the panel next" flag is cleared in `onReturnFocus` whichever branch runs. Add D-12: create succeeds, reopen, Escape: focus on "New invite", not the panel heading. (b) A target is used only if it is non-null, connected and not `disabled`; after calling `focus()`, if `document.activeElement` is not the target, fall to `invites-content`. (c) On success the page closes the drawer by setting its own state directly, never through the busy-guarded `onClose` path (the busy ref is still true until the form's `finally`) | N-10, N-12, R-8, §7.3 |
| C5 | **Create and Revoke send-once and exit render.** (a) In `CreateInviteForm.submit` the ref check is the first statement, the ref is set and `onBusyChange(true)` called before any `await`, and `onBusyChange(false)` runs in `finally` (it is safe after unmount: it writes a ref only). (b) `RevokeDialog` never dereferences a null invite: keep the last non-null invite for the closing render, or hold `open` separately from `revokeTarget`, so the title does not blank or throw during the exit. (c) Reason, error and busy state live in a body that remounts on every open, including a reopen of the same row after "Keep it" (today the inline form unmounts on Keep it, so the reason was always cleared); extend R-10 with the same-row case. The `isSending` ref is reset on open | N-8, N-9, R-1, R-5, R-9, §7.3 |
| C6 | **Q-8 retirement waits for LF-3b.** At Step 12, retire the L-6 Q-7 deviation, add OR-1 to OR-6 and close F-41 and F-110 as planned. Retire the L-7 Q-8 deviation only if #348 is on `origin/main` when RM merges `origin/main` before opening this PR; otherwise leave the Messages row as is and record in the requirement's §1 LF-3b row that the Q-8 retirement in the standard is owed on its merge. Check it again at PR time, not now | §4, §11 Step 12, SQ-K |
| C7 | **B-7 limits.** TL runs it, not an automated driver. Choose an expired revocable row if one exists (an accident then revokes a dead link), else a pending row. Network open before opening. Close with a mouse click on "Keep it"; no key is pressed while the dialog is open. Any POST seen is reported at once as an incident | §9 |

#### Rulings on SQ-A to SQ-L

| # | Ruling |
|---|---|
| SQ-A | **Yes.** One `InviteDraft` in page state, form controlled, `submitting` and `error` local, both exports from `CreateInviteForm.tsx` (no new file keeps G-1 and the registry unchanged). The type-change grant reset moves into the draft update and is pinned (C3 a) |
| SQ-B | **The heading**, `tabIndex={-1}` with the A-1 ring, via the optional `headingRef`. Naming the `section` would make a landmark (A-9) |
| SQ-C | **Yes.** Same discipline as Revoke (C5 a). Two invites and two real emails from a double click is a real harm; bytes unchanged |
| SQ-D | **Yes.** Required by SA-C9: Cancel would otherwise close in flight. The corner X stays visible and does nothing in flight, as in LF-3b |
| SQ-E | **Email plus created time to the second, UTC** (C1). Email plus date is not unique |
| SQ-F | **Yes.** "Revoke the invite for {email}?" as the only new visible string; label and both button words unchanged; `aria-describedby={undefined}` as `AdminDrawer` and LF-3b |
| SQ-G | **Yes.** Page-owned, one instance, `InviteList` reduced to `onRevoke(invite, button)` |
| SQ-H | **Stay open** on failure with the error and the reason. Today's behaviour, and it lets the admin fix a too-short reason; the Messages dialog has nothing to correct |
| SQ-I | **Yes.** `invites-content` gains `tabIndex={-1}` (standard D-7 last sentence, `messages-content` precedent). No visible ring is needed on a programmatic target, but do not suppress the outline globally |
| SQ-J | **The two named files.** Optionally add `AdminDrawer.tsx` (one line, shows the path); `lib/utils.ts` adds nothing |
| SQ-K | **As planned, with C6** for the Messages row. TL may word the §1 rows |
| SQ-L | **Yes**, checksum recorded in this workplan (C3 c) |

#### Optimisation suggestions (not blocking)

- Exit flash: if the drawer body renders only while `draft` is non-null, clearing the draft on success or Cancel blanks the drawer during its close animation. Clearing it once the close has finished (for example in `onReturnFocus`, alongside the flag in C4 a) avoids that.
- A kept draft can outlive a Refresh that changes `formOptions` (a type no longer available, a grant withdrawn). The form already refuses an unavailable type and the server refuses a withdrawn grant, so this is safe; resetting a draft whose `inviteType` is no longer offered on reopen would be friendlier.
- M15b: the same history line in `components/ui/dialog.tsx`, to prove the walk reaches the second file too. Cheap, restored by checksum like M15.

### Approval

- [x] Workplan approved with conditions C1 to C7: apply them to this workplan, then proceed from Step 4 (pins first)

### SA conditions applied (Dev, 2026-10-13)

| # | Applied in |
|---|---|
| C1 | R-10 (name with the created time to the second, UTC, local `secondUtc()`), R-1 test, §7.2, B-6, component tree |
| C2 | §7.2 absence test with a pending-row positive control |
| C3 | §5: RP-13 (grant reset), portal-safe `screen` queries, SHA-256 at Step 4 and Step 11 |
| C4 | N-10 (close on success by state, not `onClose`), N-12 (flag consumed, disabled or detached targets skipped, activeElement check), D-12 |
| C5 | N-9 (send-once ordering), R-1 (`open` apart from the kept target, `openKey`), R-9 (body keyed by `openKey`), R-10 test |
| C6 | Step 12. `git fetch origin main` at the start of the build: `origin/main` still `8014ee73`, merge "Already up to date" (no merge commit); `gh pr view 348`: OPEN, so Q-8 is not retired and the requirement's LF-3b row records it as owed on #348's merge. **Then, for SA F-1:** #348 merged; `origin/main` `f302680f` taken in as a fast-forward; the standard's §1 row 12 marks Q-8 retired by LF-3b (#348) with a Change History row; the LF-3b row's "owed" note dropped in favour of main's "MERGED (#348)" |
| C7 | B-7 is TL's, with the limits above; Dev does not run it |
| Suggestions | N-16 (draft cleared once the close has finished), N-17 (stale type reset, D-13), M15b |

### SA Code Review

**Code Review by SA — 2026-10-13**
**Status:** APPROVED WITH FIXES (F-1 below; a docs-only change after merging `origin/main`)

Reviewed the uncommitted diff against `8014ee73` in `neuronforge-admin-layout-2`: `page.tsx`, `CreateInviteForm.tsx`, `RevokeDialog.tsx`, `InviteList.tsx`, `CreatedLinkPanel.tsx`, `AdminDrawer.tsx`, `source.guard.test.ts`, the `page.render` edits, both new suites, and both requirement docs. Pins file SHA-256 re-computed: `c51803175b1ee8a91d21772a2eaec735feb78b4dfd418ab48f25358ac8f52828`, equal to Step 4 and Step 11. SA run: `source.guard`, `invites.requestPins` and `invites.openRule`, 3 suites, 187 tests, all pass (56 s). `page.render` was not re-run by SA (QA owns the full run; watch the one unreproduced timeout noted in Results).

#### Conditions C1 to C7

| # | Verdict | Evidence |
|---|---|---|
| C1 | Met | `InviteList.tsx` `secondUtc(iso)` gives `YYYY-MM-DD HH:mm:ss UTC` from the ISO string, next to `day()`, same UTC assumption, no shared formatter. `aria-label` "Revoke invite for {email} (created ... UTC)"; visible text still "Revoke", and the name starts with it. R-1 uses two rows, same email, 7 seconds apart, and asserts both exact names and the visible text |
| C2 | Met | The absence test now has a pending row: exactly one `/^Revoke/` button in the list, proven to be inside `invite-row-p`, then none in the accepted and revoked rows, all in one render |
| C3 | Met | RP-13 present (tier-c, switch type, switch back, select reads tier-b and the body string carries `"grantId":"tier-b"`). The form and the revoke surface are always entered through `screen.findByTestId`; `within(form)` / `within(dialog)` is used only after that, which is portal-safe. SHA recorded at Step 4 and Step 11 |
| C4 | Met | (a) `onCreateClosed` reads and clears `focusPanelNext` first, whichever branch runs; D-12 covers it, and SA mutation SA-1 (the clear removed) bit D-12. (b) `focusIfAble` refuses null, detached and disabled-button targets and returns `document.activeElement === target`; the chain ends at `contentRef`, which is `tabIndex={-1}`. (c) `onCreated` closes through `shutCreate()`, not the busy-guarded `onCreateClose`. Revoke success likewise closes through `shutRevoke()`, never `onOpenChange` |
| C5 | Met | (a) `CreateInviteForm.submit`: the `isSending` check is the first statement after `preventDefault`; the ref and `onBusyChange(true)` are set before the `fetch`; both are reset in `finally`, which writes only a page ref. (b) The page renders `RevokeDialog` while `revokeTarget` is non-null and never clears it; `open` is held apart in `isRevokeOpen`, so the exit render has a real invite and a title. (c) `RevokeDialog` remounts its body with `key={openKey}`, and `openKey` is bumped on every open; SA mutation SA-2 (the key removed) bit R-10 |
| C6 | Met at build time; now owed (F-1) | At build time #348 was open and Q-8 was correctly left. #348 has since merged (`origin/main` `cc1bf66b`), so the retirement belongs in this PR |
| C7 | Met | B-7 assigned to TL with the limits; Dev did not run it |

#### Request bytes (diffed against `origin/main`)

The `submit` functions of `CreateInviteForm.tsx` and `RevokeDialog.tsx` were extracted from `origin/main` and from the worktree and compared line by line. The only differences are the send-once lines (`if (isSending.current) return;`, the ref set, `onBusyChange(true)`, and their resets in `finally`). The `CreateInviteRequest` object, its key order, the trims, the access and grant branches, the URLs, `encodeURIComponent`, the init objects, the `readJsonBody` reads and both error maps are untouched. The draft destructuring keeps the same local names, so the builder reads the same values. `origin/main` since `8014ee73` does not touch any Invites file, `sheet.tsx` or `dialog.tsx`. RP-1 to RP-13 back this up byte for byte.

#### Other checks

| Check | Finding |
|---|---|
| D-7 (a) | No router, history, storage, search params or `useAdminFilters` in any changed product file (the only hits are comments saying so). D-11 spies cover open, Escape, reopen, Cancel and create |
| G-8 | The first line of `escapes()` is `relative === DIALOG_FILE && specifier === DIALOG_PRIMITIVE`, exact on both sides (V-5 confirmed restored). Negative controls cover three other files, `dialogX`, `dialog/index`, `button`, `sheet` and the relative spelling. Liveness reuses the G-7 extractor and also proves no other Invites file names `@/components/ui/` |
| G-7 | The positive control now lists `components/ui/sheet.tsx` and `components/ui/dialog.tsx`; M15 and M15b prove the per-file ban really runs on each |
| `AdminDrawer.tsx` | Comment-only: 9 added lines, all inside the header block comment; no code line changed |
| Standard edits | §5.8 gains the OR-1 to OR-6 table after D-8; §1 row 11 marks Q-7 retired by LF-3a; §7.9 gains the LF-3a note; §9 F-41 and F-110 are "closed by LF-3a (on merge)"; Change History row added. Q-8 still stands in row 12 (F-1) |
| Logging and types | No `console.*`, no `any` or `as any` in any changed product or test file. No backslash in the three MDs |
| Security and data | No route, repository, Zod, RLS or entitlements surface touched. The draft (email, reason, note) lives in React state only |

#### Deviations

| # | Ruling |
|---|---|
| V-1 | Accepted. `isCreateOpen` and `isRevokeOpenRef` stop a late `onCloseAutoFocus` from pulling focus out of a surface reopened during its exit animation. Small and well commented |
| V-2 | Accepted. Cancel first matches LF-3b and the dark dialog; words unchanged; `slate-300` reads on the dialog surface |
| V-3 | Accepted. Reusing the G-7 extractor is better than a second pattern |
| V-4 | Accepted. Scoped to one script-only focus target, with the Audit trail precedent; nothing is suppressed globally |
| V-5 | Confirmed: the G-8 line is the exact two-sided condition, and M13 bites on it |

#### SA mutations (both restored, SHA-256 equal before and after)

| # | Mutation | Bit |
|---|---|---|
| SA-1 | `page.tsx` `onCreateClosed`: the `focusPanelNext.current = false` line removed (C4 a) | D-12 (1 of 26 in `invites.openRule`) |
| SA-2 | `RevokeDialog.tsx`: `key={openKey}` removed from the inner part (C5 c) | R-10 (1 of 52 across `invites.openRule` and `invites.requestPins`) |

#### Fixes

| # | Fix | Priority |
|---|---|---|
| F-1 | **Retire Q-8 now (C6).** PR #348 (LF-3b) is on `origin/main` (`cc1bf66b`), and its Messages page no longer calls `confirm(`. Merge `origin/main` into this branch first. Expect a conflict on the §1 LF-3b row of `ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md`: keep main's "MERGED (#348)" text and drop this branch's "Owed on #348's merge" note. Then, in `ADMIN_LAYOUT_STANDARD_REQUIREMENT.md`: in §1 row 12 (Messages), mark "Page deviation: `confirm()` kept for Delete and Mark All Read (Q-8, §5.8 D-8)" as retired by LF-3b (#348), in the same style as row 11's Q-7; add a new standard Change History row for it (keep the existing LF-3a row as a historical record). Update this workplan's Results "Base" and the C6 row of "SA conditions applied". Re-run the three Invites suites after the merge. Docs only, no SA re-review needed; QA or TL can check the text | Medium (the standard must not keep stating a deviation that no longer exists) |

#### Optimisation suggestions (not blocking)

- `CreateInviteForm` `update()` spreads the `draft` from the render closure, not a functional updater. Two changes in one tick would drop the first. No current control does that (the type radio already sends type and grant together), so leave it; worth a one-line note if the form ever gains a control that writes two updates.
- `aria-busy` is set on both `DialogContent` and the Revoke submit button. Harmless; one would do.
- §1 row 11 says Q-7 is "retired" while F-41 and F-110 say "(on merge)". Either wording is fine; RM can align them when the PR merges.

### Code Approved for QA: Yes (with F-1 applied before the PR is opened)

## QA Testing Report

### QA Report

**QA — 2026-10-13**
**Verdict:** PASS WITH NOTES (no bugs; three notes, none blocking)
**Test mode:** full
**Strategy used:** A and B (Jest render tests with a mocked `fetch`), plus a throwaway QA probe suite (14 cases) written for this pass and deleted afterwards. Browser checks (§9) are TL's and were not attempted.
**Focus:** ui, security (request bytes), keyboard and focus
**Skipped:** browser checks B-1 to B-8 (TL's, by instruction)
**Input source:** prompt keywords (TL task list)
**Code tested:** the uncommitted diff on the branch base `8014ee73`, before SA's F-1 (merge `origin/main`, retire Q-8; docs only). The Invites suites should be re-run once after that merge, as F-1 already says

#### Runs

| Check | Result |
|---|---|
| `jest app/admin/business-os-invites app/admin/components` plus `lib/admin/__tests__/admin-authz-surface.guard.test.ts` and `app/__tests__/tailwind-css-escape.guard.test.ts` | 29 suites, 1,084 tests, all pass (160 s) |
| `npm run lint:hooks` | exit 0 |
| `jest app/admin/business-os-invites`, three runs in a row | 5 suites, 271 tests, all pass each time (93 s, 127 s, 123 s; `page.render` 84 s, 115 s, 109 s). No timeout, no failure in `page.render` |
| Same folder with the QA probe present, three more runs | 6 suites, 285 tests, all pass each time |
| QA probe alone and under 4-way parallel stress (with `page.render` and `invites.openRule`) | 12 further runs green; see note N-2 for one unreproduced failure |
| SHA-256 of `invites.requestPins.render.test.tsx` | `c51803175b1ee8a91d21772a2eaec735feb78b4dfd418ab48f25358ac8f52828`, equal to the Dev's Step 4 and Step 11 values |
| Source guard G-1 with a `zz` test file present | Still green: G-1's exact list covers product files only, so a test file does not trip it |
| `git status` after the probe was deleted | Only the Dev's 10 modified and 3 new files; no `zz` file left; `git diff --numstat` shows no deletion without insertion |

#### Test Coverage

| Criterion | Tested? | Result | Evidence |
|---|---|---|---|
| New invite opens the drawer, focus inside it | ✅ | Pass | D-1; probe Q-1 (active element inside `create-invite-drawer`) |
| Typing then Escape, overlay or X keeps the draft on reopen | ✅ | Pass | D-2, D-3 (every one of the 10 values) |
| Cancel clears the draft | ✅ | Pass | D-4 |
| Create sends the exact pinned request once, including a double click | ✅ | Pass | RP-1 to RP-6, D-6 (same tick); probe Q-2: a real `dblClick` on Create sends one POST with the exact URL, init keys in order, headers and body string |
| The drawer cannot close in flight | ✅ | Pass | D-5 (Escape, overlay, X, Cancel disabled); probe Q-5 (Cancel click and Escape in flight, then a 500: drawer stays open with the sentence and the draft; Escape closes it once the request has settled) |
| Success: focus to the created-link heading; panel outside the drawer | ✅ | Pass | D-7, D-10, D-12; probe Q-3 (panel has no `role="dialog"` ancestor, focus on its `h2`) |
| Failure: drawer stays open with the error and the draft | ✅ | Pass | D-8 (409), RP-7 (every code, non-JSON, rejected); probe Q-4 (rejected fetch, then Escape and reopen: draft kept, stale error gone) |
| A type change resets the grant | ✅ | Pass | RP-13; probe Q-7 (default plan shown on choosing the granted type) |
| Each Revoke button has a unique name, incl. two same-email same-day rows | ✅ | Pass | R-1; probe Q-8 (09:00:00 and 18:30:59 give different names). See N-1 for the same-second case |
| Revoke dialog opens with focus on the reason field | ✅ | Pass | R-2; probe Q-10, Q-12 |
| "Keep it" sends nothing | ✅ | Pass | R-4; probe Q-9 |
| Confirm sends the exact pinned request once | ✅ | Pass | RP-8, RP-9, R-6 (same tick and `dblClick`); probe Q-9 (id `inv/1 a`, padded reason, `dblClick`: one POST, URL `inv%2F1%20a`, init keys in order, body `{"reason":"QA pin reason"}`) |
| The dialog cannot close in flight | ✅ | Pass | R-5 (Escape, outside click, X, Keep it disabled, `aria-busy`) |
| On failure it stays open, keeping the reason | ✅ | Pass | R-9 (409), RP-10; probe Q-10 (rejected fetch), Q-11 (non-JSON 500, then a retry succeeds: two POSTs in total, one per confirm) |
| Focus returns to the opener, or to `invites-content` if the row is gone; never body | ✅ | Pass | R-4, R-7, R-8, R-9; probe Q-10 (X after a failure returns to the opener), Q-11 and Q-12 (content after success, never body) |
| Reopening resets reason, error and busy state | ✅ | Pass | R-10 (reason, other row and same row); probe Q-10 (after a failure and X: empty reason, no alert, `aria-busy` false, Keep it enabled, focus in the field) |
| No URL change at any point (D-7) | ✅ | Pass | D-11 (create flows), G-6 and G-7 guards; probe Q-14 (revoke flows: Keep it, a refusal, a retry and a success leave history, `location.href` and both storages untouched) |
| Keyboard only: create | ✅ | Pass | Probe Q-6: focus "New invite", Enter, focus lands on Email, type, Tab to the type and access radios, Space, Tab to the reason, type, Enter: one POST, drawer closes, focus on the panel heading, one Tab reaches Copy |
| Keyboard only: revoke | ✅ | Pass | Probe Q-12: focus the row's Revoke, Enter, type the reason, Enter: one POST with the exact body, focus not on body; Q-13: Tab stays inside the dialog |

#### Issues Found

##### Bugs (must fix before commit)

None.

##### Performance Issues (should fix)

None. The Invites folder runs in 93 to 127 s on this machine; `page.render` is the longest suite (84 to 115 s), and no test came near its 30 s per-test limit.

##### Edge Cases and notes (nice to fix, not blocking)

1. **N-1, two invites for one email created in the same second share a Revoke name.** `secondUtc()` drops the milliseconds, so `2026-10-01T18:30:59.000Z` and `...59.900Z` give the same `aria-label` (probe Q-8 asserted the collision). Severity: Low. Only reachable by two creates for one email inside one second (two admins, or a script); the per-form double submit is already blocked. No action needed unless SA wants the milliseconds or another distinguishing part in the name.
2. **N-2, one unnamed probe failure under load.** In one run of the QA probe, taken while other Jest processes were running on the machine (SA's review ran in parallel), 1 of 14 probe cases failed; the case name was not captured (the output filter missed Jest's Windows failure mark). It did not recur in 12 further runs, including four Jest processes in parallel, and none of the Dev's suites failed in any QA run. This matches the Dev's single `page.render` failure under load (194 s). The likeliest cause is a `waitFor` default of 1 s expiring on a saturated machine; not a product defect. If it shows up in CI, raise the `waitFor` timeout on the focus assertions rather than retrying.
3. **N-3, a kept draft can carry a withdrawn grant.** If a Refresh withdraws a plan but keeps its type, the kept `grantId` is still sent and the server refuses it with "That plan is no longer offered." Accepted by SA as an optimisation note at workplan review; recorded so it is not rediscovered.

#### Final Status

- [x] All acceptance criteria pass, ready for commit once SA's F-1 (docs only) is applied with the suites re-run, and TL's browser checks B-1 to B-8 are done
- [ ] Issues found, Dev must address before commit

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/admin-layout-lf3a` |
| Feature commit | `58a6f2ea` feat(admin): Signup Invites opens New invite in the side panel and asks before Revoke (LF-3a) |
| Merge of `origin/main` | `1454ca9b` (main at `229a6c2e`, no conflict) |
| PR | [#353](https://github.com/AgentsPilot/neuronforge/pull/353), open; the user merges |
| Checks after the merge (RM) | 29 suites, 1,086 tests pass; `npm run lint:hooks` exit 0; request pin SHA-256 `c518031…` unchanged |
| Owed | TL browser checks B-1 to B-8 (read-only) |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-13 | Created (Dev) | Workplan written, awaiting SA review. Drawer form with the draft in page state, in-flight close refusal and focus to the created-link heading (SA-C9); Revoke as a page-owned screen-local dialog with focus on the reason, one send and no close in flight (SA-C10, LF3B-F1 ruling); F-41 and F-110 closed; G-8 guard amendment; request pins first; 16 mutations; SA questions SQ-A to SQ-L; no user question |
| 2026-10-13 | SA workplan review (SA) | APPROVED WITH CONDITIONS C1 to C7: row names carry the created time to the second in UTC (SQ-E, not unique by date); positive control in the absence test; RP-13 grant reset and portal-safe pin queries; focus flag consumed and disabled targets skipped; send-once ordering and a null-safe Revoke exit render with state reset on every open; Q-8 retired only once LF-3b #348 is on main; B-7 limits. SQ-A to SQ-L ruled |
| 2026-10-13 | Built (Dev) | SA conditions C1 to C7 and the three suggestions applied to the plan, then built. Pins first (SHA-256 identical before and after); 271 Invites tests and 1,084 in the combined run pass; 17 mutations all bite; standard §5.8 OR-1 to OR-6, Q-7 retired, F-41 and F-110 closed on merge, Q-8 left for LF-3b (#348 open). Results above; uncommitted |
| 2026-10-13 | SA code review (SA) | APPROVED WITH FIXES. C1 to C7 met in the code; request bytes identical to `origin/main` (submit functions diffed, only send-once lines added); D-7 (a) holds; G-8 exact with controls and liveness, G-7 reaches `sheet.tsx` and `dialog.tsx`; `AdminDrawer` comment-only; V-1 to V-5 accepted. SA mutations SA-1 (D-12) and SA-2 (R-10) bit and were restored. F-1: #348 has merged, so merge `origin/main` and retire Q-8 in the standard's Messages row (docs only) |
| 2026-10-13 | QA (QA) | PASS WITH NOTES. 29 suites, 1,084 tests green; lint:hooks exit 0; Invites folder green three runs in a row (271 tests, no `page.render` timeout); pins SHA-256 unchanged; 14-case throwaway probe (focus inside the drawer, real double click on Create and on confirm, in-flight lock, failure paths, reopen reset, revoke URL and storage, keyboard-only create and revoke) all green, then deleted. No bugs. Notes: same-second Revoke names collide (Low), one unreproduced probe failure under load, a kept draft may carry a withdrawn grant (the server refuses it). Re-run the Invites suites after SA's F-1 merge |
| 2026-10-13 | SA F-1 applied (Dev) | `origin/main` `f302680f` taken in (fast-forward, no merge commit; only the follow-ups requirement needed its LF-3a rows put back); standard §1 row 12 Q-8 retired by LF-3b (#348) with a Change History row; follow-ups §14 gains LF3A-F1 (QA N-1); Results "Base" and the C6 row updated. Suites re-run; pin SHA-256 unchanged |
| 2026-10-13 | Committed, PR opened (RM) | Commit `58a6f2ea`, `origin/main` merged in `1454ca9b`; suites and lint:hooks green after the merge; PR #353 open (fast-track). Browser checks B-1 to B-8 owed |
