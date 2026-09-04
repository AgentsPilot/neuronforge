# CRM contact activities — what is captured, and what is missing

> **Last Updated**: 2026-09-02
> **Status**: 🟡 In progress — §A, §C and §E done; §B (remaining writers), §D (de-dup) and §F (drill-down) open
> **Area**: `lib/repositories/CRMActivityRepository.ts`, `lib/services/BookingEmailService.ts`, `components/crm/contact-drawer/ActivitySection.tsx`, `lib/business-os/LanguageContext.tsx`

## Overview

The activity timeline in the contact drawer is thin, partly English, and repeats itself — while the events an owner would actually act on are not recorded at all. This is the analysis of what is captured today, and the work to fix it without turning the timeline into noise.

The governing constraint: **more signal, not more rows.** A timeline that logs everything is as useless as one that logs nothing.

---

## What is captured today

Measured against a live account (12 activities):

| type | count | written by |
|---|---|---|
| `email` | 7 | — **no live writer found** |
| `booking_confirmation_sent` | 2 | `BookingEmailService.ts:341` |
| `intake_form_sent` | 1 | `BookingEmailService.ts:1024` |
| `booking` | 1 | website booking path |
| `payment` | 1 | payment path |

Plus `note` rows from the website contact and intake forms.

### The drawer is ready for far more than is written

`ActivitySection.tsx:36-44` filters on types that **nothing ever produces**: `booking_created`, `booking_completed`, `booking_cancelled`, `booking_confirmed`, `payment_received`, `payment_failed`, `invoice_sent`, `task_created`, `task_completed`, `intake_form_completed`, `email_sent`. The UI was built for a timeline that does not exist yet — so the gap is upstream, in the writers, not in the drawer.

### The repository's own writers are dead code

`CRMActivityRepository` exposes `logBooking`, `logPayment` and `logEmail` (lines 232, 255, 277). **A repo-wide search finds no caller for any of them.** `logEmail` is the only thing that produces the `Email Sent: …` titles now sitting in the database, so those rows predate the current code and nothing is writing them any more.

---

## Issues found

### 1. Missing translation key — visible today
`crm.activity.filter.forms` is used at `ActivitySection.tsx:44` and **defined in none of the three languages**, so the filter chip renders as the raw key. Every other filter key exists in all three.

### 2. Epoch dates — "12/31/1969"
`BookingEmailService.ts:343` and `:1026` write `${startTime.toLocaleDateString()}`, where `startTime = new Date(booking.start_time)`. A **non-scheduled booking has `start_time: null`** — courses and products, which the platform explicitly supports — so `new Date(null)` yields the epoch and the activity reads *"Confirmation email sent for booking on 12/31/1969"*. Two rows in the live account already say this.

### 3. English stored at write time
Descriptions are baked in English when the row is created, so they cannot follow the reader's language:
- `Confirmation email sent for booking on {date}` — plus a US date format for a Hebrew business
- `Intake form request sent for booking on {date}`
- `Email Sent: {subject}`, `Booking: {service}`, `Payment Received: ${amount}` (repository)
- `Manual email`

`ActivitySection.tsx:173` has a `translateDescription` that pattern-matches known English strings back into the reader's language — a workaround that only covers the phrases someone remembered to add.

### 4. Title and description duplicate each other on screen
The live rows show the same sentence twice, then a raw type label:
```
Confirmation email sent for booking on 9/7/2026
Confirmation email sent for booking on 9/7/2026
booking confirmation sent
```
`crm.activity.title.booking_confirmation_sent` and `crm.activity.title.intake_form_sent` are **not defined**, so the row falls back to the stored English title and then prints the type with underscores replaced by spaces.

### 5. Hardcoded currency
`CRMActivityRepository.ts:265` writes `Payment Received: $${amount}` — a dollar sign regardless of the actual currency. Visible in the live data as `תשלום התקבל: $200.00` on a business that also bills in other currencies.

### 6. Duplicates
The same confirmation is logged repeatedly — four `Email Sent: הפגישה נקבעה מחדש` rows for one booking. Each retry or repeated send writes another row, and nothing de-duplicates. This is the overwhelm risk, already happening.

### 7. **A rescheduled appointment is not recorded at all**
The reschedule route (`app/api/book/manage/[token]/reschedule/route.ts`) updates the booking and sends an email. It writes **no activity**. So the timeline shows the *email about* a change, and never the change itself — no before, no after, no count.

---

## The work

### A. Stop writing English (the root fix)
Store **what happened**, not a sentence about it: an activity type plus a small `metadata` JSON (`{ service, from, to, currency, amount }`), and let the drawer compose the sentence with `t()` at render. That deletes the need for `translateDescription`'s pattern-matching and makes every new activity translatable by construction.

### B. Record the events that matter, and only those
Add writers for the events an owner would act on. Deliberately **not** everything the drawer can filter:

| record | why |
|---|---|
| booking created | the start of the relationship |
| **booking rescheduled** (from → to) | requested: the signal for a client who keeps moving |
| booking cancelled | with reason where given |
| payment received / failed | money |
| intake completed | not merely "sent" |

Leave out: every email send (that is what the email log is for), field edits, page views.

### C. Reschedule, specifically
Write one activity per reschedule carrying `{ from, to }` as instants, so the drawer can render *"moved from Sun 7 Sept 13:00 to Wed 23 Sept 13:00"* in any language — and so an insight detector can count them per contact. Three moves on one booking is a pattern worth surfacing; one is not.

### D. De-duplicate
A confirmation resent three times is one fact. Collapse on `(activity_type, source_entity_id)` within a short window, or make repeat sends update the existing row rather than insert.

### E. Fix the small visible things
1. Add `crm.activity.filter.forms` in en/es/he.
2. Add `crm.activity.title.booking_confirmation_sent` and `…intake_form_sent`, so the row stops printing its own type.
3. Guard the epoch date: a booking with no `start_time` is not "on 12/31/1969" — say nothing about a date it does not have.
4. Use the booking's timezone when formatting an activity date, as the manage page does — these are the same wall-clock-vs-instant times fixed elsewhere.
5. Currency from the payment, not `$`.
6. Don't render title and description when they are the same string.

---

## F. Drill-down — deliberately small

Asked for, and worth stating what it is **not**: not a technical dump, not a raw payload, not a second screen. A row answers its own question when you press it.

**One tap expands the row in place.** No modal, no navigation, nothing to come back from. Two or three lines of plain fact, then it closes again:

| row | what it opens to |
|---|---|
| an email | the subject, when it was sent, and whether it arrived |
| a reschedule | the two times, and *"3rd change by this client"* if it is |
| a payment | amount, method, and the invoice it settled |
| an intake | the answers, if any came back |

**Out of scope for now:** surfacing "this client has moved three times" on the row, and anything that feeds a detector. The events are recorded so that work is possible later; the drawer does not do it.

That is the whole feature. If a row needs more than three lines to explain itself, the fix is a better sentence, not a bigger panel.

## Open question

Whether `logBooking` / `logPayment` / `logEmail` should be wired up or deleted. They are the natural home for A and B, but their current signatures bake English titles — so they want rewriting around the metadata approach rather than calling as they stand.

## Verification

1. Reschedule a booking twice; the drawer shows two "moved" entries with the right from/to times, in Hebrew, in the business's timezone.
2. A non-scheduled booking (course/product) logs a confirmation with no date phrase — no epoch.
3. Switch language; every activity row changes language, including ones written before the switch.
4. Resend a confirmation; the timeline gains no second row.
5. `crm.activity.filter.forms` renders as a word in all three languages.
6. A contact with 20 activities is still scannable — the point of the exercise.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-02 | Created | Analysis against a live account: 12 activities, 5 types, 3 dead repository writers, 7 issues |
