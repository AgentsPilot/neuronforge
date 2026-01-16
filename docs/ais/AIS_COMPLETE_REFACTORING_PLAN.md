# AIS System Complete Refactoring Plan

**Date:** 2025-11-07
**Status:** Ready for Implementation
**Priority:** CRITICAL - Required for cost optimization

---

## Executive Summary

The AIS (Agent Intensity System) is **70% complete** in its migration from hardcoded to database-driven configuration. This document provides:
1. Complete audit findings of what works and what's broken
2. Detailed explanation of how routing systems work together
3. Step-by-step refactoring plan to complete the remaining 30%
4. Expected business impact and cost savings

**Current State:** Admin UI shows controls that don't work. Users change settings that have zero effect.
**Goal:** Make all admin controls functional so AIS provides real cost savings.

---

## Table of Contents

1. [How Routing Systems Work Together](#how-routing-systems-work-together)
2. [What Works vs What's Broken](#what-works-vs-whats-broken)
3. [Detailed Audit Findings](#detailed-audit-findings)
4. [The Refactoring Plan](#the-refactoring-plan)
5. [Implementation Timeline](#implementation-timeline)
6. [Testing Strategy](#testing-strategy)
7. [Expected Outcomes](#expected-outcomes)

---

## How Routing Systems Work Together

### Overview: Two Complementary Routing Systems

The platform has **TWO DISTINCT ROUTING SYSTEMS** that work at different granularities:

1. **Agent-Level Routing** - Routes entire agent executions
2. **Per-Step Routing** - Routes individual workflow steps

They are **mutually exclusive** but use the same underlying AIS scoring foundation.

---

### System 1: Agent-Level Routing (Standard Agents)

**Purpose:** Route non-Pilot agents to optimal models based on overall complexity

**When Used:**
- Agent has `pilot_enabled = false` (standard agent)
- System setting `intelligent_routing_enabled = true`
- Triggered once per agent execution

**How It Works:**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Triggers Agent Execution                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. runAgentKit() checks intelligent_routing_enabled         │
│    • If false: Use default model (gpt-4o)                   │
│    • If true: Proceed to routing...                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. ModelRouter.selectModel(agentId)                         │
│    INPUT:                                                   │
│    • agent_id                                               │
│    • supabase (database client)                             │
│    • user_id                                                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Fetch Agent AIS Metrics                                  │
│    SOURCE: agent_intensity_metrics table                    │
│    READS:                                                   │
│    • combined_score (0-10) ← PRIMARY ROUTING INPUT          │
│    • success_rate (0-100)                                   │
│    • total_executions                                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Apply Routing Logic                                      │
│                                                             │
│    IF total_executions < min_executions_for_score (5):     │
│      → gpt-4o-mini (conservative start)                     │
│      REASON: "Insufficient data for routing"                │
│                                                             │
│    ELSE IF success_rate < min_success_rate (85%):          │
│      → gpt-4o (premium upgrade)                             │
│      REASON: "Low success rate - need reliability"          │
│                                                             │
│    ELSE IF combined_score <= low_threshold (3.9):          │
│      → gpt-4o-mini (Tier 1 - Budget)                       │
│      REASON: "Low complexity - cost optimized"              │
│                                                             │
│    ELSE IF combined_score <= medium_threshold (6.9):       │
│      → claude-3-5-haiku (Tier 2 - Balanced)                │
│      REASON: "Medium complexity - balanced"                 │
│                                                             │
│    ELSE (combined_score > 6.9):                            │
│      → gpt-4o (Tier 3 - Premium)                           │
│      REASON: "High complexity - premium model"              │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Return Model Selection                                   │
│    OUTPUT:                                                  │
│    • model: "gpt-4o-mini"                                   │
│    • provider: "openai"                                     │
│    • reasoning: "Low complexity (score: 2.8)"               │
│    • intensity_score: 2.8                                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Agent Executes with Selected Model                       │
│    • Entire execution uses ONE model                        │
│    • All LLM calls use same model                           │
│    • Model logged in execution record                       │
└─────────────────────────────────────────────────────────────┘
```

**Key Characteristics:**
- ✅ Uses agent's **combined_score** (blend of creation + execution scores)
- ✅ Simple 3-tier routing (Budget / Balanced / Premium)
- ✅ Quality override (upgrades if success rate drops)
- ✅ Maturity gate (waits for 5+ executions before routing)
- ❌ No per-call optimization (entire execution uses one model)

---

### System 2: Per-Step Routing (Pilot Workflows)

**Purpose:** Route individual workflow steps to optimal models based on step-specific complexity

**When Used:**
- Agent has `pilot_enabled = true` (Pilot workflow)
- System setting `pilot_per_step_routing_enabled = true`
- Triggered for EACH LLM step in the workflow

**How It Works:**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Triggers Pilot Workflow Execution                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. StepExecutor processes workflow step by step             │
│    • Non-LLM steps: Use workflow logic (no routing)         │
│    • LLM steps: Proceed to per-step routing...              │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. TaskComplexityAnalyzer.analyzeStep(step)                 │
│    INPUT:                                                   │
│    • step definition (prompt, data, conditions)              │
│    • execution context (variables, history)                  │
│                                                             │
│    ANALYZES 6 FACTORS:                                      │
│    • Prompt Length: Character count of instructions         │
│    • Data Size: Byte size of input data                     │
│    • Condition Count: Number of if/else branches            │
│    • Context Depth: Variable references, nesting            │
│    • Reasoning Depth: Logical complexity estimate           │
│    • Output Complexity: Structure of expected output        │
│                                                             │
│    OUTPUT:                                                  │
│    • step_complexity_score (0-10)                           │
│    • factor breakdown (which factors drove the score)       │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PerStepModelRouter.routeStep()                           │
│    INPUT:                                                   │
│    • step_complexity_score (0-10)                           │
│    • agent_ais (agent's combined_score, 0-10)               │
│    • agent_default_model (fallback)                         │
│    • agent_id (for routing memory)                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Calculate Effective Complexity                           │
│                                                             │
│    LOAD STRATEGY from database (default: "balanced"):      │
│    • conservative: aisWeight=0.6, stepWeight=0.4            │
│    • balanced:     aisWeight=0.4, stepWeight=0.6            │
│    • aggressive:   aisWeight=0.2, stepWeight=0.8            │
│                                                             │
│    FORMULA:                                                 │
│    effective_complexity =                                   │
│      (agent_ais × strategy.aisWeight) +                     │
│      (step_complexity × strategy.stepWeight)                │
│                                                             │
│    EXAMPLE (Balanced Strategy):                            │
│    agent_ais = 7.0 (high overall complexity)               │
│    step_complexity = 4.0 (medium step complexity)          │
│    effective = (7.0 × 0.4) + (4.0 × 0.6)                   │
│             = 2.8 + 2.4 = 5.2                              │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Check Routing Memory (ML Learning Layer)                 │
│                                                             │
│    QUERY: RoutingMemoryService.getRecommendation()         │
│    INPUT: agent_id, step_type, effective_complexity        │
│                                                             │
│    MEMORY LOOKS UP:                                         │
│    "For Agent X doing 'llm_decision' steps at             │
│     complexity ~5.2, what's the best model?"                │
│                                                             │
│    HISTORICAL PERFORMANCE:                                  │
│    • Tier 1 (gpt-4o-mini): 15 runs, 95% success, $0.02    │
│    • Tier 2 (claude-haiku): 10 runs, 90% success, $0.08   │
│    • Tier 3 (gpt-4o): 5 runs, 98% success, $0.25          │
│                                                             │
│    DECISION:                                                │
│    IF confidence >= 60%:                                    │
│      RECOMMEND: Tier 1 (best cost/success ratio)           │
│      OVERRIDE: YES                                          │
│    ELSE:                                                    │
│      RECOMMEND: None (use complexity-based routing)         │
│      OVERRIDE: NO                                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Select Model (Memory or Complexity-Based)                │
│                                                             │
│    IF memory_recommendation.shouldOverride:                 │
│      → Use memory-recommended tier (ML-optimized)           │
│      REASON: "Memory learned Tier 1 works best"             │
│                                                             │
│    ELSE IF effective_complexity <= tier1_max (3.9):        │
│      → gpt-4o-mini (Tier 1 - Budget)                       │
│      REASON: "Low effective complexity"                     │
│                                                             │
│    ELSE IF effective_complexity <= tier2_max (6.9):        │
│      → claude-3-5-haiku (Tier 2 - Balanced)                │
│      REASON: "Medium effective complexity"                  │
│                                                             │
│    ELSE:                                                    │
│      → gpt-4o (Tier 3 - Premium)                           │
│      REASON: "High effective complexity"                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Execute Step with Selected Model                         │
│    • This step uses selected model                          │
│    • Next step may use different model                      │
│    • Model logged in step execution record                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. Learn from Results (Update Routing Memory)               │
│    AFTER STEP COMPLETES:                                    │
│    • RoutingMemoryService.learnFromExecution()             │
│    • Updates performance statistics                         │
│    • Improves future routing decisions                      │
└─────────────────────────────────────────────────────────────┘
```

**Key Characteristics:**
- ✅ Uses **both** agent AIS + step complexity
- ✅ Weighted strategy (conservative/balanced/aggressive)
- ✅ Machine learning layer (routing memory)
- ✅ Fine-grained optimization (each step can use different model)
- ✅ Learns from experience (improves over time)
- ❌ More complex configuration (20+ parameters)

---

### How They Work Together: The Decision Tree

```
┌────────────────────────────────────────────────────────────┐
│ Agent Execution Requested                                   │
└───────────────────────┬────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │ Is Pilot Enabled? │
              └────────┬───────┬──┘
                       │       │
                 NO ◄──┘       └──► YES
                  │                 │
                  ▼                 ▼
   ┌──────────────────────────┐   ┌──────────────────────────┐
   │ Is Intelligent Routing   │   │ Is Per-Step Routing      │
   │ Enabled?                 │   │ Enabled?                 │
   └───────┬────────┬─────────┘   └────────┬─────────┬───────┘
           │        │                      │         │
     NO ◄──┘        └──► YES          NO ◄─┘         └──► YES
      │                  │               │                 │
      ▼                  ▼               ▼                 ▼
┌──────────┐   ┌─────────────────┐   ┌──────────┐   ┌─────────────────┐
│ Use      │   │ AGENT-LEVEL     │   │ Use      │   │ PER-STEP        │
│ Default  │   │ ROUTING         │   │ Agent's  │   │ ROUTING         │
│ Model    │   │                 │   │ Default  │   │                 │
│ (gpt-4o) │   │ Input:          │   │ Model    │   │ Input:          │
│          │   │ • combined_score│   │          │   │ • step_complex  │
│          │   │                 │   │          │   │ • agent_ais     │
│          │   │ Output:         │   │          │   │ • routing_memory│
│          │   │ • ONE model for │   │          │   │                 │
│          │   │   entire agent  │   │          │   │ Output:         │
│          │   │                 │   │          │   │ • Different     │
│          │   │                 │   │          │   │   model per step│
└──────────┘   └─────────────────┘   └──────────┘   └─────────────────┘
```

---

### Key Design Principles

#### 1. **Mutual Exclusivity**
- Pilot workflows **NEVER** use agent-level routing
- Standard agents **NEVER** use per-step routing
- Clear separation prevents conflicts

#### 2. **Shared Foundation: AIS Scores**
- Both systems rely on `agent_intensity_metrics.combined_score`
- Agent-level routing uses it directly
- Per-step routing uses it as baseline influence

#### 3. **Increasing Sophistication**
- Agent-level: Simple, predictable (3 tiers, 1 score)
- Per-step: Complex, adaptive (6 factors, ML learning)

#### 4. **Different Optimization Goals**
- Agent-level: "What model handles this agent best overall?"
- Per-step: "What's the cheapest model that can handle THIS specific step?"

---

### Example Scenario: Same Agent, Different Routing

**Agent:** "Customer Support Analyzer"
**AIS combined_score:** 6.5 (medium-high complexity)

#### Scenario A: Standard Agent (Agent-Level Routing)

```
Agent Execution:
├─ Routing Decision: combined_score = 6.5
├─ Selected Model: claude-3-5-haiku (Tier 2)
├─ Reasoning: "Medium complexity (6.5) - balanced cost/performance"
│
└─ Execution:
   ├─ Parse customer email → claude-3-5-haiku
   ├─ Analyze sentiment → claude-3-5-haiku
   ├─ Generate response → claude-3-5-haiku
   └─ Format output → claude-3-5-haiku

Total: 1 model used, ~$0.10 cost
```

#### Scenario B: Pilot Workflow (Per-Step Routing)

```
Pilot Workflow:
├─ Strategy: balanced (aisWeight=0.4, stepWeight=0.6)
├─ Agent AIS: 6.5
│
└─ Step 1: "Parse customer email"
   ├─ Step Complexity: 2.0 (simple parsing)
   ├─ Effective: (6.5 × 0.4) + (2.0 × 0.6) = 3.8
   ├─ Selected: gpt-4o-mini (Tier 1)
   ├─ Cost: ~$0.01
   │
   └─ Step 2: "Analyze sentiment and urgency"
      ├─ Step Complexity: 5.5 (moderate analysis)
      ├─ Effective: (6.5 × 0.4) + (5.5 × 0.6) = 5.9
      ├─ Selected: claude-3-5-haiku (Tier 2)
      ├─ Cost: ~$0.03
      │
      └─ Step 3: "Generate personalized response"
         ├─ Step Complexity: 8.0 (complex generation)
         ├─ Effective: (6.5 × 0.4) + (8.0 × 0.6) = 7.4
         ├─ Selected: gpt-4o (Tier 3)
         ├─ Cost: ~$0.12
         │
         └─ Step 4: "Format as JSON"
            ├─ Step Complexity: 1.5 (trivial formatting)
            ├─ Effective: (6.5 × 0.4) + (1.5 × 0.6) = 3.5
            ├─ Routing Memory Override: "Tier 1 works perfectly"
            ├─ Selected: gpt-4o-mini (Tier 1)
            ├─ Cost: ~$0.01

Total: 3 different models used, ~$0.17 cost
```

**Comparison:**
- Agent-level: Simpler, one-size-fits-all → $0.10
- Per-step: Granular, optimized per step → $0.17

Wait, per-step is MORE expensive? Yes, in this example! This shows:
- Per-step routing prioritizes **precision** over cost
- Agent-level routing prioritizes **cost** over precision
- Complex generation step (Step 3) needed premium model
- Agent-level averaged to medium model, may have failed

**The Trade-Off:**
- **Agent-level:** Lower cost, higher risk of failure on complex parts
- **Per-step:** Higher cost, lower risk (right tool for each job)

---

### When to Use Which System

#### Use **Agent-Level Routing** When:
- ✅ Agent has consistent complexity throughout execution
- ✅ Want simple, predictable routing
- ✅ Prefer cost optimization over granular control
- ✅ Agent is conversational/interactive (not workflow-based)
- ✅ Example: Chatbots, Q&A agents, simple automation

#### Use **Per-Step Routing** When:
- ✅ Workflow has varying complexity across steps
- ✅ Want maximum optimization (cost + quality)
- ✅ Can accept more complex configuration
- ✅ Agent is multi-step workflow with distinct phases
- ✅ Example: Data pipelines, multi-stage analysis, orchestration

---

### Integration Point: AIS Scores

**Both systems depend on the same AIS foundation:**

```
┌──────────────────────────────────────────────────────────────┐
│                    AIS SCORING SYSTEM                         │
│                                                              │
│  Calculates combined_score (0-10) from:                     │
│  • Creation Score (0-10): Agent design complexity           │
│  • Execution Score (0-10): Runtime behavior complexity      │
│                                                              │
│  Stored in: agent_intensity_metrics table                   │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        │ (combined_score)
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
┌────────────────────┐   ┌────────────────────┐
│ AGENT-LEVEL        │   │ PER-STEP           │
│ ROUTING            │   │ ROUTING            │
│                    │   │                    │
│ Uses:              │   │ Uses:              │
│ • combined_score   │   │ • combined_score   │
│   (DIRECTLY)       │   │   (as baseline)    │
│                    │   │ • + step_complexity│
└────────────────────┘   └────────────────────┘
```

**Why This Matters:**
- If AIS scoring is broken (hardcoded weights), BOTH routing systems are impacted
- Fix AIS → Both routing systems improve
- AIS is the foundation → Must be database-driven

---

## What Works vs What's Broken

### ✅ Working Correctly (Database-Driven)

| Component | Status | Notes |
|-----------|--------|-------|
| **Sub-dimension weights** | ✅ Working | Token volume/peak/io, execution iterations/duration/failures, plugin count/usage/overhead, workflow steps/branches/loops/parallel all load from database |
| **Normalization ranges** | ✅ Working | All metric ranges (token volume, iterations, plugins, etc.) in `ais_normalization_ranges` table |
| **Growth thresholds** | ✅ Working | Monitor/rescore/upgrade thresholds at 25%/50%/100% growth |
| **Quality metrics** | ✅ Working | Success rate and retry rate thresholds |
| **Per-step routing config** | ✅ Working | Models, thresholds, strategies all database-driven |
| **Agent-level routing thresholds** | ✅ Working | Low (3.9) and medium (6.9) thresholds from database |
| **Min executions for score** | ✅ Working | Threshold before routing activates (default: 5) |

---

### 🔴 Broken (Hardcoded, Admin Changes Don't Work)

| Component | Status | Impact | Admin UI Shows? |
|-----------|--------|--------|-----------------|
| **Main dimension weights** | 🔴 Broken | Admin changes have ZERO effect | Yes (misleading) |
| **Combined score weights** | 🔴 Broken | Cannot tune creation vs execution blend | No (missing) |
| **Memory complexity ranges** | 🔴 Broken | Memory ranges are hardcoded in code | No (missing) |
| **Memory subdimension weights** | 🔴 Broken | Hardcoded 50%/30%/20% | Yes (misleading) |
| **Agent-level routing models** | 🔴 Broken | Model names hardcoded (gpt-4o-mini, etc.) | No (missing) |

---

## Detailed Audit Findings

### Finding 1: Main Dimension Weights Are Hardcoded

**Location:** `/lib/types/intensity.ts` lines 332-338

**The Code:**
```typescript
export const EXECUTION_WEIGHTS = {
  TOKEN_COMPLEXITY: 0.30,      // Hardcoded
  EXECUTION_COMPLEXITY: 0.25,  // Hardcoded
  PLUGIN_COMPLEXITY: 0.20,     // Hardcoded
  WORKFLOW_COMPLEXITY: 0.15,   // Hardcoded
  MEMORY_COMPLEXITY: 0.10,     // Hardcoded (NEW 5th component)
} as const;
```

**Used In:**
- `/lib/utils/updateAgentIntensity.ts` lines 197-203 (execution score calculation)
- `/lib/services/AgentIntensityService.ts` lines 783-799 (creation score calculation)

**The Problem:**
- These constants are imported and used directly
- Database has matching keys (`ais_weight_tokens`, etc.) but they're NEVER read
- Admin UI displays and saves these weights to database
- User changes weights in admin → Success message → Nothing happens

**Database Keys (Ignored):**
- `ais_weight_tokens` (set to 0.30 by default, but never used)
- `ais_weight_execution` (set to 0.25 by default, but never used)
- `ais_weight_plugins` (set to 0.20 by default, but never used)
- `ais_weight_workflow` (set to 0.15 by default, but never used)
- `ais_weight_memory` (set to 0.10 by default, but never used)

**Impact:**
- **CRITICAL** - This is the foundation of AIS scoring
- Admin cannot tune the relative importance of:
  - Token usage vs execution behavior
  - Plugins vs workflow complexity
  - Memory usage influence
- Fixed 30/25/20/15/10 split forever

**Example Scenario:**
```
Admin wants to prioritize execution behavior over token usage:
1. Admin goes to AIS Config page
2. Changes token weight from 30% to 20%
3. Changes execution weight from 25% to 35%
4. Clicks "Save AIS Weights"
5. Success message: "✅ AIS weights updated successfully!"
6. Database updated: ais_weight_tokens = 0.20, ais_weight_execution = 0.35

Agent executes:
→ Calculation STILL uses hardcoded 0.30 and 0.25
→ Admin's changes have ZERO effect
→ User frustrated, system not optimizing
```

---

### Finding 2: Combined Score Weights Are Hardcoded

**Location:** `/lib/types/intensity.ts` lines 343-346

**The Code:**
```typescript
export const COMBINED_WEIGHTS = {
  CREATION: 0.3,    // Hardcoded: 30% weight to design
  EXECUTION: 0.7,   // Hardcoded: 70% weight to runtime
} as const;
```

**Used In:**
- `/lib/utils/updateAgentIntensity.ts` lines 214-217 (combined score calculation)
- `/lib/services/AgentIntensityService.ts` lines 110-111 (initial combined score)

**The Problem:**
- The 30/70 blend ratio is fixed in code
- NO database keys exist for these weights at all
- Admin UI has no controls for this
- Cannot tune how much to trust design vs runtime behavior

**Database Keys:** NONE (not even created)

**Impact:**
- **CRITICAL** - Controls how creation and execution scores are blended
- System always trusts execution 2.3x more than creation
- Cannot adjust based on:
  - Agent maturity (new agents: trust creation more)
  - Agent stability (stable agents: trust execution more)
  - Business needs (prototyping: trust creation more)

**Example Scenario:**
```
Business need: Trust agent design more during initial rollout

Current behavior:
→ New agent created with complex workflow (creation_score = 8.0)
→ First execution is simple test (execution_score = 3.0)
→ combined_score = 8.0 × 0.3 + 3.0 × 0.7 = 4.5
→ Routes to Tier 2 (medium) despite complex design

Desired behavior (trust creation 50/50 initially):
→ combined_score = 8.0 × 0.5 + 3.0 × 0.5 = 5.5
→ Routes to Tier 2 appropriately
→ As agent matures, shift to 30/70 blend

Cannot do this - weights are hardcoded
```

---

### Finding 3: Memory Complexity Is Fully Hardcoded

**Location:** `/lib/utils/updateAgentIntensity.ts` lines 543-584

**The Code:**
```typescript
async function calculateMemoryComplexity(...): Promise<number> {
  // HARDCODED RANGES (not in database)
  const ratioRange = { min: 0.0, max: 0.9 };      // Line 558
  const diversityRange = { min: 0, max: 3 };      // Line 563
  const volumeRange = { min: 0, max: 20 };        // Line 568

  const ratioScore = AISConfigService.normalize(memoryRatio, ratioRange);
  const diversityScore = AISConfigService.normalize(memoryTypeDiversity, diversityRange);
  const volumeScore = AISConfigService.normalize(memoryEntryCount, volumeRange);

  // HARDCODED WEIGHTS (not from database)
  const score = clamp(
    ratioScore * 0.5 +       // Line 573: 50% weight
    diversityScore * 0.3 +   // Line 574: 30% weight
    volumeScore * 0.2,       // Line 575: 20% weight
    0,
    10
  );

  return score;
}
```

**The Problem:**
- Ranges: Hardcoded in function, not in `ais_normalization_ranges` table
- Weights: Database has keys (`ais_memory_ratio_weight`, etc.) but they're LOADED and IGNORED
- Admin UI shows memory weight controls, but they don't work

**Database Keys (Ranges - Missing):**
- NONE - Memory ranges don't exist in `ais_normalization_ranges` table

**Database Keys (Weights - Ignored):**
- `ais_memory_ratio_weight` (set to 0.5, but never used in calculation)
- `ais_memory_diversity_weight` (set to 0.3, but never used in calculation)
- `ais_memory_volume_weight` (set to 0.2, but never used in calculation)

**Impact:**
- **CRITICAL** - Memory is the 5th dimension, recently added
- Completely unconfigurable despite admin UI showing controls
- Cannot tune:
  - What ratio of memory tokens is "high" (currently hardcoded 90%)
  - How many memory types are "complex" (currently hardcoded 3)
  - How many memory entries are "large" (currently hardcoded 20)

**Example Scenario:**
```
Agent uses memory heavily:
→ Loads 2000 memory tokens out of 10000 input tokens
→ Memory ratio = 0.20 (20%)
→ Normalized against hardcoded range (0.0 - 0.9)
→ Ratio score = 2.2/10 (low)

Admin wants to lower threshold:
→ Changes memory ratio max from 90% to 60%
→ Saves to database
→ Calculation STILL uses hardcoded 0.9 (90%)
→ Same agent still gets low memory score

Cannot tune memory sensitivity - ranges hardcoded
```

---

### Finding 4: Agent-Level Routing Models Are Hardcoded

**Location:** `/lib/ai/modelRouter.ts` lines 22-35

**The Code:**
```typescript
private static readonly DEFAULT_CONFIG = {
  low: {
    model: 'gpt-4o-mini',           // Hardcoded
    provider: 'openai' as const     // Hardcoded
  },
  medium: {
    model: 'claude-3-5-haiku-20241022',  // Hardcoded
    provider: 'anthropic' as const       // Hardcoded
  },
  high: {
    model: 'gpt-4o',                // Hardcoded
    provider: 'openai' as const     // Hardcoded
  }
};
```

**Used In:**
- Lines 74-147: All routing logic uses DEFAULT_CONFIG
- Lines 214-238: Dead code references environment variables (should be deleted)

**The Problem:**
- Model names are hardcoded in code
- Per-step routing loads from database (`pilot_routing_tier1_model`, etc.) but agent-level doesn't
- Inconsistent: Per-step is configurable, agent-level is not
- Cannot change models without code deployment

**Database Keys:** NONE (per-step routing has them, agent-level doesn't)

**Impact:**
- **HIGH PRIORITY** - Cannot adapt to new models
- If new model releases (e.g., gpt-4o-turbo), must deploy code
- Per-step routing can be updated via admin UI
- Agent-level routing requires code changes
- Inconsistent admin experience

**Example Scenario:**
```
New model release: gpt-4.5-turbo (faster, cheaper than gpt-4o)

Per-step routing (configurable):
→ Admin goes to Per-Step Routing Config
→ Changes Tier 3 model from "gpt-4o" to "gpt-4.5-turbo"
→ Saves to database
→ Next execution uses new model ✅

Agent-level routing (hardcoded):
→ Admin has no UI to change model
→ Even if added to UI, backend doesn't read from database
→ Must wait for developer to change code
→ Must deploy to production
→ Takes days instead of minutes ❌
```

---

## The Refactoring Plan

### Phase 1: Fix Critical AIS Calculation Weights 🔴 CRITICAL

**Goal:** Make main dimension weights and combined weights database-driven

**Estimated Effort:** 6-8 hours

---

#### Step 1.1: Load Execution Weights from Database

**File:** `/lib/services/AISConfigService.ts`

**Add New Method:**
```typescript
/**
 * Get execution dimension weights from database
 * Returns the 5 main dimension weights that determine execution_score
 */
static async getExecutionWeights(
  supabase: SupabaseClient
): Promise<{
  tokens: number;
  execution: number;
  plugins: number;
  workflow: number;
  memory: number;
}> {
  const defaults = {
    tokens: 0.30,
    execution: 0.25,
    plugins: 0.20,
    workflow: 0.15,
    memory: 0.10
  };

  try {
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', [
        'ais_weight_tokens',
        'ais_weight_execution',
        'ais_weight_plugins',
        'ais_weight_workflow',
        'ais_weight_memory'
      ]);

    if (error || !data) {
      console.warn('[AISConfig] Failed to load execution weights, using defaults');
      return defaults;
    }

    const weights = { ...defaults };
    data.forEach(row => {
      const value = parseFloat(row.config_value);
      if (row.config_key === 'ais_weight_tokens') weights.tokens = value;
      else if (row.config_key === 'ais_weight_execution') weights.execution = value;
      else if (row.config_key === 'ais_weight_plugins') weights.plugins = value;
      else if (row.config_key === 'ais_weight_workflow') weights.workflow = value;
      else if (row.config_key === 'ais_weight_memory') weights.memory = value;
    });

    // Cache the result (5-minute TTL)
    this.setCache('execution_weights', weights);

    return weights;
  } catch (error) {
    console.error('[AISConfig] Error loading execution weights:', error);
    return defaults;
  }
}
```

**File:** `/lib/utils/updateAgentIntensity.ts`

**Change Lines 197-203 FROM:**
```typescript
const execution_score = (
  token_complexity_score * EXECUTION_WEIGHTS.TOKEN_COMPLEXITY +
  execution_complexity_score * EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY +
  plugin_complexity_score * EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY +
  workflow_complexity_score * EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY +
  memory_complexity_score * EXECUTION_WEIGHTS.MEMORY_COMPLEXITY
);
```

**TO:**
```typescript
// Load weights from database (cached)
const executionWeights = await AISConfigService.getExecutionWeights(supabase);

const execution_score = (
  token_complexity_score * executionWeights.tokens +
  execution_complexity_score * executionWeights.execution +
  plugin_complexity_score * executionWeights.plugins +
  workflow_complexity_score * executionWeights.workflow +
  memory_complexity_score * executionWeights.memory
);
```

**File:** `/lib/services/AgentIntensityService.ts`

**Change Lines 783-799 (Similar Pattern):**
```typescript
// Load weights from database
const executionWeights = await AISConfigService.getExecutionWeights(this.supabase);

// Calculate weighted execution_score
const execution_score = clamp(
  token_complexity_score * executionWeights.tokens +
  execution_complexity_score * executionWeights.execution +
  plugin_complexity_score * executionWeights.plugins +
  workflow_complexity_score * executionWeights.workflow +
  memory_complexity_score * executionWeights.memory,
  0,
  10
);
```

**File:** `/lib/types/intensity.ts`

**Change Lines 332-338:**
```typescript
// DEPRECATED: Use AISConfigService.getExecutionWeights() instead
// These constants are kept as fallback values only
export const EXECUTION_WEIGHTS = {
  TOKEN_COMPLEXITY: 0.30,      // Default fallback
  EXECUTION_COMPLEXITY: 0.25,  // Default fallback
  PLUGIN_COMPLEXITY: 0.20,     // Default fallback
  WORKFLOW_COMPLEXITY: 0.15,   // Default fallback
  MEMORY_COMPLEXITY: 0.10,     // Default fallback (NEW 5th component)
} as const;
```

**Add Comment:**
```typescript
/**
 * @deprecated Use AISConfigService.getExecutionWeights() to load from database
 * These constants are fallback values used when database is unavailable
 */
```

---

#### Step 1.2: Add Combined Weights to Database

**File:** Database migration or admin script

**Add Database Rows:**
```sql
-- Add to ais_system_config table
INSERT INTO ais_system_config (config_key, config_value, description, category)
VALUES
  ('ais_combined_weight_creation', 0.3, 'Weight for creation score in combined score calculation (30% = trust design)', 'ais_dimension_weights'),
  ('ais_combined_weight_execution', 0.7, 'Weight for execution score in combined score calculation (70% = trust runtime)', 'ais_dimension_weights');
```

**File:** `/lib/services/AISConfigService.ts`

**Add New Method:**
```typescript
/**
 * Get combined score weights from database
 * Returns the weights for blending creation and execution scores
 */
static async getCombinedWeights(
  supabase: SupabaseClient
): Promise<{
  creation: number;
  execution: number;
}> {
  const defaults = {
    creation: 0.3,   // 30% weight to design
    execution: 0.7   // 70% weight to runtime
  };

  try {
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', [
        'ais_combined_weight_creation',
        'ais_combined_weight_execution'
      ]);

    if (error || !data) {
      console.warn('[AISConfig] Failed to load combined weights, using defaults');
      return defaults;
    }

    const weights = { ...defaults };
    data.forEach(row => {
      const value = parseFloat(row.config_value);
      if (row.config_key === 'ais_combined_weight_creation') weights.creation = value;
      else if (row.config_key === 'ais_combined_weight_execution') weights.execution = value;
    });

    // Cache the result (5-minute TTL)
    this.setCache('combined_weights', weights);

    return weights;
  } catch (error) {
    console.error('[AISConfig] Error loading combined weights:', error);
    return defaults;
  }
}
```

**File:** `/lib/utils/updateAgentIntensity.ts`

**Change Lines 214-217 FROM:**
```typescript
const combined_score = total_executions < minExecutionsForScore
  ? creation_score
  : (
      creation_score * COMBINED_WEIGHTS.CREATION +
      execution_score * COMBINED_WEIGHTS.EXECUTION
    );
```

**TO:**
```typescript
// Load weights from database (cached)
const combinedWeights = await AISConfigService.getCombinedWeights(supabase);

const combined_score = total_executions < minExecutionsForScore
  ? creation_score
  : (
      creation_score * combinedWeights.creation +
      execution_score * combinedWeights.execution
    );
```

---

#### Step 1.3: Update Admin UI for Combined Weights

**File:** `/app/admin/ais-config/page.tsx`

**Add State:**
```typescript
const [combinedWeights, setCombinedWeights] = useState({
  creation: 0.3,
  execution: 0.7
});
```

**Load from Database (in fetchConfig):**
```typescript
// In fetchConfig() function
if (data.config.combinedWeights) {
  setCombinedWeights({
    creation: data.config.combinedWeights.creation || 0.3,
    execution: data.config.combinedWeights.execution || 0.7
  });
}
```

**Add UI Section (after AIS Dimension Weights):**
```tsx
{/* Combined Score Weights */}
<div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
  <div className="flex items-center justify-between mb-4">
    <div>
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        Combined Score Blend Weights (must sum to 1.0)
      </h3>
      <p className="text-xs text-slate-500 mt-1">
        Controls how creation score (design) vs execution score (runtime) are blended.
      </p>
    </div>
    <span className="text-xs text-slate-400">
      Current sum: {(combinedWeights.creation + combinedWeights.execution).toFixed(3)}
    </span>
  </div>

  {/* Info Box */}
  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4 mb-4">
    <div className="flex items-start gap-3">
      <TrendingUp className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-purple-400 font-medium text-sm mb-1">Creation vs Execution Balance</p>
        <p className="text-slate-300 text-sm leading-relaxed">
          <strong className="text-white">Creation Weight (30% default):</strong> How much to trust the agent's design complexity (workflow structure, plugins, I/O schema).
          <strong className="text-white ml-2">Execution Weight (70% default):</strong> How much to trust runtime behavior (token usage, performance, failures).
          Higher execution weight = more adaptive to actual behavior. Higher creation weight = more trust in design estimates.
        </p>
      </div>
    </div>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">Creation Score Weight</label>
      <input
        type="number"
        value={combinedWeights.creation}
        onChange={(e) => setCombinedWeights({ ...combinedWeights, creation: parseFloat(e.target.value) || 0 })}
        min="0"
        max="1"
        step="0.05"
        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
      />
      <p className="text-xs text-slate-500">
        Trust in design complexity. Higher = prioritize agent structure over runtime behavior.
      </p>
    </div>

    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">Execution Score Weight</label>
      <input
        type="number"
        value={combinedWeights.execution}
        onChange={(e) => setCombinedWeights({ ...combinedWeights, execution: parseFloat(e.target.value) || 0 })}
        min="0"
        max="1"
        step="0.05"
        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
      />
      <p className="text-xs text-slate-500">
        Trust in runtime behavior. Higher = prioritize actual performance over design estimates.
      </p>
    </div>
  </div>
</div>
```

**Update Save Handler:**
```typescript
// In handleSaveWeights() or similar
const payload = {
  weights: {
    ...aisWeights,
    // Add combined weights
    combined_creation: combinedWeights.creation,
    combined_execution: combinedWeights.execution
  }
};
```

**Backend API:** Update `/app/api/admin/ais-weights/route.ts`

**Add to configMap:**
```typescript
const configMap: Record<string, string> = {
  // ... existing mappings ...
  combined_creation: 'ais_combined_weight_creation',
  combined_execution: 'ais_combined_weight_execution'
};
```

---

### Phase 2: Fix Memory Complexity Calculation 🔴 CRITICAL

**Goal:** Make memory complexity fully database-driven

**Estimated Effort:** 4-6 hours

---

#### Step 2.1: Add Memory Ranges to Database

**Database Migration:**
```sql
-- Add to ais_normalization_ranges table
INSERT INTO ais_normalization_ranges (category, subcategory, range_key, min_value, max_value, description)
VALUES
  ('memory_complexity', 'memory_ratio', 'memory_ratio', 0.0, 0.9, 'Memory tokens as percentage of total input (0-90%). Higher ratio = more memory-dependent.'),
  ('memory_complexity', 'memory_diversity', 'memory_diversity', 0, 3, 'Number of memory types used (summaries, user_context, patterns). More types = sophisticated orchestration.'),
  ('memory_complexity', 'memory_volume', 'memory_volume', 0, 20, 'Total number of memory entries loaded. More entries = larger context window and retrieval complexity.');
```

---

#### Step 2.2: Load Memory Ranges from AISConfigService

**File:** `/lib/services/AISConfigService.ts`

**Modify getRanges() Method:**

**Add to Return Type:**
```typescript
interface AISRanges {
  // ... existing ranges ...

  // NEW: Memory complexity ranges
  memory_ratio: { min: number; max: number };
  memory_diversity: { min: number; max: number };
  memory_volume: { min: number; max: number };
}
```

**Load from Database:**
```typescript
// Inside getRanges() method
const memoryRatioRange = rangesData.find(r => r.range_key === 'memory_ratio');
const memoryDiversityRange = rangesData.find(r => r.range_key === 'memory_diversity');
const memoryVolumeRange = rangesData.find(r => r.range_key === 'memory_volume');

return {
  // ... existing ranges ...

  // Memory complexity ranges
  memory_ratio: memoryRatioRange
    ? { min: memoryRatioRange.min_value, max: memoryRatioRange.max_value }
    : { min: 0.0, max: 0.9 },  // Fallback
  memory_diversity: memoryDiversityRange
    ? { min: memoryDiversityRange.min_value, max: memoryDiversityRange.max_value }
    : { min: 0, max: 3 },  // Fallback
  memory_volume: memoryVolumeRange
    ? { min: memoryVolumeRange.min_value, max: memoryVolumeRange.max_value }
    : { min: 0, max: 20 }  // Fallback
};
```

---

#### Step 2.3: Update calculateMemoryComplexity Function

**File:** `/lib/utils/updateAgentIntensity.ts`

**Change Lines 543-584 FROM:**
```typescript
async function calculateMemoryComplexity(
  memoryTokens: number,
  totalInputTokens: number,
  memoryEntryCount: number,
  memoryTypeDiversity: number,
  ranges: AISRanges
): Promise<number> {
  if (memoryTokens === 0 || totalInputTokens === 0) {
    return 0;
  }

  // HARDCODED RANGES (BAD)
  const ratioRange = { min: 0.0, max: 0.9 };
  const diversityRange = { min: 0, max: 3 };
  const volumeRange = { min: 0, max: 20 };

  const memoryRatio = Math.min(memoryTokens / totalInputTokens, 1.0);
  const ratioScore = AISConfigService.normalize(memoryRatio, ratioRange);
  const diversityScore = AISConfigService.normalize(memoryTypeDiversity, diversityRange);
  const volumeScore = AISConfigService.normalize(memoryEntryCount, volumeRange);

  // HARDCODED WEIGHTS (BAD)
  const score = clamp(
    ratioScore * 0.5 +
    diversityScore * 0.3 +
    volumeScore * 0.2,
    0,
    10
  );

  return score;
}
```

**TO:**
```typescript
async function calculateMemoryComplexity(
  memoryTokens: number,
  totalInputTokens: number,
  memoryEntryCount: number,
  memoryTypeDiversity: number,
  ranges: AISRanges,
  supabase: SupabaseClient  // NEW PARAMETER
): Promise<number> {
  if (memoryTokens === 0 || totalInputTokens === 0) {
    return 0;
  }

  // Load ranges from database (passed via ranges parameter)
  const ratioRange = ranges.memory_ratio;
  const diversityRange = ranges.memory_diversity;
  const volumeRange = ranges.memory_volume;

  const memoryRatio = Math.min(memoryTokens / totalInputTokens, 1.0);
  const ratioScore = AISConfigService.normalize(memoryRatio, ratioRange);
  const diversityScore = AISConfigService.normalize(memoryTypeDiversity, diversityRange);
  const volumeScore = AISConfigService.normalize(memoryEntryCount, volumeRange);

  // Load weights from database
  const memoryWeights = await AISConfigService.getScoringWeights(supabase, 'memory_complexity');

  // Use database weights with fallbacks
  const ratioWeight = memoryWeights.ratio || 0.5;
  const diversityWeight = memoryWeights.diversity || 0.3;
  const volumeWeight = memoryWeights.volume || 0.2;

  const score = clamp(
    ratioScore * ratioWeight +
    diversityScore * diversityWeight +
    volumeScore * volumeWeight,
    0,
    10
  );

  console.log(`🧠 [Memory Complexity] Tokens: ${memoryTokens}/${totalInputTokens} (${(memoryRatio * 100).toFixed(1)}%), ` +
    `Entries: ${memoryEntryCount}, Types: ${memoryTypeDiversity}, ` +
    `Weights: ${ratioWeight}/${diversityWeight}/${volumeWeight}, Score: ${score.toFixed(2)}/10`);

  return score;
}
```

**Update Function Call (Line 186):**
```typescript
const memory_complexity_score = await calculateMemoryComplexity(
  currentMemoryTokens,
  execution.input_tokens || 0,
  memory_entry_count,
  memory_type_diversity,
  aisRanges,
  supabase  // NEW PARAMETER
);
```

---

#### Step 2.4: Add Memory Ranges to Admin UI

**File:** `/app/admin/ais-config/page.tsx`

**Add State for Memory Ranges:**
```typescript
const [memoryRanges, setMemoryRanges] = useState({
  memory_ratio: { min: 0.0, max: 0.9 },
  memory_diversity: { min: 0, max: 3 },
  memory_volume: { min: 0, max: 20 }
});
```

**Load from Database:**
```typescript
// In fetchConfig() function
if (data.config.ranges?.memory_complexity) {
  const memoryRanges = data.config.ranges.memory_complexity;
  setMemoryRanges({
    memory_ratio: memoryRanges.find(r => r.range_key === 'memory_ratio') || { min: 0.0, max: 0.9 },
    memory_diversity: memoryRanges.find(r => r.range_key === 'memory_diversity') || { min: 0, max: 3 },
    memory_volume: memoryRanges.find(r => r.range_key === 'memory_volume') || { min: 0, max: 20 }
  });
}
```

**Add UI Section (in Agent Execution Ranges area):**
```tsx
{/* Memory Complexity */}
{config.ranges?.memory_complexity && (
  <details className="bg-slate-800/50 border border-slate-700 rounded-lg">
    <summary className="cursor-pointer p-4 hover:bg-slate-700/30 transition-colors">
      <div className="flex items-center gap-3">
        <Brain className="w-5 h-5 text-pink-400" />
        <span className="font-medium text-white">Memory Complexity</span>
        <span className="ml-auto text-xs text-slate-400">
          {config.ranges.memory_complexity.length} ranges
        </span>
      </div>
    </summary>

    <div className="p-4 pt-0 space-y-4">
      {/* Memory Ranges Info Box */}
      <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Brain className="w-5 h-5 text-pink-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-pink-400 font-medium text-sm mb-1">Memory Context Usage Ranges</p>
            <p className="text-slate-300 text-sm leading-relaxed">
              Memory complexity measures how agents leverage historical context. These ranges normalize memory metrics to 0-10 scale.
              <strong className="text-white">Lower max values = more sensitive to memory usage.</strong>
              If your agents consistently max out memory scores, increase the max values.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Memory Ratio */}
        <div className="bg-slate-700/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-white mb-2">Memory Ratio (memory tokens / total input)</h4>
          <p className="text-xs text-slate-400 mb-3">
            Percentage of input that is memory context. Higher ratio = more memory-dependent agent.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400">Min (0.0 = no memory)</label>
              <input
                type="number"
                value={memoryRanges.memory_ratio.min}
                onChange={(e) => setMemoryRanges({
                  ...memoryRanges,
                  memory_ratio: { ...memoryRanges.memory_ratio, min: parseFloat(e.target.value) || 0 }
                })}
                step="0.1"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Max (0.9 = 90% memory)</label>
              <input
                type="number"
                value={memoryRanges.memory_ratio.max}
                onChange={(e) => setMemoryRanges({
                  ...memoryRanges,
                  memory_ratio: { ...memoryRanges.memory_ratio, max: parseFloat(e.target.value) || 0 }
                })}
                step="0.1"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
          </div>
        </div>

        {/* Memory Diversity */}
        <div className="bg-slate-700/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-white mb-2">Memory Type Diversity</h4>
          <p className="text-xs text-slate-400 mb-3">
            Number of different memory types used (summaries, user_context, patterns, etc.).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400">Min (0 types)</label>
              <input
                type="number"
                value={memoryRanges.memory_diversity.min}
                onChange={(e) => setMemoryRanges({
                  ...memoryRanges,
                  memory_diversity: { ...memoryRanges.memory_diversity, min: parseInt(e.target.value) || 0 }
                })}
                step="1"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Max (3+ types)</label>
              <input
                type="number"
                value={memoryRanges.memory_diversity.max}
                onChange={(e) => setMemoryRanges({
                  ...memoryRanges,
                  memory_diversity: { ...memoryRanges.memory_diversity, max: parseInt(e.target.value) || 0 }
                })}
                step="1"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
          </div>
        </div>

        {/* Memory Volume */}
        <div className="bg-slate-700/30 rounded-lg p-4">
          <h4 className="text-sm font-medium text-white mb-2">Memory Entry Volume</h4>
          <p className="text-xs text-slate-400 mb-3">
            Total number of memory entries loaded per execution. More entries = larger context.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400">Min (0 entries)</label>
              <input
                type="number"
                value={memoryRanges.memory_volume.min}
                onChange={(e) => setMemoryRanges({
                  ...memoryRanges,
                  memory_volume: { ...memoryRanges.memory_volume, min: parseInt(e.target.value) || 0 }
                })}
                step="1"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Max (20+ entries)</label>
              <input
                type="number"
                value={memoryRanges.memory_volume.max}
                onChange={(e) => setMemoryRanges({
                  ...memoryRanges,
                  memory_volume: { ...memoryRanges.memory_volume, max: parseInt(e.target.value) || 0 }
                })}
                step="1"
                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </details>
)}
```

**Backend API:** Update `/app/api/admin/ais-config/route.ts`

**Add Memory Ranges to GET Response:**
```typescript
// In GET handler, load memory ranges
const { data: memoryRangesData } = await supabaseServiceRole
  .from('ais_normalization_ranges')
  .select('*')
  .eq('category', 'memory_complexity');

// Include in response
return NextResponse.json({
  config: {
    // ... existing config ...
    ranges: {
      // ... existing ranges ...
      memory_complexity: memoryRangesData || []
    }
  }
});
```

**Add Memory Ranges to POST Handler:**
```typescript
// In POST handler for updating ranges
if (action === 'update_ranges') {
  // ... existing range updates ...

  // Update memory ranges
  if (body.memoryRanges) {
    await supabaseServiceRole
      .from('ais_normalization_ranges')
      .upsert({
        category: 'memory_complexity',
        subcategory: 'memory_ratio',
        range_key: 'memory_ratio',
        min_value: body.memoryRanges.memory_ratio.min,
        max_value: body.memoryRanges.memory_ratio.max
      }, { onConflict: 'range_key' });

    // Similar for memory_diversity and memory_volume
  }
}
```

---

### Phase 3: Fix Agent-Level Routing Model Configuration 🟡 HIGH PRIORITY

**Goal:** Make agent-level routing model names database-driven (matching per-step routing)

**Estimated Effort:** 4-6 hours

---

#### Step 3.1: Add Model Configuration to Database

**Database Migration:**
```sql
-- Add to system_settings_config table
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('routing_tier1_model', '{"model": "gpt-4o-mini", "provider": "openai"}', 'routing', 'Tier 1 model for low complexity agents (score 0-3.9)'),
  ('routing_tier2_model', '{"model": "claude-3-5-haiku-20241022", "provider": "anthropic"}', 'routing', 'Tier 2 model for medium complexity agents (score 4.0-6.9)'),
  ('routing_tier3_model', '{"model": "gpt-4o", "provider": "openai"}', 'routing', 'Tier 3 model for high complexity agents (score 7.0-10.0)');
```

---

#### Step 3.2: Load Models from SystemConfigService

**File:** `/lib/services/SystemConfigService.ts`

**Extend getRoutingConfig() Method:**
```typescript
static async getRoutingConfig(supabase: SupabaseClient) {
  const [
    enabled,
    lowThreshold,
    mediumThreshold,
    minExecutions,
    minSuccessRate,
    anthropicEnabled,
    // NEW: Load model configurations
    tier1ModelRaw,
    tier2ModelRaw,
    tier3ModelRaw
  ] = await Promise.all([
    this.getBoolean(supabase, 'intelligent_routing_enabled', false),
    this.getNumber(supabase, 'routing_low_threshold', 3.9),
    this.getNumber(supabase, 'routing_medium_threshold', 6.9),
    this.getNumber(supabase, 'routing_min_executions', 3),
    this.getNumber(supabase, 'routing_min_success_rate', 85),
    this.getBoolean(supabase, 'anthropic_provider_enabled', true),
    // NEW: Model configs
    this.get(supabase, 'routing_tier1_model', { model: 'gpt-4o-mini', provider: 'openai' }),
    this.get(supabase, 'routing_tier2_model', { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' }),
    this.get(supabase, 'routing_tier3_model', { model: 'gpt-4o', provider: 'openai' })
  ]);

  // Parse model configs (they're stored as JSON)
  const tier1Model = typeof tier1ModelRaw === 'string' ? JSON.parse(tier1ModelRaw) : tier1ModelRaw;
  const tier2Model = typeof tier2ModelRaw === 'string' ? JSON.parse(tier2ModelRaw) : tier2ModelRaw;
  const tier3Model = typeof tier3ModelRaw === 'string' ? JSON.parse(tier3ModelRaw) : tier3ModelRaw;

  return {
    enabled,
    lowThreshold,
    mediumThreshold,
    minExecutions,
    minSuccessRate,
    anthropicEnabled,
    // NEW: Include model configs
    models: {
      tier1: tier1Model,
      tier2: tier2Model,
      tier3: tier3Model
    }
  };
}
```

---

#### Step 3.3: Update ModelRouter to Use Database Models

**File:** `/lib/ai/modelRouter.ts`

**Keep DEFAULT_CONFIG as Emergency Fallback:**
```typescript
// EMERGENCY FALLBACK ONLY - Use database values via SystemConfigService
private static readonly DEFAULT_CONFIG = {
  low: {
    model: 'gpt-4o-mini',
    provider: 'openai' as const
  },
  medium: {
    model: 'claude-3-5-haiku-20241022',
    provider: 'anthropic' as const
  },
  high: {
    model: 'gpt-4o',
    provider: 'openai' as const
  }
};
```

**Update selectModel() Method (Lines 52-147):**

**FROM:**
```typescript
const routingConfig = await SystemConfigService.getRoutingConfig(supabase);
const lowThreshold = routingConfig.lowThreshold;
const mediumThreshold = routingConfig.mediumThreshold;

// ... routing logic using DEFAULT_CONFIG ...

if (score <= lowThreshold) {
  return {
    model: 'gpt-4o-mini',  // HARDCODED
    provider: 'openai',    // HARDCODED
    reasoning: `Low complexity (score: ${score})`
  };
}
```

**TO:**
```typescript
const routingConfig = await SystemConfigService.getRoutingConfig(supabase);
const lowThreshold = routingConfig.lowThreshold;
const mediumThreshold = routingConfig.mediumThreshold;

// Load model configs from database (with fallback)
const tier1Model = routingConfig.models?.tier1 || this.DEFAULT_CONFIG.low;
const tier2Model = routingConfig.models?.tier2 || this.DEFAULT_CONFIG.medium;
const tier3Model = routingConfig.models?.tier3 || this.DEFAULT_CONFIG.high;

// Add bounds checking
const boundedScore = Math.max(0, Math.min(10, score));

// ... routing logic using database models ...

if (boundedScore <= lowThreshold) {
  return {
    model: tier1Model.model,      // FROM DATABASE
    provider: tier1Model.provider, // FROM DATABASE
    reasoning: `Low complexity (score: ${boundedScore.toFixed(1)})`
  };
} else if (boundedScore <= mediumThreshold) {
  if (anthropicEnabled) {
    return {
      model: tier2Model.model,      // FROM DATABASE
      provider: tier2Model.provider, // FROM DATABASE
      reasoning: `Medium complexity (score: ${boundedScore.toFixed(1)})`
    };
  } else {
    // FIX: Fallback to Tier 3 instead of Tier 1
    return {
      model: tier3Model.model,      // FROM DATABASE (fixed fallback)
      provider: tier3Model.provider,
      reasoning: `Medium complexity (score: ${boundedScore.toFixed(1)}) - Anthropic disabled, using premium model`
    };
  }
} else {
  return {
    model: tier3Model.model,      // FROM DATABASE
    provider: tier3Model.provider, // FROM DATABASE
    reasoning: `High complexity (score: ${boundedScore.toFixed(1)})`
  };
}
```

---

#### Step 3.4: Add Safety Improvements

**Add Minimum Sample Size Check:**
```typescript
// BEFORE success rate check
const MIN_SAMPLE_SIZE = 5;

if (totalExecutions >= MIN_SAMPLE_SIZE && successRate < minSuccessRate) {
  return {
    model: tier3Model.model,
    provider: tier3Model.provider,
    reasoning: `Low success rate (${successRate.toFixed(1)}% over ${totalExecutions} runs) - upgrading for reliability`,
    intensity_score: boundedScore
  };
}
```

**Remove Dead Environment Variable Code:**
```typescript
// DELETE Lines 214-238
// These methods reference unused environment variables

// static isRoutingEnabled(): boolean { ... }  // DELETE
// static getConfig() { ... }                  // DELETE
```

---

#### Step 3.5: Add Admin UI for Routing Models

**File:** `/app/admin/ais-config/page.tsx`

**Add New Section (create new "Routing Configuration" page or add to existing):**

```tsx
{/* Agent-Level Routing Model Configuration */}
<div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
  <h3 className="text-lg font-semibold text-white mb-4">
    Agent-Level Routing Model Configuration
  </h3>

  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
    <p className="text-slate-300 text-sm">
      Configure which models are used for each complexity tier in agent-level routing.
      Changes take effect immediately for new agent executions.
    </p>
  </div>

  <div className="space-y-4">
    {/* Tier 1 */}
    <div className="bg-slate-700/30 rounded-lg p-4">
      <h4 className="text-sm font-medium text-white mb-2">
        Tier 1: Low Complexity (Score 0-3.9)
      </h4>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-slate-400">Model Name</label>
          <input
            type="text"
            value={routingModels.tier1.model}
            onChange={(e) => setRoutingModels({
              ...routingModels,
              tier1: { ...routingModels.tier1, model: e.target.value }
            })}
            className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
            placeholder="gpt-4o-mini"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Provider</label>
          <select
            value={routingModels.tier1.provider}
            onChange={(e) => setRoutingModels({
              ...routingModels,
              tier1: { ...routingModels.tier1, provider: e.target.value }
            })}
            className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
      </div>
    </div>

    {/* Similar for Tier 2 and Tier 3 */}
  </div>
</div>
```

---

## Implementation Timeline

### Week 1: Critical Fixes (Phases 1-2)

#### **Day 1-2: Phase 1 - Main Dimension Weights**
- [ ] Add `getExecutionWeights()` to AISConfigService
- [ ] Update `updateAgentIntensity.ts` to load weights from database
- [ ] Update `AgentIntensityService.ts` to load weights from database
- [ ] Update `intensity.ts` constants to be fallbacks only
- [ ] Test: Change token weight in admin → Verify calculation changes

#### **Day 3: Phase 1 - Combined Weights**
- [ ] Add database rows for combined weights
- [ ] Add `getCombinedWeights()` to AISConfigService
- [ ] Update combined score calculation to use database
- [ ] Add admin UI section for combined weights
- [ ] Update `/api/admin/ais-weights` to handle combined weights
- [ ] Test: Change creation/execution blend → Verify combined score changes

#### **Day 4: Phase 2 - Memory Ranges**
- [ ] Add memory ranges to `ais_normalization_ranges` table
- [ ] Update `AISConfigService.getRanges()` to include memory ranges
- [ ] Update `calculateMemoryComplexity()` to use database ranges
- [ ] Test: Change memory ratio max → Verify normalization changes

#### **Day 5: Phase 2 - Memory Weights**
- [ ] Update `calculateMemoryComplexity()` to load weights from database
- [ ] Add admin UI for memory ranges
- [ ] Update `/api/admin/ais-config` GET/POST for memory ranges
- [ ] **Full Testing Day**: Verify all Phase 1-2 changes work end-to-end

---

### Week 2: Routing Improvements (Phase 3)

#### **Day 6-7: Phase 3 - Routing Models**
- [ ] Add routing model config to `system_settings_config` table
- [ ] Extend `SystemConfigService.getRoutingConfig()` to load models
- [ ] Update `ModelRouter.selectModel()` to use database models
- [ ] Keep DEFAULT_CONFIG as emergency fallback

#### **Day 8: Phase 3 - Safety & Cleanup**
- [ ] Add bounds checking (clamp scores 0-10)
- [ ] Fix Anthropic fallback (Tier 2 → Tier 3 instead of Tier 1)
- [ ] Add minimum sample size check (>= 5 executions)
- [ ] Remove dead environment variable code

#### **Day 9: Phase 3 - Admin UI**
- [ ] Add admin UI for routing model configuration
- [ ] Update save handlers to persist routing models
- [ ] Test: Change Tier 1 model → Verify agent uses new model

#### **Day 10: End-to-End Testing & Documentation**
- [ ] **Integration Testing**: Test all phases together
- [ ] **Regression Testing**: Verify existing functionality still works
- [ ] **Performance Testing**: Check caching and query performance
- [ ] **Documentation**: Update admin guide and developer docs

---

## Testing Strategy

### Unit Tests (Per Phase)

#### **Phase 1 Tests:**
```typescript
describe('AIS Execution Weights', () => {
  it('should load weights from database', async () => {
    // Arrange: Set weights in database
    await setDatabaseWeights({
      tokens: 0.40,
      execution: 0.30,
      plugins: 0.15,
      workflow: 0.10,
      memory: 0.05
    });

    // Act: Calculate execution score
    const score = await calculateExecutionScore(...);

    // Assert: Verify weights were used
    expect(score).toBeCloseTo(expectedScore, 2);
  });

  it('should use fallback weights if database unavailable', async () => {
    // Test fallback behavior
  });
});

describe('AIS Combined Weights', () => {
  it('should blend creation and execution scores correctly', async () => {
    // Test 30/70, 50/50, 70/30 blends
  });
});
```

#### **Phase 2 Tests:**
```typescript
describe('Memory Complexity', () => {
  it('should use database ranges for normalization', async () => {
    // Test with different range values
  });

  it('should use database weights for subdimensions', async () => {
    // Test with different weight combinations
  });
});
```

#### **Phase 3 Tests:**
```typescript
describe('Agent-Level Routing', () => {
  it('should use database model configurations', async () => {
    // Test Tier 1, 2, 3 model selection
  });

  it('should apply bounds checking to scores', async () => {
    // Test scores < 0 and > 10
  });

  it('should require minimum sample size for quality override', async () => {
    // Test with 1, 5, 10 executions
  });
});
```

---

### Integration Tests (End-to-End)

```typescript
describe('AIS System Integration', () => {
  it('should route agent based on database-driven AIS score', async () => {
    // 1. Create agent
    // 2. Change AIS weights in database
    // 3. Execute agent
    // 4. Verify routing used new weights
  });

  it('should handle admin UI changes immediately', async () => {
    // 1. Change weights via admin UI
    // 2. Wait for cache invalidation
    // 3. Execute agent
    // 4. Verify new weights applied
  });
});
```

---

### Manual Testing Checklist

#### **Phase 1 Manual Tests:**
- [ ] Change token weight from 30% to 40% in admin UI
- [ ] Run agent with high token usage
- [ ] Check `agent_intensity_metrics.execution_score` increased
- [ ] Check routing decision uses higher score

#### **Phase 2 Manual Tests:**
- [ ] Change memory ratio max from 0.9 to 0.6
- [ ] Run agent with memory usage
- [ ] Check `agent_intensity_metrics.memory_complexity_score` normalized differently
- [ ] Verify memory weights (50/30/20) affect calculation

#### **Phase 3 Manual Tests:**
- [ ] Change Tier 1 model from gpt-4o-mini to gpt-3.5-turbo
- [ ] Run low-complexity agent (score 2.0)
- [ ] Check `token_usage.model` = gpt-3.5-turbo
- [ ] Check audit log shows correct model and reasoning

---

## Expected Outcomes

### After Phase 1-2 (Critical Fixes)

#### **Immediate Benefits:**
✅ **All admin UI controls will actually work**
- Dimension weight changes affect calculations
- Combined weight changes affect score blending
- Memory weight changes affect memory complexity

✅ **System becomes tunable to business needs**
- Prioritize token efficiency → Increase token weight
- Prioritize reliability → Increase execution weight
- Trust design more → Adjust creation/execution blend

✅ **Cost optimization becomes possible**
- Tune weights to match actual model costs
- Adjust ranges to better distribute across tiers
- Fine-tune memory sensitivity

#### **Example Cost Impact:**
```
Current (hardcoded):
→ Token weight: 30% (fixed)
→ 1000 agents route to Tier 2 (medium)
→ Average cost: $0.08 per execution
→ Monthly cost: $80,000

After tuning (database-driven):
→ Token weight: 40% (increased priority on efficiency)
→ 300 agents downgrade to Tier 1 (low)
→ 700 agents stay in Tier 2
→ Tier 1 cost: $0.01 per execution
→ Tier 2 cost: $0.08 per execution
→ New monthly cost: $56,300
→ Savings: $23,700/month (29% reduction)
```

---

### After Phase 3 (Routing Model Configuration)

#### **Additional Benefits:**
✅ **Rapid model updates without deployment**
- New model releases → Update in admin → Live in seconds
- A/B test different models → Change config → Compare results
- Emergency model switch → No code deployment needed

✅ **Consistent admin experience**
- Agent-level routing matches per-step routing
- All routing configuration in one place
- Clear visibility into what models are being used

✅ **Safety improvements prevent edge cases**
- Bounds checking prevents invalid scores
- Minimum sample size prevents hasty upgrades
- Better fallback logic (Tier 2 → Tier 3, not Tier 1)

---

### Business Impact Summary

#### **Cost Savings:**
- **Estimated 20-30% reduction** in AI model costs through proper tuning
- Based on current monthly spend, this could mean **$50,000-100,000/month savings**

#### **Operational Efficiency:**
- **99% reduction in deployment time** for model changes (days → minutes)
- **Faster experimentation** with different routing strategies
- **Better observability** of what's actually driving costs

#### **System Quality:**
- **Improved reliability** through better quality overrides
- **Better model matching** to actual task complexity
- **Adaptive learning** through routing memory (already implemented for per-step)

---

## Appendices

### Appendix A: Database Schema Changes

```sql
-- Phase 1: Combined weights
ALTER TABLE ais_system_config ADD COLUMN IF NOT EXISTS config_value NUMERIC;

INSERT INTO ais_system_config (config_key, config_value, description, category)
VALUES
  ('ais_combined_weight_creation', 0.3, 'Creation score weight in combined score', 'ais_dimension_weights'),
  ('ais_combined_weight_execution', 0.7, 'Execution score weight in combined score', 'ais_dimension_weights')
ON CONFLICT (config_key) DO NOTHING;

-- Phase 2: Memory ranges
INSERT INTO ais_normalization_ranges (category, subcategory, range_key, min_value, max_value, description)
VALUES
  ('memory_complexity', 'memory_ratio', 'memory_ratio', 0.0, 0.9, 'Memory tokens / total input (0-90%)'),
  ('memory_complexity', 'memory_diversity', 'memory_diversity', 0, 3, 'Number of memory types used'),
  ('memory_complexity', 'memory_volume', 'memory_volume', 0, 20, 'Total memory entries loaded')
ON CONFLICT (range_key) DO NOTHING;

-- Phase 3: Routing models
INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('routing_tier1_model', '{"model": "gpt-4o-mini", "provider": "openai"}', 'routing', 'Low complexity model'),
  ('routing_tier2_model', '{"model": "claude-3-5-haiku-20241022", "provider": "anthropic"}', 'routing', 'Medium complexity model'),
  ('routing_tier3_model', '{"model": "gpt-4o", "provider": "openai"}', 'routing', 'High complexity model')
ON CONFLICT (key) DO NOTHING;
```

---

### Appendix B: File Modification Summary

| File | Lines Changed | Type | Phase |
|------|---------------|------|-------|
| `/lib/services/AISConfigService.ts` | +80 | Add methods | 1, 2 |
| `/lib/utils/updateAgentIntensity.ts` | ~30 | Update calls | 1, 2 |
| `/lib/services/AgentIntensityService.ts` | ~20 | Update calls | 1 |
| `/lib/types/intensity.ts` | ~10 | Deprecate constants | 1 |
| `/lib/ai/modelRouter.ts` | ~60 | Database models | 3 |
| `/app/admin/ais-config/page.tsx` | +200 | UI sections | 1, 2, 3 |
| `/app/api/admin/ais-weights/route.ts` | +5 | New mappings | 1 |
| `/app/api/admin/ais-config/route.ts` | +50 | Memory ranges | 2 |
| **Total** | **~455 lines** | **8 files** | **3 phases** |

---

### Appendix C: Rollback Plan

If issues arise during implementation:

#### **Phase 1 Rollback:**
```typescript
// Revert to constants by commenting out database loads
// const executionWeights = await AISConfigService.getExecutionWeights(supabase);
const executionWeights = EXECUTION_WEIGHTS; // Use constants

// Similar for combined weights
const combinedWeights = COMBINED_WEIGHTS; // Use constants
```

#### **Phase 2 Rollback:**
```typescript
// Revert to hardcoded ranges
const ratioRange = { min: 0.0, max: 0.9 };  // Hardcoded
const diversityRange = { min: 0, max: 3 };   // Hardcoded
const volumeRange = { min: 0, max: 20 };     // Hardcoded

// Revert to hardcoded weights
const score = clamp(
  ratioScore * 0.5 +
  diversityScore * 0.3 +
  volumeScore * 0.2,
  0,
  10
);
```

#### **Phase 3 Rollback:**
```typescript
// Revert to DEFAULT_CONFIG
const tier1Model = this.DEFAULT_CONFIG.low;
const tier2Model = this.DEFAULT_CONFIG.medium;
const tier3Model = this.DEFAULT_CONFIG.high;
```

---

### Appendix D: Performance Considerations

#### **Caching Strategy:**
- `AISConfigService` has 5-minute TTL cache
- `SystemConfigService` has 5-minute TTL cache
- Weights/ranges loaded once, cached for 5 minutes
- Cache invalidation on admin updates

#### **Database Query Overhead:**
- Phase 1: +1 query per execution (cached)
- Phase 2: +1 query per execution (cached, included in ranges)
- Phase 3: +1 query per execution (cached)
- Total overhead: <10ms per execution (amortized by cache)

#### **Load Testing Targets:**
- 1000 concurrent agent executions
- Cache hit rate > 95%
- P95 latency < 50ms for routing decision
- No database connection exhaustion

---

## Conclusion

This refactoring plan completes the AIS system's migration to database-driven configuration, making it fully functional and cost-optimizing. The system already has excellent architecture with centralized config services - we just need to finish connecting all the pieces.

**Total Effort:** 14-20 hours
**Expected ROI:** 20-30% cost reduction = $50,000-100,000/month savings
**Risk:** Low (changes are incremental, each phase can be rolled back)
**Priority:** CRITICAL (admin UI currently misleading, changes don't work)

---

**Next Steps:**
1. Review and approve this plan
2. Create feature branch: `feature/ais-complete-database-driven`
3. Begin Phase 1 implementation
4. Test each phase thoroughly before moving to next
5. Deploy to staging for full integration testing
6. Deploy to production with monitoring

---

**Document Version:** 1.0
**Last Updated:** 2025-11-07
**Status:** Ready for Implementation
**Approval Required:** Yes
