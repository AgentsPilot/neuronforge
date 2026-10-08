# Business OS — Insights Module (as-merged into `main`)

> **Last Updated**: 2026-10-06
> **Verified against**: `main` @ `d3312431` (local == `origin/main`, 0 ahead / 0 behind)

## Overview

The Insights module is the advisory intelligence layer of Business OS. On a cron cadence it computes metrics, runs a catalog of **40 detectors** over the owner's business data, correlates the signals that fire into higher-order stories, prioritizes them, persists them as `insights` rows with LLM-localized prose, and renders them on the `/business-os` dashboard.

This document is the **as-built map**, written from the code rather than from the design docs, because the design docs drifted: the last insight-specific doc was written 2026-08-12 and the module was substantially rebuilt between 2026-08-26 and 2026-09-07. It exists so a developer (human or agent) can start work on Insights without reading the subsystem cold and without walking into the [known hazards](#11-known-state--hazards).

**Read [§1 Scope](#1-scope--the-name-collision) first.** There are two unrelated systems in this repo called "insights", and the older one has seven documents named `INSIGHT_*.md` that do not apply here.

---

## Table of Contents

1. [Scope & the name collision](#1-scope--the-name-collision)
2. [Module map](#2-module-map)
3. [Data model](#3-data-model)
4. [The pipeline](#4-the-pipeline)
5. [The detector contract](#5-the-detector-contract)
6. [Adding a detector — the registry footprint](#6-adding-a-detector--the-registry-footprint)
7. [Vectors & the maturity model](#7-vectors--the-maturity-model)
8. [The correlation engine](#8-the-correlation-engine)
9. [Journey timeline & funnel gap](#9-journey-timeline--funnel-gap)
10. [Channel insights](#10-channel-insights)
11. [Known state & hazards](#11-known-state--hazards)
12. [Doc map — what to read, what to ignore](#12-doc-map--what-to-read-what-to-ignore)
13. [Change History](#change-history)

---

## 1. Scope & the name collision

Two unrelated subsystems in this repo are called "insights". Nearly every stale document and half the routes belong to the **wrong one**.

| | **Business OS Insights** (this doc) | **Agent shadow insights** (not this doc) |
|---|---|---|
| Code | `lib/business-os/insight/**` | `lib/pilot/insight/**` |
| Repository | `lib/business-os/insight/repository/InsightRepository.ts` (2,583 lines) | `lib/repositories/InsightRepository.ts` (523 lines) |
| Tables | `insights`, `business_events`, `derived_metrics`, `insight_automations`, `owner_insight_history`, `business_health_summaries` | `execution_insight_runs`, agent execution tables |
| Routes | `/api/business-os/insights/**`, `/api/cron/insight-*`, `/api/business-os/channel-insights/**` | `/api/v6/insights/**`, `/api/v2/insights/**`, `/api/insights`, `/api/agents/[id]/insights` |
| Subject | The owner's **business** (leads, cash, bookings) | An **agent's execution** quality |
| First commit | 2026-08-04 | ~2026-06 |

**Two identically-named `InsightRepository` classes is the single most common mistake in this area.** The roadmap itself got it wrong once and had to be corrected ([roadmap § Insights](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md)).

**Module shape decision (user, 2026-08-11, still current):** Insights is a **repository-backed service, not an internal plugin.** No plugin definition, no executor, no capability wiring, no Modules-tab surface. Full plugin re-evaluation is deferred to post-Step-3.

---

## 2. Module map

### Core subsystem — `lib/business-os/insight/`

| Path | Lines | Responsibility |
|---|---|---|
| `repository/InsightRepository.ts` | 2,583 | Persistence for `insights`, `owner_insight_history`, `business_health_summaries`, correlation results **plus** the three LLM calls that localize prose, and `getVectorMaturity()`. Those three calls record usage against the business analysed (`feature = business-os-insights`, `component` = `insight_content` / `correlated_insight` / `health_summary`, `session_id` = the detection `runId`, now required on the public methods), via `lib/business-os/llm/callCatalog.ts` |
| `detectors/DetectorEngine.ts` | 366 | Registers and runs all 40 detectors for one user; invokes the correlation engine |
| `detectors/types.ts` | — | `DetectorDefinition`, `DetectionResult`, `Detector`, severity, guardrails, consent tiers |
| `detectors/catalog/*.ts` | 40 files | One detector each; all extend `BaseDetector` |
| `prioritizer/InsightPrioritizer.ts` | 384 | Weighted scoring (severity, money, recency, actionability, prefs), dedup, cooldowns |
| `metrics/MetricsComputeService.ts` | 467 | Computes `derived_metrics` from `business_events` + module tables |
| `metrics/BaselineCalculator.ts` | 287 | Historical baselines with minimum-sample guards and std-dev |
| `events/BusinessEventService.ts` | 519 | The **only** writer to `business_events` — see [hazard H1](#11-known-state--hazards) |
| `kernel/KernelTrigger.ts` | 411 | Triggers existing pilot/kernel processes from an insight. Does **not** build an executor |
| `kernel/TriggerableProcesses.ts` | 216 | detector → kernel process registry |
| `automation/AutomationManager.ts` | 457 | Standing automations (`insight_automations`) lifecycle |
| `projection/ImpactProjector.ts` | 498 | Before/after projection — do-nothing vs. let-the-system-handle-it |
| `reporting/AutonomousWorkFeed.ts` | 284 | Recent kernel actions, for MyDay story beats |
| `correlation/` | 4 files | Cross-detector pattern matching → `CorrelatedInsight` |
| `metrics/snapshots.ts` | — | Current-state readers, so a metric with no event becomes a series. Every reader returns **null**, never zero, when it cannot answer — `cashflow.ar_total` refuses rather than sum two currencies |
| `vectorTypes.ts` | — | Pure, **zero imports**. The vector vocabulary both the repository and the client hook re-export, so the two cannot drift again |
| `outcome/judgeMovement.ts` | — | Pure. Whether a re-reading is BETTER, which depends on the side the threshold was breached on. `unmeasurable` is a first-class verdict |
| `outcome/MeasurementRepository.ts` | — | Finds insights whose horizon has passed and reads the metric at both ends **from one series**. `findDue` is ⟨unscoped-by-design⟩ (cron-facing) |
| `outcome/MeasurementService.ts` | — | The sweep, at 30 and 90 days. Never throws for one bad insight |
| `patterns/dominantReason.ts` | — | Pure. Within a slice, which **reason code** dominates — a categorical distribution, with floors for too-few, flat and unknown-wins |
| `patterns/segmentRate.ts` | — | Pure. Whether one part of the business has a higher **rate** than the pooled rest. Easy to confuse with the file above and impossible to confuse by signature: that one needs a reason per row, this one a yes/no |
| `vertical-config.ts` | — | Per-vertical terminology maps + LLM tone guidelines |
| `journeyTimeline.ts` | — | Pure. Event-anchored onboarding timeline |
| `funnelGap.ts` | — | Pure. What a funnel connector may claim |

### Channel insights — `lib/business-os/channel-insights/`

Added 2026-08-26 → 2026-09-01. Marketing-channel attribution and performance; a sibling of the detector pipeline, not part of it.

| File | Responsibility |
|---|---|
| `providers.ts` | `meta` / `google_analytics` / `google_business_profile` as **data, not branches** — one entry adds a provider |
| `ChannelMetricsSyncService.ts` | Pulls provider metrics on the `channel-metrics-sync` cron |
| `ChannelPerformanceService.ts` | Aggregates into `ChannelPerformance` for the UI |
| `channelFromReferrer.ts` / `ga4Source.ts` | Referrer and GA4 source → canonical `Channel` |
| `resolveVisits.ts` | Reconciles visits across website / landing / smart-links / analytics surfaces |

### API surface

| Route | Method | Notes |
|---|---|---|
| `/api/business-os/insights` | GET, POST | Canonical pattern: `getUser` → Zod → repository. GET flags: `includeProjection`, `includeCorrelated`, `includeHealthSummary`, `includeVectorMaturity`. POST actions: `run`, `automate`, `snooze`, `dismiss`, `view` |
| `/api/business-os/insights/[id]` | GET | Marks surfaced as a side effect |
| `/api/business-os/channel-insights{,/connect,/connections,/sync}` | — | Channel provider connect + sync |
| `/api/cron/insight-metrics` | GET | Daily `0 3 * * *` |
| `/api/cron/insight-detect` | GET | Every 15 min `*/15 * * * *` |
| `/api/cron/insight-automations` | GET | Every 5 min `*/5 * * * *` |
| `/api/cron/channel-metrics-sync` | GET | Hourly `30 * * * *` |

Schedules are in `vercel.json`.

### UI

`app/business-os/page.tsx` is the only renderer. `hooks/useInsights.ts` is the only data hook (consumed by `LiveDashboard` and `VectorsStrip`).

| Component | Lines |
|---|---|
| `LiveDashboard.tsx` | 1,499 |
| `ChannelsCard.tsx` | 1,094 |
| `InsightAdvisorCard.tsx` | 924 |
| `FunnelDrawer.tsx` / `FunnelMap.tsx` | 600 / 595 |
| `ChannelSourcesSection.tsx` | 596 |
| `OperationalStatusCard.tsx` / `SystemReadiness.tsx` | 460 / 454 |
| `InsightDetailModal.tsx` | 395 |
| plus `FooterReplay`, `VectorsStrip`, `ChannelsOverviewCard`, `TipsStepper`, `FirstLightMilestones`, `BeforeAfterPanel`, `HandledSection`, `VerdictCard` | — |

---

## 3. Data model

These six tables are **absent from [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md)**. Columns below are transcribed from migration bodies — which is **not** proof they exist in the live database; see [hazard H6](#11-known-state--hazards) and run `npm run schema:check`.

### `insights`

**File:** `supabase/migrations/20260801_create_insights.sql` (+ `20260805_add_correlated_insights.sql`)

| Group | Columns |
|---|---|
| Identity | `id`, `user_id`, `detector_id`, `detection_run_id` |
| Classification | `category`, `severity` (`low`/`medium`/`high`/`critical`) |
| Content | `title`, `description`, `business_impact`, `recommendation` |
| Metric | `metric_key`, `current_value`, `baseline_value`, `threshold_value`, `percent_change`, `direction` |
| Entities | `affected_entity_type`, `affected_entity_ids UUID[]`, `affected_count` |
| Money | `estimated_impact_usd`, `impact_direction` (`loss`/`opportunity`/`savings`), `impact_period` |
| Action | `paired_process_id`, `process_parameters JSONB`, `eligible_for_automation` |
| Ranking | `priority_score` |
| Lifecycle | `status` (`new`/`viewed`/`snoozed`/`dismissed`/`acted`/`automated`), `snoozed_until`, `dismissed_at`, `dismiss_reason`, `acted_at`, `action_execution_id` |
| Surfacing | `last_surfaced_at`, `surface_count` |
| Correlation (added 2026-08-05) | `is_correlated`, `correlation_parent_id`, `correlation_pattern_id`, `contributing_insight_ids UUID[]`, `total_correlated_impact_usd`, `story` |
| Trend | `trend_direction` (`improving`/`stable`/`worsening`), `trend_percent_change`, `previous_week_value` |
| i18n | `language` (default `'en'`) |
| Timestamps | `detected_at`, `created_at`, `updated_at` |

> ⚠️ **`estimated_impact_usd` is misnamed.** Detectors write the business's own currency into it, whatever that is. The repository formats it with the business's currency symbol on read. Never treat the value as USD, and never hardcode a currency symbol in a template.

### `business_events`

**File:** `supabase/migrations/20260801_create_business_events.sql`

`id`, `user_id`, `event_type`, `category`, `entity_type`, `entity_id`, `contact_id` → `crm_contacts`, `session_id`, `value_usd`, `value_delta`, `metadata JSONB`, `source_capability`, `created_at`. RLS enabled. Indexed on `(user_id, created_at DESC)`, category, type, contact, entity.

### `derived_metrics`

**File:** `supabase/migrations/20260801_create_derived_metrics.sql`

`id`, `user_id`, `metric_key`, `period_type`, `period_start`, `period_end`, `value`, `unit`, `baseline_value`, `baseline_period`, `percent_change`, `sample_size`, `std_deviation`, `breakdown JSONB`, `computed_at`. **`UNIQUE(user_id, metric_key, period_type, period_start)`** — upserts key on this.

### `insight_automations`, `owner_insight_history`, `business_health_summaries`

| Table | File | Purpose |
|---|---|---|
| `insight_automations` | `20260801_create_insight_automations.sql` | Standing automations. Also the source for the "first automation handed over" journey anchor |
| `owner_insight_history` | `20260801_create_insights.sql` | `action`, `detector_id`, `time_to_action_seconds`, `was_helpful` — the learning signal |
| `business_health_summaries` | `20260805_add_correlated_insights.sql` | LLM narrative rollup written at the end of each detect run |

### Foreign tables the subsystem reads

`scheduling_bookings` · `crm_contacts` · `crm_activities` · `crm_tasks` · `payment_invoices` · `payment_transactions` · `payment_plan_installments` · `saved_payment_methods` · `stripe_connect_accounts` · `website_pages` · `website_page_views` · `website_blocks` · `business_profiles` · `user_preferences` · `kernel_executions` · `kernel_action_log`

Three of these were routed through repositories by the G2 slice. **~42 self-reads remain direct `.from()`** by deliberate decision — see [roadmap § Insights](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md).

---

## 4. The pipeline

```
 vercel.json cron
        │
   ┌────┴─────────────────────────────────────────────┐
   │ /api/cron/insight-metrics   (daily 03:00)        │
   │   MetricsComputeService + BaselineCalculator     │
   │   → derived_metrics                              │
   └──────────────────────────────────────────────────┘
        │
   ┌────┴─────────────────────────────────────────────┐
   │ /api/cron/insight-detect    (every 15 min)       │
   │                                                  │
   │  1. user discovery — direct .from() scan over    │
   │     payment_invoices, scheduling_bookings,       │
   │     crm_*, business_events  (open item 1.2.c)    │
   │                                                  │
   │  2. FOR EACH user, SERIALLY:            ← H5     │
   │     getUserLocale()                              │
   │     DetectorEngine.runForUser()  → 40 detectors  │
   │     InsightPrioritizer.getTopInsights(…, 10)     │
   │     repository.createBatch()     → LLM prose     │
   │     repository.saveCorrelationResults()          │
   │     repository.createOrUpdateHealthSummary()     │
   │                                       → LLM      │
   └──────────────────────────────────────────────────┘
        │
   ┌────┴─────────────────────────────────────────────┐
   │ /api/cron/insight-automations  (every 5 min)     │
   │   AutomationManager → KernelTrigger → pilot      │
   └──────────────────────────────────────────────────┘
        │
        ▼
   GET /api/business-os/insights  →  useInsights()
        →  LiveDashboard / VectorsStrip  on /business-os
```

**Design rule, still honoured:** Insight **detects and triggers**; the kernel executes. Do not build a process executor here.

---

## 5. The detector contract

**File:** `lib/business-os/insight/detectors/types.ts`

A detector is `{ definition: DetectorDefinition; evaluate(userId): Promise<DetectionResult | null> }`, and in practice extends `BaseDetector`.

`DetectorDefinition` fields:

| Group | Fields |
|---|---|
| Identity | `id` (e.g. `cash_ar_overdue`), `name`, `category`, `description` |
| Signal | `watchedMetrics: MetricKey[]`, `eventTypes?` |
| Threshold | `baselineWindow` (`week`/`month`/`90days`), `thresholdType` (`absolute`/`percent_change`/`std_deviation`), `threshold`, `direction` (`above`/`below`/`either`), `minSamples` |
| Severity | `severityFn(delta, baseline) => InsightSeverity` |
| Action | `pairedProcessId?`, `consentTier` (`observe`/`suggest`/`automate`), `eligibleForAutomation`, `ownerParameters?`, `guardrails?` |
| Cooldown | `cooldownHours` |

Reusable guardrails live in `COMMON_GUARDRAILS`: `max_1_per_invoice_per_7d`, `max_20_per_run`, `quiet_hours` (22:00–08:00), `max_2_per_booking`, `max_1_per_contact_per_48h`, `max_1_per_contact_per_7d`.

`minSamples` is not decoration — it is the guard against firing confident nonsense on a cold-start account. Set it deliberately.

---

## 6. Adding a detector — the registry footprint

A detector is **not** one file. It is one file plus up to eight registries, and nothing fails loudly when you miss one.

| # | File | What to add | Miss it and… |
|---|---|---|---|
| 1 | `detectors/catalog/<Name>Detector.ts` | The detector | — |
| 2 | `detectors/DetectorEngine.ts` | `import` **and** `new <Name>Detector(supabase)` | **It never runs.** This is the real registration point |
| 3 | `detectors/catalog/index.ts` | `export` | Nothing breaks today ([hazard H3](#11-known-state--hazards)) |
| 4 | `repository/InsightRepository.ts` → `detectorDescriptions` | `id: 'plain-language description'` | The LLM gets no context and writes generic prose |
| 5 | `kernel/TriggerableProcesses.ts` | Paired process | No "run it for me" action |
| 6 | `projection/ImpactProjector.ts` | Projection rule | No before/after panel |
| 7 | `correlation/patterns.ts` | Add the id to `requiredDetectors`/`optionalDetectors` | Never participates in a story |
| 8 | `lib/business-os/LanguageContext.tsx` | `insight.*` translation keys | Untranslated English for Hebrew/Spanish users |
| 9 | `components/business-os/insight/InsightAdvisorCard.tsx` | Display mapping, if bespoke | Falls back to generic rendering |

Before writing the query, use the `business-os-schema-check` skill and run `npm run schema:check`. Four detectors are silently dead today because nobody did ([hazard H2](#11-known-state--hazards)).

---

## 7. Vectors & the maturity model

**File:** `repository/InsightRepository.ts` — `VECTOR_THRESHOLDS`, `getVectorMaturity()`

Seven vectors, each `dark` → `learn` → `lit`. A vector lights only when enough data exists to say something honest.

| Vector | Threshold | Metric | Rationale (from code) |
|---|---|---|---|
| `wins` | 1 | `positive_events` | Lights immediately on any good news |
| `ops` | 1 | `total_bookings` | Need at least one booking to understand your calendar |
| `cash` | 1 | `total_invoices` | Starts watching when you have invoices to track |
| `leads` | 10 | `total_contacts` | Need some leads to spot patterns |
| `conv` | 25 | `total_visitors` | ~25 visitors before the conversion rate is trustworthy |
| `price` | 42 | `days_with_bookings` | Pricing needs six weeks of calendar |
| `ret` | 60 | `days_with_clients` | Retention needs clients old enough to lapse |

Account maturity rolls up as `cold_start` → `early` → `running` → `mature`.

Two properties worth preserving when you touch this:

- **Vectors are anchored to events, not to signup.** `days_with_clients` counts from the first client, not from account creation — because re-running onboarding recreates `business_profiles` and resets account age.
- **Notes are returned as `noteKey` translation keys, not English prose.** `note` remains only as a fallback for un-migrated callers. Server-side English assembly was a bug: there is no reader on the server to have a language.

---

## 8. The correlation engine

**Files:** `correlation/{InsightCorrelationEngine,patterns,types}.ts`

**10 patterns** in `CORRELATION_PATTERNS`, each declaring `requiredDetectors`, optional reinforcing detectors, `minMatches`, a `storyTemplate`, an `actionTemplate`, a `severityBoost` and a `priority`. When enough required detectors fire together, the individual signals are replaced by one `CorrelatedInsight` carrying the combined story and summed impact; everything unmatched passes through as `standaloneInsights`.

Categories: `funnel` · `revenue` · `retention` · `pipeline` · `capacity` · `service`. Highest-priority patterns are `funnel_breakdown` (100) and `revenue_at_risk` (95).

> ⚠️ `storyTemplate` strings are **hardcoded English and contain a literal currency symbol** (`Total exposure: ${total_impact}.`). This contradicts the repository's careful currency and i18n handling elsewhere — an Israeli business can be shown a dollar figure through this path. Treat it as a known defect, not as the pattern to copy.

---

## 9. Journey timeline & funnel gap

Both are **pure, dependency-free modules** with unusually good header comments. Read the headers before changing either — they document what the previous implementation got wrong and why.

**`journeyTimeline.ts`** — replaced five fixed calendar nodes (day 1/4/18/60/90 off `now − created_at`) with event-anchored nodes in three states:

| State | Meaning |
|---|---|
| `reached` | It happened. The date is the record; the day number is arithmetic on it |
| `counting` | The anchor exists, so the unlock date is **computable** (`first booking + 42 days`) — not predicted |
| `waiting` | No anchor, so **no date is offered at all**. It names the condition and stops |

Anchors come from `JourneyAnchors`: `accountCreatedAt`, `firstBookingAt`, `firstClientAt`, `convCrossedAt`, `firstAutomationAt`. `convCrossedAt` is the only one that must be read rather than derived — no arithmetic predicts when a 25th visitor arrives.

**`funnelGap.ts`** — `resolveGap(from, to, isLive)` returns a verdict, never a sentence; the component owns the wording. Verdicts: `setup`, `incomparable`, `empty`, `tooEarly`, `healthy`, `watching`, `leaking{dropped}`. `incomparable` exists because the old code computed a conversion rate between two numbers covering different periods (30 days of visitors against an all-time pipeline). `MIN_TO_JUDGE = 5`.

---

## 10. Channel insights

Provider config is **data, not branches** (`CHANNEL_PROVIDERS`): adding a provider is one entry plus a plugin, and the connect route, readiness chips and settings list all stay in step. Preserve that property.

Visit resolution (`resolveVisits.ts`) reconciles four surfaces — `website`, `landing`, `smart_links`, `analytics` — into `VisitsByChannel`, with `ga4CoversHost()` deciding whether GA4 already counts a hosted domain (the double-count guard).

---

## 11. Known state & hazards

Every item below was verified against `main` on 2026-09-11.

| # | Hazard | Evidence | Consequence |
|---|---|---|---|
| **H1** | ~~**`business_events` has no emitters.**~~ **Corrected 2026-09-23** — real emitters exist: `SchedulingRepository`, `PaymentEventService`, `BookingLifecycleService`, `LeadAlertService` and the payment reaction path all write canonical dotted events (`booking.completed`, `enquiry.received`, `form.submitted`) | 22 canonical events live, across 3 accounts | The rail is **partial, not dead**: only some verbs are emitted, so an event-sourced metric like `operations.calendar_utilization` (`calendar.slot_filled`) still computes to `value: 0, sampleSize: 0` — which is why `ops_utilization_low` was rewritten to measure the calendar directly. ⚠️ Until 2026-09-23 the table also held **210 rows of seed data** written into two live accounts by `scripts/seed-insight-test-data.ts`, under non-canonical names (`booking_created`) that no emitter produces. Purged; the script now refuses a non-local database, an unnamed user and a missing `--yes-seed-fake-data` flag. **Updated 2026-10-06** — the money spine now emits too: `payment.completed`, `refund.completed`, `invoice.created`, `invoice.paid`, `invoice.overdue`, `proposal.sent`, `proposal.accepted`, `proposal.rejected` and `booking.created`, all through `events/recordEvent.ts` (fire-and-forget, so the rail can never fail a payment or a booking). `scripts/backfill-business-events.ts` reconstructs every one of them from the module tables' own timestamps and is idempotent, so history does not have to be waited for and a dropped event is repaired by re-running it. ⚠️ The backfill **inserts directly** rather than calling `emit`, because `emit` deliberately omits `created_at` so the column default stamps `now()` — correct for recording that something is happening, and fatal for a backfill. The `business-os-insights` skill's rule 6 said "`business_events` has no emitters"; it was corrected in place on 2026-10-06 and now tells the reader to check the table |
| **H2** | ~~**Three detectors query a table or columns that do not exist.**~~ **Closed 2026-09-23** | — | `WebMobileIssues` and `WebPageUnderperform` were rebuilt as `web_mobile_conversion_gap` and `web_page_no_conversions`, both against real columns. `PricingDiscountAbuse`'s phantom `scheduling_bookings.metadata` half was removed; it remains **dark for a different reason** — no discount feature writes a discount anywhere. `cash_cards_expiring` is likewise dark until card expiry is synced from Stripe Connect. Both are registered with headers naming exactly what would light them |
| **H3** | ~~**`catalog/index.ts` exports 7 of 28 detectors.**~~ **Closed 2026-10-06 by DELETING the barrel** | it had drifted again to 42 of 46 | Closed once in 2026-09 by bringing the barrel up to 37/37, and it drifted straight back, because `DetectorEngine` imports every detector directly and nothing ever read the barrel. A registry nobody reads cannot be kept correct, so it is gone. **`new *Detector(` in `DetectorEngine.ts` is the only census that counts.** ⚠️ Deleting it broke `detectors/index.ts`, which still had `export * from './catalog'` — and `app/api/cron/insight-detect/route.ts` imports `DetectorEngine` **through that barrel**, so the insight cron would not have compiled. Jest never saw it (it strips types); a scoped `tsc` did. The re-export is removed, with a comment saying why it must not come back |
| **H4** | ~~**The three insight crons fail OPEN.**~~ **Closed 2026-09-23** — all four now fail closed | `insight-detect`, `insight-metrics`, `insight-automations`, `insight-actions` | A missing `CRON_SECRET` in production now refuses. `payment-reminders` demonstrably sending in production was the evidence the secret is configured and closing them costs nothing |
| **H5** | **`insight-detect` loops users serially with LLM calls inside the loop** — now bounded | `for (const [index, userId] of userIds.entries())` | Partly mitigated 2026-09-23: `runtime = 'nodejs'`, `maxDuration = 300`, and a `RUN_BUDGET_MS` that stops starting new businesses at 240s and reports `usersRemaining` rather than being killed mid-business. Still no batching cursor or concurrency — a growing `usersRemaining` is the signal that the schedule can no longer keep up |
| **H6** | **58 migrations from the reports/readiness merge are not applied.** The merge deliberately did not apply them and the decision is still open | [reports merge requirement](/docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md) | Some 2026-09 insight code may be dark in production. **Never infer a column exists from a migration file** — run `npm run schema:check` |
| **H7** | **Two `InsightRepository` classes.** See [§1](#1-scope--the-name-collision) | — | Importing the wrong one compiles and then misbehaves |
| **H8** | ~~**Correlation story templates are hardcoded English with a literal currency symbol.**~~ **Currency fixed 2026-09-23** | `correlation/patterns.ts` | The literal `$` before an already-localised symbol is gone (it rendered `Total exposure: $₪12,340`), and the correlation currency now comes from `scheduling_services.currency` rather than from the interface language — one live account bills in ILS with an English interface and was being shown USD. **The English-prose half is closed 2026-10-07**, and it was four leaks rather than the one this row described. `patterns.ts` still holds English `storyTemplate` / `patternName` / `actionTemplate` — correctly, since they are the English copy — but nothing localised reaches for them any more: **(1)** the Hebrew `funnel_breakdown` story interpolated `${correlatedInsight.story}`, producing a Hebrew sentence with an English one welded on; **(2)** the Hebrew default was `patternStories[id] || correlatedInsight.story`, so every pattern added to `patterns.ts` without a matching Hebrew line leaked — and the two files are always edited separately; **(3)** there was **no Spanish branch at all**, so Spanish businesses got English; **(4)** on the LLM path `parsed.story || correlatedInsight.story` leaked whenever the model returned well-formed JSON with a field missing, which a `JSON.parse` cannot catch — it now fills from the localised fallback. Note the whole fallback only runs when the `correlated_insight` area is off or its call fails, i.e. exactly when the owner can least shrug it off. Pinned by `repository/__tests__/correlatedFallbackLanguage.guard.test.ts`, which asserts on SOURCE because the leak is a shape (`|| correlatedInsight.story`) rather than a value |
| **H9** | ~~**Vector types are duplicated across the client boundary.**~~ **Closed 2026-10-07 — and they HAD drifted** | declared in both `InsightRepository.ts` and `hooks/useInsights.ts` | The copies existed because a `'use client'` hook cannot import a repository. By the time anyone compared them the client's `VectorStatus` was **missing `also`**, the volume clause the server had been sending all along, so client code wanting it had to cast. `VectorKey`, `VectorState`, `MaturityLevel` and `VectorStatus` now live in `insight/vectorTypes.ts` — a file with **no imports at all**, so reaching it does not reach the server — and both sides re-export from it, keeping every existing importer working. `VectorMaturityData` stays declared twice **on purpose**: the server always computes `journeyAnchors`, while the wire shape makes it optional for responses cached before anchors shipped. That difference is real, and collapsing it would either weaken the server's guarantee or lie about old payloads |
| **H10** | **`detectorDescriptions` is a hardcoded map inside the repository** — but the failure mode is **guarded** | `InsightRepository.ts`; `repository/__tests__/detectorCopy.guard.test.ts` | The original risk ("a new detector gets generic LLM prose until it is added here") is closed: the copy guard asserts every registered detector has an entry, and it is currently 46 for 46. What remains is structural, not a live defect — the map sits inside a 2,600-line repository rather than beside the detector that needs it, so adding a detector still means editing a distant file. Verified 2026-10-07 |
| **H11** | ~~**One AI usage group id spanned every business in a detection run.**~~ **Closed 2026-09-25 — cut-over date, see below** | `insight-detect/route.ts` minted `runId` once per run, outside the per-business loop, and passed it as `runAiAction`'s `groupId` for every business | The group id becomes both `token_usage.session_id` and the `ai_action` audit entry's `entity_id`, so one value spanned N tenants: any consumer grouping AI spend by that id alone merged several businesses' cost, and `audit_trail` was not unique on `(entity_type, entity_id)` across tenants for this area. `validateIdentities` does not catch it — a shared-but-valid UUID passes. Fixed by minting a fresh `crypto.randomUUID()` **inside** the loop and threading `InsightRunIds { runId, groupId }` through nine `InsightRepository` signatures, so `detection_run_id` keeps the run id while every `buildBosCallContext` takes the per-business group. **No backfill** — see the cut-over note |
| **H12** | ~~**The maturity gate collapsed three vector states into two.**~~ **Closed 2026-10-06** | `DetectorEngine.getDarkVectors` filtered `state === 'dark'` into a `Set` and discarded the rest | `getVectorMaturity` returns `dark` / `learn` / `lit`, where `learn` means **one row of data** (`dataPoints > 0`). The engine skipped only `dark`, so `learn` was treated exactly like `lit`, while `journeyTimeline` read the same data correctly including the `also` volume clause. The owner reported the contradiction directly: the timeline drew the pricing node locked and promised it for **day 52** while a pricing card was already on their dashboard. On that account `price` ran 17 days early (26 of 42 days) and `leads` ran 6 contacts short. Replaced by `claimType` (`instance` / `rate` / `trend` / `pattern`): an `instance` claim runs on `learn`, every inference waits for `lit`, and unreadable maturity now **fails closed** for inference instead of running all 44 detectors. 18 of 44 correctly silenced on the reporting account |
| **H13** | ~~**`ignoresVectorMaturity` was hand-set on 22 of 44 detectors.**~~ **Closed 2026-10-06** | half the catalogue claimed the exemption | The flag was the right idea applied by judgement one file at a time, and four were simply wrong — including `pricing_intro_offer_stuck`, whose metric is `pricing.intro_conversion`, a RATE, exempting itself from the gate that exists for exactly that. It is the detector behind the day-52 report. `ignoresVectorMaturity` is now **derived** (`claimType === 'instance'`) and `effectiveClaimType` defaults an undeclared detector to `rate`, the **strict** side, so forgetting to declare makes a detector quieter rather than louder — the failure mode `minSamples` and this flag both got backwards |
| **H14** | ~~**`crm_contacts.lifecycle_stage` does not exist, and the retention vector was permanently dark for every account.**~~ **Closed 2026-10-06** | `getVectorMaturity` ran `.eq('lifecycle_stage', 'client')` twice | PostgREST rejects the whole select for one unknown name, the error was destructured away, and both reads fell through to their defaults: `clientCount` was `0` and `firstClient` was `null` **platform-wide**, holding `ret` at `dark` silently. Invisible because a dark vector only ever *skips* detectors, and a skipped detector produces no output to look wrong — it surfaced only when H12's fix also held `instance` claims on `dark` and two working retention detectors went quiet. Stages are rows in `crm_pipeline_stages` with a `stage_type`, and the reporting account's are `family_enrolled` / `initial_consultation`. Now resolved through the existing `buildClientStageFilter` (`lib/crm/StageTypeUtils.ts`), already used by `CrmEngagementDecayDetector`. `ret` went `dark 0/60` → `learn 33/60 (3/10 clients)` |
| **H15** | **`minSamples` is enforced on 4 of 46 detectors** — now **pinned and shrinking** | only `AcqTrafficDrop`, `OpsUtilizationLow`, `ToilManualBookingEntry` and `BaseDetector` pass `sampleSize`; `detectors/__tests__/sampleSizeDeclared.guard.test.ts` holds the rest as a named list | `createDetectionResult` checks `sampleSize < minSamples` **only when the detector volunteers `sampleSize`**, which is opt-in — so `minSamples` still looks like a guard on most of the catalogue and guards nothing. ⚠️ **The fix is not "add `sampleSize` to 42 files"**: `effectiveClaimType` defaults an undeclared detector to `rate`, and many are not rates at all. *"These 3 invoices are overdue"* is an **instance** claim with no denominator — one overdue invoice is one overdue invoice at any sample size — so it needs a `claimType`, not a sample. Each file is therefore a reading of what its `currentValue` means, and **the dangerous direction is `instance`**: it lets a detector run on a `learn` vector, so a wrong one is a card on an account with almost no data, the day-52 class of bug (H12). Hence a shrinking allow-list rather than a sweep: a NEW detector cannot join the debt, each removal is a deliberate decision with a test behind it, and the count is a fact somebody can act on. **42 when pinned on 2026-10-07, 36 the same day** — six detectors whose `currentValue` is a count of enumerated entities (`cash_ar_overdue`, `cash_booking_unpaid`, `cash_cards_expiring`, `conv_followup_overdue`, `crm_cold_leads`, `web_link_dead_destination`) classified `instance`, which is what they always were |
| **H16** | ~~**`estimatedImpactUsd: null` was narrated as `₪0`.**~~ **Closed 2026-10-06** | the prompt's `- Estimated impact: ${formatMoney(...)}` line was unconditional | `formatMoney` is `Number(amount) || 0`, so an absent figure and a real zero print identically. The dead-link card was titled "השפעה גבוהה על העסק" (high impact on the business) above a body reading "ההשפעה הכספית היא ₪0" — both halves invented, in opposite directions, from the same missing number, because the model was handed an impact of exactly nothing beside a severity of `high`. `describeImpact` now omits the line unless the figure is genuinely a number, matching `hasRealBaseline` and `describeCurrentValue` |
| **H17** | ~~**`cash_refund_pattern` reported an impossible 275% refund rate.**~~ **Closed 2026-10-06** | `baselineValue: this.definition.threshold` with a `percentChange` measured against it | 275 is the distance from the 5% **policy threshold** to the measured 18.8%, and the narrator had no way to know that, so it printed it as the rate. `hasRealBaseline` already suppresses the change line when the baseline is `0` — a configured constant defeated that guard by being non-zero while measuring nothing. Now `baselineValue: 0`, `percentChange: 0`; `thresholdValue` still carries the policy limit. **The 18.8% itself was correct** (3 refunds of 16 transactions in the 30-day window); only the comparison was invented |

| **H18** | **`process_parameters` is an action-parameter channel and two bespoke reads — NOT a general display path** | `LiveDashboard.tsx:655` passes it as `suggestedParams`; `:1307-1308` read `stage_breakdown` and `avg_days_stuck`; `app/api/business-os/insights/route.ts` uses it for action parameters. `InsightAdvisorCard.tsx:111` and `InsightDetailModal.tsx:83` declare it and never read it | ⚠️ **This row previously said "no component renders it", which was wrong** — written from a grep that caught the type declarations and missed the reads. The accurate hazard is narrower: a detector writing an *arbitrary new key* there and expecting the owner to see it is writing to a dead end, because only those two keys are rendered and everything else owner-facing comes from the narration prompt. `narrationSubject` is the field for anything specific, which is why the segment comparison routes the slice name through it rather than through here. Corrected 2026-10-07 |
| **H19** | **Two detectors can only count volume, not rate** | `RetCancelPattern` filters `.eq('status','cancelled')`; `OpsServicePerformance` filters `.in('status', ['confirmed','completed'])` | Every row they load is the same outcome, so a per-day or per-service count from that data reports which day she works most, not which day goes wrong — the fallacy `patterns/segmentRate.ts` exists to refuse. `RetCancelPattern` now runs a **second** query for the denominator, windowed on `start_time` for both halves (the reason query windows on `updated_at`, and dividing one by the other compares two populations and can exceed 100%). `OpsServicePerformance` **cannot** be fixed this way: different services have different numbers of *opportunities* and nothing records that, so its claim was made descriptive instead. Before 2026-10-06 it also had no per-service floor at all (`bookings > 0`), flagging a service booked **once** against one booked forty times, folded zero-booking services in as failures, and attached money computed as `(average bookings − this service's) × price` |

| **H20** | ~~**An unimplemented snapshot metric stored a fabricated zero.**~~ **Closed 2026-10-06** | `computeSnapshotMetric` implemented one key and ended `return { value: 0, unit, sampleSize: 0 }` | Any other snapshot metric wrote a real `derived_metrics` row claiming the figure was exactly zero, and nothing downstream distinguishes that from a measurement: `BaselineCalculator` averages it into the mean and std dev, `percent_change` is computed against that mean, and the new measurement sweep would read two of them as "did not move". Same family as the `₪0` impact line (H16) and the 275% rate (H17). **Latent, not active** — `cashflow.ar_overdue_usd` is still the only snapshot definition and it has a reader — so it would have fired on the *next* snapshot metric anybody added, which is exactly the change someone makes while giving a detector its missing series. Now returns null, the caller writes no row, and a `warn` names the key. A computed zero is still written: no page views yesterday really is zero page views |
| **H21** | **The metrics engine computes 12 of 79 declared metric keys, and most detector metrics are not event-derivable at all** | `METRIC_DEFINITIONS` holds 12 entries; `MetricKey` declares 79. On the reporting account, **2 of 11** metric keys named by live insights have a series | The engine aggregates `business_events`. Most detector metrics are **states** read from module tables — AR total, clients at risk, held-on-cancelled, service performance — and a state has no event to count, so no definition can be written for it with the current shapes. Until a state can be snapshotted on a schedule, the measurement sweep (20261006g) will honestly record `unmeasurable` for most advice. **Partly closed 2026-10-07** by `metrics/snapshots.ts`, which gives a state metric a reader so it becomes a series: `cashflow.ar_total` and `acquisition.broken_link_destinations`, plus the event-derived `cashflow.refund_rate` and `retention.cancellation_rate`. Four definitions, 12 → 16. **`cashflow.ar_total` refuses to sum across currencies** and returns null — there is no FX rate anywhere in the platform, and the sibling `cashflow.ar_overdue_usd` quietly breaks that rule already (its name says USD and it sums whatever `amount` holds). `acquisition.broken_link_destinations` shares `deadReason` with its detector so the series and the card cannot disagree. ⚠️ Still open: `conversion.pipeline_velocity`, `cashflow.held_on_cancelled` (money, needs the per-currency decision), `operations.service_performance`, `retention.cancel_reason` (categorical — not a number that improves), and `acquisition.unique_visitors` (needs a DISTINCT aggregation the engine has no shape for). ⚠️ `retention.clients_at_risk` was **deliberately not given a reader**: three detectors write that key meaning different things, so the series has no single definition to pick, and inventing one would measure something no card claims |
| **H22** | ~~**`retention.cancellation_rate` has a branch in `computeRateMetric` and no definition.**~~ **Closed 2026-10-07** | the switch case could not be reached | Dead since it was written: `METRIC_DEFINITIONS` never declared the key, so no caller passed it, and the code read as working coverage. Both `booking.cancelled` and `booking.created` are emitted live, so declaring the key cost one entry and turned dead code into a series |

### H11 cut-over — rows written before 2026-09-25

**`(session_id, user_id)` is the correct row key for `token_usage` permanently, not as a stopgap.**

Rows written before the cut-over carry a `session_id` shared across businesses, and there is **no discriminator** in them other than `user_id` — that is precisely why the composite key is required. They are not being rewritten, and should not be:

- Re-minting `session_id` on historical ledger rows would break their correspondence with the `audit_trail` entries whose `entity_id` is the old shared value. Fixing both means rewriting append-only audit evidence, whose whole value is that it was not edited.
- Post-cut-over rows *are* also unique on `session_id` alone, but a query cannot tell the two populations apart except by date, which is fragile and would regress silently.

⚠️ **Correction to an earlier argument.** This was previously justified by `audit_trail.hash` (a tamper-detection column, `supabase/SQL Scripts/create_audit_trail.sql:32`). That argument does **not** hold: `AuditTrailService` only writes the hash when `enableTamperDetection` is set, it defaults to `false` (`lib/services/AuditTrailService.ts:51`) and **nothing in the tree sets it** — so the column is always NULL and there is no hash to invalidate. The no-backfill conclusion stands on the two reasons above. The dormant `hash` column is itself worth knowing about: it looks like tamper protection and currently is not.

---

## 12. Doc map — what to read, what to ignore

### 🟢 Read

| Doc | For |
|---|---|
| **This document** | The as-built map |
| [BUSINESS_OS_INSIGHT_HEART_PLAN.md](/docs/workplans/BUSINESS_OS_INSIGHT_HEART_PLAN.md) | **The standing forward plan.** The six layers, what is built (compare, learn), what is next (state snapshots → declared goal → forecast), and the decisions already taken — including why cohort comparison was rejected. Read it before proposing insight work |
| [BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md § Insights](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md) | Module-shape decisions and open items. ⚠️ says "detectors (5)" — now 28 |
| [business-os-phantom-column-remediation.md](/docs/workplans/business-os-phantom-column-remediation.md) | Live-verified schema findings; **§P3 is the dead web detectors** |
| [BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_ARCHITECTURE.md) + [MIGRATION_PLAN.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md) | Whether and how `business_events` ever gets emitters. **Designed, HELD, not built** |
| [BUSINESS_OS_INSIGHTS_G2_MINIMAL_WORKPLAN.md](/docs/workplans/BUSINESS_OS_INSIGHTS_G2_MINIMAL_WORKPLAN.md) | The only completed insight cycle — good Dev→SA→QA precedent |
| [BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md) | Where the 2026-09 code came from; open defects; the 58 unapplied migrations |
| [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md) | The **foreign** tables detectors read. Contains **no** insight tables — [§3](#3-data-model) fills that gap |

### 🟡 Read for intent, not for facts

[INSIGHT_SYSTEM_PLAN.md](/docs/INSIGHT_SYSTEM_PLAN.md) — the original design (2026-08-01, pre-build). Still the best explanation of **why**: the prioritizer's scoring formula, the detect-and-trigger-don't-rebuild rule, the LLM cost envelope. But §12's file list is partial and §14's "open questions" were answered by the code long ago. It is the `@see` target of almost every file header in the subsystem, which makes it look more current than it is.

### 🔴 Do not use — different system

All seven of these describe **agent shadow insights** ([§1](#1-scope--the-name-collision)). Verified: zero references to `business-os/insight` in any of them. They are dated 2026-06-01, which predates this module's first commit.

**Moved to `docs/archive/` on 2026-09-11**, each carrying a banner naming which system it describes:

`archive/INSIGHT_FIX_BALANCED.md` · `archive/INSIGHT_FIX_PROPOSAL.md` · `archive/INSIGHT_ID_NULL_FIX.md` · `archive/INSIGHT_SYSTEM_FIXES_2026-06-01.md` · `archive/INSIGHT_TABLES_ANALYSIS.md` · `archive/INSIGHT_TYPE_MISMATCH_FOUND.md` · `archive/PHASE_1_DEBUGGING_INSIGHT_LINKING.md`

They remain accurate about the **agent** insight system and are still the right reference if that is what you are working on.

### Skills that apply

| Skill | When |
|---|---|
| `business-os-schema-check` | **Before any detector query.** Verifies column/table names against the live DB |
| `tenant-isolation-guard` | Any `supabaseServer` write or cron acting on a caller-supplied id |
| `durable-queue-drain` | If the automation drain is ever reworked into a proper queue |
| `new-repository` | New repository classes |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-06 | The advisor finds out whether its advice helped (H20, H21, H22) | **The loop that was never closed.** The module has always recorded the figure that made a card fire (`insights.metric_key` + `current_value` + `direction`) and whether the owner acted (`owner_insight_history`), then never looked again. `insight_measurements` (20261006g) holds one re-reading of that metric at 30 and 90 days, with `judgeMovement` deciding whether it got better. **Improvement has no fixed sign** — `ret_no_show_spike` fired because a rate was too HIGH and `ops_utilization_low` because one was too LOW — so `direction` is copied onto every row and a hardcoded "down is better" would teach the loop to suppress the advice that worked. **Dismissed insights are measured too, as the control group:** advice followed by improvement no more often than advice that was ignored is advice worth retiring. **The trap avoided:** `insights.current_value` is the obvious "before" and is wrong — detectors compute their own numbers while `derived_metrics` holds a separately computed series under the same key, so both readings come from `derived_metrics` or the row is `unmeasurable`. **`OutcomeRepository` could not be used**: `public.insight_outcomes` DOES NOT EXIST (no migration creates it; a live probe returned `42P01`), and that repository belongs to the AGENT system — so the agent side's outcome tracking is dead too. Hence a distinct table name, per skill rule 1. **Found while measuring the result:** only 2 of 11 live insight metric keys have a series at all (H21), because the engine aggregates events and most detector metrics are states; `cashflow.refund_rate` was added as the one genuinely event-derivable gap. **Fixed on the way:** `insight-hypotheses` had been scheduled in `vercel.json` with no registry row and no run recorder — two tests failing on `HEAD` — and two type errors this session's event work had introduced into `SchedulingRepository`. **Wired 2026-10-07** once the migration was applied: `insight-measure` runs daily at 04:55 (after `insight-metrics` at 03:00, whose series it reads, and on a minute no other job holds). Verified read-only against live data at a simulated zero horizon — the metric with no series returned `unmeasurable` and `cashflow.ar_overdue_usd` read 1300 → 1300 and returned `unchanged`. Nothing is due for real until ~2026-11-05: the one acted and one dismissed insight on the account are days old, and the horizon is 30 |
| 2026-10-06 | Cards start comparing one part of the business to another (H3, H18, H19) | **The audit behind it:** 46 detectors run, 18 maturity-gated, 3 fire, 0 throw — and **35 of 46 use an absolute threshold**, reporting a STATE the owner can read off her own screens rather than a CHANGE. The cause is structural: nothing in the module compared anything to anything. Comparing a business to its PEERS was designed and then **rejected as a product** — no account's data informs another's, aggregated or not — so the reference is internal: her days, her services, her channels. `patterns/segmentRate.ts` is the result. Its single rule is **compare rates, never volumes** ("Thursday has more bookings" only means she works Thursdays), enforced by the signature rather than a check: the `isHit` predicate is required, so there is no bare-count mode, and a caller passing `() => true` gets an honest `flat` refusal. It returns a discriminated verdict naming each refusal (`tooSmall`, `restTooSmall`, `restZero`, `flat`, …) copying `GapVerdict`, because every silent refusal in this module had been an absence and **an absence cannot be logged**. Applied to `ret_no_show_spike` and `ret_cancel_pattern`, the latter needing its own denominator query (H19). Day-of-week needs the business's zone, so `localWeekdayIn` joins `localHourIn` in `businessDay.ts` and `BaseDetector.resolveBusinessTimezone` returns **null** when nobody has set one — the dimension is dropped rather than guessed, because a 01:00 Jerusalem booking is the previous day in UTC. **Caught before shipping:** the comparison withholds the raw segment key, correctly, and a comment claimed the card would name the slice from `process_parameters` — which no component reads (H18). Routed through `narrationSubject` instead, and an unresolvable name drops the whole comparison rather than printing a UUID. **The live bug fixed on the way:** `ops_service_performance` compared raw volume with `bookings > 0` as its only floor, so a service booked **once** was reported as underperforming against one booked forty times; it also flagged zero-booking services as failures and attached invented money. **Found only by a scoped `tsc`** (jest strips types, and a full-project run OOMs on this machine and exits with a crash trace that reads like success): the deleted catalog barrel was still re-exported by `detectors/index.ts`, through which the insight cron imports `DetectorEngine` — the cron would not have compiled. Plus three stale definition fields. **Deliberately not done:** `conv_source_underperform` stays hand-rolled — it reports the SET of below-average sources while `outlierSegment` returns the single highest-rate one, so moving it is a behaviour change, not a refactor |
| 2026-10-06 | The cards start obeying the maturity the timeline already drew (H12-H17) | **Reported as "day 52":** the journey timeline showed the pricing node locked and promised for day 52 while a pricing card was already on the dashboard. `getVectorMaturity` computes three states and `learn` means ONE ROW (`dataPoints > 0`); `DetectorEngine` skipped only `dark`, so `learn` was treated exactly like `lit` and the three-state machine collapsed to two at the only place that gates anything. `journeyTimeline` read the same data correctly, including the `also` volume clause, which is where day 52 comes from — the timeline honoured the threshold and the engine honoured `> 0`. Replaced by a required-in-spirit `claimType` (`instance` / `rate` / `trend` / `pattern`) with `effectiveClaimType` deriving the old `ignoresVectorMaturity` flag and defaulting an undeclared detector to the **strict** side, so forgetting to declare makes a detector quieter rather than louder. Four detectors' hand-set exemptions were wrong, `pricing_intro_offer_stuck` among them — a conversion RATE exempting itself from the gate that exists for rates. The gate now **fails closed** for inference when maturity is unreadable, where it previously ran all 44. **Found along the way and worse than the reported bug:** `crm_contacts.lifecycle_stage` does not exist, so `getVectorMaturity`'s two client reads were rejected whole by PostgREST, destructured their errors away, and returned `clientCount: 0` for EVERY ACCOUNT on the platform — the retention vector had been permanently dark and silently, visible only once `instance` claims were also held on `dark` and two working detectors went quiet. Fixed by reusing `buildClientStageFilter`. Two narration bugs closed with it: a null `estimatedImpactUsd` printed as `₪0` beside a `high` severity (the dead-link card said both "high impact" and "₪0"), and `cash_refund_pattern`'s impossible 275% rate, which was the distance from its 5% policy threshold passed off as a measured baseline. **Deliberately not done:** the `currentValueUnit` and `sampleSize` sweeps across the remaining ~40 detectors (H15) — display polish on a pre-production system, and the vector gate now covers the same ground more coarsely. 18 of 44 detectors correctly silenced on the reporting account; 1,877 tests green |
| 2026-09-25 | The AI usage group becomes per business (H11, F-13) | **Cut-over date for the `token_usage` / `audit_trail` grouping id.** `insight-detect` minted one `runId` per cron RUN and passed it as the `runAiAction` `groupId` for every business, so one `token_usage.session_id` — and one `ai_action` audit `entity_id` — spanned N tenants. A fresh `crypto.randomUUID()` is now minted **inside** the per-business loop, and the two jobs the single value was doing are separated into `InsightRunIds { runId, groupId }`, threaded through nine `InsightRepository` signatures: `runId` still feeds the five `detection_run_id` writes (run-level by design, so two businesses in one run SHARE it), while all three `buildBosCallContext` sites take `groupId`. The sharing that had to be preserved is the sharing *within* one business — its insight, correlated-insight and health-summary calls still land in one group and produce ONE audit entry, so the fix is not a fragmentation into three. An object rather than two strings because a transposition between two `string`s compiles and then fails **silently**: `usageScope.notifyUsage` drops a call whose `sessionId` differs from the open scope's `groupId`, increments `excluded`, logs one `warn` and never throws — and an action left with zero counted calls writes no audit entry at all. A deterministic UUID v5 of `(runId, userId)` was considered and rejected: nothing re-derives it, and it would make a business's insight rows derivable from an admin row. **Rows before this date keep the shared id and are not backfilled** — see the H11 cut-over note. Also fixed: the existing test suite asserted the defect (`entityId: runId` for both businesses) and its mock fed the run id straight to `buildBosCallContext`, which would have manufactured the silent failure |
| 2026-09-23 | A standing meeting reminder, and the insight that stands down for it | **Phase 3 (part).** Nothing on the platform told anyone anything before an appointment unless the no-show or cancellation detectors happened to fire, which made the only reminder a business ever got a consequence of already having a problem. `remind_about_meeting` is a fourth card-activated automation on the gap registry: on, every confirmed appointment gets a reminder at a lead time the owner picks (1/2/3 hours, the day before, two days), to the client, the owner, or both. It is the first automation with a shape beyond on/off, so `/api/business-os/gaps` returns its settings alongside `enabled`/`declined` and the advisor card renders three controls instead of one toggle. It is offered only to a business with a bookable service (`requires: 'takes_bookings'`), the same reasoning that hid the intake chase from businesses with no published form. **The collision is closed at both ends**: `InsightActionDispatchService.bookingReminder` stands down while the card is on, AND for any booking the standing reminder already has a queue row for — so an owner who switches the card off does not get a second reminder sent to a client who already had one. The reminder runs on a **second clock**: `timing: 'before_event'` counts BACKWARD from the appointment by the owner's lead time, where every automation before it counted forward from the moment something got stuck; `whenDue` (now its own pure module, `lib/business-os/gaps/whenDue.ts`) holds both and returns null rather than guessing when either is unreadable. Two root fixes came with it — the dispatcher's `KIND_FOR` map duplicated the registry's `kind` field in a **different vocabulary that collided on the word "chase"** (`chase_invoices` was `kind: 'chase'`, while a queue row of kind `'chase'` is the lead follow-up and belongs to `reply_to_enquiries`), now one `covers` array per entry with a guard test proving no two automations claim the same kind; and `hasPending` never looked at `status`, so it was renamed `hasRowFor` for the question it actually answers. `20260923_meeting_reminder.sql` adds four columns and extends the `lead_responses.kind` CHECK |
| 2026-09-23 | The weekly summary starts describing the business | **Phase 3 (part).** The health score was a count of our own detections — 80 for a category with no insights, minus a severity penalty each — so an empty account read 81/100 and was told it was doing well, shipping a detector lowered everybody's figure, and the LLM narrative then described the score back to the owner in the language of their trade. Replaced by six **measured rates** (`lib/business-os/insight/health/`), each read from a module table and compared with the SAME business's previous 28 days: invoices paid on time, clients who returned, enquiries that booked, enquiries answered, hours booked against stated availability, visitors who got in touch. No benchmark is involved, because the platform has none — a 31% repeat rate is excellent for one trade and poor for another, and inventing a curve would repeat the class of fabrication Phases 1 and 2 removed. A category below its minimum sample reports **null, which means "not enough to say" and must never render as zero**; pricing reports `not_measurable` because nothing records a discount. The narrative prompt now receives the rates AND the list of what could not be measured, with explicit rules against inventing a benchmark or calling an unmeasured category fine. Everything the weekly summary computes — a 750-character narrative, three typed highlights, ranked priorities, the per-category figures — had been written to the database and **only `summary_title` ever reached a screen**; `WeeklySummaryCard` now shows the rest, with each rate carrying its sample size so a 50%-from-two is distinguishable from a 50%-from-two-hundred. `20260923_health_measures.sql` adds `health_measures JSONB`; the write degrades to the legacy shape if it has not been applied, the same guard `findActive` carries for `resolved_at` |
| 2026-09-23 | Insights made honest, and guarded so it stays that way | **Phase 1 — correctness.** An insight vanished the first time it was read (`findActive` asked for `status = 'new'` while the advisor card stamps `viewed`); `viewed` is now open, defined once in `OPEN_STATUSES`. `ops_utilization_low` never read a calendar — it took a metric computed from an unemitted event, always `value: 0, sampleSize: 0`, with a hardcoded `50` baseline and a 40-hour week — and now measures booked hours against the owner's own availability, reporting nothing where availability is unset. Seven further invented figures removed (`\|\| '75'` ×2, `avgRecurringValue = 150`, `avgDealValue = 500`, `* 0.2` ×2, per-severity pricing); where a price is knowable it now comes from `payment_amount` or `scheduling_services.price` via `resolveAverageDealValue`. Three detectors rendered a button that always returned 400 (entity-type mismatch, no send effect) — fixed, and the button is now withheld per-run when there is nothing to act on. Three of ten correlation patterns were structurally unmatchable (one required detector, `minMatches: 2`). Correlation currency came from interface LANGUAGE, not billing — one live account bills ILS in English. Four detectors read `crm_contacts` unscoped under the service role. The dedupe key collapsed five distinct conversion findings into one, discarding four with no row and no trace. All four crons now fail closed. **Phase 2 — enforcement.** `minSamples` was declared 40 times and read zero times; `createDetectionResult` now enforces it via an optional `sampleSize`, and centrally corrects a percentage reported against no baseline and an impossible money figure. Four guards added (`noInventedFigures`, `actionContract`, `patterns`, `detectorCopy`) plus an exact detector census replacing a `>= 25` floor that would have missed fifteen lost registrations — the copy guard immediately caught two restored detectors with no localized text at all. `npm run insight:dry-run` runs all 40 detectors against every real account and caught two bugs no unit test could. 210 seeded `business_events` and 52 derived metrics purged from two live accounts; the seed script now refuses a non-local database, an unnamed user and a missing confirmation flag |
| 2026-09-18 | Smart links get detectors; landing pages stop being judged like home pages | The catalog read `website_pages` and `website_page_views` and **nothing at all** read `smart_links` or `smart_link_clicks`, so a link an owner actually shares was the one surface with no coverage. Added `web_link_dead_destination` (an active link whose destination cannot resolve for anyone else: loopback, RFC 1918, a placeholder domain — no network call, judged from the address) and `web_link_not_converting` (real clicks, no booking behind any of them, windowed from the date click→booking attribution began). Ran against live data on first build: **all three accounts holding a smart link had a broken destination**, 25 clicks in total to `localhost` or `example.invalid`. Separately, `web_page_no_conversions` was matching a home page on its slug, which never appears in its own root URL, so a converting home page read as converting nobody; home pages now match the site root, and landing pages carry a lower visitor floor (20 vs 40) and one severity step more, because the enquiry is the only thing they exist for. `web_missing_cta`'s `percentChange: 100` removed — same fabricated-statistic class as the earlier sweep. Detector count 28 → 37; H3 closed |
| 2026-09-17 | LLM usage attribution | Insight LLM calls attributed to the business analysed, grouped by `runId` (Business OS LLM Call Attribution Layer 1). |
| 2026-09-11 | Created | First as-built map of the Insights module, written from code at `main` @ `d3312431`. Establishes the §1 name-collision fence, documents the six insight tables missing from BUSINESS_OS_DATA_MODEL.md, maps the 2026-08-26→09-07 additions (correlation, journey timeline, funnel gap, vertical config, channel insights) that had no documentation, and records ten verified hazards. |
