# Workplan: Separating the Meeting from the Booking

> **Last Updated**: 2026-10-16
> **Requirement**: [BOOKING_MEETING_SEPARATION_REQUIREMENT.md](/docs/requirements/BOOKING_MEETING_SEPARATION_REQUIREMENT.md)

## Overview

End-to-end plan to give the meeting its own state (`meeting_status`) and its own
actions, leaving `scheduling_bookings.status` to mean the job alone.

Four phases. Each is independently deployable **except** where a sequencing
constraint is marked 🔒 — those tasks must ship in the same deploy as the task
they are bound to. Two such constraints exist and both are hard.

Every task names its files, its change, its test and its acceptance criterion.
The classification behind each change is in §7 and §8 of the requirement.

---

## Table of Contents

1. [Principles](#1-principles)
2. [Phase 1 — add and backfill](#2-phase-1--add-and-backfill)
3. [Phase 2 — move the readers](#3-phase-2--move-the-readers)
4. [Phase 3 — split the actions](#4-phase-3--split-the-actions)
5. [Phase 4 — wire the container](#5-phase-4--wire-the-container)
6. [Test plan](#6-test-plan)
7. [Rollback](#7-rollback)
8. [Risk register](#8-risk-register)
9. [Definition of done](#9-definition-of-done)

---

## 1. Principles

1. **Additive first.** Nothing is removed from `status` until every reader has
   moved off it.
2. **One predicate module.** No reader compares `status` to a literal again.
3. **A reader moves with its test.** No bulk find-and-replace.
4. **Never silence a detector.** Project rule: detectors are fixed when they
   fire wrongly, never disabled. A detector that stops returning rows is a
   failure, not a pass.
5. **🔒 constraints are not advisory.** The two marked below cause silent
   client-facing damage if broken.

---

## 2. Phase 1 — add and backfill

**Risk: none.** The column is written but read nowhere. Independently
deployable.

### P1-1 Migration

**File:** `supabase/migrations/<ts>_booking_meeting_status.sql`

```sql
ALTER TABLE scheduling_bookings
  ADD COLUMN meeting_status TEXT
  CHECK (meeting_status IN ('held','no_show','cancelled'));

UPDATE scheduling_bookings SET meeting_status = 'held'    WHERE status = 'completed';
UPDATE scheduling_bookings SET meeting_status = 'no_show' WHERE status = 'no_show';

CREATE INDEX idx_bookings_meeting_status ON scheduling_bookings (user_id, meeting_status);
```

`NULL` = nobody has said yet. This state does not exist today.

**Acceptance:** every row with `status IN ('completed','no_show')` has a non-null
`meeting_status`; all others are null.

### P1-2 Types

**Files:** `lib/repositories/SchedulingRepository.ts` (`SchedulingBooking`,
`SchedulingBookingUpdate`), `types/` as needed.

Add `meeting_status?: 'held' | 'no_show' | 'cancelled' | null`.

### P1-3 Writers populate both columns

**File:** `lib/repositories/SchedulingRepository.ts`

```ts
async complete(id, userId) {
  return this.update(id, userId, { status: 'completed', meeting_status: 'held' });
}
async markNoShow(id, userId) {
  return this.update(id, userId, { status: 'no_show', meeting_status: 'no_show' });
}
```

Also `cancel()`: when `attendanceRecorded` is false and the meeting has not
happened, set `meeting_status = 'cancelled'` alongside `status = 'cancelled'`.

**Covers writers 1, 2, 3, 5–10 in requirement §8.6**, since they all route
through these methods. Writers 11–13 (payment confirming a booking) are
unaffected and must not be touched.

**Test:** `complete()` / `markNoShow()` / `cancel()` write both columns;
payment-confirm paths write neither.

### P1-4 Catalogue the new field

**File:** `lib/business-os/catalog/catalog.ts` (near line 1639)

Add `meeting_status` as a catalogued field with its enum and he/es/en labels,
mirroring the existing booking-status entry. Without this the chat cannot answer
"which meetings were held".

**Acceptance:** `npm run eval:chat -- --no-cache --filter=meeting` returns plans
that reference `meeting_status`.

---

## 3. Phase 2 — move the readers

**The bulk of the work and the whole of the safety.** One PR per group. Nothing
here changes behaviour that users see, except where it corrects a bug.

### P2-1 The predicate module 🔑 *(blocks everything else in Phase 2)*

**File:** `lib/business-os/bookingStatus.ts` — imports nothing, so public routes
and detectors can both use it.

```ts
export function meetingHeld(b)     { return b.meeting_status === 'held'; }
export function meetingMissed(b)   { return b.meeting_status === 'no_show'; }
export function meetingOff(b)      { return b.meeting_status === 'cancelled'; }
export function meetingUnmarked(b) { return b.meeting_status == null; }

export function jobCalledOff(b) {
  return b.status === 'cancelled' || Boolean(b.cancel_reason) || Boolean(b.cancelled_by);
}

export function holdsSlot(b) {
  return !jobCalledOff(b) && !meetingMissed(b) && !meetingOff(b);
}

export function outcomeRecorded(b) {
  return jobCalledOff(b) || b.meeting_status != null;
}
```

`jobCalledOff` is not new logic: it is the union already inline at
`BookingsTab.tsx:1670`, moved somewhere other code can reach. Delete the inline
copy and import it.

⚠️ **`holdsSlot` and `outcomeRecorded` change signature** from `(status: string)`
to `(booking)`. Every call site must be updated in the same PR. There are 9.

**Test:** unit tests per predicate, including the held-then-cancelled row shape
from requirement §2.3.

### P2-2 Guard test

**File:** `lib/business-os/__tests__/bookingStatusIsAskedOnce.guard.test.ts`

Scan `app/`, `lib/`, `components/` for direct comparisons of a booking status to
`'completed' | 'no_show' | 'cancelled'` outside `bookingStatus.ts`. Allow-list
the writers. Fail on anything else.

**Why:** this exact drift already happened once between `jobIsOver` and
`quoteGate`. The guard is the only thing that stops it recurring.

### P2-3 Bucket E — slot occupancy *(7 sites)*

All already route through `SLOT_HOLDING_STATUSES`, so this is mostly mechanical.

| File | Line |
|---|---|
| `app/api/website/booking/availability/route.ts` | 310 |
| `app/api/website/booking/confirm/route.ts` | 123 |
| `app/api/website/booking/create/route.ts` | 396 |
| `app/api/website/scheduling/availability/route.ts` | 446 |
| `app/api/conversion/[userCode]/availability/route.ts` | 258 |
| `lib/repositories/SchedulingRepository.ts` | 962 |
| `lib/business-os/insight/health/resolveBusinessHealth.ts` | 229 |

These are SQL filters, so they cannot call `holdsSlot` directly. Select
`status, cancel_reason, cancelled_by, meeting_status` and filter in code, or
express the same predicate in SQL. **Prefer code**, so there is one definition.

**Test (must-have):** a no-show **and** a cancelled meeting both free their slot;
a held past meeting still blocks its slot. Releasing a no-show's slot was itself
a bug fix (`bookingStatus.ts:73-81`) and is the easiest thing to undo.

### P2-4 Bucket A — delivered work *(6 sites)*

`status = 'completed'` → `meeting_status = 'held'`.

| File | Line |
|---|---|
| `lib/payments/billSessionOnCompletion.ts` | — 🔒 see §8 R1 |
| `lib/business-os/insight/detectors/catalog/CashWorkUnbilledDetector.ts` | 144 🔒 |
| `lib/business-os/insight/detectors/catalog/RetRepeatBookingLowDetector.ts` | 62 |
| `lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts` | 355 |
| `lib/business-os/insight/detectors/catalog/OpsPeakUnutilizedDetector.ts` | 188 |
| `lib/business-os/insight/detectors/catalog/RetCancellationSpikeDetector.ts` | 124 |
| `lib/business-os/insight/health/resolveBusinessHealth.ts` | 129 |
| `lib/services/WebsiteBlockEnrichmentService.ts` | 501, 1257 |
| `lib/business-os/gaps/definitions.ts` | 1220 (`meeting_auto_completed`) |

🔒 The first two **must** land before Phase 4. See §8 R1.

**Test:** each detector still returns rows on a fixture with held meetings. A
detector returning zero is a failure.

### P2-5 Bucket D — job lifecycle *(10 sites)*

`status = 'cancelled'` → `jobCalledOff()`. **This is where the §9.1 pre-existing
bugs get fixed.**

| File | Line | Note |
|---|---|---|
| `CashCancelledUnrefundedDetector.ts` | 191 | already selects `cancelled_by, cancel_reason`; one predicate from correct |
| `OpsLastMinuteCancelsDetector.ts` | 88 | counts **meeting** cancels → `meetingOff()` |
| `RetCancelPatternDetector.ts` | 155 | meeting cancels → `meetingOff()` |
| `RetCancellationSpikeDetector.ts` | 68, 89 | meeting cancels → `meetingOff()` |
| `RetNoShowSpikeDetector.ts` | — | → `meetingMissed()` |
| `ConvNoNextStepDetector.ts` | 141, 149, 150 | exclude called-off |
| `ConvServiceRateDropDetector.ts` | 102 | exclude called-off |
| `OpsServicePerformanceDetector.ts` | 112 | "bookings that count" → `!jobCalledOff` |
| `PricingDiscountAbuseDetector.ts` | 149 | same |
| `PricingIntroOfferStuckDetector.ts` | 76 | same |
| `app/api/business-os/stats/route.ts` | 964, 971, 979 | same |
| `lib/repositories/ChannelAttributionRepository.ts` | 133 | same |
| `lib/business-os/gaps/definitions.ts` | 594 (`booking_cancelled`) | same |

**Expect counts to change.** Two production rows become visible for the first
time (requirement §10.3). This is a correction; announce it.

### P2-6 Bucket C — clock-triggered, column excludes *(2 sites)*

| File | Line | Change |
|---|---|---|
| `lib/business-os/gaps/definitions.ts` | 190 (`quote_unwritten`) | exclude `jobCalledOff`, `meetingMissed`, `meetingOff` |
| `CashBookingUnpaidDetector.ts` | 126 | exclude cancelled/missed meetings |

⚠️ **Do not require `meetingHeld` here.** `quoteGate.ts:13-16` records why: most
owners never mark a meeting, so requiring `held` would silence the gap for the
population it serves. The column **excludes**, the clock still **triggers**.

Fixes requirement §9.2: no-shows are currently chased for a quote.

### P2-7 Bucket B — pre-meeting *(5 sites)* 🔒 **must ship with P3-1**

These work today **only** because a meeting outcome overwrites `confirmed`.

| File | Line | Gap / purpose | Change |
|---|---|---|---|
| `lib/services/IntakeReminderService.ts` | 83 | intake reminder cron | add `meetingUnmarked` |
| `lib/business-os/gaps/definitions.ts` | 416 | `intake_outstanding` → `chase_intake` | add `meetingUnmarked` |
| `lib/business-os/gaps/definitions.ts` | 505 | `meeting_upcoming` → `remind_about_meeting` | add `meetingUnmarked` |
| `lib/business-os/gaps/definitions.ts` | 1091 | `meeting_unmarked` → `auto_complete_meetings` | `meetingUnmarked` — **this is what it always meant** |
| `lib/business-os/gaps/definitions.ts` | 825 | `booking_refunded` | add `meetingUnmarked` |
| `app/api/business-os/stats/route.ts` | 609 | "upcoming bookings" count | add `meetingUnmarked` |
| `app/api/business-os/metrics/summary/route.ts` | 76, 85 | "sessions today/this week" | use `holdsSlot` |

**Test:** a cancelled meeting on a live job produces **no** reminder, **no**
intake chase and is **not** offered for auto-completion.

### P2-8 Public client routes

**Files:** `app/api/book/manage/[token]/intake/route.ts` (176, 352),
`.../intake/upload/route.ts` (164)

They already call `outcomeRecorded`; update to the new signature (P2-1).

**Test:** a client whose meeting was cancelled cannot submit or upload.

### P2-9 quoteGate — the reported bug

**Files:** `lib/business-os/quoteGate.ts`,
`components/crm/contact-drawer/CRMContactDrawerV2.tsx:862`

```diff
 export interface QuoteGateInput {
-  bookingStatus: string | null | undefined;
+  calledOff: boolean;
+  meetingStatus: string | null | undefined;
   ...
 }

-  if (bookingStatus === 'cancelled' || proposalStatus === 'stopped') return 'closed';
+  if (calledOff || proposalStatus === 'stopped') return 'closed';
-  if (bookingStatus === 'no_show') return 'missed';
-  if (bookingStatus === 'completed') return 'open';
+  if (meetingStatus === 'no_show') return 'missed';
+  if (meetingStatus === 'held')     return 'open';
```

Keep the clock fallback to `'unmarked'` / `'ahead'` exactly as is.

Correct the false comments at `quoteGate.ts:72-75` and
`CRMContactDrawerV2.tsx:872-878` (requirement §9.3).

**Acceptance:** on booking `4c515dc8`, the gate returns `'closed'` and the
create-quote button is absent. **This closes the reported bug.**

### P2-10 Journey step and drawer

**Files:** `CRMContactDrawerV2.tsx:1433` (journey `session` step),
`BookingsTab.tsx` (115, 1887, 1911, 2654, 4919)

`attendanceRecorded` → the predicate module. The session step's `isCancelled`
uses `jobCalledOff`, not `status`.

---

## 4. Phase 3 — split the actions

🔒 **Ships with P2-7.** The moment the held button stops writing `status`, every
bucket-B reader must already read `meeting_status`.

### P3-1 Meeting buttons write only `meeting_status` 🔒

**Files:** `BookingsTab.tsx`, `MeetingRowActions.tsx`,
`app/api/scheduling/bookings/[id]/complete|no-show/route.ts`,
`SchedulingRepository.complete/markNoShow`

- התקיימה → `meeting_status = 'held'`
- לא הגיע → `meeting_status = 'no_show'`
- בטל פגישה → `meeting_status = 'cancelled'` *(new action)*
- הצע מועד חדש → existing reschedule

**Single-meeting direct services keep one merged button** writing both columns.
Nobody gains a click.

Buttons move into the meeting stage of the journey strip.

### P3-2 Delete the preserve-attendance hack

**File:** `lib/repositories/SchedulingRepository.ts:1634-1688`

```diff
-      ...(attendanceRecorded ? {} : { status: 'cancelled' as const }),
+      status: 'cancelled' as const,
```

Remove `attendanceRecorded` / `alreadyCancelled` and the conditional
`emitBookingStatusEvent`, because `update()` now always claims the transition
and emits once. The meeting fact is safe in its own column.

**Test:** cancelling a held booking writes `status='cancelled'` **and** leaves
`meeting_status='held'`; exactly one `booking.cancelled` event is emitted.

### P3-3 `auto_complete_meetings` writes the meeting

**Files:** `lib/services/LeadResponseDispatchService.ts:385`, the automation
dispatch path

Must write `meeting_status = 'held'`, never `status = 'completed'`. Today an
automation can mark a booking complete with the quote unsent and money owed.

### P3-4 Plugin and chat surfaces

**Files:** `lib/server/scheduling-plugin-executor.ts` (118, 122, 126),
`lib/business-os/bizql/mutate/MutateExecutor.ts` (1587, 1610),
`lib/business-os/ChatCommandExecutor.ts:2367`

Keep the operation names (`complete`, `no_show`, `cancel`) — they are a public
contract for user-built agents — and map them to the new columns. Add a
`cancel_meeting` operation. `MutateExecutor.complete` keeps calling
`billSessionOnCompletion` (now keyed on held).

---

## 5. Phase 4 — wire the container

🔒 **Must come after P2-4.** See §8 R1.

### P4-1 Cancel cascades

**File:** `lib/services/BookingLifecycleService.ts`

| Layer | Effect |
|---|---|
| Job | `status='cancelled'` + reason + actor |
| Meeting | not-yet-held meetings → `meeting_status='cancelled'`, slots freed |
| Proposal | `draft`/`sent`/`viewed` → `withdrawn`, client link dead |
| Money | unpaid invoices voided, running plan stopped |

Invariants: held meetings stay held; money taken stays taken and surfaces as a
refund decision.

Fixes requirement §2.4 / §9.3.

**Test:** cancelling a job with a sent quote makes the client's quote link
return "no longer available"; a paid booking raises a refund decision rather
than silently voiding.

### P4-2 Gated Complete

**Files:** `bookingStatus.ts` (`canCompleteJob`), booking header component

```
canCompleteJob = no past meeting with meeting_status = null
              && (not a quoted service || a quote is accepted)
              && (money paid || nothing owed) && (no plan running)
```

The button shows **why** it is unavailable: "Quote not sent", "₪1,200
outstanding", "Payment plan still running".

**Test:** a quoted job with an unsent quote cannot be completed; the reason
shown names the quote.

### P4-3 Deprecate `no_show` as a booking status

Stop writing it. Keep it accepted in `BOOKING_STATUSES` until a later cleanup,
once the guard test proves no reader depends on it.

---

## 6. Test plan

| Level | What |
|---|---|
| Unit | every predicate in `bookingStatus.ts`, including the held-then-cancelled shape |
| Guard | P2-2: no direct status literal comparisons outside the module |
| Integration | availability (P2-3), public manage routes (P2-8), cancel cascade (P4-1) |
| Detector | **each of the 18 detector sites returns rows on a fixture.** Zero rows = failure |
| Chat | `npm run eval:chat -- --no-cache` after P1-4 and P3-4. Use `--no-cache`: a warm suite never reaches the model |
| Manual (QA) | the reported bug on booking `4c515dc8`; reminder not sent for a cancelled meeting; auto-complete not re-offered for a held meeting |

---

## 7. Rollback

| Phase | Rollback |
|---|---|
| 1 | Drop the column. Nothing reads it |
| 2 | Revert the PR. Each reader PR is independent except P2-1 |
| 3 | Revert P3-1 **and** P2-7 together. They are one deploy |
| 4 | Revert; Phase 3 stands alone |

The migration is additive, so no down-migration destroys data.

---

## 8. Risk register

| # | Risk | Mitigation |
|---|---|---|
| **R1** 🔒 | **Gating Complete on money kills billing and a detector.** Package sessions are billed *by* completion, so requiring payment first means the invoice is never raised. `CashWorkUnbilledDetector` ("completed, with no invoice and no payment") becomes impossible by definition and returns nothing forever | Billing and that detector key on `meetingHeld` in **P2-4**, before Complete is gated in **P4-2**. Not optional |
| **R2** 🔒 | **Bucket-B readers fire forever.** Once held stops writing `status`, `meeting_upcoming` reminds clients about cancelled meetings and `meeting_unmarked` re-completes held meetings endlessly | **P2-7 ships in the same deploy as P3-1** |
| R3 | Slot release regresses; a no-show blocks the calendar | Explicit availability test in P2-3 |
| R4 | A detector silently returns zero | Every detector site gets a rows-returned test (§6) |
| R5 | Reported numbers move on deploy and read as a bug | They are a correction (requirement §10.3). Announce before deploy |
| R6 | A writer outside the drawer is missed | Writer list is complete at requirement §8.6; P1-3 covers 1–10 via the repository |
| R7 | The chat cannot query the new field | P1-4 catalogues it; `eval:chat --no-cache` verifies |
| R8 | Agent-built workflows break on renamed plugin operations | P3-4 keeps the operation names and maps them |

---

## 9. Definition of done

**Phase 1:** column exists, backfilled, both columns written, catalogued. No
reader changed.

**Phase 2:** predicate module is the only place a booking status literal
appears; guard test green; all 18 detector sites return rows on fixtures; the
reported bug is closed (P2-9).

**Phase 3:** meeting buttons write only `meeting_status`; the preserve hack is
deleted; cancelling a held booking writes `cancelled` and keeps `held`; no
reminder or auto-complete fires for a settled meeting.

**Phase 4:** cancel cascades to proposal and money; Complete is gated and names
its reason.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Derived from the full inventory in the requirement: 63 booking-table call sites, 8 gaps, 18 detector sites, 17 writers, all classified with no unresolved items. |
