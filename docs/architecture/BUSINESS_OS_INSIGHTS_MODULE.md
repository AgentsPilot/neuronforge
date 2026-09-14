# Business OS — Insights Module (as-merged into `main`)

> **Last Updated**: 2026-09-11
> **Verified against**: `main` @ `d3312431` (local == `origin/main`, 0 ahead / 0 behind)

## Overview

The Insights module is the advisory intelligence layer of Business OS. On a cron cadence it computes metrics, runs a catalog of **28 detectors** over the owner's business data, correlates the signals that fire into higher-order stories, prioritizes them, persists them as `insights` rows with LLM-localized prose, and renders them on the `/business-os` dashboard.

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
| `repository/InsightRepository.ts` | 2,583 | Persistence for `insights`, `owner_insight_history`, `business_health_summaries`, correlation results **plus** the three LLM calls that localize prose, and `getVectorMaturity()` |
| `detectors/DetectorEngine.ts` | 366 | Registers and runs all 28 detectors for one user; invokes the correlation engine |
| `detectors/types.ts` | — | `DetectorDefinition`, `DetectionResult`, `Detector`, severity, guardrails, consent tiers |
| `detectors/catalog/*.ts` | 28 files | One detector each; all extend `BaseDetector` |
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
   │     DetectorEngine.runForUser()  → 28 detectors  │
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
| **H1** | **`business_events` has no emitters.** `BusinessEventService` is imported by exactly one file (`MetricsComputeService`). No CRM, Scheduling, Payments or Website code emits | grep across `lib/`, `app/`, `components/` | Every event-sourced detector and most metrics compute over an **empty table**. Only detectors reading module tables directly fire on real data. **Step 3 (event-driven migration) is what lights this up, and it is HELD** pending an external-provider scoping decision |
| **H2** | **Three detectors query a table or columns that do not exist**, to differing degrees: `WebMobileIssues` — **all four** queries fail (`websites` table does not exist, `website_page_views.visitor_id`, `scheduling_bookings.metadata`/`price`); `WebPageUnderperform` — four of five fail (`websites`, `website_page_views.page_path`, `website_pages.path` → real column is `slug`, `scheduling_bookings.source_url`), only its `crm_contacts` query is sound; `PricingDiscountAbuse` — only its `scheduling_bookings.metadata` half (`payment_transactions.metadata` **does** exist: right column, wrong table) | [phantom-column workplan § P3](/docs/workplans/business-os-phantom-column-remediation.md) | `WebMobileIssues` is guarded by an early `return null`, so it reports "nothing detected" for every user, every run. The other two return partial results that look valid. **Product decision required — rebuild or retire. Do not "fix" by deleting the phantom column**, because these detectors *use* the missing values |
| **H3** | **`catalog/index.ts` exports 7 of 28 detectors.** `DetectorEngine` imports each detector directly and does not use the barrel | 28 registered / 28 files / 7 exported | Harmless today, actively misleading as a census. Every doc that says "5 detectors" derives from this |
| **H4** | **The three insight crons fail OPEN.** A missing `CRON_SECRET` in production logs a warning and **returns `true`** | `insight-detect:83`, `insight-metrics:39`, `insight-automations:34` | These are public URLs; the bearer secret is the only thing distinguishing Vercel from an arbitrary caller. `payment-reminders` was deliberately hardened to fail **closed** with a comment explaining why — the insight crons never got the same treatment. **Copy the payments pattern** |
| **H5** | **`insight-detect` loops users serially with LLM calls inside the loop** | `for (const userId of userIds)` | Vercel function timeout risk as the user base grows. No batching, no concurrency limit, no resume |
| **H6** | **58 migrations from the reports/readiness merge are not applied.** The merge deliberately did not apply them and the decision is still open | [reports merge requirement](/docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md) | Some 2026-09 insight code may be dark in production. **Never infer a column exists from a migration file** — run `npm run schema:check` |
| **H7** | **Two `InsightRepository` classes.** See [§1](#1-scope--the-name-collision) | — | Importing the wrong one compiles and then misbehaves |
| **H8** | **Correlation story templates are hardcoded English with a literal currency symbol** | `correlation/patterns.ts` | Wrong-currency and untranslated output, through the correlated-insight path only |
| **H9** | **Vector types are duplicated across the client boundary.** `VectorKey`/`VectorState`/`MaturityLevel`/`VectorStatus`/`VectorMaturityData` are declared in both `InsightRepository.ts` and `hooks/useInsights.ts` | — | They can drift silently. `VectorsStrip.tsx` imports the server type as `import type` — erased at build, so it is **not** a repository-in-client-component violation |
| **H10** | **`detectorDescriptions` is a hardcoded map inside the repository** | `InsightRepository.ts` | A new detector gets generic LLM prose until it is added here |

---

## 12. Doc map — what to read, what to ignore

### 🟢 Read

| Doc | For |
|---|---|
| **This document** | The as-built map |
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
| 2026-09-11 | Created | First as-built map of the Insights module, written from code at `main` @ `d3312431`. Establishes the §1 name-collision fence, documents the six insight tables missing from BUSINESS_OS_DATA_MODEL.md, maps the 2026-08-26→09-07 additions (correlation, journey timeline, funnel gap, vertical config, channel insights) that had no documentation, and records ten verified hazards. |
