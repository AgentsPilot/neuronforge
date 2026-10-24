# A booking exists only once the client has finished booking

> **Last Updated**: 2026-10-16
> **Status**: plan, not started.

## Overview

The public booking routes write the `scheduling_bookings` row when the client
submits their details — **before** payment, for every service that takes money.
A client who opens the card dialog and closes it has said no, and the platform
has already recorded a booking, a contact, a CRM activity and a permanent lock
on the slot.

This plan moves the write to the end of the journey: **one row, written once, at
the stage where the slot, the payment and the configuration are all known** —
the same rule for every service type.

---

## Table of Contents

- [What happens today](#what-happens-today)
- [Why the row is the wrong artefact](#why-the-row-is-the-wrong-artefact)
- [The rule](#the-rule)
- [The one thing that breaks, and the hold](#the-one-thing-that-breaks-and-the-hold)
- [The change](#the-change)
- [Regression defence — do this first](#regression-defence--do-this-first)
- [What moves with the write](#what-moves-with-the-write)
- [Risks](#risks)
- [Verification](#verification)
- [Open decisions](#open-decisions)
- [Change History](#change-history)

---

## What happens today

Both public surfaces — `app/site/[subdomain]/book/BookingWidget.tsx` and
`components/website/blocks/ProcessFlowSection.tsx` — run:

```
POST /api/website/booking/create   → inserts the booking, status 'pending'
       ↓
    Stripe Checkout
       ↓
POST /api/website/booking/finalize → UPDATES that booking to confirmed/paid
```

`create` inserts at [route.ts:680](/app/api/website/booking/create/route.ts):

```ts
status: requiresPayment || isQuoteRequest ? 'pending' : 'confirmed',
```

An abandoned checkout therefore leaves:

| Artefact | Written by | Cleaned up |
|---|---|---|
| `crm_contacts` row | `create`, before the booking | never |
| `scheduling_bookings` row, `pending` | `create` | never |
| `booking_created` CRM activity | **Postgres trigger T2** on INSERT | never |
| The slot, locked by `scheduling_bookings_no_overlap` | the INSERT itself | never |
| Confirmation / intake emails | — correctly gated on `!requiresPayment` | n/a |

No cron touches `scheduling_bookings`. `checkout.session.expired` is handled
only by the Boost handler, for the platform's own billing — never for a client
booking. Nothing releases the slot, ever.

---

## Why the row is the wrong artefact

`pending` is indistinguishable from a real booking in the CRM card, the activity
feed, the bookings list and the calendar. It asserts a commitment the client
never made, and the trigger-written activity states it outright: *"booking
created"*, about someone who decided not to book.

Closing a required payment dialog is an unambiguous no. There is no reading of
it under which a booking exists.

---

## The rule

> **The booking row is written once, at the last stage of the journey, where the
> slot, the payment and the configuration are all known. The same rule for every
> service type.**

No service type gets an earlier write. Free, invoice-collected, card, quote
request and product all converge on one write point, which removes the
`requiresPayment ? 'pending' : 'confirmed'` fork that created this gap.

---

## The one thing that breaks, and the hold

Deleting the early write leaves the slot unprotected while the client pays:

```
A opens checkout  ──────────────► A pays ──► INSERT rejected (23P01)
B opens checkout ──► B pays ──► INSERT ok
```

A has paid for a slot that no longer exists, and the only exit is a refund —
which the standing rule forbids. The window is one to three minutes and it
bites hardest on the slots people actually compete for.

**A hold is not a booking.** The time has to be protected while payment is in
flight; nothing should appear in the CRM, the calendar, the activity feed or any
count until the client finishes. Today one row does both jobs, which is the same
one-column-two-facts mistake fixed in `SchedulingBookingRepository.cancel` on
2026-10-15.

**Proposed:** `scheduling_slot_holds` — `user_id`, `service_id`, `start_time`,
`end_time`, `expires_at`, `contact_email`. Read by the availability endpoint and
the pre-insert slot check; read by **nothing else**. Expiry is the whole point:
a hold that outlives its checkout session frees itself.

Rejected alternative: keep the `pending` booking and hide it from every
owner-facing surface. That looks cheaper and is not — it is the `jobCalledOff`
failure mode of 2026-10-15, where four call sites each needed the same new
condition and one was missed every time. With a hold, the row simply is not a
booking, so no surface has to remember to ignore it.

---

## The change

### 1. `POST /api/website/booking/create` → prepare, do not insert

Keep: validation, service load via `schedulingServiceRepository.findById`,
bookable check, slot availability check, contact resolution *(see open
decisions)*.

Replace the booking insert with:
- a `scheduling_slot_holds` row with `expires_at` (30 min, matching the Stripe
  session's minimum), for scheduled services only — a product has no slot
- a returned `hold_id` plus everything the client needs to start checkout

The booking-reuse block at [route.ts:624](/app/api/website/booking/create/route.ts)
becomes hold reuse, and keeps its purpose: a client who returns must not
accumulate rows.

### 2. `POST /api/website/booking/finalize` → create, do not update

Takes the `hold_id` and the payment outcome. On success:
- re-check the slot is still free, then INSERT the booking `confirmed`
- consume the hold
- everything in [What moves with the write](#what-moves-with-the-write)

On failure or abandonment: nothing. The hold expires on its own.

### 3. One completion path for services that take no payment

A free or invoice-collected service has no Stripe round trip, so today `create`
is also its last stage. Under the rule it must still write at the end — the
client's final confirm action calls the same completion endpoint, with no
payment outcome to report.

Reuse, do not rewrite: `createBooking` in `BookingLifecycleService` is the
owner-side producer and already does the slot check, the invoice and the plan
schedule. Converging the public path onto it is the "Later, optional" item from
`happy-splashing-crab` and is in scope here, because this plan already rewrites
the write.

### 4. Release the orphans that exist

A one-off: cancel `pending` + unpaid website bookings older than the hold
window. The account was empty when this was investigated, so the backfill may be
a no-op — it must still run, because other tenants are not this account.

---

## What moves with the write

Everything the INSERT currently triggers moves with it. Missing one is how this
plan fails:

| Effect | Today | After |
|---|---|---|
| `booking_created` activity | Postgres trigger T2 on INSERT | unchanged — fires at the new write |
| Confirmation + intake emails | `create`, `!requiresPayment` branch only | the completion path, all types |
| `createBookingInvoice` | `create` | completion path |
| `createBookingPaymentPlan` installments | `create` | completion path |
| Calendar sync | `confirm` / `finalize` | completion path |
| `crm_contacts` row | `create` | see open decisions |

---

## Regression defence — do this first

This is the highest-regression-risk change in the booking area, and the exposure
is measurable:

| | |
|---|---|
| `create/route.ts` | 927 lines, **15 recorded bugs** |
| `finalize/route.ts` | 445 lines, **3** |
| `confirm/route.ts` | 314 lines, **2** — and nothing calls this route |
| Tests guarding all three | **one file, 8 assertions** (`publicBookingWiring.test.ts`) |
| Tests exercising create → finalize end to end | **none** |

Twenty fixes are recorded in prose and protected by eight assertions. Every one
of those comments exists because something broke in production: the double
submit 68ms apart, the confirmation email that vanished when a promise outlived
its request, the plan billed as one invoice, the `sale_mode` omission "one bug
later", the service a narrow `select` could not see.

The inventory is done:
[public-booking-recorded-bugs-inventory.md](/docs/workplans/public-booking-recorded-bugs-inventory.md).

**A rewrite that starts from the current code will silently undo some of them.**
Nothing will fail; the comments will simply be describing behaviour that no
longer exists.

So the sequence is not negotiable:

1. **Inventory.** ✅ Done — all 20, with file, line, what broke and what must
   stay true.
2. **Characterise before touching anything.** Write a test per entry against the
   CURRENT code, and watch it pass. These are not tests of the new design; they
   are a recording of what the routes do today, including the parts nobody
   remembers.
3. **Mutation-check the characterisation.** A test that passes against both the
   old and the new behaviour protects nothing. Break each recorded fix
   deliberately and confirm its test fails.
4. **Only then** make the change, with that suite green throughout.
5. Ship behind a flag, per service type, so a regression is one toggle from
   contained rather than a revert of a money path.

Steps 1–3 are the bulk of the work and the whole value. If the budget runs out,
stopping after step 3 leaves the codebase better defended than it is today and
loses nothing.

---

## Risks

| Risk | Mitigation |
|---|---|
| A payment succeeds and the booking INSERT fails (slot taken, DB error) — the client is charged with nothing to show | The hold is what prevents it; the re-check is a backstop. If it still fails, this is the one place a refund is correct, and it must be automatic and logged, not silent. |
| `finalize` is never called — client closes the tab after paying | A paid session with no booking is money with no row. Needs the Stripe webhook as the authority, not the browser. **This is the strongest argument for doing the write in `checkout.session.completed` rather than in `finalize`.** |
| Two client surfaces drift | They already both call `create` and `finalize`; the contract change hits both at once, and a guard test asserts neither calls a booking insert directly. |
| Holds leak | `expires_at` plus a sweeper. The sweeper is a select-then-process drain and must follow the `durable-queue-drain` pattern. |

---

## Verification

1. **The reported case.** Open a card-payment booking on the public site, reach
   Stripe, close the tab. Expect: **no** `scheduling_bookings` row, **no**
   `booking_created` activity, a `scheduling_slot_holds` row that expires, and
   the slot bookable again by another client after expiry.
2. **The happy path, per service type** — free, invoice-collected, card,
   card + payment plan, product, quote request. Each produces exactly one
   booking, one activity, the right emails, and for the plan the full
   instalment schedule.
3. **The race.** Two sessions holding the same slot: the second is refused at
   hold time, before either reaches payment.
4. **Guard test** that neither public surface nor `create` inserts into
   `scheduling_bookings`, and that the completion path is the only writer.
   Mutation-check it.
5. `npm test -- app/api/website lib/services lib/payments`, then clear the jest
   cache and the scratch directory.

---

## Open decisions

1. **Does an abandoned checkout still create a CRM contact?** Someone who
   reached the payment page is a genuine lead and losing them loses a follow-up.
   But today they are filed as a *client with a booking*, which is the thing
   being fixed. Keeping the contact and dropping the booking is probably what is
   wanted — it needs saying explicitly.
2. **Browser or webhook as the authority for "paid"?** `finalize` is the
   browser; `checkout.session.completed` is Stripe. The webhook is the only one
   that survives a closed tab. Doing the write there makes `finalize` a
   read-only "did it land yet" poll.
3. **Hold window.** 30 minutes is Stripe's minimum session expiry and the
   natural match. Shorter frees slots faster and risks cutting off a slow payer.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Investigation of abandoned card checkouts holding slots permanently; rule set that the booking is written only at journey completion, for every service type. |
