# Business OS Insight — Segment Comparison

> **Last Updated**: 2026-10-06

## Overview

Insight cards currently state one number about the whole business: *"30% of your
bookings are cancelled."* The owner already knows that, and it names nothing to
change. This workplan gives detectors the ability to split that number across
parts of the business the owner already has — her days, her services, her
booking channels — so the **difference** becomes the finding:

```
now     "30% of your bookings are cancelled"      she knows this
after   "Thursday 43%, everything else 8%"        she cannot see this
```

**Cross-account cohort comparison was considered and rejected** (2026-10-06, product
decision): no account's data informs another's, aggregated or not. The reference
here is entirely internal to one business.

## Table of Contents

- [Why this, and why first](#why-this-and-why-first)
- [The rule that keeps it honest](#the-rule-that-keeps-it-honest)
- [What already exists](#what-already-exists)
- [Task 1 — The shared helper](#task-1--the-shared-helper)
- [Task 2 — Carry it to the card](#task-2--carry-it-to-the-card)
- [Task 3 — Fix the live bug it exposes](#task-3--fix-the-live-bug-it-exposes)
- [Task 4 — Apply it](#task-4--apply-it)
- [Out of scope](#out-of-scope)
- [Verification](#verification)
- [Change History](#change-history)

---

## Why this, and why first

A full audit of the module (46 detectors; 18 maturity-gated, 3 firing, 0
throwing) found that **35 of 46 use an absolute threshold** — they report a
*state* the owner can read off her own screens, not a *change*. The cause is
structural: nothing in the module compares anything to anything.

Three references could supply that meaning — the business's own history, other
parts of the same business, and a target the owner declares. Own history needs
roughly a year before a baseline is usable (the reporting account's repeat-rate
series is `[0,0,0,0,0,100,100]`). A declared target needs a capture screen and a
forecast. **Comparing parts of the same business needs neither**, works on an
account three weeks old, and reuses query machinery that already exists.

---

## The rule that keeps it honest

> **Compare rates, never volumes.**

"Thursday has more bookings" is not a finding — it means she works Thursdays.
"Thursday is cancelled more often" is a finding.

This is enforced **structurally, not by a check**: the helper's `isHit`
predicate is required, so every comparison is `hits ÷ of` within a segment
against `hits ÷ of` across all other segments pooled. There is no bare-count
mode to misuse. A caller passing `isHit: () => true` gets every rate at 1.0, a
ratio of 1.0, and an honest `flat` refusal.

This is the segment-shaped sibling of the tautology rule already added to the
hypothesis verifier (`hypothesis/verify.ts` → `isTautology`), which rejects a
bare `count` with no `where` for exactly the same reason.

---

## What already exists

Checked before designing, to avoid a second way of doing the same thing.

| Module | Answers | Reused how |
|---|---|---|
| `patterns/dominantReason.ts` | *Within a slice, which **reason code** dominates?* (`dominantWithin`) | **Different question** — categorical distribution of reasons, not a rate against the rest. Its `PatternConfidence` type and its sample-caps-confidence discipline are reused directly |
| `funnelGap.ts` | Is a drop between two funnel stations judgeable? | **Convention source.** `GapVerdict` is the discriminated "name the refusal" shape this helper copies, including `MIN_TO_JUDGE = 5` as the floor |
| `hypothesis/verify.ts` | Is a model-proposed query answerable and non-tautological? | Same honesty posture; `isTautology` is its query-shaped equivalent |
| `ConvSourceUnderperformDetector` | Which lead source converts worst? | **Already does this correctly by hand** (`:124-130`): a per-segment `minSamples` floor and a ≥2-segment requirement. This helper is that logic extracted |
| `OpsServicePerformanceDetector` | Which service underperforms? | **Already does this incorrectly by hand** — see Task 3 |

A sweep for `restRate` / `rateBySegment` / `compareSegments` / `segmentRate` /
`vsRest` across `lib/` returned nothing. No existing helper is being duplicated.

---

## Task 1 — The shared helper

**File (new):** `lib/business-os/insight/patterns/segmentRate.ts`

Lives in `patterns/` beside `dominantReason.ts` rather than a new directory: it
is the same kind of thing (pure judgement over counts, no database, no imports
beyond its own types), and a new `reference/` directory for one file would split
the module for no reason.

```ts
export type SegmentVerdict =
  /** Nothing had a usable segment key. */
  | { kind: 'noSegments' }
  /** Fewer than two segments cleared the floor, so there is no "rest". */
  | { kind: 'tooFewSegments' }
  /** No segment reached `minPerSegment`. */
  | { kind: 'tooSmall' }
  /** The rest-of-business denominator is too thin to be a reference. */
  | { kind: 'restTooSmall' }
  /** The rest never hits. An infinite ratio is not a finding. */
  | { kind: 'restZero' }
  /** A leader exists but is not far enough ahead to be worth saying. */
  | { kind: 'flat' }
  | { kind: 'outlier'; comparison: SegmentRate };

export interface SegmentRate {
  segment: string;
  hits: number;
  of: number;
  rate: number;                       // hits / of
  rest: { hits: number; of: number; rate: number };
  ratio: number;                      // rate / rest.rate
  confidence: PatternConfidence;      // reused from dominantReason.ts
}

export function outlierSegment<T>(
  rows: T[],
  opts: {
    segmentOf: (row: T) => string | null | undefined;
    isHit: (row: T) => boolean;       // REQUIRED — this is the volume rule
    minPerSegment?: number;           // default MIN_PER_SEGMENT
    minRatio?: number;                // default MIN_RATIO
  }
): SegmentVerdict;
```

**Constants, each with its reason in the source:**

- `MIN_PER_SEGMENT = 5` — matches `MIN_TO_JUDGE` in `funnelGap.ts`. Below five, a
  rate is noise.
- `MIN_RATIO = 2` — the outlier must be at least twice the rest. Anything less
  and the owner would act on a near-tie.

**Behaviour notes:**

- A row whose segment key is null is excluded entirely — it cannot be evidence
  about a segment, and it must not silently join the rest (the mistake
  `dominantReason` documents for blank reasons).
- The "rest" is **every other segment pooled**, including segments that
  individually fall under the floor. Pooling is what makes the reference solid
  on a small account; only the *outlier* needs to clear `minPerSegment`.
- Confidence is capped by sample before ratio, following `confidenceFor`:
  `high` needs ≥10 in the segment, ≥10 in the rest and ratio ≥3; `medium` needs
  ≥8 both sides; otherwise `low`.

**Tests (new):** `lib/business-os/insight/patterns/__tests__/segmentRate.test.ts`

---

## Task 2 — Carry it to the card

Additive throughout — no existing detector or card changes behaviour.

| File | Change |
|---|---|
| `insight/detectors/types.ts` | `DetectionResult` gains `comparison?: SegmentRate` |
| `insight/repository/InsightRepository.ts` | `describeComparison()` adds the **shape** of the gap to the narration prompt. Follows the `describeImpact()` precedent: absent comparison renders **nothing**, never a dangling "compared to" |
| `patterns/segmentRate.ts` | `nameSegment()` resolves the raw key to a readable name; the detector puts it in `narrationSubject` |

**A design fault caught during implementation.** The first version withheld the
segment key from the prompt — correct, since it is a UUID or `'thu'` — and a
code comment claimed the card would name the slice from `process_parameters`
instead. **It would not have.** `InsightAdvisorCard` and `InsightDetailModal`
*declare* `process_parameters` and no component reads it, so the card would
have said "one group is four times worse" with no way to tell which. That is
precisely the dead-link card whose owner replied *"which link?"*.

The fix uses the field that exists for this: the detector resolves the name
and writes it into `narrationSubject`. A name that cannot be resolved (a
deleted service) drops the **whole** comparison rather than printing a UUID.

Money is never summed or converted here — a rate is unitless, so the currency
trap does not apply. Segment **labels** that name a service still come from the
service record, not from a hardcoded string.

---

## Task 3 — Fix the live bug it exposes

**File:** `lib/business-os/insight/detectors/catalog/OpsServicePerformanceDetector.ts:159-177`

```ts
const performers = Object.values(servicePerformance).filter((s) => s.bookings > 0);
const topPerformer = performers.reduce((max, s) => (s.bookings > max.bookings ? s : max));
const threshold = topPerformer.bookings * (this.definition.threshold / 100);
const underperformers = performers.filter(s => s.id !== topPerformer.id && s.bookings < threshold);
const zeroBookingServices = Object.values(servicePerformance).filter((s) => s.bookings === 0);
```

Three faults, all instances of the rule in this workplan:

1. **It compares volumes, not rates.** A service with few bookings is reported as
   underperforming when it may simply be offered rarely.
2. **`bookings > 0` is the only per-segment floor.** One booking is enough to be
   judged against a service with forty — the same class of error as the 275%
   refund rate fixed earlier this cycle.
3. **Zero-booking services are folded in** as underperformers, so a service
   created yesterday is reported as failing.

`minSamples: 10` gates the *total* booking count only, which is why none of this
was caught.

**Fix:** move onto `outlierSegment` with a rate measure, keeping `minSamples: 10`
as the total gate. The helper supplies the per-service floor it lacks. A service
with no bookings has no rate and is excluded; "you have a service nobody has
booked" is a different, honest card and is **not** written here.

---

## Task 4 — Apply it

Each detector tries its dimensions in order via `firstOutlier` and takes the
first `outlier` verdict. A non-outlier verdict is logged at `debug` with its
`kind`, so a refusal is traceable — the absence of that is what let several
silent failures survive this cycle.

| Detector | Split by | The rate | Status |
|---|---|---|---|
| `RetNoShowSpikeDetector` | day of week, then service | no-show ÷ settled | ✅ done |
| `RetCancelPatternDetector` | day of week, then service | cancelled ÷ settled | ✅ done (own denominator query) |
| `OpsServicePerformanceDetector` | service | *(no rate available — see Task 3)* | ✅ faults fixed |
| `ConvSourceUnderperformDetector` | source | converted ÷ leads | ⛔ **not applicable — different question** |

### Discovered during implementation: two detectors have no denominator

`RetCancelPatternDetector` filters `.eq('status', 'cancelled')` and
`OpsServicePerformanceDetector` filters `.in('status', ['confirmed',
'completed'])`. **Every row they load is the same outcome**, so neither can
form a rate from the data it already has — they can only count volume, which is
exactly what this workplan forbids.

- **`OpsServicePerformance`** cannot be rescued by a wider query either:
  different services have different numbers of *opportunities*, and nothing in
  the schema records that. Its claim was made descriptive instead (Task 3).
- **`RetCancelPattern`** can, and now does. `cancelRateOutlier` runs a second
  query for settled bookings, windowed on `start_time` for **both** halves.
  The reason query windows on `updated_at`, which is the right clock for a
  reason and the wrong one for a rate: dividing cancellations-by-`updated_at`
  by bookings-by-`start_time` compares two different populations and can
  exceed 100%. The reason logic above it is untouched, and the comparison
  cannot take the card down — a failed or thin lookup leaves it absent.

### `ConvSourceUnderperformDetector` is a different question, not a deferral

It reports **every source below the average**. `outlierSegment` returns the
**single highest-rate segment**. Those are not the same shape, so moving it is
a behaviour change rather than a refactor — it would stop naming the set and
start naming one member of it.

Making the move possible means giving the helper a "worst, not best" direction
and a set-returning mode. Worth doing when a second caller wants it; building
it speculatively for a detector that already works is how this module acquired
the dead config it spent this cycle deleting.

### No new translation keys were needed

Task 2 anticipated dimension labels in `LanguageContext`. They are not
required: the slice is resolved by `nameSegment` into English scaffolding
inside `narrationSubject`, which the narrating model already renders in the
owner's language — the same field carries `the booking link '5 שירותים', 25
clicks` today. A weekday is a word, not a figure, so translating it is the one
thing the model is reliably good at.

### Also added, not in the original plan

| File | Addition | Why |
|---|---|---|
| `lib/business-os/businessDay.ts` | `localWeekdayIn(instant, timezone)` | A 01:00 Jerusalem booking is on the *previous* day in UTC. Reading a weekday off the raw timestamp files bookings under the wrong day, and "Thursdays are your problem" has to be right about which day |
| `detectors/catalog/BaseDetector.ts` | `resolveBusinessTimezone(userId)` | Returns **null** when nobody has set one, so a detector drops the day dimension rather than guessing. `resolveBusinessTimezone` in `businessDay.ts` answers `'UTC'` for both "chose UTC" and "never asked", and those must not be treated alike |
| `patterns/segmentRate.ts` | `firstOutlier` + `Dimension<T>` | Three detectors need "try day, then service, log why not". Returning a `refusals` map is the point: an absence cannot be logged |

---

## Out of scope

Forecast, declared goals, the outcome loop, the single state object, the trust
ladder, any automation change, any new detector, and any cross-account data.

---

## Verification

| Check | Expectation |
|---|---|
| **The volume refusal** | A segment with more rows but the same rate returns `flat`. The rule the design rests on, so it is the first test |
| **The per-segment floor** | Services at 1-of-2 and 1-of-40 produce no comparison. This is the Task 3 bug, written as a test that fails before the fix |
| **The infinite ratio** | `rest.rate === 0` returns `restZero`, never `Infinity%` |
| **Null segments excluded** | Rows with no segment key change neither numerator nor denominator |
| **Behaviour preserved** | `ConvSourceUnderperformDetector` returns the same result before and after the move |
| **Card degrades to silence** | A `DetectionResult` with no `comparison` renders exactly what it renders today |
| **Census unchanged** | `46 detectors / 18 gated / 3 fired / 0 threw`; the fired count must not drop |
| **Suites** | `npx jest lib/business-os lib/repositories` |
| **Live** | Account `08456106-aa50-4810-b12c-7ca84102da31`. At 33 bookings most comparisons will honestly refuse — that is the correct result, not a failure |

### Four type errors the test suite could not see

Jest strips types rather than checking them, so 543 green tests said nothing
about these. A **scoped** `tsc` found them — the full-project run OOMs on this
machine even at 4 GB and exits with a V8 crash trace, which looks exactly like
a clean run if only the tail is read. Use
`tsconfig` scoped to the module, with `--max-old-space-size=8192`.

| Error | Severity |
|---|---|
| `detectors/index.ts` re-exported `./catalog`, **which this cycle deleted** | **Broke a production path.** `app/api/cron/insight-detect/route.ts` imports `DetectorEngine` through that barrel, so the insight cron would not have compiled |
| `ToilManualBookingEntryDetector` declared `thresholdType: 'percentage'` | Not a `ThresholdType`. The legal three are `absolute`, `percent_change`, `std_deviation`; this threshold is a percentage *value* compared absolutely |
| `ToilManualBookingEntryDetector` and `SysAutomationUnadoptedDetector` declared `currentValueUnit` in their **definition** | It belongs on `DetectionResult`, where both already pass it |
| `BaseDetector.contract.test.ts` still built a definition with `eventTypes`, `consentTier`, `ownerParameters`, `guardrails` | All four were deleted earlier this cycle |

### Result, 2026-10-06

- `patterns/__tests__/segmentRate.test.ts` — 35 tests, green.
- `catalog/__tests__/OpsServicePerformanceDetector.floor.test.ts` — 5 tests.
  **Verified against the pre-fix code**: 4 of the 5 fail on `HEAD`, and the one
  that passes is the behaviour-preserved case (a service that is genuinely
  behind *and* booked enough to say so is still reported). The tests pin the
  bug rather than describing the new code.
- `npx jest lib/business-os/insight` — 51 suites, 548 tests, green.
- Scoped `tsc` over `insight/**` + `businessDay.ts` — clean; the cron route's
  import of `DetectorEngine` resolves again.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-06 | Created | Written after the full-module audit. Cohort comparison rejected as a product decision; internal segment comparison chosen as the first build |
