# Business OS Insight — The Heart

> **Last Updated**: 2026-10-07

## Overview

The insight system is meant to be the pilot of the business: something that
sees everything, understands it, tells the owner what matters, and eventually
acts on her behalf. This document is the standing plan for getting there. It
records what has been built, what each remaining piece is for, and the order
they have to come in — each one is a prerequisite for the next, and building
them out of order produces the failures catalogued in
[BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md)
§11.

**The three things that make it intelligent**, and nothing else does:

| | | state |
|---|---|---|
| **Compare** | A number alone is data. "30% cancelled" next to "8% on every other day" is information | ✅ built |
| **Learn** | Find out whether the advice worked, keep what helped, stop what did not | ✅ built, ⚠️ can see 2 of 11 metrics |
| **Expect** | Hold a view of where the business is heading, and explain departures from it | ⬜ not started |

## Table of Contents

- [The finding this is all built on](#the-finding-this-is-all-built-on)
- [The six layers](#the-six-layers)
- [Where AI belongs](#where-ai-belongs)
- [What is built](#what-is-built)
- [Remaining, in order](#remaining-in-order)
- [Decisions already taken](#decisions-already-taken)
- [Verification](#verification)
- [Change History](#change-history)

---

## The finding this is all built on

An audit on 2026-10-06 measured the catalogue: **46 detectors run, 18
maturity-gated, 3 fire, 0 throw** — and **35 of 46 use an absolute threshold**,
reporting a *state* the owner can read off her own screens rather than a
*change*.

The cause was structural. The platform already built a model of the business
(`resolveBusinessHealth` — seven categories with `current`, `previous`,
`sample` and an explicit `too_little_data`) and a model of the business *type*
(`vertical-config`), and **spent both entirely on choosing words**. No detector
read either. Forty-six rules each re-derived their own view from raw tables,
which is why cards contradicted each other and why priority had to be
hand-tuned.

---

## The six layers

Sensing and communicating were one act: every question had to be anticipated
*and* phrased in advance, in 46 places. Splitting them is what makes the rest
possible.

| | Layer | What it does | State |
|---|---|---|---|
| 1 | **Sense** | One typed snapshot per run — funnel, money, calendar, clients, owner behaviour, surfaces — that detectors read instead of querying | `businessHealth` is half of it, read by nothing |
| 2 | **Reference** | `self-over-time`, `self-across-segments`, `declared goal`, behind one interface returning the strongest honest one or nothing | ✅ segments built · goal missing |
| 3 | **Expect** | A forecast of the next period. The thing deviations are measured *against* | ⬜ missing |
| 4 | **Judge** | Expected value of telling her: distance from plan × cost × actionability × will-she-act × does-she-already-know | a priority score exists |
| 5 | **Act** | The trust ladder: observe → suggest → propose → act-and-report → act silently, climbed per capability and earned with evidence | 5 automations, no ladder |
| 6 | **Learn** | shown → acted → metric re-measured weeks later | ✅ built, blind on most metrics |

### Why the forecast is the spine

A pilot does not read instruments and describe them. It holds an expectation of
where the aircraft should be and explains every departure. That one frame
resolves five separate problems at once:

| Problem | What a held expectation does |
|---|---|
| Priorities are hand-tuned weights | The deviation that most moves the forecast *is* the top card |
| 35 of 46 detectors report a state | Every state becomes a change — there is always an expected value |
| Cards state facts | They become causes: *"you will be ₪3k short, because quotes stopped converting in week two"* |
| Nothing is ever urgent | Urgency becomes time-to-impact, which a forecast computes and a threshold cannot |
| "Taking over" is a scary switch | It becomes a purpose: act to keep the business on plan, and say so |

---

## Where AI belongs

Established the hard way: a fabricated 275% rate, counts rendered as money,
figures invented from absent keys. This is architecture, not habit.

> **The model proposes a QUESTION. Code computes every ANSWER.**

| Job | AI? | Why |
|---|---|---|
| Compute a figure | never | Proven failure mode. Every number comes from a query |
| Decide what counts as significant | never | A closed, code-evaluated vocabulary. "Looks significant" is a mood |
| Ask a question nobody wrote a rule for | yes | Built (`hypothesis/`). The one job no rule can do |
| Write the week in one voice | yes | Prose over a state it cannot alter |
| Answer "why am I seeing this?" | yes | Narrating provenance that already exists |
| Choose what to say to *this* owner | eventually | A ranking problem with real training data, once layer 6 has volume |

---

## What is built

### Compare — `patterns/segmentRate.ts` (2026-10-06)

One part of the business against the pooled rest: her days, her services, her
channels. The single rule is **compare rates, never volumes** — "Thursday has
more bookings" only means she works Thursdays — and it is enforced by the
signature, not a check: `isHit` is required, so there is no bare-count mode.

Returns a discriminated verdict naming every refusal (`tooSmall`,
`restTooSmall`, `restZero`, `flat`, …), because every silent refusal in this
module had been an absence and **an absence cannot be logged**.

Live on `ret_no_show_spike` and `ret_cancel_pattern`. The latter needed its own
denominator query — it loads only cancelled rows, so it could count volume and
nothing else.

### Learn — `insight_measurements` + `insight-measure` cron (2026-10-07)

The "before" was always stored (`insights.metric_key`, `current_value`,
`direction`); the "after" was never taken. The sweep re-reads the metric at 30
and 90 days and stores what it finds.

- **Improvement has no fixed sign.** `direction` is copied onto every row: a
  hardcoded "down is better" would report every utilisation recovery as a
  decline and teach the loop to suppress the advice that worked.
- **Dismissed insights are measured too, as the control group.** Advice
  followed by improvement no more often than advice that was ignored is advice
  worth retiring.
- **Both readings come from `derived_metrics`.** `insights.current_value` is
  the tempting "before" and is wrong — detectors compute their own numbers
  while the series is computed separately, and comparing them is the population
  error that can exceed 100%.
- `unmeasurable` is stored, never skipped, so "no data" cannot become "no
  improvement".

Verified read-only against live data at a simulated zero horizon: the metric
with no series returned `unmeasurable`; `cashflow.ar_overdue_usd` read
1300 → 1300 and returned `unchanged`.

---

## Remaining, in order

Each is a prerequisite for the next.

### 1. State snapshots — ✅ partly done, 2026-10-07

`metrics/snapshots.ts` gives a state metric a reader so it becomes a series.
Four definitions added, 12 → 16:

| Key | How |
|---|---|
| `cashflow.ar_total` | snapshot — unpaid invoices, net of refunds. **Refuses to sum across currencies** and returns null |
| `acquisition.broken_link_destinations` | snapshot — shares `deadReason` with its detector, so series and card cannot disagree |
| `cashflow.refund_rate` | event rate — `refund.completed ÷ payment.completed`, counts not amounts |
| `retention.cancellation_rate` | event rate — the branch that existed with no definition (H22) |

**Still open**, with the reason each was left:

- `conversion.pipeline_velocity` — needs stage timestamps; a design question,
  not a reader.
- `cashflow.held_on_cancelled` — money, and needs the per-currency-series
  decision that `ar_total` sidesteps by refusing.
- `operations.service_performance` — the detector's own claim is descriptive
  now (H19); a series would need to decide what "performance" is.
- `retention.cancel_reason` — categorical. Not a number that can improve.
- `acquisition.unique_visitors` — needs a DISTINCT aggregation the engine has
  no shape for.
- ✅ `retention.clients_at_risk` — **built 2026-10-07, option A.** Three
  detectors write that key meaning different things, so the SERIES takes one
  definition and it is the narrowest: no activity and no booking for 30 days,
  relationship at least that old. The window and the client-stage resolution
  are taken from `CrmEngagementDecayDetector` rather than re-chosen, because a
  series measured on a different window than the card that prompted the owner
  cannot answer "did it improve".

### 2. Declared goal — the flight plan, filed by her ⬜

A small place for the owner to state what she is aiming at each month. Cohort
comparison was rejected (below), so this is what gives a forecast an anchor on
day one rather than after a year of history.

### 3. Forecast — the spine ⬜

Needs 1 and 2 beneath it. Projects where the business lands and explains the
gap. Makes priority automatic and converts every state detector into a change
detector by construction.

### 4. One state object ⬜

Extend `businessHealth` and make detectors read it instead of querying. Ends
the contradictions structurally, and it is the only form an AI can be handed
whole.

### 5. Trust ladder ⬜

Needs the outcome evidence from layer 6 to climb. *"This has run 200 times for
businesses like yours and been reversed twice"* is a reason to say yes;
*"Switch this on?"* is not.

---

## Decisions already taken

| Decision | Date | Consequence |
|---|---|---|
| **No cohort comparison.** No account's data informs another's, aggregated or not | 2026-10-06 | The reference is internal — her days, services, channels — plus a goal she declares. Compounding is per-account rather than platform-wide, and slower |
| **Compare her to herself first**, rather than goal+forecast | 2026-10-06 | Smallest change converting the most cards; needs no new data and no capture UI |
| **`conv_source_underperform` stays hand-rolled** | 2026-10-06 | It reports the SET of below-average sources; `outlierSegment` returns the single highest-rate one. Moving it is a behaviour change, not a refactor |
| **Never delete a detector** | standing | Fix when it fires, not whether it exists |

---

## Verification

| Check | How |
|---|---|
| Census unchanged | `46 detectors / 18 gated / 3 fired / 0 threw`; the fired count must not drop |
| Suites | `npx jest lib/business-os lib/repositories lib/cron app/api` — 481 suites, 9,880 tests at time of writing |
| Types | A **scoped** `tsconfig` plus `--max-old-space-size=8192`. A full-project `tsc` OOMs on this machine and exits with a V8 crash trace **that reads exactly like a clean run** if only the tail is checked — this has already produced one wrong "verified" claim |
| Live | Account `08456106-aa50-4810-b12c-7ca84102da31`. Most comparisons and measurements will honestly refuse at this data volume; that is the correct result, not a failure |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-07 | Created | Consolidates the 2026-10-06 audit, the heart architecture and the agreed build order into a standing plan. Compare and Learn are built; state snapshots are the next build, because the measurement loop is live and can see 2 of 11 metrics |
