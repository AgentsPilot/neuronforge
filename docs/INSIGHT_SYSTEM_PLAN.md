# AgentPilot Insight System - Implementation Plan

> **Last Updated**: 2026-08-01
> **Status**: Ready for Review

## Executive Summary

The Insight System is the **core advisory intelligence layer** for AgentPilot's AI Business Operating System. It continuously watches all business vectors, detects problems and opportunities, prioritizes what matters, explains findings in plain language with money impact, and pairs every finding with a **recommendation and recommended action** — triggering the existing kernel for execution.

**Key Simplification:** The kernel already has its own scheduling and process engine. Insight simply **detects and triggers** — it doesn't need to build its own process executor.

**Architecture Principles:**
1. **Deterministic core, LLM at edges** — Detection, prioritization, action selection are code. LLM only for phrasing findings and tailoring recommendations (~$15/user/month budget)
2. **Event-sourced** — Unified `business_events` table captures every meaningful action; metrics computed from events
3. **Baseline-relative** — Thresholds compare to the owner's own history with minimum-sample guards
4. **Closed loop** — Detect → Decide → Recommend → Trigger Kernel → Verify (kernel execution emits events that close the loop)
5. **Cost-efficient** — LLM calls batched/cached/templated; daily budget cap per user

**UI Integration:** "What I've Done For You" report integrates into the existing **MyDaySection** component (`storyBeats`) on the Business OS dashboard.

**Builds on existing infrastructure:**
- `PaymentEventService` pattern for event emission
- `lib/pilot/` workflow engine (kernel) for process execution — **we trigger, not rebuild**
- `PaymentAutomationEngine` pattern for standing automations
- `MyDaySection` component for autonomous work reporting

---

## Table of Contents

1. [Unified Funnel Event Schema](#1-unified-funnel-event-schema)
2. [Metrics Layer](#2-metrics-layer)
3. [Detector Catalog](#3-detector-catalog)
4. [Prioritizer](#4-prioritizer)
5. [Kernel Integration](#5-kernel-integration-simplified)
6. [LLM Usage & Cost Strategy](#6-llm-usage--cost-strategy)
7. [Story/Presentation Layer](#7-storypresentation-layer)
8. [Intelligence Roadmap](#8-short-term-vs-long-term-intelligence-roadmap)
9. [Architecture & Data Flow](#9-architecture--data-flow)
10. [Risks & Mitigations](#10-risks--mitigations)
11. [Build Sequencing / MVP](#11-build-sequencing--mvp)
12. [Critical Files Reference](#12-critical-files-reference)
13. [Resolved Questions](#13-resolved-questions)
14. [Remaining Open Questions](#14-remaining-open-questions)
15. [Legacy Insight Code Deprecation](#15-legacy-insight-code-deprecation)

---

## 1. Unified Funnel Event Schema

### New Table: `business_events`

```sql
CREATE TABLE IF NOT EXISTS business_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL,
  category TEXT NOT NULL, -- acquisition, conversion, sales, cash_flow, retention, operations, pricing, seasonality

  entity_type TEXT NOT NULL, -- contact, booking, invoice, service, page, session, proposal
  entity_id UUID NOT NULL,

  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  session_id TEXT,

  value_usd DECIMAL(10, 2),
  value_delta DECIMAL(10, 2),

  metadata JSONB DEFAULT '{}',
  source_capability TEXT NOT NULL, -- scheduling, payments, crm, website, email, kernel

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for time-series queries
CREATE INDEX idx_business_events_user_time ON business_events(user_id, created_at DESC);
CREATE INDEX idx_business_events_category ON business_events(user_id, category, created_at DESC);
CREATE INDEX idx_business_events_type ON business_events(user_id, event_type, created_at DESC);
CREATE INDEX idx_business_events_contact ON business_events(contact_id, created_at DESC);
```

### Event Types by Category

| Category | Event Types | Source Tables |
|----------|-------------|---------------|
| **Acquisition** | `page.viewed`, `page.session_started`, `form.submitted`, `form.abandoned` | `website_page_views` |
| **Conversion** | `contact.created`, `contact.stage_changed`, `lead.qualified` | `crm_contacts` |
| **Sales** | `enquiry.received`, `enquiry.replied`, `enquiry.stalled`, `proposal.sent/viewed/accepted` | `crm_activities` |
| **Cash Flow** | Extends existing `PaymentEventType` + `revenue.recognized`, `ar.aged` | `payment_invoices`, `payment_transactions` |
| **Retention** | `booking.completed`, `booking.no_show`, `booking.cancelled`, `client.rebooking_due`, `client.at_risk`, `client.churned` | `scheduling_bookings` |
| **Operations** | `calendar.slot_filled`, `calendar.utilization_low/high`, `service.created` | `scheduling_services`, `scheduling_bookings` |
| **Pricing** | `pricing.changed`, `discount.applied`, `intro_offer.converted` | `scheduling_services`, `payment_invoices` |

### Implementation: `BusinessEventService`

**File:** `lib/business-os/insight/events/BusinessEventService.ts`

Follows `PaymentEventService` pattern:
- `emit(userId, params)` — single event
- `emitBatch(userId, events)` — bulk insert
- `subscribe(callback)` — subscriber pattern for real-time processing
- `getEvents(userId, options)` — query with filters

### DB Triggers for Auto-Emission

Create triggers on existing tables to emit events automatically:

```sql
-- Example: Emit contact.stage_changed when crm_contacts.stage changes
CREATE OR REPLACE FUNCTION emit_contact_stage_changed()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO business_events (user_id, event_type, category, entity_type, entity_id, contact_id, metadata, source_capability)
    VALUES (NEW.user_id, 'contact.stage_changed', 'conversion', 'contact', NEW.id, NEW.id,
            jsonb_build_object('from_stage', OLD.stage, 'to_stage', NEW.stage), 'crm');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 2. Metrics Layer

### New Table: `derived_metrics`

```sql
CREATE TABLE IF NOT EXISTS derived_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  metric_key TEXT NOT NULL,
  period_type TEXT NOT NULL, -- daily, weekly, monthly
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  value DECIMAL(15, 4) NOT NULL,
  unit TEXT NOT NULL, -- count, usd, percentage, seconds, days

  baseline_value DECIMAL(15, 4),
  baseline_period TEXT,
  percent_change DECIMAL(8, 4),

  sample_size INTEGER NOT NULL,
  std_deviation DECIMAL(15, 4),

  breakdown JSONB, -- e.g., { "monday": 12, "tuesday": 8 }

  computed_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, metric_key, period_type, period_start)
);
```

### Core Metrics (MVP)

| Metric Key | Vector | Aggregation | Schedule |
|------------|--------|-------------|----------|
| `acquisition.page_views` | Acquisition | count of `page.viewed` | Daily |
| `acquisition.form_submissions` | Acquisition | count of `form.submitted` | Daily |
| `conversion.lead_to_client_rate` | Conversion | stage changes / leads | Weekly |
| `sales.avg_reply_time_hours` | Sales | avg `metadata.reply_time_seconds` | Daily |
| `sales.stalled_enquiries` | Sales | count of `enquiry.stalled` | Daily |
| `cashflow.revenue_mtd` | Cash Flow | sum of `payment.completed` | Daily |
| `cashflow.ar_overdue_usd` | Cash Flow | snapshot from `payment_invoices` | Daily |
| `retention.no_show_rate` | Retention | `booking.no_show` / total bookings | Weekly |
| `retention.rebooking_rate` | Retention | contacts with 2+ bookings / total | Monthly |
| `operations.calendar_utilization` | Operations | booked hours / available hours | Weekly |

### Baseline & Threshold Computation

**File:** `lib/business-os/insight/metrics/BaselineCalculator.ts`

```typescript
interface BaselineResult {
  mean: number;
  stdDev: number;
  threshold: number; // 2 * stdDev from mean
  sampleSize: number;
  isSignificant: boolean; // sampleSize >= minSamples
}

async function computeBaseline(
  userId: string,
  metricKey: string,
  lookbackDays: number,
  minSamples: number
): Promise<BaselineResult>
```

**Minimum Sample Guards:**
- 7 days of data for daily metrics
- 4 weeks for weekly metrics
- 3 months for monthly metrics

---

## 3. Detector Catalog

### Detector Definition Interface

**File:** `lib/business-os/insight/detectors/types.ts`

```typescript
interface DetectorDefinition {
  id: string;
  name: string;
  vector: BusinessEventCategory;

  // Signal
  watchedMetrics: string[];
  eventTypes?: BusinessEventType[];

  // Threshold
  baselineWindow: 'week' | 'month' | '90days';
  thresholdType: 'absolute' | 'percent_change' | 'std_deviation';
  threshold: number;
  direction: 'above' | 'below' | 'either';
  minSamples: number;

  // Classification
  severity: (delta: number, baseline: number) => 'critical' | 'high' | 'medium' | 'low';

  // Paired fix
  pairedProcess?: string;
  consentTier: ConsentTier;
  eligibleForStandingAutomation: boolean;
  ownerParameters?: ParameterDefinition[];
  guardrails?: Guardrail[];
}
```

### MVP Detectors (5 for launch)

| ID | Vector | Signal | Threshold | Paired Process | Automatable |
|----|--------|--------|-----------|----------------|-------------|
| `cash_ar_overdue` | Cash Flow | AR > 0 and 7+ days | Absolute | `chase_overdue_invoices` | Yes |
| `ret_no_show_spike` | Retention | No-show rate +2 std dev | Baseline | `send_reminder_sequence` | Yes |
| `sales_stalled` | Sales | Enquiries >48h no reply | Absolute | `send_followup_nudge` | Yes |
| `sales_reply_slow` | Sales | Reply time +2 std dev | Baseline | `draft_reply_templates` | No |
| `ops_utilization_low` | Operations | Utilization <50% | Absolute | None (human advice) | No |

### Full Detector Catalog (Post-MVP)

Additional detectors for later phases:
- `acq_traffic_drop` — Traffic -30% from 7d avg
- `acq_form_conversion_drop` — Form→Lead rate -20%
- `conv_stage_leak` — Stage-to-stage rate -25%
- `cash_ar_concentration` — Top client >40% of AR
- `cash_revenue_drop` — Revenue -20% vs prior MTD
- `ret_rebooking_due` — Days since last booking > avg + 1 std dev
- `ret_churn_risk` — No booking in 60+ days
- `ops_utilization_high` — Utilization >90% (opportunity)
- `price_discount_creep` — Avg discount +10pp
- `price_intro_not_converting` — Intro→Paid <20%
- `season_pattern_detected` — Weekly/monthly autocorrelation
- `season_pace_behind` — MTD pace <80% of forecast

---

## 4. Prioritizer

### Scoring Algorithm

**File:** `lib/business-os/insight/prioritizer/InsightPrioritizer.ts`

```typescript
function calculateScore(detection: DetectionResult, history: OwnerHistory, context: BusinessContext): number {
  // Severity (30%)
  const severityScore = SEVERITY_WEIGHTS[detection.severity] * 30;

  // Money impact (25%)
  const moneyScore = normalizeMoneyImpact(detection.estimatedImpactUsd, context.monthlyRevenue) * 25;

  // Recency (20%)
  const recencyScore = calculateRecencyScore(detection.detectedAt) * 20;

  // Actionability (15%) — higher if kernel process available
  const actionScore = detection.pairedProcess ? 15 : 5;

  // Owner preference (10%) — learned from dismiss/act history
  const prefScore = calculatePreferenceScore(detection.detectorId, history) * 10;

  return severityScore + moneyScore + recencyScore + actionScore + prefScore;
}
```

### Deduplication

If multiple detections relate to the same entity/vector, keep the highest-scored one.

### Cooldowns

- Suppress insights shown in last 24h unless severity escalated
- Track in `owner_insight_history` table

### Output

- **Top 2** for immediate surface (in-app)
- **Next 3** for weekly digest
- **Rest** suppressed until priority changes

---

## 5. Kernel Integration (Simplified)

### Key Insight: Kernel Already Has Scheduling

The existing `lib/pilot/` workflow engine (kernel) already handles:
- Multi-step process execution
- Scheduling and recurring runs
- Plugin execution
- Error handling and retries

**Insight's job is to DETECT and TRIGGER, not to rebuild process execution.**

### Integration Points

```typescript
// File: lib/business-os/insight/kernel/KernelTrigger.ts

interface KernelTriggerRequest {
  processId: string;           // Which kernel process to run
  userId: string;
  triggeredBy: 'insight' | 'automation' | 'user_command';
  insightId?: string;          // Link back to triggering insight
  parameters: Record<string, unknown>;  // User-set or default params
}

interface KernelTriggerResult {
  executionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  summary?: string;            // "Sent 3 payment reminders"
}

/**
 * Triggers an existing kernel process
 * Does NOT build a new executor - uses existing pilot infrastructure
 */
export async function triggerKernelProcess(
  request: KernelTriggerRequest
): Promise<KernelTriggerResult> {
  // 1. Validate process exists in kernel registry
  // 2. Apply guardrails (rate limits, sanity checks)
  // 3. Queue execution via existing kernel scheduler
  // 4. Return execution ID for tracking
}
```

### Process Registry (What Insight Can Trigger)

**File:** `lib/business-os/insight/kernel/TriggerableProcesses.ts`

```typescript
/**
 * Maps insight detectors to kernel processes they can trigger
 * The kernel defines the actual process steps - Insight just triggers
 */
export const DETECTOR_TO_PROCESS: Record<string, TriggerableProcess> = {
  'cash_ar_overdue': {
    processId: 'chase_overdue_invoices',
    processName: 'Chase Overdue Invoices',
    eligibleForAutomation: true,
    ownerParameters: [
      { id: 'days_threshold', label: 'Days Overdue', type: 'number', default: 7 },
      { id: 'tone', label: 'Tone', type: 'select', options: ['friendly', 'professional', 'firm'] },
    ],
    guardrails: ['max_1_per_invoice_per_7d', 'max_20_per_run', 'quiet_hours'],
  },
  'ret_no_show_spike': {
    processId: 'send_reminder_sequence',
    processName: 'Send Booking Reminders',
    eligibleForAutomation: true,
    ownerParameters: [
      { id: 'hours_before', label: 'Hours Before', type: 'number', default: 24 },
    ],
    guardrails: ['max_2_per_booking', 'quiet_hours'],
  },
  'sales_stalled': {
    processId: 'send_followup_nudge',
    processName: 'Follow Up on Stalled Enquiries',
    eligibleForAutomation: true,
    ownerParameters: [
      { id: 'delay_hours', label: 'Delay Hours', type: 'number', default: 48 },
    ],
    guardrails: ['max_1_per_contact_per_48h'],
  },
};
```

### Standing Automations (Kernel Handles Scheduling)

When owner says "automate this", we create a record that the **kernel's existing scheduler** reads:

```sql
CREATE TABLE IF NOT EXISTS insight_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What triggers this
  detector_id TEXT NOT NULL,
  trigger_condition JSONB NOT NULL,  -- { "days_overdue": 7 }

  -- What to run
  kernel_process_id TEXT NOT NULL,
  process_parameters JSONB NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT true,
  paused_at TIMESTAMPTZ,
  pause_reason TEXT,

  -- Stats
  last_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  last_outcome JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Autonomous Work Tracking

Kernel executions already log to `workflow_executions`. We add a view/query that the MyDaySection can read:

**File:** `lib/business-os/insight/reporting/AutonomousWorkFeed.ts`

```typescript
interface AutonomousWorkEntry {
  executionId: string;
  processName: string;
  summary: string;          // "Chased 7 invoices — 2 paid ($680)"
  triggeredBy: 'insight' | 'automation';
  timestamp: string;
  outcome: {
    itemsProcessed: number;
    itemsSucceeded: number;
    itemsFailed: number;
    valueImpact?: number;   // e.g., $680 collected
  };
}

/**
 * Fetches recent kernel actions triggered by Insight/Automations
 * For display in MyDaySection storyBeats
 */
export async function getAutonomousWorkFeed(
  userId: string,
  since: Date
): Promise<AutonomousWorkEntry[]>
```

### Recommendation → Automation Lifecycle

```
[Insight Detected] → [Show in MyDaySection as "Run this for me?" beat]
                                    ↓
        [Owner taps] → [Trigger kernel process (run once)]
                                    ↓
        [Show outcome] → [Offer: "Automate past N days late?"]
                                    ↓
        [Owner sets threshold] → [Create insight_automations record]
                                    ↓
        [Kernel scheduler picks it up] → [Runs when condition recurs]
                                    ↓
        [MyDaySection shows: "Today I chased 7 invoices — 2 paid"]
```

### Guardrails (Applied Before Triggering Kernel)

| Guardrail | Implementation |
|-----------|----------------|
| **Rate limit per entity** | Check `insight_automations.last_run_at` before triggering |
| **Sanity check** | Re-fetch entity state (don't chase already-paid invoice) |
| **Quiet hours** | Delay trigger until 8 AM if outside business hours |
| **Daily volume cap** | Track daily triggers in `insight_automation_runs` |

### Before→After Projection

**File:** `lib/business-os/insight/projection/ImpactProjector.ts`

```typescript
interface ImpactProjection {
  doNothing: {
    summary: string;        // "~$2,840 stays unpaid"
    details: string;        // "~2 hours of manual chasing"
  };
  letMeHandleIt: {
    summary: string;        // "I chase all 7 today"
    details: string;        // "And anything 7+ days late from now on"
    projectedOutcome: {
      cashRecovered?: number;
      timeSaved?: number;    // minutes
    };
  };
  confidence: 'low' | 'medium' | 'high';
  basis: string;            // "Based on 7 eligible invoices and 68% historical collection rate"
}
```

---

## 6. LLM Usage & Cost Strategy

### Three Narrow LLM Use Points

| Use Point | When | Model | Strategy |
|-----------|------|-------|----------|
| **1. Phrasing findings** | Insight card title/description | Claude 4 Sonnet | Cache similar insights, batch daily digest |
| **2. Tailoring recommendations** | Recommendation text | Claude 4 Sonnet | Template + fill, minimal generation |
| **3. Generative step in process** | Email/message drafting | Claude 4 Sonnet | Batch per-run, template fallback |

### Cost Control

**File:** `lib/business-os/insight/kernel/CostController.ts`

```typescript
const DAILY_BUDGET_USD_PER_USER = 0.50; // ~$15/month cap

async function generateWithFallback(
  userId: string,
  prompt: string,
  templateId: string,
  templateVars: Record<string, string>
): Promise<string> {
  if (await checkBudget(userId, estimateTokens(prompt))) {
    return llmGenerate(prompt);
  }
  // Fallback to template
  return renderTemplate(templateId, templateVars);
}
```

### Cost Envelope Estimate

| Cost Type | Per User/Month |
|-----------|----------------|
| Interactive insights | ~$5 (100 insight phrasings) |
| Unattended automation | ~$10 (200 email drafts) |
| **Total** | ~$15/user/month |

---

## 7. Story/Presentation Layer

### Integration with MyDaySection

The "What I've Done For You" report integrates into the **existing MyDaySection** component as `storyBeats`:

**File to modify:** `components/business-os/MyDaySection.tsx`
**Data source:** `/api/business-os/my-day` (extend existing API)

#### New StoryBeat Types for Insight

```typescript
// Extend existing StoryBeat interface
export interface StoryBeat {
  type: 'done' | 'next' | 'run' | 'insight_action' | 'insight_offer';
  titleKey: string;
  titleParams?: Record<string, string | number>;
  subtitleKey: string;
  subtitleParams?: Record<string, string | number>;

  // New fields for insight-triggered actions
  insightId?: string;
  processId?: string;
  actionType?: 'run_once' | 'automate';
}

// Beat styles to add
const BEAT_STYLES = {
  // ... existing styles ...
  insight_action: {
    tagBg: 'rgba(34, 197, 139, 0.13)',
    tagColor: '#128a5e',
    iconBg: 'rgba(34, 197, 139, 0.13)',
    iconColor: '#22C58B',
    Icon: Sparkles  // New icon for insight-triggered
  },
  insight_offer: {
    tagBg: 'rgba(249, 115, 22, 0.12)',
    tagColor: '#F97316',
    iconBg: 'rgba(249, 115, 22, 0.12)',
    iconColor: '#F97316',
    Icon: Lightbulb
  }
};
```

#### MyDaySection Data Flow

```
/api/business-os/my-day
    ↓
Fetches from:
  - Existing booking/payment data (current)
  - NEW: kernel_action_log (autonomous work)
  - NEW: insights table (pending insights to surface)
    ↓
Returns storyBeats[] including:
  - "Done" beats for completed kernel actions ("Chased 7 invoices — 2 paid")
  - "Offer" beats for new insights ("5 invoices overdue — Run this for me?")
    ↓
MyDaySection renders all beats with appropriate styling
```

### Insight Card (for detailed view / modal)

**File:** `components/insight/InsightDetailModal.tsx`

```typescript
interface InsightDetail {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  vector: string;

  title: string;
  description: string;

  moneyImpact?: {
    value: number;
    direction: 'loss' | 'opportunity' | 'savings';
    period: 'weekly' | 'monthly';
  };

  evidence: string[];

  projection?: ImpactProjection;

  actions: InsightAction[];
  status: 'new' | 'viewed' | 'snoozed' | 'dismissed' | 'acted';
}
```

### Four Action Affordances

1. **"Run this for me"** (primary button) — Trigger kernel process once
2. **"Automate this"** (secondary) — Create standing automation with threshold dialog
3. **"Dismiss"** (ghost) — Not relevant, trains prioritizer
4. **"Snooze"** (ghost) — Come back later (1 day, 1 week, custom)

### Before→After Preview (in InsightDetailModal)

Shown when owner clicks an insight offer beat:

```
┌─────────────────────────────────────────────────────────────┐
│ Do nothing                                                  │
│ ~$2,840 stays unpaid                                        │
│ ~2 hours of manual chasing                                  │
├─────────────────────────────────────────────────────────────┤
│ Let me handle it                                            │
│ I chase all 7 today                                         │
│ And anything 7+ days late from now on — you do nothing      │
└─────────────────────────────────────────────────────────────┘
```

### RTL Support (Hebrew)

The existing `MyDaySection` already supports RTL via `useLanguage()`:
- Uses `isRTL` for layout direction
- Translation keys for all text
- Money values remain LTR: `$2,340`

---

## 8. Short-term vs Long-term Intelligence Roadmap

| Data Maturity | Timeline | Capabilities |
|---------------|----------|--------------|
| **Day 1** | Launch | Event instrumentation active, raw counts |
| **Week 1** | 7+ days | Weekly comparisons, 5 core detectors |
| **Month 1** | 30+ days | Monthly trends, baseline-relative thresholds |
| **Quarter 1** | 90+ days | Seasonality detection, churn prediction |
| **Year 1** | 365+ days | YoY comparisons, cohort analysis, forecasting |

### Detector Activation by Maturity

| Detector | Min Data Required |
|----------|-------------------|
| `cash_ar_overdue` | Day 1 (snapshot) |
| `sales_stalled` | Day 1 (snapshot) |
| `ret_no_show_spike` | 4 weeks (baseline) |
| `sales_reply_slow` | 2 weeks (baseline) |
| `ops_utilization_low` | 4 weeks (baseline) |
| `season_pattern_detected` | 12 weeks |
| `season_pace_behind` | 10 days into month |

---

## 9. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BUSINESS OS TABLES                             │
│  (scheduling_bookings, payment_invoices, crm_contacts, website_pages)   │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ DB Triggers
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS EVENTS TABLE                            │
│                     (unified event log, append-only)                    │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ Daily Cron
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          METRICS LAYER                                   │
│            (derived_metrics table, baseline calculator)                  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ 15-min Cron
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DETECTOR ENGINE                                  │
│     (evaluate all detectors, emit DetectionResult[])                    │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PRIORITIZER                                     │
│   (score, dedupe, cooldown → top 2 immediate, next 3 digest)            │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       INSIGHT REPOSITORY                                 │
│               (insights table, owner_insight_history)                   │
└────────────────┬─────────────────────────────────────┬──────────────────┘
                 │                                     │
                 ▼                                     ▼
┌────────────────────────────┐            ┌───────────────────────────────┐
│       UI CARDS             │            │    KERNEL PROCESS EXECUTOR     │
│  (dashboard, notifications)│            │   (execute process steps)      │
└────────────────────────────┘            └───────────────┬───────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │   STANDING AUTOMATION         │
                                          │   SCHEDULER (5-min cron)      │
                                          └───────────────┬───────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────────────┐
                                          │   KERNEL ACTION LOG           │
                                          │ (autonomous work report feed) │
                                          └───────────────────────────────┘
```

### Scheduling

| Task | Frequency | Cron Pattern |
|------|-----------|--------------|
| Metrics computation | Daily 3 AM UTC | `0 3 * * *` |
| Detector evaluation | Every 15 min | `*/15 * * * *` |
| Standing automation check | Every 5 min | `*/5 * * * *` |
| Weekly digest email | Monday 9 AM local | `0 9 * * 1` |

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Small-sample noise** | False positives, alert fatigue | Minimum sample guards (7+ days), confidence language ("possible", not "definitely"), suppress until data threshold |
| **Correlation vs causation** | Owner acts on spurious insight | Frame as "hypothesis" not "diagnosis", show evidence transparently, never say "because of X" |
| **Autonomy blast radius** | Spam clients, damage relationships | Rate limits per entity, max items per run, daily volume cap, quiet hours, sanity check at execution |
| **Stale data failures** | Chase already-paid invoice | Re-fetch entity state at execution time, validate conditions before acting |
| **Owner doesn't understand "automate"** | Surprise when automation runs | Unmissable language: "I'll do this automatically from now on", confirmation dialog, persistent report |
| **LLM cost runaway** | Budget overrun | Daily cap per user, template fallbacks, batch calls |
| **Privacy leakage** | Sensitive data in logs | Metadata-only in action logs, no client PII in insights |

### Autonomy Eligibility Rules

Only these process types may become `standing_automation`:
- `chase_overdue_invoices` — Reversible (another email), clear trigger, owner sets threshold
- `send_reminder_sequence` — Reversible, time-based trigger
- `send_followup_nudge` — Reversible, clear trigger

These are NEVER autonomous:
- Price changes (money impact, not reversible)
- Cancellations (not reversible)
- Anything that creates/deletes data

---

## 11. Build Sequencing / MVP

### Phase 1: Foundation

**Goal:** Event instrumentation active, metrics computing

**New Files:**
- `lib/business-os/insight/events/BusinessEventService.ts`
- `lib/business-os/insight/events/types.ts`
- `lib/business-os/insight/metrics/MetricsComputeService.ts`
- `lib/business-os/insight/metrics/BaselineCalculator.ts`
- `supabase/migrations/YYYYMMDD_create_business_events.sql`
- `supabase/migrations/YYYYMMDD_create_derived_metrics.sql`
- `app/api/cron/insight-metrics/route.ts`

**Modify:**
- Add DB triggers to `scheduling_bookings`, `payment_invoices`, `crm_contacts`, `website_page_views`

### Phase 2: Detection

**Goal:** 5 core detectors firing, prioritizer selecting top 2

**New Files:**
- `lib/business-os/insight/detectors/DetectorEngine.ts`
- `lib/business-os/insight/detectors/catalog/` (5 detector files)
- `lib/business-os/insight/prioritizer/InsightPrioritizer.ts`
- `lib/business-os/insight/repository/InsightRepository.ts`
- `supabase/migrations/YYYYMMDD_create_insights.sql`
- `app/api/cron/insight-detect/route.ts`

### Phase 3: UI Integration

**Goal:** Insights visible in MyDaySection, kernel trigger working

**New Files:**
- `lib/business-os/insight/kernel/KernelTrigger.ts`
- `lib/business-os/insight/kernel/TriggerableProcesses.ts`
- `lib/business-os/insight/reporting/AutonomousWorkFeed.ts`
- `lib/business-os/insight/projection/ImpactProjector.ts`
- `components/insight/InsightDetailModal.tsx`

**Modify:**
- `components/business-os/MyDaySection.tsx` — Add insight beat types
- `app/api/business-os/my-day/route.ts` — Include insights in response
- `lib/business-os/translations/` — Add insight translation keys

### Phase 4: Standing Automations

**Goal:** Owner can automate insights, kernel runs them unattended

**New Files:**
- `supabase/migrations/YYYYMMDD_create_insight_automations.sql`
- `lib/business-os/insight/automation/AutomationManager.ts`
- `components/insight/AutomationDialog.tsx`
- `app/api/insight/automations/route.ts`

**Modify:**
- Kernel scheduler to read from `insight_automations` table

---

## 12. Critical Files Reference

### Existing Files to Extend/Follow Pattern

| File | Purpose |
|------|---------|
| `lib/services/PaymentEventService.ts` | Pattern for BusinessEventService |
| `lib/services/PaymentAutomationEngine.ts` | Pattern for automation trigger logic |
| `lib/pilot/WorkflowPilot.ts` | Kernel to trigger (not rebuild) |
| `lib/pilot/insight/InsightAnalyzer.ts` | Existing insight infrastructure (LEGACY - see Section 15) |
| `components/business-os/MyDaySection.tsx` | UI for autonomous work report |
| `app/api/business-os/my-day/route.ts` | API to extend with insights |

### New Files to Create

| Category | Files |
|----------|-------|
| Events | `lib/business-os/insight/events/BusinessEventService.ts`, `types.ts` |
| Metrics | `lib/business-os/insight/metrics/MetricsComputeService.ts`, `BaselineCalculator.ts` |
| Detectors | `lib/business-os/insight/detectors/DetectorEngine.ts`, `catalog/*.ts` |
| Prioritizer | `lib/business-os/insight/prioritizer/InsightPrioritizer.ts` |
| Kernel Integration | `lib/business-os/insight/kernel/KernelTrigger.ts`, `TriggerableProcesses.ts` |
| Reporting | `lib/business-os/insight/reporting/AutonomousWorkFeed.ts` |
| Projection | `lib/business-os/insight/projection/ImpactProjector.ts` |
| UI | `components/insight/InsightDetailModal.tsx`, `AutomationDialog.tsx` |
| API | `app/api/cron/insight-metrics/route.ts`, `insight-detect/route.ts`, `app/api/insight/automations/route.ts` |
| Migrations | `business_events`, `derived_metrics`, `insights`, `insight_automations` |

---

## 13. Resolved Questions

Based on user feedback:

1. **Kernel integration:** Insight triggers the existing kernel — no need to build process executor
2. **"What I've done" report:** Integrates into MyDaySection `storyBeats` on `/business-os` dashboard
3. **LLM budget:** ~$15/user/month confirmed acceptable
4. **Standing automations:** Phase 4

---

## 14. Remaining Open Questions

1. **Which 5 detectors in MVP?** Proposed: `cash_ar_overdue`, `ret_no_show_spike`, `sales_stalled`, `sales_reply_slow`, `ops_utilization_low`

2. **Default thresholds per vertical?** e.g., `days_late` for therapist vs. coach

3. **Before→after projection confidence level?** Conservative (ranges) vs. optimistic (point estimates)?

4. **Quiet hours default?** 10 PM - 8 AM local — configurable?

5. **Digest email frequency?** Weekly (Monday) — daily option?

---

## 15. Legacy Insight Code Deprecation

### Overview

The existing `lib/pilot/insight/` directory contains **17 files** focused on **workflow execution analysis** — detecting patterns in agent runs (empty results, slow steps, high token usage, etc.). This is a different concern than the new Business OS Insight System, which watches **business vectors** (cash flow, retention, sales, etc.).

**Key Distinction:**
- **Legacy system** (`lib/pilot/insight/`): Analyzes agent workflow execution quality
- **New system** (`lib/business-os/insight/`): Analyzes business health and recommends kernel actions

These are orthogonal systems. The legacy code may still be useful for workflow diagnostics, but should be clearly separated to avoid confusion.

### Legacy Files (17 total)

| File | Purpose | Action |
|------|---------|--------|
| `InsightAnalyzer.ts` | Orchestrator for execution pattern detection | Mark deprecated |
| `BusinessInsightGenerator.ts` | Generates workflow insights from trends | Mark deprecated |
| `InsightPrioritizer.ts` | Prioritizes execution insights | Mark deprecated |
| `InsightActionEngine.ts` | Suggests actions for execution issues | Mark deprecated |
| `AutomationAdvisor.ts` | Advises on workflow automation | Mark deprecated |
| `PredictiveAnalytics.ts` | Predicts workflow behavior | Mark deprecated |
| `CorrelationEngine.ts` | Correlates execution patterns | Mark deprecated |
| `TrendAnalyzer.ts` | Analyzes execution trends | Mark deprecated |
| `MemoryManager.ts` | Manages insight memory | Mark deprecated |
| `MetricDetector.ts` | Detects execution metrics | Mark deprecated |
| `PatternDetector.ts` | Detects 7-run progression patterns | Mark deprecated |
| `ConfidenceCalculator.ts` | Calculates confidence modes | **Keep** (can reuse logic) |
| `types.ts` | Type definitions | Mark deprecated |
| `detectors/DataQualityDetector.ts` | Detects empty results in executions | Mark deprecated |
| `detectors/CostDetector.ts` | Detects high token/cost patterns | Mark deprecated |
| `detectors/AutomationDetector.ts` | Detects automation opportunities | Mark deprecated |
| `detectors/ReliabilityDetector.ts` | Detects failure patterns | Mark deprecated |

### Deprecation Strategy

**Recommended approach: Mark as deprecated, don't delete immediately.**

#### Step 1: Add Deprecation Banner (Phase 1)

Add a file-level deprecation comment to each legacy file:

```typescript
/**
 * @deprecated This file is part of the legacy workflow execution insight system.
 *
 * SCOPE: Analyzes agent workflow execution patterns (empty results, slow steps, etc.)
 * NOT FOR: Business intelligence / Business OS insights
 *
 * The new Business OS Insight System lives at: lib/business-os/insight/
 * - lib/business-os/insight/events/          Business event capture
 * - lib/business-os/insight/detectors/       Business vector detectors
 * - lib/business-os/insight/prioritizer/     Business insight ranking
 *
 * This legacy code may be removed after Business OS Insight System is stable (Phase 4+).
 * Do not extend this code for business insights — use lib/insight/ instead.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md for the new architecture
 */
```

#### Step 2: Rename Directory (Phase 3)

Once the new system is partially functional, rename for clarity:

```
lib/pilot/insight/  →  lib/pilot/execution-insight/
```

This makes the scope explicit and prevents accidental imports.

#### Step 3: Audit Callers (Phase 3)

Find all imports of the legacy code:

```bash
grep -r "from '@/lib/pilot/insight" --include="*.ts" --include="*.tsx"
```

Expected callers:
- `lib/pilot/WorkflowPilot.ts` — Uses `InsightAnalyzer` for execution insights
- Possibly cron jobs or API routes

These callers should continue working — execution insights remain useful for workflow diagnostics.

#### Step 4: Remove or Archive (Phase 4+)

After the Business OS Insight System is stable and in production:

**Option A: Delete** (if execution insights aren't being used)
```bash
rm -rf lib/pilot/execution-insight/
```

**Option B: Archive** (if we want to keep for reference)
```bash
mv lib/pilot/execution-insight/ lib/pilot/_archived/execution-insight/
```

### Naming Collision Prevention

To avoid confusion between the two systems:

| Concept | Legacy (Execution) | New (Business) |
|---------|-------------------|----------------|
| **Directory** | `lib/pilot/insight/` | `lib/business-os/insight/` |
| **Analyzer class** | `InsightAnalyzer` | `DetectorEngine` |
| **Pattern type** | `DetectedPattern` | `BusinessInsight` |
| **Event source** | `workflow_executions` | `business_events` |
| **Table** | None (computed on-demand) | `insights`, `business_events` |

### Timeline

| Phase | Action |
|-------|--------|
| Phase 1 | Add deprecation banners to all 17 files |
| Phase 3 | Rename directory to `execution-insight/`, audit callers |
| Phase 4+ | Delete or archive based on usage |

### Code Snippet: Deprecation Banner Script

Run this to add deprecation banners to all legacy files:

```bash
# Add to each file in lib/pilot/insight/
FILES=$(find lib/pilot/insight -name "*.ts")
for f in $FILES; do
  # Prepend deprecation notice (implementation left as exercise)
  echo "TODO: Add deprecation banner to $f"
done
```

### Why Not Delete Now?

1. **WorkflowPilot depends on it** — Breaking change if we delete without updating callers
2. **Execution insights still valuable** — Knowing "this step always returns empty" is useful
3. **Low risk of collision** — Different directory, different purpose, different data sources
4. **Safe migration** — Marking deprecated gives time to audit usage before removal

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-01 | Initial version | Complete implementation plan with 15 sections including legacy code deprecation strategy |
