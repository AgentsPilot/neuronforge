# AIS (Agent Intensity System) - Complete System Guide

**Last Updated:** January 29, 2025
**Version:** 2.0 (Post-Hardcoding Elimination)

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Three Configuration Layers Explained](#three-configuration-layers-explained)
3. [Complete AIS Flow](#complete-ais-flow)
4. [Score Triggers & Automation](#score-triggers--automation)
5. [Manual Operations](#manual-operations)
6. [Database Tables Reference](#database-tables-reference)
7. [Configuration Management](#configuration-management)
8. [Example Scenarios](#example-scenarios)

---

## System Overview

The AIS (Agent Intensity System) calculates a **complexity score (0-10)** for each agent, which determines the **pricing multiplier (1.0x - 2.0x)**.

### Formula:
```
Pricing Multiplier = 1.0 + (Intensity Score / 10)

Example:
- Agent with score 0.0 → 1.0x multiplier (minimum pricing)
- Agent with score 5.0 → 1.5x multiplier (average pricing)
- Agent with score 10.0 → 2.0x multiplier (maximum pricing)
```

### Three Types of Scores:

1. **Creation Score (0-10)** - Based on agent DESIGN complexity
   - Calculated: Once at agent creation
   - Factors: Workflow steps, plugins, I/O schema, triggers
   - Weight: 30% of combined score

2. **Execution Score (0-10)** - Based on actual RUNTIME complexity
   - Calculated: After each agent execution (updated dynamically)
   - Factors: Token usage, duration, failures, iterations
   - Weight: 70% of combined score

3. **Combined Score (0-10)** - Overall intensity
   - Formula: `(Creation Score × 0.3) + (Execution Score × 0.7)`
   - This is the score used for pricing

---

## Three Configuration Layers Explained

### Layer 1: Normalization Ranges 🎯

**Purpose:** Define the min/max boundaries for raw metrics

**Table:** `ais_normalization_ranges`

**What it does:**
- Takes raw metric values (e.g., 5000 tokens, 120 workflow steps)
- Normalizes them to a 0-10 scale
- Example: If `token_volume` range is [0 - 10000]:
  - 0 tokens → 0 score
  - 5000 tokens → 5 score
  - 10000 tokens → 10 score

**Key Columns:**
```sql
CREATE TABLE ais_normalization_ranges (
  range_key TEXT PRIMARY KEY,           -- e.g., 'token_volume', 'workflow_steps'
  best_practice_min NUMERIC,            -- Fixed minimum (expert-defined)
  best_practice_max NUMERIC,            -- Fixed maximum (expert-defined)
  dynamic_min NUMERIC,                  -- Auto-calculated from production data
  dynamic_max NUMERIC,                  -- Auto-calculated from production data
  active_mode INTEGER,                  -- 0 = use best_practice, 1 = use dynamic
  category TEXT                         -- 'execution' or 'creation'
);
```

**Example Ranges:**
| Range Key | Best Practice | Dynamic | Active Mode | Meaning |
|-----------|---------------|---------|-------------|---------|
| `token_volume` | 0 - 5000 | 0 - 8234 | 1 (dynamic) | "High token usage" = 8234+ tokens |
| `workflow_steps` | 1 - 20 | 1 - 15 | 0 (best practice) | "Complex workflow" = 20+ steps |
| `plugins_per_run` | 0 - 10 | 0 - 7 | 1 (dynamic) | "Many plugins" = 7+ plugins |

**When Updated:**
- Best Practice: Manually by admin (based on industry standards)
- Dynamic: Automatically refreshed by admin (uses actual production data)

**Who Uses This:**
- `AISConfigService.normalize()` - Converts raw values to 0-10 scores
- Every score calculation uses these ranges

---

### Layer 2: Scoring Weights ⚖️

**Purpose:** Define how much each factor matters in the final score

**Table:** `ais_scoring_weights`

**What it does:**
- Controls the **importance** of each metric in the calculation
- Example: If `token_volume` weight is 0.5 (50%) and `token_peak` is 0.3 (30%):
  - Token volume has MORE influence on the final token complexity score
  - Token peak has LESS influence

**Key Columns:**
```sql
CREATE TABLE ais_scoring_weights (
  component_key TEXT,      -- e.g., 'token_complexity', 'creation', 'execution'
  sub_component TEXT,      -- e.g., 'volume', 'peak', 'workflow' (or NULL for top-level)
  weight NUMERIC,          -- Between 0 and 1, must sum to 1.0 for each component
  category TEXT            -- 'creation', 'execution', or 'combined'
);
```

**Hierarchy of Weights:**

```
Combined Score (100%)
├── Creation Score (30% weight) ← from ais_scoring_weights
│   ├── Workflow Complexity (50% weight) ← from ais_scoring_weights
│   ├── Plugin Diversity (30% weight) ← from ais_scoring_weights
│   └── I/O Schema (20% weight) ← from ais_scoring_weights
│
└── Execution Score (70% weight) ← from ais_scoring_weights
    ├── Token Complexity (35% weight) ← from ais_scoring_weights
    │   ├── Volume (50% weight) ← from ais_scoring_weights
    │   ├── Peak (30% weight) ← from ais_scoring_weights
    │   └── Efficiency (20% weight) ← from ais_scoring_weights
    │
    ├── Execution Complexity (30% weight)
    │   ├── Iterations (35% weight)
    │   ├── Duration (30% weight)
    │   ├── Failures (20% weight)
    │   └── Retries (15% weight)
    │
    ├── Plugin Complexity (20% weight)
    │   ├── Count (40% weight)
    │   ├── Frequency (35% weight)
    │   └── Orchestration (25% weight)
    │
    └── Workflow Complexity (15% weight)
        ├── Steps (40% weight)
        ├── Branches (25% weight)
        ├── Loops (20% weight)
        └── Parallel (15% weight)
```

**Example Weights in Database:**
| Component | Sub-Component | Weight | Meaning |
|-----------|---------------|--------|---------|
| `creation` | `workflow` | 0.5 | Workflow is 50% of creation score |
| `creation` | `plugins` | 0.3 | Plugins are 30% of creation score |
| `creation` | `io_schema` | 0.2 | I/O is 20% of creation score |
| `token_complexity` | `volume` | 0.5 | Volume is 50% of token score |
| `token_complexity` | `peak` | 0.3 | Peak is 30% of token score |
| `combined_score` | `creation` | 0.3 | Creation is 30% of final score |
| `combined_score` | `execution` | 0.7 | Execution is 70% of final score |

**When Updated:**
- Manually by admin when tuning the scoring algorithm
- Example: "We want to prioritize token efficiency over volume"
  - Change `token_complexity.volume` from 0.5 → 0.3
  - Change `token_complexity.efficiency` from 0.2 → 0.4

**Who Uses This:**
- `AgentIntensityService.calculateCreationScores()` - Uses creation weights
- `AgentIntensityService.calculateComponentScores()` - Uses execution weights

---

### Layer 3: System Configuration 🔧

**Purpose:** Store system-wide settings (pricing, limits, constants)

**Table:** `ais_system_config`

**What it does:**
- Stores values that aren't part of scoring logic but affect the system
- Pricing configuration
- Business rules
- System limits

**Key Columns:**
```sql
CREATE TABLE ais_system_config (
  config_key TEXT PRIMARY KEY,
  config_value NUMERIC,
  description TEXT,
  category TEXT,           -- 'pricing', 'limits', etc.
  unit TEXT,              -- 'usd', 'credits', 'percent'
  min_value NUMERIC,      -- Validation
  max_value NUMERIC       -- Validation
);
```

**Example Configuration:**
| Config Key | Value | Unit | Purpose |
|------------|-------|------|---------|
| `pilot_credit_cost_usd` | 0.00048 | usd | How much 1 pilot credit costs |
| `min_subscription_usd` | 10.00 | usd | Minimum monthly subscription |
| `free_tier_credits` | 1000 | credits | Free credits for new users |
| `max_agent_intensity` | 10.0 | score | Maximum possible intensity score |
| `min_executions_for_score` | 5 | count | How many runs before execution score is valid |

**When Updated:**
- By admin when changing pricing or business rules
- Example: Change pilot credit cost from $0.00048 to $0.00050

**Who Uses This:**
- `AgentIntensityService.trackCreationCosts()` - Fetches `pilot_credit_cost_usd`
- `CreditService.createSubscription()` - Fetches pricing config
- `CreditService.updateSubscription()` - Fetches pricing config

---

## Visual Comparison

### How They Work Together:

```
┌─────────────────────────────────────────────────────────────────┐
│  EXAMPLE: Calculating Token Complexity Score                    │
└─────────────────────────────────────────────────────────────────┘

Step 1: Get Raw Metrics from Database
  Agent executed and used:
  - 6000 tokens total
  - 8000 peak tokens in one run
  - Input/output ratio: 2.5

Step 2: Normalize Using RANGES (Layer 1)
  ┌─────────────────────────────────────────────────────────────┐
  │ ais_normalization_ranges                                     │
  ├────────────────────┬────────────┬────────────┬──────────────┤
  │ Range Key          │ Min        │ Max        │ Result       │
  ├────────────────────┼────────────┼────────────┼──────────────┤
  │ token_volume       │ 0          │ 10000      │ 6.0 / 10     │
  │ token_peak         │ 0          │ 15000      │ 5.3 / 10     │
  │ token_io_ratio     │ 0.5        │ 5.0        │ 4.4 / 10     │
  └────────────────────┴────────────┴────────────┴──────────────┘

Step 3: Apply WEIGHTS (Layer 2)
  ┌─────────────────────────────────────────────────────────────┐
  │ ais_scoring_weights (component: token_complexity)            │
  ├────────────────────┬────────────┬─────────────────────────┤
  │ Sub-Component      │ Weight     │ Calculation             │
  ├────────────────────┼────────────┼─────────────────────────┤
  │ volume             │ 0.5 (50%)  │ 6.0 × 0.5 = 3.0        │
  │ peak               │ 0.3 (30%)  │ 5.3 × 0.3 = 1.59       │
  │ efficiency         │ 0.2 (20%)  │ 4.4 × 0.2 = 0.88       │
  └────────────────────┴────────────┴─────────────────────────┘

  Token Complexity Score = 3.0 + 1.59 + 0.88 = 5.47 / 10

Step 4: Combine with Other Execution Components
  ┌─────────────────────────────────────────────────────────────┐
  │ ais_scoring_weights (component: execution)                   │
  ├────────────────────┬────────────┬─────────────────────────┤
  │ Component          │ Weight     │ Score                   │
  ├────────────────────┼────────────┼─────────────────────────┤
  │ token_complexity   │ 0.35 (35%) │ 5.47 × 0.35 = 1.91     │
  │ exec_complexity    │ 0.30 (30%) │ 6.20 × 0.30 = 1.86     │
  │ plugin_complexity  │ 0.20 (20%) │ 4.50 × 0.20 = 0.90     │
  │ workflow_complex   │ 0.15 (15%) │ 3.80 × 0.15 = 0.57     │
  └────────────────────┴────────────┴─────────────────────────┘

  Execution Score = 1.91 + 1.86 + 0.90 + 0.57 = 5.24 / 10

Step 5: Combine with Creation Score
  ┌─────────────────────────────────────────────────────────────┐
  │ ais_scoring_weights (component: combined_score)              │
  ├────────────────────┬────────────┬─────────────────────────┤
  │ Component          │ Weight     │ Score                   │
  ├────────────────────┼────────────┼─────────────────────────┤
  │ creation           │ 0.3 (30%)  │ 6.50 × 0.30 = 1.95     │
  │ execution          │ 0.7 (70%)  │ 5.24 × 0.70 = 3.67     │
  └────────────────────┴────────────┴─────────────────────────┘

  Combined Score = 1.95 + 3.67 = 5.62 / 10

Step 6: Calculate Pricing Multiplier (NOT in database)
  Multiplier = 1.0 + (5.62 / 10) = 1.562x
```

---

## Complete AIS Flow

### Flow 1: Agent Creation (Automatic)

```
┌─────────────────────────────────────────────────────────────────┐
│ TRIGGER: User creates a new agent via AgentKit                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: AgentKit completes agent generation                     │
│   Location: lib/agentkit/runAgentKit.ts                         │
│   Data: tokens_used, workflow_steps, plugins, etc.              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: trackCreationCosts() is called                          │
│   Location: lib/services/AgentIntensityService.ts:70            │
│   Who Calls: app/api/create-agent/route.ts                      │
│   Trigger: AUTOMATIC                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Fetch configuration from database                       │
│   • Pilot credit cost (ais_system_config)                       │
│   • Normalization ranges (ais_normalization_ranges)             │
│   • Creation weights (ais_scoring_weights)                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Calculate CREATION SCORE (4 dimensions)                 │
│   • Workflow Complexity (from agent design)                     │
│   • Plugin Diversity (from connected plugins)                   │
│   • I/O Schema Complexity (from input/output fields)            │
│   • Trigger Type Bonus (scheduled/event-based)                  │
│                                                                  │
│   Uses:                                                          │
│   - Normalization ranges: creation_workflow_steps,              │
│     creation_plugins, creation_io_fields                        │
│   - Weights: creation.workflow (0.5), creation.plugins (0.3),   │
│     creation.io_schema (0.2)                                    │
│                                                                  │
│   Result: Creation Score = 6.5 / 10                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Calculate COMBINED SCORE (initial)                      │
│   Formula: (creation_score × 0.3) + (5.0 × 0.7)                │
│                                                                  │
│   Why 5.0 for execution? No execution data yet, use default.    │
│                                                                  │
│   Result: Combined Score = (6.5 × 0.3) + (5.0 × 0.7) = 5.45   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Store in database                                       │
│   Table: agent_intensity_metrics                                │
│   Columns:                                                       │
│     - creation_score = 6.5                                      │
│     - execution_score = 5.0 (default)                           │
│     - combined_score = 5.45                                     │
│     - creation_workflow = 7.2                                   │
│     - creation_plugins = 5.8                                    │
│     - creation_io_schema = 6.1                                  │
│     - creation_trigger = 1 (bonus)                              │
│     - creation_cost_usd = 0.384                                 │
│     - total_executions = 0                                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 7: Audit log                                               │
│   Event: AIS_SCORE_CALCULATED                                   │
│   Details: All scores, normalization ranges used                │
│   Location: audit_trail table                                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                         ✅ DONE
```

---

### Flow 2: Agent Execution (Automatic)

```
┌─────────────────────────────────────────────────────────────────┐
│ TRIGGER: User runs an agent                                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Agent executes                                          │
│   Location: app/api/run-agent/route.ts                          │
│   Data: tokens_used, duration, plugins_called, iterations, etc. │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: updateMetricsFromExecution() is called                  │
│   Location: lib/services/AgentIntensityService.ts:194           │
│   Who Calls: app/api/run-agent/route.ts (after execution)       │
│   Trigger: AUTOMATIC                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Get existing metrics                                    │
│   Fetch from: agent_intensity_metrics table                     │
│   Store old values for comparison                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Calculate updated metrics (rolling averages)            │
│   • Average tokens per run (rolling average)                    │
│   • Peak tokens (maximum seen)                                  │
│   • Average iterations                                          │
│   • Average duration                                            │
│   • Success rate (failures tracked)                             │
│   • Retry rate                                                  │
│   • Plugin usage patterns                                       │
│   • Workflow execution patterns                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Fetch configuration from database                       │
│   • Normalization ranges (ais_normalization_ranges)             │
│   • Execution weights (ais_scoring_weights) - 4 components:     │
│     - token_complexity (3 sub-weights)                          │
│     - execution_complexity (4 sub-weights)                      │
│     - plugin_complexity (3 sub-weights)                         │
│     - workflow_complexity (4 sub-weights)                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Calculate NEW EXECUTION SCORE (4 components)            │
│                                                                  │
│   Token Complexity (35% weight):                                │
│     - Volume score (50%) = 6.0                                  │
│     - Peak score (30%) = 5.3                                    │
│     - Efficiency score (20%) = 4.4                              │
│     → Token score = 5.47                                        │
│                                                                  │
│   Execution Complexity (30% weight):                            │
│     - Iterations (35%) = 7.2                                    │
│     - Duration (30%) = 5.8                                      │
│     - Failures (20%) = 2.0                                      │
│     - Retries (15%) = 1.5                                       │
│     → Exec score = 5.13                                         │
│                                                                  │
│   Plugin Complexity (20% weight):                               │
│     - Count (40%) = 6.5                                         │
│     - Frequency (35%) = 5.2                                     │
│     - Orchestration (25%) = 4.8                                 │
│     → Plugin score = 5.62                                       │
│                                                                  │
│   Workflow Complexity (15% weight):                             │
│     - Steps (40%) = 4.2                                         │
│     - Branches (25%) = 3.5                                      │
│     - Loops (20%) = 2.8                                         │
│     - Parallel (15%) = 1.2                                      │
│     → Workflow score = 3.31                                     │
│                                                                  │
│   Execution Score = (5.47×0.35) + (5.13×0.30) + (5.62×0.20)     │
│                     + (3.31×0.15) = 5.08 / 10                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 7: Calculate NEW COMBINED SCORE                            │
│   Formula: (creation_score × 0.3) + (execution_score × 0.7)    │
│                                                                  │
│   Combined Score = (6.5 × 0.3) + (5.08 × 0.7) = 5.506         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 8: Check if score changed significantly                    │
│   Old combined_score: 5.45                                      │
│   New combined_score: 5.506                                     │
│   Delta: 0.056 (> 0.01 threshold)                              │
│   → Yes, update needed                                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 9: Update database                                         │
│   Table: agent_intensity_metrics                                │
│   Updates:                                                       │
│     - execution_score = 5.08                                    │
│     - combined_score = 5.506                                    │
│     - token_complexity = 5.47                                   │
│     - execution_complexity = 5.13                               │
│     - plugin_complexity = 5.62                                  │
│     - workflow_complexity = 3.31                                │
│     - total_executions += 1                                     │
│     - all metric averages updated                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 10: Audit log (only if changed)                           │
│   Event: AIS_SCORE_UPDATED                                      │
│   Details:                                                       │
│     - before: {combined_score: 5.45, execution_score: 5.0}      │
│     - after: {combined_score: 5.506, execution_score: 5.08}     │
│     - delta: {combined_score: +0.056, execution_score: +0.08}   │
│     - normalization_ranges: {...}                               │
│     - reason: "Post-execution recalculation"                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                         ✅ DONE
```

---

### Flow 3: Normalization Refresh (Manual - Admin Only)

```
┌─────────────────────────────────────────────────────────────────┐
│ TRIGGER: Admin clicks "Refresh Normalization Ranges" button     │
│ Location: app/admin/ais-config/page.tsx                         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Capture BEFORE state (snapshot)                         │
│   API: POST /api/admin/ais-config (action: refresh_ranges)      │
│                                                                  │
│   Snapshot includes:                                             │
│   • All agent scores (15 agents)                                │
│   • Current normalization ranges (20 ranges)                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Audit log - Refresh Started                            │
│   Event: AIS_NORMALIZATION_REFRESH_STARTED                      │
│   Details:                                                       │
│     - old_ranges: [...] (20 ranges)                            │
│     - agent_scores_snapshot: [...] (15 agents)                  │
│     - reason: "Admin manual refresh via AIS Config dashboard"   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Execute stored procedure                                │
│   Procedure: update_dynamic_ais_ranges()                        │
│                                                                  │
│   What it does:                                                  │
│   • Queries all agent execution data                            │
│   • Calculates new min/max for each metric                      │
│   • Updates dynamic_min and dynamic_max in database             │
│                                                                  │
│   Example:                                                       │
│     Before: token_volume dynamic range = [0 - 8234]            │
│     After:  token_volume dynamic range = [0 - 9876]            │
│            (because agents are now using more tokens)           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Fetch new ranges                                        │
│   Table: ais_normalization_ranges                               │
│   New ranges captured for comparison                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Audit log - Refresh Completed                          │
│   Event: AIS_NORMALIZATION_REFRESH_COMPLETED                    │
│   Details:                                                       │
│     - old_ranges: [...] (before)                                │
│     - new_ranges: [...] (after)                                 │
│     - changes_detected: true                                    │
│                                                                  │
│   Example change:                                                │
│     {                                                            │
│       range_key: "token_volume",                                │
│       before: { min: 0, max: 8234 },                           │
│       after: { min: 0, max: 9876 },                            │
│       delta: { max: +1642 }                                     │
│     }                                                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Clear AIS cache                                         │
│   AISConfigService.clearCache()                                 │
│   • Next score calculation will fetch new ranges                │
│   • Scores update gradually as agents execute                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ IMPORTANT: Scores DON'T recalculate immediately                 │
│                                                                  │
│ Why? To avoid sudden pricing changes for all users.            │
│                                                                  │
│ Scores update naturally:                                         │
│   • Next time each agent executes → new execution score        │
│   • New ranges gradually influence calculations                 │
│   • Smooth transition instead of sudden jump                    │
│                                                                  │
│ Optional: Admin can manually trigger bulk recalculation        │
│   (Currently commented out in code for safety)                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                         ✅ DONE
```

---

## Score Triggers & Automation

### Automatic Triggers (No User Action Needed)

| Event | Trigger | Location | What Happens |
|-------|---------|----------|--------------|
| **Agent Created** | User completes agent generation | `app/api/create-agent/route.ts` | ✅ Creation score calculated immediately<br>✅ Combined score set (uses default execution score 5.0) |
| **Agent Executed** | User runs agent | `app/api/run-agent/route.ts` | ✅ Execution score recalculated<br>✅ Combined score updated<br>✅ Audit log (if changed) |
| **Agent Updated** | User modifies agent design | Not currently implemented | ⚠️ Future: Could trigger creation score recalc |

### Manual Triggers (Admin Only)

| Action | Who | Where | What Happens |
|--------|-----|-------|--------------|
| **Refresh Normalization Ranges** | Admin | `/admin/ais-config` | ✅ Updates dynamic min/max from production data<br>✅ Captures before/after snapshot<br>✅ Audit trail created<br>⚠️ Scores update on next execution (not immediate) |
| **Toggle Dynamic/Best Practice** | Admin | `/admin/ais-config` | ✅ Switches which ranges to use<br>✅ Affects all future calculations<br>⚠️ Existing scores unchanged until next execution |
| **Update System Config** | Admin | Database directly | ✅ Change pricing, limits, etc.<br>✅ Takes effect immediately |
| **Update Scoring Weights** | Admin | Database directly | ✅ Change formula weights<br>✅ Affects next score calculation |

---

## Manual Operations

### Operation 1: Refresh Normalization Ranges

**Purpose:** Update dynamic ranges based on current production data

**Steps:**
1. Navigate to `/admin/ais-config`
2. Scroll to "Dynamic Normalization Ranges" section
3. Click "Refresh Ranges" button
4. System captures snapshot and updates ranges
5. View results in Audit Trail (`/admin/audit-trail`)

**When to do this:**
- Monthly (recommended)
- After adding many new agents
- When agent usage patterns change significantly

**What changes:**
- `dynamic_min` and `dynamic_max` in `ais_normalization_ranges` table
- Only affects ranges where `active_mode = 1` (dynamic mode)

---

### Operation 2: Toggle Dynamic vs Best Practice Mode

**Purpose:** Choose between expert-defined ranges or production-calculated ranges

**Steps:**
1. Navigate to `/admin/ais-config`
2. Find the range you want to change
3. Click "Switch to Dynamic" or "Switch to Best Practice"
4. Confirm the change

**Modes:**
- **Best Practice (mode 0):** Uses expert-defined min/max
  - Good for: Stable, predictable scoring
  - Example: "Complex workflow = 20+ steps" (fixed standard)

- **Dynamic (mode 1):** Uses production-calculated min/max
  - Good for: Adapting to actual usage patterns
  - Example: "High token usage = 90th percentile of actual usage"

---

### Operation 3: Update System Configuration

**Purpose:** Change pricing, limits, or other system-wide settings

**Method:** Direct database update (no UI yet)

```sql
-- Example: Change pilot credit cost
UPDATE ais_system_config
SET config_value = 0.00050,  -- New cost
    updated_at = NOW()
WHERE config_key = 'pilot_credit_cost_usd';

-- Example: Change minimum subscription
UPDATE ais_system_config
SET config_value = 15.00,  -- New minimum
    updated_at = NOW()
WHERE config_key = 'min_subscription_usd';
```

**Takes Effect:** Immediately on next calculation

---

### Operation 4: Update Scoring Weights

**Purpose:** Fine-tune the importance of different factors

**Method:** Direct database update (no UI yet)

```sql
-- Example: Give more weight to token efficiency, less to volume
UPDATE ais_scoring_weights
SET weight = 0.3  -- Reduce from 0.5
WHERE component_key = 'token_complexity' AND sub_component = 'volume';

UPDATE ais_scoring_weights
SET weight = 0.4  -- Increase from 0.2
WHERE component_key = 'token_complexity' AND sub_component = 'efficiency';

-- IMPORTANT: Weights must sum to 1.0 for each component
SELECT component_key, SUM(weight) as total
FROM ais_scoring_weights
WHERE component_key = 'token_complexity'
GROUP BY component_key;
-- Should return: 1.0
```

**Takes Effect:** Next score calculation (execution or creation)

---

## Database Tables Reference

### Table 1: `agent_intensity_metrics`

**Purpose:** Stores calculated scores for each agent

```sql
CREATE TABLE agent_intensity_metrics (
  agent_id UUID PRIMARY KEY,
  user_id UUID,

  -- Main scores (0-10)
  creation_score NUMERIC,              -- Based on design
  execution_score NUMERIC,             -- Based on runtime
  combined_score NUMERIC,              -- Final score used for pricing

  -- Creation components (4 dimensions)
  creation_workflow NUMERIC,           -- Workflow complexity
  creation_plugins NUMERIC,            -- Plugin count
  creation_io_schema NUMERIC,          -- I/O fields
  creation_trigger NUMERIC,            -- Trigger type bonus

  -- Execution components (4 components)
  token_complexity NUMERIC,            -- Token usage
  execution_complexity NUMERIC,        -- Runtime patterns
  plugin_complexity NUMERIC,           -- Plugin usage
  workflow_complexity NUMERIC,         -- Workflow patterns

  -- Runtime statistics (for calculation)
  total_executions INTEGER,
  avg_tokens_per_run NUMERIC,
  peak_tokens_single_run NUMERIC,
  avg_iterations_per_run NUMERIC,
  avg_execution_duration_ms NUMERIC,
  success_rate NUMERIC,
  retry_rate NUMERIC,
  unique_plugins_used INTEGER,
  avg_plugins_per_run NUMERIC,
  -- ... more stats

  -- Metadata
  creation_cost_usd NUMERIC,
  last_calculated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Sample Row:**
```json
{
  "agent_id": "uuid-123",
  "creation_score": 6.5,
  "execution_score": 5.08,
  "combined_score": 5.506,
  "creation_workflow": 7.2,
  "creation_plugins": 5.8,
  "creation_io_schema": 6.1,
  "creation_trigger": 1,
  "token_complexity": 5.47,
  "execution_complexity": 5.13,
  "plugin_complexity": 5.62,
  "workflow_complexity": 3.31,
  "total_executions": 127,
  "avg_tokens_per_run": 6234,
  "peak_tokens_single_run": 15678
}
```

---

### Table 2: `ais_normalization_ranges`

**Purpose:** Define min/max boundaries for normalizing raw metrics to 0-10 scale

```sql
CREATE TABLE ais_normalization_ranges (
  range_key TEXT PRIMARY KEY,

  -- Best practice ranges (expert-defined)
  best_practice_min NUMERIC,
  best_practice_max NUMERIC,

  -- Dynamic ranges (calculated from production)
  dynamic_min NUMERIC,
  dynamic_max NUMERIC,

  -- Which one to use
  active_mode INTEGER,  -- 0 = best_practice, 1 = dynamic

  -- Metadata
  category TEXT,  -- 'execution' or 'creation'
  description TEXT,
  min_executions_threshold INTEGER,
  updated_at TIMESTAMPTZ
);
```

**Sample Rows:**
```json
[
  {
    "range_key": "token_volume",
    "best_practice_min": 0,
    "best_practice_max": 5000,
    "dynamic_min": 0,
    "dynamic_max": 8234,
    "active_mode": 1,  // Using dynamic
    "category": "execution"
  },
  {
    "range_key": "workflow_steps",
    "best_practice_min": 1,
    "best_practice_max": 20,
    "dynamic_min": 1,
    "dynamic_max": 15,
    "active_mode": 0,  // Using best practice
    "category": "execution"
  }
]
```

---

### Table 3: `ais_scoring_weights`

**Purpose:** Define importance of each factor in score calculations

```sql
CREATE TABLE ais_scoring_weights (
  id SERIAL PRIMARY KEY,
  component_key TEXT,      -- e.g., 'creation', 'token_complexity'
  sub_component TEXT,      -- e.g., 'workflow', 'volume' (NULL for top-level)
  weight NUMERIC,          -- 0 to 1, must sum to 1.0 per component
  category TEXT,           -- 'creation', 'execution', 'combined'
  description TEXT,
  updated_at TIMESTAMPTZ,
  UNIQUE(component_key, sub_component)
);
```

**Sample Rows:**
```json
[
  {
    "component_key": "creation",
    "sub_component": "workflow",
    "weight": 0.5,
    "category": "creation",
    "description": "Weight of workflow complexity in creation score"
  },
  {
    "component_key": "token_complexity",
    "sub_component": "volume",
    "weight": 0.5,
    "category": "execution",
    "description": "Weight of total token volume"
  },
  {
    "component_key": "combined_score",
    "sub_component": "execution",
    "weight": 0.7,
    "category": "combined",
    "description": "Weight of execution score in combined intensity"
  }
]
```

---

### Table 4: `ais_system_config`

**Purpose:** Store system-wide configuration values

```sql
CREATE TABLE ais_system_config (
  config_key TEXT PRIMARY KEY,
  config_value NUMERIC,
  description TEXT,
  category TEXT,      -- 'pricing', 'limits', etc.
  unit TEXT,         -- 'usd', 'credits', 'percent'
  min_value NUMERIC,
  max_value NUMERIC,
  updated_at TIMESTAMPTZ,
  updated_by UUID
);
```

**Sample Rows:**
```json
[
  {
    "config_key": "pilot_credit_cost_usd",
    "config_value": 0.00048,
    "description": "Cost per pilot credit in USD (1 credit = 10 LLM tokens)",
    "category": "pricing",
    "unit": "usd",
    "min_value": 0.0001,
    "max_value": 0.01
  },
  {
    "config_key": "min_subscription_usd",
    "config_value": 10.00,
    "description": "Minimum monthly subscription amount",
    "category": "pricing",
    "unit": "usd"
  }
]
```

---

## Configuration Management

### How to Change Configuration

#### Option 1: Via Database (Current Method)

```sql
-- Change pilot credit pricing
UPDATE ais_system_config
SET config_value = 0.00050
WHERE config_key = 'pilot_credit_cost_usd';

-- Change scoring weights
UPDATE ais_scoring_weights
SET weight = 0.6
WHERE component_key = 'creation' AND sub_component = 'workflow';

-- Change normalization mode
UPDATE ais_normalization_ranges
SET active_mode = 1  -- Switch to dynamic
WHERE range_key = 'token_volume';
```

#### Option 2: Via Admin UI (Partial - Only for Ranges)

**Available:**
- Toggle dynamic/best practice mode: `/admin/ais-config`
- Refresh dynamic ranges: `/admin/ais-config`
- View current config: `/admin/ais-config`

**Not Yet Available (Future Enhancement):**
- Edit system config values
- Edit scoring weights
- Bulk operations

---

## Example Scenarios

### Scenario 1: "My agents are using way more tokens than expected"

**Problem:** Dynamic ranges are outdated, scores don't reflect reality

**Solution:**
1. Go to `/admin/ais-config`
2. Click "Refresh Ranges" in Dynamic Normalization section
3. System recalculates based on actual current usage
4. New ranges capture higher token usage
5. Future executions use updated ranges for scoring

**Example:**
- Before refresh: token_volume max = 5000 (old data)
- Agent using 8000 tokens → Score = 10/10 (capped)
- After refresh: token_volume max = 12000 (new data)
- Agent using 8000 tokens → Score = 6.7/10 (more accurate)

---

### Scenario 2: "I want token efficiency to matter more than volume"

**Problem:** Current weights prioritize volume (50%) over efficiency (20%)

**Solution:**
1. Update weights in database:
```sql
UPDATE ais_scoring_weights
SET weight = 0.3 WHERE component_key = 'token_complexity' AND sub_component = 'volume';

UPDATE ais_scoring_weights
SET weight = 0.5 WHERE component_key = 'token_complexity' AND sub_component = 'efficiency';
```
2. Next agent execution uses new weights
3. Efficient agents get higher scores, wasteful agents get lower scores

---

### Scenario 3: "I want to test new pricing"

**Problem:** Need to change pilot credit cost from $0.00048 to $0.00050

**Solution:**
1. Update system config:
```sql
UPDATE ais_system_config
SET config_value = 0.00050
WHERE config_key = 'pilot_credit_cost_usd';
```
2. Next agent creation or subscription uses new cost
3. All calculations immediately reflect new pricing
4. No code deployment needed!

---

### Scenario 4: "How do I see what changed after refreshing ranges?"

**Solution:**
1. Go to `/admin/audit-trail`
2. Filter by Action: `AIS_NORMALIZATION_REFRESH_COMPLETED`
3. Expand the log entry
4. See before/after comparison for all ranges
5. Yellow highlighted rows show which ranges changed

---

## Summary

### Key Takeaways

1. **Three Configuration Layers:**
   - **Normalization Ranges** = Define min/max boundaries (what is "high"?)
   - **Scoring Weights** = Define importance of factors (what matters more?)
   - **System Config** = Define business rules (pricing, limits)

2. **Two Automatic Triggers:**
   - Agent creation → Creation score calculated
   - Agent execution → Execution score updated

3. **One Manual Trigger:**
   - Admin refresh → Normalization ranges updated from production data

4. **Scores Update Gradually:**
   - No sudden jumps for all users
   - Each agent updates on its next execution
   - Smooth transition to new configuration

5. **100% Configurable:**
   - No code deployment needed for configuration changes
   - All values in database
   - Fallback values for safety

---

**Last Updated:** January 29, 2025
**System Version:** 2.0 (Post-Hardcoding Elimination)
**Status:** ✅ Production Ready
