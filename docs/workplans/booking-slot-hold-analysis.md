# Where a slot hold can live, and what it would touch

> **Last Updated**: 2026-10-16
> **Status**: analysis only. No solution chosen.

## Overview

Before changing how a slot is reserved, this maps every path that creates a
booking, every place that decides whether a slot is free, and everything that
reads bookings afterwards. The question being answered is narrow: **if a slot is
held while a client pays, where can that hold live without breaking something
else.**

Written because the first three proposals in conversation each missed a
variation.

---

## 1 · Every path that creates a booking — eight

| # | Path | Who triggers it | Recurring? |
|---|---|---|---|
| 1 | `app/api/website/booking/create/route.ts:661` | **client, public site** | no |
| 2 | `app/api/website/booking/confirm/route.ts:223` | — **dead, nothing calls it** | no |
| 3 | `app/api/website/proposal-request/route.ts:357` | client, quote request | no |
| 4 | `lib/services/BookingLifecycleService.ts:1272` | owner (`createBooking`) | no |
| 5 | `lib/services/ProposalAcceptanceService.ts:563` | quote accepted — **package container** | **yes** |
| 6 | `lib/services/ProposalAcceptanceService.ts:593` | quote accepted — **package children** | **yes** |
| 7 | `lib/business-os/chat/CapabilityEngine.ts:457` | owner, via chat | no |
| 8 | `lib/server/scheduling-plugin-executor.ts:89` | agent / plugin | no |
| 9 | `lib/business-os/ai-data-layer/SafeExecutionLayer.ts:2005` | agent | no |

**Recurring and package meetings are created by paths 5 and 6 only** — quote
acceptance. The public booking widget has no `parent_booking_id`, no
`occurrence_number` and no recurrence of any kind: one submit, one booking.

So the path being changed never creates a recurring meeting, and the paths that
do create them are not being changed.

---

## 2 · Every place that decides a slot is free — six

| # | Where | Used by |
|---|---|---|
| 1 | `app/api/website/scheduling/availability/route.ts:446` | the public slot list |
| 2 | `app/api/website/booking/availability/route.ts:310` | the booking widget's slot list |
| 3 | `app/api/website/booking/create/route.ts:392` | re-check at submit |
| 4 | `app/api/website/booking/confirm/route.ts:123` | dead route |
| 5 | `lib/repositories/SchedulingRepository.ts:962` | the repository's conflict check |
| 6 | `app/api/book/manage/[token]/reschedule/route.ts` | a client moving their own booking |

All six ask the same question of the same table: *is there a booking in
`SLOT_HOLDING_STATUSES` overlapping this range.*

**They are opt-in.** The conflict check at #5 is a separate method, not something
`create()` performs — so a caller that forgets it writes a booking with no check
at all. That is why the real protection is in the database:

```sql
EXCLUDE USING gist (user_id WITH =, tstzrange(start_time, end_time) WITH &&)
WHERE status IN ('confirmed','pending','completed')
```

**This constraint is the only guarantee in the system.** Everything above it is
advisory.

---

## 3 · Everything that reads bookings — 132 sites, 57 files

```
grep -rn "from('scheduling_bookings')" app/ lib/ components/   →  132 sites
                                                                   57 files
```

Calendar, CRM drawer, dashboard counts, orders page, reports, exports, insight
detectors, chasers, the chat capability engine, the plugin executor.

---

## 4 · What that means for the hold

Two places a hold could live, and the cost of each is the mirror of the other.

### Option A — a row in `scheduling_bookings`

A new status, say `hold`.

- ✅ No migration. The exclusion constraint protects it if the status is added
  to the constraint's list.
- ❌ **Up to 132 read sites across 57 files must learn to exclude it.** Every
  count, every list, every export, every detector.
- ❌ This is the failure shape of 2026-10-15, where one new condition was needed
  in four places and one was missed every time. At 57 files it is not a risk,
  it is a certainty.

### Option B — its own table

- ✅ Nothing reads it except availability, so **none of the 132 sites change**.
- ✅ A booking is still only ever a booking.
- ❌ **Six availability sites must learn to include it.** Tractable, and the
  same six already share one import.
- ❌ **The database guarantee does not span two tables.** No constraint can stop
  a hold and a booking existing for the same slot; only the application checks
  can. Holds become advisory, and a missed check degrades to today's behaviour
  — a race — rather than to corruption.
- ❌ A second exclusion constraint is needed on the holds table itself, or two
  clients can hold the same slot.

### Option C — no hold at all

- ✅ Nothing to build, nothing to sweep, no new table.
- ❌ Two clients can both pay for one slot. The loser is charged and must be
  refunded automatically.

---

## 5 · What has to be true whichever is chosen

1. The six availability readers stay in agreement. They share one import today;
   they must share one predicate tomorrow.
2. The exclusion constraint keeps protecting bookings. It is the only hard
   guarantee and must not be weakened to accommodate a hold.
3. Package children (paths 5 and 6) keep working. They are written in a loop
   after the container, and each is a real booking with a real slot — so they
   must respect holds, which they get through the repository conflict check at
   #5 **only if their caller invokes it**.
4. The dead `confirm` route is resolved — revived or deleted. Leaving a third
   booking-creating route that nothing calls is how the next person reuses the
   wrong one.
5. Rescheduling (#6) is a slot move, not a create. It must release the old slot
   and take the new one without a window where it holds neither or both.

---

## 6 · What is still unknown

- **Why `confirm/route.ts` was abandoned.** 314 lines implementing
  "create the booking after payment" — the target design — with no record of why
  it was dropped. Until someone can say, it cannot be trusted or deleted.
- **Whether the six availability readers actually agree today.** They share an
  import, not a function. Verifying that is cheap and should happen before any
  of them is changed.
- **Whether rescheduling has the same abandonment gap.** It moves a slot, and it
  was not examined here.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Mapped the eight creation paths, six availability checks and 132 read sites before proposing where a hold can live. |
