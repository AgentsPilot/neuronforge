# Package proposals paid upfront — five reported faults

> **Last Updated**: 2026-10-27

## Overview

Five faults reported against a **multi-session quotation paid upfront in one
payment** (`payment_shape: {kind: 'single'}`, `sessions.bill_per_session: false`).
All five were reproduced against live data on booking
`89715036-5be9-40bd-a444-0cb0d0686170` — "Quotation Offering time", 3 sessions,
$660 — unless noted.

Four have a named root cause in code. One (T4) is a feature with product
decisions still open.

Two of them — T2 and T5 — turn out to be **the same defect**.

---

## Table of contents

- [The booking everything was measured on](#the-booking-everything-was-measured-on)
- [T1 — sessions can be sold outside working hours with no warning](#t1--sessions-can-be-sold-outside-working-hours-with-no-warning)
- [T2 / T5 — upfront payment does not settle, so the package never confirms](#t2--t5--upfront-payment-does-not-settle-so-the-package-never-confirms)
- [T3 — the Payment column in the session list is empty](#t3--the-payment-column-in-the-session-list-is-empty)
- [T4 — cancelling a session should offer to add another](#t4--cancelling-a-session-should-offer-to-add-another)
- [Order of work](#order-of-work)
- [Change History](#change-history)

---

## The booking everything was measured on

| fact | value |
|---|---|
| service | Quotation Offering time, `sale_mode: proposal`, `is_scheduled: true` |
| proposal | accepted, total **660**, `payment_shape: {kind:'single'}`, `bill_per_session: false` |
| invoice `INV1611-00034` | **`status: 'sent'`** — with `paid_at` set |
| transaction | **`succeeded`, 660** |
| booking `.payment_status` | `paid` |
| booking `.status` | **`pending`** |
| `payment_plan_installments` | **none** |

Three of those rows disagree with each other. That disagreement is T2/T5.

---

## T1 — sessions can be sold outside working hours with no warning

**Reported:** "it let the user book out of availability days/time and not alert."

**Root cause — a truthiness test on an object that is always truthy.**

`ProposalBuilderModal` resolves which hours to check a session against. A
package service keeps no weekly pattern of its own, so the business's hours are
meant to be the fallback. The fallback is chosen like this:

```ts
if (service?.availability) {
  setServiceHours(service.availability);
  return;
}
```

`scheduling_services.availability` on this service is **`{}`** — an empty
object, which is truthy. So the service's "pattern" wins, `serviceHours` is set
to `{}`, and the business fallback never runs.

Downstream, the check is skipped rather than failed:

```ts
const windows = serviceHours ? windowsForDate(serviceHours, dateKey, timeOff) : [];
if (windows.length > 0) {           // `{}` yields no windows → never true
  const inside = windows.some(...)
  if (!inside) return { outside: windows[0] } as const;
}
```

So every session passes the hours test by having nothing to be tested against.

**Note:** this is a *regression of a fix*. The comment above that block
describes this exact symptom being found and fixed before ("six weekly sessions
where the first sat at 00:00 on a business open 09:00–17:00"). The fallback was
added; the condition that selects it was not tightened, so an empty pattern
still defeats it.

**Fix:** treat an empty pattern as "no pattern recorded" — fall through to the
business hours when `availability` has no day with any window in it, not merely
when the field is absent. The existing warning machinery then works unchanged.

**Stays a warning, not a refusal.** The existing comment is right: an owner may
deliberately see one client outside normal hours, and acceptance books it
regardless. The requirement is only that it stops being silent.

---

## T2 / T5 — upfront payment does not settle, so the package never confirms

**Reported as two faults:**

- T2: "when user accepts in the public pages, the payment is not initiated as
  it is supposed to be upfront payment"
- T5: client reschedule fails with **"This booking is no longer open for changes"**

**They are one defect.** The money is taken at the processor and the local
settlement does not complete.

Evidence on the measured booking:

| | |
|---|---|
| transaction | `succeeded`, 660, at 17:54:46 |
| invoice | still **`sent`**, though `paid_at` = 17:54:45 |
| container booking | still **`pending`** |

**Why that breaks reschedule.** `confirmPackageOnPayment` is what moves a
package container from `pending` to `confirmed`, and it runs from exactly one
place: `invoiceSettlement`. Settlement did not complete, so the container is
still `pending`. The public reschedule route refuses on:

```ts
if (booking.status !== 'confirmed') {
  return … { code: 'not_reschedulable' }
}
```

which the portal renders as *"This booking is no longer open for changes."*

So the client cannot move any session of a package they have **already paid
for in full**.

It is not, as first suspected, an attempt to update all the sessions at once.
A reschedule did succeed earlier on this booking (session 1, 6 Nov → 9 Nov, at
17:59), which is consistent with the container's status being the gate rather
than anything about the session itself.

**Fix, in two parts:**

1. **Find why settlement stops.** The invoice carries `paid_at` while its
   `status` stays `sent`, so settlement began and did not finish — the update
   that moves the status, and everything after it including
   `confirmPackageOnPayment`, did not run or failed silently. This is the same
   class as the previously-recorded "paid at Stripe, unpaid locally" incident.
2. **Make a paid package reschedulable.** Even with (1) fixed, the gate is
   `status !== 'confirmed'` on the container. Confirm that a paid package
   reliably reaches `confirmed`, and that the refusal names which of its
   reasons applies instead of one message for four causes.

**Open question for T2 specifically:** whether the client is *taken to payment
at the moment of acceptance*, or merely emailed a link. On this booking the
charge landed four minutes after the invoice was raised, which does not
distinguish the two. Needs one acceptance run with the network traced before
changing the acceptance route.

---

## T3 — the Payment column in the session list is empty

**Reported:** "in the email there is a list of the meetings with a Payment
column but it is empty, and it needs to divide the total amount to each
meeting."

**Root cause.** `packageSessionLines` reads a session's money from one place
only:

```ts
.from('payment_plan_installments')
.select('meeting_id, amount, currency, status, invoice_id')
```

A package billed **per session** has one installment row per meeting, and the
column fills. A package paid **upfront in one payment** has **no installment
rows at all** — the whole 660 is a single invoice — so every session's `amount`
resolves to null and the column renders empty for all of them.

**Fix:** when there are no per-session stages and the package was paid as one
sum, divide the invoice total across the sessions and show each session's
share, marked paid.

Two details that decide whether the figures are trustworthy:

- **The division must not lose money to rounding.** 660 over 3 is clean; 100
  over 3 is not. Distribute so the shares sum exactly to the total (the last
  session absorbs the remainder) rather than rounding each independently.
- **It is a share, not a price.** The client paid one sum; the per-session
  figure is this platform's arithmetic, not a charge they were billed. The
  wording should not imply three separate payments were taken.

---

## T4 — cancelling a session should offer to add another

**This is a feature, not a defect.** Reported behaviour is absent rather than
wrong, and two product decisions are still open.

**Requested:**

1. When a session of a package is cancelled (owner or client), the cancel
   dialog offers a toggle: *add another session?* The new session goes after
   the last existing one.
2. If adding it would exceed the number of sessions in the proposal, a second
   toggle asks whether to charge for the extra meeting.
3. In the **client portal**, cancelling a session is removed entirely —
   reschedule only.

**What already exists:** adding a session to a package works and has its own
email ("A session has been added to your package"); the measured booking has a
4th session created that way, beyond the 3 in the proposal. So the mechanism
exists and only the offer-on-cancel is missing.

**Decisions needed before building:**

- **Where does the new session land?** "After the last one" — at the same
  weekday and hour as the last session, one interval later? The interval
  between existing sessions is not necessarily uniform.
- **What does charging mean here?** The package was paid upfront. An extra
  session must either raise a new invoice for one session, or be added at no
  charge. The price of a single session is not currently a stored fact for a
  package sold as a block — it would be the per-session share from T3, which
  is arithmetic rather than an agreed price.

**Note on (3):** removing cancel from the portal while keeping reschedule is
straightforward and independent of the rest. It can ship on its own.

---

## Order of work

| # | Task | Status |
|---|---|---|
| 1 | **T1** — empty availability pattern defeats the hours warning | ✅ fixed |
| 2 | **T2/T5** — settlement returns early, package never confirms | ✅ fixed in code; **one stuck booking still needs repairing** |
| 3 | **T3** — Payment column empty on an upfront package | ✅ fixed |
| 4 | **T4 part 3** — portal cancel removed for packages | ✅ fixed |
| 5 | **T4** — the block cannot grow past what was agreed | ✅ enforced (route + control hidden) |
| 6 | **T4** — the replacement toggle, on cancel **and** no-show | ✅ built end to end |

### The replacement offer

Cancelling or missing a session of a package now offers to put another in its
place. The same toggle on both dialogs, with one difference that belongs to the
money rather than the control:

| outcome | its portion of the payment | so the replacement is |
|---|---|---|
| **cancelled** | moves to the replacement | paid for already |
| **no-show** | stays with the missed session — the hour was held | **free**, the owner's to give |

**The offer names the hour before the owner agrees.** A toggle that silently
booked an appointment would be the one control on that screen whose effect could
not be seen. The hour is proposed by `nextSessionSlot`, which reads the block's
own rhythm — the most common gap, not the last one, so a session moved earlier
does not mislead it — then walks that rhythm forward until it finds an hour that
is **free across the whole diary** and **in the future**. Nothing free within
twelve rhythms means no offer, and the owner places it by hand.

Decided server-side (`GET …/meetings?excluding=…`) rather than in the drawer,
because the drawer cannot see it: the agreed count is on the proposal, the diary
belongs to every client and not just this one, and the rule has to match the
route that would otherwise refuse the write.

Two distinctions the implementation turns on, both of which were wrong first time:

- **The count excludes the session being answered; the rhythm does not.** It
  frees a place, but its date is still a fact about when the block meets.
  Filtering the schedule the same way left nothing to read when the last
  standing session was the one being cancelled — the case where an owner most
  wants the offer.
- **Defaults off.** The other toggles on those dialogs choose between messages;
  this one books an appointment and emails a client.

### What the client receives

**One email, not two.** The cancellation and missed-appointment mails already
carried the whole block — `packageSessionLines` builds it and all four
session-bearing templates render it — so the only thing wrong was ORDER: a
replacement booked after the outcome was missing from the one list the client
actually reads, and arrived separately as "a session has been added to your
package", about a session appearing from nowhere.

So the replacement is booked FIRST and silently (`notify: false` on the add
route, default true everywhere else), and the outcome mail that follows says the
whole thing. Rendered for a 3-session block paid at $660, session 2 cancelled
and replaced on 4 Dec:

```
SUBJECT: The meeting on Friday, November 20, 2026 is cancelled

  Fri, Nov 13, 10:00 AM    Upcoming     $220.00  paid
  Fri, Nov 20, 10:00 AM    Cancelled
  Fri, Nov 27, 10:00 AM    Upcoming     $220.00  paid
  Fri, Dec  4, 10:00 AM    Upcoming     $220.00  paid
```

The cancelled row carries no figure because its portion moved to the
replacement. After a NO-SHOW the same list shows the missed session keeping its
$220 and the make-up carrying none — the two outcomes differ in the money and
the list says so without being told twice.

If the replacement cannot be booked — the hour went in the seconds since it was
proposed — the cancellation still goes ahead and the owner is told. A
cancellation blocked by a diary clash would be the worse failure.

### The rule, as decided 2026-10-27

> Cancelling a session offers a replacement, and the replacement carries that
> session's portion of the payment. A block is never added to beyond the count
> that was agreed — that would make the client's total wrong against the
> contract they accepted. To sell more, raise a new quote or a new booking.

This **removed** the open question about charging for an extra session: there is
no such thing as an extra, so nothing needs pricing.

**It applies to UPFRONT blocks only.** A package billed per session is paid
after each session is held, so a seventh on a block of six is priced when it
happens and contradicts no agreed total. That is the case the "Add another
meeting" control was written for and it is deliberately untouched — verified
against the live account, where a per-session block sitting at 4 of 4 still
offers it.

**A replacement is not an extra.** The count is taken over sessions still
standing, so cancelling one frees a place for another. Growing the block is what
is refused; repairing it is not.

Enforced in two places, which were checked against every real package on the
account and agree on all six: the add-session route refuses with
`package_already_complete`, and the control is hidden via `packageFull`.

**Consequence for T3:** shares now follow the sessions still STANDING, capped at
the agreed count — not the first N by position. Otherwise a cancelled session
would keep a portion it will never deliver while its replacement, being last in
the list, showed nothing.

### What T2/T5 turned out to be

`settleInvoicePaid` opens with a dedupe guard — if a succeeded transaction
already exists for the invoice, return. The guard is right about the thing it
exists for (a redelivered webhook must not record a second payment) and was
returning before everything after it, **including `confirmPackageOnPayment`**.

It keys on a TRANSACTION row, and the transaction is not always written by that
function. On the measured booking the charge row was created **0.6s before** the
invoice's `paid_at`, so settlement found it and returned immediately.

The early return now means "do not record a second payment", not "do not finish
the job": the invoice status catches up (only when it is behind) and the package
confirmation runs (it filters on `status = 'pending'`, so it is a no-op when
already done). The receipt email deliberately stays below the return — it exists
there so a replay cannot send a second one.

### The one booking still stuck

Repairing the code does not repair the row: the catch-up runs on the **next**
settlement call for that invoice, and nothing re-triggers it. A sweep found
exactly one affected booking across the whole account:

| | |
|---|---|
| container | `89715036` — status **`pending`**, should be `confirmed` |
| invoice | `INV1611-00034` — status **`sent`**, carries `paid_at`, $660 paid |

Until it is repaired, that client still cannot reschedule. Two writes fix it;
they have **not** been made.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-27 | Created | Five reported faults investigated against live data; root causes named for T1, T2/T5 and T3; T4 scoped as a feature with open decisions |
| 2026-10-27 | T1, T2/T5, T3, T4 part 3 fixed | T2/T5 traced to the dedupe guard in `settleInvoicePaid` returning before `confirmPackageOnPayment`. One booking remains stuck and needs a data repair |
