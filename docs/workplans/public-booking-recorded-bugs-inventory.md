# What the public booking routes already learned

> **Last Updated**: 2026-10-16
> **Status**: inventory complete. Step 1 of
> [booking-created-only-when-the-client-completes.md](/docs/workplans/booking-created-only-when-the-client-completes.md).

## Overview

Twenty bugs are recorded in comments across the three public booking routes, and
eight assertions guard them. This is that prose turned into a checklist, so a
rewrite can be checked against it rather than against memory.

Each row is a thing that **broke in production and must still be true
afterwards**. Nothing here is a style preference.

| File | Lines | Recorded bugs |
|---|---|---|
| `app/api/website/booking/create/route.ts` | 927 | 15 |
| `app/api/website/booking/finalize/route.ts` | 445 | 3 |
| `app/api/website/booking/confirm/route.ts` | 314 | 2 |

> **Correction to the parent plan:** it said 57. That figure counted comment
> *lines* matching a bug-word, not distinct bugs — 45 lines in `create` are 15
> blocks. Twenty is the real number.

---

## `create/route.ts`

| # | Line | What broke | What must stay true |
|---|---|---|---|
| 1 | 29 | An import tidy-up removed `smartLinkRepository`, leaving a free variable. `resolveVisitorSessionId()` always returns an id, so every `/site/{subdomain}/book` booking reached it and threw `ReferenceError` **after** the row was written and the email dispatched. The catch turned it into a 500. | A booking that exists is never reported to the client as failed. Attribution must not be able to fail the request. |
| 2 | 51 | — (design) | Business readiness has one definition, shared with the owner's route and the publish gate. Never a per-surface second opinion. |
| 3 | 61 | `session_id` read from the request URL found nothing — this is a POST to an API route, and `_sid` lives in the *page's* URL. The click producing a booking could never be matched to it. | The visitor id travels from the browser in the body. |
| 4 | 210 | The select named 8 of 30 columns by hand. Three bugs, same shape, all silent: `collection` omitted (fell back to price), `sale_mode` omitted "one bug later" (a quoted service looked free), `payment_type`/`installment_count` omitted (a plan billed as one invoice). | The whole service row is loaded through `schedulingServiceRepository.findById`. No hand-typed column list. |
| 5 | 281 | The public route never gated on business readiness, so a client could book an invoiced service from a business with no company name, tax id, address or payment instructions — and be sent an invoice built from none of them. | The public route gates on readiness, like the owner's route. |
| 6 | 402 | A page left open across the owner recording a holiday let a client book a closed day. | Closed days are re-checked server-side, answered as "that time is not available". |
| 7 | 457 | `requiresPayment` was `price > 0`, a different question. A service billed afterwards, or one set to card with no processor, was treated as requiring payment: booking `pending`, confirmation suppressed, client told to pay with nothing on the other side — and no invoice, because the email carrying it was the suppressed one. | Decided by `shouldTakePayment({ price, collection, processorReady })`. |
| 8 | 487 | The route decided the contact's pipeline stage itself, so a quote request produced a *client*. | The route never decides the stage. `promote_contact_on_confirmed_booking` moves them when a booking is written `confirmed`. |
| 9 | 578 | — (design) | Consent is non-blocking: a failure loses a consent record, never a booking. An untouched checkbox writes nothing — it is not a withdrawal. |
| 10 | 596 | Inserted unconditionally, producing one booking per *call*. Two rows landed 68ms apart from a double-mount; only the second was paid, the first sat `pending` forever. A client who abandoned and returned got a second booking for the same seat. | One purchase, one row. Only an UNPAID booking is reusable, matched on service **and** `start_time` (`is` for null, `eq` otherwise). |
| 11 | 706 | Nothing recorded the booking being made, so the first thing in a client's history was a confirmation for an event that appeared from nowhere. | A `booking_created` activity exists on the client's timeline. (Written by Postgres trigger T2 on INSERT.) |
| 12 | 754 | `collection: 'invoice'` money is owed but not taken at booking. The website flow raised no invoice at all — a ₪200 booking produced a confirmation, no bill, nothing to pay against. Only the owner path invoiced. | `createBookingInvoice` runs for invoice-collected services, from the website too. |
| 13 | 777 | `service as never` told TypeScript to stop checking the one shape that would have named the missing plan columns — it is *why* #4 stayed silent. | No cast at the `createBookingInvoice` call. |
| 14 | 806 | Confirmation and intake emails were bare promises with the response returned underneath. A serverless invocation freezes on respond, so the emails and the `booking_confirmation_sent` activity vanished with no error — `.catch` never ran because nothing rejected. Booking 4cd6a797 has its `booking_created` activity and none of the three effects. | The sends are **awaited** before responding, via `allSettled` so a failure is a warning, not a lost booking. |
| 15 | 885 | `markConversion` existed and was called by nothing, so no smart link ever reported a conversion. | The click→booking loop is closed, non-blocking, never fatal. |

---

## `finalize/route.ts`

| # | Line | What broke | What must stay true |
|---|---|---|---|
| 16 | 150 | Wrote `amount: serviceDetails.price` — the whole service price. For a plan the client paid one period, so ₪1,000 of revenue was recorded for a ₪333 charge, then `recordPlanPeriodPaid` banked the real ₪333 on top. The same payment twice, once at triple value. | A plan's money is recorded by the **webhook**, not here. It is the only authority that sees periods 2..n. |
| 17 | 245 | `payment_transactions.stripe_payment_intent_id` is unique and Stripe's `payment_intent.succeeded` records the same payment from the other side. Whichever loses the race violates the constraint — routinely this route, on a cold invocation. Treating 23505 as an error cost a real client. | A 23505 here means the webhook won. It is success, not failure. |
| 18 | 399 | Sent `serviceDetails.price` unconditionally, so a client paying the first ₪333 of three got a receipt for ₪1,000 — a document claiming they paid three times what left their account. | The receipt states what was **charged**, not what was agreed. |

---

## `confirm/route.ts` — and it is dead

Nothing calls this route. The only reference anywhere is a comment in
`CapabilityEngine.ts`. Its header describes exactly the design the parent plan
proposes:

> *"Create a confirmed booking after payment success... Checks slot availability
> (double-check)... Creates the booking with status 'confirmed'"*

| # | Line | What broke | What must stay true |
|---|---|---|---|
| 19 | 1 | — (design) | The booking is created **after** payment, with a slot re-check. |
| 20 | 270 | A booking made by a client through the public site never reached the owner's calendar, while one the owner made always did — so the hour showed free to the only person who needed to know it was taken. | Calendar sync runs for client-made bookings. Non-blocking: the appointment stands whether or not a plugin answers. |

**Read it before reusing it.** 314 lines implementing the target shape is either
a head start or a trap — it was written, superseded by `create` + `finalize`,
and left behind. Whatever made it unsuitable is not written down, and the 15
lessons in `create` postdate it. Treat it as a reference, not a foundation,
until someone can say why it was abandoned.

---

## Coverage

Step 2 is complete. All twenty are guarded, and every guard has been
mutation-checked — the fix broken deliberately, the test confirmed failing.

| Entry | Guarded by |
|---|---|
| #1, #4, #14 | `publicBookingWiring.test.ts` (pre-existing) |
| #2, #3, #5, #6, #7, #8, #9, #10, #11, #12, #13, #15 | `createRouteKeepsWhatItLearned.guard.test.ts` — 23 assertions |
| #16, #17, #18 | `finalizeMoneyIsWhatWasCharged.guard.test.ts` — 13 assertions |
| #19, #20 | `confirm/route.ts` is dead; see above. Guard it if it is revived. |

The booking routes went from **8 assertions to 40**.

Mutations confirmed to fail their guard:

| Fix undone | Consequence it re-opens |
|---|---|
| readiness gate removed | a client books an invoiced service from a business with no tax id |
| `requiresPayment = price > 0` | billed-afterwards services go `pending`, no confirmation, no invoice |
| route decides the contact stage | a quote request files somebody as a paying client |
| reuse ignores `payment_status` | a client buying the same service twice gets one booking |
| no invoice for invoice-collected | a ₪200 booking with nothing to pay against |
| `service as never` restored | the cast that hid three omitted columns |
| conversion call left unguarded | a booking that exists reported to the client as failed |
| plan transaction written here | ₪1,000 of revenue banked for a ₪333 charge, then banked again |
| `23505` treated as an error | the client who paid €100 and heard nothing |
| receipt sent for the agreement | "you paid ₪1,000" for ₪333 |
| local `price / count` split | a receipt that disagrees with the bank by a rounding remainder |

---

## How to use this

1. Each row becomes a test against the **current** code (step 2 of the parent
   plan). Watch it pass before trusting it.
2. Mutation-check each one: break the fix deliberately, confirm the test fails.
   A test green against both old and new behaviour protects nothing.
3. Only then change the routes, with the suite green throughout.

Rows marked "(design)" are rules rather than regressions. They still earn a
test — #8 in particular, because "the route must NOT do X" is the kind of thing
a rewrite reintroduces by accident.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Step 1 inventory extracted from comments in the three public booking routes. Corrected the parent plan's count from 57 to 20. Found `confirm/route.ts` to be dead code implementing the target design. |
