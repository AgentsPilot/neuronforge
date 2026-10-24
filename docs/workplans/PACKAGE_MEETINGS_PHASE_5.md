# A package is one booking with many meetings

> **Last Updated**: 2026-10-19
> **Status**: plan, not started.
> Parent: [BOOKING_MEETINGS_TABLE_PLAN.md](/docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md) — this is Phase 5, scoped to packages.

## Overview

A package of six sessions is stored today as **seven bookings**: a container
with no time, and six children carrying `parent_booking_id`. Each child then
syncs one row into `scheduling_meetings`, which is what actually holds the slot.

The meetings table was built for exactly this shape — its own comment says *"a
job legitimately has several meetings"* — and the package is the one thing still
modelling a series as rows in the bookings table. This closes that.

**What changes:** one booking, six meetings. Nothing else about the product.

---

## Table of Contents

1. [What is already true](#1-what-is-already-true)
2. [The gaps](#2-the-gaps)
3. [The money gate](#3-the-money-gate)
4. [What makes this one slice rather than five](#4-what-makes-this-one-slice-rather-than-five)
5. [The work](#5-the-work)
6. [The data migration](#6-the-data-migration)
7. [How it is tested](#7-how-it-is-tested)
8. [Risks](#8-risks)

---

## 1. What is already true

Checked against the live database and the code, not assumed:

| | |
|---|---|
| Meetings hold slots | `busyMeetings` reads `scheduling_meetings` only. The bookings table is not consulted |
| ~~The overlap constraint is on meetings~~ | **FALSE — see G0.** That migration is named for what it reads, not where it lives |
| A cancelled job cancels its meetings **at runtime** | `SchedulingRepository` writes `meeting_status: 'cancelled'`; `20261075` was the one-off backfill |
| A no-show writes `meeting_status` | Same repository path |
| A container carries no meeting | `syncMeeting` returns early when `start_time` is null — correct, it is a purchase |
| `payment_plan_installments.meeting_id` exists | `20261074`, indexed, **45 of 95 stages carry one** |
| A single meeting can be called off without ending the job | `…/meeting-cancel` |
| Recurrence is already an input method | `lib/scheduling/recurrence.ts` expands the rule; the proposal stores explicit dates |

**So slot-holding and attendance need no work** — both already live on the
meetings table and would behave identically with six meetings under one booking.

**The constraint is the exception, and it is the blocker.** See G0.

**And the migration is small:** platform-wide there are **7 child bookings** and
**1 container**. This is not a backfill of a live estate.

---

## 2. The gaps

### G0 — THE BLOCKER: meetings have no overlap constraint

`scheduling_bookings_no_overlap` still lives on **`scheduling_bookings`**.
`20261084` only changed what it READS — it now consults
`scheduling_bookings.meeting_status` — and left it where it was. I misread the
migration's name for its body when writing §1 of this plan; the line above is
corrected.

```sql
EXCLUDE USING gist (user_id WITH =, tstzrange(start_time, end_time) WITH &&)
WHERE ( status IN ('confirmed','pending','completed')
    AND (meeting_status IS NULL OR meeting_status = 'held')
    AND start_time IS NOT NULL … )
```

**`scheduling_meetings` has no exclusion constraint at all.** Proved against the
live database: two meetings on one booking, same user, identical times — both
inserts accepted.

It does not bite today, because every meeting mirrors a booking that carries the
constraint. It bites the moment this plan lands: a package becomes ONE booking
with `start_time: null`, which `WHERE start_time IS NOT NULL` excludes — so
every package meeting would be written with **no database-level protection
against double-booking at all**.

`busyMeetings` would still hide a taken hour from the picker, but that is a
check, not a guarantee. The constraint is the thing that makes two clients
clicking at once impossible, and it is the reason `isSlotTakenError` exists.

**So step 0 is a migration that puts the same rule on `scheduling_meetings`:**

```sql
ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_no_overlap
  EXCLUDE USING gist (user_id WITH =, tstzrange(start_time, end_time) WITH &&)
  WHERE (meeting_status IS NULL OR meeting_status = 'held');
```

Two things to settle before writing it:

1. **The booking's status is not on this table.** The bookings constraint also
   requires `status IN ('confirmed','pending','completed')`. A meeting of a
   cancelled job is already stamped `meeting_status: 'cancelled'` at runtime, so
   the meeting-side filter covers it — but that is now load-bearing rather than
   belt-and-braces, and the backfill `20261075` is what made it true for old
   rows.
2. **Existing duplicates will refuse the constraint.** Rescheduling deliberately
   writes a SECOND row for the same booking, and those rows carry different
   times — so they do not overlap and are fine. But any genuine overlap already
   in the table has to be found and settled before the constraint can be added.

### G1 — The write path still creates children

| Writer | Today | Needs |
|---|---|---|
| `ProposalAcceptanceService.createPackageMeetings` | container + N child bookings | container + N rows in `scheduling_meetings` |
| `POST /api/scheduling/bookings/[id]/meetings` | one more child | one more meeting |
| `BookingLifecycleService.createBooking` | takes `parentBookingId` | the parameter becomes unused for packages |

### G2 — `booking.meeting_status` stops meaning anything

**88 live reads** take attendance off the booking. That is correct while a
booking has one meeting and is nonsense when it has six.

This is the gap that decides the size of the project — see §4.

### G3 — Readers that walk `parent_booking_id`

18 files, and most are one line. Grouped by what they actually want:

| What they want | Files | Replacement |
|---|---|---|
| "the meetings of this job" | client portal (`book/manage/[token]` route, calendar, layout), `confirmPackageOnPayment` | read `scheduling_meetings` by `booking_id` |
| "is this a purchase or a session" | `CRMContactRepository` (×2), `isQuotedJob` (×3 copies) | every booking is a purchase now; the predicate simplifies |
| "group the cards" | `CRMContactDrawerV2` (555, 584) | a package is one card with its meetings, which is what the drawer already draws for attempts |
| "one order, not seven" | `money/route.ts`, `moneyItems` | already the intent — this makes it true by construction |

### G4 — Confirming on payment

`confirmPackageOnPayment` moves the children from `pending` to `confirmed`.
Under one booking that is a single-row update, which is **simpler**, not harder.

### G5 — The 45/95 stage binding

Stages bound to a booking: 95. Carrying a `meeting_id`: 45. Before the money can
key on meetings, every **per-session** stage needs its meeting. Not all 95 —
instalments on ordinary bookings are not session-billed.

---

## 3. The money gate

`billSessionOnCompletion` raises invoices and deliberately still keys on
`booking_id`. Its own comment states the terms:

> Of 81 stages bound to a booking, ZERO belong to a booking with more than one
> attempt. So `booking_id` is unambiguous today … It becomes the necessary key
> at Phase 5, when child bookings stop being written and a booking's several
> meetings are the only thing left to bill against.

**That is this project.** The moment six meetings share one `booking_id`, a
lookup keyed on the booking can bill the wrong session or bill twice.

So the money change is not optional and not deferrable: it moves in the same
slice as the write path, or the first package to bill per session bills wrong.

---

## 4. What makes this one slice rather than five

The 88 readers of `booking.meeting_status` are the reason the parent plan calls
Phase 5 "its own project". They do not have to move.

**Keep writing the mirror.** A package's container goes on carrying
`meeting_status` for its *next unsettled* meeting, exactly as a single-meeting
booking does today. Every one of the 88 keeps working, unchanged and correct for
the question it asks ("what is the state of this job's current appointment").

That turns a 140-file migration into a 12-file one, and it is honest: the column
is a derived convenience, which is what it has been since Phase 1.

**Dropping the column is NOT in this slice.** It stays, written, read, and
documented as derived. Phase 6 can retire it once the readers move on their own
schedule.

---

## 5. The work

| # | Change | File |
|---|---|---|
| 1 | Create N meetings on the container instead of N child bookings | `ProposalAcceptanceService.ts` |
| 2 | Add a later meeting as a meeting row | `bookings/[id]/meetings/route.ts` |
| 3 | Bill against `meeting_id`, falling back to `booking_id` for legacy rows | `billSessionOnCompletion.ts` |
| 4 | Bind each per-session stage to its meeting at acceptance | `ProposalAcceptanceService.ts` |
| 5 | Confirm the package by updating one booking | `confirmPackageOnPayment.ts` |
| 6 | List a package's sessions from meetings | `book/manage/[token]/route.ts`, `calendar/route.ts`, `layout.tsx` |
| 7 | One card per package, its meetings inside | `CRMContactDrawerV2.tsx` |
| 8 | Write the mirror from the next unsettled meeting | `SchedulingRepository.syncMeeting` |

**Reuse, do not rewrite:** `recurringDateKeys`, `syncMeeting`, `busyMeetings`,
`meeting-cancel`, `BookingEmailService`. None of them change.

---

## 6. The data migration

Seven rows. One migration, reversible by keeping the children until it is proven:

1. For each child: insert a meeting on its container with the child's time,
   `meeting_status`, `occurrence_number`, and calendar columns.
2. Re-point `payment_plan_installments.booking_id` → the container, and set
   `meeting_id` to the meeting just written.
3. Mark the children `status: 'cancelled'` **and** their meetings
   `meeting_status: 'cancelled'` so they stop holding slots — rather than
   deleting them, so the change can be read and reversed.
4. A follow-up migration deletes them once the owner-facing surfaces are proven.

Step 3 is the one to get right: deleting first would cascade the children's own
meetings away and lose the times before step 1 could copy them.

---

## 7. How it is tested

**Before anything:** the existing suites must be green. Today they are unrun —
`npx jest lib/scheduling app/api/scheduling components/scheduling lib/business-os`.
A migration regression is indistinguishable from an already-broken test.

| Test | Asserts |
|---|---|
| Acceptance writes one booking and N meetings | no row carries `parent_booking_id` |
| Each meeting holds its slot | `busyMeetings` returns N intervals for the package |
| Cancelling the job cancels every meeting | all N read `meeting_status: 'cancelled'` |
| Cancelling ONE meeting leaves the others | the job stays `confirmed` |
| A per-session stage bills its own meeting | marking #3 held bills stage #3, not #1 |
| Billing twice is refused | the second press finds the stage settled |
| The client's portal lists N sessions | from meetings, with no `parent_booking_id` |
| The mirror still answers | `booking.meeting_status` is the next unsettled meeting's |
| The migration is idempotent | running it twice yields N meetings, not 2N |

---

## 8. Risks

| # | Risk | Answer |
|---|---|---|
| R1 | **Billing the wrong session, or twice** | §3. The money moves in the same slice; both tests above are mandatory |
| R2 | A client's portal shows the wrong times | Owner-facing surfaces first, as Phase 4 did. The portal reads the same meetings the owner has already verified |
| R3 | The migration loses a time | Children are cancelled, not deleted. `booking_id` is `ON DELETE CASCADE`, so a delete would take the meetings with it |
| R4 | Two shapes coexist during rollout | Readers take `meetings ?? children`, so an un-migrated package keeps working |
| R5 | "One shot" hides a failure | The acceptance path already handles a clashing date by creating the rest and naming the one it lost. Same answer here |
| R6 | **A package meeting is written with no overlap protection** | G0. The constraint migration lands FIRST and is proved by a test that tries to double-book and expects `23P01` |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Written | Scoped Phase 5 to packages after finding the series still modelled as child bookings. Gaps measured against the live database: 7 child bookings, 1 container, 45 of 95 stages carrying a `meeting_id` |
