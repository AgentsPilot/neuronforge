# Workplan: DL-2 — Deletion drawer, Keep my account, and the pending state

> **Last Updated**: 2026-11-26

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §3.3, §3.4, §4, §5 "Side by side", §6.3 DL-2 row, "DL-1b as built" and "DL-2 copy" notes, §7 "DL-2", §9 (BQ-20, BQ-32, BQ-35, BQ-39 answered 2026-11-06), §10 XC-5, XC-6, §11 S-4, S-5, S-7, SR-9, SR-10
**Builds on:** [BUSINESS_OS_DELETION_DL1B_WORKPLAN.md](/docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md) (DL-1b / D6, merged as PR #631, `ed5bb1c5`); [BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md](/docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md) (SX-2, `planEndingView` and the reason picker)
**Coordination:** `C:/Users/Barak/My Projects/AgentsPilot/SELF_SERVICE_EXIT_COORDINATION.md` (outside the repo, not in git). One DL-2 row per slice is needed before code (§11)
**Branch:** `feature/bos-deletion-dl2-drawer-keep` (worktree `neuronforge-dl2`, from `origin/main` `f594ba22`). DL-2b and DL-2c each get their own branch from `main` at their kickoff (RM), never stacked. **DL-2b:** `feature/bos-deletion-dl2b-timeline-bookings` (worktree `neuronforge-dl2b`, from `origin/main` `259a7e21`)
**Date:** 2026-11-06
**Status:** DL-2a merged (#681). DL-2b Code Complete (2026-11-26; awaiting SA code review, user approval of the §9.2 copy including the W-13 trial line IN-26, and a native he / es check). DL-2c: Planning

## Overview

DL-1b turned `POST /api/business-os/account/delete` into the deletion **request** and added `POST /api/business-os/account/keep`, with no UI. The drawer was not changed: it still posts `{ statement, language }` and still expects the old "account deleted, here is a redirect" answer. The user has `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` on in production while testing, so the drawer is live and every Delete press now fails validation (400 `invalid_body`, shown as "Your account was not deleted"). Nothing is harmed, but nothing works, and there is no way to Keep.

DL-2 builds the owner's side of the lifecycle in three small slices. **DL-2a** makes the request and Keep work again: the reason picker, the new body, every new answer and refusal, a pending view with **Keep my account** in Settings, and the plan page's reactivate refusal line. **DL-2b** adds "What happens": the dates for paid, free and Founding Partner accounts in the owner's timezone, and the future-bookings count (BQ-39). **DL-2c** makes the pending state visible everywhere: the banner on every Business OS page, the plan card wording, the checkout, Boost and upgrade lines, the re-worded `/account-deleted` page and the re-worded privacy paragraph. No migration in any slice. No email (DL-3 sends them).

---

## Table of Contents

1. [Analysis summary (as-is on origin/main f594ba22)](#1-analysis-summary-as-is-on-originmain-f594ba22)
2. [Slice split and estimates](#2-slice-split-and-estimates)
3. [Scope](#3-scope)
4. [Decisions and their reasons](#4-decisions-and-their-reasons)
5. [DL-2a design: request and Keep work again](#5-dl-2a-design-request-and-keep-work-again)
6. [DL-2b design: what happens, dates and bookings](#6-dl-2b-design-what-happens-dates-and-bookings)
7. [DL-2c design: the pending state everywhere](#7-dl-2c-design-the-pending-state-everywhere)
8. [Accessibility, keyboard and right-to-left](#8-accessibility-keyboard-and-right-to-left)
9. [Copy: reused keys and proposed new lines (user approval)](#9-copy-reused-keys-and-proposed-new-lines-user-approval)
10. [Files to create / modify, per slice](#10-files-to-create--modify-per-slice)
11. [Coordination block (for TL to paste)](#11-coordination-block-for-tl-to-paste)
12. [Test plan (one-to-one with §7 DL-2)](#12-test-plan-one-to-one-with-7-dl-2)
13. [Task list](#13-task-list)
14. [Risks and dependencies](#14-risks-and-dependencies)
15. [Open questions with suggested answers](#15-open-questions-with-suggested-answers)
16. [Hand-overs from DL-1b, closed here](#16-hand-overs-from-dl-1b-closed-here)
17. [User Decisions](#user-decisions)
18. [Implementation notes (DL-2a)](#implementation-notes-dl-2a) · [Implementation notes (DL-2b)](#implementation-notes-dl-2b)
19. [SA Review Notes](#sa-review-notes)
20. [QA Testing Report](#qa-testing-report)
21. [Commit Info](#commit-info)
22. [Change History](#change-history)

---

## 1. Analysis summary (as-is on origin/main f594ba22)

| Area | Finding | Evidence |
|---|---|---|
| Request route | `{ statement, language, reasonCode }` `.strict()`, `reasonCode: z.enum(PLAN_LEAVE_REASON_CODES)` required. 200 answers `{ status: 'pending', planEndsOn, renewalWasOn }` or `{ status: 'grace', lockAt, lockTimezone }`. Refusals: 404 `not_found` (switch off), 401, 413 `body_too_large`, 400 `invalid_body` / `statement_mismatch`, 429, 409 `already_requested` (`data.status`, may be `null`, CR-6) / `blocked` (`blockers`) / `plan_change_pending` / `plan_state_changed`, 503 `not_available` / `try_again` (P-8 adds `data.status: 'requesting'`), 502 `stripe_error` (± `outcomeUnknown`), 500 `request_failed` | `app/api/business-os/account/delete/route.ts`; `lib/business-os/account-deletion/schemas.ts` (`accountDeleteBodySchema`, `accountDeleteResponseDataSchema`); `closureRequest.ts` `CLOSURE_REQUEST_REFUSAL_STATUS` |
| Keep route | Body `{}` `.strict()`, not behind the switch. 200 `{ kept: true, from: 'pending' or 'grace', renewal: restored / not_needed / not_restored_by_choice / failed / unknown, code?, planEndsOn? }`. 409 `nothing_to_keep` / `request_in_progress` / `locked` / `state_changed` (`data.status`), 503 `try_again`, 500 | `app/api/business-os/account/keep/route.ts`; `closureKeep.ts` `CLOSURE_KEEP_REFUSAL_STATUS`; `schemas.ts` `accountKeepResponseDataSchema` |
| Pre-check route | Behind the switch: off answers `{ enabled: false }` before the session is read. On: `{ available, blockers, willKeepBilling, exportFacts }`, blockers already XC-5-filtered plus `payment_failed`. **No dates, no bookings, no closure state** | `app/api/business-os/account/deletion-check/route.ts`; `schemas.ts` `deletionCheckDataSchema` |
| Drawer | Posts `{ statement, language }` (no `reasonCode`); on 200 signs out and navigates to `/account-deleted`; maps 409 to blockers, 503 to `not_available` or `files_removed_kept`. No reason picker, no export control, no dates. Reads `settings.account_delete.what_next` ("Your account will be deleted now."), which is now false | `components/business-os/account-deletion/DeleteAccountDrawer.tsx` l.121–163, l.177–181 |
| Blocker copy | `BLOCKER_CODES` has `payment_failed` (DL-1b, appended); there is **no** `settings.account_delete.blocker.payment_failed` key, so `blockerCopyKey` would render a raw key | `blockerCopy.ts` l.20–30; `DeleteAccountDrawer.tsx` `blockerCopyKey`; `lib/business-os/translations/en.ts` l.4813–4838 |
| Danger Zone | `ErasureRequestContent` shows the drawer only when the check is `ready`; off / loading / error shows today's body (export button + Contact us). Two hosts: the `/business-os/settings` dialog (`ErasureDialogBody`) and the boxed `DangerZonePanel` (`/v2/settings`, `/settings`, no `LanguageProvider`, so English `FALLBACK_COPY`) | `components/business-os/purge/DangerZonePanel.tsx`; `app/business-os/settings/page.tsx` l.1288; `components/v2/settings/SecurityTabV2.tsx`, `components/settings/SecurityTab.tsx` |
| Keep with the switch off | The Keep route works with the switch off (D-11), but nothing on screen can reach it: the only entry is the check, which answers `enabled: false` | as above |
| Reason list | `PLAN_LEAVE_REASON_CODES` (7 codes, import-free, client-safe); the cancel drawer renders them as a native radio group under `settings.plan_cancel.reason.heading` ("Why are you leaving?"), with `settings.plan_cancel.reason.<code>` labels and `.required` | `lib/business-os/billing/planLeaveReasons.ts`; `components/business-os/settings/PlanCancelDrawer.tsx` l.226–254 |
| Dates | `closureLockAt(now, storedZone)` = start of local day 15, the zone resolved through `resolveBusinessTimezone` (NULL or unusable → UTC). `formatAccountDay(iso, language, zone)` formats a day on a given clock (client-safe) | `closureDates.ts`; `components/business-os/settings/planUpgradeCopy.ts` l.90 |
| Ending view | `readPlanEndingView({ accountId, endsAt, locale })` (server-only, display only) answers `free_plan` (Test Flight, until), `back_to_plan` (Founding Partner or an unexpired trial outlives the plan) or `unknown`. The my-plan route already calls it for the cancel drawer | `lib/business-os/entitlements/planEndingView.ts` l.49, l.110; `app/api/business-os/entitlements/my-plan/route.ts` l.155–170 |
| Bookings | `scheduling_bookings` carries `user_id`, `start_time` (NULL for bought, not booked, services) and `status` CHECK `confirmed / pending / cancelled / completed / no_show`. Package sessions are child rows of the same table today; `scheduling_meetings` is a shadow copy nobody reads yet. No "count upcoming for an owner" method exists | `supabase/migrations/20261007_booking_status_check.sql` l.66; `20261073_scheduling_meetings.sql` header; `lib/repositories/SchedulingRepository.ts` `countBookings` l.977 (per service only) |
| Copy maps (PLAN PAYMENTS) | `deletion_pending` maps to placeholders: plan manage `plan.manage.refusal.unavailable`, checkout `plan.refusal.not_open`, invite `refusalNotOpen`. Upgrade has no deletion code (Q-7: `subscription_cancelling` covers it). The Boost panel maps unknown codes to `usage.boost.error.generic` | `components/business-os/settings/planManageCopy.ts` l.35–37; `planPurchaseCopy.ts` l.42–43; `planUpgradeCopy.ts` l.34; `app/invite/awaitingPaymentCopy.ts` l.227; `components/business-os/BoostPackagesPanel.tsx` l.109–130 |
| Layout | Server component; reads plan badge, language, payment notice and owner identity in one `Promise.all` after the payment hold; renders `PlanPaymentBanner` under the tabs. `readPaymentNotice` is the pattern for a never-rejecting chrome read | `app/business-os/layout.tsx` l.83–96, l.170; `lib/business-os/billing/readPaymentNotice.ts` |
| `/account-deleted` | Says "Your account has been deleted … A confirmation is on its way". Nothing links to it after DL-1b (the request never redirects) | `app/account-deleted/accountDeletedCopy.ts` |
| Privacy paragraph | Describes an immediate delete; no request, grace or lock | `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` |
| Closure readers guard | Only allow-listed files may name `AccountClosureRepository` | `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` |
| `console.*` | None in any file DL-2 touches (counted per file) | `grep -c 'console\.'` on every file in §10 |
| Migrations | None needed in any slice | — |

**Phase (CLAUDE.md rule 8):** not V6 or pilot work. No plugin code.

---

## 2. Slice split and estimates

The brief proposed two slices. Counted honestly, the proposed DL-2a is about 2.75 days, over the 2.5-day cap (§6 "at most 2.5 days"), and it bundles the live fix with the date and bookings work, which needs an entitlements registration and a new repository method. So this plan splits it into three, and the first one ships the live fix sooner.

| Slice | Delivers | Estimate | Why this order |
|---|---|---|---|
| **DL-2a** Request and Keep work again | Reason picker (required, the cancel list); new body; every request answer and refusal, with `payment_failed` and each new code given words; export-first section with `<DownloadMyDataButton variant="button" />`; a read-only closure status route (not behind the switch) and a pending view in the Danger Zone with the dates the server already knows; **Keep my account** and every Keep answer (CR-6, CR-8); the plan page's reactivate refusal line (claim) | 🟡 **1.5 d** | Closes the live gap: Delete works, the owner sees what was recorded, and can undo it |
| **DL-2b** What happens: dates and bookings | Pre-check returns the account's timeline (paid / free / Founding Partner, owner's timezone) and the future-bookings count; the drawer's "What happens" section; BQ-39 | 🟡 **1 d** | Needs one entitlements read (`planEndingView`, registered) and one new `SchedulingRepository` method; independent of DL-2a's screens apart from the section slot |
| **DL-2c** The pending state everywhere | Banner on every Business OS page with Keep, gone after Keep; plan card "Ends on {date}. Your account is set to close." with no own Keep my plan; checkout, Boost and upgrade lines while a request is open (Q-7); `/account-deleted` re-worded; privacy paragraph re-worded | 🟡 **1.5 d** | Mostly PLAN PAYMENTS files and the shared layout: claims and their SA sign-off take calendar time, so it goes last |

**Total 4 d** against the requirement's 2 d for DL-2 (§6.3). The difference is real work DL-1b's contract created: a new status read (Keep must be reachable with the switch off), the answer map for nine new codes, and the BQ-39 count, which did not exist when the 2 d was set. TL updates the requirement's §6.3 DL-2 row and totals when SA rules on the split (Q-2).

---

## 3. Scope

**DL-2 row (§6.3, quoted):** "Drawer steps (§3.3) with the export link (S-4); future-bookings count (BQ-39); banner on every page; plan card wording; "Keep my account" in Settings; `/account-deleted` re-worded; privacy paragraph re-worded; en/he/es".

| In | Slice | Out (owner) |
|---|---|---|
| Reason picker, required, list only, same list and labels as the cancel (BQ-32) | 2a | Any free-text reason (C-10) |
| New request body; handling of every 200 and refusal; `payment_failed` and new-code copy | 2a | Server changes to the request or keep route (none needed) |
| Export-first section rendering `<DownloadMyDataButton variant="button" />` and nothing else for export (S-4, SR-9) | 2a | The export drawer, its stacking inside this dialog (EXPORT MX-1b) |
| Read-only closure status route, pending view, Keep my account in Settings (both Danger Zone hosts) | 2a | Admin Unlock (DL-4) |
| Plan page reactivate refusal line for `deletion_pending` (approved copy) | 2a | — |
| Timeline (paid, free, Founding Partner) in the owner's timezone; future-bookings count | 2b | The 3-day reminder's count (DL-3 reuses the 2b reader) |
| Banner, plan card wording, checkout / Boost / upgrade lines, `/account-deleted`, privacy paragraph | 2c | Banned-login copy (DL-4); "no longer available online" pages (DL-4b) |
| — | — | Every lifecycle email (DL-3); the `startOfDayUtc` midnight-DST fix (separate task, §14 R-1) |

---

## 4. Decisions and their reasons

| # | Decision | Why | Needs |
|---|---|---|---|
| D-1 | **Three slices, 2a / 2b / 2c**, each its own PR from `main` | §2: the 2.5-day cap, and the live fix should not wait for the entitlements registration or the PLAN PAYMENTS claims | Q-2 |
| D-2 | **A new read route, `GET /api/business-os/account/closure`, not behind the switch**, answers the open closure's state for the session user | Keep is not behind the switch (DL-1b D-11), so an owner with an open request must be able to reach Keep when the switch is off, and the pre-check answers `enabled: false` before it reads the session (O2-1). Changing the pre-check's off contract would touch every host; a separate read keeps both simple | Q-4 |
| D-3 | **The Danger Zone reads the closure first, then the pre-check only when no request is open** | The pre-check runs the cleanup function (up to 60 s budget); there is no point running it for an account that already asked. A closure read error falls back to the pre-check: if a request was in fact open, the request route answers `already_requested` and the panel re-reads | — |
| D-4 | **The drawer stays one scrolling form with numbered sections**, not a stepped wizard | It renders inside a dialog that is already open (V-8, no second dialog); document order is the keyboard order; nothing to lose on Back. The cancel drawer is stepped because it is its own nested drawer | Q-3 |
| D-5 | **The reason picker renders `PLAN_LEAVE_REASON_CODES` with the cancel drawer's keys** (`settings.plan_cancel.reason.*`), no shared component extracted | Same list and same words with no new copy, and `PlanCancelDrawer.tsx` stays untouched. Only the code is posted, never a label; there is no default (W-13: never send `other` on the owner's behalf) | Q-12 |
| D-6 | **Every date is worked out on the server and formatted on the server's clock**: the closure route and the pre-check send ISO instants plus the zone they were computed in; the drawer formats them with `formatAccountDay(iso, language, zone)` (import only) | The `/v2` hosts have no `LanguageProvider` and so no `timezone`; the lock date is fixed in `lock_timezone`, which may differ from today's preference. One rule for all hosts | — |
| D-7 | **A pending row's lock date is projected** as `closureLockAt(plan_ends_at, current zone)` and marked `lockAtIsProjected: true`; a `grace` or `locked` row shows the stored `lock_at` in `lock_timezone` | DL-1b leaves `lock_at` NULL until C starts (DL-3 fixes it at `ended_at`). The projection uses the same helper DL-3 will use, so the two agree unless the plan end or the zone moves | Q-8 |
| D-8 | **No sign-out and no redirect after a request.** The drawer re-reads the closure and shows the pending view in place; the host page is refreshed (`router.refresh()`) | The account keeps working until the lock. `/account-deleted` is no longer a destination from the drawer | — |
| D-9 | **No "we have emailed you" line anywhere in DL-2** | DL-3 sends "Deletion requested" and "kept"; until then a promise of an email would be false | — |
| D-10 | **Answer handling lives in pure maps** (`deletionAnswers.ts`): HTTP status + body → a UI outcome; the components only render outcomes | Every code is tested without rendering; a new server code fails a type-checked `Record` until it is given an outcome (the `planManageCopy.ts` pattern) | — |
| D-11 | **Future bookings: `scheduling_bookings` rows of the session user with `status` in `confirmed, pending` and `start_time` at or after the lock date**, counted with `{ count: 'exact', head: true }`; each package session counts (it is its own row today). No `deleted_at` filter | BQ-39 ("how many future bookings"); "after the lock date" is §3.3 step 3. The table has no `deleted_at` (a phantom filter killed a count query before, memory "Inbox channel zero leads"); Dev confirms the three columns with `npm run schema:check` on `main` before code | Q-5 |
| D-12 | **A failed count never blocks** and shows "we couldn't count", never "0" | BQ-39: bookings do not block deletion; a wrong zero is worse than saying we do not know | Q-6 |
| D-13 | **The banner reads in the layout's existing `Promise.all`**, through a never-rejecting `readClosureNotice()` (the `readPaymentNotice` pattern), always (not behind the switch) | Rows can exist after the switch is turned off; one indexed read (`user_id` + open statuses, partial unique index) in parallel adds no serial latency | Q-10 |
| D-14 | **A client `AccountClosureProvider`, seeded by the layout**, tells the plan card, the upgrade and the Boost panel that a request is open | `subscription_cancelling` (upgrade) cannot tell a plain cancel from a deletion; the client needs the fact without a second fetch per component | 2c |
| D-15 | **Copy goes in DELETE's own namespaces** (`settings.account_delete.*`, `account_closure.*`); plan, checkout, Boost and upgrade lines go in their owners' namespaces under a claim | §11 S-7: add keys only, own namespace; the `plan.*` and `usage.boost.*` keys are PLAN PAYMENTS' | claims §11 |

---

## 5. DL-2a design: request and Keep work again

### 5.1 The closure status route

`GET /api/business-os/account/closure`, scaffolded with the `new-api-route` skill, with this module's ruled deviations (session from `readSessionSubject`, `no-store`). Node runtime, `force-dynamic`. No input: any query string is ignored, and the route reads nothing from the request but the session. Not audited (read-only, like the pre-check).

| # | Step | Failure |
|---|---|---|
| S-1 | `readSessionSubject()` | null or throws → 401 |
| S-2 | Throttle `RATE_LIMITS.read`, key `selfDeleteThrottleKey('account-closure', id)` (the union in `sessionSubject.ts` grows by one member) | 429, `no-store` |
| S-3 | `findOpenForUser(subject)` | error → 503 `try_again` |
| S-4 | No row → 200 `{ closure: null }` | — |
| S-5 | `pending` (and `requesting` with a `plan_ends_at`): `findTimezone(subject)` → `closureLockAt(plan_ends_at, zone)` | a timezone read error → `lockAt: null` (the view says "14 days after your plan ends" without a date); never a guessed zone |
| S-6 | 200 `{ closure: closureStatusView(row, zone) }` | — |

**Wire** (`closureStatusResponseSchema` in `schemas.ts`, `.strict()`):

```typescript
closure: null | {
  status: 'requesting' | 'pending' | 'grace' | 'locked';
  planEndsAt: string | null;       // the row's plan_ends_at
  lockAt: string | null;           // stored (grace, locked) or projected (pending); null for requesting or an unreadable zone
  lockAtIsProjected: boolean;
  timezone: string;                // lock_timezone when stored, else the resolved user_preferences.timezone (UTC when NULL)
  renewalWasOn: boolean;
  graceDays: number;               // GRACE_DAYS, so no copy writes "14" as a literal
}
```

Never the reason code, the statement language, an email or a database message. Logs carry the subject id, the status and codes.

**Pure view** `closureStatusView.ts`: row + resolved zone + now → the wire above. **Deps** `closureStatusDeps.ts`: the only new file that names `AccountClosureRepository` (service role: the table has no policy by design; the id is always the session subject and the repository filters `user_id`; documented in the header per `tenant-isolation-guard`), plus `UserPreferencesRepository.findTimezone`. Added to the callers guard allow-list.

### 5.2 The Danger Zone, state by state

A new hook `useDangerZoneState()` (in `hooks/useAccountClosure.ts`) replaces the host's direct `useAccountDeletionCheck()` call in `ErasureDialogBody` and `ErasureRegion`. It reads the closure, then the pre-check only when needed, and exposes `refresh()`.

| Closure read | Pre-check | Body shown | Dialog heading |
|---|---|---|---|
| loading | — | today's body (as now while loading) | today's |
| open (any status) | not called | **pending view** (§5.5) | `account_closure.heading` |
| none or error | `ready` | **drawer** (§5.3) | `settings.account_delete.title` |
| none or error | `off` / `error` / loading | today's body, unchanged | today's |

`ErasureRequestContent`'s current "today's body" branch is untouched.

### 5.3 The drawer's sections

In order, one form. When blockers exist, sections 3 and 4 are not rendered and there is no confirm box (§3.3 step 4).

| # | Section | Content |
|---|---|---|
| 1 | Before you go | The existing warning; `settings.account_delete.export_first.heading`; `<DownloadMyDataButton variant="button" />`; `settings.account_delete.export_first.documents` (BQ-35). Nothing else for export (S-4) |
| 2 | Blockers (only if any) | `blockers_title` and one line per blocker, as today, plus `payment_failed`'s new line |
| 3 | Why are you leaving? | `<fieldset>` + `<legend>` `settings.plan_cancel.reason.heading`, hint, 7 native radios in `PLAN_LEAVE_REASON_CODES` order, `required` line while none is picked |
| 4 | Confirm | Statement intro, the statement in the UI language (`DELETION_STATEMENTS`, the D7 sentence ending "and want my account deleted forever"), the textarea, the error line, the submit button `settings.account_delete.request_button` |
| — | (DL-2b) What happens | Slot between sections 1 and 2, filled in DL-2b (§6) |

Submit is enabled only when a reason is picked **and** the typed text matches a statement in any language. The body is `{ statement: typed, language: statementLanguage, reasonCode }`. The existing `billing_kept` and `what_we_keep` lines stay under section 1 (they are still true at E).

### 5.4 Request answers (`deletionAnswers.ts`, `requestOutcome()`)

| Answer | Outcome | What the owner sees |
|---|---|---|
| 200 `pending` or `grace` | `recorded` | the panel re-reads the closure and shows the pending view; `router.refresh()`; focus moves to its heading |
| 409 `already_requested` (any `data.status`, including `null`, CR-6) | `already` | re-read; the pending view, or `already_requested` if the re-read finds nothing open |
| 409 `blocked` | `blocked` | blockers list from `parseBlockers` (unknown code → `contact_support`, as today) |
| 409 `plan_change_pending` | `message` | `plan_change_pending` |
| 409 `plan_state_changed` | `message` | `plan_state_changed` |
| 400 `statement_mismatch` | `message` | `mismatch` (existing) |
| 400 `invalid_body`, 413 | `message` | `try_again` (nothing was recorded) |
| 429 | `message` | `too_many` (existing) |
| 404 `not_found` (switch turned off since the page loaded), 503 `not_available` | `message` | `not_available` (existing) |
| 503 `try_again` without `data.status` | `message` | `try_again` |
| 503 `try_again` with `data.status: 'requesting'` (P-8), 502 with `outcomeUnknown`, 500 `request_failed`, network failure | `unconfirmed` | `unconfirmed`, then a re-read: if a row is open, the pending view replaces the message |
| 502 `stripe_error` without `outcomeUnknown` | `message` | `try_again` (the row was deleted; nothing changed) |
| 401 | `message` | `signed_out` (reuse `plan.refusal.signed_out`) |

Removed from the drawer: `signOutUser`, `navigate`, `isAccountDeletedRedirect`, `ACCOUNT_DELETED_PATH`, the `files_removed_kept` failure (no route can send `filesRemoved` any more). `schemas.ts` keeps `accountDeletedRedirect` for the page (§7.4).

### 5.5 The pending view and Keep

`ClosurePendingPanel.tsx` renders the closure wire:

| Status | Text | Keep button |
|---|---|---|
| `pending` | `account_closure.pending_body` ({planEnd}, {days}, {lockDate}); `_nodate` when `lockAt` is null | yes |
| `grace` | `account_closure.grace_body` ({lockDate}) | yes |
| `requesting` | `account_closure.requesting_body` | no (Keep answers `request_in_progress`) |
| `locked` | `account_closure.locked_body` (support mailto) | no |

`KeepAccountButton.tsx` (shared with the DL-2c banner) posts `{}` to the keep route once (in-flight guard, `aria-busy`), then `keepOutcome()`:

| Answer | Message (role `status`) | Then |
|---|---|---|
| 200 `restored` | `kept.restored` | re-read (→ none), `router.refresh()` |
| 200 `not_restored_by_choice` | `kept.not_restored_by_choice` ({planEnd} from the row read before the press) or `_nodate` | same |
| 200 `not_needed` | `kept.not_needed` | same |
| 200 `failed` | `kept.failed` (names Keep my plan; XC-2 honest card) | same |
| 200 `unknown` | `kept.unknown` | same |
| 409 `state_changed` with `data.status: 'kept'` (CR-8) | `kept.generic` | same |
| 409 `state_changed`, other status | none | re-read and render the new state |
| 409 `nothing_to_keep` | `nothing_to_keep` | re-read |
| 409 `request_in_progress` | `requesting_body` | none |
| 409 `locked` | `locked_body` | none |
| 429 | `settings.account_delete.too_many` | none |
| 401 | `plan.refusal.signed_out` | none |
| 503, 500, network | `keep_failed` | none |

The message stays on screen after the re-read empties the closure, until the dialog closes, so the owner reads what happened.

### 5.6 The plan page's reactivate refusal (claim, PLAN PAYMENTS)

`planManageCopy.ts`: `deletion_pending: 'plan.manage.refusal.deletion_pending'`, with the user-approved en line and PLAN PAYMENTS' es / he lines (§9.1), adjusted only as Q-1 rules. Nothing else in the file. `PlanManage.tsx` already renders `planManageRefusalKey`, so no component change. The checkout `deletion_pending` line stays a placeholder until DL-2c.

---

## 6. DL-2b design: what happens, dates and bookings

### 6.1 Pre-check additions

`GET /api/business-os/account/deletion-check?lang=en|he|es` (Zod: `z.object({ lang: z.enum(STATEMENT_LANGUAGES).default('en') }).strict()` over the search params; anything else is 400). The `lang` only picks the language of `planName`. Two fields are added to the `enabled: true` shape. They are additive, so an older drawer that ignores them still parses:

```typescript
timeline:
  | { kind: 'paid'; planEndsAt: string; lockAt: string; timezone: string; graceDays: number;
      during: 'free_plan' | 'back_to_plan' | 'unknown'; planName: string | null }
  | { kind: 'free'; lockAt: string; timezone: string; graceDays: number }
  | null;                                  // could not be worked out: the drawer says so in general words
futureBookings: { count: number } | { count: null };   // null: could not be counted
```

Steps, after the existing blockers (all reads, no write, no Stripe call):

| # | Step | Failure |
|---|---|---|
| T-1 | Reuse the billing row already read; `classifyBillingRow(row, isPlanPriceRecognitionEnabled, now)` | a `refuse` classification → `timeline: null` (the blocker or retry line already explains) |
| T-2 | `findTimezone(subject)` → resolved zone | read error → `timeline: null`, `futureBookings: { count: null }` |
| T-3 | Free: `closureLockAt(now, zone)`. Paid: `closureLockAt(currentPeriodEnd, zone)` | paid without a period end → `timeline: null` |
| T-4 | Paid only: `readPlanEndingView({ accountId: resolveAccountId(subject), endsAt: currentPeriodEnd, locale: lang })` → `during` = its `kind`, `planName` = its `planName` (`free_plan`) or the cohort's (`back_to_plan`) | throws or `null` → `during: 'unknown'`, `planName: null` (display only, never fails the check) |
| T-5 | `countUpcomingBookings(subject, lockAt)` | error → `{ count: null }` |

New pure `closureTimeline.ts` (inputs → wire) and deps `closureTimelineDeps.ts` (the only DL-2b file importing from `lib/business-os/entitlements/`: `readPlanEndingView`, `resolveAccountId`; registered as a non-gate importer, display only, it refuses nothing). The deletion-check route imports the deps file, not the entitlements module, so one registry entry covers it.

Founding Partner (P-12): a paid Autopilot plan on a Founding Partner account comes back as `back_to_plan`, so the line reads "you'll be back on Founding Partner". A Founding Partner with no paid plan is `free` and sees only the 14-day line (§3.3 step 3).

### 6.2 The repository method

`SchedulingRepository.countUpcomingBookings(userId, fromIso): Promise<SchedulingRepositoryResult<number>>`: `.from('scheduling_bookings').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['confirmed', 'pending']).gte('start_time', fromIso)`. The `error` is bound and returned, never discarded. A uuid or ISO that does not parse is an error with no DB call. Additive; no existing method changes.

### 6.3 The drawer's "What happens" section

| Timeline | Lines |
|---|---|
| `paid` | `what_happens.paid_plan_end` ({planEnd}); reuse `settings.plan_cancel.review.no_refund`; then `during_free_plan` / `during_back_to_plan` ({days}, {plan}) or `during_unknown` ({days}); then `what_happens.lock` ({lockDate}) |
| `free` | `what_happens.free_grace` ({days}); `what_happens.lock` ({lockDate}) |
| `null` | `what_happens.general` |
| bookings `count > 0` | `what_happens.bookings` ({n}, {lockDate}), `_one` when 1 |
| bookings `count: null` | `what_happens.bookings_unknown` |
| bookings `0` | nothing |

Dates: `formatAccountDay(iso, language, timeline.timezone)`.

---

## 7. DL-2c design: the pending state everywhere

### 7.1 Banner

- `lib/business-os/account-deletion/readClosureNotice.ts` (`server-only`): `getUser()` → `findOpenForUser` → for `pending` / `grace` only, the same `closureStatusView` as §5.1; anything else, no session or any error → `null` and a `warn`. Never rejects. Added to the callers guard allow-list.
- `app/business-os/layout.tsx` (claim): one more member of the existing `Promise.all`; `<AccountClosureProvider value={closureNotice}>` around the chrome and body; `<ClosureBanner />` directly after `<PlanPaymentBanner />`.
- `ClosureBanner.tsx` (client): `account_closure.banner` ({lockDate}) and `KeepAccountButton`. After a Keep it calls `router.refresh()`, so the layout re-reads and the banner goes (§7 AC "goes after Keep").
- `requesting` and `locked` show no banner (Q-9).

### 7.2 Plan card (claim, PLAN PAYMENTS)

`PlanManage.tsx`: when `useClosureNotice()` says a request is open and the plan is set to end, the card reads `plan.manage.ends_account_closing` ({date}) and does **not** render Keep my plan (§3.4, §5 "no own undo"). The server already refuses the plain reactivate (DL-1b E-2), so this is wording, not a gate.

### 7.3 Checkout, Boost and upgrade lines (claims, PLAN PAYMENTS)

| File | Change |
|---|---|
| `planPurchaseCopy.ts` | `deletion_pending: 'plan.refusal.deletion_pending'` |
| `BoostPackagesPanel.tsx` (`refusalOf`) | `code === 'deletion_pending'` → `usage.boost.error.deletion_pending` |
| `PlanUpgrade.tsx` | when the refusal code is `subscription_cancelling` and `useClosureNotice()` is open → `plan.upgrade.refusal.deletion_pending`; otherwise unchanged (Q-7). `planUpgradeCopy.ts` gains only the key constant if PLAN PAYMENTS prefers it there |
| `app/invite/awaitingPaymentCopy.ts` | No change: an account still awaiting its invite payment cannot have a closure (the payment hold redirects before Business OS) |

### 7.4 `/account-deleted`

Re-worded as the landing for a closed account (XC-6) in `accountDeletedCopy.ts` (§9.3); the page keeps its `?lang=` rule. Nothing links to it until DL-4 maps the banned-login error (Q-14).

### 7.5 Privacy paragraph

`docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md`: the first paragraph becomes request → rest of the paid period → 14 days to export → closed → deleted by us, with "until it closes you can keep it", and the wording-rules table gains one row for it. English only; he / es after legal approval, as the doc already says. Legal open issue 2 still covers it.

---

## 8. Accessibility, keyboard and right-to-left

| Rule | How |
|---|---|
| Keyboard only, end to end | Native controls only: the export button, radios (arrow keys inside the group, one Tab stop), textarea, submit, Keep. Tab order is document order. Enter in the textarea submits only when the button is enabled (existing). Escape stays with the host dialog (V-8) |
| Focus after an answer | After a recorded request, focus moves to the pending view's heading (`tabIndex={-1}`). After Keep, to the message (`role="status"`, `tabIndex={-1}`). After a refusal, the message is `role="alert"` and the submit button's `aria-describedby` points at it |
| Disabled states explained | The submit button's `aria-describedby` names the "choose a reason" line while no reason is picked (the cancel drawer's pattern) |
| Busy | `aria-busy` on the submit and Keep buttons; a second press is ignored |
| Hebrew right to left | The container takes `dir` from the host; the statement and textarea take the statement language's direction (existing); the support mailto stays `dir="ltr"`; dates come from `toLocaleDateString` in the reader's locale. No `flex-row-reverse` around the export button (SA C-8) |
| `/v2` hosts (no provider) | Every new key, and the 10 reused `settings.plan_cancel.reason.*` keys, get an English `FALLBACK_COPY` entry byte-identical to `en` (the existing parity test) |

---

## 9. Copy: reused keys and proposed new lines (user approval)

**Reused, no new wording:** `settings.plan_cancel.reason.heading` ("Why are you leaving?"), `.hint`, the 7 reason labels, `.required`; `settings.plan_cancel.review.no_refund`; `settings.account_delete.warning`, `.billing_kept`, `.what_we_keep`, `.not_available`, `.blockers_title`, every existing `.blocker.*`, `.statement_intro`, `.statement_label`, `.mismatch`, `.too_many`; `plan.refusal.signed_out`; the statement itself (D7).

**Every line below is a PROPOSAL for the user**, except where marked approved. Hebrew follows the register of its namespace: plural imperative in `settings.account_delete.*` and `account_closure.*`, as the existing account-deletion keys; the PLAN PAYMENTS lines keep their impersonal form. Spanish needs a native check, as all Spanish in this module.

### 9.1 DL-2a

| Key | en | he | es |
|---|---|---|---|
| `settings.account_delete.export_first.heading` | Export your data first | קודם כל, ייצאו את הנתונים | Primero exporta tus datos |
| `settings.account_delete.export_first.documents` | Client documents are not in the export. Download them one by one from each client's record. | מסמכי הלקוחות לא נכללים בייצוא. הורידו אותם אחד אחד מהרשומה של כל לקוח. | Los documentos de los clientes no están en la exportación. Descárgalos uno a uno desde la ficha de cada cliente. |
| `settings.account_delete.request_button` | Ask to delete my account | בקשה למחיקת החשבון | Solicitar la eliminación de mi cuenta |
| `settings.account_delete.requesting` | Sending your request… | שולחים את הבקשה… | Enviando tu solicitud… |
| `settings.account_delete.blocker.payment_failed` | Your last plan payment failed. Update your card in Settings → Plan, or contact us at {support}. | התשלום האחרון על התוכנית נכשל. עדכנו את הכרטיס בהגדרות ← תוכנית, או כתבו לנו לכתובת {support}. | El último pago de tu plan falló. Actualiza tu tarjeta en Configuración → Plan o escríbenos a {support}. |
| `settings.account_delete.plan_change_pending` | A change to your plan is still in progress. Finish or cancel it in Settings → Plan, then try again. | שינוי בתוכנית עדיין בתהליך. סיימו או בטלו אותו בהגדרות ← תוכנית, ואז נסו שוב. | Todavía hay un cambio de plan en curso. Termínalo o cancélalo en Configuración → Plan y vuelve a intentarlo. |
| `settings.account_delete.plan_state_changed` | Your plan changed while we were checking it. Wait a few minutes and try again. | התוכנית השתנתה בזמן שבדקנו אותה. המתינו כמה דקות ונסו שוב. | Tu plan cambió mientras lo revisábamos. Espera unos minutos y vuelve a intentarlo. |
| `settings.account_delete.try_again` | We could not record your request, and nothing has changed. Try again, or contact us at {support}. | לא הצלחנו לרשום את הבקשה, ושום דבר לא השתנה. נסו שוב, או כתבו לנו לכתובת {support}. | No pudimos registrar tu solicitud y no ha cambiado nada. Vuelve a intentarlo o escríbenos a {support}. |
| `settings.account_delete.unconfirmed` | We couldn't confirm your request yet. Check back here in a few minutes before you try again. | עדיין לא הצלחנו לאשר את הבקשה. בדקו כאן שוב בעוד כמה דקות לפני שתנסו שוב. | Todavía no pudimos confirmar tu solicitud. Vuelve a mirar aquí en unos minutos antes de intentarlo de nuevo. |
| `settings.account_delete.already_requested` | You have already asked us to delete your account. | כבר ביקשתם למחוק את החשבון. | Ya nos pediste eliminar tu cuenta. |
| `account_closure.heading` | Your account is set to close | החשבון מתוכנן להיסגר | Tu cuenta está programada para cerrarse |
| `account_closure.pending_body` | Your plan runs until {planEnd}. Then you have {days} days to sign in and export your data. Your account closes on {lockDate}. | התוכנית פעילה עד {planEnd}. אחר כך יש לכם {days} ימים להתחבר ולייצא את הנתונים. החשבון ייסגר ב־{lockDate}. | Tu plan sigue activo hasta el {planEnd}. Después tienes {days} días para iniciar sesión y exportar tus datos. Tu cuenta se cierra el {lockDate}. |
| `account_closure.pending_body_nodate` | Your plan runs until the end of the period you paid for. Then you have {days} days to sign in and export your data before your account closes. | התוכנית פעילה עד סוף התקופה ששילמתם עליה. אחר כך יש לכם {days} ימים להתחבר ולייצא את הנתונים לפני שהחשבון ייסגר. | Tu plan sigue activo hasta el final del periodo que pagaste. Después tienes {days} días para iniciar sesión y exportar tus datos antes de que se cierre tu cuenta. |
| `account_closure.grace_body` | You can still sign in and export your data. Your account closes on {lockDate}. | עדיין אפשר להתחבר ולייצא את הנתונים. החשבון ייסגר ב־{lockDate}. | Todavía puedes iniciar sesión y exportar tus datos. Tu cuenta se cierra el {lockDate}. |
| `account_closure.requesting_body` | We're still setting up your request. Check back here in a few minutes. | אנחנו עדיין מעבדים את הבקשה. בדקו כאן שוב בעוד כמה דקות. | Todavía estamos procesando tu solicitud. Vuelve a mirar aquí en unos minutos. |
| `account_closure.locked_body` | Your account is closed. Contact us at {support}. | החשבון סגור. כתבו לנו לכתובת {support}. | Tu cuenta está cerrada. Escríbenos a {support}. |
| `account_closure.keep_button` (Q-1) | Keep my account | להשאיר את החשבון | Mantener mi cuenta |
| `account_closure.keeping` | Keeping your account… | משאירים את החשבון… | Manteniendo tu cuenta… |
| `account_closure.kept.restored` | Your account is kept, and your plan will renew as before. | החשבון נשאר, והתוכנית תתחדש כרגיל. | Tu cuenta se mantiene y tu plan se renovará como antes. |
| `account_closure.kept.not_restored_by_choice` | Your account is kept. Your plan still ends on {planEnd}, as you chose before. | החשבון נשאר. התוכנית עדיין תסתיים ב־{planEnd}, כפי שבחרתם קודם. | Tu cuenta se mantiene. Tu plan sigue terminando el {planEnd}, como elegiste antes. |
| `account_closure.kept.not_restored_by_choice_nodate` | Your account is kept. Your plan still ends at the end of this period, as you chose before. | החשבון נשאר. התוכנית עדיין תסתיים בסוף התקופה הזו, כפי שבחרתם קודם. | Tu cuenta se mantiene. Tu plan sigue terminando al final de este periodo, como elegiste antes. |
| `account_closure.kept.not_needed` | Your account is kept. You can choose a plan in Settings → Plan. | החשבון נשאר. אפשר לבחור תוכנית בהגדרות ← תוכנית. | Tu cuenta se mantiene. Puedes elegir un plan en Configuración → Plan. |
| `account_closure.kept.failed` | Your account is kept, but we couldn't turn your plan's renewal back on. Use Keep my plan in Settings → Plan. | החשבון נשאר, אבל לא הצלחנו להפעיל מחדש את חידוש התוכנית. השתמשו ב״להשאיר את התוכנית״ בהגדרות ← תוכנית. | Tu cuenta se mantiene, pero no pudimos volver a activar la renovación de tu plan. Usa Mantener mi plan en Configuración → Plan. |
| `account_closure.kept.unknown` | Your account is kept. We couldn't confirm your plan's renewal yet. Check Settings → Plan in a few minutes. | החשבון נשאר. עדיין לא הצלחנו לאשר את חידוש התוכנית. בדקו בהגדרות ← תוכנית בעוד כמה דקות. | Tu cuenta se mantiene. Todavía no pudimos confirmar la renovación de tu plan. Revisa Configuración → Plan en unos minutos. |
| `account_closure.kept.generic` | Your account is kept. | החשבון נשאר. | Tu cuenta se mantiene. |
| `account_closure.nothing_to_keep` | There is no deletion request on this account. | אין בקשת מחיקה פתוחה בחשבון הזה. | No hay ninguna solicitud de eliminación en esta cuenta. |
| `account_closure.keep_failed` | We couldn't keep your account. Try again, or contact us at {support}. | לא הצלחנו להשאיר את החשבון. נסו שוב, או כתבו לנו לכתובת {support}. | No pudimos mantener tu cuenta. Vuelve a intentarlo o escríbenos a {support}. |
| `plan.manage.refusal.deletion_pending` (claim; **en approved**, es / he PLAN PAYMENTS') | You asked us to delete your account, so this plan can't be reactivated. Keep your account first, then you can reactivate your plan. | ביקשת למחוק את החשבון, ולכן אי אפשר להפעיל מחדש את התוכנית הזו. יש לשמור קודם את החשבון, ואז אפשר יהיה להפעיל מחדש את התוכנית. | Pediste eliminar tu cuenta, así que este plan no se puede reactivar. Primero conserva tu cuenta y luego podrás reactivar tu plan. |

**Q-1 alternative for the last row**, if the user keeps the button "Keep my account" (suggested): en "You asked us to delete your account, so this plan can't be reactivated. Choose Keep my account first, then you can reactivate your plan." · he "ביקשת למחוק את החשבון, ולכן אי אפשר להפעיל מחדש את התוכנית הזו. יש לבחור קודם ב״להשאיר את החשבון״, ואז אפשר יהיה להפעיל מחדש את התוכנית." · es "Pediste eliminar tu cuenta, así que este plan no se puede reactivar. Primero elige Mantener mi cuenta y luego podrás reactivar tu plan."

**Implementation note:** Hebrew lines with ״ (gershayim) are written with that character, not an ASCII quote, so the single-quoted TS strings need no escape; no backslash-hex escapes anywhere (Tailwind scans `lib/`).

### 9.2 DL-2b

| Key | en | he | es |
|---|---|---|---|
| `settings.account_delete.what_happens.heading` | What happens next | מה יקרה עכשיו | Qué pasará ahora |
| `.what_happens.paid_plan_end` | Your plan runs until {planEnd}. It will not renew, and you will not be charged again. | התוכנית פעילה עד {planEnd}. היא לא תתחדש, ולא תחויבו שוב. | Tu plan sigue activo hasta el {planEnd}. No se renovará y no se te cobrará de nuevo. |
| `.what_happens.during_free_plan` | Then for {days} days you'll be on {plan}, and you can sign in and export your data. | אחר כך, למשך {days} ימים, תהיו בתוכנית {plan}, ותוכלו להתחבר ולייצא את הנתונים. | Después, durante {days} días, tendrás {plan} y podrás iniciar sesión y exportar tus datos. |
| `.what_happens.during_back_to_plan` | Then for {days} days you'll be back on {plan}, and you can sign in and export your data. | אחר כך, למשך {days} ימים, תחזרו לתוכנית {plan}, ותוכלו להתחבר ולייצא את הנתונים. | Después, durante {days} días, volverás a {plan} y podrás iniciar sesión y exportar tus datos. |
| `.what_happens.during_unknown` | Then you have {days} days to sign in and export your data. | אחר כך יש לכם {days} ימים להתחבר ולייצא את הנתונים. | Después tienes {days} días para iniciar sesión y exportar tus datos. |
| `.what_happens.free_grace` | You have {days} days to sign in and export your data. | יש לכם {days} ימים להתחבר ולייצא את הנתונים. | Tienes {days} días para iniciar sesión y exportar tus datos. |
| `.what_happens.lock` | Your account closes on {lockDate}. After that you can't sign in, and we delete it. Until then you can keep it. | החשבון ייסגר ב־{lockDate}. אחרי זה לא תוכלו להתחבר, ואנחנו נמחק אותו. עד אז אפשר להשאיר אותו. | Tu cuenta se cierra el {lockDate}. Después ya no podrás iniciar sesión y la eliminaremos. Hasta entonces puedes mantenerla. |
| `.what_happens.general` (re-worded by SA CR-1, DL-2b) | You will have {days} days to sign in and export your data before your account closes. If you have a paid plan, those days start when the period you paid for ends. | יהיו לכם {days} ימים להתחבר ולייצא את הנתונים לפני שהחשבון ייסגר. אם יש לכם תוכנית בתשלום, הימים האלה מתחילים כשהתקופה ששילמתם עליה מסתיימת. | Tendrás {days} días para iniciar sesión y exportar tus datos antes de que se cierre tu cuenta. Si tienes un plan de pago, esos días empiezan cuando termina el periodo que pagaste. |
| `.what_happens.bookings` | You have {n} client bookings after {lockDate}. We won't cancel them or email your clients, so please tell them yourself. Once your account closes, their booking links will say your business is no longer available online. | יש לכם {n} הזמנות של לקוחות אחרי {lockDate}. אנחנו לא נבטל אותן ולא נשלח אימייל ללקוחות, לכן חשוב שתעדכנו אותם בעצמכם. אחרי שהחשבון ייסגר, קישורי ההזמנה שלהם יראו שהעסק כבר לא זמין באינטרנט. | Tienes {n} reservas de clientes después del {lockDate}. No las cancelaremos ni escribiremos a tus clientes, así que avísales tú. Cuando se cierre tu cuenta, sus enlaces de reserva indicarán que tu negocio ya no está disponible en línea. |
| `.what_happens.bookings_one` | You have 1 client booking after {lockDate}. (rest as above, singular) | יש לכם הזמנה אחת של לקוח אחרי {lockDate}. (המשך כמו למעלה, ביחיד) | Tienes 1 reserva de un cliente después del {lockDate}. (resto igual, en singular) |
| `.what_happens.bookings_unknown` | We couldn't count your upcoming client bookings. Check your calendar and tell your clients before your account closes. | לא הצלחנו לספור את ההזמנות הקרובות של הלקוחות. בדקו את היומן ועדכנו את הלקוחות לפני שהחשבון ייסגר. | No pudimos contar las próximas reservas de tus clientes. Revisa tu calendario y avisa a tus clientes antes de que se cierre tu cuenta. |

### 9.3 DL-2c

| Key | en | he | es |
|---|---|---|---|
| `account_closure.banner` | Your account closes on {lockDate}. | החשבון ייסגר ב־{lockDate}. | Tu cuenta se cierra el {lockDate}. |
| `plan.manage.ends_account_closing` (claim; en is §3.4's text) | Ends on {date}. Your account is set to close. | מסתיימת ב־{date}. החשבון מתוכנן להיסגר. | Termina el {date}. Tu cuenta está programada para cerrarse. |
| `plan.refusal.deletion_pending` (claim) | You asked us to delete your account, so you can't buy a plan now. Keep your account first, then you can choose a plan. | ביקשת למחוק את החשבון, ולכן אי אפשר לקנות תוכנית כרגע. יש לשמור קודם את החשבון, ואז אפשר יהיה לבחור תוכנית. | Pediste eliminar tu cuenta, así que ahora no puedes comprar un plan. Primero conserva tu cuenta y luego podrás elegir un plan. |
| `usage.boost.error.deletion_pending` (claim) | You asked us to delete your account, so you can't buy credits now. Keep your account first. | ביקשת למחוק את החשבון, ולכן אי אפשר לקנות קרדיטים כרגע. יש לשמור קודם את החשבון. | Pediste eliminar tu cuenta, así que ahora no puedes comprar créditos. Primero conserva tu cuenta. |
| `plan.upgrade.refusal.deletion_pending` (claim) | You asked us to delete your account, so this plan can't be upgraded. Keep your account first, then you can upgrade. | ביקשת למחוק את החשבון, ולכן אי אפשר לשדרג את התוכנית הזו. יש לשמור קודם את החשבון, ואז אפשר יהיה לשדרג. | Pediste eliminar tu cuenta, así que este plan no se puede mejorar. Primero conserva tu cuenta y luego podrás mejorarlo. |
| `/account-deleted` title | This account is closed | החשבון הזה סגור | Esta cuenta está cerrada |
| `/account-deleted` body | This account was closed because its owner asked us to delete it. If it is yours and you want it back, contact us at {support} as soon as you can: once it is deleted, it cannot be restored. | החשבון נסגר כי הבעלים ביקשו למחוק אותו. אם החשבון שלכם ואתם רוצים לקבל אותו בחזרה, כתבו לנו לכתובת {support} בהקדם: אחרי שהוא נמחק, אי אפשר לשחזר אותו. | Esta cuenta se cerró porque su titular pidió eliminarla. Si es tuya y quieres recuperarla, escríbenos a {support} lo antes posible: una vez eliminada, no se puede restaurar. |

The three PLAN PAYMENTS-namespace lines in 9.3 mirror the approved reactivate line's form ("Keep your account first"); they follow whatever Q-1 rules. The privacy paragraph's new English text is drafted in the DL-2c diff for the user and the lawyer (§7.5).

---

## 10. Files to create / modify, per slice

Ownership: **DEL** = DELETE (this stream). **PP** = PLAN PAYMENTS: needs a coordination claim and PLAN PAYMENTS' SA sign-off on the hunk. **SH** = shared add-only registry or hotspot (S-7, S-12). **EXP** = EXPORT, consumed only. **SCH** = scheduling module, additive method.

### 10.1 DL-2a

| File | Action | Owner | Reason |
|---|---|---|---|
| `app/api/business-os/account/closure/route.ts` | create | DEL | §5.1 status read, not behind the switch |
| `app/api/business-os/account/closure/__tests__/route.test.ts` | create | DEL | happy path, 401, 429, 503, no row, switch off still answers |
| `lib/business-os/account-deletion/closureStatusView.ts` (+ test) | create | DEL | pure wire builder, projected lock (D-7) |
| `lib/business-os/account-deletion/closureStatusDeps.ts` | create | DEL | names the closure repository; tenancy header |
| `lib/business-os/account-deletion/schemas.ts` | modify | DEL | `closureStatusResponseSchema` |
| `lib/business-os/account-deletion/sessionSubject.ts` | modify | DEL | throttle key union + `'account-closure'` |
| `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` | modify | DEL | allow `closureStatusDeps.ts` |
| `hooks/useAccountClosure.ts` (+ test) | create | DEL | `useAccountClosure()`, `useDangerZoneState()` (§5.2) |
| `components/business-os/account-deletion/deletionAnswers.ts` (+ test) | create | DEL | `requestOutcome()`, `keepOutcome()` (D-10) |
| `components/business-os/account-deletion/ClosurePendingPanel.tsx` | create | DEL | §5.5 |
| `components/business-os/account-deletion/KeepAccountButton.tsx` | create | DEL | shared with the DL-2c banner |
| `components/business-os/account-deletion/DeleteAccountDrawer.tsx` | modify | DEL | sections, reason, new body, answers; old success path removed |
| `components/business-os/account-deletion/__tests__/*` (3 existing + new) | modify / create | DEL | §12 |
| `components/business-os/purge/DangerZonePanel.tsx` | modify | DEL (S-5) | state machine, pending view, headings, `FALLBACK_COPY` |
| `components/business-os/purge/__tests__/DangerZonePanel*.test.ts(x)` | modify | DEL | pending, keep, fallback parity |
| `lib/business-os/translations/{en,he,es}.ts` | modify | SH (DELETE block) + PP (one `plan.manage.*` key) | §9.1 |
| `components/business-os/settings/planManageCopy.ts` | modify | **PP** | `deletion_pending` → its own key (§5.6) |
| `components/business-os/settings/planUpgradeCopy.ts` | import only (`formatAccountDay`) | PP, no edit | D-6 |
| `components/business-os/data-export/DownloadMyDataButton.tsx` | render only | EXP (frozen) | S-4 |

### 10.2 DL-2b

| File | Action | Owner | Reason |
|---|---|---|---|
| `app/api/business-os/account/deletion-check/route.ts` (+ tests) | modify | DEL | `lang` query (Zod), `timeline`, `futureBookings` |
| `lib/business-os/account-deletion/closureTimeline.ts` (+ test) | create | DEL | pure (§6.1) |
| `lib/business-os/account-deletion/closureTimelineDeps.ts` | create | DEL | `readPlanEndingView`, `resolveAccountId`, timezone, count |
| `lib/business-os/account-deletion/schemas.ts` | modify | DEL | two additive fields |
| `hooks/useAccountDeletionCheck.ts` | modify | DEL | passes `lang` |
| `lib/repositories/SchedulingRepository.ts` (+ test) | modify | **SCH** (additive) | `countUpcomingBookings` (§6.2) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | **SH** (S-12) | `KNOWN_NON_GATE_IMPORTERS` entry for `closureTimelineDeps.ts` |
| `DeleteAccountDrawer.tsx`, `DangerZonePanel.tsx` (`FALLBACK_COPY`), translations | modify | DEL / SH | "What happens" (§6.3), §9.2 |

### 10.3 DL-2c

| File | Action | Owner | Reason |
|---|---|---|---|
| `lib/business-os/account-deletion/readClosureNotice.ts` (+ test) | create | DEL | never-rejecting layout read |
| `components/business-os/account-deletion/AccountClosureProvider.tsx` | create | DEL | `useClosureNotice()` context (D-14) |
| `components/business-os/account-deletion/ClosureBanner.tsx` (+ test) | create | DEL | §7.1 |
| `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` | modify | DEL | allow `readClosureNotice.ts` |
| `app/business-os/layout.tsx` | modify | **PP / SH** (shared chrome; PLAN PAYMENTS placed `PlanPaymentBanner`) | provider + banner |
| `components/business-os/settings/PlanManage.tsx` | modify | **PP** | §7.2 |
| `components/business-os/settings/planPurchaseCopy.ts` | modify | **PP** | §7.3 |
| `components/business-os/settings/PlanUpgrade.tsx` (and `planUpgradeCopy.ts` if PP prefers) | modify | **PP** | §7.3 (Q-7) |
| `components/business-os/BoostPackagesPanel.tsx` | modify | **PP** (Boost) | §7.3 |
| `app/account-deleted/accountDeletedCopy.ts`, `page.tsx` (+ test) | modify | DEL | §7.4 |
| `docs/legal/ACCOUNT_DELETION_PRIVACY_PARAGRAPH.md` | modify | DEL | §7.5 |
| translations | modify | SH + PP keys | §9.3 |

Not touched in any slice: `app/business-os/settings/page.tsx` (the dialog body is self-contained), `PlanCancelDrawer.tsx`, the request and keep routes, `closureRequest.ts`, `closureKeep.ts`, `app/invite/awaitingPaymentCopy.ts`, any migration.

---

## 11. Coordination block (for TL to paste)

> **DL-2a (DELETE), branch `feature/bos-deletion-dl2-drawer-keep`.** New route `GET /api/business-os/account/closure` (read-only, session user, not behind the switch). **PLAN PAYMENTS claim:** `components/business-os/settings/planManageCopy.ts`, one line: `deletion_pending` → `plan.manage.refusal.deletion_pending`; translations `{en,he,es}.ts` one key `plan.manage.refusal.deletion_pending` with the user-approved en and PLAN PAYMENTS' es / he (or the Q-1 variant). Import only, no edit: `formatAccountDay` from `planUpgradeCopy.ts`. **EXPORT notice:** the deletion drawer now renders `<DownloadMyDataButton variant="button" />` (S-4); MX-1b's stacking test covers it.
>
> **DL-2b (DELETE).** **Scheduling notice:** `SchedulingRepository.countUpcomingBookings(userId, fromIso)`, additive. **Shared registry:** one `KNOWN_NON_GATE_IMPORTERS` entry (`closureTimelineDeps.ts`: `readPlanEndingView`, `resolveAccountId`, display only).
>
> **DL-2c (DELETE). PLAN PAYMENTS claims:** `app/business-os/layout.tsx` (one `Promise.all` member, a provider, a banner after `PlanPaymentBanner`); `PlanManage.tsx` (closing wording, no Keep my plan while a request is open); `planPurchaseCopy.ts` (`deletion_pending` key); `PlanUpgrade.tsx` (closure-aware `subscription_cancelling` line); `BoostPackagesPanel.tsx` (`deletion_pending` line); translations keys `plan.manage.ends_account_closing`, `plan.refusal.deletion_pending`, `plan.upgrade.refusal.deletion_pending`, `usage.boost.error.deletion_pending`. Each hunk goes to PLAN PAYMENTS' SA before merge.

---

## 12. Test plan (one-to-one with §7 DL-2)

All Jest with fakes or `jest.mock` seams, no network (`jest-no-network`), small fixtures, inside the existing job (no added CI time). Route tests cover happy path, auth failure and invalid input (§7 "All slices").

| §7 DL-2 criterion | Slice | Test(s) |
|---|---|---|
| The drawer shows the right dates for paid, free and Founding Partner accounts, in the owner's timezone, and the future-bookings count | 2a (pending view), 2b (drawer) | `closureStatusView.test.ts`: `pending` projects `closureLockAt(plan_ends_at, zone)` and marks it projected; `grace` uses stored `lock_at` / `lock_timezone`; `requesting` has no lock; NULL zone → UTC. `closureTimeline.test.ts`: renewing / cancelling / trialing → `paid` with the period end; no subscription or `ended_at` → `free` from now; `back_to_plan` (Founding Partner + paid plan) and `free_plan` mapped; `failing` → null; view throw → `unknown`. Zones Asia/Jerusalem and America/New_York, one DST week each way (not a midnight-DST zone, R-1). Drawer render: each timeline formats in `timeline.timezone`, not the browser's; bookings `0` → no line, `1` → `_one`, `null` → `_unknown`. Route: count error → `{ count: null }`, check still 200. `SchedulingRepository.countUpcomingBookings.test.ts`: filters `user_id`, the two statuses, `gte start_time`; error returned, not swallowed |
| "Export your data first" opens the export drawer | 2a | Drawer render: exactly one `DownloadMyDataButton` with `variant="button"` (mocked), and the source names no export route (`no-deletion-paths` check 4 stays green) |
| The banner shows on every Business OS page while pending, and goes after Keep | 2c | `readClosureNotice.test.ts`: no session / no row / error → null (warn), `pending` / `grace` → notice, `requesting` / `locked` → null. `ClosureBanner.test.tsx`: renders the date and Keep; after a 200 Keep calls `router.refresh`. Layout source scan: `readClosureNotice()` is inside the same `Promise.all` and `ClosureBanner` follows `PlanPaymentBanner` |
| Hebrew is right-to-left; keyboard only works end to end | all | `DeleteAccountDrawer.qa.keyboard.test.tsx` extended: Tab reaches export, the radio group (one stop, arrows move), textarea, submit; submit disabled until reason + statement; Enter submits; focus lands on the pending heading after success and on the message after Keep. RTL render: `dir="rtl"` on the container, the mailto `dir="ltr"` |

Also:

| # | Test | Asserts |
|---|---|---|
| T-1 | `deletionAnswers.test.ts` | every row of §5.4 and §5.5, including CR-6 (`status: null`) and CR-8 (`state_changed` + `kept`); a typed `Record` over `ClosureRequestRefusalCode` and `ClosureKeepRefusalCode` |
| T-2 | Drawer request body | posts exactly `{ statement, language, reasonCode }` with the picked code; never posts without a reason; never posts `other` by default (W-13); no `signOutUser`, no navigation |
| T-3 | Drawer copy keys | every `BLOCKER_CODES` member, including `payment_failed`, has an `en` / `he` / `es` key (extends `blockerCopy.test.ts`) |
| T-4 | Closure route | 401 without a session; 429 with `no-store`; error → 503; no row → `{ closure: null }`; a row → the view; the switch off does not change the answer; no reason code or email in the body or a log call (log spy) |
| T-5 | Danger Zone | open closure → pending view and the pre-check is never fetched; none → pre-check; closure error → pre-check; keep 200 → message stays, re-read, `router.refresh` |
| T-6 | Copy parity | every new key exists in en / he / es; `FALLBACK_COPY` equals `en` for every key it holds, including the 10 reused reason keys |
| T-7 | `planManageCopy` parity (2a) | `deletion_pending` maps to the new key; existing runtime parity test green |
| T-8 | Guards | callers guard (2a, 2c); `npm run test:bos-entitlements` green (2b registers one importer; run it in every slice anyway) |
| T-9 | Hand-over runs | `npm test -- app/api/business-os/account lib/business-os/account-deletion components/business-os/account-deletion components/business-os/purge hooks lib/repositories/__tests__ components/business-os/settings`, then `npm test`, `npm run lint`, `npm run lint:hooks`, `npm run test:bos-entitlements`, `npx tsc --noEmit` filtered to touched files with `NODE_OPTIONS=--max-old-space-size=8192` and the exit code checked; `npm run schema:check` before DL-2b code (D-11). Full-gate failures compared with clean `main`, de-duplicated |

**QA manual check (critical path, recorded in the QA report).** On a dev server with the switch on locally, keyboard only, in English and Hebrew: a `+test` free account opens Settings → Delete account, picks a reason, types the statement, requests → pending view with the lock date; Keep → "kept", the view clears. A paid sandbox account requests → pending view with the plan end and the projected lock; Settings → Plan → Keep my plan shows the deletion refusal line. DL-2b adds: the dates match the owner's timezone, and a seeded future booking after the lock shows the count. DL-2c adds: the banner on two other Business OS pages, gone after Keep. No real account; production is the user's own test account only (AgentsPilot `/v2` hosts are not clicked, per the parked-app preference).

---

## 13. Task list

**DL-2a**
- [x] 0. SA workplan review ✅ (approved with conditions); user decisions Q-1, Q-7, Q-13, Q-15 and W-1 (b) recorded (§ User Decisions); PLAN PAYMENTS told about the claimed lines (its acknowledgement and SA sign-off come later). Still owed before merge: user approval of the final DL-2a copy (IN-14) and PLAN PAYMENTS' SA sign-off.
- [x] 1. ✅ `closureStatusView.ts` + tests.
- [x] 2. ✅ `closureStatusDeps.ts`, schema, throttle key, closure route + route tests; callers guard entry; `no-deletion-paths` family 6 floor (W-4).
- [x] 3. ✅ `deletionAnswers.ts` + tests.
- [x] 4. ✅ `useAccountClosure.ts` (`useDangerZoneState`) + tests.
- [x] 5. ✅ `KeepAccountButton.tsx`, `ClosurePendingPanel.tsx`.
- [x] 6. ✅ Drawer rewrite: sections, reason picker, body, answers, removal of the old success path; tests (render, keyboard, RTL).
- [x] 7. ✅ `DangerZonePanel.tsx` state machine, headings, `FALLBACK_COPY`; tests.
- [x] 8. ✅ Translations (DELETE block + the three claimed keys, W-2); `planManageCopy.ts`, `planPurchaseCopy.ts` and Boost `problemFor` lines.
- [x] 9. ✅ Hand-over runs (T-9, results in IN-17); console.* check (none); workplan updated.

**DL-2b** (own branch from `main`: `feature/bos-deletion-dl2b-timeline-bookings`, `259a7e21`)
- [x] 10. ✅ Live schema check at `259a7e21` (IN-23).
- [x] 11. ✅ `countUpcomingBookings` + test, W-16 included (IN-24).
- [x] 12. ✅ `closureTimeline.ts` + tests (W-14 parity); `closureTimelineDeps.ts`; `KNOWN_NON_GATE_IMPORTERS` entry (IN-25).
- [x] 13. ✅ Check route `lang`, `timeline`, `futureBookings` + tests; hook passes `lang` (IN-27 to IN-29).
- [x] 14. ✅ Drawer "What happens next" section + tests; translations en / he / es + fallback; W-13 trial line (IN-26, IN-30, IN-31).
- [x] 15. ✅ Hand-over runs (IN-34).

**DL-2c** (own branch from `main`)
- [ ] 16. Claims acked by PLAN PAYMENTS.
- [ ] 17. `readClosureNotice.ts`, provider, banner + tests; layout wiring.
- [ ] 18. Plan card, checkout, upgrade, Boost lines + tests.
- [ ] 19. `/account-deleted` copy + test; privacy paragraph draft.
- [ ] 20. Translations; hand-over runs.

---

## 14. Risks and dependencies

| # | Risk / dependency | Effect | Handling |
|---|---|---|---|
| R-1 | **`startOfDayUtc` is an hour early on midnight-DST days** (Chile, Paraguay, Cuba), shared helper, owned by a separate task | A lock date computed for such a day shows the previous local date, in the pending view (2a) and the drawer (2b) | **Dependency, not fixed here.** DL-2 displays whatever `closureLockAt` returns; tests avoid those zones and do not pin the wrong value. The fix must land before DL-5 switch-on (DL-1b QA edge case 1) |
| R-2 | A `requesting` row left by P-7 / P-8 / P-9 (CR-9) | The owner sees "still setting up" with no Keep until DL-3 settles it | Honest copy; DL-3 obligation (b). With the switch on in production now, this can happen today |
| R-3 | No lifecycle email until DL-3 | The owner gets no "Deletion requested" email | No line promises one (D-9) |
| R-4 | "Booking links will say … no longer available online" (2b copy) is true only after DL-4b | Before DL-4b, a link still works after the lock; but nothing locks before DL-4 | The copy describes the state at switch-on; DL-5 switches on after DL-4b |
| R-5 | Projected lock moves | A pending owner who changes timezone, or whose plan end moves, sees a different date later | D-7; DL-3 fixes the date at C start; Q-8 |
| R-6 | PLAN PAYMENTS files in 2c | Calendar time for claims and their SA | 2c goes last; 2a has one claimed line only |
| R-7 | Live production with the switch on | Until DL-2a merges, every Delete press is a 400 | Nothing is written; DL-2a first and small |
| R-8 | **Once DL-2a merges, the request switch does real work in production** (SA W-1, W-11) | Any owner who opens the Danger Zone can file a real request: it turns off that account's real Stripe renewal, refuses its checkout, Boost and plain reactivate, and writes `pending` / `grace` rows whose lock date nothing acts on until DL-3 and DL-4 exist; no email is sent. A `grace` row's lock date can pass with nothing happening, and the panel then shows a closing date in the past | **User chose option (b), 2026-11-06:** `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` stays ON in production after DL-2a merges, because the user is only testing, on test accounts, and accepts that a test request really stops that account's Stripe renewal and starts a lock date that nothing acts on until DL-3 / DL-4. Keep stays reachable with the switch off (D-2), so turning it off later is safe. TL makes sure the user's own test rows are kept, or cleaned up, before their lock date (W-11). No code change |

---

## 15. Open questions with suggested answers

| # | Question | For | Suggested answer |
|---|---|---|---|
| Q-1 | The Keep button's words. The requirement calls it "Keep my account" everywhere (§3.4, §4, the email link) and its sibling on the plan card is "Keep my plan". The approved reactivate refusal says "Keep your account first", and must match the button. | User | Label it **"Keep my account"** (he "להשאיר את החשבון", es "Mantener mi cuenta", mirroring "Keep my plan" in each language) and change the approved line to "…Choose Keep my account first, then you can reactivate your plan." (§9.1, all three languages). Fallback with no re-approval: label it "Keep your account" and keep the line as approved |
| Q-2 | Three slices (2a 1.5 d, 2b 1 d, 2c 1.5 d) instead of two, 4 d instead of the requirement's 2 d | TL / SA | Yes: the proposed DL-2a was over the 2.5-day cap, and splitting gets the live fix out first |
| Q-3 | One scrolling form with sections, or a stepped drawer like the cancel? | SA | One form (D-4) |
| Q-4 | A new read route not behind the switch, rather than changing the pre-check's off contract | SA | New route (D-2) |
| Q-5 | What counts as a future booking? | BA / SA | `scheduling_bookings`, status `confirmed` or `pending`, start at or after the lock date; each package session counts; no `deleted_at` (D-11) |
| Q-6 | If the count cannot be read? | BA | Say "we couldn't count" and never block (D-12) |
| Q-7 | The request button's words now that nothing is deleted at once | User | "Ask to delete my account" (§9.1) instead of "Delete my account forever" |
| Q-8 | Show the projected lock date for a paid account as a firm date? | BA / SA | Yes, firm: it moves only if the plan end or the timezone moves, and DL-3 fixes it at the start of the 14 days |
| Q-9 | Banner for `requesting` and `locked`? | SA | No: `requesting` lasts minutes and has no Keep; `locked` cannot sign in |
| Q-10 | Read the closure in the layout always, or only while the switch is on? | SA | Always (D-13): a row can outlive the switch; one indexed parallel read |
| Q-11 | The five keys the drawer stops reading (`what_next`, `delete_button`, `deleting`, `delete_failed`, `files_removed_kept`) | SA | Remove them from en / he / es and `FALLBACK_COPY` in DL-2a if a grep finds no other reader; they are DELETE's own (S-7 allows it) and two of them are now false |
| Q-12 | Extract a shared reason-picker component for both drawers? | SA | No: same list and same keys, and `PlanCancelDrawer.tsx` stays untouched (D-5) |
| Q-13 | Hebrew register for new lines: plural imperative (as the existing deletion keys) while PLAN PAYMENTS' lines are impersonal | User | Keep each namespace's own register; a native check on all new Hebrew and Spanish |
| Q-14 | `/account-deleted` has no link to it until DL-4 | SA | Re-word it in DL-2c as the requirement places it; DL-4 decides whether the banned-login message links to it |
| Q-15 | Privacy paragraph: English only now? | User | Yes; Hebrew and Spanish after legal approval (open issue 2), as the doc says |
| Q-16 | Show "No refund for the current month" in the drawer for a paid account (reused cancel key)? | BA | Yes: the request stops renewal the same way the cancel does, and the owner should know the same fact |

---

## 16. Hand-overs from DL-1b, closed here

| DL-1b item | What it asked | Where closed |
|---|---|---|
| K-6 | The drawer still expects the old success shape | DL-2a §5.4 (removed; pending view) |
| W-13 / Q-12 | `reasonCode` required; never default to `other` | DL-2a §5.3, T-2 |
| CR-6 | `status: null` on `already_requested` means already requested | DL-2a §5.4, T-1 |
| CR-7 | KEPT audit after the Stripe call; change only if DL-2 shows the audit trail | DL-2 shows no audit trail to the owner: no change |
| CR-8 | `state_changed` + `kept` may show the kept screen | DL-2a §5.5, T-1 |
| CR-10 / IN-10 / review point d | `deletion_pending` placeholders in the copy maps and the Boost client | Plan manage in DL-2a §5.6; checkout, Boost in DL-2c §7.3; invite copy needs none (§7.3) |
| Q-7 | Upgrade shows "Keep your account first" for `subscription_cancelling` while a request is open | DL-2c §7.3 |
| §9 `payment_failed` | No drawer copy | DL-2a §9.1 |
| QA edge case 1 | Midnight-DST lock date | Dependency R-1 |

---

## User Decisions

| # | Date | Decision | Effect |
|---|---|---|---|
| Q-1 | 2026-11-06 | The Keep button is labelled **"Keep my account"** in all three languages: he "להשאיר את החשבון", es "Mantener mi cuenta". The approved reactivate line becomes "You asked us to delete your account, so this plan can't be reactivated. Choose Keep my account first, then you can reactivate your plan." | `account_closure.keep_button`; `plan.manage.refusal.deletion_pending` in en, with he / es adjusted to match (marked for a native check). The checkout and Boost lines moved into 2a by W-2 follow the same form |
| Q-7 | 2026-11-06 | The delete button label **stays as it is today, "Delete my account forever"**. This overrides the Dev and SA suggestion ("Ask to delete my account") | `settings.account_delete.request_button` carries the existing label in each language (en "Delete my account forever", he "מחיקת החשבון שלי לצמיתות", es "Eliminar mi cuenta para siempre") |
| Q-13 | 2026-11-06 | New Hebrew deletion lines use the **plural imperative**, like the existing deletion keys. The PLAN PAYMENTS lines stay impersonal. A native speaker checks the new he / es | Applied in `settings.account_delete.*` and `account_closure.*`; the three claimed lines keep "יש לבחור" |
| Q-15 | 2026-11-06 | (DL-2c, record only) The privacy paragraph is re-worded in **all three languages**, en / he / es, not English only | Supersedes §7.5 "English only" and the Q-15 suggestion; DL-2c drafts all three |
| W-1 | 2026-11-06 | **Option (b):** `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` stays ON in production after DL-2a merges. The user is only testing, on test accounts, and accepts that a test request really stops that account's Stripe renewal and starts a lock date that nothing acts on until DL-3 / DL-4 | Recorded as R-8 (§14). No code change |

---

## Implementation notes (DL-2a)

Dev, 2026-11-06, on `feature/bos-deletion-dl2-drawer-keep`. Each note names a choice the plan left open, or a departure from it, and why.

| # | Note |
|---|---|
| IN-1 | **Closure route (§5.1, W-4).** `GET /api/business-os/account/closure` reads nothing from the request but the session cookie, the correlation id and (for the throttle's hashed IP) the request itself; the header says so and why there is no input schema (W-4 c). Every answer is `no-store` (200, 401, 429, 503, 500); `details` only in development. Throttle `RATE_LIMITS.read`, key `account-closure:<hash>`. `maxDuration = 15`. The route test proves `?userId=<other>&status=locked&user_id=<other>` is ignored and the deps are called with the session id only (W-4 a), and parses the 200 with `closureStatusResponseSchema` |
| IN-2 | **`requesting` never reads the timezone and never has a date.** §5.1 S-5 said "pending (and requesting with a `plan_ends_at`)", but the wire comment says `lockAt` is null for requesting and the panel's `requesting_body` shows no date, so the zone read would be wasted. Only `pending` reads `findTimezone` (`needsTimezone`) |
| IN-3 | **W-4 d goes one step further than ruled:** when the zone read fails, a pending view sends `lockAt: null`, `timezone: 'UTC'` **and `planEndsAt: null`**, so the client cannot format the plan end on UTC either. The panel then shows `pending_body_nodate`, and a later Keep shows `kept.not_restored_by_choice_nodate`. The panel applies the same rule if only one of the two dates can be formatted |
| IN-4 | **`closureStatusDeps.ts`** is the only new file naming `AccountClosureRepository` (allow-listed in the callers guard). It maps the row to the five fields the view reads, treats a `kept` row as none (defensive: `findOpenForUser` already filters open statuses), and wraps `findTimezone` so it never throws |
| IN-5 | **`useAccountDeletionCheck` gained an additive `{ deferred: true }` mode with `start()`**, so `useDangerZoneState` can start the pre-check only when no request is open (D-3). Existing behaviour without the option is unchanged. Once a request has been seen open in one mount, a later "none" (after Keep) does not start the pre-check: the cleanup function would run for nothing while the kept line is shown |
| IN-6 | **For SA (rule 7, a new pattern): `useHostRefresh()` reads `AppRouterContext` from `next/dist/shared/lib/app-router-context.shared-runtime`** and calls `router?.refresh()`, instead of `useRouter()`. `useRouter()` throws outside an App Router, and every existing Danger Zone test (and any host rendered without one) would need a `next/navigation` mock. In production every host is an App Router page, so the refresh happens. Alternative if SA prefers: `useRouter()` plus a `jest.mock('next/navigation')` in the six suites that render the hosts. In 2a nothing server-rendered depends on the closure yet; the refresh matters from DL-2c (the banner) |
| IN-7 | **Focus (§8).** After a recorded request, focus moves to the pending view's **first line** (`tabIndex={-1}`), not a heading: the heading belongs to the host (the dialog description or the region's `h5`, both now `account_closure.heading`), and a second heading inside the panel would repeat it. After Keep, focus moves to the message |
| IN-8 | **Messages that must outlive the re-read** (every kept line, and `nothing_to_keep`) are lifted to the host as a fourth mode, `notice`, which replaces the panel until the dialog closes (§5.5 "The message stays on screen…"). The heading in that mode is `settings.account_delete.title`. Refusals that do not re-read (`request_in_progress`, `locked`, 429, 401, 5xx) stay inside the panel in `role="alert"`, and the Keep button's `aria-describedby` points at them. `state_changed` to anything but `kept` shows no message and re-reads |
| IN-9 | **Request answers beyond the §5.4 table:** a 200 whose body does not parse → `unconfirmed` (re-read); an unknown 5xx → `unconfirmed`; an unknown 4xx → `try_again`; a recorded request whose re-read finds nothing → the `unconfirmed` line; `already_requested` whose re-read finds nothing → the `already_requested` line (as planned) |
| IN-10 | **Host warning.** The host's "This will delete all your data and cannot be undone." shows only in today's mode; it is hidden in the drawer mode (as before), the pending mode and the notice mode, because a pending request deletes nothing yet |
| IN-11 | **PLAN PAYMENTS hunks (claims).** `planManageCopy.ts` and `planPurchaseCopy.ts`: the existing `deletion_pending` entry of each typed `Record` changes its value to the new key, with its comment; nothing else (a `Record` key cannot be added twice, so the "mapping" is the value). `BoostPackagesPanel.tsx` `problemFor`: one added line, `deletion_pending` → `usage.boost.error.deletion_pending`. Translations: three keys, each after its namespace's neighbours, each with a "DELETE claim" comment. Tests: one added row in PLAN PAYMENTS' `BoostPackagesPanel.buy.render.test.tsx`; the plan-copy pins are in a new DELETE-owned `deletionPendingCopy.dl2a.test.ts` rather than in PLAN PAYMENTS' `planManageCopy.test.ts`. One PLAN PAYMENTS pin had to move: `PlanManage.p7a1.qa.render.test.tsx` counts the `plan.manage.*` keys, 28 → 29 for `plan.manage.refusal.deletion_pending`, with a comment saying so |
| IN-12 | **Translations.** Per language: the five keys nothing reads are removed (W-9 / Q-11; a grep found no other reader), 28 DELETE keys and 3 claimed keys added. The `account_closure.*` keys sit just above the new `settings.account_delete.*` keys, because `planCancelCopy.test.ts` pins the SX-2 `settings.plan_cancel.*` block directly after the last `settings.account_delete` key. Lines holding an apostrophe are double-quoted, as elsewhere in the dictionaries; no backslash anywhere (the Tailwind scan hazard). `DangerZonePanel.test.ts`'s source parser read only single-quoted values, so it now reads either quote (and a CRLF line break); the byte-identical check is unchanged. `FALLBACK_COPY` holds every new key, the 10 reused reason keys, `plan.refusal.signed_out` and `settings.plan_cancel.review.no_refund` (W-8), byte-identical to `en`, and drops the five removed keys |
| IN-13 | **One new copy line not in §9.1:** `account_closure.grace_body_nodate` ("You can still sign in and export your data until your account closes."), for a `grace` row with no usable stored `lock_at`. That should not happen (the free path writes the lock date), but the panel must never format a null. For the user's approval with the rest |
| IN-14 | **Copy as applied:** Q-1 (button and the reactivate line in en / he / es), Q-7 (`request_button` = the existing label), Q-13 (registers), W-2 (checkout and Boost lines moved into 2a, in the Q-1 form "Choose Keep my account first"), W-10 (`requesting_body` gains "If this is still here tomorrow, contact us at {support}."). **W-13:** no 2a screen shows `no_refund` or a "you will not be charged" line (those are the 2b timeline's), so the trial variant is left to DL-2b; `no_refund` is only added to `FALLBACK_COPY` (W-8) |
| IN-15 | **Code moves.** `parseBlockers` moved from the drawer to `deletionAnswers.ts` (re-exported from the drawer, so existing imports keep working); `WithSupport`, `line` and `CopyFn` moved to `copyLine.tsx`, shared by the drawer, the panel and Keep. The drawer no longer imports `signOutUser`, `ACCOUNT_DELETED_PATH` or `isAccountDeletedRedirect`; `schemas.ts` keeps them for the page (§7.4). W-5: a source test pins that no client file imports `closureRequest.ts` / `closureKeep.ts` except by type, nor any repository, deps file, `closureDates`, `closureStatusView` or `businessDay`. W-12: no display-side DST compensation |
| IN-16 | **EXPORT notice.** The deletion drawer now renders `<DownloadMyDataButton variant="button" />` inside the settings dialog (S-4); the export drawer's stacking there is EXPORT MX-1b's (§11) |
| IN-17 | **Hand-over runs, 2026-11-07.** `npx tsc --noEmit -p tsconfig.json` with `NODE_OPTIONS=--max-old-space-size=8192`: ran to completion (no OOM), **0 errors in the touched files**, 1885 in total (all pre-existing, elsewhere; exit 2 from those). Jest: the account routes, `lib/business-os/account-deletion`, `components/business-os/account-deletion`, `components/business-os/purge`, `hooks`, `components/business-os/settings`, the Boost panels, `lib/business-os/boost` and `no-deletion-paths`: **130 suites, 3103 tests, all pass**. Every other suite that reads the dictionaries: 75 suites, 1844 tests, pass. `npm run test:bos-entitlements` (includes the callers guard): 348 suites, 10111 tests, pass. `npm run lint:hooks`: clean; eslint on the touched source files: clean. No CRLF failure appeared in these runs. `console.*`: none in any touched file. Not run: the full `npm test` gate and `npm run build` (RM's ship drill) |
| IN-18 | **SA CR-1 fixed (IN-6 withdrawn).** `useHostRefresh()` now calls `useRouter()` from `next/navigation` and `router.refresh()`; the `next/dist/...` import is gone. The `next/navigation` mock (`useRouter` → `{ refresh: mockRefresh, … }`) is added to every suite that renders a Danger Zone host: `DangerZonePanel.closure`, `.selfDelete`, `.qa.e1`, `.export`, `DeleteAccountDrawer.qa.keyboard`, and `hooks/useAccountClosure.test.tsx`. Other suites that touch the hosts already mock `DangerZonePanel` itself. The hook test now asserts `refresh` is called once per call; the closure suite asserts it for the dialog host and the boxed panel |
| IN-19 | **SA CR-2 fixed: focus is never left on a disabled or removed control.** One rule in the three components: when an answer leaves the owner on the same view, focus moves to the line that explains it, each with `tabIndex={-1}`. **Drawer:** every `message` outcome, and a recorded / already / unconfirmed request whose re-read does not find an open row → the `role="alert"` line; `blocked` → the blockers heading (`delete-account-blockers-title`). **Keep:** `aria-disabled` instead of `disabled` while in flight (styled with `aria-disabled:`; the `inFlight` ref still stops a second press), so a focused Keep keeps focus. **Panel:** a refusal (`keep_failed`, `requesting_body`, `locked_body`, 429, 401) → the refusal line; `state_changed` to another open state → `onReread` is now awaited (it returns the host's read promise) and focus moves to the new body line. New focus assertions (`document.activeElement`): every drawer `message` row, including 409 `plan_change_pending` with the button focused first; a 409 `blocked` → the heading; a network failure whose re-read finds nothing; a 503 Keep → the refusal line; `state_changed` → `locked` → the body line; Keep in flight is `aria-disabled`, not disabled, and stays focusable. jsdom does not blur disabled elements, so each assertion fails without the fix |
| IN-20 | **SA CR-3 fixed.** The W-5 pin now reads every `import … from` and `export … from` statement, single- or multi-line, with either quote, plus side-effect imports. It has a floor of at least one statement per file, and a check that every line starting `import` produced a statement. It checks the module specifier, not the whole statement. Positive control: the drawer's `export { parseBlockers } from './deletionAnswers'` and a planted multi-line double-quoted `import type {…}` are both found. Negative control: a value import of `closureRequest` is caught |
| IN-21 | **SA CR-7 done.** The `closureStatusViewSchema` comment now says `planEndsAt` is also null for a pending row when the timezone read fails (IN-3). CR-4 and CR-5 left alone, as ruled (CR-5 is a copy question for the user) |
| IN-22 | **Re-runs after the fixes, 2026-11-07.** tsc (8 GB heap): completed, no OOM, **0 errors in touched files**, 1885 in total (unchanged, pre-existing). DL-2a Jest set: **130 suites, 3107 tests, all pass** (+4 tests). `npm run test:bos-entitlements`: 348 suites, 10111 tests, pass. `npm run lint:hooks` and eslint on the changed files: clean |

---

## Implementation notes (DL-2b)

Dev, 2026-11-26, on `feature/bos-deletion-dl2b-timeline-bookings` (from `origin/main` `259a7e21`, DL-2a merged as #681). Each note names a choice the plan left open, or a departure from it, and why.

| # | Note |
|---|---|
| IN-23 | **Task 10, schema (read-only, live, measured at `259a7e21`).** A zero-row select of `scheduling_bookings.id, user_id, status, start_time`: ok. `deleted_at`: 42703 (does not exist; no filter on it). The exact §6.2 query (`head` count, `.eq user_id`, `.in status [confirmed, pending]`, `.gte start_time`) for a random uuid: ok, count 0. Negative control (a phantom filter column): rejected, so the probe could fail. `npm run schema:check` at the same ref: 25 of 783 selects fail, **none on `scheduling_bookings`** (all pre-existing, elsewhere). No row content read, nothing written |
| IN-24 | **The repository method sits on `SchedulingBookingRepository`** (the booking class in `SchedulingRepository.ts`; §6.2 says "SchedulingRepository"). Inputs are checked with Zod (`uuid`, `datetime({ offset: true })`) before any call (W-16). The PostgREST `error` is returned as it came (same object, tested). A head count with no number and no error is also an error, never a 0 (D-12). The production export is `schedulingBookingRepository` (service role); `user_id` is always the session subject |
| IN-25 | **`closureTimeline.ts`** holds two pure functions, `timelinePlan` (T-1, which wraps the request's own `classifyBillingRow`, W-14; `trialing` from `subscriptionStatus`, W-13) and `buildClosureTimeline` (T-3, T-4, through `closureLockAt`). It also holds `readClosureTimeline`, which runs T-1 to T-5 over injected ports and never throws: each failure is a value plus a note code for the route's log. T-4 (the plan ending view) and T-5 (the count) run in parallel. `closureTimelineDeps.ts` is the only file that imports entitlements (`readPlanEndingView`, `resolveAccountId`), with a tenancy header. It is registered in `KNOWN_NON_GATE_IMPORTERS` with exactly those two symbols. W-14 test: for a free fixture and a paid fixture, in two zones, the timeline equals what `runClosureRequest` writes (`lock_at` / `lock_timezone` for grace; `plan_ends_at`, plus the `closureStatusView` projection, for pending) |
| IN-26 | **W-13 trial line, for the user's approval:** new key `settings.account_delete.what_happens.paid_plan_end_trial`. en "Your plan runs until {planEnd}. It will not renew, and you will not be charged." · he "התוכנית פעילה עד {planEnd}. היא לא תתחדש, ולא תחויבו." · es "Tu plan sigue activo hasta el {planEnd}. No se renovará y no se te cobrará." When `trialing` is true, `settings.plan_cancel.review.no_refund` is also left out |
| IN-27 | **Departure, wire:** `timeline` and `futureBookings` are **optional** in `deletionCheckDataSchema`. The route always sends both, and the tests pin that. This lets a drawer built after DL-2b parse an answer from a server built before it, during a deploy. Absent means "this server does not say", and the section is not shown. `null` / `{ count: null }` means "could not be worked out", and the drawer says so. The `available: false` answer carries `timeline: null` and `futureBookings: { count: null }`, and the drawer hides the section there. The other direction cannot be helped: an old drawer bundle's `.strict()` schema rejects the two new keys, so a tab left open across the deploy shows today's body until it reloads. That is harmless and temporary |
| IN-28 | **`lang` is strict, so the query string is no longer ignored.** `?userId=…` (or any key other than `lang`, or a language outside en / he / es) is now a 400 `invalid_query` with `no-store`, before the session is read, and nothing else runs. The off switch still answers `{ enabled: false }` first, whatever the query (QA test extended). The old route test "the query string is ignored" became the 400 cases. `lang` picks only `planName`'s language |
| IN-29 | **Hook.** `deletionCheckUrl(language)` always sends `?lang=` (anything but en / he / es becomes `en`). `useAccountDeletionCheck({ lang })` reads the language at fetch time, so a language switch starts no read of its own. `useDangerZoneState({ lang })` passes it on, and `DangerZonePanel` gives it the `useCopy()` language (the `/v2` hosts send `en`). The six suites that matched the check URL exactly now compare the path only (one line each, no assertion weakened) |
| IN-30 | **Drawer.** The section (`whatHappens.ts`, a pure line builder; formatting with `formatAccountDay(iso, language, timeline.timezone)`, D-6) sits between sections 1 and 2. It shows whenever the check is `available`, with or without blockers. If a date will not format, the whole timeline falls back to the `general` line, never a sentence with a gap. A count that comes with no lock date shows `bookings_unknown`, which cannot happen from this server. **`bookings_one` written out in full** (the §9.2 cell said "rest as above, singular"), for approval: en "You have 1 client booking after {lockDate}. We won't cancel it or email your client, so please tell them yourself. Once your account closes, their booking link will say your business is no longer available online." · he "יש לכם הזמנה אחת של לקוח אחרי {lockDate}. אנחנו לא נבטל אותה ולא נשלח אימייל ללקוח, לכן חשוב שתעדכנו אותו בעצמכם. אחרי שהחשבון ייסגר, קישור ההזמנה שלו יראה שהעסק כבר לא זמין באינטרנט." · es "Tienes 1 reserva de un cliente después del {lockDate}. No la cancelaremos ni escribiremos a tu cliente, así que avísale tú. Cuando se cierre tu cuenta, su enlace de reserva indicará que tu negocio ya no está disponible en línea." All other lines are §9.2 as written, with the plural Hebrew register (Q-13). Dictionary keys sit straight after `already_requested`, so the `planCancelCopy` adjacency pin holds. `FALLBACK_COPY` holds all 12, byte-identical to `en` |
| IN-31 | **QA's D-9 pin ("no line promises an email")** in `deletionAnswers.dl2a.qa.screens.test.tsx` now exempts the two bookings lines. They name email only to say we will **not** email the clients (BQ-39). Instead, the pin checks that each of them carries that negation in en / he / es |
| IN-32 | **Housekeeping (brief item 6).** The `closureLifecycle.ts` header no longer names the removed `jobPolicy.ts` (comment only). The requirement's §3.6 now records the receipt export fields' meaning after EXPORT MX-7 (XC-12), with a Change History row. Left as is, and outside the brief: the header comment of `supabase/migrations/__tests__/business-os-account-closures.migration.test.ts` l.7 still says "the jobPolicy.ts precedent" |
| IN-33 | **For BA / SA (no change made):** when the timeline is `null` because the timezone read failed on a **free** account, the approved `general` line talks about "the period you paid for". That is slightly off for a free owner. A free variant would be one more key |
| IN-34 | **Hand-over runs, 2026-11-26/27, on the final diff.** T-9 Jest set (`app/api/business-os/account`, `lib/business-os/account-deletion`, `components/business-os/account-deletion`, `components/business-os/purge`, `hooks`, `lib/repositories/__tests__`, `components/business-os/settings`): **261 suites, 5841 tests, all pass**. `npm run test:bos-entitlements`: **350 suites, 10127 tests, pass**. `npm run lint:hooks`: clean (exit 0). eslint on the touched source and test files: 0 errors, 3 warnings, all pre-existing `any`s in `SchedulingRepository.ts` (l.77, 115, 141, none mine). `npx tsc --noEmit -p tsconfig.json` (8 GB heap): ran to completion, no OOM, semantic diagnostics present, **0 errors in touched files**, 1846 in total (pre-existing, elsewhere; exit 2 from those). **Full gate** (`npx jest --ci --maxWorkers=3`), de-duplicated against a `git archive` of clean `259a7e21` (scratchpad, `node_modules` junction), both runs in parallel. Baseline: 37 failed suites / 156 failed tests. DL-2b: 33 / 152. **Only in DL-2b: `deletionAnswers.dl2a.qa.screens.test.tsx`**, one `findByTestId` timeout in a 138 s suite under the double load. It passes alone twice (138 / 138) and in the T-9 set. Only in the baseline: `tailwind-css-escape.guard`, `BusinessDataExportRepository`, `security-definer-surface.guard` (the extracted tree's location and line endings, as in the DL-2a QA run), plus `PlanSection.render` and `jest-gate-check.g8` (flaky under load). Snapshots 148 / 148, none written. `console.*`: none in any touched file. No backslash in any added copy line; the new files pass Tailwind's escape decoder rule. Not run: `npm run build` (RM's ship drill) |
| IN-35 | **SA code review fixes (DL-2b), 2026-11-27.** **CR-1:** the VALUE of `settings.account_delete.what_happens.general` is re-worded in en / he / es and in `FALLBACK_COPY` (byte-identical to en), no new key and no wire change. It now holds for a free owner too (closes IN-33). The §9.2 row is updated. DL-2a's `account_closure.pending_body_nodate` is unchanged. No test pinned the old text: the DL-2b tests read the line from the dictionary. **CR-2:** the header comment of `supabase/migrations/__tests__/business-os-account-closures.migration.test.ts` now ends "(a precedent set by the old data-export job policy file, removed with the old ZIP export in EXPORT MX-7, 006cfc31)". Test file comment only, no migration. **Re-runs:** the T-9 set plus that migration suite: **262 suites, 5872 tests, all pass**. `tsc --noEmit` (8 GB heap): completed, no OOM, **0 errors in touched files**, 1846 in total (unchanged, pre-existing) |
| IN-36 | **QA note 2 safety net (user-approved, before the PR), 2026-11-27.** `formatAccountDay` throws a RangeError for a zone the runtime's Intl rejects: the server's Node may accept a zone that an older browser does not. `whatHappens.ts` now formats both timeline dates through `formatDaySafely`, which reads a throw as "cannot be formatted". So a bad zone or a bad instant both take IN-30's existing path. If the lock date fails, the whole timeline becomes the `general` line and any non-zero or unknown count shows `bookings_unknown`, never a broken date. If only the plan end fails, the timeline becomes `general` and the bookings line keeps its lock date. `formatAccountDay` (PLAN PAYMENTS') is unchanged. New tests in `whatHappens.dl2b.test.tsx`: `Invalid/Zone` for paid and free (it is asserted that `formatAccountDay` really throws), no throw, `general` only; the same zone with 3 bookings → `general` + `bookings_unknown`; a RangeError forced from `Date.prototype.toLocaleDateString` → the drawer renders and shows only `general`. **Re-runs:** DL-2b targeted set plus the closures migration suite: **264 suites, 5898 tests, all pass**. tsc (8 GB heap): completed, no OOM, **0 errors in touched files**, 1846 in total (unchanged) |

---

## SA Review Notes

### SA Workplan Review

**Reviewed by SA — 2026-11-06** (against `origin/main` `f594ba22`, the requirement §3.3, §3.4, §6.3, §7, §9, §10, §11, and the DL-1b hand-overs)
**Status:** ✅ Approved with conditions (W-1 and W-2 before DL-2a merges; W-4 to W-7 in the code)

**Live schema check (W-3).** Read-only, zero-row selects and head counts against the live database on 2026-11-06, run by SA. No row content was read and nothing was written.

| Claim | Live result |
|---|---|
| `scheduling_bookings.id, user_id, status, start_time` | exist |
| `scheduling_bookings.deleted_at` | **does not exist** (42703). D-11 is right to leave it out |
| `scheduling_bookings.status` values in use | `confirmed`, `pending`, `cancelled`, `completed`, `no_show` only, which matches the CHECK |
| Rows with `start_time` NULL | all are parent rows (`parent_booking_id` NULL), bought but not booked. There are no child rows with a NULL start. So `.gte('start_time', …)` leaves the parents out and counts each scheduled package session once |
| `user_preferences.timezone` | exists |
| `business_profiles.timezone` | **does not exist** (42703). The workplan never names it |
| `business_os_account_closures` columns that §5.1 reads | exist. `findOpenForUser` is indexed by `business_os_account_closures_one_open` (migration `20261093`) |

#### Findings

| # | Severity | Location | Finding | Ruling |
|---|---|---|---|---|
| W-1 | 🔴 High | §1, §14 R-7; production | **Once DL-2a merges, the request switch does real work in production for every owner, not just for testing.** Today the old drawer fails validation before anything is written, so having the switch on does nothing. After DL-2a, any owner who opens the Danger Zone can file a real request. That request turns off real Stripe renewal, and refuses that owner's checkout, Boost and reactivate. It writes `grace` rows whose lock date nothing will act on (DL-3 and DL-4 do not exist yet), and it sends no email. Keep works and stays reachable with the switch off (D-2), so turning the switch off is safe | **Condition before merge, decided by the user through TL:** either (a) turn the switch off when DL-2a merges and on only for a test window, or (b) confirm in writing that it stays on, knowing the above. Code can start now. Add this as R-8 in §14 |
| W-2 | 🟡 Medium | §5.6, §7.3, §2 | **DL-2a creates real pending rows, but the checkout and Boost refusals keep their placeholder lines until DL-2c.** Those lines are "Buying a plan is not open right now. Please try again later." and "Please try again in a moment." Both are untrue for this owner and invite pointless retries | **Move the two one-line copy-map entries into DL-2a:** `planPurchaseCopy.ts` `deletion_pending`, and BoostPackagesPanel's code-to-key mapping (the function is **`problemFor`**, not `refusalOf` as §7.3 says). Move their keys and §9.3 lines into §9.1 for approval, and add both to the DL-2a claim in §11. This adds about 0.25 d. The upgrade line stays in DL-2c: it needs the provider, and today's "Your plan is set to end, so it cannot be upgraded" is true. If the user picks W-1 (a) before DL-2a merges, this may stay in DL-2c |
| W-3 | ⚪ Info | §6.2, D-11, Q-5 | Schema verified (table above) | **Q-5 approved as written.** The Dev still runs `npm run schema:check` on `main` at task 10 and records the ref (skill rule 2) |
| W-4 | 🟡 Medium | §5.1, §12 T-4 | **Closure route contract and tests.** (a) The route takes no input, so "invalid input" means a request that tries to steer the read. Add a test where `?userId=<another uuid>&status=locked` is ignored and the repository is called with the session id only. (b) Every answer carries `no-store`, including 200, 401, 503 and 500. `details` is shown only in development. (c) The route header states that nothing from the request is read, so there is no input schema to apply (CLAUDE.md rule 2). The response is checked against `closureStatusResponseSchema` in the tests. (d) The wire's `timezone` has no defined value when `findTimezone` fails | (a) to (c) required. (d): when the zone read fails, send `lockAt: null` and `timezone: 'UTC'`, and the view uses the `_nodate` lines, so neither the plan end nor the lock date is formatted on a guessed zone. Pin this in `closureStatusView.test.ts`. Also add the closure route to the `arrayContaining` list in `no-deletion-paths` family 6, which is a cheap floor |
| W-5 | 🟡 Medium | §10.1 `deletionAnswers.ts`, hooks, components | **Client bundle safety.** `closureRequest.ts` has value imports (`planManageOffer`, `closureBlockers`). A value import from it into a `'use client'` file pulls server code into the bundle | Client files may import from `closureRequest.ts` and `closureKeep.ts` with `import type` only. Any constant the client needs goes in `schemas.ts` or a new import-free file. No `'use client'` file imports a repository, `closureStatusDeps.ts`, `closureStatusView.ts` or `closureDates.ts`. The plan meets this today. Keep it that way |
| W-6 | 🟡 Medium | §7.1 `readClosureNotice.ts`, D-13 | **The layout read.** (a) Identity comes from `getUser` in `@/lib/auth`, the TTL-cached call with in-flight dedupe that `readPaymentNotice` already makes. That adds no Auth round trip, which `readSessionSubject` would. This is acceptable because the read is display only, and every write still verifies the session itself. (b) The closure read and the timezone read run **in parallel**, so this member of the `Promise.all` costs one DB round trip, not two in a row. (c) The id comes from the session only, and the repository filters `user_id`. (d) It never rejects: test `getUser` throwing, the repository throwing (not only returning an error), and a timezone error. No deadline is needed, the same as `readPaymentNotice` and `readOwnerIdentity`. (e) The layout is already a registered entitlements importer, and its `symbols` must not change | Required. Optional (Low): have `readClosureNotice.ts` reuse `closureStatusDeps.ts` instead of becoming a second file that names `AccountClosureRepository` |
| W-7 | 🟡 Medium | D-14, §7.2, §7.3 | **Provider placement.** `AccountClosureProvider` must be an ancestor of `UpgradeModalProvider` and of every place `PlanManage`, `PlanUpgrade` and `BoostPackagesPanel` render. `useClosureNotice()` defaults to `null` and never throws, so those PLAN PAYMENTS components behave exactly as today wherever they render without the provider | Required. Add one render test per component with no provider, showing today's behaviour |
| W-8 | 🟢 Low | §8 `/v2` hosts, T-6 | `FALLBACK_COPY` also needs every **reused** key the `/v2` hosts reach: `plan.refusal.signed_out` (2a) and `settings.plan_cancel.review.no_refund` (2b), not only the 10 reason keys | Parity test T-6 covers every key the drawer, the pending panel and Keep read |
| W-9 | 🟢 Low | Q-11 | SA grep: the five keys are read only by `DeleteAccountDrawer.tsx`, the `FALLBACK_COPY` in `DangerZonePanel.tsx`, and three drawer tests | **Q-11 approved:** remove them in DL-2a, in en, he, es and the fallback, and update those tests |
| W-10 | 🟢 Low | §5.5 `requesting_body`, R-2 | With the switch on and no DL-3, a `requesting` row left by P-7, P-8 or P-9 never clears, so "Check back here in a few minutes" becomes false | Add `{support}` to the line, for example "…in a few minutes. If this is still here tomorrow, contact us at {support}." The user approves it with §9.1 |
| W-11 | 🟢 Low | §5.5, §14 | Until DL-3 and DL-4 exist, a `grace` row's lock date can pass with nothing happening, and the panel then shows a closing date in the past. This can only happen while the switch is on before DL-5 | No new copy. Record it under R-8 (W-1). TL makes sure the user's own test rows are kept, or cleaned up, before their lock date |
| W-12 | ⚪ Info | R-1 | **Midnight-DST.** DL-2 only shows `closureLockAt` and stored `lock_at` values, the tests avoid the affected zones, and nothing pins the wrong value. That is acceptable | **Accepted.** Do not compensate on the display side, for example by formatting `lockAt` a few hours later: that would hide the bug and disagree with what DL-3 stores. The DL-5 switch-on gate stays. The coordination row names the task that owns the fix |
| W-13 | 🟢 Low | §9.2 `paid_plan_end`, Q-16 | A `trialing` owner can request (user ruling 2026-11-04) but was never charged, so "you will not be charged again" and "No refund for the current month" read oddly for them | DL-2b's `paid` timeline carries `trialing: boolean`. When it is true, the drawer leaves out `no_refund`, and `paid_plan_end` reads "…It will not renew, and you will not be charged." (one trial variant line, for the user to approve). Otherwise Q-16 is approved |
| W-14 | 🟢 Low | §6.1 T-1 / T-3 | The drawer's dates must equal what the request then records | Build the timeline with the request's own helpers (`classifyBillingRow`, `isPaymentFailing`, `closureLockAt`), never a copy of them. Add one test where the timeline for a fixture equals the `plan_ends_at` and lock that `runClosureRequest` records for that fixture |
| W-15 | ⚪ Info | §10, §11 claims | Claims are complete for 2a and 2c, given W-2. `formatAccountDay` is an import-only dependency on a PLAN PAYMENTS file, so give PLAN PAYMENTS a notice that it must stay exported and client-safe. DL-2c's `PlanManage.tsx`, `PlanUpgrade.tsx` and `BoostPackagesPanel.tsx` import nothing from entitlements today, so no registry change. The only new entitlements importer is `closureTimelineDeps.ts`: a `KNOWN_NON_GATE_IMPORTERS` entry with `symbols` exactly `['readPlanEndingView', 'resolveAccountId']`, and a `why` saying it reads for display and refuses nothing. That follows the `business-os-entitlements` skill. The closure route and `readClosureNotice.ts` must not import `resolveAccountId`; they do not need it | As stated |
| W-16 | 🟢 Low | §6.2, §12 | Repository tests: also cover an invalid uuid and an invalid ISO each returning an error **with no DB call**, and the bound `error` coming back unchanged (not a `0`) | Required in DL-2b |

#### Rulings on the §15 questions

| Q | Ruling |
|---|---|
| Q-2 | **Approved: three slices.** Order: DL-2a, then DL-2b and DL-2c, each branched from `main` **after DL-2a merges**. DL-2b needs the drawer's section slot, and DL-2c needs `KeepAccountButton` and `closureStatusView`. Never stacked. DL-2b and DL-2c both touch the translations and `FALLBACK_COPY`, so whichever goes second rebases. Each slice can ship on its own once DL-2a is in. Estimates: DL-2a about 1.75 d with W-2, still under the 2.5 d cap. TL updates the §6.3 DL-2 row and the totals |
| Q-3 | One scrolling form (D-4). Approved |
| Q-4 | A new read route, not behind the switch (D-2). Approved |
| Q-5 | Approved; schema verified (W-3) |
| Q-6 | Approved: "we couldn't count", never a 0, never a blocker |
| Q-8 | Approved: show it as a firm date. It moves only if the plan end or the zone moves, and DL-3 fixes it when C starts |
| Q-9 | Approved: no banner for `requesting` or `locked` (see W-10) |
| Q-10 | Approved: always read, never behind the switch, under W-6 |
| Q-11 | Approved (W-9) |
| Q-12 | Approved: no shared component. `PlanCancelDrawer.tsx` stays untouched |
| Q-14 | Approved: re-word it in DL-2c. DL-4 decides the link |
| Q-16 | Approved, with W-13's trial exception |

**SA recommendation on the user questions** (the user decides): **Q-1:** label the button "Keep my account" in all three languages, as §3.4 and the email link already say, and approve the alternative reactivate line in §9.1. The requirement's "DL-2 copy" note expects that change. **Q-7:** "Ask to delete my account", because nothing is deleted at once and the old label would now be false. **Q-13:** keep each namespace's own Hebrew register, with a native check of all new Hebrew and Spanish. **Q-15:** English only for now. Hebrew and Spanish follow legal approval (open issue 2).

**What blocks DL-2a from starting:** only the coordination row for DL-2a, and PLAN PAYMENTS acknowledging the claimed lines (now `planManageCopy.ts`, plus `planPurchaseCopy.ts` and the Boost mapping under W-2). Code may start after that. **Before DL-2a merges:** the user's W-1 decision, user approval of the §9.1 copy (with W-2 and W-10, and Q-1 and Q-7), PLAN PAYMENTS' SA sign-off on the claimed hunks, and W-4 and W-5 in the code. W-6 and W-7 apply in DL-2c, and W-13, W-14 and W-16 in DL-2b.

### Approval
[x] Workplan approved, with the conditions above. Proceed to implementation of DL-2a once the coordination row and the PLAN PAYMENTS acknowledgement are in place

### SA Code Review (DL-2a)

**Code Review by SA — 2026-11-07** (uncommitted diff on `feature/bos-deletion-dl2-drawer-keep` against `origin/main` `f594ba22`, untracked files read directly)
**Status:** 🔄 Fix Required (CR-1 and CR-2, both small; SA re-checks the fix diff only, no full re-review)

**What SA ran.** Jest over the account routes, `components/business-os/account-deletion`, `components/business-os/purge`, `hooks/useAccountClosure.test.tsx`, `lib/business-os/account-deletion`, the two PLAN PAYMENTS suites with claimed rows, `deletionPendingCopy.dl2a.test.ts`, the callers guard and `no-deletion-paths`: **49 suites, 1224 tests, all pass**. `npx tsc --noEmit` with `NODE_OPTIONS=--max-old-space-size=8192`: ran to completion (diagnostics printed, no OOM), 1885 errors in total, **0 in any touched file**. Every key the drawer, the pending view and Keep read (literal and built: the 7 reasons, the 9 blocker keys) has a `FALLBACK_COPY` entry. No backslash in any added copy line. No `console.*` in any touched file.

#### SA conditions, checked in the code

| Condition | Verdict | Evidence |
|---|---|---|
| W-2 checkout and Boost lines in 2a | ✅ Met | `planPurchaseCopy.ts` `deletion_pending` → `plan.refusal.deletion_pending`; `BoostPackagesPanel.tsx` `problemFor` one added line; keys in en / he / es; pinned in `BoostPackagesPanel.buy.render.test.tsx` and `deletionPendingCopy.dl2a.test.ts` |
| W-4 (a) request cannot steer the read | ✅ Met | `route.test.ts` `?userId=<other>&status=locked&user_id=<other>` → deps called with the session id only, and the other id is in no log call |
| W-4 (b) `no-store` on every answer, `details` dev-only | ✅ Met | `route.ts` `json()` helper on 200 / 401 / 503 / 500, `Cache-Control` set on the 429; tests for each, and for `details` in production and development |
| W-4 (c) header says no input is read; answer checked against the schema | ✅ Met | `route.ts` header l.14–20; the 200 is parsed with `closureStatusResponseSchema` in the test |
| W-4 (d) timezone read fails → no date on a guessed zone | ✅ Met (and IN-3 goes further, accepted below) | `closureStatusView.ts` l.111–136; pinned in `closureStatusView.test.ts` and the route test |
| W-4 family 6 floor | ✅ Met | `no-deletion-paths.guard.test.ts` `arrayContaining` now names the closure route; nothing removed |
| W-5 client bundle safety | ✅ Met | No `'use client'` file value-imports `closureRequest.ts` / `closureKeep.ts`, a repository, a deps file, `closureDates`, `closureStatusView` or `businessDay`. `deletionAnswers.ts` uses `import type` for both closure modules. `schemas.ts`' one new value import (`closureLifecycle.ts`) is import-free. `formatAccountDay`'s file has a type-only import. No new entitlements import anywhere in the diff, so no registry change is owed |
| W-8 fallback holds every reused key | ✅ Met | The 10 reason keys, `plan.refusal.signed_out` and `settings.plan_cancel.review.no_refund` are in `FALLBACK_COPY`, byte-identical to `en` (parity test green) |
| W-9 five unread keys removed | ✅ Met | Gone from en / he / es and the fallback; pinned by `DeleteAccountDrawer.qa.keyboard.test.tsx` "Q-11" |
| W-10 `requesting_body` names support | ✅ Met | en / he / es and the fallback carry "If this is still here tomorrow, contact us at {support}." |
| W-12 no display-side DST compensation | ✅ Met | `closureStatusView.ts` returns `closureLockAt` as is; `ClosurePendingPanel.tsx` formats the instant on the wire zone, nothing added |

#### The closure route

Identity from `readSessionSubject()` only; nothing read from the request but the correlation id and the throttle's hashed IP; `no-store` everywhere; error format with `details` only in development; Pino with `logger.child({ correlationId })` and the subject id, never the reason, language or email (tested); throttle `RATE_LIMITS.read` on a hashed `account-closure` key; DB access only through `closureStatusDeps.ts` (repositories, `user_id`-filtered, tenancy header per `tenant-isolation-guard`, allow-listed in the callers guard); not behind the switch (tested with the flag unset, `false` and `true`). **Approved.**

#### Answer mapping

Every request code (`CLOSURE_REQUEST_REFUSAL_STATUS` plus the route's own 401, 404 `not_found`, 400 `invalid_body` / `statement_mismatch`, 413, 429) and every Keep code (`CLOSURE_KEEP_REFUSAL_STATUS` plus 400, 401, 429, 500) has an outcome. The two maps are `Record`s over the server's code unions, so a new code fails the build. CR-6 (`already_requested` with `data.status: null`) → `already` → re-read; CR-8 (`state_changed` + `kept`) → the kept screen; both tested. The request body is exactly `{ statement, language, reasonCode }`, `reasonCode` is state that starts `null` and the submit refuses without it, so nothing is ever defaulted (T-2 tests it, Enter included).

#### Production coherence (W-1 option b)

With the switch ON: the closure read answers none → the pre-check is started → the form → 200 → the host re-reads → the pending view with focus on its first line → Keep → the kept line, which stays. With the switch OFF and a row open: the closure read alone shows the pending view and Keep (`DangerZonePanel.closure.test.tsx` "switch off … Keep is still reachable"). **DL-2a alone gives a working request → pending → Keep loop.** No copy promises an email (checked in en, he, es).

#### Code Review Comments

| # | Severity | Location | Finding | Ruling |
|---|---|---|---|---|
| CR-1 | 🟡 Medium | `hooks/useAccountClosure.ts:30`, `:128–133`; `components/business-os/purge/__tests__/DangerZonePanel.closure.test.tsx:23` | **IN-6: the new pattern is rejected.** `next/dist/shared/lib/app-router-context.shared-runtime` is an undocumented Next internal. It has been renamed before (13.x `app-router-context` became `.shared-runtime`), and nothing tells us when it moves again. Worse, `router?.refresh()` hides the failure: if the import ever resolves to a different module instance from the one Next provides, `useContext` answers `null` and the refresh silently never happens, with every test still green. The cost of the public API is small: 74 suites in this repo already `jest.mock('next/navigation')`, so that is the established pattern | **Must fix.** Use `useRouter()` from `next/navigation` and add the `next/navigation` mock to the suites that render a Danger Zone host. Every real host is an App Router page. Change the `useHostRefresh` test so it asserts that `refresh` is called, instead of "does nothing without a router" |
| CR-2 | 🟡 Medium | `DeleteAccountDrawer.tsx:182`, `:241`, `:254`, `:123–137`; `KeepAccountButton.tsx:222`; `ClosurePendingPanel.tsx:105–112` | **Focus is lost on every refusal path.** While a request is in flight, the fieldset, the textarea and the submit button are all `disabled`, so the element that holds focus is disabled. While Keep is in flight, the Keep button is `disabled`. Chrome then drops focus to `<body>`, and when the answer is a refusal nothing puts it back. In the `/v2` boxed panel there is no focus trap, so a keyboard user restarts from the top of the page. Two more cases: a 409 `blocked` unmounts the form that held focus, and `state_changed` to `locked` unmounts the Keep button. jsdom does not blur disabled elements, so the current tests cannot see any of this. §7 DL-2 requires "keyboard only works end to end" | **Must fix.** One rule: when the focused control is disabled or removed and the answer leaves the owner on the same view, move focus to the line that explains what happened. That line is the request's `role="alert"` line, the blockers heading, the Keep refusal line, or the pending body after a `state_changed` re-read; each gets `tabIndex={-1}`. On Keep, an alternative is to drop `disabled` for `aria-disabled` (the `inFlight` ref already blocks a second press). Add focus assertions (`document.activeElement`) for a 409 `plan_change_pending` request, a 409 `blocked` request, a 503 Keep and `state_changed` → `locked` |
| CR-3 | 🟢 Low | `components/business-os/account-deletion/__tests__/deletionAnswers.test.ts:114–119` | The W-5 source pin passes vacuously if its import regex matches nothing: the `?? []` hides a formatting change, a double-quoted specifier or a multi-line `import type {…}`. It also ignores `export … from` (the drawer re-exports from `deletionAnswers`) | Add a floor (at least one matched statement per file) and include `export … from` statements. Fix with CR-1 and CR-2 |
| CR-4 | 🟢 Low | `components/business-os/purge/__tests__/DangerZonePanel.test.ts:138–140` | A fallback key whose value the parser cannot read (in the fallback block) is skipped by the byte-identical check, not failed. This hole predates DL-2a. The IN-12 parser change narrows it, because double-quoted values were silently skipped before | Optional: assert that every `fallbackKeys` entry parses in `fallbackBlock` too. Not a blocker |
| CR-5 | 🟢 Low (copy, for the user) | `DeleteAccountDrawer.tsx:151`; `DangerZonePanel.tsx` `HEADING_KEY.notice` | Two lines may now read oddly. (a) Section 1 still opens with `settings.account_delete.warning` ("…It cannot be undone…"), above a request the owner can Keep until the lock. §5.3 kept it because it is true at E. (b) In notice mode the dialog description reads "Delete my account" above "Your account is kept." | No code change unless the user re-words. TL puts both to the user with the IN-13 / IN-14 copy approval |
| CR-6 | ⚪ Info | `app/api/business-os/account/closure/route.ts:62–68` | A session check that throws answers 401, not 503. The client treats any non-200 as `error` and falls back to the pre-check (D-3), so the owner sees the same thing either way | Accepted as is |
| CR-7 | ⚪ Info | `lib/business-os/account-deletion/schemas.ts` `closureStatusViewSchema` comment | The comment says `lockAt` is null on a timezone failure, but not that `planEndsAt` is null too (IN-3) | Optional one-line comment fix |

#### Rulings on the implementation notes

| IN | Ruling |
|---|---|
| IN-1 | ✅ Accepted. Matches W-4 (a) to (c) |
| IN-2 | ✅ Accepted. `requesting` shows no date, so reading the zone would be wasted work. §5.1 S-5's "requesting with a `plan_ends_at`" is superseded by the wire comment. `needsTimezone` is pinned |
| IN-3 | ✅ Accepted. A stricter W-4 (d): no date of any kind on a guessed zone, and the `_nodate` line on Keep follows. See CR-7 for the comment |
| IN-4 | ✅ Accepted. Treating a `kept` row as none is defensive and harmless |
| IN-5 | ✅ Accepted. Additive. Without the option, behaviour is unchanged. The `started` ref also stops a second pre-check under StrictMode's double effect, which is better than before. Not re-running the pre-check after Keep is right (D-3) |
| IN-6 | ❌ **Rejected (CR-1).** Use `useRouter()` from `next/navigation` and mock `next/navigation` in the host suites |
| IN-7 | ✅ Accepted. The host owns the heading (the dialog description or the region's `h5`). Focusing the first line avoids a repeated heading, and the keyboard test pins it |
| IN-8 | ✅ Accepted. Notice mode is the right home for a message that must outlive the re-read. To act again, the owner closes and reopens, which remounts the host. The focus gaps on the in-panel refusals are CR-2 |
| IN-9 | ✅ Accepted. An answer we cannot read never claims either outcome |
| IN-10 | ✅ Accepted. A pending request deletes nothing, so the "cannot be undone" host warning is rightly hidden (and see CR-5 a for the drawer's own warning) |
| IN-11 | ✅ Accepted, **subject to PLAN PAYMENTS' SA sign-off before merge**. In spirit the hunks are add-only. Two values change (`deletion_pending` placeholders, which DL-1b said DL-2 would replace) and two lines are added (Boost `problemFor` and the Boost test row). Nothing else in those files is touched. The 28 → 29 pin is a real count change, commented |
| IN-12 | ✅ Accepted. The key placement respects the `planCancelCopy` pin. The parser change reads either quote and CRLF, and keeps the byte-identical check, so it is stronger, not weaker (CR-4 is the leftover hole) |
| IN-13 | ✅ Accepted as code. The panel must never format a null. The line needs the user's approval with the rest |
| IN-14 | ✅ Accepted. The user's approval of the final 2a copy and the native he / es check are still owed before merge |
| IN-15 | ✅ Accepted. The re-export keeps old imports working. The W-5 pin is CR-3 |
| IN-16 | ✅ Accepted. EXPORT MX-1b owns the stacking |
| IN-17 | ✅ Accepted, and reproduced by SA for the subset and the typecheck. RM still runs the full gate and `npm run build` (ship drill) |

### Code Approved for QA: No

**Blocks QA:** CR-1 and CR-2 (code plus their tests), with CR-3 in the same pass. SA re-checks only the fix diff. **Before merge, not before QA:** PLAN PAYMENTS' SA sign-off on the claimed hunks (IN-11), the user's approval of the DL-2a copy (IN-13, IN-14, CR-5) and the native he / es check.

### SA Code Review Re-check (DL-2a)

**Re-checked by SA — 2026-11-08** (the fix diff only, IN-18 to IN-22)
**Status:** ✅ Code Approved

**What SA ran.** Jest over the DL-2a set, plus every suite that renders or scans a Danger Zone host (`app/business-os/settings`, `app/admin/settings`, `components/business-os/data-export`, `DangerZonePanel.export`): **66 suites, 1490 tests, all pass**. SA did not re-run tsc. The fix diff changes no signature that a file outside this set imports, and the Dev's run (IN-22) shows 0 errors in touched files.

| CR | Verdict | Evidence |
|---|---|---|
| CR-1 | ✅ Fixed | `useHostRefresh()` calls `useRouter()` from `next/navigation`. No `next/dist/...` import is left in `hooks/`, `components/business-os/` or the account routes. The host suites mock `next/navigation`: `.closure`, `.selfDelete`, `.qa.e1`, `.export`, the keyboard suite and the hook test. Every other suite that reaches a host either mocks `DangerZonePanel` or is a source scan, and all pass. The tests now assert that `refresh` is called |
| CR-2 | ✅ Fixed | **Drawer:** a `message` outcome, and a recorded, already or unconfirmed request whose re-read finds no open row, all focus the `role="alert"` line. `blocked` focuses the blockers heading. Each target has `tabIndex={-1}` and sits outside the disabled fieldset. **Keep:** uses `aria-disabled` while in flight; the `inFlight` ref still stops a second press. **Panel:** a refusal focuses the refusal line. `state_changed` awaits the host re-read, then focuses the body line. `activeElement` assertions cover each path: `plan_change_pending` with the button focused first, `blocked`, a network failure, a 503 Keep, `state_changed` → `locked`, and a busy Keep that stays focused |
| CR-3 | ✅ Fixed | The W-5 pin now reads `import`/`export … from` and side-effect imports, single- or multi-line, with either quote. It has a per-file floor and an "every `import` line produced a statement" check, and it matches on the specifier. Positive and negative controls are included |
| CR-7 | ✅ Fixed | The `closureStatusViewSchema` comment now says `planEndsAt` is also null for a pending row when the timezone read fails |
| CR-4 | Left as ruled (optional) | — |
| CR-5 | ✅ **Settled by the user, 2026-11-08:** keep `settings.account_delete.warning` exactly as it is ("…It cannot be undone and we cannot recover anything."). No change | — |

**One Info note, no change needed.** If `state_changed` re-reads to no open row, the panel unmounts before it can take focus. That is the rare case where a second tab kept the account and the server's `data.status` was not `kept`. The host then shows today's body. This is an edge case and the owner is not misled.

**Conditions:**
- **IN-11 PLAN PAYMENTS sign-off:** ✅ Met. PLAN PAYMENTS' SA approved its hunks, IN-11 included, with no must-fix.
- **Still owed before merge, not before QA:**
  - The user's approval of the rest of the DL-2a copy, including IN-13's `grace_body_nodate`.
  - The native he / es check.
  - RM's full gate and `npm run build`.

### Code Approved for QA: Yes

### SA code review (DL-2b)

**Code Review by SA — 2026-11-27** (uncommitted diff against `259a7e21`, IN-23 to IN-34)
**Status:** ✅ APPROVED WITH FIXES

**What SA ran.** Jest over the DL-2b set: the deletion-check route (unit + QA), `closureTimeline`, `countUpcomingBookings`, `whatHappens.dl2b`, the two hook suites, `components/business-os/purge` and `enforcementPoints`: **19 suites, 424 tests, all pass**. SA did not re-run tsc or the full gate; IN-34's run stands, and RM still owes the full gate and `npm run build`.

#### Standards and conditions, checked in the code

| Check | Result |
|---|---|
| Rule 1, repository pattern | ✅ The only new DB read is `SchedulingBookingRepository.countUpcomingBookings`; the timezone goes through `userPreferencesRepository.findTimezone`. No Supabase call in the route, the deps file or the drawer |
| Rule 4 / tenant isolation | ✅ Both service-role reads take only `subject.id` from `readSessionSubject()`; `.eq('user_id', userId)` is present; the deps header documents why the service role is safe. No request value reaches an id |
| Rule 2, Zod on input | ✅ `deletionCheckQuerySchema` (`.strict()`, enum, default `en`) is parsed after the off switch and before the session, with the standard error format (`details` behind the development guard) and `no-store` |
| Rule 3, Pino | ✅ No `console.*` in any touched file. The route logs codes only (`notes`, `timeline.kind`, the count); the repository logs `{ err }` |
| Rule 5 / no hardcoding | ✅ No model names; statuses and `GRACE_DAYS` come from their single sources |
| Entitlements registration | ✅ `closureTimelineDeps.ts` is the only importer, registered in `KNOWN_NON_GATE_IMPORTERS` with exactly `readPlanEndingView` and `resolveAccountId`; the route imports the deps file, not the module. Display only, no `check()` / `decide()` |
| Client-bundle safety (W-5) | ✅ `whatHappens.ts` imports types from `schemas.ts`, `GRACE_DAYS` from the import-free lifecycle file and the client-safe `formatAccountDay`; `closureTimelineDeps.ts` is `server-only` |
| W-13 | ✅ `trialing` is set from `subscriptionStatus === 'trialing'` on top of the request's own `classifyBillingRow`; the drawer swaps in `paid_plan_end_trial` and leaves out `no_refund`. The key `settings.account_delete.what_happens.paid_plan_end_trial` exists in en / he / es and in `FALLBACK_COPY` (byte-identical to en) |
| W-14 | ✅ `timelinePlan` wraps `classifyBillingRow`, and the dates come from `closureLockAt` (no copy of either); the parity test runs `runClosureRequest` for free and paid fixtures in two zones |
| W-16 | ✅ An invalid uuid and an invalid instant each return an error with no DB call; the bound `error` comes back as the same object; a head count with no number is an error, never 0 (D-12) |
| `bookings_one` | ✅ Written out in full in all three languages, singular throughout (en "it / your client / their booking link"; he "אותה / ללקוח / אותו / שלו"; es "la / tu cliente / avísale / su enlace"). Hebrew keeps the plural-addressee register (Q-13). Needs the user's approval with the rest of §9.2 |

#### Code Review Comments

| CR | Severity | Where | Issue | Exact fix |
|---|---|---|---|---|
| CR-1 | 🟢 Low (copy, for the user's approval) | `settings.account_delete.what_happens.general` in en / he / es and `FALLBACK_COPY` | `timeline: null` covers free owners too (a timezone read failure, and the open-checkout `refuse` on a free row), and the line says "Your plan runs until the end of the period you paid for". That is untrue for a free owner. See ruling 7 | Replace the value of the existing key (no new key, no wire change) with: **en** "You will have {days} days to sign in and export your data before your account closes. If you have a paid plan, those days start when the period you paid for ends." · **he** "יהיו לכם {days} ימים להתחבר ולייצא את הנתונים לפני שהחשבון ייסגר. אם יש לכם תוכנית בתשלום, הימים האלה מתחילים כשהתקופה ששילמתם עליה מסתיימת." · **es** "Tendrás {days} días para iniciar sesión y exportar tus datos antes de que se cierre tu cuenta. Si tienes un plan de pago, esos días empiezan cuando termina el periodo que pagaste." Keep `FALLBACK_COPY` byte-identical to en, update any test that pins the old text, and update the §9.2 row |
| CR-2 | 🟢 Low (comment only) | `supabase/migrations/__tests__/business-os-account-closures.migration.test.ts` l.7 | It still says "the jobPolicy.ts precedent", a file that EXPORT MX-7 removed. See ruling 8 | End that sentence with the wording used in `closureLifecycle.ts`: "…when the two disagree (a precedent set by the old data-export job policy file, removed with the old ZIP export in EXPORT MX-7, 006cfc31)." Test file only; no migration file is touched |

Neither blocks QA. Both go in before merge, CR-1 together with the user's §9.2 approval.

#### Optimisation Suggestions (not required)

- `deletionAnswers.dl2a.qa.screens.test.tsx` D-9 pin: rather than skipping the promise regex for the two bookings keys, strip the matched negation phrase and still run the promise regex on what is left. Then a later edit that adds a real promise to those lines is still caught.
- On a `plan_refused` timeline the count is never attempted, yet the drawer says "We couldn't count your upcoming client bookings". In effect that is true, and a refused owner sees the reason elsewhere, so no change now. If DL-2c touches this file, consider counting from `now` on that path, or hiding the bookings line when the note is `plan_refused`.

#### Rulings on the questions

| # | Ruling |
|---|---|
| 1 (IN-27) | ✅ **Accepted.** §6.1 said an older drawer "still parses"; with `.strict()` it does not, and Dev was right to flag it. A tab left open across the deploy gets a parse error, so it shows today's body until it reloads. Nothing wrong is shown and no request goes out. Making the fields optional for the other direction (new drawer, old server) is the right defensive choice. The route tests pin that both fields are always sent, so the optional status cannot hide a server regression |
| 2 (IN-28) | ✅ **Accepted; keep it strict.** The design asked for `.strict()` and "anything else is 400". The only caller is our hook, which sends exactly `?lang=`. Stripping unknown keys would quietly accept `?userId=`, the IDOR probe pattern the identity sweep closed; a 400 is clearer to the caller and in the logs. The off switch still answers first (QA pin), so a disabled environment does not change shape. Replacing the old "query string is ignored" test with the 400 cases is correct |
| 3 (IN-24) | ✅ **Accepted.** `SchedulingBookingRepository` owns `scheduling_bookings`, so that class is the right home; §6.2's "SchedulingRepository" meant the file. A head count with `count === null` and no error must be an error. A 0 there would tell an owner with bookings that they have none, which D-12 forbids |
| 4 (IN-31) | ✅ **Accepted.** D-9 forbids promising an email. These two lines say the opposite: we will not email the clients (BQ-39). Checking for the negation in each language is a stronger pin than a bare exemption. See the optional suggestion above to tighten it further |
| 5 (IN-29) | ✅ **Accepted.** Matching the path only is the minimum change, and it weakens no assertion: the URL with `?lang=` is pinned exactly in `useAccountDeletionCheck.dl2b.test.tsx` (en / he / es and the fallback to en) |
| 6 (IN-30) | ✅ **Accepted.** Showing the section beside blockers tells the owner what will happen once the blocker is cleared, and its lines make no promise the blocker contradicts. If a date will not format, falling back to the whole `general` line is better than a sentence with a gap. With CR-1, that line is true for every owner |
| 7 (IN-33) | **Reword `general`; do not add `general_free` (CR-1).** Reasoning: (a) as the wire stands, the drawer cannot choose a `general_free` key, because `timeline: null` carries no plan kind. It would also need a new wire field (such as `planKind` on the null path), which means new scope, new tests and one more state to keep true. (b) Accepting the line as it is means a free owner, in a rare failure, reads that they paid for a period. That is a small untruth on the screen where trust matters most, where the owner is deciding to delete their account. (c) One plan-neutral sentence is true for free, paid and refused owners alike. It costs no new key and no new code path, and it goes to the user with the §9.2 approval that is owed anyway. The Hebrew keeps the plural-addressee register of the other deletion lines |
| 8 | **Fix it in this slice (CR-2).** It is a comment-only change in a test file, it follows on from IN-32's `closureLifecycle.ts` fix, and leaving it sends a reader looking for a file that is gone. The applied migration itself is not touched |

**Conditions:**
- **Before QA:** none. QA may start on this diff.
- **Before merge:** CR-1 and CR-2 (SA re-checks only that diff); the user's approval of the §9.2 copy, including the W-13 trial line (IN-26), `bookings_one` (IN-30) and the reworded `general` (CR-1); the native he / es check; RM's full gate and `npm run build`.

**SA re-check, QA note 2 (IN-36) — 2026-11-27:** ✅ Approved. `formatDaySafely` (catch → null) wraps `formatAccountDay` for both `lockAt` and `planEndsAt`; `formatAccountDay` itself is unchanged; a throw now takes the same IN-30 fallback paths; the 3 new tests pass (suite 29 / 29).

### Code Approved for QA: Yes (DL-2b)

---

## QA Testing Report

### QA Testing Report (DL-2a)

**QA — 2026-11-08** (uncommitted diff on `feature/bos-deletion-dl2-drawer-keep`, base `origin/main` `f594ba22`)
**Verdict:** ✅ **PASS WITH NOTES**. No bugs. Three low edge cases and two copy notes, none blocking.
**Test mode:** full
**Strategy used:** A (unit) and B (integration). The B part is a real round trip: the real Danger Zone dialog host is rendered, and its `fetch` calls the REAL route handlers (`POST …/account/delete`, `GET …/account/closure`, `POST …/account/keep`). Only the seams are mocked: the session, the throttle, the audit flush, the logger, and the three production ports (`closureRequestDeps`, `closureStatusDeps`, `closureKeepDeps`). The three ports share one in-memory closure table, so the closure route reads what the request wrote, and Keep moves that same row. jsdom has no Fetch API classes, so the test takes `Request`, `Response` and `Headers` from undici before `next/server` loads.
**Focus:** all (api, ui, schema, security)
**Skipped:** the manual browser check (Option D). Playwright is not installed, and the dev server needs the prod env. Keyboard and RTL are covered in jsdom with user-event instead. QA did not re-run tsc; Dev's IN-22 run showed 0 errors in the touched files, and ts-jest type-checked the two new QA files.
**Input source:** the TL prompt (items 1 to 9)

#### Test coverage

| # | Item / acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|---|
| 1 | The drawer body passes the real `.strict()` schema | ✅ | Pass | Round trip in en, he and es. The body posted is exactly `{ statement, language, reasonCode }` with the picked code. The real route answers 200 and writes a `pending` row. The OLD body (no `reasonCode`) sent to the same real route → 400 `invalid_body`, and nothing is written |
| 2 | Every request and Keep answer maps to a line on screen in en, he and es | ✅ | Pass | 22 request answers, 3 `blocked` variants and 17 Keep answers, each rendered in the real dialog host in all three languages (126 cases). Each line is compared with that language's own dictionary line, so a missing he or es key fails the test instead of quietly falling back to English. No raw key, no empty line and no unfilled `{slot}` appeared. The cases include CR-6 (`already_requested` + `status: null`), CR-8 (`state_changed` + `kept`), `state_changed` → `locked` (the body re-renders and no message shows), P-8, `outcomeUnknown`, 413, 418, 401 and network failures. Focus lands on the explaining line each time (IN-19) |
| 3 | `GET /api/business-os/account/closure` | ✅ | Pass | `?userId=` / `?user_id=` / `?status=` pointing at another user's `locked` row are ignored: only the session id is read, and the answer is `{ closure: null }`. `no-store` is set on 200, 401 and 503. Signed out → 401. A read error → 503 `try_again`. When the timezone read fails, the wire carries `lockAt: null`, `planEndsAt: null` and `timezone: 'UTC'`; the Hebrew screen shows `pending_body_nodate`, and a later Keep shows `kept.not_restored_by_choice_nodate`. For `pending`, `grace`, `requesting` and `locked` rows, the answer is the same with the switch on, off or unset. Dev's suite covers the 429 and 500 `no-store` cases |
| 4 | Keyboard only, end to end; Hebrew right to left | ✅ | Pass | Keyboard only through the real routes in en, he and es: Enter opens the dialog → Tab reaches the reason group → Space and the arrow keys pick a reason → Tab reaches the box → type the statement → Enter submits → focus lands on the pending body (IN-7) → Tab reaches Keep → Enter → focus lands on the kept notice (`role="status"`). The pending dates are checked against `formatAccountDay` in Asia/Jerusalem. The drawer, the panel and the notice carry `dir="rtl"` in Hebrew, and the support mailto carries `dir="ltr"`. Refusal path: the switch goes off after the page loads (a real 404) → focus lands on the alert → Tab reaches the mailto, then the request button; there is still one dialog. The export control is reached by Tab (Dev keyboard suite) |
| 5a | Double submit / double Keep | ✅ | Pass | While a request is held in flight, a second Enter and a click send nothing more: one request reaches the route and one row is written. Keep in flight is `aria-disabled` and keeps focus; Enter, Enter and a click send one Keep |
| 5b | Keep pressed while a re-read is in flight | ✅ | Pass | Another tab moves the row to `grace` → `state_changed`. The re-read is held with a stale "open" answer, and Keep is pressed again → the real route keeps the row (`not_needed`). The stale read then lands LAST, and the kept line still shows: no pending view and no Keep come back. Two Keep calls in total |
| 5c | A network failure mid-request | ✅ | Pass | The screen shows "couldn't confirm". The real closure route re-reads and finds nothing, the form is usable again, and nothing is written |
| 5d | No reason picked: the button stays disabled and nothing is defaulted | ✅ | Pass | Dev suites cover the disabled button and Enter with no reason. The round trip asserts that the posted `reasonCode` is the one picked |
| 5e | An owner on a trial | ✅ | Pass | A `trialing` billing row → `pending` with the trial end as the plan end and `renewal_was_on: true`. Keep → `restored` (es) |
| 5f | A free account, grace right away | ✅ | Pass | No billing row → the real route answers 200 `grace`, and the lock date is stored in the owner's zone. The panel shows `grace_body` with that date. Keep → `not_needed` |
| 5g | A row stuck in `requesting` (W-10) | ✅ | Pass | P-8 (the transition to pending fails): the real route answers 503 `try_again` + `data.status: 'requesting'` → "couldn't confirm" → the re-read shows `requesting_body` with the support mailto (`dir="ltr"`), and there is no Keep |
| 5h | A `locked` row | ✅ | Pass | The Hebrew `locked_body` shows with no Keep and no form. The real Keep route answers 409 `locked` |
| 6 | Checkout, Boost and reactivate refusals show the `deletion_pending` line | ✅ | Pass | In en, he and es, each code maps to its deletion line. Each line names that language's Keep button and matches none of the "try again later" lines (`plan.manage.refusal.unavailable`, `plan.refusal.not_open`, `plan.refusal.generic`, `usage.boost.error.generic`). `PlanManage` was rendered and "Keep my plan" pressed against the reactivate route's real refusal shape (409, `code: 'deletion_pending'`): the deletion line shows in all three languages, never the server's English. The Boost en render is pinned in `BoostPackagesPanel.buy.render.test.tsx` |
| 7 | Copy | ✅ | Pass | No line in the `settings.account_delete.*` or `account_closure.*` namespaces, or the three claimed lines, promises an email, in any language. There is no backslash in any of those source lines in the dictionaries or the `FALLBACK_COPY`; the diff adds 105 translation lines and none has one. he and es have the same keys as en, none empty, with the same `{slots}`. `{support}`, `{planEnd}`, `{lockDate}` and `{days}` sit where the screens fill them |
| 8 | Regression | ✅ | Pass | No new failures (numbers below). `npm run test:bos-entitlements`: 348 suites, 10111 tests, all pass. `npm run lint:hooks`: clean (exit 0). eslint on the two QA files: clean |
| 9 | Snapshots | ✅ | Pass | 148 snapshots on both runs; 0 added, 0 updated, 0 unmatched. No `.snap` file changed |
| §7 DL-2 | "Export your data first" opens the export drawer | ✅ | Pass | Dev render: exactly one `DownloadMyDataButton variant="button"`, and no export route is named. The keyboard pass reaches it |
| §7 DL-2 | Dates / bookings (DL-2b), banner (DL-2c) | — | Not in scope | DL-2a covers only the pending view's dates (rows 3, 4, 5e and 5f) |

#### Issues found

**Bugs (must fix before commit):** none.

**Performance issues:** none.

**Edge cases (nice to fix, none blocking):**
1. **Closure re-reads are not sequenced** — Low. `useAccountClosure.refresh()` keeps whichever answer arrives last. Notice mode (every kept line) always wins, and test 5b proves it. A stale read can still replace a newer state outside notice mode, though: two `state_changed` re-reads that land out of order would show the older state until the next read. It is rare, and the owner is not misled for long. A request counter in `refresh()` would close it. File: `hooks/useAccountClosure.ts`.
   - To reproduce: press Keep → 409 `state_changed` (to `grace`), and hold that re-read → press Keep → 409 `state_changed` (to `locked`), and let that re-read land first → release the first read.
   - Expected: the `locked` view. Actual: the `grace` view with Keep, until the next read.
2. **A `locked` row reads "set to close" above "is closed"** — Low, copy. The dialog description is `account_closure.heading` ("Your account is set to close") for every open status, `locked` included, and the body there says "Your account is closed." This only matters before DL-4, because a locked owner cannot sign in after it. File: `components/business-os/purge/DangerZonePanel.tsx` (`HEADING_KEY.pending`).
3. **A Keep 200 with an unreadable body says "Your account is kept."** — Info. The route answers 200 only with `kept: true`, so the claim holds. Recorded so that nobody changes the route's 200 contract without changing this too. File: `components/business-os/account-deletion/deletionAnswers.ts` (`keepOutcome`).

**Copy notes for the user's DL-2a copy approval (already owed, not QA findings):** CR-5 (b), the notice-mode description "Delete my account" above "Your account is kept.", is not settled; the user settled only CR-5 (a). IN-13 `grace_body_nodate`. The native he and es check.

#### Test outputs

**Full Jest suite, `npx jest --ci --maxWorkers=3`.** The baseline is a `git archive` of `origin/main` `f594ba22`, extracted to the session scratchpad with a junction to the shared `node_modules`. The main checkout was not touched: it is on another branch with another session's WIP, so it is not a clean `main`. FAIL lines are deduplicated by suite path.

| Run | Suites | Failed suites | Tests | Failed | Passed | Skipped |
|---|---|---|---|---|---|---|
| Baseline `f594ba22` | 2027 | 30 | 50680 | 153 | 50467 | 60 |
| DL-2a worktree | 2033 | 27 | 50847 | 150 | 50637 | 60 |

- **New failures vs the baseline: 0.**
- 27 failed suites are common to both runs. Three fail only in the baseline: `app/__tests__/tailwind-css-escape.guard.test.ts`, `lib/repositories/__tests__/BusinessDataExportRepository.test.ts` and `supabase/__tests__/security-definer-surface.guard.test.ts`. They pass in the worktree, so they belong to the extracted tree's location and line endings, not to the diff.
- The worktree's +6 suites are the DL-2a Dev test files. The two QA files were added after this run started; they ran in the subset run below.

**DL-2a subset, including the QA files.** The account routes, `lib/business-os/account-deletion`, `components/business-os/account-deletion`, `components/business-os/purge`, `hooks/useAccountClosure.test.tsx`, `deletionPendingCopy.dl2a`, `BoostPackagesPanel.buy.render`, the callers guard and `no-deletion-paths`: **50 suites, 1372 tests, all pass**.

**QA test files added:**
- `components/business-os/account-deletion/__tests__/DeleteAccountDrawer.dl2a.qa.roundtrip.test.tsx`: 24 tests. The real-route round trip: items 1, 3, 4 and 5.
- `components/business-os/account-deletion/__tests__/deletionAnswers.dl2a.qa.screens.test.tsx`: 138 tests. Every answer on screen in en, he and es (item 2), `deletion_pending` (item 6) and the copy checks (item 7).

#### Final status
- [x] All acceptance criteria DL-2a owns pass: ready for commit once the owed pre-merge items are done (the user's copy approval including IN-13 and CR-5 (b), the native he / es check, RM's full gate and `npm run build`)
- [ ] Issues found: Dev must address before commit

### QA Testing Report (DL-2b)

**QA — 2026-11-27** (uncommitted diff on `feature/bos-deletion-dl2b-timeline-bookings`, base `259a7e21`, after SA CR-1 / CR-2)
**Test mode:** full
**Strategy used:** A (Jest unit tests of the pure timeline and line builder) + B (Jest route and repository tests over a recorded fake `supabaseServer`, no network). D (manual browser) was not run, because the AgentsPilot app is parked from manual-test asks. RTL render tests stand in for it, and the manual critical path is recorded below.
**Focus:** api, ui, security
**Skipped:** the manual browser check (reason above); `npm run build` and `tsc` (RM's ship drill; Dev's IN-34 / IN-35 tsc run stands: 0 errors in touched files)
**Input source:** prompt keywords from TL, plus §10.2, §12 and T-9

**QA test files added (2 files, 22 tests, all pass):**
- `app/api/business-os/account/deletion-check/__tests__/route.dl2b.qa.test.ts`: 15 tests. The route runs over the REAL `readClosureTimeline`, the REAL `closureTimelineDeps.ts` ports and the REAL `findTimezone` / `countUpcomingBookings`. Only three things are mocked: the DB (a recorded fake client), the resolver behind `readPlanEndingView`, and the pre-existing check edges. This closes a gap: every Dev route test mocks `closureTimelineDeps` whole, so the ports' own mapping was never tested.
- `components/business-os/account-deletion/__tests__/whatHappens.dl2b.qa.test.tsx`: 7 tests. Covers:
  - Spanish rendered end to end (Dev renders only en and he).
  - `Pacific/Auckland`, where the local date is a day AFTER the UTC date (the opposite direction to Dev's New York case).
  - Hebrew free with one booking.
  - Line order.
  - A plan end that will not format next to a good lock date.
  - CR-1's `general` line in all three languages.

#### Test Coverage
| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| `lang` strict: en / he / es, default en | ✅ | Pass | Dev route tests, plus QA: `?lang=es` reaches `readPlanEndingView` as `locale: 'es'` through the real port |
| Unknown key or bad value → 400 `invalid_query`, `no-store`, nothing read | ✅ | Pass | Dev: `?lang=fr`, `?lang=`, `?lang=en&userId=…`, `?userId=…`. QA: `?user_id=…` → 400, no DB call, no session read, `details` undefined outside development |
| Off switch answers `{ enabled: false }` whatever the query | ✅ | Pass | `route.qa.test.ts`: 6 switch values × 3 queries, nothing read |
| `timeline` paid / free / trialing / Founding Partner `back_to_plan` / null | ✅ | Pass | Dev, with mocked ports. QA again, through the real ports: free counts from now, paid from the period end, `back_to_plan` "Founding Partner", `unknown` never carries a name, trialing → `trialing: true`, NULL zone → `UTC` |
| `futureBookings` count / null / 0 | ✅ | Pass | QA: a real 0 is `{ count: 0 }`; a PostgREST error and "no count, no error" are both `{ count: null }`, never 0 |
| T-1..T-5 never fail the check | ✅ | Pass | Every case answers 200 and is schema-valid. T-1 refuse: Dev tests payment failing; QA tests an open checkout on a free row (no timeline DB read at all). T-2: a PostgREST error and a thrown read → null / null, no count query. T-3: no period end. T-4: a throw or null → `unknown`, and the count still runs. T-5: error → null |
| Tenant scope (rule 4) | ✅ | Pass | QA pins the exact chain on the fake client: `user_preferences.eq('user_id', SESSION)`; `scheduling_bookings` `select('id', {count:'exact', head:true})`, `eq('user_id', SESSION)`, `in('status', ['confirmed','pending'])`, `gte('start_time', lockAt)`, and nothing else (no phantom `deleted_at`) |
| `countUpcomingBookings`: invalid uuid / ISO → error, no DB call; null count → error | ✅ | Pass | `SchedulingRepository.countUpcomingBookings.test.ts` (Dev), re-run |
| Drawer lines per §6.3; trial leaves out `no_refund` and uses `paid_plan_end_trial` | ✅ | Pass | Dev + QA (Spanish trial: no "de nuevo", no `no_refund`) |
| Bookings singular / plural / unknown / 0 | ✅ | Pass | Dev; QA adds the Hebrew singular and the Spanish plural, each in full |
| Dates in the owner's timezone where the UTC date differs | ✅ | Pass | Dev: Jerusalem vs New York. QA: Auckland shows 19 Dec / 5 Dec for instants that are 18 Dec / 4 Dec in UTC, in en, es and he |
| Unformattable date → general line | ✅ | Pass | Dev covers a bad lock date. QA: a bad plan end with a good lock date → `general`, and the bookings line still names the lock date |
| en / he / es; Hebrew RTL | ✅ | Pass | `dir="rtl"` on the Hebrew drawer, not on the Spanish one; no unfilled `{slot}` in any language |
| Entitlements registration | ✅ | Pass | `npm run test:bos-entitlements`: 350 suites, 10127 tests, exit 0. The only importer is `closureTimelineDeps.ts`, registered with exactly its two symbols |
| No network, no snapshot written | ✅ | Pass | Zero "Blocked a network connection" lines in the T-9 run and the full gate. Snapshots 148 / 148 passed, none written; `-u` never used |
| Midnight-DST zones | ⚠️ | Partial (inherited, not fixed) | See Edge Case 1 |

#### Issues Found

##### Bugs (must fix before commit)
None in the DL-2b diff.

##### Performance Issues (should fix)
None. T-4 and T-5 run in parallel, and the count is head-only.

##### Edge Cases (nice to fix)
1. **The known `startOfDayUtc` midnight-DST bug reaches DL-2b's lock date (inherited; owned by the DL-5 gate task, not fixed here)** — File: `lib/business-os/bizql/dates.ts`, through `closureDates.closureLockAt` — Severity: Low for DL-2b.
   - Probe (QA, scratch only): when local day 15 is the day a zone springs forward at midnight, `lockAt` lands at 23:00 the day BEFORE.
     - `America/Santiago`, request on 2026-08-23 → `lockAt 2026-09-06T03:00Z`, which is 5 Sep 23:00 local. The drawer shows **"September 5, 2026"** instead of 6 Sep.
     - `America/Havana`, request on 2026-02-22 → the drawer shows **"March 7"** instead of 8 Mar.
     - Correct: `Asia/Beirut` (also midnight DST) shows the right day (01:00 local). Santiago's DST end and `Asia/Jerusalem` are also correct.
   - Effect in DL-2b: the drawer shows a lock date one day early, and the bookings count starts one hour early (bookings in the last hour of day 14 are counted). The drawer still equals what the request then stores (W-14 parity holds), so the date is wrong the same way everywhere, and one upstream fix corrects all of it. The zones the §12 tests use (Asia/Jerusalem, America/New_York) are not affected.
2. **A zone the server accepts but the browser's `Intl` does not would throw while the drawer renders** — File: `components/business-os/account-deletion/whatHappens.ts` — Severity: Low.
   - `formatAccountDay` → `toLocaleDateString({ timeZone })` throws `RangeError` for a zone it does not know.
   - The server only sends a zone that passed `isUsableTimezone` in Node's ICU, so this needs an older browser with an older zone table (a renamed zone such as `Europe/Kyiv`).
   - The "date that will not format" fallback covers an invalid instant, not an invalid zone. A `try` in `whatHappensLines` that falls back to the `general` line would close it.
   - Not reproduced in a browser.
3. **`plan_refused` shows "We couldn't count"** — the same as SA's optional suggestion. It is true in effect, and no change is asked for.

#### Test Outputs / Logs
- **QA's 2 new suites, run alone:** 15 / 15 and 7 / 7 pass.
- **T-9 Jest set** (`app/api/business-os/account lib/business-os/account-deletion components/business-os/account-deletion components/business-os/purge hooks lib/repositories/__tests__ components/business-os/settings`, plus the closures migration test): **264 suites, 5894 tests, all pass**, exit 0 (Dev's 262 / 5872 plus QA's 2 / 22).
- **`npm run test:bos-entitlements`:** 350 suites, 10127 tests, pass, exit 0.
- **`npm run lint:hooks`:** exit 0. eslint on the two QA files: clean.
- **Full gate** `npx jest --ci --maxWorkers=3` on the worktree (run alone, not beside the baseline):
  - Result: **32 failed suites / 151 failed tests**, 2113 suites passed, 2145 of 2153 run, snapshots 148 / 148, 2544 s.
  - Compared, with FAIL lines de-duplicated, against Dev's extracted clean-`259a7e21` baseline (`full-base.txt`: 37 failed suites / 156 failed tests): **0 suites fail only in DL-2b.**
  - 5 suites fail only in the baseline. Three come from the extracted tree's location and line endings: `tailwind-css-escape.guard`, `BusinessDataExportRepository`, `security-definer-surface.guard`. Two are flaky under load: `PlanSection.render`, `jest-gate-check.g8`.
  - The other 32 are the same pre-existing failures on both sides. The 6 extra suites are DL-2b's 4 new ones and QA's 2.
- **`deletionAnswers.dl2a.qa.screens` timeout: load-only.**
  - It passed in the T-9 set (59.6 s) and in the full gate, which ran alone (48.5 s).
  - Dev's single timeout came while the baseline gate ran beside it (a 138 s suite).
  - It is a slow suite: 138 tests, each a full drawer round trip. Not a DL-2b defect.

#### Manual critical path (not run; for when the app is un-parked)
On a dev server with the switch on, keyboard only, in English and Hebrew:
1. A `+test` free account whose `user_preferences.timezone` is `Pacific/Auckland` (or any zone whose date differs from UTC at the test hour) opens Settings → Delete account. "What happens next" shows "You have 14 days…" and a lock date that matches the local calendar 14 days ahead, not the browser's date or UTC's.
2. Seed one confirmed `scheduling_bookings` row with a `start_time` after that lock date → "You have 1 client booking after {date}…". Add a second → the plural line. A `cancelled` booking is not counted.
3. A paid sandbox account shows its plan end, the no-refund line, the after-plan line and the projected lock date.
4. Request → the pending view shows the same lock date the drawer showed.

#### Final Status
- [x] All acceptance criteria DL-2b owns pass. Ready for commit once the owed pre-merge items are done: the user's §9.2 copy approval (including the W-13 trial line, `bookings_one` and CR-1's `general`), the native he / es check, and RM's full gate and `npm run build`. Edge Case 1 is inherited and goes to the DL-5 gate task.
- [ ] Issues found: Dev must address before commit

---

## Commit Info

_RM populates this section._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-06 | Workplan written (Dev) | DL-2 on `feature/bos-deletion-dl2-drawer-keep` from `f594ba22`. As-is: the drawer posts the old body and expects the old answer while the request switch is on in production; no Keep entry exists with the switch off; the pre-check has no dates or bookings. Split into DL-2a (request and Keep work again, 1.5 d), DL-2b (dates and the BQ-39 count, 1 d), DL-2c (banner, plan card, checkout / Boost / upgrade lines, `/account-deleted`, privacy paragraph, 1.5 d). New read-only closure route not behind the switch; pure answer maps; projected lock date; `countUpcomingBookings`; one entitlements non-gate registration; PLAN PAYMENTS claims named per slice. No migration, no email. Copy proposed in en / he / es for the user; Q-1 to Q-16 |
| 2026-11-06 | SA workplan review | Approved with conditions. W-1 to W-16. W-1 (High): DL-2a makes the production switch do real work, so the user decides on the switch before merge. W-2: the checkout and Boost refusal lines move into DL-2a. W-3: live schema verified (no `scheduling_bookings.deleted_at`; statuses and NULL-start parents confirmed). W-4 to W-7: closure route contract, client-bundle safety, layout read, provider placement. SA ruled Q-2 to Q-6, Q-8 to Q-12, Q-14 and Q-16, and recommended answers to Q-1, Q-7, Q-13 and Q-15 |
| 2026-11-06 | User decisions recorded (Dev) | § User Decisions: Q-1 ("Keep my account", the reactivate line re-worded), Q-7 (the delete label stays "Delete my account forever"), Q-13 (registers, native check), Q-15 (privacy paragraph in en / he / es, DL-2c), W-1 option (b) (switch stays on; R-8 added to §14) |
| 2026-11-06 | DL-2a implemented (Dev) | Closure status route, view, deps; answer maps; Danger Zone state (closure first, deferred pre-check); request form with export-first, reason and new body; pending view and Keep my account; W-2 checkout and Boost lines; translations (5 removed, 31 added per language); tests. Tasks 0 to 9 ticked; § Implementation notes (DL-2a) IN-1 to IN-17. Status → DL-2a Code Complete |
| 2026-11-07 | SA code review fixes (Dev, DL-2a) | CR-1 (`useRouter()` from next/navigation, host suites mock it), CR-2 (focus to the explaining line on every refusal; Keep uses `aria-disabled`), CR-3 (W-5 pin with a floor and `export … from`), CR-7 (schema comment). IN-18 to IN-22. Ready for SA's fix-diff re-check |
| 2026-11-07 | SA code review (DL-2a) | 🔄 Fix Required. W-2, W-4 (a–d and the family 6 floor), W-5, W-8, W-9, W-10 and W-12 verified in the code. Closure route approved. Answer maps cover every request and Keep code, including CR-6 and CR-8. The request → pending → Keep loop works with the switch on or off. Must fix: CR-1 (IN-6 rejected: `useRouter()` from `next/navigation` plus the mock, not the Next internal context) and CR-2 (focus lost on refusal paths). Low: CR-3 (W-5 pin floor), CR-4, CR-5 (copy for the user). IN-1 to IN-17 ruled; IN-11 is subject to PLAN PAYMENTS' SA sign-off. SA ran 49 suites / 1224 tests (pass) and a full tsc (0 errors in touched files) |
| 2026-11-08 | SA code review re-check (DL-2a) | ✅ Code Approved for QA. CR-1, CR-2, CR-3 and CR-7 verified fixed in the code, and 66 suites / 1490 tests pass. CR-5 settled by the user: the warning copy stays as is. IN-11 condition met: PLAN PAYMENTS' SA approved its hunks. Still owed before merge: user copy approval (incl. IN-13), native he / es check, RM's full gate and build |
| 2026-11-08 | QA Testing Report (DL-2a) | ✅ PASS WITH NOTES. Real-route round trip (delete, closure and keep handlers behind the rendered dialog) in en / he / es; every request and Keep answer on screen in three languages; closure route checks; keyboard only and RTL; edge cases. No bugs; 3 low edge cases. Full Jest: 0 new failures vs `f594ba22` (27 vs 30 failed suites); entitlements 348 / 10111 pass; lint:hooks clean; no snapshot changed. Two QA test files, 162 tests |
| 2026-11-25 | User approval (TL) | User approved the DL-2a diff and the English copy (scratchpad DL-2a-copy.md, incl. IN-13 grace_body_nodate); CR-5 warning kept as is. Native he/es check still owed, after merge (switch is on for the user's own testing only). RM: commit, merge main, PR. |
| 2026-11-26 | DL-2b implemented (Dev) | On `feature/bos-deletion-dl2b-timeline-bookings` from `259a7e21`. Live schema check (IN-23). `SchedulingBookingRepository.countUpcomingBookings`, with W-16. Pure `closureTimeline.ts` (W-13 `trialing`, W-14 parity with `runClosureRequest`). `closureTimelineDeps.ts` is the only entitlements importer, registered as a non-gate. The pre-check gains a strict `?lang=`, `timeline` and `futureBookings`, and no failure mode fails the check. The hook sends `lang`. The drawer gains "What happens next" with dates on the owner's clock, plus 12 keys in en / he / es and the fallback, including the W-13 trial line (IN-26) and `bookings_one` written out (IN-30), both for user approval. The `closureLifecycle.ts` comment is fixed, and requirement §3.6 now records the receipt export fields after MX-7. Tasks 10 to 15 ticked; IN-23 to IN-34. Status → DL-2b Code Complete |
| 2026-11-27 | SA code review fixes (Dev, DL-2b) | CR-1: `what_happens.general` re-worded in en / he / es and the fallback, so it is true for a free owner too (§9.2 updated). CR-2: the migration-test header comment no longer names `jobPolicy.ts` as the precedent. IN-35. 262 suites / 5872 tests pass; tsc shows 0 errors in touched files |
| 2026-11-27 | QA note 2 safety net (Dev, DL-2b) | A throw while formatting a timeline date (an unknown zone) now falls back exactly as an unformattable date does (IN-30): `general`, and `bookings_unknown` when the lock date is the one lost. `formatAccountDay` is untouched. Three tests added. IN-36. 264 suites / 5898 tests pass; tsc 0 errors in touched files |
| 2026-11-27 | SA code review (DL-2b) | ✅ Approved with fixes; Code Approved for QA. Repository pattern, session-only ids on the service-role reads, strict Zod `lang`, Pino, the entitlements registration, W-5, W-13, W-14 and W-16 verified in the code; 19 suites / 424 tests pass. Low, before merge: CR-1 (reword `general` so it is plan-neutral, en / he / es drafted; ruling on IN-33, no `general_free` key) and CR-2 (the stale `jobPolicy.ts` comment in the closures migration test). IN-24, IN-27 to IN-31 accepted |
| 2026-11-27 | QA (DL-2b) | PASS WITH NOTES. 2 QA suites added (22 tests): the route over the real timeline ports and repositories, and the drawer section in es, in Auckland and Hebrew. T-9 264 / 5894 pass; `test:bos-entitlements` 350 / 10127 pass; full gate 32 / 151 failures, none new against clean `259a7e21`. No bug. Edge cases: the inherited midnight-DST lock date shows a day early in Santiago / Havana (DL-5 gate task); a zone the browser's `Intl` rejects would throw in the drawer |
| 2026-11-27 | SA re-check of CR-1/CR-2 (TL records) | SA re-checked the fix diff only: CR-1 `what_happens.general` reworded in en/he/es, FALLBACK_COPY byte-identical to en, `pending_body_nodate` untouched, no stale pins; CR-2 comment-only in the closures migration test. DL-2b stays Code Approved for QA. |
| 2026-11-27 | User approval (TL) | User approved the DL-2b diff and the English copy (scratchpad DL-2b-copy.md: trial line, bookings_one, CR-1 general). QA PASS WITH NOTES. Native he/es check owed. QA note 2 (unrecognised timezone in an old browser) offered as a small safety net, not yet decided. |
