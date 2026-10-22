# The meetings table

> **Last Updated**: 2026-10-17
> **Follows**: [BOOKING_MEETING_SEPARATION_REQUIREMENT.md](/docs/requirements/BOOKING_MEETING_SEPARATION_REQUIREMENT.md) · [BOOKING_MEETING_SEPARATION_WORKPLAN.md](/docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md)

## Overview

`meeting_status` gave the meeting its own state. It did not give it its own
ROW — so a booking still holds exactly one meeting, a reschedule overwrites the
previous attempt, and three no-shows are indistinguishable from one.

This plan gives a meeting a row. The booking stays the **job**; the meeting
becomes a narrow child record with its own time, its own outcome, and its own
money binding.

**Do it now.** The migration is 169 meeting rows and 81 payment bindings today.
The same migration at a million meetings is a different project.

---

## Table of Contents

1. [Why a new table rather than more bookings](#1-why-a-new-table-rather-than-more-bookings)
2. [The schema](#2-the-schema)
3. [What moves, what stays, what needs both](#3-what-moves-what-stays-what-needs-both)
4. [The payment binding](#4-the-payment-binding)
5. [Readers to migrate](#5-readers-to-migrate)
6. [Phases, with no broken moment](#6-phases-with-no-broken-moment)
7. [Risks](#7-risks)

---

## 1. Why a new table rather than more bookings

The obvious move is "give every booking a child booking, one per meeting". It
is wrong at scale.

`scheduling_bookings` is **37 columns wide** — intake JSONB, calendar-sync
fields, payment ids, cancel fields, booking source. A meeting needs about
twelve of them. Making every simple booking spawn a child would roughly double
the row count of the widest table in the system, each new row carrying
twenty-five columns it will never use.

A narrow table does the opposite. Package meetings ALREADY live in
`scheduling_bookings` today, at full width. Migrating them out makes the wide
table smaller:

```
today                              after
  205 bookings  (37 cols)            198 bookings  (37 cols)
    incl. 7 child meetings           169 meetings  (12 cols)
```

Net storage falls. At a million meetings the difference is the whole argument.

---

## 2. The schema

```sql
CREATE TABLE public.scheduling_meetings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL,
  booking_id               uuid NOT NULL REFERENCES scheduling_bookings(id) ON DELETE CASCADE,

  start_time               timestamptz NOT NULL,
  end_time                 timestamptz NOT NULL,
  timezone                 text,

  -- null = nobody has said yet. The ordinary state of a past meeting.
  meeting_status           text CHECK (meeting_status IN ('held','no_show','cancelled')),

  -- Which of the N this is. 1 for a simple booking.
  occurrence_number        integer NOT NULL DEFAULT 1,

  -- Per APPOINTMENT, not per job: each occurrence is its own calendar entry
  -- and gets its own reminders.
  external_calendar_event_id text,
  calendar_synced_at       timestamptz,
  reminder_24hr_sent       boolean NOT NULL DEFAULT false,
  reminder_2hr_sent        boolean NOT NULL DEFAULT false,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_user_time ON scheduling_meetings (user_id, start_time);
CREATE INDEX idx_meetings_booking  ON scheduling_meetings (booking_id);
CREATE INDEX idx_meetings_open     ON scheduling_meetings (user_id, start_time)
  WHERE meeting_status IS NULL;
```

Twelve columns. The two queries that matter — "this owner's meetings in this
window" and "this job's meetings" — each have an index.

The overlap constraint that today lives on `scheduling_bookings`
(`scheduling_bookings_no_overlap`) moves here with the times, because this is
now the table that knows when things are.

---

## 3. What moves, what stays, what needs both

| Per MEETING — moves | Per JOB — stays on the booking |
|---|---|
| `start_time`, `end_time`, `timezone` | `contact_id`, `service_id` |
| `meeting_status` | `status` (pending/confirmed/completed/cancelled) |
| `occurrence_number` | `cancel_reason`, `cancel_note`, `cancelled_by` |
| `external_calendar_event_id`, `calendar_synced_at` | `payment_status`, `invoice_id`, `payment_plan_id` |
| `reminder_24hr_sent`, `reminder_2hr_sent` | `intake_responses`, `intake_sent_at`, `intake_completed_at` |
| | `booking_source`, `notes`, `internal_notes` |

**Intake stays on the job deliberately.** One form prepares the engagement, not
each appointment — a six-session package asks once.

**The booking keeps `start_time` as a denormalised summary** of its first or
next meeting. Dropping it would force every list, email and search to join, for
a value that is almost always wanted. It becomes a cache, not the truth, and
the meetings table is what writes it.

---

## 4. The payment binding

**This is the one thing that breaks if it is not planned for.**

`payment_plan_installments.booking_id` today points at a CHILD booking — that is
how "bill after session 3" knows which session. 81 rows are bound this way.
When meetings leave `scheduling_bookings`, that child stops being a booking and
the binding loses which meeting it bills.

Additive fix, no broken moment:

1. `ALTER TABLE payment_plan_installments ADD COLUMN meeting_id uuid REFERENCES scheduling_meetings(id);`
2. Backfill: for each instalment whose `booking_id` is a child booking, set
   `meeting_id` to that child's new meeting row.
3. `booking_id` is repointed to the PARENT job and stays valid throughout.
4. `billSessionOnCompletion` reads `meeting_id`; `booking_id` keeps working for
   everything that asks "which job is this money for".

The same treatment for anything else that currently binds to a child booking —
calendar events and reminder flags come across as columns, so only the money
needs a new key.

---

## 5. Readers to migrate

From the sweep in the requirement's §8. The dividing line is simple: **does the
question ask about an appointment, or about the job?**

### Ask the meetings table

| Reader | Asks |
|---|---|
| `meeting_upcoming` → the reminder chaser | is an appointment coming |
| `meeting_unmarked` → auto-complete chaser | did one pass unmarked |
| `intake_outstanding` → the form chaser | is an appointment still ahead |
| `RetNoShowSpikeDetector` | how many were missed |
| `RetCancelPattern`, `RetCancellationSpike`, `OpsLastMinuteCancels` | meeting cancels |
| `OpsUtilizationLow`, `OpsPeakUnutilized` | slot occupancy |
| `OpsServicePerformance`, `resolveBusinessHealth` | delivered work |
| the 6 availability queries | is this slot free |

### Keep asking the bookings table

`quote_unwritten` · `booking_cancelled` · `booking_refunded` ·
`stage_awaiting_completion` · `CashCancelledUnrefunded` · `CashBookingUnpaid` ·
`ConvNoNextStep` · `ConvServiceRateDrop`

### Needs both

`CashWorkUnbilled` — *"the meeting was held and nobody invoiced it"*. Meeting on
one side, money on the other. **Build the join against this one first**: if it
reads cleanly here it reads cleanly everywhere.

### The surfaces that DRAW meetings

Every screen that shows a client a time, or an owner a diary, reads
`booking.start_time` today. Each has to decide: keep reading the booking's
summary, or ask the meetings.

**Client-facing — these matter most, because a wrong time here is a missed
appointment, not a wrong number on a dashboard.**

| Surface | What it shows | After |
|---|---|---|
| `app/book/manage/[token]/page.tsx` | the client's own portal: their meeting, or every meeting of a package | **meetings** — this is the 360 view the client sees, and today a package already lists children here |
| `app/book/manage/[token]/layout.tsx` | the same data for the shell | **meetings** |
| `components/public/AppointmentCard.tsx` | one appointment, date and time | **meetings** |
| `components/public/ReschedulePanel.tsx` | picking a new time | **meetings** — it writes a time, so it must write the meeting |
| `app/site/[subdomain]/book/BookingWidget.tsx` | the public booking flow | **meetings** for free/busy; the booking is still what gets created |
| `components/website/blocks/ProcessFlowSection.tsx` | marketing copy about how booking works | no change — it describes a process, not a row |

**Owner-facing**

| Surface | After |
|---|---|
| `components/scheduling/SchedulingCalendarView.tsx` | **meetings** — a calendar is a list of appointments, and a package's six sessions are six entries |
| `components/scheduling/SchedulingBookingModal.tsx` | **meetings** for the time it edits; the booking for service, client and money |
| `app/business-os/page.tsx` (My Day) | **meetings** — "today" is an appointment question |
| `components/crm/contact-drawer/BookingsTab.tsx` | **meetings** for the journey's stage list (Phase 4); the booking for everything else |

**The rule to apply at each one:** if the screen answers *when*, ask the
meetings. If it answers *who, what, or how much*, ask the booking. A screen
that answers both reads both — `SchedulingBookingModal` is the clearest case,
and is worth doing early as the template.

**`ReschedulePanel` is the one with teeth.** It is how a client moves their own
appointment, and under the new model moving a meeting must not silently erase
the one it replaces — that history is the whole point of the table. Rescheduling
becomes: settle the old meeting, insert a new one. Decide there whether a
client-initiated move marks the old row `cancelled` or carries a `moved`
outcome of its own.

### The part that does not come free

Readers that go through `holdsSlot` / `meetingHeld` / `jobCalledOff` swap in one
edit, because the predicate module is the only thing that knows.

A SQL filter cannot call a predicate. `.eq('status','no_show')` inside a
detector becomes a query against a different table, by hand, with its own test.
That is roughly twenty queries. It is the bulk of the work and it is why this
is phased rather than a single change.

---

## 6. Phases, with no broken moment

### Phase 1 — the table, written but unread

Create it. On every booking write that touches a time, write the meeting row
too. Backfill the 169 existing scheduled bookings, one meeting each, and the 7
package children. Nothing reads it. **Reversible by dropping the table.**

### Phase 2 — the payment binding

Add `meeting_id`, backfill the 81 rows, keep `booking_id` valid.
`billSessionOnCompletion` reads the new key. Nothing else changes.

### Phase 3 — readers, one per PR

Section 5, in this order: availability first (narrowest and best tested), then
the four chasers, then the detectors, then `CashWorkUnbilled`'s join last.

#### 3a — availability ✅ done

**The prerequisite nobody had written down.** A meeting knows what happened at
an appointment; it does not know the JOB was called off, and that also frees the
time. Parity against live data found 58 bookings where the two tables disagreed,
every one that shape. Two fixes were possible: join on the hottest read in the
product forever, or record the consequence once where it happens. The second.

- `20261075_cancelled_jobs_cancel_their_meetings.sql` — a called-off job cancels
  the meetings it had not yet held. `held` and `no_show` are never touched:
  calling off the work does not un-happen the consultation. 58 cascaded, the 5
  held-then-cancelled rows kept their outcome, **0 disagreements remaining, 0 in
  the future.**
- **A regression caught on the way.** `cancel()` decided whether to preserve an
  attendance by reading `status` — but since Phase 1 `complete()` writes
  `meeting_status` and leaves `status` alone, so a freshly-held meeting read as
  "no attendance recorded" and the cancel wrote `cancelled` straight over the
  `held`. The exact fact this separation exists to protect, erased through the
  back door. It now reads both columns.

**`lib/scheduling/busyMeetings.ts` — one definition, five callers.** The filter
had already drifted between its five copies (one asked "not cancelled", keeping
a no-show's time shut for good). Callers now read intervals instead of building
filters: `booking/availability`, `booking/confirm`, `booking/create`,
`scheduling/availability`, `materialiseAttempt`, and `checkOverlap`.

Two bugs fell out of consolidating, neither of them the point of the change:

| Found | Was |
|---|---|
| `scheduling/availability` had `limit: 500` | A silent cap on a correctness question — a busy diary's 501st appointment read as free time |
| The same route bounded by containment | An appointment starting before the window and running into it was invisible, so its hours went back on sale |

`checkOverlap` keeps returning bookings, because the chat, the plugin and the
lifecycle service read `client_first_name` off it to say *who* has the slot.
Meetings decide which, bookings say whose: two reads, on the owner's own
double-booking check rather than the public page.

**Verification.** Old query vs new, every owner, two windows: `all time` 107 vs
107 intervals, `next 60d` 14 vs 14, **byte-identical, 0 differing**. 112 suites /
2547 tests green. Guard: `lib/scheduling/__tests__/busyMeetings.guard.test.ts`
pins the `NULL NOT IN` trap, the `cancel()` column read, half-open overlap, and
the window semantics.

The overlap constraint deliberately **stays on `scheduling_bookings`** for now.
It still functions — bookings still carry times — so leaving it is free
belt-and-braces. Moving it can reject writes, which earns its own step.

#### 3b — the readers that were reading the wrong column ✅ done

Not a table move. 17 queries read attendance off `scheduling_bookings`, and
**none of them knew `meeting_status` existed.** Two opposite distortions, both
silent, both growing by one row per meeting marked:

| | Asked | Meant | What went wrong |
|---|---|---|---|
| **9 sites** | `status = 'completed'` | the meeting happened | `complete()` stopped writing it, so each **undercounted** |
| **6 sites** | `.in('status', ['confirmed','completed'])` | not cancelled | `markNoShow()` stopped writing `no_show`, so each **counted missed meetings as live** |

The undercount reached the unbilled-work chaser, the retention and
repeat-booking measures, two revenue averages, the `meeting_auto_completed`
readiness gap, and the "clients served" figure **printed on the owner's public
website**. Nothing threw; the numbers just drifted, which is the worst failure
mode available: an owner watching their insights decline for a reason that is
not in their business.

Fixes: `.eq('meeting_status', 'held')` for the first group — a complete
replacement, since the backfill gave every historical `completed` row a `held`
(verified: `status completed, meeting not held = 0`). `.or(MEETING_HOLDS_SLOT_FILTER)`
added to the second, restoring exactly the rows the pair used to exclude.

**Measured per owner:** only the test account moves (+1 attendance recovered,
2 no-shows excluded). The other four owners are identical — no historical
figure shifts. Guard: `attendanceIsReadOffTheMeeting.guard.test.ts`.

#### 3b.1 — the leak the test caught ✅ done

`businessOwnedTables.test.ts` failed on `scheduling_meetings`: a table created
with a `user_id` that nobody had classified. Its comment names the stake —
unclassified means no foreign key, so the rows survive the business that
created them and are **inherited by the next one**, which is how the pipeline
stages and the capabilities leaked.

It was not leaking: `booking_id` is `ON DELETE CASCADE`, so the rows already go
when the booking goes. Classified anyway, because relying on the parent puts
the protection somewhere other than the column that needs it:

- `BUSINESS_OWNED_TABLES` and the `20260916` array (fresh installs)
- `20261076_scheduling_meetings_ownership.sql` (existing databases) — same
  constraint name the loop would use, so whichever runs first the other is a
  no-op. Check script: `scripts/check-scheduling-meetings-ownership.sql`
- A purge descriptor at `PRE_BLOCKING`, **not** `LEAF`: the booking's cascade
  would otherwise empty the table first and the descriptor would report 0 rows
  deleted for a table that was in fact emptied

#### 3c–3d — still to do

The four chasers, then `CashWorkUnbilled`'s join. The attendance question is now
answered correctly off either table, so these are table moves rather than
correctness fixes.

### Phase 4 — progress

#### 4c (write path) ✅ done — and it closed a double booking

The feature could not be built on the old write path, and the old write path had
a hole. Three facts combined:

1. `markNoShow()` writes `meeting_status`, leaving `status` at `confirmed`.
2. Both reschedule routes gate on `status !== 'confirmed'`. Before the split a
   missed appointment carried `status: 'no_show'` and was refused; now it passes.
3. `rescheduleBooking` wrote only `start_time` and `end_time`.

So a no-show could be moved to a new time while still marked `no_show` — and
`MEETING_HOLDS_SLOT_FILTER` reads a no-show as free, so **the newly booked hour
was not held and availability would sell it again.**

Clearing the outcome alone would have closed that and lost the missed
appointment, whose time would be overwritten. Both halves shipped together:

- `rescheduleBooking` writes `meeting_status: null` — the new attempt has not
  happened yet.
- `syncMeeting` INSERTS a new meeting when the stored one has a settled outcome
  AND the time changed, at `occurrence_number + 1`. The old row keeps its
  outcome and the time it was actually for. **Three missed attempts are now
  three rows** — the 360 view's data model.
- Both conditions required: a settled outcome at the same time is the owner
  marking attendance (one row, updated); an unsettled meeting being moved is an
  ordinary reschedule (one row, updated).
- `syncMeeting`'s read became `.order().limit(1)` — `maybeSingle()` would have
  raised on the first booking to get a second attempt.

10 tests in `SchedulingRepository.secondAttempt.test.ts`.

#### 4a / 4b (surfaces) ✅ done — 11 sites, all reading the wrong column

The Phase 3b sweep covered `lib/` and `app/` but **not `components/`**. Every
one of these was live:

| Surface | Was |
|---|---|
| `BookingsTab` session dot | grey for every meeting marked held |
| `BookingsTab` closing node title | rendered **nothing** after marking held — the one press that should produce it |
| `BookingsTab` card icon | stayed amber ("still coming up") on a held meeting |
| `jobIsOver` | a simple job never ended, so its action strip never retired |
| `MeetingRowActions` | still offered "mark done / no-show / cancel" on a marked meeting |
| `isMeetingPastDue` | said "nobody has said what happened" about a marked meeting |
| `CRMContactDrawerV2` `isCompleted` | drove the intake wording and several step states |
| `SchedulingDialog` quick-pick | showed a no-show's hour as busy — an hour the owner could no longer sell |
| `SchedulingDialog` editor | reopened over a settled meeting |
| `SchedulingCalendarView` ×2 | a held meeting stayed clickable and editable |
| **`book/manage` portal (4b)** | **the client never saw a meeting ticked as held, and a no-show on a future date still read as "coming up" to them** |

The portal was the plan's own R7 risk. Its `select()` named explicit columns and
omitted `meeting_status`, so `held` was always false — and PostgREST rejects the
whole select for one unknown name, which is why the column has to be named there
or the client sees nothing at all.

Slot questions went through `holdsSlot()`; all three scheduling components
already used the shared `SchedulingBooking` type, which declares the column, so
no plumbing was needed.

**Seven stale guards** were repaired on the way, every one pinning an exact
source expression or a fixed-width slice rather than the behaviour. They now
assert the rule.

#### 4c (journey rendering) ✅ done

The read is **opt-in**: `listAttempts()` on the repository, attached by
`/api/scheduling/bookings` only when `include_attempts=true`. `list()` is on
the calendar, chat and plugin paths and none of them draw a journey, so none of
them pay for the second query. Both drawer fetches ask — the first load and the
silent refresh, or the rows would vanish on any reload.

`toAppointment` copies `attempts`, which is the trap that cost us
`meeting_status`: a column the API returns and that function does not name
arrives as `undefined`, with no error and no log.

The rows render only when `attempts.length > 1`, and list `slice(0, -1)` — the
earlier attempts. The current one is already the row above. **So a booking that
has never been rescheduled after an outcome looks exactly as it did**, which is
every booking today. Guard: `everyAttemptIsOnTheJourney.guard.test.ts`.

Two more `status`-reads fixed in the same pass: `nextUp` in the package grouping
(a held meeting still matched `status === 'confirmed'`, so "next up" pointed
backwards and a package of six read as running after all six were done), and the
journey's closing-node title.

#### 4c (emails) — the link now exists, attribution still to build

**There was no link between an email and a booking at all.** `email_sends`
carries `contact_id` and nothing else, so the journey matched emails by guessing
— `findConfirmationEmail(booking.created_at, service_name)`. Survivable with one
appointment per booking; impossible with several, since a heuristic keyed on when
the BOOKING was created cannot tell two attempts apart.

`20261077` adds `booking_id` and `meeting_id`, both `ON DELETE SET NULL` (never
CASCADE: that an email went out is a fact about the business's conduct and
outlives the appointment). Threaded through `recordEmailSend` — one chokepoint
for all 26 send sites — and populated at the 8 booking-scoped sites in
`BookingEmailService`.

**Forward-only, and not backfilled.** Nothing recorded which booking an older
email concerned, so a backfill could only write the existing guess into a column
that would then read as authoritative. 704 existing emails keep `NULL` and the
journey keeps its heuristic for them; the guessing shrinks as new mail arrives.

✅ **Attribution now built.** `recordEmailSend` resolves the attempt itself —
one chokepoint rather than eight senders that can each forget, which is the
spread that let `meeting_status` go unread in fifteen queries. A sender that
genuinely knows the session passes `meetingId` and wins; everything else passes
`bookingId` and gets the attempt current at the moment of sending, which is what
the mail is about. Returns null on any failure: an email that WAS sent must
never be un-recorded because its attribution could not be worked out.

The journey prefers the recorded link and keeps the heuristic only for rows
predating the column. **Both copies of `findConfirmationEmail`** were changed —
the initial load and the silent refresh — and a guard now counts them against
each other, because changing one makes the drawer draw a booking differently
before and after a refresh.

### Phase 3c ✅ done — three chasers were about to nag about settled meetings

| Chaser | Was going to |
|---|---|
| `meeting_upcoming` | send "see you tomorrow" for a meeting marked missed or called off. **Live rows exist in that state** — 3 future bookings carrying a settled outcome |
| `meeting_unmarked` | keep asking "what happened at this meeting?" about meetings already answered, for ever, since `status` no longer changes |
| `IntakeReminderService` | chase a client to fill in a preparation form for a meeting they had already missed |

All three now filter `.is('meeting_status', null)` — written that way, not as a
`NOT IN`, because `NULL NOT IN (…)` is NULL in SQL and would have dropped every
unmarked booking, silently stopping the chaser altogether.

### Phase 3d — deliberately NOT moved, with the measurement

`billSessionOnCompletion` still keys on `booking_id`, against the plan's own
note. The reason: a per-session plan binds its stages to package CHILD
bookings, and measured against live data, **of 81 stages bound to a booking,
zero belong to a booking with more than one attempt.** `booking_id` is
unambiguous today, and changing the key of a path that raises invoices buys
nothing while risking a double bill. `meeting_id` is backfilled and waiting; it
becomes the necessary key at Phase 5.

### Phase 5 — blocked by its own gate, and that is correct

The plan gates it: columns drop *"once nothing reads them"*. **140 live reads of
`meeting_status` remain**, every one off `scheduling_bookings` — and most were
put there deliberately in 3b/4a as the legacy branch for pre-split rows.
Dropping the column now would break the readers this work just repaired.

Phase 5 is its own project: stop writing child bookings, migrate those 140 reads
to the meetings table, then drop. Not a tail end of this one.

### Phase 4 — the surfaces read meetings

Two groups, and the client-facing one carries the risk: a wrong time on an
owner's dashboard is a wrong number, a wrong time in the client's portal is a
missed appointment.

**4a — owner-facing first**, because the owner can spot a wrong time and tell
you: the calendar, My Day, the booking modal.

**4b — client-facing**: the manage-link portal, `AppointmentCard`,
`ReschedulePanel`, the public booking widget.

**4c — the journey.** The stage lists attempts instead of one node. Three
no-shows become three rows. The action buttons attach to the newest unsettled
meeting. **This is the 360 view, and it is what the whole plan is for.**

### Phase 5 — stop writing the old shape

Child bookings are no longer created. `scheduling_bookings.meeting_status`,
`occurrence_number`, `parent_booking_id` and the calendar/reminder columns are
dropped once nothing reads them.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The payment binding loses which meeting it bills.** 81 rows | §4: additive `meeting_id`, `booking_id` valid throughout |
| R2 | **`booking.start_time` is read everywhere** — lists, emails, calendar sync, the client portal | It stays, as a denormalised summary written by the meetings table. No reader is forced to join on day one |
| R3 | **The overlap constraint protects against double-booking** and lives on the old table | Moves with the times in Phase 1, before anything reads the new table |
| R4 | A detector silently returns zero after repointing | Every migrated reader gets a rows-returned test. Zero rows is a failure, not a pass |
| R5 | Two id spaces during migration confuse a future reader | Phase 5 drops the old columns; until then every one carries a comment naming its replacement |
| R6 | **Doing it later costs more** | 169 rows today. This risk grows every day the plan sits unbuilt |
| R7 | **A wrong time on a CLIENT-facing page is a missed appointment.** The manage-link portal, `AppointmentCard`, `ReschedulePanel` and the booking widget all draw times | Phase 4a migrates owner-facing surfaces first, where a wrong time is visible to someone who can report it. 4b follows only once 4a is proven |
| R8 | **Rescheduling could erase the history the table exists to keep.** `ReschedulePanel` lets a client move their own appointment | A move settles the old meeting and inserts a new one. Never an in-place edit of `start_time` — that is the behaviour this whole plan replaces |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-17 | Created | Sized against live data: 205 bookings, 7 child meetings, 169 scheduled, 81 bound instalments. |
