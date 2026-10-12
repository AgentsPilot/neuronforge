# Workplan: Admin Layout Standard — Slice L-7 (Messages)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 12), §3, §4.10, §5.1, §5.3, §5.4 K-1, §5.5, §5.6 (U-1 exception (1), U-2 to U-4), §5.7, §5.8 (D-1 to D-8), §5.9, §5.10, §5.11, §5.12, §6.1 (S-1, S-6), §6.2 C-2, C-3, C-4, C-5, C-7, C-8, C-9, C-12, C-13, C-14, §7.10, §9 F-1, F-5 to F-17, §10 D-3 (a), D-6 (a), D-13 (a), D-14 (b), D-16, D-17; SA rulings SA-R-8 (search never in the URL), SA-R-9 (no Messages KPIs), re-check R-15 (Reply control, modal and handler removed from the page; no route touched), R-7 (a page slice that builds a shared export runs the full cycle)
**Skills applied:** none of the domain skills is triggered: no service-role write is added or changed (the routes are not touched), no AI call, no queue, no DB claim beyond the fields the page already reads, and no import from `lib/business-os/entitlements/`
**Branch:** `feature/admin-layout-l7`, cut from `feature/admin-layout-l6` (PR #315 open). The L-7 PR targets `main` and carries L-6 until #315 merges. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-12
**Status:** Code Complete (2026-10-12, uncommitted; awaiting SA code review + QA). SA workplan review 2026-10-12: APPROVED WITH CONDITIONS (M-1 to M-4 applied to this file by Dev before coding; no second SA pass). User decision D-19 (2026-10-12): show a short message when an action fails
**Path:** **UI short path by classification** (R-7): L-7 builds **no** shared export. Every shared part it uses exists on the branch: `AdminPageHeader` with `actions`, `AdminFilterBar` with page controls, Clear, `canClear` and `readAt`, `ADMIN_FIELD_LABEL` / `ADMIN_FIELD_CONTROL`, `useAdminFilters` + `textFilter`, `AdminLoading` / `AdminError` / `AdminEmpty`, `readAdminResponse` (with `sessionEndedCopy`) / `readJsonBody` / `ADMIN_NETWORK_ERROR`, `StatusChip` tones `info` / `ok` / `neutral` / `warn` / `danger`, the `adminTable` constants and `ADMIN_BUTTON`, `formatUtc` / `formatCount`, `AdminDrawer` + `DrawerSection` / `DrawerFields` / `DrawerField` + `OpenRowButton`. The only shared-folder edit is the migrated-pages registry entry in its guard test (the L-3 to L-6 precedent). Run under the user's fast-track: SA workplan review → Dev → SA code review + QA → RM commits and opens the PR (no user diff review)

## Overview

L-7 moves `/admin/messages` (one 780-line client `page.tsx`, no tests) onto the standard. The h1 becomes "Messages", the sidebar label (D-3 (a)); the repeating "Messages" pill goes. There is no KPI strip (D-13 (a)). Refresh moves into the shared filter bar, which holds Search (page-held, never in the URL) and Status (in the URL as `status`), Clear, Read at and Refresh. The early-return full-page spinner goes (F-17), and a failed read finally says so instead of "No messages found" (F-9, GET half). The list becomes the standard table with status and priority as chips and times in UTC with an age hint. The hand-built detail modal becomes one page-level `AdminDrawer` (Escape, focus trap, focus return), keyed by the message id. **The Reply control, the Reply modal and their handler are removed from the page** (D-14 (b), R-15); the routes are not touched. Saving notes, marking read or unread, deleting and Mark All Read failed silently; by user decision D-19 each now shows one short fixed line next to the action that failed (§2.10), with no request change. The six `console.error` calls in the page become `clientLogger` (CLAUDE.md Logging, SA M-4). Because the page has no tests, the slice **starts with a characterisation suite of today's behaviour**, run green on the unchanged page, and then migrates, editing only the cases that pin a forced change.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-46a69ad3)
- [2. Scope and decisions](#2-scope-and-decisions)
- [3. Implementation Approach](#3-implementation-approach)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Guard and registry changes](#5-guard-and-registry-changes)
- [6. Tests](#6-tests)
- [7. Verification](#7-verification)
- [8. Task List](#8-task-list)
- [9. Sizing](#9-sizing)
- [10. Risks](#10-risks)
- [11. Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
- [12. Questions for SA](#12-questions-for-sa)
- [13. Product question for the user](#13-product-question-for-the-user)

---

## 1. Analysis Summary (code verified at `46a69ad3`)

### 1.1 The page today (`app/admin/messages/page.tsx`, 780 lines, one file)

| Lines | What | Standard item |
|---|---|---|
| `:25-51` | `ContactMessage` and `MessageReply` interfaces (status `unread` / `read` / `replied`; optional subject, phone, company, priority, source, updated_at, admin_notes, replies) | Moved to `messagesTypes.ts`, unchanged |
| `:54-63` | State: `messages`, `loading`, `selectedMessage` (a **copy** of the row), `filter`, `searchTerm`, `replyContent`, `adminNotes`, `showReplyModal`, `sendingReply`, `editingNotes` | Drawer keyed by id (§5.8); Reply state removed (R-15) |
| `:65-77` | Two effects: read on `filter`; a 300 ms debounced read on `searchTerm` **only when it is not empty** (`:71`), so emptying the box never reloads (F-16). Deps omit `fetchMessages` (F-15) | §5.5 Apply semantics, D-16 |
| `:79-98` | The read: `GET /api/admin/messages?filter=…&search=…`; non-ok throws; **any failure sets `messages = []` and shows "No messages found"** (F-9); `console.error` (`:93`) | §5.10, C-4, F-8 |
| `:100-120` | `updateMessageStatus`: `PATCH /api/admin/messages/{id}` body `{ status, updated_at }`; on ok patches the list and the copy; **failure silent** (`console.error :118`) | Kept request; F-9 action half (user) |
| `:122-145` | `saveAdminNotes`: PATCH body `{ admin_notes, updated_at }`; on ok patches both and leaves edit mode; failure silent (`:143`) | Kept request |
| `:147-199` | `sendReply`: `POST …/{id}/reply` (the route is `/replay`, so a 404, F-1), then a second PATCH `{ email_sent: true }` (F-11); `console.error :195` | **Removed** (R-15) |
| `:201-218` | `deleteMessage`: `confirm('Are you sure you want to delete this message?')`, `DELETE /api/admin/messages/{id}`, on ok drops the row and closes the modal; failure silent (`:216`) | Kept (F-10 open) |
| `:220-226` | `markAsRead`: if unread, **awaits** the PATCH, then opens the modal with the **old row object** (so an unread message opens showing "Unread" although it was just marked read), and seeds the notes draft | §5.8; §1.4 |
| `:228-243` | Client filter on top of the server's: status and a five-field substring search, then newest first | Kept |
| `:245-294` | `getStatusBadge` pills (Unread + pulsing dot, Read, Replied + mail icon + thread count; lucide `title` props, F-15) and `getPriorityBadge` colour map (low slate, normal blue, high orange, urgent red) | §5.9 |
| `:296-307` | `formatDate`: "Just now", "Nh ago", "Nd ago", then `toLocaleDateString()` (local) | §5.11 |
| `:309-315` | **Early-return full-page spinner** on every read (F-17): the header, the search box and the table unmount on each keystroke-triggered read | §5.10 |
| `:322-362` | Header: h1 "Contact Messages", a "Messages" pill, an "N unread" pill, "Mark All Read" (`confirm('Mark all messages as read?')`, N parallel PATCHes, then a re-read; F-12; `console.error :345`), an icon-only Refresh with no name | §5.3, D-3 (a), A-2 |
| `:365-391` | Filter card: search input (placeholder only, no label), status select (no label, no `[color-scheme:dark]`, `as any`) | §5.5, rule 6 |
| `:394-508` | Table: `w-full`, `px-6 py-4`; unread rows tinted with a left border; **whole row click opens** (`:421`); per row Eye (View details), **Reply**, Trash, each icon-only with `title` only (A-2) | §5.7, §5.8, D-17 |
| `:511-702` | Detail modal (hand-built, no Escape, no focus trap, unnamed X): **Reply** button, "Mark as Unread" (when not unread), contact block, details block (Received / Last Updated as local `toLocaleString`, Source), the message, Admin Notes (Edit ↔ Save toggle, textarea), Conversation Thread | §5.8 D-1 |
| `:705-778` | Reply modal | **Removed** (R-15) |

### 1.2 The routes (not touched)

| Route | Answers | Consequence for the page |
|---|---|---|
| `GET /api/admin/messages` (`route.ts`) | 200 `{ messages: [...] }` with `replies` attached (**no `success` flag, no `data`**); 500 `{ error: 'Failed to fetch messages' }` or `{ error: 'Internal server error' }`; the gate's 401 / 403 `{ success: false, error: 'Unauthorized' / 'Forbidden' }` | `readAdminResponse`'s ok branch requires `success === true` and reads `data`, so it cannot read this 200. §2.5 reads the ok branch with `readJsonBody` and hands only non-ok responses to `readAdminResponse` (no shared change). Recorded as F-111 (API, open) |
| `PATCH /api/admin/messages/{id}` | 200 `{ message }`; 500 `{ error }` | The page reads only `response.ok`, as today; no body read |
| `DELETE /api/admin/messages/{id}` | 200 `{ success: true }`; 500 `{ error }` | The same |
| `POST /api/admin/messages/{id}/replay` | Stub (F-1) | Never called by the page, before or after (the page called `/reply`) |

### 1.3 Who else renders this folder's code

Nobody. The only references to `/admin/messages` outside the page are the sidebar entry (`AdminSidebar.tsx:160-161`, label "Messages") and its nav test (`AdminSidebar.nav.test.ts:112`). The API gate tests (`app/api/admin/__tests__/adminGate.writes.test.ts:310-345`) import the routes, not the page.

### 1.4 Behaviour quirks today that the drawer's single source of truth changes (no request changes)

| Today | After L-7 | Why |
|---|---|---|
| An unread message opens showing the "Unread" chip, because the modal holds the row object from before the PATCH | The drawer shows the list's row, so it reads "Read" once the PATCH succeeds | The drawer is keyed by id and reads the row from `messages` (§5.8, the L-1d / L-4b pattern); no copy to go stale |
| "Mark as Unread" sets the modal to "Unread" even when the PATCH fails | The drawer shows "Unread" only when the PATCH succeeded | Same |
| Notes edit mode carries over: Edit on message A, close, open B → B opens in edit mode | Edit mode and the draft belong to the drawer body, keyed by id, so each message opens read-only | Same |
| The modal opens only after the mark-read PATCH settles | The drawer opens at once; the same PATCH is sent at the same moment | Q-3. Same request, same body, same order |

These are side effects of the forced modal → drawer move (§7.10), listed in the PR, not separate fixes.

---

## 2. Scope and decisions

### 2.1 In L-7

| # | Item | Standard |
|---|---|---|
| S-1 | Header via `AdminPageHeader`: h1 "Messages", one-sentence purpose, "Mark All Read" in `actions` (only while at least one loaded message is unread, as today). No badge, no "As of". The "Messages" pill and the "N unread" pill are removed (§2.6) | §5.3, D-3 (a) |
| S-2 | No KPI strip | D-13 (a), K-1 |
| S-3 | Filter bar via `AdminFilterBar`: Search (page-held), Status (`useAdminFilters`, key `status`), Clear, Read at, Refresh (§2.3) | §5.5, §5.6, D-6 (a), D-16 |
| S-4 | States: `AdminLoading` (first read), `aria-busy` on refresh, `AdminError` for a failed read, `AdminEmpty`; content area always mounted; newest read wins (§2.5) | §5.10, F-9, F-17 |
| S-5 | Table on the `adminTable` constants; status and priority chips; Received (UTC) + age; Open button in the first cell; Delete named; Reply gone (§2.4, §2.7) | §5.7, §5.9, §5.11, A-2 |
| S-6 | One page-level `AdminDrawer` keyed by the open id: status + Mark as Unread, contact, details, message, admin notes (Edit / Save, same PATCH), conversation thread (§2.7) | §5.8 |
| S-7 | **Reply removed**: the row Reply button, the drawer Reply button, the Reply modal, `sendReply`, the reply state, the `Reply` / `Send` icon imports. No `/reply` or `/replay` string left in the page folder (guard) | D-14 (b), R-15 |
| S-8 | `console.error` ×6 (`page.tsx:93,118,143,195,216,345`; the `:195` one goes with Reply) → `clientLogger.child({ module: 'AdminMessagesPage' })` (SA M-4: CLAUDE.md § Logging governs, so all are converted; TL names the file and count in the hand-back). **Allowed facts**: HTTP status, row count, failed-of-N count, `hasSearch` boolean, the status filter value, the message id. **Never**: name, email, phone, company, subject, message text, notes or draft, search text, reply content. Non-ok PATCH / DELETE responses at `warn` (unlogged before); a rejected `fetch` at `error` with `{ err }` | CLAUDE.md Logging, F-8 (page half) |
| S-11 | Action failures shown (D-19, §2.10) | User D-19, F-9 action half |
| S-9 | Characterisation suite first, then the migrated suite (§6) | F-14, §7.10 |
| S-10 | New page `source.guard`; registry entry (§5) | C-14 |

### 2.2 Decision: no KPI strip, and where the unread count goes

No strip (D-13 (a)). Today's "N unread" header pill counts the loaded list, which the server has already filtered by status and search, so under "Replied" it silently vanishes. **Decision: the count moves into the §5.7 count line above the table, worded over the rows shown**: "12 messages, 3 unread, newest first" (`messages-count`, `ADMIN_COUNT_LINE`; numbers through `formatCount`; "1 message", the unread part omitted at 0). It describes what is on screen, so it is true under any filter (K-8 spirit), and it is not a header badge (§5.3: a badge is a factual state, not a count). Q-1.

### 2.3 Decision: the filter bar (§5.5, §5.6)

New `messagesFilters.ts`: `MESSAGES_FILTER_SPEC = { status: textFilter({ key: 'status', defaultValue: 'all', isValid: isMessageStatusFilter }) }`, module level (the hook needs a stable spec), and `MESSAGES_WHAT = 'messages'`.

| Part | On Messages |
|---|---|
| 1-2 Window / Custom | **Not shown.** No date filter today; adding one is a behaviour change (§7.10) |
| 3 Business | **Not shown.** Contact messages are not per business |
| 4 Page filters | "Search" (visible label, `type="text"`, placeholder "Search messages…" kept, `maxLength` unchanged (none)); "Status" (visible label, the same four options and words: All Messages, Unread, Read, Replied; `ADMIN_FIELD_CONTROL`, which carries the dark scheme through the chrome root; the `as any` cast replaced by the typed narrow) |
| 5 Clear | Always rendered; disabled at the defaults (`isDefault && searchTerm === ''`). Resets status to `all` and empties the search: exactly one read follows (the L-4a SA M-1 mechanism) |
| 6 Read at + Refresh | "Read at HH:mm UTC" of the last successful read; "Refresh" named "Refresh messages" |
| 7 Chips | None: both filters are visible in their controls |

- **Status in the URL** (§7.10, U-1): `?status=unread|read|replied`; `all` omitted (U-3); an unknown value ignored (U-4). Writes by the hook's `replaceState` only. Opening `/admin/messages?status=unread` reads the unread list on the first request (no second read).
- **Search never in the URL** (SA-R-8, D-6 (a)): page `useState`, never read from an inbound link either (Messages has no inbound `search` link today). It still travels to the API in the fetch's query string, as today (that is the server request, not the address bar).
- **Search applies on the existing 300 ms debounce**, and **emptying the box reloads** (D-16 behaviour). Decision and reason: the standard's Clear (§5.5 part 5, mandatory) empties the box; without the reload, Clear would leave the previous search's rows on screen under an empty box, which is exactly F-16. The user answered this identical defect on Businesses with "Yes, reload" (D-16). The L-4a mechanism is reused: after the pause, read when, and only when, the text differs from the text of the last read **started** (a `lastSearched` ref), so the mount is not doubled and a status change inside the pause sends one read. Q-2 asks SA to confirm that D-16 carries over; §13 tells the user.
- **The read sends the route's own param names** (`filter`, `search`) unchanged: `GET /api/admin/messages?filter=…&search=…`.

### 2.4 Decision: chips (§5.9) and the table (§5.7)

| Today | After | Why |
|---|---|---|
| Status Unread (blue pill + pulsing dot) | `info` "Unread" (`message-status`) | §5.9 lists "unread" under `info`; the dot is decoration and motion, removed |
| Status Read (slate) | `neutral` "Read" | Plain state word |
| Status Replied (green) | **`neutral` "Replied"** (recommended, Q-4) | T-6: green only for a proven outcome. Reply sending is a stub (F-1), so "Replied" proves nothing was delivered. Alternative: `ok` |
| Replied's mail icon (`title="Email sent"`) and thread icon + count (`title` on lucide, F-15) | A wrapper `span` with the `title`, the icon `aria-hidden`, and sr-only words ("Email sent"; "{N} replies in the thread") | A-2, A-7; the L-5 wrapper pattern (StatusChip takes no title) |
| Priority low / normal / high / urgent (slate / blue / orange / red) | `neutral` Low, `neutral` Normal, `warn` High, `danger` Urgent, same words, beside the name as today (`message-priority`) | Recommended, Q-5. Blue `info` for "Normal" would read like "Unread"; urgent is the "needs action" case |
| Unread row: blue tint + left border, bold name | Bold name kept; tint and border removed | The chip says it (A-7); one row style for all (§5.7) |

**Columns** (`ADMIN_TABLE`, `aria-label="Messages"`, `scope="col"`): "Details" (the `OpenRowButton`, name "Open message from {name}"), "Contact" (name, priority chip, email, company), "Message" (subject, two-line clamp of the text), "Status", "Received (UTC)" (`formatUtc` + an age line through a page `ageLine`, the L-4a SA M-3 form), and an sr-only "Actions" header over the Delete button. Delete keeps the Trash icon and gains `aria-label="Delete message from {name}"`. The Eye ("View details") button is replaced by the Open button; the Reply button is removed.

**Row click** stays (today the whole row opens), with all six D-17 rules from Businesses (L-4b SA Q-1 (1) to (6), SA M-3), written out for this page:

1. The `tr` gets `onClick` and `cursor-pointer` only: no `tabIndex`, no `role`, no `onKeyDown`, no ARIA.
2. The handler returns when `event.target.closest(ROW_CONTROL_SELECTOR)` is a control inside the row. This includes the Open button and Delete, so a click on Open never adds a second mark-read PATCH, and a click on Delete never opens the row.
3. The handler returns when a non-collapsed text selection is anchored or focused inside the row (`isSelectingIn`).
4. Otherwise it calls the same `openRow` as the Open button, with the opener = that row's Open button (never the `tr`), so focus returns to the button.
5. The Open button stays the keyboard path (Enter or Space on it opens).
6. The drawer stays page-level, outside the table, so clicks inside it never bubble to a row.

A page-local copy of the two Businesses helpers (`ROW_CONTROL_SELECTOR`, `isSelectingIn`), since one page may not import another page's folder (§3 rule 1). Q-6. This is the second page-local copy (SA N-1).

### 2.5 Decision: states, reads and error copy (§5.10)

- **Content area always mounted** (`messages-content`, `tabIndex={-1}`, `aria-busy` while a read is in flight). Header, bar and search box never unmount (F-17).
- **First read:** `AdminLoading what="messages"` ("Reading messages…").
- **Refresh / filter change:** the table stays, `aria-busy` on the content, Refresh spins.
- **Newest read wins** (a `readSeq` ref, the L-4a SA M-5 pattern): typing, a status change and Refresh can overlap; only the latest read may set state.
- **The list read** (F-111 makes this page-specific):
  - the `fetch` alone inside its own `try` → `ADMIN_NETWORK_ERROR`;
  - `!response.ok` → `readAdminResponse(response, { what: MESSAGES_WHAT, sessionEndedCopy: true })`, which on a non-ok response only ever takes its failure branches: 401 / 403 → "Your admin session has ended. Sign in again."; a route `error` string (rule 1: "Failed to fetch messages", "Internal server error") verbatim; otherwise "Could not read messages. Try again in a moment.";
  - `response.ok` → `readJsonBody(response)`; rows = `body.messages` when it is an array; otherwise (unreadable or wrong shape) the page constant `MESSAGES_READ_FALLBACK = 'Could not read messages. Try again in a moment.'` (the same words as rule 2; the L-6 precedent of a page constant).
- **On failure** the list is cleared, as today (`:94`; §5.5 "the page keeps its existing choice"), and `AdminError` shows with `testId="messages-error"` and Try again. **"No messages found" is never shown for a failure** (F-9).
- **Empty:** `AdminEmpty testId="messages-empty"`: with a filter on, "No messages match this search or status." plus "Clear filters"; with none, "No messages yet." Today's two lines ("No messages found" / "Try adjusting your search or filter criteria") go.
- **Focus fallback** (§5.12 A-3, the L-4a S-5 pattern): when the newest read settles and focus was inside the content area and fell to `<body>`, it goes to the content area.

### 2.6 Decision: header copy

- h1 "Messages" (D-3 (a)); the shell has no title (L-1a).
- Purpose: "Messages sent through the contact form: read them, keep internal notes, and mark them read or unread." No test pins it.
- "Mark All Read" in `actions` on `ADMIN_BUTTON`: same words, same `confirm('Mark all messages as read?')`, the same N parallel PATCHes `{ status: 'read', updated_at }` over the loaded unread rows, then one re-read (F-12 open; behaviour kept).

### 2.7 Decision: the drawer (§5.8)

One `AdminDrawer` at page level, rendered unconditionally outside every state branch (L-2b SA M-4), `open={isOpen && selected !== null}`, `title` "Message from {name}", `titleSuffix` the received time (`formatUtc`), `testId="message-drawer"`. The body is `components/MessageDetail.tsx`, rendered with `key={selected.id}`.

- **Selection** (the L-1d B-1 / L-4b pattern): `isOpen` + `openId`; `selected` is looked up **in `messages`** (the rows the last read returned, after local patches), not in the filtered rows on screen. Reason: under the "Unread" filter, opening a message marks it read, and the client filter then hides its row; looking it up in the shown rows would close the drawer the moment it opened. Q-7.
- **Close when gone:** when the open id is no longer in `messages` (deleted, a read without it, a failed read that cleared the list), an effect ends the open state, so a later read cannot reopen it unasked.
- **Focus:** `onReturnFocus` → the opener when still connected, else the content area (never `<body>`). The opener is the row's Open button whichever path opened it.
- **Opening** sends exactly what today sends: one `PATCH { status: 'read', updated_at }` when the row is unread, nothing when it is not. No other request on open (the replies arrive with the list). The drawer opens at once (Q-3).
- **Sections** (`DrawerSection`, h3): "Status" (the status chip, the replied extras, and "Mark as Unread" when not unread: same PATCH `{ status: 'unread', updated_at }`); "Contact" (Name, Email, Phone and Company when present); "Details" (Received (UTC), Last updated (UTC) when present, Source when present, same `replace('_', ' ')` words); "Message" (heading "Subject: {subject}" or "Message", the text `whitespace-pre-wrap`); "Admin notes" (Edit ↔ Save, the same toggle and words, the textarea gains a visible label "Admin notes" by `aria-labelledby` to the section heading; Save sends `PATCH { admin_notes, updated_at }` and leaves edit mode only on success, as today); "Conversation thread" when replies exist (sender line "Admin Reply" or the contact's name, time in UTC, the text). No Reply button anywhere.
- **Delete** stays in the row's action cell (D-8 allows the row cell), behind the same `confirm()` (Q-8). After a successful DELETE the row leaves `messages`, so an open drawer on it closes by the close-when-gone rule (today's `setSelectedMessage(null)`).

### 2.8 Decision: what stays as it is

| Item | Why |
|---|---|
| Every request: GET URL and params, the three PATCH bodies, DELETE, Mark All Read's fan-out and re-read | §3 rule 4/5; F-5, F-12 open |
| `confirm()` for Delete and Mark All Read | Q-8; F-10, F-12 open |
| The client-side status and search filter over the server's result, newest first | No behaviour change |
| No pagination (the route returns every message) | Not changed by the standard (§5.7) |

### 2.9 Visible changes on `/admin/messages` (named in the PR)

1. h1 "Messages" (was "Contact Messages"); a purpose line; the "Messages" pill and the "N unread" pill are gone; the unread count is in the count line above the table.
2. Refresh moves into the filter bar with its name and "Read at HH:mm UTC"; Search and Status get visible labels; Clear appears.
3. Status is kept in the address bar (`?status=unread`); a shared link opens the same status. Search is never in the address bar.
4. Emptying the search box (or Clear) reloads the full list (D-16 behaviour).
5. No full-page spinner: the page stays on screen while reading.
6. A failed read shows an error with "Try again" instead of "No messages found".
7. The table: standard density, chips with icons for status and priority, "Received (UTC)" with an age hint, an Open button, a named Delete button. No Eye button.
8. **No Reply button anywhere** (D-14 (b)).
9. The detail opens in a side panel (Escape closes it, focus returns), showing the message's current status.
10. When saving notes, marking a message read or unread, deleting a message or Mark All Read fails, a short line says so next to the action (D-19). Nothing new on success.

### 2.10 Decision: action failures (D-19, SA M-1)

| Part | Rule |
|---|---|
| (a) Words | Fixed page constants, exact words: notes "Could not save the notes. Try again."; Mark as Unread "Could not mark the message as unread. Try again."; the mark-read sent on open "Could not mark the message as read." (no retry control in the drawer; reopening retries); Delete "Could not delete the message. Try again."; Mark All Read "Could not mark every message as read. Try again." |
| (b) Trigger | `!response.ok` or a rejected `fetch`, the same line for both. **No response body is read** for PATCH or DELETE (as today, `response.ok` only), so the route's `error`, a status code or a machine code can never reach the screen |
| (c) Placement | The notes line under Save inside `MessageDetail` (body-local state, so it dies with the `key`); the read and unread lines in the drawer's Status section, from a page-held `{ id, kind }` shown only when `id` is the open id; the Delete line in that row's action cell (page-held id); the Mark All Read line beside the button in the header `actions`. Each is `role="alert"`, `text-xs text-red-300` |
| (d) Clearing | A line clears when the same action is attempted again (for Delete and Mark All Read, when the confirm is accepted); the notes line also when edit mode is left |
| (e) Success | Unchanged: no line, no toast, nothing new |
| (f) Mechanics | `updateMessageStatus` returns a boolean; Mark All Read counts failures over its fan-out, keeps its single re-read (today's behaviour), and shows its line when at least one PATCH failed |
| (g) Requests | The request list, bodies and count are unchanged (G-5 holds) |

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

No source change. One test edit: the registry entry (§5).

### 3.2 Page folder (`app/admin/messages/`)

| File | Change |
|---|---|
| `page.tsx` | Rewritten around the existing logic: `useAdminFilters(MESSAGES_FILTER_SPEC)` for status, `useState` for search; `fetchMessages` as a stable `useCallback` reading a `query` ref (the L-4a shape), newest-wins, the §2.5 read, `readAt`; the debounce with `lastSearched`; `updateMessageStatus`, `saveAdminNotes(id, text): Promise<boolean>`, `deleteMessage`, `markAllRead` with the same requests; `openRow`, `handleRowClick`, close-when-gone, `returnFocus`; layout header → bar → content (count line, table or states) → drawer. `clientLogger` |
| `messagesTypes.ts` (new) | `ContactMessage`, `MessageReply`, `MessageStatus`, `MessagePriority` (moved unchanged) |
| `messagesFilters.ts` (new) | `MESSAGES_FILTER_SPEC`, `isMessageStatusFilter`, `MESSAGES_WHAT`, `MESSAGES_READ_FALLBACK` |
| `messagesFormat.ts` (new) | `ageLine`, `statusTone`, `priorityTone`, `priorityLabel`, `sourceLabel`, `countLine` (pure, unit-tested) |
| `components/MessagesTable.tsx` (new) | The table (§2.4) |
| `components/MessageDetail.tsx` (new) | The drawer body (§2.7), owning `editing` and `draft` |

### 3.3 Kept identical

The fetch URLs, methods and bodies; the confirm texts; the status option words and values; "Mark All Read", "Mark as Unread", "Edit", "Save", "Admin Notes" words (the section heading becomes "Admin notes", sentence case like every drawer section; Q-9); "No admin notes yet."; "Conversation Thread" → "Conversation thread" (same, Q-9).

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/messages/page.tsx` | modify | §3.2 |
| `app/admin/messages/messagesTypes.ts` | create | Types moved out |
| `app/admin/messages/messagesFilters.ts` | create | URL spec, constants |
| `app/admin/messages/messagesFormat.ts` | create | Pure display helpers |
| `app/admin/messages/components/MessagesTable.tsx` | create | Table |
| `app/admin/messages/components/MessageDetail.tsx` | create | Drawer body |
| `app/admin/messages/__tests__/messages.baseline.render.test.tsx` | create, then edit | Characterisation (§6.1), then the deliberate edits (§6.2) |
| `app/admin/messages/__tests__/messages.layout.render.test.tsx` | create | Migrated behaviour (§6.3) |
| `app/admin/messages/__tests__/messagesFormat.test.ts` | create | Helpers |
| `app/admin/messages/__tests__/source.guard.test.ts` | create | §5 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Registry entry + "Amended by L-7" note |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 12, §7.10 as built, §9 (F-8 page half, F-9 GET, F-14, F-15, F-16, F-17 done; F-111 new), Change History |
| `docs/workplans/ADMIN_LAYOUT_L7_WORKPLAN.md` | create | This file |

**Not touched:** every file under `app/api/admin/messages/**` (including the `replay` route and its `console.*`), `app/api/admin/__tests__/adminGate.writes.test.ts`, the sidebar and its test, `components/ui/*`, every shared source file.

---

## 5. Guard and registry changes

New `app/admin/messages/__tests__/source.guard.test.ts` (pure file reads, comments stripped before matching, inside the Jest gate, no CI time added):

| # | Rule | Why |
|---|---|---|
| G-1 | **Exact file list** of the folder's source files (`page.tsx`, the three helpers, the two components) | A new file is a deliberate edit |
| G-2 | Imports: `react`, `lucide-react`, `@/lib/logger/client`, files inside the folder, and the alias `@/app/admin/components/layout/` (trailing slash). Nothing else: no `next/navigation` directly (the hook owns it), no `@/lib/` beyond the logger, no other admin page folder, no relative path out of the folder. Named `escapes()` with negative controls (`layoutX`, `../components/layout/…`, `@/app/admin/users/…`, `next/navigation`) | §6.1 S-1, SA Q-3, the L-5 / L-6 shape |
| G-3 | **No Reply**: no `/reply` and no `/replay` substring, no `sendReply`, `replyContent`, `showReplyModal`, no `Reply` or `Send` lucide import | D-14 (b), R-15 |
| G-4 | No `console.` | CLAUDE.md Logging |
| G-5 | Every `fetch(` targets a template or string starting `/api/admin/messages`; exactly the four call sites (list, status PATCH, notes PATCH, DELETE) | Same requests as before; no new request |
| G-6 | No `history.pushState` / `history.replaceState`, no `useSearchParams`, `useRouter`, `localStorage`, `sessionStorage`, `document.cookie` (the hook is the only writer) | U-2, SA-R-8 |
| G-7 | `messagesFilters.ts`: the spec has exactly one key, `status` (a search key in the spec, even page-only, would be read from an inbound link) | SA-R-8, D-6 (a) |
| G-8 | No `any` and no `dangerouslySetInnerHTML` | Rule 6; the message text is untrusted input |
| G-9 | `'use client'` page with no admin decision of its own (no `requireAdmin`, no `admin_users`, no `profiles.role`) | The layout gate decides (CLAUDE.md Security) |

`layoutFolder.guard.test.ts` `MIGRATED_PAGES`: add `/admin/messages (Messages)` with `page.tsx`, `messagesFilters.ts`, `messagesFormat.ts`, `components/MessagesTable.tsx`, `components/MessageDetail.tsx` (not `messagesTypes.ts`: no markup, no read). Plus an "Amended by L-7" note; no rule change. Part (a), `AdminSidebar.nav.test.ts` and the authz surface guard: no edit.

---

## 6. Tests

Fixtures use invented people and ids (`msg-1` …, "Dana Example", `dana@example.test`). `window.confirm` is spied per case. `next/navigation` is mocked with a settable search string; the real jsdom `history.replaceState` is spied (the Businesses / Audit trail way). `@/lib/logger/client` is mocked.

### 6.1 Characterisation first (`messages.baseline.render.test.tsx`), run green on today's page before any source edit

Written with queries that survive the migration where the behaviour survives (roles, request assertions), so most cases need no edit later. Output recorded in Implementation Notes.

| Id | Today's behaviour pinned | After L-7 |
|---|---|---|
| B-1 | First read: exactly one `GET /api/admin/messages?filter=all&search=` | Kept |
| B-2 | Rows show name, email, subject, message; newest first | Kept |
| B-3 | Status select change → `GET …?filter=unread&search=` | Kept (select found by its label after; by role before; one query helper) |
| B-4 | Typing "dana" → after 300 ms one `GET …&search=dana`; none before | Kept |
| B-5 | Emptying the search → **no** new GET | **Flipped** (D-16): one GET with `search=` |
| B-6 | Click on an unread row → `PATCH /api/admin/messages/msg-1` body `{ status: 'read', updated_at: <ISO> }` (keys exactly), then the detail shows the message text | Kept (detail found inside the drawer dialog) |
| B-7 | Click on a read row → no request; the detail shows | Kept |
| B-8 | "Mark as Unread" → PATCH `{ status: 'unread', updated_at }` | Kept |
| B-9 | Notes: Edit, type, Save → PATCH `{ admin_notes, updated_at }`; the note shows after | Kept |
| B-10 | Delete with confirm true → `DELETE /api/admin/messages/msg-1`, the row is gone; confirm false → no request | Kept (button found by name after; by `title` before; one query helper) |
| B-11 | Mark All Read with confirm true → one PATCH per unread row, then one GET; confirm false → nothing | Kept |
| B-12 | A failed GET (500) shows "No messages found" | **Flipped** (F-9): `messages-error` with the route's words; "No messages found" nowhere |
| B-13 | A Reply control exists, and sending posts to `…/msg-1/reply` | **Flipped** (D-14 (b)): no Reply control anywhere (§6.3 T-7) |
| B-14 | h1 "Contact Messages" | **Flipped** (D-3 (a)): h1 exactly "Messages" |
| B-15 | No PATCH, DELETE or POST is sent on load, on filter change or on search | Kept |

### 6.2 Edited deliberately (each named in the PR)

B-5, B-12, B-13, B-14 as flipped above; the two query helpers in B-3 and B-10 switch from today's selectors (role-only select, `title`) to the label / accessible name. Nothing else.

### 6.3 New (`messages.layout.render.test.tsx`, `messagesFormat.test.ts`)

| Id | Asserts |
|---|---|
| T-1 | Header: exactly one h1, text exactly "Messages"; the purpose line; "Mark All Read" inside the `<header>` only while an unread row is loaded; no Refresh in the header; "Contact Messages" nowhere |
| T-2 | Bar: `role="search"` named "Filters"; labels "Search" and "Status" name their controls; order Search, Status, Clear, Refresh; Clear disabled at defaults, enabled after either change; "Read at" after the first read; Refresh named "Refresh messages", `aria-busy` while reading |
| T-3 | URL: choosing "Unread" calls `replaceState` with `?status=unread`; back to "All Messages" removes it; typing a search never puts it in any `replaceState` URL nor in `location.search`; an inbound `?status=replied` sends `filter=replied` on the **first** GET (one GET); `?status=junk` falls back to all (one GET with `filter=all`, URL cleaned) |
| T-4 | Clear with both set → exactly one GET with `filter=all&search=`; the box is empty, the select shows All. Added in implementation: the mount sends one GET also after the 300 ms pause has passed, and a status change inside the pause sends one GET, not two (the `lastSearched` cases B-1 cannot see, because B-1 ends before the pause) |
| T-5 | States: while the first GET is pending, "Reading messages…" with the header and bar mounted; a rejected fetch → `messages-error` exactly `ADMIN_NETWORK_ERROR`; 401 and 403 → the session-ended sentence; a 500 `{ error: 'Failed to fetch messages' }` → that string; a 200 whose `json()` throws, and a 200 without a `messages` array → "Could not read messages. Try again in a moment."; "Unexpected token" never on screen; "No messages found" never on screen; Try again reads again and shows the rows |
| T-6 | No unmount: while a refresh is pending the table and the search box stay (same element), the content has `aria-busy="true"`; typing keeps focus in the search box across the read |
| T-7 | **No Reply** (§12.3 L-7 item): no element with a name or text matching `/reply/i` in the page and in the open drawer (the conversation thread's "Admin Reply" sender line excluded by scoping to buttons and links); no request to a URL containing `/reply` or `/replay` across the whole run |
| T-8 | Newest wins: a slow first GET resolving after a fast second one does not replace the second's rows |
| T-9 | Table: `getByRole('table', { name: 'Messages' })`; headers "Details", "Contact", "Message", "Status", "Received (UTC)", "Actions" (sr-only), unique, `scope="col"`; the time cell shows `YYYY-MM-DD HH:mm UTC` and an age line; the count line "3 messages, 1 unread, newest first" |
| T-10 | Chips: `message-status` tones `info` / `neutral` / per Q-4, each with its words; `message-priority` tones per Q-5; the replied extras carry their sr-only words |
| T-11 | Drawer open: the Open button "Open message from Dana Example" opens a dialog titled "Message from Dana Example"; for an unread row exactly one PATCH (keys exactly `status`, `updated_at`) and no other request; the drawer shows "Read" once it succeeds; a read row sends nothing; while the opening PATCH is pending the drawer shows no "Mark as Unread" button, which appears only after it succeeds (SA S-3) |
| T-12 | Row click (D-17, SA M-3): a click on the row's text opens it, and Escape then returns focus to that row's Open button; a click on an **unread** row's Open button sends exactly one PATCH (the row handler ignored it); a click on Delete with confirm false opens nothing and sends nothing; with a text selection inside the row a click does not open it; the `tr` has no `tabindex` and no `role`; Enter on the focused Open button opens |
| T-13 | Drawer close: Escape closes it and focus returns to that row's Open button; under the "Unread" filter, opening an unread row keeps the drawer open although the row leaves the table, and on Escape focus goes to `messages-content` (not `<body>`) |
| T-14 | Close when gone: deleting the open message (confirm true) closes the drawer; a Refresh that returns without the open id closes it, and a later Refresh that brings it back does **not** reopen it |
| T-15 | Notes: edit mode does not carry over to another message; a failed Save keeps edit mode and the draft (today's behaviour), sends one PATCH, and shows "Could not save the notes. Try again." under Save (D-19); a second Save clears it first |
| T-16 | Mark as Unread failure: the drawer keeps "Read" (no optimistic flip) and shows "Could not mark the message as unread. Try again." in the Status section (D-19) |
| T-17 | Logging: `clientLogger` calls never include the fixture's name, email, phone, company, subject, message text, notes, a typed notes draft or search text (the mocked logger's arguments are serialised and searched) |
| T-18 | Empty: no rows and no filter → "No messages yet." with no Clear filters; a search with no rows → "No messages match this search or status." and "Clear filters", which reads again with the defaults |
| T-19 | `messagesFormat.test.ts`: `ageLine` (just now, hours, days, invalid → ''), `statusTone`, `priorityTone` (unknown priority → no chip), `sourceLabel`, `countLine` (singular, zero unread, thousands separators) |
| T-20 | `source.guard` G-1 to G-9 with their negative controls |
| T-21 | D-19 Delete: a failed DELETE (500 with body `{ error: 'route_error_probe' }`) keeps the row, shows "Could not delete the message. Try again." in that row only, and `route_error_probe` is nowhere on screen; a rejected DELETE fetch shows the same line |
| T-22 | D-19 Mark All Read: with one of two PATCHes failing, "Could not mark every message as read. Try again." shows in the header and exactly one re-read is still sent |
| T-23 | D-19 open: the mark-read on open failing leaves the drawer open with the "Unread" chip and "Could not mark the message as read." |
| T-24 | D-19 success: each of the five actions succeeding shows no failure line (`queryAllByRole('alert')` empty in the header, the row and the drawer) |

### 6.4 Must stay green with no edit

`AdminSidebar.nav.test.ts`, every shared-folder suite (bar the registry entry), `app/admin/__tests__/**` (the admin authz surface guard), `app/api/admin/__tests__/adminGate.writes.test.ts` (routes untouched).

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-0 | Before any source edit: `npx jest app/admin/messages --ci` with only the baseline suite | All B-cases green on today's page; output recorded |
| V-1 | `npx jest app/admin/messages app/admin/components/layout app/admin/components/__tests__ app/admin/__tests__ app/api/admin/__tests__ --ci` | All green; counts recorded |
| V-2 | Scoped `tsc -p` on a scratch tsconfig in the session scratchpad (`extends` the worktree `tsconfig.json`, `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/messages/**`, `app/admin/components/layout/**`, `app/admin/components/adminWindowPresets.ts`; `--listFilesOnly` first). **Run 1** with a scratch `canary.ts` (`const canary: number = 'x';`) → exit 2 and exactly that TS2322. **Run 2** without it → exit 0 | Both recorded |
| V-3 | `npm run lint:hooks`; `npx eslint` on the touched files | Clean |
| V-4 | Mutation checks (each reverted, md5 compared): (a) put back a Reply button in `MessageDetail.tsx` → T-7 and G-3 fail; (b) a `fetch('/api/admin/messages/x/reply')` anywhere → G-3, G-5, T-7 fail; (c) a `console.error` in `page.tsx` → G-4 fails; (d) on a failed GET set `messages = []` without setting the error → T-5 fails ("No messages found"-class: empty shown for a failure); (e) look `selected` up in the shown rows instead of `messages` → T-13 fails; (f) drop the close-when-gone effect → T-14 fails (reopen); (g) `returnFocus` to the opener only → T-13 fails (focus to body); (h) send a GET for replies on open → T-11 fails; (i) add `search` to `MESSAGES_FILTER_SPEC` as page-only → G-7 fails; as written → T-3 fails; (j) drop the `lastSearched` check → T-4 fails (two GETs) or B-1 (mount doubled); (k) drop newest-wins → T-8 fails; (l) log the search text → T-17 fails; (m) `response.json()` in `page.tsx` → registry `.json(` rule fails; (n) h1 back to "Contact Messages" → T-1, B-14 and the registry fail; (o) remove the alias line from `escapes()` → G-2 fails on `page.tsx`; (p) drop the row handler's control check → T-12 fails (two PATCHes); (q) drop the selection check → T-12 fails; (r) pass the `tr` (or nothing) as opener → T-12 fails (focus); (s) drop the notes failure line → T-15 fails; (t) render the route's `error` body on a failed DELETE → T-21 fails; (u) show a line on success → T-24 fails; (v) drop the failure count in Mark All Read → T-22 fails | Each fails as stated |
| V-5 | `git diff --stat origin/main -- app/api/admin/messages` and `-- app/api/admin/__tests__` | Empty (routes untouched) |
| V-6 | `grep` the folder for `console.`, `/reply`, `/replay`, `.json(`, `toLocale`, `title=` on an icon, `as any`, `framer-motion` | None in code |
| V-7 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions match; no file emptied |

### 7.1 Browser checks for TL / QA (signed-in admin, DevTools Network open, light and dark emulation)

**The browser checks write nothing (SA M-2). The local dev server reads the production database: never Delete a message, never Mark All Read, never Save notes, and never Mark as Unread on a real message.** Opening an unread message is a write (it marks it read), so M-B6 and M-B7 are done **with Status set to "Read" first**, so every row on screen is already read; if no read message exists, skip them and say so (Jest covers them). There is no D-19 browser check (each failure needs a write): Jest only (T-15, T-16, T-21 to T-24). Delete, Mark All Read, notes and Mark as Unread are covered by Jest (B-8 to B-11, T-14 to T-16).

| # | Check |
|---|---|
| M-B1 | `/admin/messages` loads with one `GET /api/admin/messages?filter=all&search=`; h1 "Messages", purpose line; no shell title; no "Messages" pill; "Mark All Read" on the right only if a loaded message is unread (do not click) |
| M-B2 | Bar: visible "Search" and "Status" labels; Status → Unread changes the address bar to `?status=unread` and sends one GET with `filter=unread`; reload keeps Unread; typing a search sends one GET after a pause and never shows in the address bar; emptying it reloads; Clear resets both with one GET |
| M-B3 | No full-page spinner: typing keeps focus in the box; Refresh spins, the table stays, "Read at" updates |
| M-B4 | Offline + Refresh → "Could not reach the server…" with Try again; online + Try again restores the list |
| M-B5 | Table: standard density, status and priority chips with icons and words, "Received (UTC)" with an age line, Open and a named Delete per row, **no Reply and no Eye button** |
| M-B6 | With Status set to "Read" first, open a message with its Open button: no request in Network; the side panel shows Status, Contact, Details, Message, Admin notes, Conversation thread when present; **no Reply button**; Escape closes and focus is back on that Open button; Tab stays inside the panel while open |
| M-B7 | With Status still "Read": a click on a row's text opens it; select text in a row → no open |
| M-B8 | Light and dark emulation: the page and the panel look the same (A-8); the Status select's list is dark |

---

## 8. Task List

- [x] ✅ 1. SA workplan review; apply any must-fix to this file before coding (M-1 to M-4 applied 2026-10-12)
- [x] ✅ 2. Characterisation suite B-1 to B-15 against the unchanged page; V-0 green and recorded
- [x] ✅ 3. `source.guard` G-1 to G-9 (red on today's page: recorded in Implementation Notes, then green after the migration)
- [x] ✅ 4. `messagesTypes.ts`, `messagesFilters.ts`, `messagesFormat.ts` + T-19
- [x] ✅ 5. `page.tsx`: header, bar, URL status, search debounce with `lastSearched`, states, read helper, newest-wins, logger; Reply removed
- [x] ✅ 6. `MessagesTable.tsx`: columns, chips, Open, row click, named Delete, count line
- [x] ✅ 7. `MessageDetail.tsx` + the page-level drawer: selection, close-when-gone, focus return
- [x] ✅ 8. Deliberate baseline edits (§6.2) and T-1 to T-18, T-21 to T-24 (D-19)
- [x] ✅ 9. Registry entry
- [x] ✅ 10. V-1 to V-7; real output in Implementation Notes
- [x] ✅ 11. Requirement: §1 row 12, §7.10 as built, §9 dispositions and F-111, Change History
- [ ] 12. Hand to SA code review + QA (nothing committed by Dev)

---

## 9. Sizing

| Part | Days |
|---|---|
| Characterisation suite (step 2) | 0.5 |
| Guard and helpers (steps 3-4) | 0.4 |
| Page: bar, URL, states, reads (step 5) | 0.6 |
| Table and drawer (steps 6-7) | 0.6 |
| New tests (step 8) | 0.6 |
| Verification and docs (steps 9-11) | 0.3 |
| Action failures, D-19 (§2.10, T-21 to T-24) | 0.3 |
| **Total** | **about 3.3 days** |

One slice, at the "a few days" limit. **No split proposed**: the drawer replaces the same modal the Reply removal edits, so splitting would mean editing the hand-built modal in L-7a only to delete it in L-7b. If SA prefers a split, the cut is **L-7a** = characterisation, header, bar, URL, states, table, Reply removed, logger (the hand-built modal kept minus Reply, with an Escape-free interim) and **L-7b** = drawer + T-11 to T-16 (Q-10).

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `readAdminResponse` would treat the GET's 200 `{ messages }` as a failure (no `success`) | §2.5 reads the ok branch with `readJsonBody`; T-5 pins both branches; F-111 records the route |
| The drawer closes as soon as an unread message is opened under the Unread filter | `selected` from `messages`, not the shown rows (§2.7); T-13, mutation (e) |
| The search reload doubles the mount read or a status change | `lastSearched` (the L-4a M-1 mechanism); T-4, B-1, mutation (j) |
| A characterisation case that should be kept quietly gets rewritten during the migration | §6.2 lists the only four flips and two selector helpers; any other edit to the baseline file is a review finding |
| Logs leak a person's message or email | Facts-only logging; T-17, mutation (l) |
| A browser check marks a real message read or deletes one | §7.1 limits the checks to reads and already-read messages |
| `useSearchParams` in a client page without Suspense breaks the build | The admin layout is dynamic (it awaits `requireAdminPage`), as for Audit trail and Businesses, which use the same hook; `next build` is part of CI |

---

## 11. Out of scope and found on the way

- **F-1, F-11** (the reply route stub and the double PATCH): stay open. After L-7 the page never calls either reply path.
- **F-5** (PATCH writes the raw body), **F-6** (search interpolated into `.or()`), **F-7** (N+1 replies), **F-13** (no migration for the tables), **F-8 route half** (9 `console.*` in the routes): routes untouched, all stay open.
- **F-10** (hard delete behind `confirm()`), **F-12** (Mark All Read fan-out behind `confirm()`): behaviour kept, stay open.
- **F-9 action half** (silent PATCH / DELETE failures): **done in L-7** by user decision D-19 (§2.10).
- **New F-111 (API, open):** the messages GET answers `{ messages }` with no `success` and no `data`, unlike CLAUDE.md's response format, so the shared read helper cannot read it; the page reads the ok branch itself (§2.5).
- **Done here:** F-8 page half (6 `console.error` → `clientLogger`), F-9 GET half and action half (D-19), F-14, F-15, F-16 (per D-16, Q-2), F-17.

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | The unread count: in the count line over the shown rows ("12 messages, 3 unread, newest first"), or dropped? | Count line. True under any filter, not a badge, no KPI |
| Q-2 | Does D-16 ("emptying the search reloads", answered for Businesses) carry over to Messages, given that §5.5's mandatory Clear relies on it? | Yes, built with the L-4a mechanism; the user is told (§13), not asked |
| Q-3 | Open the drawer at once and send the mark-read PATCH at the same moment, instead of today's "wait for the PATCH, then open"? | At once. Same request and body; the drawer shows the row's status as the PATCH lands |
| Q-4 | "Replied" chip: `neutral` (reply sending is a stub, so nothing is proven) or `ok`? | `neutral` (T-6) |
| Q-5 | Priority chips: Low / Normal `neutral`, High `warn`, Urgent `danger`, same words beside the name? | Yes |
| Q-6 | Keep today's whole-row click with the D-17 rules (a page-local copy of the two Businesses helpers)? | Yes: today's behaviour, and D-17 already rules how |
| Q-7 | Selection looked up in `messages` (the loaded rows), not the rows on screen, so a message opened under "Unread" stays open after it is marked read; focus falls back to the content area on close? | Yes (§2.7) |
| Q-8 | Delete and Mark All Read keep the native `confirm()` (a recorded deviation from §5.8 D-8's dialog), or move to `ui/dialog` with `ADMIN_DIALOG_CLASS`? | Keep `confirm()`. Same words, same requests; a state-opened dialog inside the drawer would reopen F-108 (no Radix trigger for focus return). F-10 / F-12 stay open |
| Q-9 | Section headings in sentence case ("Admin notes", "Conversation thread"), the buttons' words unchanged? | Yes, like every drawer |
| Q-10 | One slice (about 3 days) or L-7a / L-7b at the §9 cut? | One slice |
| Q-11 | The list read: non-ok to `readAdminResponse`, ok through `readJsonBody` + an array check, a page constant for the fallback words (F-111)? Or a shared `pick`-without-`success` option (a shared export → full cycle)? | Page-side, no shared change |
| Q-12 | Path: UI short path under the fast-track (no shared export)? | Yes |

---

## 13. Product question for the user

**When saving notes, marking a message read or unread, or deleting a message fails, the page says nothing today.** The notes box simply stays open, the message stays unread, or the deleted message stays in the list, with no explanation. Should the redesigned page show a short line such as "Could not save the notes. Try again." when that happens? Recommendation: yes. (Superseded by the user's answer below: the line is shown, §2.10.)

**For your information (no decision needed unless you object):** on Businesses you chose that emptying the search box reloads the full list (D-16). Messages has the same problem today, and the new Clear button depends on it, so Messages gets the same behaviour.

**Answered by the user, 2026-10-12: "Show a short message"** (recorded as **D-19** in requirement §10 Answers). When saving admin notes, marking a message read or unread, or deleting a message fails, the page shows a short line next to the action that failed (for example "Could not save the notes. Try again."). Successful actions look the same as today. No request or body changes; the wording is plain and fixed, never the route's raw error or a machine code. Built per SA M-1 below.

---

## SA Workplan Review — 2026-10-12

**Reviewed by SA — 2026-10-12** against requirement §1 row 12, §4.10, §5.3 to §5.12, §6.1, §7.10, §9 F-1, F-5 to F-17, §10 D-3 (a), D-6 (a), D-13 (a), D-14 (b), D-16, D-17 and the new D-19, re-check R-7 and R-15, K-5 (as applied to chips), the L-4b SA workplan review Q-1 (the six D-17 rules), CLAUDE.md § Logging, and the code at `46a69ad3`: `app/admin/messages/page.tsx` (read `:79-98`, status `:100-120`, notes `:122-145`, reply `:147-199`, delete `:201-218`, open `:220-226`, client filter `:228-243`, spinner `:309-315`, header and Mark All Read `:322-362`, row and its buttons `:419-503`, modal `:511-702`), `app/api/admin/messages/route.ts` (200 `{ messages }`, 500 `{ error }`), `app/admin/components/layout/readAdminResponse.ts` (`:49-80`: the ok branch requires `success === true`; non-ok goes 401/403 session-ended, then route `error`, then the fallback), `lib/logger/client.ts` (`clientLogger`), `app/admin/users/page.tsx:50-60, 360-370` (the D-17 helpers).

**Status:** ✅ APPROVED WITH CONDITIONS. Dev applies M-1 to M-4 to this workplan before coding (no second SA pass; SA checks them at code review). S-1 to S-8 are code-review checks. No product question remains: the one product question (§13) is answered by the user as D-19.

**Path:** UI short path confirmed (Q-12): no shared export is built or changed; the only shared-folder edit is the registry entry in the guard test (L-3 to L-6 precedent). Fast-track: SA code review + QA, then RM commits and opens the PR.

### Rulings on Q-1 to Q-12

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **Count line**, as proposed: "N messages, M unread, newest first" over the rows shown; the unread part omitted at 0 | Describes what is on screen, so it is true under any filter (K-8 spirit); not a KPI tile (D-13 (a) holds) and not a header badge (§5.3 allows only a factual state) |
| Q-2 | **D-16 carries over** (emptying the search reloads after the debounce, `lastSearched` mechanism) | The same defect the user already answered on Businesses; §5.5's mandatory Clear empties the box and would otherwise leave stale rows (F-16). Consistency across pages; TL tells the user in the hand-back, no question |
| Q-3 | **Open at once**, with the same single mark-read PATCH sent at the same moment | Same request, body and count. No race with "Mark as Unread": that button renders only when the row in `messages` is not unread, so it cannot appear before the read PATCH has succeeded (S-3 pins it) |
| Q-4 | **`neutral` "Replied"** | §5.9: green is only for a proven outcome; the reply path is a stub (F-1), so "Replied" proves no delivery |
| Q-5 | **Low / Normal `neutral`, High `warn`, Urgent `danger`**, same words, beside the name | K-5 (ii) applied to chips: the page already renders high in orange and urgent in red today (`getPriorityBadge`), so these are existing signals, not new thresholds. Blue would collide with Unread `info`. Warn and danger carry their required icon (§5.9) |
| Q-6 | **Keep the whole-row click with all six D-17 rules** (L-4b SA Q-1 (1) to (6)), page-local copy of `ROW_CONTROL_SELECTOR` and `isSelectingIn` | Today's behaviour, and the rules the user's Businesses decision was built to; consistency across the two Businesses-section tables. One page may not import another page's folder (§3 rule 1). On this page the control rule also protects a write: a click on Open or Delete must never add a second mark-read PATCH (M-3) |
| Q-7 | **Look the open message up in `messages`** (all loaded rows after local patches), focus falls back to `messages-content` | Under "Unread", opening marks the row read and the client filter hides it; a lookup in the shown rows would close the drawer at once. Close-when-gone still closes it when a later read omits the id |
| Q-8 | **Keep native `confirm()`** for Delete and Mark All Read, as a recorded page deviation from §5.8 D-8 | Minimal change: same words, same requests; a browser dialog has no theme or close-button issue (F-88 cannot apply) and returns focus natively to the clicked button, whereas a state-opened `ui/dialog` would reopen F-108. F-10 / F-12 stay open; moving to the shared dialog belongs with their fix |
| Q-9 | **Sentence-case section headings** ("Admin notes", "Conversation thread"); button words unchanged ("Mark All Read", "Mark as Unread", "Edit", "Save") | Same as every migrated drawer; buttons are pinned behaviour, headings are layout |
| Q-10 | **One slice** (about 3 days, plus about 0.3 day for D-19) | Splitting would edit the hand-built modal only to delete it; still within "a few days" |
| Q-11 | **Sound, page-side, no shared change** (F-111) | Verified: `readAdminResponse` reads 2xx only with `success === true`, so the 200 `{ messages }` must be read with `readJsonBody` + `Array.isArray(body.messages)`; non-ok responses only reach its failure branches (401/403 session-ended, the route's `error` string, the fallback). A shared `pick`-without-`success` option would be a shared export (full cycle) for one route whose real fix is the API (F-111) |
| Q-12 | **UI short path under the fast-track** | As above |

### Findings

**Must (apply to this workplan before coding)**

| # | Finding |
|---|---|
| M-1 | **D-19 through the whole plan.** Replace §2.8's "Silent PATCH / DELETE failures" row and §13's default with a new decision section "Action failures (D-19)". (a) **Fixed page constants, exact words**: notes "Could not save the notes. Try again."; Mark as Unread "Could not mark the message as unread. Try again."; the mark-read sent on open "Could not mark the message as read." (no retry control in the drawer; reopening retries); Delete "Could not delete the message. Try again."; Mark All Read "Could not mark every message as read. Try again." (b) **Trigger**: `!response.ok` or a rejected `fetch`, the same line for both; **no response body is read** for PATCH or DELETE (as today, `response.ok` only), so the route's `error`, a status code or a machine code can never reach the screen. (c) **Placement**: the notes line under Save inside `MessageDetail` (body-local state, so it dies with the `key`); the read and unread lines in the drawer's Status section, from a page-held `{ id, kind }` shown only when `id` is the open id; the Delete line in that row's action cell (page-held id); the Mark All Read line beside the button in the header `actions`. Each is `role="alert"`, `text-xs text-red-300`. (d) **Clearing**: a line clears when the same action is attempted again (for Delete and Mark All Read, when the confirm is accepted); the notes line also when edit mode is left. (e) **Success unchanged**: no line, no toast, nothing new on success. (f) `updateMessageStatus` returns a boolean; Mark All Read counts failures over its fan-out, keeps its single re-read (today's behaviour), and shows its line when at least one PATCH failed. (g) The request list, bodies and count are unchanged (G-5 holds). **Tests**: extend T-15 (failed Save shows the notes line, keeps edit mode and draft) and T-16 (failed Mark as Unread keeps "Read" and shows the unread line); add **T-21** a failed DELETE (500 with body `{ error: 'route_error_probe' }`) keeps the row, shows the Delete line in that row only, and `route_error_probe` is nowhere on screen; a rejected DELETE fetch shows the same line; **T-22** Mark All Read with one of two PATCHes failing shows its line and still sends exactly one re-read; **T-23** the mark-read on open failing leaves the drawer open with the "Unread" chip and the read line; **T-24** each of the five actions succeeding shows no failure line (`queryAllByRole('alert')` empty in header, row and drawer). **Mutations** added to V-4: (s) drop the notes line → T-15; (t) render the route's `error` body on a failed DELETE → T-21; (u) show a line on success → T-24; (v) drop the failure count in Mark All Read → T-22. Update §2.9 (item 10: a short line appears when an action fails), §9 (about +0.3 day), §11 (F-9 action half done in L-7 by D-19), §1 Overview sentence on silent failures |
| M-2 | **Browser checks must write nothing.** Opening an unread message is a write (it marks it read), so §7.1's "or accept that one is marked read" is removed. M-B6 and M-B7 are done **with Status set to "Read"** first, so every row on screen is already read; if no read message exists, skip them and say so (Jest covers them). No D-19 browser check (each failure needs a write); Jest only. Never Delete, Mark All Read, Save notes or Mark as Unread on real messages |
| M-3 | **D-17 parity, written out and tested.** §2.4 states the six L-4b Q-1 rules verbatim for this page: `tr` gets `onClick` + `cursor-pointer` only (no `tabIndex`, `role`, `onKeyDown`, ARIA); return on `closest(ROW_CONTROL_SELECTOR)` inside the row (this includes the Open button and Delete); return on a non-collapsed selection anchored or focused inside the row; otherwise the same `openRow` with opener = that row's Open button; the Open button stays the keyboard path; the drawer stays page-level outside the table. Extend **T-12**: a click on an **unread** row's Open button sends exactly one PATCH (the row handler ignored it); a click on Delete (confirm false) opens nothing and sends nothing; a row-text click then Escape returns focus to that row's Open button; the `tr` has no `tabindex` and no `role`; keyboard Enter on Open opens. Mutations: (p) drop the control check → T-12 (two PATCHes); (q) drop the selection check → T-12; (r) pass the `tr` (or nothing) as opener → T-12 focus |
| M-4 | **Logging resolution recorded.** §7.10 says the page's `console.error` calls are "converted only if the user approves"; CLAUDE.md § Logging (the governing rule) says flag, propose and convert unless the user explicitly declines. Convert all 6 (`page.tsx:93,118,143,195,216,345`; the `:195` one goes with Reply) to `clientLogger.child({ module: 'AdminMessagesPage' })`, and TL names the file and count in the fast-track hand-back. **Allowed facts**: HTTP status, row count, failed-of-N count, `hasSearch` boolean, the status filter value, the message id. **Never**: name, email, phone, company, subject, message text, notes or draft, search text, reply content. Non-ok PATCH / DELETE responses are logged at `warn` (today they were unlogged); rejections at `error` with `{ err }`. T-17 also searches the serialised logger arguments for the fixture's phone, company and a typed notes draft |

**Should (checked at code review)**

| # | Finding |
|---|---|
| S-1 | Today `getFilteredMessages` sorts the `messages` state array **in place** when no filter is on (`:242`). The new code sorts a copy (a pure helper in `messagesFormat.ts`, tested in T-19) |
| S-2 | Q-8 recorded in §7.10 as built as a page deviation from §5.8 D-8, with the reason. B-10 and B-11 assert `window.confirm` was called with the exact strings ("Are you sure you want to delete this message?", "Mark all messages as read?") |
| S-3 | T-11: while the opening mark-read PATCH is pending, the drawer shows no "Mark as Unread" button; it appears only after the PATCH succeeds (pins the Q-3 no-race reason) |
| S-4 | V-5 also runs `git status --short -- app/api/admin/messages app/api/admin/__tests__` (empty), since the uncommitted tree is what is reviewed |
| S-5 | G-5 also asserts no `'POST'` method string in the folder (the only POST today was the reply path), and G-3 keeps `/reply` and `/replay` substring checks on the comment-stripped source |
| S-6 | The 200 read: rows only when `Array.isArray(body.messages)`; a row whose `replies` is not an array renders as no thread (same trust as today's cast, no new validation layer). F-111 added to §9 with the route citation (`app/api/admin/messages/route.ts`, the `NextResponse.json({ messages: ... })` line) |
| S-7 | Baseline integrity: keep the V-0 version of `messages.baseline.render.test.tsx` in the session scratchpad with its md5 recorded; at code review the diff of that file against it may contain only the B-5, B-12, B-13, B-14 flips and the two selector helpers (§6.2) |
| S-8 | The Status select's dark list comes from `ADMIN_FIELD_CONTROL` (§7.10 "gets `[color-scheme:dark]`"); T-2 asserts the select carries the class, and M-B8 checks it in the browser |

**Notes**

| # | Note |
|---|---|
| N-1 | This is the second page-local copy of `ROW_CONTROL_SELECTOR` / `isSelectingIn`. A third page that needs them moves them into the shared folder in that slice, which then runs the full cycle (R-7) |
| N-2 | The route's 500 strings ("Failed to fetch messages", "Internal server error") shown verbatim are within §5.10 rule 1; no page override |
| N-3 | Reply removal check (R-15): the row Reply button, the drawer Reply button, the Reply modal, `sendReply`, `replyContent`, `showReplyModal`, `sendingReply`, the `Reply` / `Send` imports and the `email_sent` second PATCH all go with it; G-3, T-7 and mutations (a) / (b) cover it. `email_sent` stays as a read-only display field |
| N-4 | Characterisation-first is valid: B-1 to B-15 describe today's page as read at `46a69ad3` (failed GET → "No messages found" via `:94`; empty search → no GET via `:71`; the modal opens after the PATCH via `:222-224`; row buttons stop propagation `:472, :483, :494`) |
| N-5 | No data, API or permission change: four call sites, same URLs, methods and bodies; the layout gate decides access (G-9). F-1, F-5 to F-7, F-10 to F-13 and F-8 route half stay open |

### Verdict

**APPROVED WITH CONDITIONS.** Apply M-1 to M-4 to this workplan, then start with the characterisation suite (task 2). S-1 to S-8 are checked at code review. No product question is open.

---

## Implementation Notes (Dev, 2026-10-12)

Nothing committed (fast-track: SA code review + QA next, then RM). Branch `feature/admin-layout-l7` at `46a69ad3`, worktree `neuronforge-admin-layout`.

### Files

| File | Action | Lines |
|---|---|---|
| `app/admin/messages/page.tsx` | rewritten (Reply removed, drawer, bar, states, D-19, logger) | 468 (was 780) |
| `app/admin/messages/messagesTypes.ts` | new (types moved; `MessageStatus`, `MessagePriority` named) | 37 |
| `app/admin/messages/messagesFilters.ts` | new (spec with one key, typed narrow, read fallback, the five D-19 constants) | 47 |
| `app/admin/messages/messagesFormat.ts` | new (`ageLine`, tones, labels, `countLine`, `visibleMessages` sorting a copy) | 91 |
| `app/admin/messages/components/MessagesTable.tsx` | new (table, chips, Open, named Delete, D-17 row click, Delete failure line) | 201 |
| `app/admin/messages/components/MessageDetail.tsx` | new (drawer body; notes edit state and the notes failure line are body-local) | 154 |
| `app/admin/messages/__tests__/messages.baseline.render.test.tsx` | new, then the §6.2 edits | 351 |
| `app/admin/messages/__tests__/messages.layout.render.test.tsx` | new (T-1 to T-18, T-21 to T-24) | 822 |
| `app/admin/messages/__tests__/messagesFormat.test.ts` | new (T-19) | 97 |
| `app/admin/messages/__tests__/source.guard.test.ts` | new (G-1 to G-9, T-20) | 168 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | registry entry + "Amended by L-7" note only | +17 |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | §1 row 12, §7.10 as built, §9 (F-1 note, F-8, F-9, F-14 to F-17, new F-111, count 109), Change History | +15 / -9 (`git diff --numstat`) |

Not touched: `app/api/admin/messages/**` (empty diff and empty `git status`), `app/api/admin/__tests__/**`, the sidebar, every shared source file. All touched files keep LF (byte count checked with node).

### Verification (real output)

| # | Result |
|---|---|
| V-0 | `npx jest app/admin/messages --ci` on the unchanged page (page md5 `28fbc257…`, equal to HEAD): **15 passed, 15 total**. The V-0 copy is kept as `scratchpad/l7/messages.baseline.V0.test.tsx.txt`, md5 `fdb40bfe7b864ab6ec688861ad9282f7` (S-7). Final file md5 `224e79b75acd8a1252801a32d292f556`; the diff against the V-0 copy holds only the two helpers (`statusSelect`, `deleteButtonFor`) and the four flips B-5, B-12, B-13, B-14 (39 changed lines, nothing else) |
| Before the flips | The migrated page against the V-0 suite: exactly B-5, B-10 (the `title` helper), B-12, B-13, B-14 failed; the other 10 passed unedited |
| Task 3 | `source.guard` against the original page (swapped in from `git show HEAD:`, then restored, md5 equal): **6 failed, 42 passed**: G-2 (`framer-motion`), G-3 (`/reply`, `Reply` / `Send`), G-4 (`console.`), G-5 (five call sites; a POST), G-8 (`as any`). G-1 was not red because the helper files already existed when the guard first ran (order of work only) |
| V-1 | `npx jest app/admin/messages app/admin/components/layout app/admin/components/__tests__ app/admin/__tests__ app/api/admin/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci`: **40 suites passed, 1440 tests passed** (the Messages folder alone: 4 suites, 116 tests). All paths exist |
| V-2 | Scoped tsc (`scratchpad/l7/tsconfig.l7.json`; `--listFilesOnly` lists the 10 Messages files). Run 1 with `scratchpad/l7/canary.ts` (`const canary: number = 'x';`): **exit 2**, exactly `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` Run 2 without it: **exit 0**, no output |
| V-3 | `npm run lint:hooks`: clean (max-warnings 0). `npx eslint app/admin/messages app/admin/components/layout/__tests__/layoutFolder.guard.test.ts`: exit 0, no output |
| V-4 | Every mutation red, then restored with md5 equal (script `scratchpad/l7/mutate.js`): (a) T-7 + G-3; (b) G-3 + G-5 + T-7; (c) G-4; (d) T-5 (7 cases); (e) T-13; (f) T-14; (g) T-13; (h) T-11; (i) G-7 (page-only search key); (i2) "as written" (search in the spec, the page reading it) T-3; (j) T-4 (3 cases, incl. the new mount case); (k) T-8; (l) T-17; (m) registry `.json(` rule; (n) title "Contact Messages": T-1 + B-14; (n2) an own `h1`: registry + T-1; (o) G-2 on `page.tsx`; (p) T-12 (2 cases); (q) T-12; (r) T-12 (focus); (s) T-15 (2 cases); (t) T-21; (u) T-24; (v) T-22. Final line: "ALL MUTATIONS RED, ALL RESTORED" |
| V-5 | `git diff --stat -- app/api/admin/messages` and `git diff --stat origin/main -- app/api/admin/messages app/api/admin/__tests__`: empty. `git status --short -- app/api/admin/messages app/api/admin/__tests__`: empty (S-4) |
| V-6 | Folder grep (code, tests excluded): no `console.`, `/reply`, `/replay`, `.json(`, `toLocale`, `framer-motion`; `as any` appears once, in a comment naming the old cast; the `title=` hits are component props (`DrawerSection`, `AdminPageHeader`), never an icon |
| V-7 | `git diff --numstat` (final): layout guard +17 / -0, `page.tsx` +401 / -714 (rewritten, 780 to 468 lines), requirement +15 / -9; no file emptied, no deletion-only file; 9 new files under `app/admin/messages/` plus this workplan |

### Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| DV-1 | The notes textarea is named by `aria-label="Admin notes"`, not `aria-labelledby` to the section heading | `DrawerSection` keeps its heading id internal (`useId`, shared folder, not edited in this slice). The name equals the visible heading text, so label-in-name holds |
| DV-2 | The search placeholder keeps today's "Search messages..." (three dots), not the ellipsis written in §2.3 | Unchanged words (§3.3); the baseline finds the box by it |
| DV-3 | The thread count (icon and number, sr-only "{N} replies in the thread") shows in the Status cell for any message with replies; the separate count pill beside the name is gone. "Email sent" shows on Replied rows that say so | One place for status extras (§2.4); the same facts as before |
| DV-4 | The drawer's Status section also shows the priority chip | The old modal header showed both; nothing new |
| DV-5 | Mutation (n) as written (title words only) cannot fail the registry, which checks for an own `h1`, not the words; (n2), an own `h1`, was added and fails the registry and T-1 | Each guard mapped to what it can see |
| DV-6 | Mutation (j): B-1 cannot see a doubled mount (it ends before the 300 ms pause), so two T-4 cases were added (the mount after the pause; a status change inside the pause) instead of editing the baseline (S-7) | Keeps the baseline to the four flips |
| DV-7 | Task 3: G-1 was green on the old page | Order of work only |

### User-visible changes (for the PR)

§2.9 items 1 to 10 as built, plus: the unread pulsing dots and the unread row tint and left border are gone (the bold name and the Unread chip remain); the thread count moved to the Status column; the row being viewed is lightly tinted while its drawer is open. A Delete failure line sits under that row's Delete button; a click on that line's text opens the row, like any other non-control text in the row.

### Tests added, with reasons

- Characterisation (15): today's behaviour pinned before any edit, so the migration's changes are exactly the named flips.
- Layout (47): every T-case in §6.3 (T-1 to T-18) and the D-19 cases T-21 to T-24, plus the two `lastSearched` T-4 cases (DV-6).
- Format (6): the pure helpers, including the copy-not-in-place sort (S-1).
- Source guard (48): G-1 to G-9 with negative controls for `escapes()`, the four-call-site rule and no `'POST'` (S-5).

### Found on the way (not fixed)

- Nothing new in scope. The API gate test prints the routes' own `console.*` output when it runs (F-8 route half, already open). `app/admin/users/page.tsx` is CRLF in the working tree (pre-existing, untouched).

---

## SA Code Review — 2026-10-12

**Code Review by SA — 2026-10-12** of the uncommitted tree on `feature/admin-layout-l7` (HEAD `46a69ad3`), against this workplan's SA Workplan Review (Q-1 to Q-12, M-1 to M-4, S-1 to S-8), the Implementation Notes (DV-1 to DV-7, mutations a to v, i2, n2), the requirement and CLAUDE.md § Logging.

**Status:** ✅ Code Approved (no must-fix). Fast-track: QA next, then RM.

### What was checked

| Area | Result |
|---|---|
| Tree | `git status --short`: 3 modified (`page.tsx`, the layout registry guard, the requirement), 9 new (5 sources, 4 test files) plus this workplan. `git diff --stat`: +433 / -723, no file emptied. `git diff --stat -- app/api/admin/messages`: empty. No data, API, permission or shared-source change |
| Reply removed (R-15, D-14 (b)) | No `/reply`, `/replay`, `POST`, `sendReply`, `replyContent`, `showReplyModal`, `sendingReply`, `Reply` / `Send` import anywhere in the folder (G-3, G-5 on comment-stripped source). No dead state left in `page.tsx` |
| D-19 words | `messagesFilters.ts:43-47`: the five sentences match M-1 (a) exactly |
| D-19 triggers | Non-ok and rejected fetch both set the line: status `page.tsx:205-227`, notes `:230-253`, delete `:261-276`. No PATCH / DELETE body is read (`response.ok` and `response.status` only); T-21 proves `route_error_probe` never reaches the screen |
| D-19 placement | Notes under Save, body-local (`MessageDetail.tsx:113-117`); read / unread in the Status section from a page-held `{ id, kind }` shown only for the open id (`page.tsx:460`, `MessageDetail.tsx:73-77`); Delete in that row's action cell (`MessagesTable.tsx:188-192`); Mark All Read beside the button in header `actions` (`page.tsx:351-365`). All `role="alert"`, `text-xs text-red-300` |
| D-19 clearing / success | Cleared on a new attempt: notes `MessageDetail.tsx:50`, unread `page.tsx:312`, read on reopen `:302`, delete after the confirm is accepted `:259`, Mark All Read after the confirm `:285`. Success adds nothing (T-24 with `hidden: true`) |
| Mark All Read | Same N PATCHes over the loaded unread rows, failures counted (`page.tsx:286-292`), one re-read always (`:293`); T-22 pins one re-read with a failure |
| `confirm()` | Exact words at `page.tsx:257` and `:284`; B-10 / B-11 pin them with `toHaveBeenCalledWith` (S-2); §7.10 as built records the Q-8 deviation |
| List read | Fetch alone in its own `try` (`page.tsx:134-140`, `ADMIN_NETWORK_ERROR`); non-ok via `readAdminResponse` with `sessionEndedCopy` (`:142-148`); ok via `readJsonBody` + `Array.isArray` (`:153-160`), `MESSAGES_READ_FALLBACK` otherwise; failure clears the list and shows `AdminError` (F-9). Newest wins (`readSeq`, `isNewest()` before every state write) |
| D-16 / URL | `lastSearched` set on every read start (`page.tsx:111`), debounce reads only on a difference (`:185-193`). Spec has one key, `status` (G-7); search never in the URL (G-6, T-3) |
| D-17 | Page-local `ROW_CONTROL_SELECTOR` / `isSelectingIn` (`MessagesTable.tsx:39-48`); `tr` has `onClick` + `cursor-pointer` only (`:138-144`); control and selection checks, opener = the row's Open button (`:106-117`); drawer page-level outside the table (`page.tsx:448-465`) |
| Drawer | Lookup in all loaded `messages` (`page.tsx:332`); close-when-gone ends the open state (`:337-342`); focus to opener or content area (`:346-349`); rendered outside every state branch; one mark-read PATCH on open, only when unread (`:304-308`); "Mark as Unread" renders only when the list row is not unread, so not while the opening PATCH is pending (`MessageDetail.tsx:67`, T-11 / S-3) |
| Chips | Unread `info`, Read and Replied `neutral` (`messagesFormat.ts:28-30`); Low / Normal `neutral`, High `warn`, Urgent `danger` (`:39-44`). Replied extras on wrapper spans, icons `aria-hidden`, sr-only words |
| Logging | Six `console.error` gone; `clientLogger.child({ module: 'AdminMessagesPage' })`. Facts only: `httpStatus`, `filter`, `hasSearch`, `messageId`, `failed` / `total`. Non-ok at `warn`, rejections at `error` with `{ err }`. T-17 serialises every logger call and finds none of the fixture's name, email, phone, company, subject, text, notes, draft or search text |
| Baseline (S-7) | V-0 copy md5 `fdb40bfe7b864ab6ec688861ad9282f7` and the final file md5 `224e79b75acd8a1252801a32d292f556` both reproduced; the diff between them holds only the two query helpers and the B-5, B-12, B-13, B-14 flips |
| S-1 to S-8 | S-1 copy sort (`visibleMessages`, `messagesFormat.ts:90`); S-2 above; S-3 T-11; S-4 / S-5 guard + Implementation Notes; S-6 array checks on rows and replies (`repliesOf`); S-7 above; S-8 `ADMIN_FIELD_CONTROL` on the select, T-2 checks its classes |
| DV-1 to DV-7 | All acceptable. DV-1: the textarea's `aria-label` equals the visible heading, label-in-name holds, and the shared `DrawerSection` stays unedited |
| Standards | No `console.*`, no `any`, no `dangerouslySetInnerHTML`; imports stay inside the folder, the shared layout folder and the client logger (G-2). All touched files LF, no backslash in either MD |
| Tests (spot-run) | `npx jest app/admin/messages app/admin/components/layout --ci`: **20 suites, 631 tests passed** |

### Code Review Comments

None blocking.

| # | Location | Comment | Priority |
|---|---|---|---|
| C-1 | `page.tsx:285`, `:351-365` | The Mark All Read line stays until the next accepted Mark All Read. If the admin then opens the one message that failed (it gets marked read), `hasUnread` turns false, the button goes, and the line keeps saying "Try again" with nothing to retry until the page reloads. Within M-1 (d) as written; a later slice could also clear it when no loaded message is unread | Low |
| C-2 | `components/MessagesTable.tsx:60`, `:85` | The exported components `MessageStatus` and `MessagePriority` have the same names as the types `MessageStatus` / `MessagePriority` in `messagesTypes.ts`. No clash today (no file imports both), but a future import of both needs an alias. Names such as `MessageStatusChips` / `MessagePriorityChip` would avoid it | Low |
| C-3 | `components/MessagesTable.tsx:51` | `repliesOf` is a pure helper living in a component file and imported by `MessageDetail.tsx`; it fits `messagesFormat.ts` (and T-19) better | Low |

### Optimisation Suggestions

- `MessagesTable.tsx:87`: `!priority` is redundant after `priorityTone` returned non-null (cosmetic).
- Not changed by L-7 and not a finding: a second click on the same unread row while its opening PATCH is in flight would send a second PATCH, as the old page could; the open drawer's overlay makes this impractical.

### Code Approved for QA: Yes

No must-fix before commit. C-1 to C-3 are optional and need not hold the fast-track; if Dev takes any, the suites above and the guard must stay green.

---

## QA Report — 2026-10-12

**QA — 2026-10-12**
**Test mode:** full
**Strategy used:** A + B (Jest in jsdom, mocked `fetch` only) plus throwaway probe tests. D (manual browser check) is handed to TL as a read-only checklist, because Playwright is not installed
**Focus:** ui; security (logging, no reply path, no route text on screen); api (request counts and bodies)
**Skipped:** the live browser run (TL runs it from the checklist below) and D-19 in the browser (each failure needs a write, SA M-2)
**Input source:** TL prompt keywords, plus workplan §6, §7, SA M-1 to M-4 and S-1 to S-8

### Commands and results (run by QA)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/messages app/admin/components/layout app/admin/components/__tests__ app/admin/__tests__ app/api/admin/__tests__ lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **40 suites passed, 1440 tests passed**, 82.7 s. Matches Dev's V-1 |
| 2a | Scoped tsc with QA's own `scratchpad/qa-l7/tsconfig.json`. It extends the worktree tsconfig with `noEmit`, `incremental: false` and `plugins: []`, and covers `next-env.d.ts`, `app/admin/messages/**`, `app/admin/components/layout/**` and `adminWindowPresets.ts`. `--listFilesOnly` lists all 10 Messages files plus the canary. Run 1 includes `canary.ts` | **exit 2**, with exactly `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` |
| 2b | The same run with the canary deleted | **exit 0**, no output |
| 3 | Throwaway `app/admin/messages/__tests__/zz.qa-probe.render.test.tsx`: the layout suite's harness plus 22 probes | **22 passed**. P6 and P6b were rewritten once: Refresh is disabled while busy, so the overlapping reads are built from Refresh, a status change and a search. The file was then deleted, and `git status --short` matches the starting state |
| 4 | `npx eslint app/admin/messages` | exit 0, no output |
| 5 | `md5sum messages.baseline.render.test.tsx` | `224e79b75acd8a1252801a32d292f556`, the same as Dev's recorded final md5 (S-7) |
| 6 | `git diff --stat origin/main -- app/api/admin/messages app/api/admin/__tests__` and `git status` | Empty: the routes are untouched |
| 7 | grep the folder source (tests excluded) for `console.`, `/reply`, `/replay`, `dangerouslySetInnerHTML` | No hits |

### Edge-case probes

| # | Probe | Result |
|---|---|---|
| P1 | Open an unread message, close it, reopen it 3 times, then open it with a row click | **One** PATCH `{status:'read'}` in total. No reopen sends one ✅ |
| P2 | Real `userEvent` click on an unread row's text | One PATCH. Focus moves into the dialog ✅ |
| P3 | With Status = Unread, open the only unread message. It leaves the table and the empty state shows. Then a read comes back without it | The drawer stays open after mark-read and closes when the read omits the message. Focus goes to `messages-content`, never `<body>` ✅ |
| P4 | Simulated Back/Forward (an outside `?status=` change) with the drawer open | The `filter=unread` read closes the drawer (the id is absent) and focus goes to the content area. Going back to All reads again and the row returns. The drawer does **not** reopen and nothing is written ✅ |
| P5 | A successful read, then a 500 `{error:'Failed to fetch messages'}`, then Try again | The error shows the route's words, with no table and no empty state. "No messages found" never appears. Retry shows the rows. Focus leaves the vanished Try again button and goes to the content area ✅ |
| P6 | Refresh, a status change and a search overlap. Answers land newest first, then oldest (500 `old_failure_probe`), then the middle one | The newest rows stay. The old failure never shows and the middle success never replaces them. `aria-busy` ends false ✅ |
| P6b | An older success lands while the newest read is pending, then the newest read fails | `aria-busy` stays true on the content area and on Refresh until the newest read settles. The error shows: the older success does not hide it ✅ |
| P7 | Type "da" and empty the box inside the pause; then type "dana"; then empty the box | No GET for the first pair. One GET for "dana". **One** GET `filter=all&search=` on emptying. The search text never appears in any `replaceState` URL or in `location.search` ✅ |
| P8 | Delete: cancel the confirm; accept with a 500 `{error:'route_error_probe'}`; cancel again; accept with a 200 | Cancel sends nothing and focus stays on Delete. The failure sends one DELETE, `json()` is **never called**, the line shows in that row, the route text appears nowhere, and focus stays on Delete. Cancelling again keeps the line. Success removes the row (2 DELETEs in total). After success, focus is on `<body>` (E-1) |
| P8b | A failed delete on row A, then a successful delete on row B | A's line is cleared (E-3) |
| P9 | Mark All Read over 3 unread rows, one PATCH returning 500 | 3 PATCHes (keys `status,updated_at`) and one re-read. No `json()` read. The line has `role="alert"` and the route text appears nowhere. Cancelling sends nothing and keeps the line. An accepted retry clears it. After success, focus is on `<body>` (E-1) |
| P10 | Mark All Read with every PATCH failing, but the re-read shows no unread rows | The line "…Try again." shows with no Mark All Read button to retry with (E-2, the same as SA C-1) |
| P11 | Notes: Save returns 500 with a route body, then Save returns 200 | `json()` is never called. The line has `role="alert"` and the exact words, and focus stays on Save. Success clears the line, leaves edit mode and shows the note. Focus stays on the same toggle button (now "Edit"). 2 PATCHes with keys `admin_notes,updated_at` ✅ |
| P12 | A notes failure, then Escape and reopen | The line is gone: it dies with the `key` ✅ |
| P13 | Mark as Unread returns 500, then a retry returns 200; then close and reopen | The line has the exact words, the chip stays "Read", and focus stays on the button. Success clears the line and the chip becomes "Unread". Focus then goes to the dialog container (Radix), not `<body>`. Escape returns focus to Open. Reopening sends one `read` PATCH ✅ |
| P14 | The mark-read on open is rejected; close; reopen succeeds | The read line shows (no "Try again") and there is no Mark as Unread. Focus returns to Open. Reopening clears the line. One PATCH per open (2 in total) ✅ |
| P15 | A read failure on message A, then open message B | B shows no line ✅ |
| P16 / P17 | Close with X; close with an overlay click | Both close the drawer and return focus to the row's Open button ✅. Escape is covered by T-12 and T-13 |
| P18 | Open a replied message, Mark as Unread, then Mark All Read | No URL matches `/reply` or `/replay`, no POST is sent, and no button anywhere matches /reply/i ✅ |
| P19 | A list read started before the open mark-read PATCH lands after it, carrying the old "unread" row | The drawer shows "Unread" (stale), with no line and no Mark as Unread (E-4) |
| P20 | Accessibility sweep (table below) | ✅ |
| T-17 | Logger spy (the existing suite, reviewed). Every `info`/`warn`/`error`/`debug` argument is serialised across failed and rejected PATCH, DELETE, Mark All Read and reads with a search active | None contains a name, email, phone, company, subject, message text, notes, draft or search text ✅. Code review: the logs carry only `httpStatus`, `filter`, `hasSearch`, `messageId`, `failed` / `total` and `err` |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| One h1, with the text "Messages" | ✅ |
| Search (`textbox`) and Status (`combobox`) are named by visible labels. Status carries `ADMIN_FIELD_CONTROL` (S-8) | ✅ |
| Clear is disabled at the defaults | ✅ |
| Refresh is named "Refresh messages". `aria-busy` is false at rest and true while reading (P6b) | ✅ |
| Every table header has `scope="col"`, and the names are unique (Details, Contact, Message, Status, Received (UTC), sr-only Actions) | ✅ |
| No `tr` has a `tabindex` or a `role` | ✅ |
| Every row has "Open message from {name}" and "Delete message from {name}" | ✅ |
| The dialog is named "Message from {name} {UTC time}" (one h2) | ✅ |
| The drawer sections are Status, Contact, Details, Message, Admin notes and Conversation thread. Each `group` has one h3 | ✅ |
| All five D-19 lines have `role="alert"` | ✅ (P8, P9, P11, P13, P14) |
| Every chip carries words. Unread (info), High (warn) and Urgent (danger) also carry an icon. Read, Replied and Normal (neutral) have no icon | ✅ by design: in StatusChip only `neutral` may lack an icon (§5.9) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None found. Opening an unread row sends one PATCH, each filter or search change sends one GET, and Refresh is disabled while a read is in flight.

#### Edge Cases (nice to fix, all Low)
1. **E-1 Focus falls to `<body>` after a successful Delete and after a successful Mark All Read.** The Delete button leaves with its row, and the Mark All Read button unmounts once nothing is unread. The §5.12 A-3 fallback covers reads only. This is pre-existing: the old page removed both the same way (`git show HEAD:` `:333`). Low.
2. **E-2 The Mark All Read line can stay with nothing to retry** (the same as SA C-1). If the button disappears because nothing is unread any more (every PATCH failed but the re-read shows no unread rows, or the admin opened the one message that failed), "Could not mark every message as read. Try again." stays until the page reloads. Low.
3. **E-3 A delete on another row clears the Delete line.** `setDeleteFailedId(null)` runs on any accepted delete. This is consistent with §2.10 (d) read as "the same action" and is noted only.
4. **E-4 An overlapping read can show a stale status.** A list read that starts before the open mark-read PATCH and lands after it shows the row as "Unread" again, with no line and no Mark as Unread. Reopening sends one more `read` PATCH, which is idempotent. It needs Refresh and then Open within one request's time. Low.

### Browser checklist for TL (READ ONLY: signed-in admin, DevTools Network open)

Never Delete, never Mark All Read, never Save notes and never Mark as Unread. Opening an unread message marks it read, so **set Status = Read before opening anything**.

| # | Check | Light | Dark |
|---|---|---|---|
| M-B1 | Load `/admin/messages`: one `GET /api/admin/messages?filter=all&search=`. h1 "Messages" and the purpose line show. There is no "Messages" pill and no "N unread" pill. "Mark All Read" shows on the right only if a loaded message is unread (do not click it) | ⬜ | ⬜ |
| M-B2 | The "Search" and "Status" labels are visible, and Clear is disabled at the defaults. Status → Unread changes the address bar to `?status=unread` and sends one GET with `filter=unread`. Reloading keeps Unread. Typing a search sends one GET after a pause and never shows in the address bar. Emptying the box sends one GET. Clear resets both with one GET | ⬜ | ⬜ |
| M-B3 | Typing keeps focus in the box (no full-page spinner). Refresh spins and is disabled while reading, the table stays, and "Read at HH:mm UTC" updates | ⬜ | ⬜ |
| M-B4 | DevTools Offline, then Refresh: "Could not reach the server. Check your connection and try again." shows with Try again, never "No messages found". Back online, Try again restores the list | ⬜ | ⬜ |
| M-B5 | Table: a status chip (Unread has an icon), a priority chip beside the name, "Received (UTC)" with an age line, the count line "N messages, M unread, newest first", and an Open button and a named Delete per row. **No Reply and no Eye button** | ⬜ | ⬜ |
| M-B6 | Set Status = Read first. Open a message with Open: **no request** in Network. The panel shows Status, Contact, Details, Message, Admin notes, and Conversation thread when one exists. **No Reply button.** Tab stays inside the panel. Escape, X and an overlay click each close it and return focus to that Open button | ⬜ | ⬜ |
| M-B7 | With Status still Read: clicking a row's text opens it with no request. Selecting text in a row does not open it. Clicking Delete and **cancelling** the confirm opens nothing and sends no request | ⬜ | ⬜ |
| M-B8 | The page and the panel look the same in light and dark emulation. The Status select's option list is dark | ⬜ | ⬜ |
| M-B9 | Throughout: no request to any `/reply` or `/replay` URL and no POST. The Console shows no page errors | ⬜ | ⬜ |

If no read message exists, skip M-B6 and M-B7 and say so. Jest T-11 to T-13 and probes P1 to P4, P16 and P17 cover them.

### Final Status
- [x] **PASS WITH NOTES.** Every acceptance criterion passes in Jest and the probes, with no bugs. Four Low edge cases (E-1 to E-4) are listed; E-1 is pre-existing and E-2 is the same as SA C-1. Ready for RM under the fast-track: SA code review is approved, and TL runs the read-only browser checklist.
- [ ] Issues found: Dev must address before commit
