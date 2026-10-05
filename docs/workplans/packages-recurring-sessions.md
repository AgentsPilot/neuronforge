# Packages: one purchase, several meetings

> **Last Updated**: 2026-10-01
> **Status**: Stages 0–4 done; Stage 5 (the readers) started 2026-10-02 after a live package was checked against the database — the data was right, the CRM drawer was not. Both ways of selling a block work end to end. [Stage 3's migration](/supabase/migrations/20261002_proposal_package_booking.sql) is applied.

## Overview

An owner agrees a block of meetings with one client — six coaching sessions, a
course of four treatments, ten lessons — and sells it as a single purchase. The
client approves a quote, and the meetings land in the diary as ordinary meetings:
each with its own reminder, its own reschedule link, its own cancel.

Two ways the money moves, and the owner chooses per package:

1. **Paid up front** — one invoice for the total, before anything is confirmed.
2. **Paid per completed session** — nothing charged at approval; each session
   bills when the owner marks it complete.

**This is not a payments feature.** The money rails for both already exist on the
proposal side. What is missing is that **an accepted proposal produces at most
one meeting**. Everything below is about letting one purchase own several
meetings, and keeping every existing reader honest about which of the two it is
counting.

Three nullable columns. No new table. **No changes to services.**

---

## Contents

- [The flow, for both scenarios](#the-flow-for-both-scenarios)
- [Where each thing is defined](#where-each-thing-is-defined)
- [The quote gate, fixed first](#the-quote-gate-fixed-first)
- [What already exists](#what-already-exists)
- [What we add](#what-we-add)
- [The rule](#the-rule)
- [The lifecycle, and the wires](#the-lifecycle-and-the-wires)
- [Scenario 2 in detail](#scenario-2-in-detail)
- [Decisions already made](#decisions-already-made)
- [How scenario 2 collects — decided](#how-scenario-2-collects--decided-2026-10-01)
- [Time off (Stage 0c)](#time-off-stage-0c)
- [The read-path audit (Stage 1)](#the-read-path-audit-stage-1)
- [Stages](#stages)
- [Files](#files)
- [Verification](#verification)
- [Out of scope](#out-of-scope)
- [The mockup that disagrees](#the-mockup-that-disagrees)
- [Change History](#change-history)

---

## The flow, for both scenarios

Steps 1 and 2 are identical. Everything after approval differs only in **when
money moves**.

### Scenario 1 — paid up front

1. The intro meeting happens and the owner marks it **complete**. (Optional: a
   package can be sent cold, with the dates agreed by phone.)
2. The owner opens the **quote dialog** on that contact: picks the session
   service, ticks **Package**, picks the dates, types the total, chooses
   **charge all up front**, sends.
3. The client opens the quote, approves, and lands on the invoice. The package
   and its meetings are created **`pending`** — which already holds the slots, so
   nobody else can take them.
4. The client pays. The meetings flip to **`confirmed`**, calendar events are
   created, and **one** email goes out listing every date.
5. Each meeting then behaves as any booking does: reminder, manage link,
   reschedule, cancel, no-show.

**If they never pay:** the invoice goes overdue and is chased on days 1, 3 and 7.
The slots stay held until the owner cancels the package, exactly as a single
unpaid booking behaves today.

### Scenario 2 — paid per completed session

1. As above.
2. As above, except the owner chooses **charge after each session**.
3. The client approves. **Nothing is charged.** The meetings are created and
   **confirmed immediately** — there is no payment to wait for.
4. A session happens. The owner marks it **complete** → that session's money
   moves the way the SERVICE collects: a Stripe invoice charged automatically
   against the saved card, or an invoice with a payment link. See
   [How scenario 2 collects](#how-scenario-2-collects--decided-2026-10-01).
5. Repeat per session. **A session that is never marked complete is never
   billed.**

**If the client stops after three:** nothing further is billed, and the owner
releases the remaining slots. Scenario 2's real advantage is not fairness — it is
that **it removes the refund decision entirely**, which is the messiest thing in
the payments area.

---

## Where each thing is defined

| Thing | Where | Why there |
|---|---|---|
| What **one meeting** is: its name, its length, its slot | The **service**, unchanged | A service already describes exactly this |
| **How many** meetings, **which dates**, the **total**, and **how it is charged** | The **quote dialog** (`ProposalBuilderModal`) | The quote is already the agreement document, and it is where the owner is sitting right after the intro meeting |
| The **meetings themselves** | `scheduling_bookings`, as children of one parent booking | They are ordinary bookings and must stay ordinary |

**Nothing is added to the service editor, and there is no new service type.** A
coaching business keeps two ordinary services — *Intro call* and *Coaching
session* — and the package is an agreement with one client about several of the
second one. Putting a "sessions" field on the service would mean **every** client
who books it gets six meetings, which is the opposite of the intent.

> A package proposal **requires** a service. `proposals.service_id` is nullable
> today, but `scheduling_bookings.service_id` is NOT NULL, and the service also
> supplies each child's `duration_minutes` and the name shown in the diary. One
> line of validation; nothing about services changes.

---

## The quote gate, fixed first

Not a packages feature, and a prerequisite for one: the step that decides when an
owner may send a quote currently **assumes the consultation happened** the moment
its start time passes.

### What it does today

`awaitingMeeting` ([CRMContactDrawerV2.tsx:508](/components/crm/contact-drawer/CRMContactDrawerV2.tsx#L508))
is true only while the meeting is still ahead, so the step flips to "your move"
on the clock alone:

| The owner marks | The quote step |
|---|---|
| nothing, and the time passes | **Opens.** "Your move — send a quote" |
| *completed* | **Opens.** Your move |
| *no-show* | **Closes.** `failed`, `waitingOn: 'closed'`, Send-a-quote disappears |
| *cancelled* | **Closes**, and any live quote is withdrawn server-side |

Two problems, and the second is a contradiction inside one file:

1. **It opens on time passing.** A site visit nobody attended produces a step
   that says the owner owes a price for work that was never scoped. The gate was
   deliberately put on the clock rather than on the completion flag because
   owners quote from the van and rarely mark a meeting done first — a real
   concern, and the reason the fix below keeps the quote reachable.
2. **A no-show closes the job.** `isCancelled` at
   [:375](/components/crm/contact-drawer/CRMContactDrawerV2.tsx#L375) folds
   `no_show` in with `cancelled`, so `jobClosed` is true for a no-show — while
   the comment forty lines below says the opposite in as many words: *"'Completed'
   and 'no-show' describe the MEETING and leave the journey running… Cancelling
   means the business is not doing this work."* The comment is the stated intent;
   the code does the other thing. A client who missed a site visit often still
   wants a price, and today the owner loses the route to send one.

### The fix: a third state, which asks

The step has two states and needs three. Once the time has passed and nothing is
marked, its question is not "send a quote" — it is **"did this meeting happen?"**

| Booking state | The step says | Primary action |
|---|---|---|
| Time still ahead | "The quote goes out after the meeting — 4 Oct, 09:30" (today's copy) | none; waiting on the meeting |
| **Time passed, unmarked** | **"Did the meeting happen?"** | the three existing marks, with *send a quote* secondary |
| Marked **completed** | "Send a quote" | Send a quote |
| Marked **no-show** | "The meeting did not happen" | **Rebook the consultation**, with *send a quote anyway* secondary |
| Marked **cancelled**, or quote stopped | closed | none |

It never claims a meeting took place, and it still does not hold the button shut
for the van case: *send a quote* is one tap away in the ask state. The marks
already exist in the drawer — this reuses them rather than adding controls.

Where it lands: `awaitingMeeting` becomes three cases rather than a boolean;
`no_show` comes out of `isCancelled` **for this step only** (that variable is also
read by the payment and intake steps, where it means "the job is off" rather than
"nobody turned up"); and the strip gains copy for two new states in en / es / he.

### The card behind it

> *"2 meetings have passed and are not marked."*

On the Needs You card, from the gap registry. It is what stops an unmarked
meeting sitting silently for a week — and it is **the same card scenario 2
needs**, where an unmarked session is not untidiness but an invoice that never
went out. One card, two features.

---

## What already exists

Verified against the tree on 2026-10-01.

| Piece | Where | State |
|---|---|---|
| Owner composes a quote with a total and named stages | [ProposalBuilderModal.tsx](/components/crm/contact-drawer/ProposalBuilderModal.tsx) | ✅ Built |
| Three money shapes: `single` \| `installments` \| `milestones`, with stages and percentages | `ProposalBuilderModal.tsx:43`, `:91-95` | ✅ Built |
| **Up-front payment** — `single` + terms *Due on receipt* | `lib/payments/paymentTerms.ts`, wired by the builder | ✅ Built. The dialog already offers it |
| One invoice for the whole total on acceptance | `ProposalAcceptanceService.ts` | ✅ Built |
| Client sent straight to the invoice's Pay button on accept | `app/api/proposal/[token]/route.ts` | ✅ Built |
| **One way an invoice becomes paid** — a deliberate single chokepoint | `settleInvoicePaid` in [invoiceSettlement.ts](/lib/payments/invoiceSettlement.ts) | ✅ Built. Scenario 1's wire hangs here |
| **A pending booking holds its slot** | `SLOT_HOLDING_STATUSES = ['confirmed','pending','completed']`, `lib/scheduling/bookingStatus.ts`; used by `checkOverlap` | ✅ Built |
| **Reminders skip non-confirmed bookings** | `LeadResponseDispatchService.ts` | ✅ Built — a pending session gets no reminder, with no work from us |
| Marking a booking complete | `schedulingBookingRepository.complete` | ✅ Built |
| **Milestone stages that wait for the owner** — `trigger: 'manual'`, no due date | `ProposalAcceptanceService.ts:147-148` | ✅ Built |
| **An existing "mark done and bill" action** for one stage | `POST /api/business-os/payment-stages/[id]/complete`; gap action `bill_stage` in [definitions.ts:811](/lib/business-os/gaps/definitions.ts#L811) | ✅ Built. Scenario 2's wire hangs here |
| Per-booking manage link, cancel, reschedule, no-show | `generateBookingToken`, `/book/manage/[token]` | ✅ Built |
| Stop a quote and its money, with a reason | `cancelQuoteStages.ts`, `cancellationReasons.ts` | ✅ Built |
| An invoice carrying a **payment link** when Stripe is connected | `InvoiceDeliveryService.ts` (gated on `charges_enabled && onboarding_completed`) | ✅ Built. Relevant to scenario 2's per-session invoice |

**So a package paid up front is already sellable.** The owner simply cannot get
six meetings out of it.

### One correction to carry

There is **no client acceptance email** in our flow: the client is redirected to
the invoice, and the email is sent only when there is nothing to redirect to. So
the "here are your six dates" email belongs at **payment** (scenario 1) or at
**approval** (scenario 2, where there is no payment to wait for) — never at
acceptance in general.

---

## What we add

### `proposals` — one column

```sql
sessions JSONB NULL
-- { "dates": ["2026-10-07T10:00:00Z", …], "duration_minutes": 60 }
-- NULL means "not a package". Every existing proposal stays valid.
```

Dates are **explicit**, never a cadence rule. See
[Decisions already made](#decisions-already-made).

### `scheduling_bookings` — two columns

```sql
parent_booking_id UUID NULL REFERENCES scheduling_bookings(id) ON DELETE CASCADE
occurrence_number INT  NULL
```

- **The container** is the purchase: one booking with **no time at all**, like a
  product sale. `parent_booking_id NULL`, `occurrence_number NULL`.
- **The children** are the meetings: `parent_booking_id = container.id`,
  `occurrence_number` 1..N, each an ordinary booking with its own hour, reminder,
  manage link, cancel and reschedule.

**No new table.** The proposal is the agreement, the payment plan is the money,
and one booking is the container for others. A fourth owner of "what was agreed"
would make every query pick one.

### Two assumptions the plan carried that turned out to be stale

Found while implementing Stage 2, and together they delete most of the work the
plan had allocated to it:

1. **"The parent must have a time range, so it must be excluded from four time
   paths."** It had to, when the plan was written: `start_time` and `end_time`
   were `NOT NULL`. [20260803_allow_null_booking_times](/supabase/migrations/20260803_allow_null_booking_times.sql)
   dropped both, for courses and products. So the container simply has **no
   time** — and every diary path already skips a booking without one, including
   the overlap constraint, whose null-times clause was tested against live data.
   **No exclusions are needed in availability, `checkOverlap`, calendar sync, or
   the constraint.**

2. **"Money must move onto the parent."** It does not have to move at all.
   `proposals.booking_id` and every `payment_plan_installments.booking_id`
   already point where they point — at the consultation the quote came out of,
   or at nothing for a quote sent cold — and `applyAcceptance` already raises the
   invoice and the stages against them. **A package changes how many MEETINGS a
   purchase owns; it does not change where its money lives.**

Which also answers the question Stage 1 left open — *nothing distinguishes a
package parent from an ordinary single booking* — by making it moot. Nothing
needs to: `purchases → parent_booking_id IS NULL` is correct for every reader,
because containers and ordinary bookings both have it null and only a package's
meetings have it set. **`occurrence_number = 0` as a parent marker is therefore
not needed, and the approved decision #4 is withdrawn** — it was answering a
problem that only existed while the container had to occupy time.

### The quote dialog — one tick and a list

| Control | Behaviour |
|---|---|
| **Package** (off by default) | Off, and the dialog is exactly what it sends today |
| **Sessions** | How many, and one date picker each |
| **Service** | Which service each meeting is (length, diary name) |
| **Charge** | *All up front* → `payment_shape: single`, terms *Due on receipt*. *After each session* → `payment_shape: milestones`, one stage per session, every stage `trigger: 'manual'` |

---

## The rule

> **Money lives on the parent. Time lives on the children.**

| | Container | Children |
|---|---|---|
| `start_time` / `end_time` | **NULL** — it is a purchase, not an hour, so every diary path skips it with no filter of its own | the actual meeting |
| Invoices, plans, stages, transactions | wherever they already point (`proposals.booking_id`, or nothing for a cold quote) — **unchanged by this feature** | none |
| Reminders, manage link, cancel, reschedule, no-show | — | per meeting, as today |
| Calendar event | — | per meeting |

Structural, not procedural: you can look at a row and know which it is. Nulling
the child's money is **not sufficient on its own** — every reader that sums money
or counts meetings has to be classified. That audit is Stage 1.

---

## The lifecycle, and the wires

| Moment | Scenario 1 | Scenario 2 |
|---|---|---|
| **Quote sent** | nothing in the diary | nothing in the diary |
| **Client approves** | package + children created `pending`; one invoice for the total | package + children created **`confirmed`**; one stage per session, all waiting |
| **Invoice paid** | children → `confirmed`, calendar events, one email with every date | — (no invoice yet) |
| **Session marked complete** | child → `completed`, nothing else | child → `completed` **and that stage is billed** |
| **Client stops paying** | owner cancels the package, slots free | nothing further bills; owner releases remaining slots |

**Two wires, one each:**

1. **`applyAcceptance`** — when `proposal.sessions` is present, create the parent
   and the children instead of one booking.
2. **`settleInvoicePaid`** (scenario 1) — when the invoice belongs to a package
   parent, confirm the children, create the calendar events, send the one email.
3. **Booking completion** (scenario 2) — when a child of a package is marked
   complete, bill its stage through the existing payment-stage complete path.

---

## Scenario 2 in detail

### What changes about marking a session complete

Today, marking a booking complete is admin with no consequence. In scenario 2 it
**is the invoice**. Three things follow:

- **A forgotten tick is lost money.** This needs a Needs-You card: *"3 sessions
  happened last week and are not marked."* Without it the failure is silent and
  the owner finds out at the end of the month.
- **The first session must not bill on acceptance.** Stage 0 of a milestone plan
  is currently `trigger: 'date'` — the deposit. For per-session billing, **every**
  stage must be `manual`. That is a deliberate branch in `applyAcceptance`, not a
  change to how milestones behave for ordinary quotes.
- **No-show becomes a money question.** The platform currently leaves no-show
  money alone on purpose (a paid no-show keeps its money; the decision belongs to
  the owner). Under per-session billing there is no money yet, so "no-show" has
  to mean either *bill it* or *do not*. **Decided:** the owner answers at the
  moment they mark it, and the answer is recorded with the mark.

### What the "You get paid" sentence has to say

The service editor's money sentence is resolved by
[serviceMoneyLine.ts](/lib/business-os/serviceMoneyLine.ts). A package is not a
service, so this is the quote dialog's equivalent: *"One invoice of ₪400 after
each session you mark complete, six in all, each with a payment link in it."*
The same honesty rule applies — with no processor connected there is no payment
link, and the sentence must not promise one.

---

## Decisions already made

Recorded so they are not relitigated. The first six are carried from the earlier
plan (`~/.claude/plans/happy-splashing-crab.md`, 2026-09-29); the last two were
settled in conversation on 2026-10-01.

| Decision | Why |
|---|---|
| **Proposal rail, not scheduling services** | The money is already built there. The service rail is where the twelve-invoice, twelve-invoice-number and `payment_transactions`-collision fan-out lived |
| **Owner picks the dates, explicitly** | A cadence rule costs clash detection, nearest-free-slot search, time-off reading, DST-correct stepping, and a preview-and-adjust screen. Six date pickers cost six date pickers — and it deletes DST drift, a silent "client arrives an hour wrong" failure |
| **Parent/child, not a `booking_series` table** | Three owners of the fact already exist; a fourth makes every query pick one |
| **No service changes** | The service says what one meeting is. The quote says how many, when, for how much, and when the money moves |
| **Created at acceptance as `pending`** (scenario 1) | Holds the slots without claiming payment. Existing machinery, built for this case |
| **No auto-expiry of an unpaid package** | Six slots stay held until the owner cancels, matching one unpaid booking. If it becomes a problem the fix is a Needs-You card, not a cron |
| **Both scenarios ship, scenario 1 first** | Identical structure; the only difference is when money moves. Scenario 1 is the smaller half of an already-built rail, and its meetings machinery is exactly what scenario 2 needs |
| **Scenario 2 confirms meetings at approval, not at payment** | There is no payment to wait for. Leaving them pending would suppress their reminders |

---

## How scenario 2 collects — decided 2026-10-01

### The service decides, not the package

The question "card or invoice per session?" was never the package's to ask:
`scheduling_services.collection` already answers it, and that is the field the
whole service editor is now built around. A package inherits it.

| The service collects | Each completed session |
|---|---|
| `online` (card) | A Stripe invoice set to **`charge_automatically`** against the card saved when the quote was approved. The client does nothing; Stripe charges it |
| `invoice` | The invoice as it goes out today: a payment link in the email, chased for you on days 1, 3 and 7 |

**Both routes are the invoice rail**, which is what makes this small. The only
difference is `collection_method`, and
[StripeInvoiceService.ts:151](/lib/stripe/StripeInvoiceService.ts#L151) hardcodes
`send_invoice` today — one parameter.

### Why not charge the card ourselves

Because the platform deliberately does not hold cards. The existing
deferred-first-payment plan is built as a **trialling subscription**: Stripe
takes a SetupIntent, keeps the card and charges it when the trial ends, and the
guard test for it says why in one line — *"Collection stays with Stripe, so no
new scheduler holds a card."*

Per-session billing is event-driven (the owner marks a session complete), which
Stripe cannot schedule — so the choice was between the platform initiating
off-session charges itself, or raising an invoice per session and letting Stripe
collect it. The second keeps that principle intact and reuses a rail that
already handles refunds, disputes, chasing and the ledger.

**The one new piece:** a card-collected package must save a card when the quote
is approved, via the same SetupIntent mechanism. Until it does, Stripe has
nothing to charge automatically. Scenario 1 needs none of this — the client pays
one invoice up front.

### The no-show is the owner's call, each time

Not a per-service setting: **the owner decides when they mark it.** Marking a
package session no-show asks whether to bill that session, and the answer is
recorded with the mark — so the figure is auditable and the no-show rate still
counts it as a no-show either way.

The platform's existing position made this the obvious shape: no-show money has
always been the owner's decision rather than the platform's.

### No monthly roll-up in v1

It followed from the first decision. For a card-collected package there is no
paperwork to roll up — nothing is sent and nothing is chased. For an invoiced
one it is one invoice per session, which is what "sourced from the service"
means. Revisit only if a business with weekly sessions says the volume hurts.

### Still open

**Is scenario 2 in the first release?** Stages 2 and 3 are needed either way and
are shippable alone. Scenario 2 is Stage 4.

---

## Time off (Stage 0c)

**Corrected 2026-10-01.** An earlier note said owner-picked dates made this
unnecessary. That was wrong, and for a reason worth stating: picking the dates by
hand stops the platform from *generating* a date on a closed day, but it does
nothing to stop an owner from *choosing* one — "every Tuesday for six weeks"
runs straight through a holiday. And the same gap is already live for single
bookings.

### What exists, and what reads it

`scheduling_availability_exceptions` has been in the schema since 20260722, with
full RLS and both shapes a business needs:

```sql
exception_type TEXT NOT NULL,   -- 'unavailable' | 'custom_hours'
start_date DATE NOT NULL,
end_date   DATE NOT NULL,
custom_hours JSONB,             -- { "start": "10:00", "end": "14:00" }
reason TEXT
```

**Nothing reads it and nothing writes it.** Verified: its only other appearances
in the tree are `businessOwnedTables.ts` and the purge descriptors — the
registries that would delete it. Availability is computed from
`business_profiles.scheduling_availability` (the weekly hours) and the bookings,
and from nothing else.

So today, with no package feature at all: **a client can book a business on a
day it is closed.** The owner's only defence is to notice and cancel.

### Three pieces, in this order

| | What | State |
|---|---|---|
| **1 · Read it** | [`windowsForDate`](/lib/scheduling/availabilityWindows.ts) is now the one answer to "what are this date's hours", and the public booking page, the smart-link page and the chat's open-time question all go through it | ✅ **Done 2026-10-01** |
| **2 · Write it** | [`SchedulingTimeOffRepository`](/lib/repositories/SchedulingTimeOffRepository.ts), `GET`/`POST /api/scheduling/time-off` + `DELETE /…/[id]`, and [`TimeOffEditor`](/components/scheduling/TimeOffEditor.tsx) under the working hours in the settings dialog | ✅ **Done 2026-10-01** |
| **3 · Validate a package's dates against it** | Each picked date checked against the weekly hours, time off, and existing bookings; the ones that clash named before the quote is sent | ⬜ With the date pickers, in Stage 3 |

### The three rules, as implemented

1. **Closed wins.** Any `unavailable` entry covering the date closes it — an
   owner who has recorded both "away" and "short hours" for one date is away.
2. **`custom_hours` REPLACES the weekday's hours** rather than narrowing them.
   "On this date my hours are 09:00–13:00" is what the owner said, and replacing
   handles both cases with one rule: a short day, and **opening a day that is
   normally closed**. Intersecting would have silently refused the second.
3. **An entry whose times cannot be read closes the date.** The owner recorded
   an intention to restrict it, and a restriction we cannot parse must not be
   read as business as usual — losing a day's bookings is recoverable, selling an
   hour the owner is not there for is not. Which is also why the POST refuses a
   short day with no hours, or hours that end before they start: a row that
   slipped through would close a date the owner meant to shorten.

**Where a failure lands:** if the table cannot be read, the list is empty and the
ordinary weekly hours are published — what these endpoints have always done, and
the safer of the two wrongs for a page whose job is to take bookings.

**34 tests**: 13 on the resolver's rules, 13 on the route's refusals, 10 guarding
that each surface still reads it (the bodies need a request, a profile, a service
and a timezone before they say anything, and what went wrong was a missing
argument).

### What it is not

Not an auto-move. The canvas mockup drew a session being relocated to "the
nearest free slot", which is the search the owner-picks-dates decision exists to
avoid. A date that cannot work is said out loud next to itself; the owner moves
it.

---

## The read-path audit (Stage 1)

Counted on 2026-10-01: **137 reads of `scheduling_bookings` across 51 files** —
29 of them through `schedulingBookingRepository.findById`, 14 through `.list`,
8 through `.checkOverlap`, and **16 insight detectors** reading the table
directly. (An earlier note said 19 detectors; the verified number is 16.)

Once one purchase owns N meetings, every one of those readers sees N rows where
there was one sale. The filter is mechanical:

```
purchases → .is('parent_booking_id', null)   AND not a package parent
meetings  → .not('parent_booking_id', 'is', null)
both      → no filter, deliberately, with a comment saying so
```

Deciding **which** each reader wants is not mechanical. That is this table.

### Must be fixed before a client sees a package

| Reader | What it is | If untouched |
|---|---|---|
| `checkOverlap` ([SchedulingRepository](/lib/repositories/SchedulingRepository.ts)) + the new `scheduling_bookings_no_overlap` constraint | MEETINGS | The parent's range spans the engagement, so it collides with its own six children **and** every other booking in those weeks. **The business becomes unbookable.** The constraint makes this a hard failure rather than a silent one, which is the right way round |
| Availability: [website/booking/availability](/app/api/website/booking/availability/route.ts), [conversion/[userCode]/availability](/app/api/conversion/[userCode]/availability/route.ts) — both read `SLOT_HOLDING_STATUSES` | MEETINGS | Same cause: the parent blocks weeks of slots on the public page |
| Calendar sync (`getBookingsNeedingSync`, `CalendarSyncService`) | MEETINGS | A six-week all-day event lands in the owner's Google calendar beside the six real ones |
| [CashBookingUnpaidDetector](/lib/business-os/insight/detectors/catalog/CashBookingUnpaidDetector.ts) | PURCHASES | **Six false "unpaid work" alerts per package.** Verified still live at `:126-131`: `chargeRaised \|\| (paidAtBooking && price > 0)` — the second branch never looks at the booking's own money, so nulling each child's `payment_amount` does **not** silence it on an `online`-collection service |
| Booking counts: [stats](/app/api/business-os/stats/route.ts) (`count: 'exact'` on `start_time >= periodStart`, and a second on `status = 'confirmed'`), [metrics/summary](/app/api/business-os/metrics/summary/route.ts) | PURCHASES for "sales", MEETINGS for "hours" — and today one number serves both | The dashboard reads 7 bookings for 1 sale. `bookedThisWeek` already has a guard test, which is where the corrected intent should be pinned |

### Money: the parent only

Every one of these must read the parent and never a child, which the rule
(*money on the parent, time on the children*) makes structural rather than a
filter each has to remember:

[payments/money](/app/api/payments/money/route.ts) ·
[create-checkout](/app/api/payments/create-checkout/route.ts) ·
[invoices/[id]/mark-paid](/app/api/payments/invoices/[id]/mark-paid/route.ts) ·
[bookings/[id]/refund](/app/api/scheduling/bookings/[id]/refund/route.ts) ·
[stripe/webhook](/app/api/stripe/webhook/route.ts) ·
`syncBookingPaymentState` · `bindPlanSubscription` · `stopBookingPlan` ·
`PaymentReminderService` · `CashWorkUnbilledDetector` ·
`CashCancelledUnrefundedDetector`

### Meetings: the child only

Each child is an ordinary booking, so these need no change beyond never being
handed a parent:

`/api/book/manage/[token]/*` (the client's own cancel, reschedule, intake) ·
`LeadResponseDispatchService` (reminders — already skips non-confirmed) ·
`IntakeReminderService`, `IntakeRepository` · `BookingEmailService` ·
`website/booking/intake`

### Both, deliberately

| Reader | Why both |
|---|---|
| [BookingLifecycleService](/lib/services/BookingLifecycleService.ts) | It owns the verbs. Cancelling a parent must cancel its children; completing a child must not touch the parent |
| The CRM drawer and `BookingsTab` | The owner needs to see the package **and** its six meetings. This is the one surface where collapsing either way is wrong |
| [gaps/definitions](/lib/business-os/gaps/definitions.ts) | Per gap: `meeting_upcoming`, `meeting_unmarked`, `intake_outstanding` are MEETINGS; `invoice_unpaid`, `booking_cancelled`, `booking_refunded`, `stage_awaiting_completion` are PURCHASES |
| `MutateExecutor` (the chat) | Asked "cancel David's booking" it must know whether David has one package or six meetings, and say which it did |

### Skews an insight — a follow-up list, not a silence

These produce a wrong number, never a broken booking or a wrong charge. Fix in
one pass after launch, each with the filter its question implies:

| Detector | Which it wants | What goes wrong untouched |
|---|---|---|
| `RetRepeatBookingLowDetector` | PURCHASES | A package client looks like six loyal repeat visits |
| `OpsUtilizationLowDetector`, `OpsPeakUnutilizedDetector` | MEETINGS | Right by accident today; the parent would add phantom booked weeks |
| `RetNoShowSpikeDetector`, `RetCancellationSpikeDetector`, `OpsLastMinuteCancelsDetector` | MEETINGS | Rates computed against a denominator inflated by parents |
| `ConvServiceRateDropDetector`, `OpsServicePerformanceDetector`, `PricingIntroOfferStuckDetector`, `PricingDiscountAbuseDetector`, `SalesStalledDetector`, `ConvNoNextStepDetector`, `CrmEngagementDecayDetector` | mostly PURCHASES | Conversion and pricing questions are about sales, and a package would count as several |
| `InsightRepository` aggregates (`count: 'exact'` at `:3341`, `:3762`) | PURCHASES | Feeds several of the above |
| `WebsiteBlockEnrichmentService` (`status = 'completed'` count, for social proof) | MEETINGS | "200 sessions delivered" is honest about meetings; it would also be true, so this one is arguably fine either way — decided: MEETINGS |
| `ChannelAttributionRepository` (`contact_id` where `status != 'cancelled'`) | PURCHASES | Attribution counts a conversion, not six |
| `publicBranding` (`select('user_id')`, an existence check) | neither | Unaffected: it asks whether a business has any bookings at all |

### The design question this raised — answered in Stage 2, 2026-10-01

**It asked how anything would tell a package parent from an ordinary single
booking**, since both would have `parent_booking_id IS NULL`: correct for money,
wrong for the diary, where a parent spanning the engagement must be excluded and
a single booking must not be.

**Nothing has to tell them apart, because nothing excludes a container.** The
container has no `start_time`, so every diary path, `checkOverlap`, calendar sync
and the exclusion constraint skip it already — the same way they skip a course or
a product. `occurrence_number = 0`, approved as decision #4, was therefore
**withdrawn before implementation**: it would have been a marker no reader needs,
and one more value for `purchases → parent_booking_id IS NULL` to disagree with.

The original text, kept because the reasoning is still how a container was ruled
on: the overlap constraint
([20261001](/supabase/migrations/20261001_bookings_no_overlap.sql)) already
records the same question in its own comment, because it must be recreated with
the parent excluded and cannot express that until this is settled.

---

## Stages

**Stage 0 — the overlap constraint. ✅ Done 2026-10-01.**
[20261001_bookings_no_overlap.sql](/supabase/migrations/20261001_bookings_no_overlap.sql):
`EXCLUDE USING gist (user_id WITH =, tstzrange(start_time, end_time) WITH &&)`
over `SLOT_HOLDING_STATUSES`, skipping rows with no times (a product's
`tstzrange(NULL, NULL)` is unbounded and would block every appointment the
business ever takes) and any inverted range. `btree_gist` is created for the
`uuid WITH =`; the whole thing is guarded by `pg_constraint` so it is safe to run
twice.

Checked against live data before writing it: 42 slot-holding bookings, **0
overlapping pairs**, 0 inverted ranges, 4 without times — so it applies cleanly.

A `23P01` is now translated into the SAME `BookingSlotUnavailableError` the
pre-check raises, in both `createBooking` and `rescheduleBooking`, via
`isSlotTakenError` in [bookingStatus.ts](/lib/business-os/bookingStatus.ts). The
race is not a fault: two clients pressed Book in the same second and one lost,
and every surface that already handles a clash now handles this too.

**Nothing further was needed.** This paragraph used to say the constraint would
have to be dropped and recreated with a package's parent excluded. The container
has **no time**, so the `start_time IS NOT NULL` clause skips it and its meetings
are ordinary bookings the constraint protects like any other. See
[the two stale premises](#the-model) — the migration's comment has been corrected
in place.

**Stage 0b — the quote gate. ✅ Done 2026-10-01.** The five states live in
[lib/business-os/quoteGate.ts](/lib/business-os/quoteGate.ts) (pure, 14 tests);
the drawer and the strip read them; the badge gained the `unmarked` and missed
states; a no-show now offers *book a new time* rather than closing the job.
Guarded by `components/crm/contact-drawer/__tests__/quoteGateWiring.guard.test.ts`.

**The card, also done 2026-10-01.** `meeting_unmarked` in the gap registry:
`blocksOn: 'owner'`, action `mark_meeting`, which NAVIGATES to the booking in the
drawer rather than posting — the answer is one of three (held, no-show, called
off) and no single button can offer three answers. Two bounds the data argued
for: a **twelve-hour wait** (`staleAfterHours`), so a 10am meeting becomes a row
at 10pm rather than nagging an owner who has just walked out; and a **90-day
floor**, because an owner cannot usefully say whether a client turned up seven
months ago, and a permanent count of legacy rows is a card people stop reading.
Nine tests, three of which read the query at the source — the Supabase mock
cannot see a filter applied in the query, and three of the clauses that matter
are query-level.

Scenario 2 reuses this card for unmarked sessions, where the question is not
untidiness but an invoice that never went out.

**Stage 0c — time off. ✅ Parts 1 and 2 done 2026-10-01.** The table existed and
nothing read it, so a client could book a closed day. It is now read by every
surface that publishes an hour, and the owner can record closed days and short
days in the settings dialog. Part 3 — validating a package's dates — goes with
the date pickers in Stage 3. See [Time off](#time-off-stage-0c).

**Stage 1 — the read-path audit. ✅ Done 2026-10-01.** See
[The read-path audit](#the-read-path-audit-stage-1) below. No code: it is the
document the rest is checked against, and the gate — a reader that cannot be
classified is a design question surfacing early rather than a wrong number
surfacing late.

**Stage 2 — the model and the acceptance wire. ✅ Done 2026-10-01.**
[20261001_package_sessions.sql](/supabase/migrations/20261001_package_sessions.sql)
(applied): `proposals.sessions`, `scheduling_bookings.parent_booking_id`
(`ON DELETE CASCADE`), `occurrence_number`, and the two partial indexes.
`proposals.sessions` is typed as `PackageSessions` rather than loose JSON, so the
quote dialog in Stage 3 and the reader here share one shape — and it is still
**validated** on read, because the column is JSONB and a bad date would create a
meeting at the epoch for the owner to find.

`applyAcceptance` creates the package when `sessions` is present: a container
with no times, then N meetings carrying `parent_booking_id` and
`occurrence_number` 1..N, `pending` for scenario 1 and `confirmed` for scenario 2
— read off `payment_shape` rather than stored twice. Written through
`schedulingBookingRepository.create`, NOT `createBooking`: the lifecycle verb
raises an invoice, syncs a calendar event and emails the client, which for six
meetings would be six of each. The one email belongs at payment (Stage 3).

Three things the implementation had to decide that the plan had not:

- **The clock.** Acceptance runs on the client's click, so there is no owner
  browser to infer a zone from, and the repository's `'UTC'` default would have
  printed an hour nobody chose in the confirmation email — the bug the owner-side
  booking route documents at length. `userPreferencesRepository.findTimezone`
  was added for it (eight routes read that column inline; this is the first
  caller that cannot).
- **A date taken in the meantime.** Between a quote being sent and accepted
  somebody can take one of its slots, and the constraint now refuses that write.
  Refusing the whole acceptance would leave a client who has agreed — and
  possibly paid — with nothing. So each meeting is written independently, a
  `23P01` is skipped, and the dates lost come back as `package.clashed` for the
  owner to re-offer.
- **A package with no service.** Refused, creating nothing:
  `scheduling_bookings.service_id` is NOT NULL and the service names each meeting
  in the diary. The money stays visible and unmet, which is the same answer the
  failed-plan path gives.

18 tests in
[lib/services/__tests__/packageAcceptance.test.ts](/lib/services/__tests__/packageAcceptance.test.ts).

**Still open for Stage 3:** telling the owner about a clashed date on screen —
today it is reported on the result and logged, and nothing surfaces it.

**Stage 3 — scenario 1 end to end. ✅ Done 2026-10-02.**

| Piece | Where |
|---|---|
| `proposals.package_booking_id` — the link a paid invoice follows to the meetings | [20261002_proposal_package_booking.sql](/supabase/migrations/20261002_proposal_package_booking.sql) (**needs applying**), written by `recordAcceptance` |
| The Package switch, the per-meeting length, the date pickers, the warnings | [ProposalBuilderModal.tsx](/components/crm/contact-drawer/ProposalBuilderModal.tsx) |
| `sessions` accepted and validated on the way in | [app/api/business-os/proposals/route.ts](/app/api/business-os/proposals/route.ts) |
| The dates on the page the client presses accept on | [app/proposal/[token]/page.tsx](/app/proposal/[token]/page.tsx) |
| Payment confirms the meetings, sends ONE email, creates the calendar events | [confirmPackageOnPayment.ts](/lib/payments/confirmPackageOnPayment.ts) |
| A date list and a multi-event invite in the confirmation | [booking-confirmation.ts](/lib/email/templates/booking-confirmation.ts) |
| A clashed date on the contact's timeline | [app/api/proposal/[token]/route.ts](/app/api/proposal/[token]/route.ts) |
| A way to test it before the dialog existed | `npm run package:smoke` |

**Corrected 2026-10-02, after the first version was used:** the owner was asked
to type every date, which for a twelve-session block is twelve pickers. They now
describe the PATTERN — first meeting, weekly / fortnightly / monthly, how many —
and [recurrence.ts](/lib/scheduling/recurrence.ts) expands it. The storage is
unchanged and still explicit dates: the rule is an INPUT METHOD, never a record,
because the dates are what the client agreed to and what every reader needs.

Two things that rule had to get right, both of which have bitten this codebase
before: a month is not 30 days (the 31st repeats on the 28th, measured from the
ORIGINAL day so a short month does not drag the series earlier), and an hour is
not a fixed offset — it steps date KEYS and applies the owner's hour once, so
"weekly at 10:00" is still 10:00 after the clocks change. 16 tests.

Every generated date stays editable and removable, and an edit survives a change
to the count: moving the one week that is a holiday is the actual job. The layout
was rebuilt at the same time — labels above controls, the list as a grid with each
warning under its own date — because the side-by-side rows wrapped in Hebrew into
a stack of orphaned fragments. 9 render tests.

Decisions the implementation had to make:

- **The dates are warned about, not refused** — and as of 2026-10-02 the
  warning covers all three ways a date cannot be kept, after an owner put the
  first meeting on a blocked slot and nothing said so:

  | | What it says |
  |---|---|
  | a day the owner closed | `Closed · <their reason>` |
  | outside the service's hours | the hours that ARE open, resolved through `windowsForDate` — the same function the public booking page uses, so a client could never have been offered that hour either |
  | the hour is already sold | that the meeting **would not be created**, which is the truth: acceptance skips a date it cannot take |

  Only an EMPTY or already-past date blocks sending. The rest are warnings: the
  owner may well be opening for this client, or moving the other booking.

  The clash check was originally deferred as "a query per date". It is one
  query for the whole window (`/api/scheduling/bookings` with the series' range,
  filtered to the slot-holding statuses), re-read when the series moves — and
  worth it, because a quote is not the owner's own booking dialog: there a clash
  is refused at the write with a good error, while here the date goes to a
  client who approves it and then quietly does not get that meeting.
- **One email, from the first meeting.** `sendBookingConfirmation` takes the
  whole block rather than a new sender being written: the branding, the locale,
  the invoice attachment and the manage links are all wanted unchanged, and only
  the dates differ. The invite carries **one VEVENT per meeting**, each with its
  own stable UID — a shared UID makes every event an update to the same
  appointment and the client ends up with one meeting.
- **The manage links are the first meeting's**, which is correct: rescheduling
  from that email moves session one, and every later session carries its own
  links on its own reminder.
- **The clash goes on the timeline**, not only into the log. It is where the
  owner is already looking when they open the client, and it names the dates to
  re-offer.

**Known gap:** acceptance itself does not check time off — the dialog warns, and
an owner who sends anyway gets the meeting booked on the closed day. That is the
same answer the owner's booking dialog gives (warn, then allow), so it is
consistent rather than missing; the difference is that nobody re-warns at
acceptance.

**Stage 4 — scenario 2, paid per completed session. ✅ Core done 2026-10-02.**

The screen was the thing that forced this forward: with meetings on, the money
question still asked `תשלום אחד / לפי שלבים / בתשלומים`, which is the right
question for a JOB — one payment, phases of work, periods of time. A block of
ten meetings has none of those. An owner choosing `לפי שלבים` got a two-stage
plan and ten confirmed appointments with nothing relating them.

So with a package on, the question becomes the package's own, with two answers:

| | מראש | אחרי כל פגישה |
|---|---|---|
| On approval | one invoice for the whole block | **nothing** |
| The meetings | `pending` until it is paid | `confirmed` |
| Then | paid → all confirmed, one email with every date | each meeting marked held raises its own invoice |
| A no-show | — | bills nothing unless the owner says so |

Each answer states its consequence under the pills, and the per-session figure
is **derived** from the block price and the session count, never typed, so the
two cannot disagree. The stages editor and the instalment fields are not
rendered for a package; a quote with no meetings keeps all three answers exactly
as before.

**Nothing new was invented underneath.** `אחרי כל פגישה` is a `milestones` plan
whose stages are the meetings — so the email, the client's page, the Money page
and the drawer all keep working — with one flag on the package,
`sessions.bill_per_session`, carrying the only fact that distinguishes it from
two sessions sold deposit-and-balance (identical as payment shapes). Acceptance
then makes **every** stage `manual`, including the first (the one difference from
an ordinary milestone plan, where stage 1 is the deposit), raises no invoice, and
binds stage *i* to meeting *i* through `payment_plan_installments.booking_id` —
a column that already existed and already meant "the job this stage belongs to".

[billSessionOnCompletion.ts](/lib/payments/billSessionOnCompletion.ts) is the
trigger, called from the owner's Complete route **and** from the chat's
`bookings.complete`, so a session marked held from either side is billed. It
goes through the same `billStage` as the drawer's stages button, with
`expectTrigger: 'manual'` so it can never bill a dated stage the cron owns, and
`already_done` is treated as the normal second press rather than a fault.

Mockup the design was agreed from:
https://claude.ai/code/artifact/7cbb0dd2-e58b-4514-b17a-e2ea3f0ddb40

**The client's page, fixed 2026-10-02 after a real quote was sent through it:**

- **`proposal.sessions_title` rendered as its own name.** The public pages have
  their own dictionary (`createPublicT`), and the key had been added to the
  app's `LanguageContext`. A missing public key does not fall back and does not
  fail — it prints the key, to the client. Now guarded by
  [publicCopyExists.guard.test.ts](/lib/i18n/__tests__/publicCopyExists.guard.test.ts),
  which reads every `t('literal')` on the five public pages and checks all three
  languages hold it.
- **The accept button said "Accept — ₪83.33 due now"** on a quote whose own
  terms say nothing is due until the first session is held. `dueOnAccept` is
  now 0 for a per-session package, and the page says what happens instead:
  nothing to pay now, each meeting invoiced after it takes place.
- **The dates were listed twice** — once as stage labels with amounts, once as
  dates, in two different orders. One list now: the meetings, each carrying its
  own share.
- **The times were wrong for everyone.** The page formatted on the reader's
  clock, which for a page that server-renders its first paint is the SERVER's:
  an Israeli business's 16:30 sessions were listed as 09:30, all six, because
  the host runs in New York. The business's zone is now resolved server-side,
  sent with the sessions, and named under the list.

**A package is due on receipt by default, both ways** (2026-10-02). The terms
are a DEADLINE, not a wait: marking a session held raises its invoice and emails
it immediately, and the terms say how long the client then has. But the business
default on the account this was found on is **45 days**, which turned "after each
meeting" into "six weeks after each meeting" — and on `מראש` it would leave the
hours held and the meetings unconfirmed for the same six weeks. Both package
answers now open on `לתשלום מיידי`, and nothing moves the terms again once the
owner has answered them.

**Revising a declined package kept it a package** (2026-10-02). A revision
inherits `payment_shape`, and a per-session package IS a milestone plan
underneath — so the second quote opened as a six-STAGE job whose phases were
called "Meeting 1"…"Meeting 6", with the Package switch off and the six dates
gone. The owner was re-quoting a block of sessions as something else entirely.

`sessions` now travels on the drawer's proposal type and the dialog's `basedOn`,
and the revision reopens as a package: the same dates (converted back onto the
business's clock), the same per-session answer, the same length — and the stage
rows are cleared rather than left behind the switch. Two further details the
fix needed: the service's duration is a default for a NEW package and must not
overwrite a length that was agreed, and a revision's terms count as **answered**
so the package default cannot pull a client's negotiated 15 days back to
due-on-receipt. Six tests, including one that a revision of an ordinary staged
job still opens on its stages.

**The quote EMAIL carried the same three faults as the page** (2026-10-02), and
had to be fixed separately because it is a different template with a different
dictionary:

- it listed "Meeting 1 … ₪83.33" six times with **no dates at all**, so a client
  could see what each session cost and not when any of them was — the part they
  have to check against their own diary before they can answer;
- it said **₪83.33 due on approval** beside terms promising nothing was due
  until a session had been held;
- it would have rendered the hours on the SERVER's clock had it shown them.

The email now lists the meetings with their dates on the business's clock, names
the zone, puts each amount on its own meeting, drops the duplicate stage list,
and says nothing is due now. Eight tests that render the real template, pinning
the wall clock across the DST change and leaving an ordinary staged quote's
stage list untouched.

**Still open in Stage 4:**
- the Needs-You card for a session whose time has passed and is unmarked — the
  `meeting_unmarked` gap from Stage 0b already covers it, but its copy talks
  about tidiness rather than an invoice that never went out;
- a card saved at approval so each session charges automatically (a SetupIntent)
  — the invoice route shipped first on purpose: it needs no Stripe at all and
  reuses the chasing that already exists;
- selling a block **in instalments** ("ten sessions, three monthly payments"),
  which this screen no longer offers. It would come back as a third package
  answer rather than the generic `בתשלומים`.

**Stage 5 — the readers.** Everything Stage 1 classified: the diary, the
dashboard counts, the CRM drawer, revenue, the briefing.

**Started 2026-10-02, from a live package.** An accepted six-session package was
checked against the database and was exactly right — container with no times, six
confirmed meetings at the right instants across a DST change, six `manual`
stages each bound to its own meeting, no invoice at approval. The DRAWER was
what was wrong: it drew **six client journeys**, one per meeting, each with a
quote step saying "the quote will be sent after the meeting" — about meetings
that quote had already created, sold and billed.

The cause is that `sale_mode: 'proposal'` is a fact about the SERVICE, and a
package is sold through exactly such a service, so every session answered yes to
"is this quoted?". The question belongs to the BOOKING: what a quote produced is
not something a quote is still owed for. `isQuotedJob(booking)` now asks it in
one place — `sale_mode === 'proposal' && !parent_booking_id` — and every site
that attached a quote, a quote history or quoted money goes through it. The
drawer builds its cards in TWO paths (first load and refetch) and the first
version of the fix corrected only one, which is what the guard
[packageSessionIsNotAJob.guard.test.ts](/components/crm/contact-drawer/__tests__/packageSessionIsNotAJob.guard.test.ts)
now prevents: it fails if a bare `service?.sale_mode === 'proposal'` reappears
anywhere but inside the predicate.

**One agreement is one journey — and the journey is the QUOTE's** (corrected
2026-10-02 after the owner saw it). Grouping the meetings under their container
left TWO cards: the consultation where the quote was agreed, and the container —
which carries no quote of its own, so it drew a second journey asking for one.
*"Waiting for a quote"*, on the thing a quote had just created.

The rule, in the owner's words: **every booking with a parent belongs to the same
proposal, as another step in the client journey.** So the meetings travel one
step further than the container — to the booking the quote came out of — and
arrive as a `package` STEP in that journey, inserted straight after the quote,
with the list rendered under it. Two fallbacks: a quote sold COLD has no booking
to attach to, so its container stays as the card; and a meeting whose container
is missing mid-refetch stays where it is rather than vanishing.

The earlier grouping, kept because the per-meeting behaviour is unchanged.

**What that move quietly broke, and how it was caught.** `sessions` is the CARD
list, and once the meetings became a step inside their quote's journey they left
it — so every lookup by booking id found nothing. Reschedule on a meeting row
did nothing at all (the owner's report), the cancel dialog could not tell whether
the thing being cancelled had an hour, and the drawer's count of upcoming
appointments silently dropped by six. One flat view (`everyBooking` /
`findSession`) now backs all three, guarded by four assertions — none of this
fails loudly on its own. The six meetings are no longer six
cards: `foldPackageMeetings` attaches each child to its container and the card
renders them as a list inside the purchase — numbered, dated, with their own
status chip and their own actions (held / no-show / cancel / reschedule),
because each is a real appointment that can be held, missed, moved or called off
alone, and for a per-session package marking one held is what invoices it. A
meeting whose container is missing from the list — which happens mid-refetch —
stays where it is rather than vanishing.

`BookingsTab` asked the quoted question a second time, for the status badge and
the action wording, and the drawer's fix had not reached it. The guard now reads
both files.

**A seventh meeting on a block of six** (2026-10-02). A package is agreed and
under way and then another date is needed: the client missed one, the course ran
long. `POST /api/scheduling/bookings/[id]/meetings` adds one to the purchase,
inline from the card beside the dates it joins.

It goes through `createBooking` — so it gets the overlap check, the closed-day
question, the calendar event and the client's confirmation — with
`createInvoice: false`, because a package's money is the purchase's. It is
numbered after the LAST meeting rather than by counting: a package whose third
was deleted still has a sixth, and reusing that number would put two meetings in
the same place in the series. It follows the purchase into `pending` while the
block is still unpaid.

**The money is the owner's answer, and only asked where it means anything:**

| | `charge: false` | `charge: true` |
|---|---|---|
| billed after each meeting | nothing is billed, ever — a make-up or goodwill | a stage of its own, at the rate the client has been paying, waiting on the owner like the others; the plan's total and count grow with it so the two cannot disagree |
| paid up front | the only option | **refused**: the client paid one agreed sum, and billing more is selling them something else, which is a quote |

The accepted proposal is never touched — `accepted_snapshot` is what settles a
dispute. 16 route tests.

**Refunds and the client's notifications, checked 2026-10-02.**

| | State |
|---|---|
| each session's invoice reaches the client | ✅ `billSessionOnCompletion` → `billStage` → `sendInvoice`: marking a session held raises its invoice AND emails it |
| each payment's receipt | ✅ `settleInvoicePaid` sends it, whichever path the money arrived by |
| the one email listing every date, on an up-front package | ✅ `confirmPackageOnPayment` |
| refunding a per-session payment | ✅ each session's invoice carries `booking_id` = that meeting, so every refund path finds it |
| refunding an up-front package | **fixed**: the acceptance invoice now bills the CONTAINER rather than the consultation the quote came out of. Everything that handles money afterwards works by `booking_id` — `findSettledForBooking`, the webhook's payment-status sync, the drawer's grouping — so a package sold cold could be paid for and then refundable from nowhere the owner looks |
| cancelling a package | **fixed**: it left six confirmed meetings and six live stages standing. Nothing cascades on a status change, and a per-session package's stages hang off the MEETINGS rather than the purchase, so neither half of the money was reached |

The cancellation cascade cancels each meeting **as a booking in its own right**,
which is what voids its invoice, closes its stage, clears its calendar event and
tells the client about its own date — and it runs BEFORE the purchase, so a
failure leaves the purchase open rather than cancelled with live appointments
under it. Already-held and already-cancelled meetings are left alone: rewriting
either erases what happened. It is one level deep **by construction**
(`cascadeToMeetings: false` on the recursion), because the first version
answered the same child list for every id and recursed until the process died.

**ONE email, stating the exact position** (2026-10-02). It began as one
cancellation per meeting — accurate but six times the alarm for one piece of
news — and the version that replaced it had a worse problem, raised by the
owner: *a block cancelled after two meetings is not six cancellations.*

So the email now states both halves and the money behind them:

- **what took place**, listed and not struck through, because those sessions
  were delivered and paid for;
- **what is cancelled**, listed and struck through;
- **the money across the WHOLE package**. The figures were read from the
  purchase alone, and on a package billed per session the money sits on each
  MEETING's invoice — so a client who had paid for two sessions would have been
  told nothing was ever collected. They are now summed over the purchase and
  every meeting, which drives the email's existing four states (never paid,
  refunded in full, partly refunded, still held).

That is the version a dispute would be argued from, which is why it is stated
rather than implied. A failure to read one meeting's money is logged loudly and
does not stop the email: a cancellation that arrives with a figure short is
recoverable, one that never arrives is not.

**The client can cancel or move ONE meeting, under the same policy** (2026-10-02).

The gap: the package confirmation carried manage links for the FIRST meeting and
nothing else, and every later meeting's link arrived with its own reminder 24
hours ahead — which for a service whose notice window is 24 hours is exactly
when the policy stops allowing a change. A client wanting to cancel session five
a month in advance could not, and the one time they were handed a link was the
time it was refused.

Now one link opens the whole block. `/api/book/manage/[token]` returns the
package's meetings, each with its own signed token, and the page lists them with
Cancel and Reschedule per row. **No new rule and no new route**: the actions go
to the existing cancel and reschedule endpoints, which verify the token and
enforce the notice window exactly as they do for a single booking. Inside the
window the row says so instead of offering an action that will be refused.

Two things fixed on the way:

- the manage page judged the window against a **hardcoded 24 hours** while the
  cancel route used the service's `min_notice_hours`, so a business asking for
  48 told the client they could still cancel and then refused them. Both read
  the service now.
- the owner's decision, recorded: a client may cancel a session they have
  already paid for, **exactly like any other booking**. Money never moves on its
  own, so it surfaces as money held for the owner to refund, re-book or leave.

8 tests on the route, including the per-meeting window, a held meeting offering
nothing, and an ordinary booking returning no block at all.

Still to do in Stage 5: every count of PURCHASES still includes the meetings
(the dashboard, the briefing, revenue), which is what the Stage 1 audit
catalogued.

---

## Files

| File | Change |
|---|---|
`supabase/migrations/` | Three columns; the gist constraint (Stage 0)
[ProposalBuilderModal.tsx](/components/crm/contact-drawer/ProposalBuilderModal.tsx) | The Package tick, the session count, the date pickers, the charge choice
`lib/services/ProposalAcceptanceService.ts` | `applyAcceptance` creates the package and children; all-manual stages for scenario 2
[lib/payments/invoiceSettlement.ts](/lib/payments/invoiceSettlement.ts) | On paid, confirm a package's children (scenario 1)
`lib/services/BookingLifecycleService.ts` | Completion of a package child bills its stage (scenario 2); cancelling a parent cancels its children
[CRMContactDrawerV2.tsx](/components/crm/contact-drawer/CRMContactDrawerV2.tsx) | Stage 0b: the three-state quote gate; `no_show` out of `isCancelled` for that step
`lib/business-os/gaps/definitions.ts` | The unmarked-meeting card (Stage 0b), which scenario 2 reuses for unmarked sessions
`lib/repositories/SchedulingRepository.ts` | Leaf-only filters where the diary is read
`lib/business-os/LanguageContext.tsx` | Copy, in en / es / he

---

## Verification

- **The slots are held before payment.** Approve a package quote, then try to
  book one of its times from the public page. It must be refused.
- **Payment confirms every child** and sends exactly **one** email listing all
  the dates — not one email per session.
- **The parent is not in the diary.** The calendar shows six meetings, not seven.
- **One child reschedules alone.** Moving session three leaves the other five
  where they were, and the money untouched.
- **Scenario 2 bills only what happened.** Mark two of six complete: two stages
  billed, four still waiting, and the client's total owed is two sessions.
- **An unmarked session is visible.** A session whose time has passed and which
  is not marked complete appears on the Needs-You card.
- **The quote gate asks rather than assumes** (Stage 0b). With the meeting's time
  passed and nothing marked, the step reads "did the meeting happen?" and offers
  the three marks — and *send a quote* is still reachable in one tap.
- **A no-show no longer ends the job.** Mark a consultation no-show: the step
  offers to rebook, the quote is still sendable, and the contact's payment and
  intake steps are unchanged by it.
- **A cancelled package frees its slots** and stops its chasing.
- **Concurrency.** Two simultaneous bookings for the same slot: one must fail at
  the database, not merely at the application check.

---

## Out of scope

- **Generated cadences.** A "repeat weekly from…" button that *fills the date
  pickers* is a fine later convenience: it writes into fields the owner can
  correct, never into the database.
- **Credits / punch cards** — a balance the client draws down whenever they like.
  No fixed dates means no children, so a genuinely different model. This is the
  shape to reach for if "the client buys ten sessions and books them as they go"
  turns out to be the real requirement.
- **Packages on the public self-serve flow.** The owner composes, the client
  accepts. A client assembling their own package from a website is a different
  feature.
- **Mixed shapes** — part up front, remainder per session.
- **A holiday feed.** Sukkot, Christmas and bank holidays are ordinary time-off
  entries an owner adds as date ranges. Pulling them from a Hebrew or national
  calendar automatically is its own feature.
- (**Time off itself is no longer out of scope** — it became Stage 0c. See
  [Time off](#time-off-stage-0c).)
- **Reusing `installment_count` for sessions** — named so nobody tries. It is the
  mistake `RetPackageEndingDetector` was deleted for: *it counted a payment split
  as a package.*
- **Onboarding chat.** When it returns, one more cell in its grid plus a small
  nested dialog.
- **Fixing Outlook calendar sync**, which sends Google's parameter names to the
  Outlook executor and is broken today. Real, separate, not made worse by this.

---

## The mockup that disagrees

A canvas exists titled **Recurring sessions & packages**
(`claude.ai/code/artifact/951bf908-86a1-4efa-ad32-d9558be9a769`, 30 Sep). **Do
not build from it.** It draws a *Sessions* block inside the **service editor**,
with a weekly/fortnightly/monthly **repeat rule**, a nearest-free-slot search for
clashes, and time off as a prerequisite — four things this plan's recorded
decisions explicitly rule out. It is useful only as a picture of the rejected
shape; boards 4 and 5 (a series in the CRM drawer, and what the client receives)
are still broadly right.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-01 | Stage 2: the model, and two stale assumptions | `20261001_package_sessions.sql` adds `proposals.sessions`, `parent_booking_id` and `occurrence_number`. Reading `applyAcceptance` showed it handles money only and never creates a booking, and `20260803` had already made booking times nullable — so the container needs no time range, nothing needs excluding from availability / `checkOverlap` / calendar sync / the constraint, and money stays exactly where it already points. Decision #4 (`occurrence_number = 0` as a parent marker) is withdrawn as unnecessary: `purchases → parent_booking_id IS NULL` is correct for every reader. |
| 2026-10-01 | Stage 0c parts 1 and 2 implemented | `windowsForDate` is the single resolver; the public booking page, smart links and the chat read it; `SchedulingTimeOffRepository`, the two routes and `TimeOffEditor` fill the table. Three rules recorded: closed wins, custom hours replace rather than narrow (so they can also open a normally-closed day), and an unreadable entry closes the date — which is why the POST refuses a short day with no hours. 34 tests. Also fixed six pre-existing lint errors in `ConfigurationDialog.tsx`: `onWheel`/`onTouchMove` duplicated at three sites, byte-identical, so removing the misindented copy is behaviour-for-behaviour the same (React keeps the last of a duplicated prop). |
| 2026-10-01 | Time off reinstated as Stage 0c | The earlier claim that owner-picked dates made time off unnecessary was wrong: picking by hand stops the platform generating a closed date, not an owner choosing one. Verified that `scheduling_availability_exceptions` is read by nothing — its only other mentions are the ownership and purge registries — so a client can book a closed day today, with or without packages. Three parts: read it, let the owner write it, validate a package's dates against it. |
| 2026-10-01 | Scenario 2's collection decided | The owner's correction: card-or-invoice is the SERVICE's answer (`collection`), not a new question on the package. Both routes are the invoice rail; card-collected means `collection_method: 'charge_automatically'` against a card saved at approval, which `StripeInvoiceService.ts:151` currently hardcodes as `send_invoice`. The platform still never initiates an off-session charge — the principle the deferred-first-payment design states outright. No-show billing is the owner's call at the moment of marking, not a setting. No monthly roll-up in v1. |
| 2026-10-01 | Stage 1: the read-path audit | 137 reads across 51 files classified purchases / meetings / both, counted rather than estimated (the earlier note said 19 detectors; it is 16). Five readers must be fixed before a client sees a package, including `CashBookingUnpaidDetector`, whose second branch was re-verified at `:126-131` and still never looks at the booking's own money. Surfaced the one thing the audit cannot answer: nothing distinguishes a package parent from a single booking, so `purchases → parent_booking_id IS NULL` is right for money and wrong for the diary. Stage 2 must make a parent self-identifying. |
| 2026-10-01 | The unmarked-meeting card | `meeting_unmarked` gap + `mark_meeting` action, navigating to the drawer's bookings section where the three marks already are. Twelve-hour wait and a 90-day floor, both for the same reason: a card that nags or that carries a count which never moves is one owners stop reading. Copy in en / es / he. |
| 2026-10-01 | Stage 0 implemented | The exclusion constraint, with the two clauses the data demanded: rows without times are skipped (4 such bookings exist, and an unbounded range would have blocked every appointment) and inverted ranges are skipped so one bad row cannot take the table down. Live data checked first: 0 overlapping pairs, so it applies. `23P01` mapped onto the existing `BookingSlotUnavailableError` in create and reschedule, with `isSlotTakenError` and 6 tests. |
| 2026-10-01 | Stage 0b implemented | `quoteGate` extracted as a pure module with 14 tests; the drawer's boolean replaced by its five states; `jobClosed` no longer reads `isCancelled` (which includes `no_show` and is shared with the payment and intake steps); the strip asks "did the meeting happen?" when unmarked, names a missed meeting and offers a new time, and keeps *Send a quote* reachable in both; the header badge takes three states instead of ahead-or-not. Copy in en / es / he. The Needs-You card is **not** built yet. |
| 2026-10-01 | Added the quote gate as Stage 0b | The quote step opened on the meeting's time passing, asserting a consultation that may never have happened; and `no_show` folded into `isCancelled` at `CRMContactDrawerV2.tsx:375` closed the job, contradicting the file's own comment forty lines below. Recorded the three-state fix (ask, rather than assume), the no-show correction, and the unmarked-meeting card that scenario 2 reuses. |
| 2026-10-01 | Created | Consolidates the 2026-09-29 plan (`~/.claude/plans/happy-splashing-crab.md`) with the two payment scenarios settled in conversation. Re-verified every "already exists" claim against the tree: the three money shapes, the manual stage trigger at `ProposalAcceptanceService.ts:147-148`, the existing `payment-stages/[id]/complete` route and `bill_stage` gap action, and that the migrations tree still holds zero gist constraints. Records the three open questions and flags the canvas mockup as the rejected shape. |
