# Separating the Meeting from the Booking

> **Last Updated**: 2026-10-16

## Overview

`scheduling_bookings.status` answers three independent questions with one
five-value enum: *is the time still reserved*, *did the meeting happen*, and *is
the job still on*. Every symptom in this document follows from that single
compression.

This requirement proposes giving the **meeting** its own state and actions,
leaving the **booking** as the container whose state is the sum of its layers.

**Sections 7 and 8 are the point of this document.** They are a complete,
mechanically produced inventory of every place booking status is read or
written, each classified by what it actually means. The inventory was built by
sweeping all 174 files that touch `scheduling_bookings`, extracting all 195
status call sites, and resolving each one to the table it queries. It is not a
sample.

---

## Table of Contents

1. [The problem](#1-the-problem)
2. [Evidence from the live system](#2-evidence-from-the-live-system)
3. [The target model](#3-the-target-model)
4. [The four buckets](#4-the-four-buckets)
5. [Actions and where they live](#5-actions-and-where-they-live)
6. [Cancel and Complete](#6-cancel-and-complete)
7. [Gaps and automations: full impact](#7-gaps-and-automations-full-impact)
8. [Full reader and writer inventory](#8-full-reader-and-writer-inventory)
9. [Pre-existing bugs this exposes](#9-pre-existing-bugs-this-exposes)
10. [Phased delivery and sequencing constraints](#10-phased-delivery-and-sequencing-constraints)
11. [Open decisions](#11-open-decisions)

---

## 1. The problem

A booking is a container for three layers. Two already have their own state and
actions. One does not.

| Layer | Its own state | Its own actions |
|---|---|---|
| Money | `payment_status`, invoices, plans | ✅ |
| Proposal | `proposals.status` (own table) | ✅ |
| **Meeting** | ❌ squats in `booking.status` | ❌ |

The three questions `status` is asked at once:

| Question | Values doing the work |
|---|---|
| Is the time reserved? | `confirmed`, `pending`, `completed` hold it; `cancelled`, `no_show` free it |
| Did the meeting happen? | `completed`, `no_show` |
| Is the job on? | `cancelled`, plus `cancel_reason` / `cancelled_by` |

---

## 2. Evidence from the live system

### 2.1 "Cancelled but held" is inexpressible, so a hack was added

`lib/repositories/SchedulingRepository.ts:1651`

```ts
...(attendanceRecorded ? {} : { status: 'cancelled' as const }),
```

Cancelling a booking whose status is `completed` or `no_show` does **not** write
`cancelled`. The cancellation lands only in `cancel_reason`, `cancel_note` and
`cancelled_by`.

### 2.2 A gate branch is therefore unreachable

`lib/business-os/quoteGate.ts:76` tests `bookingStatus === 'cancelled'`. For a
held booking that is now impossible, so the gate falls through to line 90
(`=== 'completed'`) and returns `'open'`. **This is the reported bug:** the
create-quote button survives the cancel.

The sibling `jobIsOver` was already given a `calledOff` input for exactly this
(`BookingsTab.tsx:87-97`). `quoteGate` was not.

### 2.3 It is in production data

Account `08456106-aa50-4810-b12c-7ca84102da31`, one row created during testing
on 2026-10-16:

```
booking=4c515dc8  status=completed  cancel_reason=client_no_show       cancelled_by=owner
booking=f4944490  status=completed  cancel_reason=client_unresponsive  cancelled_by=owner
```

Two cancelled jobs wearing `completed`. Every query filtering
`status = 'cancelled'` misses them. Section 9 lists which.

### 2.4 Cancelling reaches neither the proposal nor the money

Verified: `app/api/scheduling/bookings/[id]/cancel/route.ts` and
`SchedulingRepository.cancel()` never mention proposals, and no `withdraw` call
exists in that path. A quote already sent stays `sent`, its client link keeps
working, and the client can accept a cancelled job. No invoice is voided and no
plan stopped.

> The comment at `CRMContactDrawerV2.tsx:878` asserts cancelling withdraws the
> quote server-side. **It is false** and must be corrected with this work.

### 2.5 Today's "Complete" button is "meeting held", and it bills

`lib/payments/billSessionOnCompletion.ts`, opening line:

> *"The meeting happened, so the client is billed for it."*

Called from `app/api/scheduling/bookings/[id]/complete/route.ts:69` and
`MutateExecutor`'s `complete` verb. See §10.1 for why this rules out the
simplest version of the design.

---

## 3. The target model

Nothing is removed from `status` initially. A column is added beside it.

| Layer | State | Values |
|---|---|---|
| **Job** | `scheduling_bookings.status` | `pending`, `confirmed`, `completed`, `cancelled` |
| **Meeting** | `scheduling_bookings.meeting_status` *(new)* | `null`, `held`, `no_show`, `cancelled` |
| **Money** | `payment_status`, invoices, plans | unchanged |
| **Proposal** | `proposals.status` | unchanged |

`no_show` and `cancelled` are different facts: one unplanned and possibly
chargeable, one known in advance. `null` means nobody has said yet, the state
that does not exist today.

### Predicate module

One module every reader goes through. Home: `lib/business-os/bookingStatus.ts`
(imports nothing, so public routes can use it).

```ts
meetingHeld(b)       // meeting_status === 'held'
meetingMissed(b)     // meeting_status === 'no_show'
meetingOff(b)        // meeting_status === 'cancelled'
meetingUnmarked(b)   // meeting_status === null
jobCalledOff(b)      // status === 'cancelled' || cancel_reason || cancelled_by
holdsSlot(b)         // !jobCalledOff(b) && !meetingMissed(b) && !meetingOff(b)
outcomeRecorded(b)   // jobCalledOff(b) || meeting_status !== null
canCompleteJob(b)    // §6
```

A guard test must ban direct `status === 'completed' | 'no_show' | 'cancelled'`
outside this module.

---

## 4. The four buckets

**Every reader must be assigned a bucket.** Getting it wrong is silent in both
directions.

| Bucket | Rule | Typical meaning |
|---|---|---|
| **A — require `held`** | only once the meeting happened | delivered work, billing |
| **B — require `null`** | only before anything happened | pre-meeting chases |
| **C — exclude missed/off** | clock is the trigger, column only rules out | quote chasing |
| **D — job lifecycle** | use `jobCalledOff`, not `status` | cancellations, refunds |
| **E — slot occupancy** | use `holdsSlot` | availability |
| **F — writer** | sets state | the actions |

**Bucket B is the dangerous one.** Everything pre-meeting works today *by side
effect*: it relies on some meeting outcome overwriting `confirmed`. Once held
stops writing `status`, every bucket-B reader keeps firing forever unless it
moved in the same deploy. See §10.2.

Bucket A must **not** be applied where the clock is the real trigger.
`quoteGate.ts:13-16` records why: *"owners quote from the van and rarely mark an
appointment done first, so gating on `status === 'completed'` would have held
the button shut for the whole population it was meant to serve."*

---

## 5. Actions and where they live

A button lives inside the stage it acts on.

### Meeting stage (journey strip)

| Action | Writes |
|---|---|
| התקיימה | `meeting_status = 'held'` |
| לא הגיע | `meeting_status = 'no_show'` |
| בטל פגישה | `meeting_status = 'cancelled'` |
| הצע מועד חדש | reschedule (existing) |

None touch `status`. A missed or cancelled meeting leaves the job alive.

### Booking header

Two buttons only: **Cancel** and **Complete**.

### Single-meeting direct services

Where the booking *is* the appointment, keep one merged button writing both.
Nobody gains a step.

---

## 6. Cancel and Complete

### Cancel — the only action that cascades

| Layer | Effect |
|---|---|
| Job | `status = 'cancelled'` + reason + actor |
| Meeting | any not-yet-held meeting → `cancelled`, slot freed |
| Proposal | `draft`/`sent`/`viewed` → `withdrawn`, client link dead |
| Money | unpaid invoices voided, running plan stopped |

Invariants: **held meetings stay held**, **money already taken stays taken** and
surfaces as a refund decision. Cancelling stops the future, never edits the
past. Rows 3 and 4 are new behaviour (§2.4).

### Complete — gated

`canCompleteJob` requires every applicable stage settled:

| Stage | Settled means |
|---|---|
| Meeting(s) | no past meeting with `meeting_status = null` |
| Proposal *(quoted only)* | a quote `accepted`, or none required |
| Money | paid or nothing owed; plan finished or stopped |

Show **why** it is unavailable ("Quote not sent", "₪1,200 outstanding") rather
than a bare greyed control.

---

## 7. Gaps and automations: full impact

All eight gaps that query booking status, resolved to their gap id.

| Line | Gap id | Current filter | Bucket | Change |
|---|---|---|---|---|
| 190 | `quote_unwritten` | `.neq('status','cancelled')` | **C** | exclude `jobCalledOff`, `no_show`, `cancelled` meetings |
| 416 | `intake_outstanding` | `.eq('status','confirmed')` | **B** | add `meeting_status IS NULL` |
| 505 | `meeting_upcoming` | `.eq('status','confirmed')` | **B** | add `meeting_status IS NULL` |
| 594 | `booking_cancelled` | `.eq('status','cancelled')` | **D** | use `jobCalledOff` |
| 825 | `booking_refunded` | `.eq('status','confirmed')` | **D** | verify, likely `jobCalledOff` |
| 902 | `stage_awaiting_completion` | `.eq('status','pending')` | **D** | payment stage, likely unchanged |
| 1091 | `meeting_unmarked` | `.in('status',['confirmed','pending'])` | **B** | `meeting_status IS NULL` — **this is what it always meant** |
| 1220 | `meeting_auto_completed` | `.eq('status','completed')` | **A** | `meeting_status = 'held'` |

### Automations driven by these gaps

`lib/business-os/gaps/automations.ts`:

| Automation | Gap | Impact |
|---|---|---|
| `chase_quotes` | `quote_unwritten` | stops chasing called-off jobs and no-shows |
| `chase_intake` | `intake_outstanding` | must stop at a cancelled meeting |
| `remind_about_meeting` | `meeting_upcoming` | **would remind clients about cancelled meetings** without the B fix |
| `auto_complete_meetings` | `meeting_unmarked` | **would re-complete held meetings forever** without the B fix; and is itself a **writer** that must write `meeting_status = 'held'`, not `status = 'completed'` |
| `reply_to_enquiries` | — | no booking status |
| `chase_invoices` | — | invoice status only |

The chasers themselves gate on business shape (`requires: 'takes_bookings'` in
`automationApplies.ts`), **not** on booking status. They need no change. Only
the gap queries that feed them do.

### Services

| File | Line | Bucket | Change |
|---|---|---|---|
| `lib/services/IntakeReminderService.ts` | 83 | **B** | `.eq('status','confirmed')` → add `meeting_status IS NULL` |
| `lib/services/WebsiteBlockEnrichmentService.ts` | 501, 1257 | **A** | `.eq('status','completed')` → `meeting_status = 'held'` |
| `lib/services/BookingLifecycleService.ts` | 586 | **F** | cancel writer, gains the cascade |
| `lib/services/LeadResponseDispatchService.ts` | 385 | **F** | auto-marks held; must write `meeting_status` |

---

## 8. Full reader and writer inventory

### 8.1 Insight detectors (13 of 60+ touch booking status)

| Detector | Line | Current | Bucket | Change |
|---|---|---|---|---|
| `CashWorkUnbilledDetector` | 144 | `.eq('completed')` | **A** | `meeting_status='held'` — see §10.1 |
| `CashBookingUnpaidDetector` | 126 | `.eq('confirmed')` | **C** | exclude cancelled/missed meetings |
| `CashCancelledUnrefundedDetector` | 191 | `.eq('cancelled')` | **D** | `jobCalledOff` — **already broken**, §9.1 |
| `OpsLastMinuteCancelsDetector` | 88 | `.eq('cancelled')` | **D→meeting** | this counts *meeting* cancels; becomes `meeting_status='cancelled'` |
| `RetCancelPatternDetector` | 155 | `.eq('cancelled')` | **D→meeting** | same |
| `RetCancellationSpikeDetector` | 68, 89 | `.eq('cancelled')` | **D→meeting** | same |
| `RetCancellationSpikeDetector` | 124 | `.eq('completed')` | **A** | `meeting_status='held'` |
| `RetNoShowSpikeDetector` | — | `no_show` | **meeting** | `meeting_status='no_show'` |
| `RetRepeatBookingLowDetector` | 62 | `.eq('completed')` | **A** | delivered work |
| `OpsUtilizationLowDetector` | 224 | `OCCUPIES_A_SLOT` | **E** | `holdsSlot` |
| `OpsUtilizationLowDetector` | 355 | `.eq('completed')` | **A** | delivered work |
| `OpsPeakUnutilizedDetector` | 95, 112 | `['confirmed','completed']` | **E** | slot occupancy |
| `OpsPeakUnutilizedDetector` | 188 | `['completed']` | **A** | delivered work |
| `OpsServicePerformanceDetector` | 112 | `['confirmed','completed']` | **A/E** | verify which |
| `PricingDiscountAbuseDetector` | 149 | `['confirmed','completed']` | **A/E** | verify which |
| `PricingIntroOfferStuckDetector` | 76 | `['confirmed','completed']` | **A/E** | verify which |
| `ConvNoNextStepDetector` | 141, 149, 150 | `.neq('cancelled')`, `.neq('completed')` | **C** | exclude called-off |
| `ConvServiceRateDropDetector` | 102 | `.neq('cancelled')` | **C** | exclude called-off |

> **Rule from project memory: never delete a detector.** Every one above must
> keep firing. §10.1 covers the one that would silently die.

### 8.2 Availability and slot occupancy (bucket E)

All already route through `SLOT_HOLDING_STATUSES`, which is the good news:
changing `holdsSlot` fixes them together.

| File | Line |
|---|---|
| `app/api/website/booking/availability/route.ts` | 310 |
| `app/api/website/booking/confirm/route.ts` | 123 |
| `app/api/website/booking/create/route.ts` | 396 |
| `app/api/website/scheduling/availability/route.ts` | 446 |
| `app/api/conversion/[userCode]/availability/route.ts` | 258 |
| `lib/repositories/SchedulingRepository.ts` | 962 |
| `lib/business-os/insight/health/resolveBusinessHealth.ts` | 229 |

**Must-have test:** a no-show or cancelled meeting still frees its slot. This was
itself a bug fix (`bookingStatus.ts:73-81`) and is the easiest thing to undo.

### 8.3 Public client-facing routes (bucket D + meeting)

| File | Line | Reads |
|---|---|---|
| `app/api/book/manage/[token]/intake/route.ts` | 176, 352 | `outcomeRecorded` |
| `app/api/book/manage/[token]/intake/upload/route.ts` | 164 | `outcomeRecorded` |

`outcomeRecorded` gains the meeting column (§3). These decide whether a client
may still submit or upload to an intake form.

### 8.4 Stats, metrics and reporting

| File | Line | Current | Bucket |
|---|---|---|---|
| `app/api/business-os/metrics/summary/route.ts` | 76, 85 | `['confirmed','completed']` | A/E — verify |
| `app/api/business-os/stats/route.ts` | 609 | `.eq('confirmed')` | verify |
| `app/api/business-os/stats/route.ts` | 964, 971, 979 | `.neq('cancelled')` | **D** |
| `lib/repositories/ChannelAttributionRepository.ts` | 133 | `.neq('cancelled')` | **D** |
| `lib/business-os/insight/health/resolveBusinessHealth.ts` | 129 | `.eq('completed')` | **A** |
| `lib/business-os/briefing/BriefingFactsService.ts` | — | payments only | none |

Expect reported numbers to move once `jobCalledOff` replaces
`status = 'cancelled'`: two jobs on the test account change category (§2.3).

### 8.5 Chat, BizQL and plugin surfaces

| File | Line | Note |
|---|---|---|
| `lib/business-os/ChatCommandExecutor.ts` | 2367 | `cancel()` from chat |
| `lib/business-os/bizql/mutate/MutateExecutor.ts` | 1442 | `.eq('confirmed')` |
| `lib/business-os/bizql/mutate/MutateExecutor.ts` | 1587 | `complete()` + `billSessionOnCompletion` |
| `lib/business-os/bizql/mutate/MutateExecutor.ts` | 1610 | `markNoShow()` |
| `lib/server/scheduling-plugin-executor.ts` | 118, 122, 126 | **agent-facing operations** |
| `lib/business-os/chat/CapabilityEngine.ts` | 270, 463, 521 | typed, not a query |
| `lib/business-os/catalog/catalog.ts` | 1639 | **chat query vocabulary + Hebrew labels** |

`catalog.ts` needs a new catalogued field and enum for `meeting_status`, or the
chat cannot answer "which meetings were held". The plugin surface is exposed to
user-built agents, so its operation names and semantics are a public contract.

### 8.6 Writers (bucket F) — complete list

| # | Caller | Method | Means today |
|---|---|---|---|
| 1 | `app/api/scheduling/bookings/[id]/complete/route.ts:37` | `complete()` | meeting held **+ bills** |
| 2 | `app/api/scheduling/bookings/[id]/no-show/route.ts:115` | `markNoShow()` | meeting missed |
| 3 | `BookingLifecycleService.ts:346, 586` | `cancel()` | job off |
| 4 | `app/api/scheduling/bookings/[id]/route.ts` PATCH | `update({status})` | any |
| 5 | `ChatCommandExecutor.ts:2367` | `cancel()` | job off, from chat |
| 6 | `MutateExecutor.ts:1587` | `complete()` | meeting held, from chat |
| 7 | `MutateExecutor.ts:1610` | `markNoShow()` | meeting missed, from chat |
| 8 | `scheduling-plugin-executor.ts:118,122,126` | all three | **agents / automations** |
| 9 | `LeadResponseDispatchService.ts:385` | `complete()` | auto-marks held |
| 10 | `auto_complete_meetings` automation | via 9 | auto-marks held |
| 11 | `payments/confirmPackageOnPayment.ts:90,116` | `status: 'confirmed'` | payment confirms booking |
| 12 | `payments/syncBookingPaymentState.ts:165` | `status: 'confirmed'` | same |
| 13 | `app/api/payments/invoices/[id]/mark-paid/route.ts:198` | `status: 'confirmed'` | same |
| 14 | `payments/stopBookingPlan.ts:212` | `status: 'cancelled'` | plan stop cancels booking |
| 15 | `account/cancelBookingsForClosure.ts:111` | account closure | bulk cancel |
| 16 | `website/booking/{create,confirm,finalize}` | creation | `pending`/`confirmed` |
| 17 | `website/proposal-request/route.ts:365` | creation | `confirmed` |

Writers 5 to 10 are outside the drawer. Writer 8 is reachable by user-built
agents. Writers 11 to 13 mean *payment confirmed the booking* and are unrelated
to the meeting; they are safe.

---

## 9. Pre-existing bugs this exposes

### 9.1 Two detectors already miss held-then-cancelled jobs

`CashCancelledUnrefundedDetector:191` and `OpsLastMinuteCancelsDetector:88` both
query `.eq('status','cancelled')` directly. Neither reads the
`booking.cancelled` event. So the two production rows in §2.3 — cancelled jobs
with money attached — **are invisible to the unrefunded-money detector today.**

`CashCancelledUnrefundedDetector` already selects `cancelled_by, cancel_reason`
in the same query. It is one predicate away from correct.

### 9.2 No-shows are chased for a quote

`quote_unwritten` excludes only `cancelled`, so a client who never turned up is
still reported as waiting on a price.

### 9.3 The quote-withdrawal comment is false

`CRMContactDrawerV2.tsx:878`. See §2.4.

### 9.4 Possibly dead columns

`reminder_24hr_sent` and `reminder_2hr_sent` exist on the table, but no cron
sends them; reminders run through the `remind_about_meeting` automation and the
`meeting_reminder` queue. Confirm before treating them as live.

---

## 10. Phased delivery and sequencing constraints

### Phase 1 — add and backfill (zero risk)

Add `meeting_status`. Backfill `completed → held`, `no_show → no_show`. Existing
buttons write **both** columns. Nothing reads the new one.

### Phase 2 — move readers, one per PR

Predicate module + guard test, then work §7 and §8 bucket by bucket. This is the
bulk of the work and the whole of the safety.

### Phase 3 — split the actions

Meeting buttons move to the meeting stage and write `meeting_status` only.
Delete the hack at `SchedulingRepository.ts:1651`. **Fixes the reported bug.**

### Phase 4 — wire the container

Cancel cascades (§6). Complete becomes gated (§6).

### 10.1 Hard constraint: gating Complete would kill billing and a detector

The one-button-gated-on-payment version is **circular and must not be built**:

- Package sessions are billed *by* completion (§2.5). Gate completion on
  payment and the invoice is never raised, so payment can never arrive.
- `CashWorkUnbilledDetector` is defined as *"completed, with no invoice raised
  and no payment"*. Gate completion on money and that state is impossible by
  definition. The detector would not error; it would return nothing forever.

**Mitigation:** billing and that detector key on `meetingHeld`, repointed in
Phase 2, **before** Complete is redefined in Phase 4. This ordering is not
optional.

### 10.2 Hard constraint: bucket B must land with Phase 3

Three readers work today only because a meeting outcome overwrites `confirmed`:

- `IntakeReminderService.ts:83`
- `meeting_upcoming` (`definitions.ts:505`) → **reminds about cancelled meetings**
- `meeting_unmarked` (`definitions.ts:1091`) → **re-completes held meetings forever**

The moment the held button stops writing `status`, these must already read
`meeting_status`. They cannot be a later cleanup.

### 10.3 Expect numbers to move

Replacing `status = 'cancelled'` with `jobCalledOff` makes previously invisible
rows visible (§9.1). Cancellation, utilisation and unbilled-work figures will
change on first deploy. This is a correction, not a regression, but it must be
announced or it will be read as one.

---

## 11. Open decisions

1. **Cancellation reason fields.** `cancellation_reason`, `cancel_reason`,
   `cancel_note`, `cancelled_by` describe "the cancel". With two cancels, which?
   Recommendation: the meeting, since every reason in production
   (`client_no_show`, `client_unresponsive`, `owner_double_booked`) is about an
   appointment.
2. **Does `no_show` leave `BOOKING_STATUSES`?** It is not a job state.
   Recommendation: defer past Phase 4; accepted-but-never-written until every
   reader has moved.
3. **Recurring meetings.** Children already carry `parent_booking_id` and
   `occurrence_number`. Confirm a child's `status` is the job's and its
   `meeting_status` its own, and that cancelling one occurrence never cascades.
4. **Six detectors need A-vs-E confirmation** (marked "verify" in §8.1 and §8.4):
   does `['confirmed','completed']` mean *delivered work* or *occupied a slot*?
   They will not all answer the same way.
5. **Plugin contract.** `scheduling-plugin-executor` exposes complete/cancel/
   no-show to user-built agents. Do the operation names change, or do they stay
   and map to the new columns?

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Written from the reported bug where cancelling a held consultation left the create-quote button on screen. |
| 2026-10-16 | Full inventory | Replaced the partial reader list with a mechanical sweep: 174 files touching `scheduling_bookings`, 195 status call sites, 63 resolved to the bookings table, all 8 gaps mapped to their ids, 18 detector sites classified. Added §9 (pre-existing bugs) and §10.2 (bucket-B sequencing constraint). |
