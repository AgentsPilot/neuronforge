# Workplan: PROD-1b.2, Outlook Calendar Meeting Mail Behind the Recipient Allow-List (E-9)

> **Last Updated**: 2026-11-27

**Developer:** Dev
**Requirement:** Follow-up E-9 of [PROD-1b](/docs/workplans/prod-1b-email-guard-cron-auth-workplan.md) (section 3.2, SA ruling D-4, SA conditions 7 and 8). The approved scope is quoted in section 1
**Branch:** `fix/prod-1b2-outlook-calendar-guard` (created by RM from `origin/main` at `259a7e21`; confirmed by Dev with `git branch --show-current` before writing this plan)
**Baseline read:** `259a7e21`. Every file:line below is from that commit
**Date:** 2026-11-26
**Status:** Code Complete. SA workplan conditions 1 to 3 written into sections 4 and 10, then implemented with 4 and 6 to 12 (condition 5 filed by the coordinator). SA Code Approved; QA PASSED; SA code review findings 1 and 2 applied after QA (task 10). Waiting for the user to see the diff. Not committed

## Overview

PROD-1b (#678) put one recipient check, `checkOutboundRecipients` in `lib/email/recipientAllowList.ts`, in front of every outbound email path. The check uses one switch: the guard is on outside production, and also whenever `EMAIL_RECIPIENT_ALLOWLIST` is set. One path was left for later. Microsoft Graph emails a meeting request to every attendee when an Outlook event is created, an update when it changes, and a cancellation when it is deleted. Graph has no parameter that suppresses this. Google has one (`sendUpdates=none`), and #678 uses it for Google Calendar (E-8). Graph does not. So the Outlook plugin's `create_event`, `update_event` and `delete_event` can still email a real person from a guarded environment.

This slice closes that gap with the **same switch and the same check**. No new variable, guard or module.

- **Create:** if an attendee is not on the list, the event is still written to the owner's calendar, but with **no attendees**, so no meeting request goes to anyone.
- **Update:** the event is read first. If someone already on it is not on the list, nothing is changed, because any change would email them. If only the *new* attendees are refused, the rest of the change is applied and the attendee change is dropped.
- **Delete:** the event is read first. If an attendee is not on the list, the event is not deleted, because the delete would email them a cancellation.
- **A failed read** fails closed: nothing is written.

With the guard off (production, list unset), each action makes exactly the calls it makes today and reads nothing more.

The source guard G-7 gains a pattern for Graph calendar paths, so a new Outlook calendar call changes a pinned count and fails CI until it is registered. The registry entry marked "PROD-1b.2, PENDING" is flipped.

**Gate (from the brief):** PROD-1b.2 is deployed before testers use the staging host (PROD-1b section 12 step 5, gate "before A-6, latest C3").

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Inventory](#3-inventory)
4. [Design](#4-design)
5. [Source guard (G-7)](#5-source-guard-g-7)
6. [Decisions needed from SA](#6-decisions-needed-from-sa)
7. [Files to create / modify](#7-files-to-create--modify)
8. [`console.*` in touched files](#8-console-in-touched-files)
9. [Task list](#9-task-list)
10. [Test plan](#10-test-plan)
11. [Environment changes](#11-environment-changes)
12. [Risks](#12-risks)
13. [Rollback](#13-rollback)
14. [Observed, out of scope](#14-observed-out-of-scope)
15. [SA Review Notes](#15-sa-review-notes)
16. [QA Testing Report](#16-qa-testing-report)
17. [Commit Info](#17-commit-info)
18. [SA Review (2026-11-26)](#sa-review-2026-11-26)
19. [SA Code Review (2026-11-26)](#sa-code-review-2026-11-26)
20. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

From PROD-1b section 3.2:

> E-9 | Outlook calendar meeting requests | `lib/server/outlook-plugin-executor.ts:667` (create), `:721` (update), `:754` (delete) | Graph sends meeting requests and cancellations whenever an event has attendees; there is no flag to suppress them. Guarding it means stripping attendees on create/update and reading the event before a delete, which is its own design. **PROD-1b.2** (SA D-4). Until it lands, the allow-list does not stop Outlook calendar meeting requests, updates or cancellations, including booking sync for an Outlook-connected business (`CalendarSyncService` maps `outlook` to these actions with the booking client as attendee).

Brief constraints: use the same switch and the same check (`checkOutboundRecipients`), with no second guard and no second variable. Re-verify the line numbers. For create and update, decide strip versus refuse, and say whether calendar follows PROD-1b's refuse-whole rule for mixed lists. Booking sync must not break silently. For delete, design the read-before-delete and fail closed when the read fails. Check the other Graph actions that mail, and Google Calendar for consistency. Flip the "Pending (D-4)" guard entry. Log with Pino, using the PROD-1b log line or a calendar equivalent, with no addresses. Jest tests run with no network. Expected env changes: none.

**Line numbers re-verified.** The PROD-1b change to `send_email` added 24 lines above the calendar section, so each method has moved by 24 lines: `createEvent` is now at `:691` (Graph `POST` at `:725-730`), `updateEvent` at `:745` (`PATCH` at `:762-767`), and `deleteEvent` at `:778` (`DELETE` at `:781-785`). The cited lines were the method starts at #678's base. Nothing else changed in these methods.

---

## 2. Analysis summary

| Area | What this slice touches | Facts at `259a7e21` |
|---|---|---|
| Outlook executor | `lib/server/outlook-plugin-executor.ts` | 10 actions, 15 Graph call sites (section 3.1). The three calendar writes build `attendees` from the step and call `makeGraphRequest` directly. `update_event` and `delete_event` do **not** read the event first today. The `send_email` comment at `:64-69` names calendar as "NOT covered yet: PROD-1b.2" |
| The check | `lib/email/recipientAllowList.ts` | `isRecipientGuardOn()`, `checkOutboundRecipients(recipients)`, `recipientsOf(...)`, `refusalLogFields(verdict)`, `RECIPIENT_REFUSED_MESSAGE`. **An empty recipient list is refused** (`unparseable_recipient`, recipientCount 0), so a caller with no attendees must not call the check (Google's code guards with `notifiable.length > 0`, `:393`) |
| Google Calendar (E-8) | `lib/server/google-calendar-plugin-executor.ts` | Create `:270-272`, update `:384-396` (existing and new attendees together, SA CR-1), delete `:449-451` (always `none` while the guard is on). Logs `Calendar notifications suppressed: attendee not on the email allow-list` at `info` (`:199`) |
| Booking sync | `lib/services/CalendarSyncService.ts` | `PROVIDER_TO_PLUGIN` maps `outlook` to `outlook` (`:25-28`). Calls `create_event` (`:128-135`), `update_event` (`:244-252`) and `delete_event` (`:319-322`), with `send_notifications: true` and the client as the only attendee. It treats any `success: true` result as synced, and on delete it clears the stored event id (`:338-348`). **It passes Google's parameter names** (`summary`, `start_time`, `end_time`) to Outlook. Outlook requires `subject`, `start` and `end`, so the base executor's schema check refuses the create before any Graph call. Section 14, O-1 |
| Source guard | `lib/__tests__/envConfigHardening.guard.test.ts` | G-7 dispatch patterns `:129-141`, prefilter `:152-153`, Outlook registry entry `:179-183` (`dispatch: 2, checks: 1`, reason ends "PROD-1b.2, PENDING"). No pattern matches a Graph calendar path today |
| Plugin definition | `lib/plugins/definitions/outlook-plugin-v2.json` | Not changed. `delete_event` declares `send_cancellation` (default true), which the executor has always ignored, and which Graph cannot honour (section 14, O-3). #678 did not add `allowlist_suppressed` to any output schema either; definitions are LLM-facing, so they stay as they are |

**Skills checked.** `tenant-isolation-guard`: not engaged. The executor acts on the connected mailbox (`/me`, token-scoped), and no write is added outside it. The CalendarSyncService change writes `calendar_sync_error` through the existing repository methods it already calls, scoped by `userId`. `business-os-schema-check`: no new column claim. `calendar_sync_error`, `external_calendar_event_id` and `calendar_synced_at` are already written by this file today. `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`, `new-api-route`, `new-repository`: not engaged. `new-plugin`: no new action. `v6-pipeline`: this is V2 plugin executor code, not the V6 pipeline. No IntentContract, CapabilityBinderV2, IntentToIRConverter or ExecutionGraphCompiler change, and no plugin name in shared code. The only Graph-specific text is in the Outlook executor itself and in the G-7 test patterns, where Gmail and Graph paths already live. `env-change-protocol`: no env change (section 11).

---

## 3. Inventory

### 3.1 Every Graph call in the Outlook executor

| # | Line | Action | Method, path | Can Graph email someone? | This slice |
|---|---|---|---|---|---|
| 1 | `:104` | `send_email` | `POST /me/sendMail` | Yes | Already guarded (E-6) |
| 2 | `:309` | `search_emails` | `GET` messages | No | None |
| 3 | `:422` | `create_draft` | `POST /me/messages` | No: a draft | None |
| 4 | `:475` | `create_draft` (threaded) | `POST /me/messages/{id}/createReply` | No: makes a draft (SA verified in PROD-1b) | None |
| 5 | `:541` | `modify_message` | `GET` categories | No | None |
| 6 | `:566` | `modify_message` | `PATCH /me/messages/{id}` | No: flags and categories | None |
| 7 | `:572` | `modify_message` | `GET` | No | None |
| 8 | `:588` | `modify_message` | `POST /me/messages/{id}/move` | No | None |
| 9 | `:608` | `get_email_attachment` | `GET` | No | None |
| 10 | `:626` | `get_email_attachment` | `GET` | No | None |
| 11 | `:662` | `list_events` | `GET {calendar}/calendarView` | No | None |
| 12 | `:725` | `create_event` | `POST /me/events` | **Yes: a meeting request to each attendee** | **E-9a** |
| 13 | `:762` | `update_event` | `PATCH /me/events/{id}` | **Yes: an update to existing attendees, an invitation to added ones, a cancellation to removed ones** | **E-9b** |
| 14 | `:781` | `delete_event` | `DELETE /me/events/{id}` | **Yes: a cancellation to each attendee, when the user is the organizer** | **E-9c** |
| 15 | `:797` | `get_event_details` | `GET /me/events/{id}` | No | None |

**Count check:** 15 call sites = 1 already guarded + 3 in scope (E-9a, E-9b, E-9c) + 2 drafts + 2 message writes that cannot send + 7 reads. 1 + 3 + 2 + 2 + 7 = 15. `makeGraphRequestWithPrefer` (`:833`) and `makeGraphRequest` (`:843`) are the request helpers, not call sites.

Graph behaviour, from Microsoft's reference pages:
- **Create event:** "When an event is sent, the server sends invitations to all the attendees."
- **Delete event:** deleting a meeting on the organizer's calendar sends a cancellation to its attendees.
- **`cancel`:** a separate action, available only to the organizer, that sends a cancellation with a comment.
- **No suppression flag:** Microsoft's Q&A answers confirm that create and update have no option to suppress meeting mail. Graph v1.0 `DELETE` has no such option either.

### 3.2 Other Graph or Outlook actions that can mail

| Endpoint family | Used anywhere in deployed code? | Note |
|---|---|---|
| Event `cancel`, `forward`, `accept`, `decline`, `tentativelyAccept` (the last three take `sendResponse`, default true, which mails the organizer) | No (grep of `app/`, `lib/`, `components/`, `hooks/`, `middleware.ts`) | The new G-7 pattern matches any of them written under `/me/events/…`, `/users/…/events/…` or `/groups/…/events/…` (section 5) |
| Message `send` (a draft), `reply`, `replyAll`, `forward` | Only `/me/sendMail` (E-6). `replyAll` and `forward` are already G-7 patterns | Graph's `/me/messages/{id}/send` and `/me/messages/{id}/reply` send immediately, and **no G-7 pattern matches them**. Both have zero hits today, so adding the patterns changes no count (section 5) |
| Graph JSON batching (`$batch`) | No hits | Residual: a batched request could carry an event path without a leading slash. Recorded in R-7, with no pattern for it |
| OneDrive executor (`lib/server/onedrive-plugin-executor.ts`, Graph) | `createLink` at `:420` | Makes a sharing link and emails nobody. No `invite` call |
| Group calendars (`/groups/{id}/events`, which mail every group member) | No hits | Covered by the new pattern |

### 3.3 Google Calendar (E-8): consistency check

| Case | Google (E-8, shipped) | Outlook (this plan) | Same result for the refused person? |
|---|---|---|---|
| Create, an attendee refused | The event is written **with** its attendees, and `sendUpdates=none` | The event is written **without** attendees | Yes: nobody is mailed. The event's content differs, because Graph cannot keep an attendee silently |
| Update, an existing attendee refused | The update is applied with `none` | **No update** (D-2) | Yes: nobody is mailed. Outlook cannot apply the change silently |
| Update, only new attendees refused | The update is applied with `none`, and the new attendees are on the event | The update is applied **without** the attendee change (D-3) | Yes |
| Delete, guard on | Always `none`, with no read | Read first, and delete only if every attendee is allowed (D-4) | Yes |
| Guard off | Unchanged | Unchanged, with no extra call | Yes |
| Log line | `Calendar notifications suppressed: attendee not on the email allow-list` (`info`) | The same text for create and update-without-attendees, plus one new line for a change not made (D-8) | |

There is no defect in E-8. The two providers differ only where Graph has no flag.

### 3.4 New finding, outside E-9: Google Drive share notifications (E-10 candidate)

`lib/server/google-drive-plugin-executor.ts` `shareFile` (`:844`) calls `POST …/drive/v3/files/{id}/permissions`, once per address, for `permission_type` `user` or `group` (`:889`), and with no `sendNotificationEmail` parameter. Google's `permissions.create` reference says `sendNotificationEmail` "defaults to true for users and groups". So Google emails a share notification to each address. The other branch, `anyone` and `domain` (`:930`), cannot take the parameter and notifies nobody, so only the `:889` branch matters (SA condition 12). This path is not in PROD-1b's inventory: its grep list did not include `permissions` or `sendNotificationEmail`, and no G-7 pattern matches it. It sends mail to an arbitrary address from a guarded environment today. D-12 asks where it goes. It is not in this plan's file list.

---

## 4. Design

### 4.1 Common rules

- **The switch:** `isRecipientGuardOn()`, and nothing else. When it is off, every calendar action takes today's path byte for byte, with no read and no check (production does no new work, as in PROD-1b 4.1).
- **The check:** `checkOutboundRecipients(recipientsOf(…))`, called inline at each of the three sites, so G-7's check count is meaningful per site (PROD-1b SA code review item 2). It is never called with an empty list, because an empty list is refused. An event with no one to notify needs no check.
- **The notifiable set** of an existing event (update and delete). It fails closed on the read's **shape**, not only on each address (SA condition 1). The read's body is typed `unknown` and narrowed, with no new `any` (rule 6):
  - if `attendees` is an array, each entry's `emailAddress.address` when it is a string, otherwise `''`;
  - if `attendees` is missing or is not an array, **one `''`** (an unparseable recipient), never "no attendees";
  - unless `isOrganizer` is exactly `true`, the organizer's `emailAddress.address`, or `''` when it is missing (D-6);
  - every `''` is refused by the check (the PROD-1b `recipientsOf` rule). So a read body of `{}` (which is what `makeGraphRequest` returns for a 204) is refused, and an unexpected or empty body never means "nobody to email".
- **The read** (update and delete, guard on only): one `GET /me/events/{id}?$select=attendees,organizer,isOrganizer,subject,start,end`, through `makeGraphRequest`, in one private helper. Any failure throws through the existing error mapping (`not_found`, `auth_failed`, `quota_exceeded`, …). Nothing is written (D-5). The write happens only after a successful read, inside the same `executeSpecificAction` call. (SA condition 6: the base executor's 401 refresh-and-retry does not run for Outlook today, because `makeGraphRequest` throws `auth_failed` with no status for `httpStatusOf` to find. If a retry ever did run, it would rerun the whole `executeSpecificAction`, so the read and the write would stay together.)
- **Mixed lists:** an invitation goes to everyone on it or to no one. This is PROD-1b's D-2 (refused whole), applied to the meeting request. The owner's own calendar entry is still written where Graph allows it silently. That is E-8's rule: the event is written, and nobody is notified.

### 4.2 Create (`create_event`, E-9a)

| Guard | Attendees in the step | Action | Result |
|---|---|---|---|
| off | any | As today | As today |
| on | none, or an empty array | As today (nothing to mail) | As today |
| on | all allowed | As today, attendees kept | As today |
| on | any refused or unparseable (including list unset) | `POST /me/events` **without** the `attendees` key; everything else kept | Today's shape, plus `invitations_suppressed: true` and a plain `note` |

Refusing the whole create (alternative C in D-1) would leave booking sync, and any agent, with no diary entry at all. Stripping only the refused attendees (alternative A) would send an allowed attendee a meeting request whose guest list misrepresents the meeting. That is the "subset changes the message" reason SA gave for D-2.

### 4.3 Update (`update_event`, E-9b)

Guard on, in order:

1. Read the event (4.1). A failed read throws, and nothing is written.
2. If the existing notifiable set is not empty and the check refuses it, **no `PATCH`**. Any `PATCH` to a meeting can mail the people already on it, and removing a refused attendee mails them a cancellation. Result: `status: 'not_updated'`, `allowlist_suppressed: true`, `note`, plus `id` and the read's current `subject`, `start` and `end`. Log at `warn` (D-8).
3. If the step has a non-empty `attendees` and the check refuses it, the `attendees` key is dropped from the `PATCH` body, and the other fields still apply (D-3). The result carries `invitations_suppressed: true`. An `attendees: []` (removal) on an event whose existing attendees are all allowed is applied, because the cancellations go only to listed people.
4. If the `PATCH` body is now empty (the only requested change was the attendee change, and step 3 refused it), no `PATCH` is sent. **Nothing was done**, so the result is the step 2 shape: `status: 'not_updated'`, `allowlist_suppressed: true`, `note`, the read's current values, and the `warn` line (SA condition 3). `invitations_suppressed` is set only when some other field was actually changed. With D-9, a sync that moved nothing records an error, not "synced". Not writing when there is nothing to write follows the precedent in `modify_message` (`:556-576`).
5. Otherwise, `PATCH` as today.

Guard off: no read, and `PATCH` exactly as today.

**Booking sync, worked through.** Under the guard, a sync-created event has no attendees (4.2). A reschedule then reads an empty notifiable set (step 2 passes), drops the client from the attendee change (step 3), and moves the time. The owner's diary stays right and nobody is mailed. Only an event that already had an unlisted attendee before the guard is refused, and step 2 and D-9 make that refusal visible.

### 4.4 Delete (`delete_event`, E-9c)

Guard on:

1. Read the event (4.1). A failed read throws, and there is no `DELETE`. A 404 on the read gives the same `not_found` error today's `DELETE` gives on a 404, so CalendarSyncService's "already deleted" handling (`:324-331`) is unchanged.
2. If the notifiable set is empty, or the check allows it, `DELETE` as today.
3. Otherwise, **no `DELETE`**. The event stays on the owner's calendar. Result: `event_id`, `deleted_at: null`, `status: 'not_deleted'`, `allowlist_suppressed: true`, `note`. Log at `warn`.

There is no silent alternative. Removing attendees first mails them cancellations, and `cancel` mails them by design.

Guard off: no read, and `DELETE` exactly as today.

### 4.5 Result shapes (D-7)

Every result is success-shaped, as with PROD-1b's D-5: an agent run completes and shows why. A thrown error would fail the run, and a failed scheduled run is re-run up to the dead-letter cap, only to hit the same refusal.

| Flag | Meaning | Set by |
|---|---|---|
| `allowlist_suppressed: true` | **The action was not done.** The flag means the same as on `send_email`, which `gaps/reply` already reads | update (step 2, and step 4: the only change was a refused attendee change), delete (step 3) |
| `invitations_suppressed: true` (new) | **The action was done, but nobody was invited** | create (stripped); update (attendee change dropped **and** some other field was changed) |

A first-party caller that acts on the result must check `allowlist_suppressed`. The only first-party caller is CalendarSyncService (4.7).

### 4.6 Logging (D-8)

Pino, with the executor's module logger. Fields: `action`, plus `refusalLogFields(verdict)`, which carries `reason`, `isProduction`, `recipientCount` and `refusedCount`. **No address, no subject, no event body**, the same as #678.

| Case | Level | Message |
|---|---|---|
| Create stripped; update with the attendee change dropped | `info` | `Calendar notifications suppressed: attendee not on the email allow-list`: the text Google already logs, so one operator search covers both providers |
| Update or delete not made | `warn` | `Calendar event not changed: attendee not on the email allow-list` |

Both strings become exported constants in `lib/email/recipientAllowList.ts`, next to `RECIPIENT_REFUSED_MESSAGE`. Google's `suppressInvitations` (`:199`) switches to the constant, with byte-identical text, so the two providers cannot drift.

### 4.7 CalendarSyncService (D-9)

In `updateCalendarEvent` and `deleteCalendarEvent`, a result with `data.allowlist_suppressed === true` is treated as **not synced**:
- `calendar_sync_error` is written with a plain message ("Not changed: this environment only sends calendar mail to allow-listed addresses"), through the existing `updateMeetingCalendarSync` or `updateCalendarSync` call;
- the stored event id is kept (delete does not clear it);
- `calendar_synced_at` is not touched;
- the function returns `{ success: false, error }`.

The check is provider-agnostic: Google never returns the flag, so Google sync is unchanged. Create needs no change, because a stripped create really did write the event and its id is recorded as today. Today this code is never reached for Outlook (O-1). It is added now so that the day the parameter names are fixed, booking sync cannot claim a reschedule or a cancellation it did not make. This follows the precedent of SA condition 1 on `gaps/reply`.

---

## 5. Source guard (G-7)

All changes are in `lib/__tests__/envConfigHardening.guard.test.ts`, in the existing one-pass scan. There is no new suite and no new CI job. The patterns are described in words here, because the docs folder is scanned by Tailwind and must not hold backslash-escaped text.

| Item | Change |
|---|---|
| New dispatch pattern: Graph calendar paths | A slash, then `me`, or `users` / `groups` with an optional single path segment, then a slash and `events`, `calendar`, `calendars` or `calendarGroups`, followed by a quote, backtick, slash or `?`. It is bounded by lookarounds only, with no newline, anchor or multiline flag (PROD-1a 6.4). It matches every Graph event path, including `cancel`, `forward`, `accept`, `decline` and `instances` under it. **Measured at `259a7e21`:** across the deployed scope, it matches only `lib/server/outlook-plugin-executor.ts`, at `:657` (two hits), `:727`, `:764`, `:783` and `:799`. It does not match Google's `…/calendar/v3/calendars/{id}/events` or `…/users/me/calendarList`, the `@/lib/audit/events` imports, or any `/api/…` route |
| New dispatch pattern: Graph message send and reply | `/messages/<segment>/send` or `/messages/<segment>/reply`, followed by a quote, backtick or `?`. Zero hits today. Gmail's `/users/me/messages/send` has no segment in between, so it is not matched |
| Prefilter | Two alternatives are added to the existing latin1 regex, one per new pattern, each narrow (a `/me`, `/users/<id>` or `/groups/<id>` prefix before `events` or `calendar`; a `/messages/<id>/` prefix before `send` or `reply`), so no broad word such as `events` decodes extra files. Dev records the suite time before and after. Budget: the existing +1 s on CI (PROD-1b SA condition 13) |
| Outlook pin | It reads and pins **counts**, not lines. **Measured after implementation: dispatch 9, checks 7.** Dispatch: `sendMail` 2 (code and the `:62`-style comment, as before) + 7 calendar paths (list 2, create, the read helper, update, delete, details), as expected. Checks: `send_email` 1 + create 1 + update **3** (`isRecipientGuardOn(` plus two `checkOutboundRecipients(`, one for the existing attendees and one for the new ones) + delete 2 = **7**; the plan's 6 had counted update's two checks as one. No new comment names a Graph calendar path (SA condition 9), so no comment hit was added. No other file entered the registry |
| Reason text (the flip) | `E-6 send_email; E-9 calendar (PROD-1b.2): create strips attendees when one is refused; update and delete read the event first and do not write when an attendee is refused`. "PENDING" is removed |
| New self-test | No `EMAIL_SEND_SITES` reason contains `PENDING`, so a future deferral has to be written as a decision, not left behind |
| Pattern self-tests | Run in LF and CRLF forms. In both new patterns the single segment cannot contain a slash, whitespace or a quote, so a template id counts as one segment (SA condition 8). Caught once each: `'/me/events'`, the `/me/events/${id}` template, `/me/calendars/${id}/events`, `/users/${id}/events`, `/groups/${id}/calendar/events`, `/me/events/${id}/cancel`, `/me/messages/${id}/send`, `/me/messages/${id}/reply`, and `/me/messages/${id}/replyAll` (once, by its own pattern, not twice). Not caught: `@/lib/audit/events'`, `/api/business-os/gaps/reply`, Google's `/calendar/v3/users/me/calendarList` and `/calendar/v3/calendars/${id}/events`, `/me/messages/${encodeURIComponent(replyTo)}/createReply` (the draft at `:475`), and the bare word "events" in prose. A further self-test checks the prefilter admits every new form |

**What fails CI afterwards:**
- a new Outlook calendar call (any new `/me/events…` path) changes the pinned dispatch count;
- removing one of the three calendar checks changes the pinned check count;
- a new file with a Graph calendar or message-send path is not in the registry.

The residual is the one SA accepted for G-7: a check moved away from its write, at the same count, passes. The unit tests in 10.1 cover that behaviour. D-10 offers a stricter per-method rule as the alternative.

---

## 6. Decisions needed from SA

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D-1 | Create, with any attendee refused | A: strip only the refused ones. **B: strip all attendees and still write the event.** C: refuse the whole create | **B.** It matches PROD-1b's D-2 for the mail: a meeting request goes to the whole list or to no one. It matches E-8 for the write: the owner's calendar entry is still made. C breaks booking sync and agent runs for no gain. A sends a listed attendee a misleading invitation |
| D-2 | Update, with someone already on the event refused | **Refuse the whole update (no `PATCH`).** Apply it anyway (mails them). Strip them (mails them a cancellation) | **Refuse.** It is the only option that mails nobody. Under 4.2, events created on a guarded environment cannot get here; it happens only for events made before the guard, or by hand in Outlook |
| D-3 | Update, with only the new attendees refused | **A: drop the attendee change and apply the rest.** B: refuse the whole update | **A.** It keeps the owner's diary right on a reschedule (the booking-sync shape in 4.3). The people who are notified (the existing attendees) are all listed |
| D-4 | Delete, with an attendee refused | **Refuse the delete (the event stays).** Delete anyway. Strip, then delete | **Refuse.** Graph has no silent delete for a meeting. The event left in the diary is reported through `allowlist_suppressed` and D-9 |
| D-5 | The read fails | **Throw through the existing mapping; no write.** Return a suppressed success | **Throw.** It is the same failure the write would have met (404, 401, 429). So existing handling (the base executor's 401 refresh, sync's "already deleted" on 404) works unchanged, and nothing is written blind |
| D-6 | The organizer when the user is not the organizer | **Include the organizer's address in the notifiable set.** Attendees only | **Include.** Graph does not document whether an attendee-side delete or change sends anything to the organizer, so it fails closed. The cost is a refusal on staging for the user's copy of someone else's meeting |
| D-7 | Result flags | **`allowlist_suppressed` = not done; new `invitations_suppressed` = done without invitations.** One flag for both | **Two flags.** `gaps/reply` already reads `allowlist_suppressed` as "nothing happened". Using it for a create that did happen would make a caller discard a real event id |
| D-8 | Log lines | **Google's existing calendar line for done-without-invitations (`info`); a new line for not changed (`warn`); both as constants; Google switched to the constant.** `RECIPIENT_REFUSED_MESSAGE` for everything | **The two calendar lines.** "Email not sent" is wrong for an event that was written. Constants mean one search per meaning across both providers |
| D-9 | CalendarSyncService | **Treat `allowlist_suppressed` as not synced on update and delete (4.7).** Leave the service unchanged, because it is unreachable for Outlook today (O-1) | **Change it.** It is small and provider-agnostic, and it changes nothing for Google. It means that fixing O-1 later cannot produce a silent false "synced". This follows the precedent of PROD-1b's SA condition 1 |
| D-10 | Source guard strength | **A: pinned counts with the new patterns (section 5).** B: also a per-method rule, so that any method of this file with a calendar path and a `POST`, `PATCH` or `DELETE` must contain a check | **A.** It is G-7's existing model, so it brings no new rule shape. A new calendar call already fails CI. B closes the "moved check" residual, but adds method-splitting logic to the guard |
| D-11 | The race between read and write (someone adds an unlisted attendee in Outlook in the moment between the read and the write) | **Accept it as residual.** Send `If-Match` with the read's etag | **Accept.** The window is about a second, on staging only. Graph's event reference does not document `If-Match` for event update or delete, and a header we cannot verify live could fail every guarded update |
| D-12 | E-10, Google Drive share notifications (3.4) | **A: a separate slice, PROD-1b.3, with the same gate (before A-6).** B: fold it into this PR | **A.** The user wants one goal per PR. The fix is small: set `sendNotificationEmail=false` explicitly when the guard is on and any address is refused, and register the file in G-7 with a `sendNotificationEmail` / `permissions` pattern. Its gate is the same as this one. TL to schedule it |
| D-13 | O-1, Outlook booking sync sends the wrong parameter names | **Report it to TL; do not fix it here.** Fix it here | **Report.** Fixing it turns on a feature that does not work today, and would start meeting mail in production. It is a product change with its own review. This plan makes sure that when it is fixed, the guard already holds |

---

## 7. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/server/outlook-plugin-executor.ts` | modify | E-9a/b/c (4.2 to 4.4); one private read helper; import `isRecipientGuardOn`; update the `send_email` comment at `:64-69` (calendar is now covered) |
| `lib/email/recipientAllowList.ts` | modify | Two exported log-message constants (D-8). No logic change |
| `lib/server/google-calendar-plugin-executor.ts` | modify | `:199` uses the constant; the text is byte-identical (D-8). No behaviour change; the G-7 counts are unchanged |
| `lib/services/CalendarSyncService.ts` | modify | Honour `allowlist_suppressed` on update and delete (D-9, 4.7) |
| `tests/plugins/unit-tests/outlook.test.ts` | modify | A new `PROD-1b.2` describe (10.1). **The existing `update_event` and `delete_event` smoke cases change** (SA condition 2): the guard is on under Jest, and their single canned body (no `isOrganizer`; `{}` with 204) is refused by the fail-closed read, so no write would happen. Both move to `mockFetchSequence` with a realistic read (`isOrganizer: true`, `attendees: []`) then the write's response, and assert the `GET` then the write. The rule is not loosened to keep the old fixtures |
| `lib/services/__tests__/CalendarSyncService.allowlistSuppressed.test.ts` | create | 10.2 |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | Section 5 |
| `docs/workplans/prod-1b-email-guard-cron-auth-workplan.md` | modify | E-9 row (3.2) and section 15 point to this slice; a Change History row (the master requirement must record every slice stage) |
| this workplan | create | |

No migration, no plugin definition change, no new route, no env variable.

---

## 8. `console.*` in touched files

CLAUDE.md § Logging. Measured at `259a7e21`:

| File | `console.*` calls |
|---|---|
| `lib/server/outlook-plugin-executor.ts` | 0 |
| `lib/email/recipientAllowList.ts` | 0 |
| `lib/server/google-calendar-plugin-executor.ts` | 0 |
| `lib/services/CalendarSyncService.ts` | 0 |
| `tests/plugins/unit-tests/outlook.test.ts` | 0 |
| `lib/__tests__/envConfigHardening.guard.test.ts` | 0 |
| **Total** | **0 in 6 files**: nothing to flag or convert |

---

## 9. Task list

- ✅ 0. Branch confirmed (`fix/prod-1b2-outlook-calendar-guard`, from `259a7e21`). SA approved the plan with conditions; conditions 1 to 3 written into sections 4 and 10 before any code.
- ✅ 1. Log constants in `recipientAllowList.ts`; Google's suppression line switched to the constant (text byte-identical).
- ✅ 2. Outlook: the typed read helper (`unknown`, narrowed; SA condition 1); `create_event` (4.2), `update_event` (4.3, with condition 3), `delete_event` (4.4); the `send_email` comment (no Graph path in it, condition 9).
- ✅ 3. Outlook tests (10.1). The two smoke fixtures moved to `mockFetchSequence` with a realistic read (condition 2); the rule was not loosened.
- ✅ 4. CalendarSyncService (4.7) and its test (10.2), every import-time module mocked (condition 10).
- ✅ 5. G-7 patterns, prefilter, Outlook pin 9 / 7 and reason, the no-`PENDING` self-test, the prefilter self-test, and the LF/CRLF pattern self-tests with the condition 8 lookalikes (section 5).
- ✅ 6. Negative checks (10.3) a to g, all red, every file restored byte-exact.
- ✅ 7. Ship drill step 1: typecheck filtered to the touched files (completed, no OOM, 0 diagnostics in them); the `lint:hooks` config on the touched `lib/` files (clean); every touched suite plus the Google Calendar, Gmail and contact suites (to confirm the constant change). QA ran `npm run build` and `test:gate` diffed against `259a7e21` (QA report: PASS).
- ✅ 8. Docs: the PROD-1b workplan rows (section 7, SA condition 4): the E-9 latent note, the new E-10 row, the step 1b notice and the step 5 A-6 gate naming PROD-1b.2 and PROD-1b.3, the G-7 "Pending (D-4)" row marked flipped, a section 15 row and a Change History row.
- ✅ 9. (SA condition 5) O-1 is filed by the coordinator as "O-1 Outlook booking sync parameter bug (ClickUp, under PROD-1)" (section 14). Not fixed here; Drive (E-10) not touched here.
- ✅ 10. (SA code review findings 1 and 2, after QA) The sync's two `warn` lines now log `CALENDAR_CHANGE_REFUSED_MESSAGE` with an `action` field (`update_event` / `delete_event`). U-12 and D-10 added: `isOrganizer: 'true'` (a string) with an unlisted organizer is refused. Under the exact loosening `!body.isOrganizer` both went red (2 failed); the executor was restored byte-exact (sha256 matched, `git diff` hash unchanged) and both went green again.

---

## 10. Test plan

All tests use mocked `fetch` (`tests/plugins/common/mock-fetch.ts`) and no network (`tests/jest-no-network.ts`). The environment is set per test and restored, as in the existing suite, where `@example.com` is listed and `customer.example` is not.

### 10.1 `tests/plugins/unit-tests/outlook.test.ts`, describe "PROD-1b.2 calendar guard"

| # | Case | Expectation |
|---|---|---|
| C-1 | Create, guard on, all attendees listed | One `POST /me/events`; the body has the attendees; no `invitations_suppressed` |
| C-2 | Create, guard on, one listed and one unlisted | One `POST`; the body has **no** `attendees` key; `invitations_suppressed: true`; one `info` line with counts only (**failure path**) |
| C-3 | Create, guard on, list unset | Attendees stripped |
| C-4 | Create, an attendee that is not a string | Stripped (fail closed) |
| C-5 | Create, no attendees | `POST` as today; the check is not called |
| C-6 | Create, production with the list absent, unlisted attendee | Attendees kept; one call (unchanged) |
| C-7 | Create, production with the list set, unlisted attendee | Stripped (same switch) |
| U-1 | Update, production with the list absent | Exactly **one** call (`PATCH`), no read |
| U-2 | Update, guard on, existing none, new one unlisted (booking-sync shape) | `GET` then `PATCH`; the body has the time change and **no** `attendees`; `invitations_suppressed: true` |
| U-3 | Update, guard on, existing listed, new listed | `GET` then `PATCH` with attendees |
| U-4 | Update, guard on, an existing attendee unlisted, subject change only | `GET` only, **no `PATCH`**; `allowlist_suppressed: true`, `status: 'not_updated'`; one `warn` line (**failure path**) |
| U-5 | Update, guard on, an existing attendee unlisted, `attendees: []` | No `PATCH` (the removal would mail a cancellation) |
| U-6 | Update, guard on, an existing attendee with no address | No `PATCH` (fail closed) |
| U-7 | Update, guard on, the user is not the organizer and the organizer is unlisted | No `PATCH` (D-6) |
| U-8 | Update, guard on, only an unlisted attendee change, nothing else | `GET` only; no `PATCH` (empty body); `allowlist_suppressed: true`, `status: 'not_updated'`, no `invitations_suppressed`; one `warn` line (SA condition 3) |
| U-10 | Update, guard on, read body `{}` (the shape of a 204) | No `PATCH` (SA condition 1) |
| U-11 | Update, guard on, read body with `isOrganizer: true` and **no** `attendees` key | No `PATCH` (SA condition 1: a missing list is one unparseable recipient) |
| U-12 | Update, guard on, `isOrganizer: 'true'` (the string) and an unlisted organizer | No `PATCH`: only exactly `true` leaves the organizer out (SA code review finding 2; red under `!body.isOrganizer`) |
| U-9 | Update, guard on, the read answers 404 or 500 | An error result; **no `PATCH`** (**failure path**, fail closed) |
| D-1 | Delete, production with the list absent | Exactly one call (`DELETE`), no read |
| D-2 | Delete, guard on, no attendees, the user is the organizer | `GET` then `DELETE` |
| D-3 | Delete, guard on, all attendees listed | `GET` then `DELETE` |
| D-4 | Delete, guard on, one unlisted | `GET` only, **no `DELETE`**; `allowlist_suppressed: true`, `status: 'not_deleted'`, `deleted_at: null` (**failure path**) |
| D-5 | Delete, guard on, the read answers 404 | The same error result as today's `DELETE` 404 with the guard off (compared directly); no `DELETE` |
| D-6 | Delete, guard on, the read answers 500 | An error; no `DELETE` |
| D-7 | Delete, production with the list set, unlisted attendee | No `DELETE` (same switch) |
| D-8 | Delete, guard on, read body `{}` (204 shape) | No `DELETE` (SA condition 1) |
| D-9 | Delete, guard on, `isOrganizer: true` and no `attendees` key | No `DELETE` (SA condition 1) |
| D-10 | Delete, guard on, `isOrganizer: 'true'` (the string) and an unlisted organizer | No `DELETE` (SA code review finding 2; red under `!body.isOrganizer`) |
| S-1 | The existing `[smoke]` `update_event` and `delete_event` cases | Moved to `mockFetchSequence`: a realistic read (`isOrganizer: true`, `attendees: []`) then the write's response; assert the `GET` and then the `PATCH` / `DELETE` (SA condition 2). Not loosened |
| P-1 | The refusal cases (C-2, U-2, U-4, D-4) | No `info`, `warn` or `error` call carries a fixture address, the subject or the body. Only `createLogger` is replaced by a recorder; every call's arguments are serialised and searched. `debug` is left out because of the pre-existing parameter dump (O-5) |

### 10.2 `lib/services/__tests__/CalendarSyncService.allowlistSuppressed.test.ts`

Every module the service loads at import is mocked (SA condition 10): `@/lib/server/plugin-executer-v2` and the four repository modules the service imports (`SchedulingRepository`, `ExternalCalendarEventRepository`, `BusinessProfileRepository`, `PluginConnectionRepository`). `externalEventBlocksTime` imports nothing and stays real. No Supabase client is created and nothing reaches the network.

| Case | Expectation |
|---|---|
| Update returns `allowlist_suppressed: true` | `{ success: false }`; `calendar_sync_error` written; `calendar_synced_at` not written |
| Delete returns `allowlist_suppressed: true` | `{ success: false }`; the event id is **not** cleared (`clearCalendarSync` and the meeting clear are not called); `calendar_sync_error` written |
| The same for a package session (`meeting` given) | The meeting row is written, not the booking |
| An ordinary success (the Google shape) | Unchanged: synced timestamp written, error cleared, id cleared on delete (happy path) |

### 10.3 Negative checks (Dev, then QA; every file restored byte-exact)

| # | Mutation | Expected |
|---|---|---|
| a | Remove the `checkOutboundRecipients(` call from `create_event` | G-7 red (check count) |
| b | Add a new method with a `POST` to a `/me/events/${id}/cancel` path | G-7 red (dispatch count) |
| c | A new lib file with a `/me/events` path | G-7 red (unregistered file) |
| d | Put "PENDING" back in the Outlook reason | The new self-test is red |
| e | In `deleteEvent`, skip the read when the guard is on | D-4 red |
| f | Leave the organizer out of the notifiable set | U-7 red (SA condition 7) |
| g | Treat a missing `attendees` key as empty | U-11 / D-9 red (SA condition 7) |

**Result (Dev, 2026-11-26, local Windows).** A script applied each mutation, ran the one test it should break (`-t`), and restored the original bytes in a `finally`. All seven went red: (a) G-7 pin, 1 failed; (b) G-7 pin, 1 failed; (c) G-7 registry, 1 failed; (d) the no-`PENDING` self-test, 1 failed; (e) D-4, 1 failed; (f) U-7, 1 failed; (g) U-11 and D-9, 2 failed. Afterwards the executor and guard files' sha256 matched their pre-run values, the temporary lib file was gone, and the hash of `git diff` was identical before and after.

### 10.4 Verification output (Dev, 2026-11-26, local Windows)

| Run | Result |
|---|---|
| `tests/plugins/unit-tests/outlook.test.ts` | 59 / 59 pass (28 new PROD-1b.2 cases: 7 create, 12 update, 9 delete; 2 smoke cases changed per SA condition 2). **After the SA code review follow-up (2026-11-27): 61 / 61** (U-12 and D-10 added). The same rerun: CalendarSync 4 / 4, the guard suite 87 / 87, Google Calendar 38 / 38 |
| `lib/services/__tests__/CalendarSyncService.allowlistSuppressed.test.ts` (new) | 4 / 4 pass |
| `lib/__tests__/envConfigHardening.guard.test.ts` | 87 / 87 pass (was 70; 17 new self-tests). About 8.8 s alone, on a machine running two other full test runs and two typechecks, so it is not a timing figure; the CI time is owed on the PR (PROD-1b SA condition 13) |
| Touched and affected suites together (Outlook, Google Calendar, Gmail, `lib/services/__tests__`, `lib/scheduling/__tests__`, `lib/email/__tests__`, the guard suite, the meetings route, `app/api/cron/__tests__`, the calendar-blocking guard, `confirmPackageOnPayment`, the contact route, `emailTransport.allowList`, `gaps/reply`) | 131 suites, 2,499 tests: **2,496 pass, 3 fail**. All 3 are pre-existing Windows-only failures in suites that do not read any touched file (below) |
| Every source-guard suite (`*.guard.test.ts(x)`, 375 suites) | 9,536 tests: **9,516 pass, 20 fail in 16 suites**. None of the 16 references a touched file. They are the known Windows checkout failures: the working tree is CRLF (`core.autocrlf=true`, `i/lf w/crlf`), so source scans for a literal newline fail, and some compare Windows backslash paths with POSIX lists (for example `oneAddressPolicy.guard`, already recorded as pre-existing in PROD-1b, and `publicEndpointsAreThrottled.guard`, which prints backslash paths). Expected green on CI (Linux); QA confirms with the gate diffed against `259a7e21` |
| Typecheck: `tsc --noEmit -p tsconfig.json`, 8 GB heap | It ran to completion in about 16 minutes on the loaded machine: exit 2 with diagnostics, as on `main`, and no out-of-memory or V8 trace in the output. 1,846 diagnostics repo-wide, in 401 files. **0 diagnostics in the 7 touched or new `.ts` files** |
| Hooks lint (`eslint.hooks.config.mjs`, the `lint:hooks` config) on the touched `lib/` files | Clean |
| Negative checks | 10.3: 7 / 7 red, restored byte-exact |

**Not run by Dev:** `npm run build` and the full `test:gate` diffed against `259a7e21` (QA), and the guard suite's CI time (on the PR).

---

## 11. Environment changes

**None.** No new variable: the slice reads `EMAIL_RECIPIENT_ALLOWLIST` and `VERCEL_ENV` through the existing functions only, so `catalogueDrift.guard` sees no new read. There is no catalogue row change, no cron, no setting and no third-party configuration. Microsoft Graph needs no new scope (`Calendars.ReadWrite` already covers the read).

**After deploy (TL, not an env change):** PROD-1b section 12 step 1b's user notice said the list "does NOT stop" Outlook calendar meeting mail "until PROD-1b.2". Once this is deployed, TL tells the user that it now does, and that Outlook events created on a guarded environment have no attendees when one is unlisted. The A-6 gate in the PROD-1 master doc is marked met. Evidence: the deployment's commit SHA equals the merge commit. No click-through test is asked for. Behaviour is proved by 10.1 and 10.3.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A `PATCH` with no `attendees` key still mails the existing attendees | Intended: step 2 has already confirmed that they are all listed |
| R-2 | A tester expects an attendee on an event made on staging and finds none | `invitations_suppressed` and the `note` in the result, plus the `info` line |
| R-3 | Events from before the guard, with unlisted attendees, cannot be updated or deleted on a guarded environment | Reported (`allowlist_suppressed`, D-9's sync error, `warn` line). Staging only. Production with the list absent is unchanged |
| R-4 | One more Graph call per update or delete on a guarded environment (rate limits) | Only when the guard is on. Production with the list absent makes no extra call (U-1, D-1) |
| R-5 | While the list is on today's Production target (the staging world, PROD-1b SA-E1), a live user's Outlook meeting requests stop reaching unlisted people | Intended, the same trade-off SA approved for E-3 to E-8 (D-4 there). TL's notice (section 11) |
| R-6 | A read 404 is misreported | D-5 test: the result is identical to today's `DELETE` 404 |
| R-7 | Residual gaps in the guard: a check moved away from its write at the same count; a Graph `$batch` body carrying an event path with no leading slash | Unit tests cover behaviour; no `$batch` exists today. D-10 B is available if SA wants the first one closed |
| R-8 | The read-to-write race (D-11) | Accepted; about a second, staging only |
| R-9 | Switching Google's log line to a constant changes its text | It is byte-identical; the Google Calendar suite runs in task 7 |
| R-10 | Guard suite time | The pattern is added to the one-pass scan; it is timed before and after; +1 s CI budget |

---

## 13. Rollback

| Situation | Steps |
|---|---|
| Anything in this slice misbehaves | Revert the single commit. Outlook meeting mail is then unguarded again on guarded environments, so **testers must stay off the staging host until a forward fix lands** (the A-6 gate). No data, migration or env change to undo |
| Only CalendarSyncService misbehaves | Forward fix (D-9 is a few lines). It cannot affect Google, which never returns the flag |
| Env-only response | None that is specific to this slice. Removing the list from Production turns the whole guard off there (PROD-1b section 14), so TL decides |
| Fast path | Vercel Instant Rollback has the same effect as a revert. Never across the production cutover |

---

## 14. Observed, out of scope

| # | Observation | Where | Note |
|---|---|---|---|
| O-1 | **Outlook booking sync does not work today.** CalendarSyncService sends `summary`, `start_time` and `end_time`, but Outlook's schema requires `subject`, `start` and `end`. So `create_event` is refused by the base executor's parameter validation before any Graph call. It also reads `event_id`/`eventId` from the result, while Outlook returns `id`. No Outlook event id is ever stored, so the update and delete paths never reach Outlook either. **So the "booking sync" exposure named in E-9 and in SA condition 8 is latent, not live.** The live exposure is agent workflows calling the Outlook calendar actions with attendees, and the `/test-plugins-v2` harness | `lib/services/CalendarSyncService.ts:128-135`, `:155`; `outlook-plugin-v2.json` `create_event.required` | D-13 (approved: report, do not fix). **Filed** as "O-1 Outlook booking sync parameter bug (ClickUp, under PROD-1)" (SA condition 5), with two constraints: do not merge before PROD-1b.2 is deployed; fix create, update, delete and the event-id field in one change (SA's D-13 correction: update and delete pass validation and are latent only because no Outlook event id is stored). Its test covers the `allowlist_suppressed` path through D-9 |
| O-2 | Google Drive `share_file` sends Google's share-notification email to each address | `lib/server/google-drive-plugin-executor.ts:844`, `:889` | E-10 candidate (3.4, D-12) |
| O-3 | `delete_event` declares `send_cancellation` (default true), which the executor has always ignored, and which Graph v1.0 cannot honour | `outlook-plugin-v2.json`, `outlook-plugin-executor.ts:778-792` | The schema promises something no code does. Unchanged here. Owner of the plugin definition to decide whether to remove it |
| O-4 | The Outlook calendar methods put `event_id` into the path without `encodeURIComponent` (the mail methods encode their ids) | `:764`, `:783`, `:799` | Existing behaviour; the read helper follows the same form so the two cannot disagree. Separate hardening |
| O-5 | `executeSpecificAction` logs the raw step parameters at `debug` ("Executing Outlook action", `params`), which includes recipient and attendee addresses, subjects and bodies. Production logs at `info`, so the line is not emitted there, but it is on everywhere else | `lib/server/outlook-plugin-executor.ts` (the first line of `executeSpecificAction`) | Found while writing P-1, which therefore checks `info` and above only. Pre-existing and not changed here. Candidate for the logger-redaction follow-up |

---

## 15. SA Review Notes

Workplan review: see [SA Review (2026-11-26)](#sa-review-2026-11-26). The code review will be added there.

---

## 16. QA Testing Report

See [QA Report (2026-11-26)](#qa-report-2026-11-26). Verdict: **PASS**.

---

## 17. Commit Info

*(RM to populate.)* Planned: one commit, `fix(email): Outlook calendar meeting mail behind the recipient allow-list (PROD-1b.2)`, with the docs in the same commit or a following `docs:` commit.

---

## SA Review (2026-11-26)

**Reviewed by SA, 2026-11-26. Workplan review only; no code exists yet.**
**Verdict: Approved with conditions.** 5 blocking conditions (1 to 5) and 7 non-blocking ones (6 to 12). Dev may start once conditions 1 to 3 are written into sections 4 and 10. Conditions 4 and 5 must be met before merge.

### How it was checked

Everything was read at `259a7e21`, in this branch's worktree, which is equal to `origin/main`.

| Claim in the plan | Checked against | Result |
|---|---|---|
| Line numbers moved by +24 | `outlook-plugin-executor.ts` | ✅ `createEvent` at `:691` (`POST` at `:725`), `updateEvent` at `:745` (`PATCH` at `:762`), `deleteEvent` at `:778` (`DELETE` at `:781`) |
| 15 Graph call sites | the same file | ✅ 14 `makeGraphRequest(` calls plus 1 `makeGraphRequestWithPrefer` call (`:662`). Neither helper's body is counted |
| An empty list is refused; the check does nothing with the guard off | `lib/email/recipientAllowList.ts` | ✅ With the guard on, 0 recipients means `unparseable_recipient`. With the guard off, the check returns allowed before it reads anything |
| What E-8 does | `google-calendar-plugin-executor.ts` `:193-200`, `:262-272`, `:373-396`, `:447-451` | ✅ As stated. Update checks the existing and the new attendees together (CR-1) |
| How G-7 counts | the guard file `:129-153`, `:167-200`, `:265-272`, `:484-497` | ✅ It counts matches, not lines, and comments count. The Outlook pin is 2 / 1, with a reason ending in "PENDING" |
| Existing Outlook smoke tests stay green unchanged | `tests/plugins/unit-tests/outlook.test.ts` `:28-40`, `:217-248`; `mock-fetch.ts` | ❌ **Not true under the plan's own rules.** See condition 2 |
| O-1: Outlook booking sync never reaches Graph | `CalendarSyncService.ts`; `plugin-manager-v2.ts` `validateParametersAgainstSchema`; `outlook-plugin-v2.json`; the writers of `external_calendar_event_id` | ✅ Confirmed, with one nuance. See the D-13 ruling |
| O-2: Drive `share_file` lets Google email each address | `google-drive-plugin-executor.ts` `:844-923`; `google-drive-plugin-v2.json` | ✅ Confirmed. See the D-12 ruling |
| Callers can take a sync `success: false` | `settleSessionDiaryEntry.ts`, `syncBookingCalendar.ts`, `BookingLifecycleService.ts`, `bookings/[id]/route.ts` | ✅ Each one logs a `warn` and goes on. None retries and none throws |

### Ruling per decision

| # | Ruling | Reason |
|---|---|---|
| D-1 | **Approve B** (remove every attendee and still write the event) | It fails closed: an event with no attendees gets no invitation. It keeps PROD-1b's D-2 rule for the mail (everyone or no one) and E-8's rule for the write (the event is still made). The executor sends only `location.displayName`, never a room's email address, so no resource mailbox gets mail either |
| D-2 | **Approve** (no `PATCH`) | It is the only option that emails nobody. Condition 1 widens what counts as "refused" |
| D-3 | **Approve A**, changed by condition 3 for the empty-body case | When a change is made, the people who get the update are exactly the existing attendees, and step 2 has already cleared them |
| D-4 | **Approve** (no `DELETE`) | Graph has no way to delete a meeting silently. Leaving the event in place is reported, not hidden |
| D-5 | **Approve** (throw; no write) | Both a 404 on the read and a 404 on `DELETE` become `not_found`, so the result is the same. A side note: CalendarSyncService's "already deleted" test (`:326`) looks for `event_not_found` or a message that contains `404`. Outlook's mapped message has neither, so an Outlook 404 is reported as a failure, today and after this change. That is unchanged and outside this slice |
| D-6 | **Approve** (the organizer counts as notifiable when `isOrganizer` is not `true`), made stricter by condition 1 | Graph does not document this case, so it fails closed |
| D-7 | **Approve** (two flags), together with condition 3 | `allowlist_suppressed` keeps the meaning `gaps/reply` already depends on: nothing happened |
| D-8 | **Approve** | Each meaning gets one log line across both providers. Adding string constants does not break the module's "pure, no logger" promise. The Google text stays byte-identical, and the Google G-7 counts do not change |
| D-9 | **Approve** | It is small and works for any provider. Google never sets the flag. Every caller already handles `success: false` (see the table above). Without it, fixing O-1 later would give a silent false "synced" |
| D-10 | **Approve A** (pinned counts) | This is G-7's existing model. The residual (a check moved away from its write, with the count unchanged) was already accepted for PROD-1b, and the unit tests cover it |
| D-11 | **Approve** (accept the race) | It is about one second, on guarded environments only, and needs a person to add a refused attendee by hand inside that second. An `If-Match` header that cannot be verified could break every guarded update |
| D-12 | **Approve A: a separate slice, PROD-1b.3, with the same gate.** Not folded into this PR. Condition 4 applies | Details below |
| D-13 | **Approve: report it, do not fix it here.** The claim is confirmed with one correction. Condition 5 applies | Details below |

**D-12 in detail.** The claim is right. Inside `shareFile`, the `user` and `group` branch (`:878-904`) sends `POST …/drive/v3/files/{id}/permissions` once per address, with no `sendNotificationEmail` parameter. Google's `permissions.create` reference says that parameter defaults to true for users and groups. So Google emails every address. The `anyone` and `domain` branch (`:930`) cannot take the parameter and notifies nobody. The definition's `role` enum is `reader`, `commenter` and `writer`, and the constraint guard replaces any value outside the enum. So there is no ownership transfer, and Google allows `sendNotificationEmail=false` on every call this branch makes. No G-7 pattern matches this call. I also searched the other executors for share, invite and collaborator endpoints. Dropbox `create_shared_link` and OneDrive `createLink` email nobody. I found no other such send.

It goes in a **separate slice**, not this PR, for two reasons. It is a different provider, plugin and G-7 pattern. It also has design questions this plan has not answered, which would make this PR two goals:
- (a) refuse the whole list or suppress the notification, which should match E-8;
- (b) Drive is known to reject a silent share to an address that has no Google account, because it must send the invitation to give such a person access. PROD-1b.3 must check this and decide how the refusal is reported;
- (c) the existing error log and the thrown error at `:899-901` put the address in the message text. PROD-1b's rule is counts only;
- (d) the loop can leave earlier permissions in place when a later one fails.

The gate is the same: before A-6.

**D-13 in detail.** Confirmed:
- `create_event` requires `subject`, `start` and `end`. The sync sends `summary`, `start_time` and `end_time`. `validateParametersAgainstSchema` returns "Missing required parameter" before any connection is resolved, so Graph is never called, and the failure is stored in `calendar_sync_error`.
- If the create did pass, `:155` reads `event_id` or `eventId`, but Outlook returns `id`, so no id would be stored anyway.
- The only code that writes an id onto an Outlook-provider row is that create. `SchedulingRepository.ts:2008` only copies an id the booking already has.
- So the Outlook update and delete always stop at "No calendar event linked".

**The correction:** `update_event` and `delete_event` require only `event_id`, so they *would* pass validation. They are latent only because no Outlook event id exists. A fix that repairs create alone would make every later sync update `PATCH` only `attendees`, because the executor ignores the three Google names. In production that emails the client an invitation and does not move the time. So the O-1 fix must be one change that covers all three actions and the id field. It lands after PROD-1b.2 is deployed.

Turning on Outlook booking mail in production is the intended product behaviour, and Google sync does it today. That makes it a product decision, so reporting it is the right call.

### Conditions

1. **(blocking) The read fails closed on its shape, not only on each address.** The read helper's result is typed: start from `unknown` and narrow it, no new `any` (rule 6).
   - If `attendees` is missing or is not an array, it counts as one unparseable recipient (`''`), not as "no attendees".
   - If `isOrganizer` is anything other than exactly `true`, the organizer goes into the set, and a missing organizer address becomes `''`.
   - Add tests: a read body of `{}` gives no `PATCH` on update and no `DELETE` on delete. A body with `isOrganizer: true` and no `attendees` key is refused.
   - Why: `makeGraphRequest` returns `{}` for a 204, and an unexpected or empty body must never mean "nobody to email".
2. **(blocking) Fix the existing smoke fixtures, not the rule.** Section 7 says the existing `update_event` and `delete_event` smoke cases stay green unchanged. They do not. The guard is on under Jest. The update smoke answers every call with one body that has no `isOrganizer`, and the delete smoke answers with `{}` and status 204. Under D-6, and under condition 1, both reads are refused, so no write happens and both tests fail. Change both fixtures to `mockFetchSequence`: a realistic read (`isOrganizer: true`, `attendees: []`), then the write's response. Assert the `GET` and then the write. Never weaken a fail-closed rule to keep an old fixture passing. Record this in 10.1 and in section 7's `outlook.test.ts` row.
3. **(blocking) An update that changes nothing was not done.** In 4.3 step 4, the requested change was only the attendee change, and it was refused. So the result is `allowlist_suppressed: true` with `status: 'not_updated'` and the `warn` line, not `invitations_suppressed`. `invitations_suppressed` is set only when some other field was actually changed. Update 4.3 step 4, the 4.5 table and U-8. With D-9, a sync that moved nothing then records an error instead of "synced".
4. **(blocking, before merge) Record E-10 and correct the user notice.** In this PR's change to the PROD-1b workplan:
   - add an E-10 row to section 3.2 (Drive share notifications, PROD-1b.3, gate before A-6);
   - make the section 12 step 5 A-6 gate name both PROD-1b.2 and PROD-1b.3;
   - add a note to the E-9 row that the booking-sync exposure is latent (O-1).

   The step 1b notice (PROD-1b SA condition 8) told the user that Outlook calendar mail was the only path the list does not stop. That is now incomplete. TL tells the user **now**, not after deploy, that Drive share notifications are a second such path until PROD-1b.3.
5. **(blocking, before merge) Track O-1 so it cannot land first.** TL records O-1 as a tracked bug with two constraints: "do not merge before PROD-1b.2 is deployed", and "fix create, update, delete and the event-id field in one change" (see the D-13 correction). Its test must include the `allowlist_suppressed` path through D-9.
6. (non-blocking) Correct the text in 4.1. The base executor's 401 refresh-and-retry never runs for Outlook. `makeGraphRequest` throws `auth_failed` with no status, and `httpStatusOf` finds no status in it. The design does not need to change: if a retry ever happens, it reruns the whole `executeSpecificAction`, so the read and the write stay together.
7. (non-blocking) Add negative checks to 10.3. (f) Leave the organizer out of the set: U-7 goes red. (g) Treat a missing `attendees` key as empty: the condition 1 test goes red.
8. (non-blocking) G-7 patterns. In both new patterns, the "single path segment" cannot contain a slash, whitespace or a quote, so a template id counts as one segment. Add these to the "not caught" self-tests: `/me/messages/${id}/createReply` (the draft at `:475`), and `/me/messages/${id}/replyAll` for the new reply pattern. `replyAll` is already caught by its own pattern, so this checks it is counted once and not twice.
9. (non-blocking) Comments count toward G-7. Write the new `send_email` comment and the method comments without a Graph calendar path in them, or pin the extra hits and give the reason, as PROD-1b did for `:62`.
10. (non-blocking) CalendarSyncService test: mock every module it loads at import, meaning the five repository modules and `plugin-executer-v2`. No Supabase client is created and nothing reaches the network.
11. (non-blocking) When the PROD-1b.3 workplan is written, it answers D-12 points (a) to (d). Its inventory search also covers provider-side notifications (`permissions`, `sendNotificationEmail`, `invite`, `collaborat`, `notify`) across every executor, not only the email terms.
12. (non-blocking) Section 3.4: add that `:930` (`anyone` and `domain`) notifies nobody, so that readers know why only the `:889` branch is in scope.

### Environment changes

None proposed (section 11), and I agree. No new variable is read, the existing `Calendars.ReadWrite` scope already covers the read (`list_events` and `get_event_details` read the same resource today), and nothing outside the code changes. The work after deploy is a notice and an evidence check, not a change to any setting.

### Approval

[x] Workplan approved with conditions 1 to 5 (blocking): proceed to implementation once 1 to 3 are written into the plan.

---

## SA Code Review (2026-11-26)

**Reviewed by SA, 2026-11-26.** Working tree against `259a7e21`, nothing committed: 7 tracked files plus the 2 new ones.
**Verdict: APPROVED. Code Approved for QA.** No blocking finding. Findings 1 to 4 below are non-blocking.

### How it was checked

- The diff was read in full: the executor, CalendarSyncService, the allow-list constants, Google Calendar, the G-7 suite, the Outlook tests, the new CalendarSync test and the PROD-1b workplan.
- SA re-ran the Outlook, CalendarSync, G-7 and Google Calendar suites: **4 suites, 188 / 188 pass.**
- The G-7 pins were recounted by hand:
  - **Dispatch 9.** `sendMail` 2, then the calendar-path lines: list 2 (`/me/calendars/${…}` and `/me/calendar` on one line), create, the read helper, update, delete and details.
  - **Checks 7.** Send 1, create 1, update 3 (the guard test plus two checks), delete 2 (the guard test plus one check).
- The new calendar-path pattern was grepped over the deployed scope. It matches **only** the Outlook executor.

### The conditions, against the code

| # | Condition | Result |
|---|---|---|
| 1 | The read fails closed on its shape | ✅ `notifiableOf` (`outlook-plugin-executor.ts:63-67`) starts from `unknown`. A missing or non-array `attendees` gives `['']`. When `isOrganizer` is not exactly `true`, the organizer is added, and a missing address gives `''`. A body of `{}` gives `['', '']`, which is refused. The body is narrowed with `asRecord` and type guards, and adds no `any`. Covered by tests U-10, U-11, D-8 and D-9, and by negative check (g). Also checked by hand: an `event_id` that carries its own `?$select=…` makes the read return less, which the shape rule refuses. An array body, or `null`, is refused the same way |
| 2 | Fix the smoke fixtures, not the rule | ✅ Both fixtures moved to `mockFetchSequence`. Each has a realistic read (`isOrganizer: true`, `attendees: []`), then the write's response. Each test asserts 2 calls, a `GET` first, then the `PATCH` or `DELETE`. The executor's rule is not loosened |
| 3 | An update that changes nothing was not done | ✅ The executor drops `attendees`, and if nothing else is left (`:889-892`), it returns `not_updated` with `allowlist_suppressed` and the `warn` line, and does not set `invitations_suppressed`. Tested by U-8 |
| 4 | E-10 and the user notice in PROD-1b | ✅ The PROD-1b workplan now has: the latent note on the E-9 row, a new E-10 row, a step 1b notice naming PROD-1b.3, an A-6 gate naming both slices, the flipped "Pending (D-4)" row, a section 15 row and a Change History row. **Still owed by TL:** telling the user now about Drive. That cannot be checked in code |
| 5 | O-1 tracked so it cannot land first | ✅ Recorded as filed, with both constraints, in section 14 and on the PROD-1b E-9 row. The tracker item is TL's |
| 6 | 4.1 retry text | ✅ Corrected |
| 7 | Negative checks (f) and (g) | ✅ In 10.3. Dev reports 7 / 7 red, with the tree restored byte-exact |
| 8 | Pattern segment and lookalikes | ✅ The segment cannot hold a slash, whitespace, a quote or a backtick (described in words here: the docs folder is scanned by Tailwind). `createReply`, `replyAll` (counted once), Google's two calendar paths, the audit-events import and `gaps/reply` are all in the self-tests, in LF and CRLF forms |
| 9 | Comments do not add G-7 hits | ✅ The new `send_email` comment and the method comments name no Graph path. The pin needs no comment allowance beyond the existing `sendMail` one |
| 10 | CalendarSync test mocks every import | ✅ The test mocks `plugin-executer-v2` and every repository module the service imports. **Correction to condition 10:** there are **four** repository modules, not five. Dev mocked all four. `externalEventBlocksTime` and the logger stay real; neither reaches the network |
| 11 | PROD-1b.3 answers D-12 (a) to (d) | ⬜ Applies when that workplan is written |
| 12 | Section 3.4 explains `:930` | ✅ |

**Item (9) in the brief: CalendarSyncService.**
- **Update** (`CalendarSyncService.ts:281-290`). The suppressed check runs after the `!result.success` branch. It writes only `calendar_sync_error`, on the meeting row when a `meeting` is given and otherwise on the booking. It never writes `calendar_synced_at`, and returns `{ success: false }`.
- **Delete** (`:363-371`). The check is gated on `result.success`, so the existing "already deleted" path is untouched. It keeps the event id (no `clearCalendarSync`, no meeting clear), writes the error, and returns `{ success: false }`.
- `result.data` is the executor's return value, because the base executor wraps it as `data: result` (`base-plugin-executor.ts:275`). So the flag is seen.
- Google never sets the flag, and the ordinary-success test proves that path is unchanged.

**Fail-closed audit, every error path in the three actions:**
- A non-2xx read throws through the existing mapping.
- A network failure, or a 200 body that is not JSON, throws from `fetch` or `response.json()`.
- A body of `{}`, `null` or an array is refused by the shape rule.
- An `attendees` value that is not an array throws at `.map` before any Graph call (update: before the read; create: before the `POST`).
- Each of these ends in the base executor's error result, with no write.
- Production with the list unset makes no read and no check, so its calls are as today (U-1, D-1, C-6).

**CLAUDE.md:**
- No new `any` in production code. The only `any` in the new tests is `let executor: any`, which follows the existing suite's convention.
- Pino only: the touched files have 0 `console.*`.
- Every new `info` and `warn` line carries `refusalLogFields` counts, or ids only. P-1 checks this by searching every `info`, `warn` and `error` call for the fixture addresses, subject and body.
- No network in the tests: `fetch` is mocked, the repositories are mocked, and `jest-no-network` is the backstop.

### Findings

1. **(Low, non-blocking) Use the shared constant for the sync's `warn` lines.** `lib/services/CalendarSyncService.ts:283` and `:364` log two new literals ("Calendar event not updated / not deleted: …"). D-8's point was that one search per meaning covers every layer. Suggested fix: log `CALENDAR_CHANGE_REFUSED_MESSAGE` from `@/lib/email/recipientAllowList`, and put the action in a field, e.g. `{ …, action: 'update_event' }`. Optional. Do it in this PR only if it costs no re-review round.
2. **(Low, non-blocking) Test that only a real `true` counts.** No test uses an `isOrganizer` that is truthy but not `true` (for example the string `'true'`). The code is right (`!== true`, `:66`), but no test would catch a change to `!body.isOrganizer`. Suggested: one more U-case with `isOrganizer: 'true'` and an unlisted organizer, expecting no `PATCH`.
3. **(Info) Two notes for QA.**
   - Task 7 in section 9 is still ⬜. The Dev part of it is done, as 10.4 shows. The rest is QA's: `npm run build`, and `test:gate` diffed against `259a7e21`.
   - The guard suite's CI time is owed on the PR (PROD-1b SA condition 13: under +1 s). It took about 23 s locally under load, which is not a timing figure.
4. **(Info) Behaviour to put in TL's after-deploy notice (section 11).** When the user is not the organizer, a guarded update or delete is refused unless the organizer is listed (D-6). A tester who edits their copy of someone else's meeting on staging sees `not_updated` / `not_deleted`. This is intended.

### Rulings on the two deviations

| Deviation | Ruling | Reason |
|---|---|---|
| The Outlook check count is 7, not 6 | **Accepted.** | Update calls the check twice, once for the existing attendees and once for the new ones, and each call is inline at its decision. That is the G-7 model (PROD-1b code review item 2): removing either call changes the pin. The plan's 6 was a counting slip, not a design change. Section 5 and the registry reason both state 7 and break it down |
| O-5: the raw parameters are logged at `debug` and not changed; P-1 checks `info` and above only | **Accepted. File it; do not fix it here.** | It is pre-existing and not caused by this slice. It is a class, not one line: 8 files log the step parameters at `debug`, including `base-plugin-executor.ts` and the Gmail executor, so changing Outlook alone would not stop it. Vercel deployments run with `NODE_ENV=production`, so the default level is `info` and the line is emitted only where `LOG_LEVEL=debug` is set, or locally. A fix belongs in the logger-redaction follow-up, as one change across all 8 files. Folding it in would make this PR two goals. **Condition for TL (not blocking this PR):** file O-5 as a tracked item naming all 8 executors, and have DO confirm, as a read-only check of names and values with no change, that `LOG_LEVEL` is not `debug` on the guarded targets |

### Code Approved for QA: Yes

---

## QA Report (2026-11-26)

**QA, 2026-11-26 (the runs finished after midnight, 2026-11-27).** Working tree against `259a7e21`, nothing committed. No app code was changed by QA.
**Test mode:** full. **Strategy:** A (Jest unit and source-guard suites), plus the full Jest gate diffed against base, `npm run build`, and mutation checks. **Focus:** api, security, schema (G-7). **Skipped:** D (manual browser check), because the app is parked and there is no UI in this slice. **Input source:** prompt brief and section 10.

**Verdict: PASS.** No new gate failure caused by this slice, the build succeeds, every section 10 case exists and asserts what it claims, and the negative checks QA reproduced all go red. One Low test gap (SA finding 2) is confirmed by mutation and is non-blocking.

### 1. Full Jest gate, diffed against base

How it was run: `jest --config jest.gate.config.js --ci` (the `test:gate` script that `tests.yml` runs), with `--json`, 3 workers, on the branch worktree. The same command ran on a clean copy of `259a7e21` made with `git archive` and extracted into a scratch folder, with a junction to the shared `node_modules`. Nothing was installed. The two runs ran at the same time on a machine at 100% CPU. Failures were compared per test (suite path plus full test name) from the JSON, so the duplicate FAIL lines in the console do not count twice.

| | Suites | Failed suites | Tests | Failed tests |
|---|---|---|---|---|
| Base `259a7e21` | 2,125 | 26 | 52,566 | 38 |
| Branch | 2,126 | 22 | 52,615 | 32 |

- **+1 suite, +49 tests:** the new CalendarSync suite (4), 28 new Outlook cases, and 17 new G-7 self-tests. 4 + 28 + 17 = 49.
- **New on the branch: 1 test, not caused by this slice.** `components/business-os/settings/__tests__/PlanUpgrade.render.test.tsx`, "3-D Secure in place … G-1 / Q-2", failed with `Exceeded timeout of 5000 ms`. Re-run alone on the branch twice: **76 / 76 pass both times.** `jest --findRelatedTests` on the four touched source files does not list it, so it cannot reach any changed file. It is a load timeout.
- **Failing on base only: 5 suites.** These are artefacts of the archive copy, which has no `.git` and runs from a temp folder (the Tailwind tracked-file guard, the SECURITY DEFINER tripwire, the G8 fixture, the no-network guard, and the data-export importer scan). None of them is touched, and all five pass on the branch worktree.
- The other 21 failing suites fail on both sides: the known Windows checkout failures (CRLF and path separators).

### 2. `npm run build`

Run with the same stub environment and `NODE_OPTIONS=--max-old-space-size=6144` that `build.yml` uses.

- **Exit 0** in 12 m 49 s on the loaded machine: `Compiled successfully`, 332 / 332 static pages, `.next/BUILD_ID` written, full route table printed.
- **Not an OOM crash:** 0 hits for `heap out of memory`, `FATAL ERROR`, `Allocation failed` or a V8 trace in the 809-line log.
- The only warnings are the Supabase Edge Runtime warnings via `lib/security/onboardingVerdict.ts`, which come from `main`. No touched file is named anywhere in the log.
- `next build` logs "Skipping validation of types" (`next.config.js`). The typecheck of the touched files is Dev's result in 10.4 (0 diagnostics, no OOM), and QA did not re-run it.

### 3. Test plan: each case exists and covers what it claims

Every row of 10.1 and 10.2 was read against the test source.

| Group | Cases | Present | Covers the claim | Notes |
|---|---|---|---|---|
| Create | C-1 to C-7 | ✅ | ✅ | C-2 asserts no `attendees` key in the POST body, `invitations_suppressed`, no `allowlist_suppressed`, and the `info` line's counts (2 / 1) |
| Update | U-1 to U-11 (U-9 runs for 404 and 500) | ✅ | ✅ | Every refusal case gives a second canned response, so a stray `PATCH` would show up in `methods()` and fail the test |
| Delete | D-1 to D-9 | ✅ | ✅ | D-5 compares the guarded 404 result with the unguarded `DELETE` 404 result directly (`toEqual`) |
| Smoke | S-1 | ✅ | ✅ | Both fixtures moved to `mockFetchSequence`; each asserts 2 calls, the `GET` first, then the write. The rule is not loosened |
| Logs | P-1 | ✅ | ✅ | `expectNothingPersonalLogged` runs in C-2, U-2, U-4 and D-4 |
| CalendarSync | 10.2, 4 cases | ✅ | ✅ | The update case asserts exactly one `updateCalendarSync` call with `{ calendar_sync_error }` only, so `calendar_synced_at` is not written. The delete cases assert no `clearCalendarSync`. The package-session case asserts the meeting row is written and the booking row is not |
| G-7 | pin 9 / 7, no-`PENDING`, prefilter, LF and CRLF self-tests, the condition 8 lookalikes | ✅ | ✅ | The "caught" forms assert exactly 1 hit each, in both line-ending forms |

The env is restored after every test: file-level `beforeEach` sets the list and `afterEach` restores `process.env`. `asProduction()` cannot leak into another test.

### 4. Happy and failure paths per action

| Action | Allowed attendee goes through | Refused attendee | Unreadable read | Read error |
|---|---|---|---|---|
| Create | C-1 (attendees kept), C-5, C-6 | C-2, C-3, C-7 (stripped, event still written) | n/a: create does not read. The fail-closed case is C-4 (an attendee that is not a string) | n/a |
| Update | U-3 (`GET` then `PATCH` with attendees), S-1 | U-4, U-5, U-7 (no `PATCH`); U-2, U-8 (attendee change dropped) | U-6, U-10, U-11 | U-9 (404, 500) |
| Delete | D-2, D-3, S-1 | D-4, D-7 | D-8, D-9 | D-5 (404), D-6 (500) |
| CalendarSyncService | ordinary-success case (synced; id cleared on delete) | the suppressed update, delete and package-session cases | n/a | n/a |

### 5. Negative checks reproduced by QA

A script applied each mutation, ran the named tests with `-t`, and wrote the original bytes back in a `finally`. The sha256 of each mutated file and of `git diff` was taken before and after.

| # | Mutation | Expected | Result |
|---|---|---|---|
| 10.3 (a) | `createEvent`: the `checkOutboundRecipients(` call replaced with an always-allowed verdict | G-7 red | ✅ **Red.** G-7: 1 failed (the check pin). Also C-2: 1 failed |
| 10.3 (e) | `deleteEvent`: the guarded branch skipped (`if (false && isRecipientGuardOn())`), so no read | D-4 red | ✅ **Red.** D-4: 1 failed |
| QA-x (extra) | CalendarSyncService delete: the `allowlist_suppressed` branch disabled | the 10.2 delete case red | ✅ **Red.** 1 failed |
| QA-o (extra, SA finding 2) | `notifiableOf`: the strict `isOrganizer` test loosened to a truthiness test | — | ⚠️ **Survives.** All 28 PROD-1b.2 cases pass. This confirms SA finding 2 (below) |

**Restore:** `outlook-plugin-executor.ts` sha256 `50e6e5fe…8dd6` and `CalendarSyncService.ts` sha256 `e4293ec8…af87` were the same before and after every run. The `git diff` hash was identical before and after, and `git status` shows the same 7 modified and 2 new files.

### 6. CI time: the environment-hardening guard suite

`lib/__tests__/envConfigHardening.guard.test.ts`, run alone, alternating base (the archive copy) and branch, after one warm-up run each, on a machine at 100% CPU.

| Measure | Base (70 tests) | Branch (87 tests) | Difference |
|---|---|---|---|
| Jest `Time:`, 4 runs each | 13.05, 11.87, 12.37, 13.91 s (mean 12.80) | 11.99, 13.06, 12.91, 14.22 s (mean 13.04) | +0.24 s |
| Suite start to end from `--json`, 3 runs each | 14.31, 12.08, 11.08 s (mean 12.49) | 12.49, 12.49, 8.48 s (mean 11.15) | −1.34 s |
| Sum of test bodies, 3 runs each | 247 to 320 ms | 213 to 369 ms | about +0 to +50 ms |

**No measurable increase.** Both measures are inside the run-to-run noise, which is about ±2 s on this machine, and the test bodies (the 17 new self-tests) add tens of milliseconds. Within the **+1 s budget** locally. The CI figure, on an unloaded Linux runner, is still read from the PR's run (PROD-1b SA condition 13).

### Issues found

#### Bugs (must fix before commit)

None.

#### Performance issues

None.

#### Edge cases (nice to fix)

1. **No test pins the strict `isOrganizer === true` rule (confirms SA finding 2).** Severity: Low. File: `tests/plugins/unit-tests/outlook.test.ts`.
   - Steps: change `body.isOrganizer !== true` in `notifiableOf` to `!body.isOrganizer`, then run the PROD-1b.2 describe.
   - Expected: a test goes red.
   - Actual: 28 / 28 pass.
   - Today's code is correct. A future loosening would let an event whose `isOrganizer` is a truthy non-boolean skip the organizer. Fix: one U-case (and optionally a D-case) with `isOrganizer: 'true'` and an unlisted organizer, expecting no write.
2. **(Info) Create with a non-array `attendees`** (for example a single string) skips the check and then throws at `.map` before the `POST`. The result is an error and nothing is sent, so it fails closed by accident. This is pre-existing and is already in SA's fail-closed audit. No action.

### Final status

- [x] All acceptance criteria pass, ready for commit (once the user has seen the diff). The only open item is the CI timing read on the PR.
- [ ] Issues found: Dev must address before commit

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-26 | Workplan created | Dev: E-9 line numbers re-verified (+24 lines since #678's base); inventory of the 15 Graph call sites (1 guarded, 3 in scope, 2 drafts, 2 message writes, 7 reads); the create-strip / update-read / delete-read design on the existing switch and check; G-7 Graph calendar and message-send patterns with the Outlook pin flipped; decisions D-1 to D-13 for SA; two findings outside scope (O-1, the Outlook booking sync parameter mismatch; O-2, the Google Drive share notification, an E-10 candidate) |
| 2026-11-26 | SA workplan review | Approved with conditions. 5 blocking: the read fails closed on its shape; fix the update and delete smoke fixtures, not the rule; a no-change update is `allowlist_suppressed`; E-10 and the corrected user notice recorded in PROD-1b; O-1 tracked so it cannot land before this slice. 7 non-blocking. D-1 to D-13 all approved (D-3, D-6 and D-7 together with conditions 1 and 3). D-12: a separate slice, PROD-1b.3, with the same gate. D-13: confirmed, with the correction that update and delete pass validation and are latent only because no Outlook event id is ever stored |
| 2026-11-26 | Conditions folded in; implemented | Dev: conditions 1 to 3 written into 4.1, 4.3, 4.5, 7 and 10.1 before code (shape-fail-closed read from `unknown`; smoke fixtures moved to `mockFetchSequence`; a no-change update is `allowlist_suppressed`). Implemented E-9a/b/c, the two calendar log constants (Google switched, text identical), CalendarSyncService D-9, G-7 patterns and prefilter with the Outlook pin at 9 / 7 (checks one higher than planned: update calls the check twice), the no-`PENDING` and prefilter self-tests, and conditions 6 to 12. PROD-1b workplan updated (condition 4). O-1 recorded as filed (condition 5). Negative checks a to g all red, tree restored byte-exact. Results in 10.3 and 10.4. New observation O-5 (pre-existing debug dump of parameters) |
| 2026-11-26 | SA code review | APPROVED, Code Approved for QA. Conditions 1 to 10 and 12 verified in the code (11 applies to PROD-1b.3). SA re-ran the Outlook, CalendarSync, G-7 and Google Calendar suites: 188 / 188 pass. G-7 pins 9 / 7 recounted by hand. Every error path fails closed. Deviations: the check count of 7 is accepted; O-5 is accepted as "file it, do not fix here" (a class across 8 executors; TL files it, and DO confirms that `LOG_LEVEL` is not `debug` on the guarded targets). 4 non-blocking findings: the shared constant for the sync's `warn` lines, an `isOrganizer: 'true'` test, notes for QA, and the D-6 behaviour for TL's notice. Condition 10 corrected: four repository modules, not five |
| 2026-11-26 | QA report | QA: **PASS.** Full Jest gate diffed per test against a clean `259a7e21` copy: +1 suite, +49 tests, and no new failure caused by this slice. The one branch-only failure (a `PlanUpgrade.render` 5 s timeout under load) passes alone twice and does not depend on any touched file. `npm run build` exit 0 with no OOM. Every 10.1 and 10.2 case was checked against its assertions. Negative checks (a) and (e), plus an extra CalendarSync mutation, all red, with sha256 restore verified. A mutation of the strict `isOrganizer` rule survives, which confirms SA finding 2 (Low, non-blocking). Guard suite time shows no measurable change locally (+0.24 s and −1.34 s on two measures, both within noise); the CI figure is read on the PR |
| 2026-11-27 | SA code review findings 1 and 2 applied | Dev: CalendarSyncService's two `warn` lines log `CALENDAR_CHANGE_REFUSED_MESSAGE` with `action: 'update_event'` / `'delete_event'` (finding 1; no test asserted the old strings). U-12 and D-10 added: `isOrganizer: 'true'` (a string) with an unlisted organizer gives no `PATCH` / `DELETE` (finding 2). Under the loosening `!body.isOrganizer` both went red (2 failed); the executor was restored byte-exact and both went green. Rerun: Outlook 61 / 61, CalendarSync 4 / 4, guard 87 / 87, Google Calendar 38 / 38. Task 7 ticked |
