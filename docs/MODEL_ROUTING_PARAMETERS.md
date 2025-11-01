# Model Routing Parameters Guide

## Overview

The Intelligent Model Routing system automatically routes agent requests to cost-efficient AI models based on agent complexity. This document explains each parameter and how they work together.

## Data Source

**Database Table**: `system_settings_config`

**API Endpoint**: `/api/admin/system-config`

**Category**: `routing`

---

## Parameters

### 1. Intelligent Routing Enabled (boolean)

- **What it does**: Master switch for the intelligent routing system
- **When ON**: System automatically routes agent requests to cost-efficient AI models based on agent complexity
- **When OFF**: All requests go to the default model (typically the most expensive/capable one)
- **Use case**: Turn this ON to save costs by using cheaper models for simple agents

### 2. Routing Low Threshold (float, e.g., 3.0)

- **What it does**: Defines the upper limit of "low complexity" agents
- **How it works**: If `agent_intensity_score <= routing_low_threshold` → Route to cheapest/fastest model (e.g., Claude Haiku, GPT-4o-mini)
- **Example**: If set to `3.0`, any agent with complexity score 0-3.0 uses the cheap model
- **Typical range**: 0.0 - 4.0

### 3. Routing Medium Threshold (float, e.g., 6.0)

- **What it does**: Defines the upper limit of "medium complexity" agents
- **How it works**: If `routing_low_threshold < agent_intensity_score <= routing_medium_threshold` → Route to mid-tier model (e.g., GPT-4o, Claude Sonnet)
- **Example**: If low=3.0 and medium=6.0, agents with scores 3.1-6.0 use mid-tier model
- **Typical range**: 4.0 - 7.0

### 4. High Complexity (implicit)

- **How it works**: If `agent_intensity_score > routing_medium_threshold` → Route to most capable model (e.g., GPT-4, Claude Opus)
- **Example**: If medium=6.0, agents with scores 6.1-10.0 use the premium model

### 5. Routing Min Executions (int, e.g., 5)

- **What it does**: Minimum number of times an agent must run before using its actual complexity score for routing
- **Why it exists**: New agents don't have execution data yet, so we can't calculate their true complexity
- **How it works**:
  - If `agent_executions < min_executions` → Use **creation complexity** (based on design)
  - If `agent_executions >= min_executions` → Use **execution complexity** (based on actual runtime data)
- **Example**: If set to `5`, after 5 runs we switch to using real execution metrics
- **Typical range**: 3 - 10

### 6. Routing Min Success Rate (int, percentage, e.g., 70)

- **What it does**: Minimum success rate required before trusting execution complexity scores
- **Why it exists**: If an agent keeps failing, its metrics might be unreliable
- **How it works**:
  - If `success_rate < min_success_rate` → Route to more capable (expensive) model to improve reliability
  - If `success_rate >= min_success_rate` → Use normal routing based on complexity
- **Example**: If set to `70%`, agents with <70% success rate get upgraded to better models
- **Typical range**: 60 - 80

### 7. Anthropic Provider Enabled (boolean)

- **What it does**: Enables/disables Anthropic (Claude) models in the routing pool
- **When ON**: Can route to Claude Haiku, Sonnet, Opus
- **When OFF**: Only uses OpenAI models (GPT-4o-mini, GPT-4o, GPT-4)
- **Use case**: Turn OFF if you don't have Anthropic API keys configured

---

## Example Routing Scenarios

### Configuration
```yaml
intelligent_routing_enabled: true
routing_low_threshold: 3.0
routing_medium_threshold: 6.0
routing_min_executions: 5
routing_min_success_rate: 70
```

### Scenario 1: Simple Email Agent ✅

- **Agent Intensity Score**: `2.5`
- **Executions**: `10` (✓ >= 5)
- **Success Rate**: `95%` (✓ >= 70%)
- **Routing Decision**: `2.5 <= 3.0` → **Claude Haiku** (cheap & fast)

### Scenario 2: Medium Complexity Data Processing Agent ✅

- **Agent Intensity Score**: `5.0`
- **Executions**: `8` (✓ >= 5)
- **Success Rate**: `85%` (✓ >= 70%)
- **Routing Decision**: `3.0 < 5.0 <= 6.0` → **Claude Sonnet** or **GPT-4o** (mid-tier)

### Scenario 3: Complex Multi-Step Agent ✅

- **Agent Intensity Score**: `7.5`
- **Executions**: `15` (✓ >= 5)
- **Success Rate**: `90%` (✓ >= 70%)
- **Routing Decision**: `7.5 > 6.0` → **Claude Opus** or **GPT-4** (premium)

### Scenario 4: New Agent (Not Enough Data) ⚠️

- **Agent Intensity Score**: `4.0` (creation score)
- **Executions**: `2` (✗ < 5)
- **Success Rate**: `50%` (✗ < 70%)
- **Routing Decision**: Not enough executions + low success rate → **Upgrade to premium model** for reliability

### Scenario 5: Failing Agent ⚠️

- **Agent Intensity Score**: `3.0`
- **Executions**: `12` (✓ >= 5)
- **Success Rate**: `45%` (✗ < 70%)
- **Routing Decision**: Despite low complexity, success rate is poor → **Upgrade to better model** to improve success

---

## Cost Savings Impact

With intelligent routing enabled:

| Agent Complexity | % of Workload | Cost Reduction | Model Tier |
|-----------------|---------------|----------------|------------|
| **Low** (0-3.0) | 40% | ~80% | Haiku/GPT-4o-mini |
| **Medium** (3.1-6.0) | 40% | ~50% | Sonnet/GPT-4o |
| **High** (6.1-10.0) | 20% | 0% (full price) | Opus/GPT-4 |

**Overall savings**: ~50-65% reduction in API costs

---

## Routing Decision Flow

```
┌─────────────────────────────────────┐
│  Agent Execution Request Received   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Is Intelligent Routing Enabled?     │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       │                │
      NO               YES
       │                │
       ▼                ▼
   Use Default    ┌──────────────────────┐
   Model (Opus)   │ Check Executions     │
                  │ >= Min Executions?   │
                  └──────┬───────────────┘
                         │
                 ┌───────┴────────┐
                 │                │
                NO               YES
                 │                │
                 ▼                ▼
          Use Creation    ┌──────────────────┐
          Complexity      │ Check Success    │
          Score           │ Rate >= Min?     │
                          └──────┬───────────┘
                                 │
                         ┌───────┴────────┐
                         │                │
                        NO               YES
                         │                │
                         ▼                ▼
                   Upgrade to      Use Execution
                   Premium Model   Complexity Score
                         │                │
                         └────────┬───────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ Route Based on Score:   │
                    │ • <= Low → Haiku        │
                    │ • <= Med → Sonnet       │
                    │ • > Med  → Opus         │
                    └─────────────────────────┘
```

---

## Configuration Tips

### For Maximum Cost Savings
- Set `routing_low_threshold = 4.0` (route more agents to cheap tier)
- Set `routing_medium_threshold = 7.0` (route more agents to mid tier)
- Set `routing_min_executions = 3` (switch to execution metrics faster)
- Set `routing_min_success_rate = 65` (more tolerant of mid-tier models)

### For Maximum Reliability
- Set `routing_low_threshold = 2.0` (only simplest agents use cheap tier)
- Set `routing_medium_threshold = 5.0` (conservative mid-tier threshold)
- Set `routing_min_executions = 10` (require more data before trusting metrics)
- Set `routing_min_success_rate = 80` (strict success rate requirement)

### Balanced (Recommended)
- Set `routing_low_threshold = 3.0`
- Set `routing_medium_threshold = 6.0`
- Set `routing_min_executions = 5`
- Set `routing_min_success_rate = 70`

---

## Related Systems

### Agent Intensity System (AIS)
The routing system relies on the **Agent Intensity Score** calculated by the AIS system. See [AIS_COMPLETE_SYSTEM_GUIDE.md](./AIS_COMPLETE_SYSTEM_GUIDE.md) for details on how complexity scores are calculated.

**Key Connection**: AIS calculates the `agent_intensity_score` (0-10) → Routing uses this score to select the appropriate model tier.

### Database Tables
- **Routing Config**: `system_settings_config` (category='routing')
- **AIS Config**: `ais_system_config` (weights, limits, ranges)
- **Agent Scores**: `agent_analytics` (stores intensity scores)

---

## Admin Interface

**Location**: Admin → System Config → Model Routing

**Permissions**: Admin only

**Real-time Updates**: Changes take effect immediately for new agent executions

---

## Monitoring & Analytics

Track routing effectiveness:
1. **Cost per Agent**: Monitor API costs before/after enabling routing
2. **Success Rates by Tier**: Ensure cheap/mid-tier models maintain quality
3. **Routing Distribution**: Verify agents are being distributed across tiers as expected
4. **Model Upgrade Rate**: Track how often agents get upgraded due to failures

See the **Admin → Analytics** page for detailed routing metrics.
