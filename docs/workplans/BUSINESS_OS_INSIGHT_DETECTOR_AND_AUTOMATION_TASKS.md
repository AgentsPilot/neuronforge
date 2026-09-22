# Business OS Insight — Detector and Automation Tasks

> **Last Updated**: 2026-09-17

## Overview

Tasks arising from an audit of the 33 registered insight detectors and the four
automations they point at. Two findings drove the list: five detectors could
never fire, and **no automation is implemented** — every one is declared,
mapped, surfaced in the UI, and refused at execution time.

Each task below states what it is, why it exists, the data it depends on
(verified against the live database, not against migrations), and how to know it
is done.

## Table of Contents

- [Done](#done)
- [T3 / T4 — BLOCKED on instrumentation](#t3--t4--blocked-on-instrumentation-not-on-detector-code)
- [T5 — Execute automations outside the kernel](#t5--execute-automations-outside-the-kernel)
- [T6 — Detector: income dropped](#t6--detector-income-dropped)
- [T7 — Detector: completed work never invoiced](#t7--detector-completed-work-never-invoiced)
- [T8 — Detector: revenue concentration](#t8--detector-revenue-concentration)
- [T9 — Detector: quote acceptance falling](#t9--detector-quote-acceptance-falling)
- [Verification rules for all detector work](#verification-rules-for-all-detector-work)
- [Change History](#change-history)

---

## Done

| # | Task | Detail |
|---|------|--------|
| ✅ T1 | Remove detectors that can never fire | `ret_package_ending`, `cash_cards_expiring`, `pricing_discount_abuse`, `web_mobile_issues`, `web_page_underperform`. Files plus every registry: `DetectorEngine`, `catalog/index`, `TriggerableProcesses`, `correlation/patterns`, `InsightCorrelationEngine`, `InsightRepository` copy, `LanguageContext` i18n, seed script. Stored `insights` rows deleted for the two accounts that had them. Detector count 33 → 29 |
| ✅ T2 | Remove the fabricated payment rate | `AutonomousWorkFeed` multiplied successes by `0.3` ("Assume 30% paid") and printed the result beside a money figure as measured fact. Nothing counts invoices paid because a reminder was sent. The card now reports what was sent and nothing else |

**Why each T1 removal was justified**

| detector | reason |
|---|---|
| `ret_package_ending` | Advised renewing a package. The product has no renewal concept for a client's plan, and it fired on every plan that finished paying, including one-off quotes |
| `cash_cards_expiring` | Reads `saved_payment_methods`. Zero rows on every account; cards live at Stripe under Connect |
| `pricing_discount_abuse` | Looks for discounts in transaction metadata. No discount feature exists to write any |
| `web_mobile_issues` | Every query named a column that does not exist |
| `web_page_underperform` | Four of five queries did the same |

---

## T3 / T4 — BLOCKED on instrumentation, not on detector code

🔴 blocked

**What they were** `web_page_underperform` (published pages with traffic and no
conversions) and `web_mobile_issues` (mobile converting worse than desktop).
Both were deleted in T1 for querying columns that do not exist.

**Why they are not simply rebuildable, contrary to the first version of this
plan.** That version said the analytics were real and only the column names were
wrong. The names were checked; the VALUES were not. Measured across all 262 rows
of `website_page_views`:

| field | reality |
|---|---|
| `session_id` | NULL on every row. Never populated |
| `ip_hash` | one distinct value across all 262 — the fallback visitor proxy is degenerate too |
| `device_type` | 100% desktop. No mobile traffic is recorded at all |
| `is_owner_view` | never true. The owner's own visits count as traffic |
| `smart_link_clicks.converted` | false on all 23 rows |

`SmartLinkRepository.markConversion()` exists and would set `converted`, but
nothing calls it — and it matches on `session_id`, the field that is null.

`crm_contacts` carries a `source` (`website_booking`, `website_form`,
`instagram`) but no `page_id`, so a conversion cannot be attributed to a PAGE
even in principle.

**So neither detector can be written honestly today.** Unique visitors cannot be
counted, conversions cannot be attributed to a page, and there is no mobile
traffic to compare against desktop. Rebuilding them would produce detectors that
look correct and report noise, which is what `cash_cards_expiring` did before it
was deleted.

**What unblocks them — none of it is detector work:**

1. **Populate `session_id`** on page views, and set the same id on smart-link
   clicks so `markConversion` can match on it.
2. **Call `markConversion`** when a booking, form or payment completes. The
   function is written and has never run.
3. **Set `is_owner_view`** when the owner previews their own site.

**Point 3 matters beyond these two detectors.** `AcqTrafficDropDetector` and
`/api/business-os/stats` both read this table, so every page-view figure in the
product is currently inflated by the owner's own visits. That is a wrong number
being shown today, not a missing feature.

Only after those three land is it worth writing either detector. At that point
the design notes are: count unique visitors as distinct sessions, exclude owner
views, compare mobile against desktop within the same window rather than against
a historical baseline, and floor both arms — "0 of 3 mobile visitors converted"
is not a finding.

---

## T5 — Execute automations outside the kernel

🔴 hard · **highest value**

**What** Make the four automations actually run, using the durable-queue pattern
already proven in this codebase rather than the kernel trigger.

**Why** Today none of them work. The chain is
`insight-automations` cron → `AutomationManager.runDueAutomations` →
`runAutomation` → `KernelTrigger.trigger`, and it ends at:

```
'Kernel process is not implemented; refusing rather than reporting fabricated work'
"'<process>' is not implemented yet."
```

Nothing under `lib/business-os/insight/**` imports any email service. So the UI
offers "put it on autopilot" for a process that cannot run. The kernel is right
to refuse rather than fake it, but the feature does not exist.

**Approach** Do not extend the kernel. Use the canonical durable-queue drain
(§8.1 of the event-driven migration plan, and the `durable-queue-drain` skill):
reap → enqueue → claim (`FOR UPDATE SKIP LOCKED`) → send → close, with a
dead-letter and an idempotency key. `lead_responses` /
`LeadResponseDispatchService` is the worked example in this repo; payment
reminders are the second.

**The four, in build order**

| process | what it sends | covers |
|---|---|---|
| `chase_overdue_invoices` | payment reminder for an overdue invoice | 4 detectors |
| `send_followup_nudge` | follow-up to someone who has gone quiet | 9 detectors |
| `send_reminder_sequence` | appointment reminder before a booking | 2 detectors |
| `draft_reply_templates` | generates templates; no send | 1 detector |

**`send_followup_nudge` needs splitting or parameterising.** Nine detectors point
at it, and the right message differs: a cold lead, a contact stuck in a stage, a
client quiet for 30 days and someone who did not take up an intro offer are four
different emails. One template for all nine will read wrong for most.

**Non-negotiables**
- Idempotency per (process, entity, run). A double-send to a client is worse
  than a missed send.
- Respect the existing quiet-hours and `max_items_per_run` guards in
  `AutomationManager`.
- Report only what happened. No assumed rates (see T2).

**Done when** An automation enabled on a real account sends exactly once, is
recorded, survives a re-run of the cron without re-sending, and the work feed
reports counts that match the rows.

---

## T6 — Detector: income dropped

🟡 medium

**What** Revenue over the recent window materially below the preceding one.

**Why** There is no detector for the single figure an owner cares about most.
The closest, `cash_revenue_at_risk`, totals what has not arrived; nothing watches
what *did* arrive falling.

**Data** `payment_invoices` (`paid_at`, `amount`, `refunded_amount`, `status`)
and `payment_transactions` (`created_at`, `amount`, `refunded_amount`, `status`).
Both verified present.

**Build notes**
- **De-duplicate.** An invoice settled by a transaction is one payment in two
  tables. `BriefingFactsService.takingsFor` already does this; reuse the rule.
- Net of refunds.
- Currency: write the business's own currency into `estimated_impact_usd`, which
  despite its name is not USD. Never hardcode a symbol.
- Needs enough trading history that two windows are comparable, or it will fire
  on every business whose second week is quieter than its first. Set
  `minSamples` on **payments**, not on days.

**Done when** It fires on a real drop, stays silent for a business with one
week of history, and reports the amount in the right currency.

---

## T7 — Detector: completed work never invoiced

🟢 easy · **strong candidate**

**What** Appointments marked `completed` with no invoice and no payment against
them.

**Why** This is money the owner did the work for and never asked for. It is
fully computable today, needs no new concept, and is unambiguous when it fires.

**Data** `scheduling_bookings` (`status`, `payment_status`, `start_time`,
`client_name`) joined to `payment_invoices.booking_id`. All present.

**Build notes**
- Exclude free services. A £0 intro session is completed and correctly
  uninvoiced. Check the service price, not the booking.
- Exclude bookings already `payment_status = paid`.
- Leave a grace period. Work finished an hour ago is not an unbilled debt.

**Done when** It names the specific appointments and their value, and is silent
for a business whose completed work is all either paid or free.

---

## T8 — Detector: revenue concentration

🟢 easy

**What** One client accounts for an outsized share of income.

**Why** A risk insight rather than a problem: losing that client is a large
event, and the owner may not have noticed the exposure.

**Data** `payment_invoices` grouped by `contact_id` over a window.

**Build notes**
- Meaningless below a handful of clients. With three clients someone is always
  40%. Floor it on **client count**, not revenue.
- Advisory. There is no automation for "get more clients", and pretending
  otherwise repeats the `ret_package_ending` mistake.

---

## T9 — Detector: quote acceptance falling

🟡 medium

**What** Proposals sent versus accepted, trending down.

**Why** For a business that sells by quote, this is the conversion rate that
matters, and `conv_*` detectors all measure pipeline stages instead.

**Data** `proposals` — confirm the status and timestamp columns against the live
schema before building. Not yet verified.

**Build notes** Needs real volume. Two quotes is not a rate. Consider whether
this belongs as a metric on a stats panel rather than as a card demanding
attention.

---

## Verification rules for all detector work

Non-negotiable, and each one exists because it was broken before:

1. **Verify every column against the live database.** `npm run schema:check`,
   plus the `business-os-schema-check` skill. Four of the five removed detectors
   died of phantom columns: PostgREST rejects the whole select for one unknown
   name, the error is destructured away, and the code falls through to a default
   with nothing in any log.
2. **Register in `DetectorEngine`.** That is the real registration point. The
   barrel `catalog/index.ts` is not, and has been stale before.
3. **Set `minSamples` deliberately** and say why in the file.
4. **Only claim an automation that exists.** A `pairedProcessId` pointing at an
   unbuilt process gives the owner a button that refuses.
5. **Never invent a coefficient.** Report what was measured (see T2).
6. **Localised text is translation keys, not English prose.** There is no reader
   on the server to have a language.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-17 | Created | Audit of 33 detectors and 4 automations. T1 and T2 completed; T3-T9 outstanding |
| 2026-09-17 | T5-T9 done | Automations execute via a durable queue (`insight_actions`) instead of the kernel. Four new detectors: `cash_work_unbilled`, `cash_income_drop`, `cash_client_concentration`, `conv_quote_acceptance_drop` |
| 2026-09-17 | T3/T4 reclassified | Measured the analytics VALUES rather than the column names: session_id null on every row, device_type 100% desktop, `converted` never set. Both are blocked on instrumentation, not detector code |
