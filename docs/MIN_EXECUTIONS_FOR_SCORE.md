# Min Executions For Score - Complete Guide

## Overview

The `min_executions_for_score` parameter controls when the Agent Intensity System (AIS) switches from using **creation scores** (design-based estimates) to **blended scores** (combining creation and execution data).

**Database**: `ais_system_config.min_executions_for_score`
**Type**: Integer
**Default**: 5
**Recommended Range**: 3-10

---

## How It Works

### The Three Score System

Every agent has three scores:

1. **Creation Score** (0-10): Calculated at agent creation based on design
   - Plugin count
   - Workflow complexity
   - Input/output schema
   - Trigger type
   - **Never changes after creation**

2. **Execution Score** (0-10): Calculated after each run based on actual performance
   - Token usage (volume, peak, I/O ratio)
   - Execution metrics (iterations, duration, failures, retries)
   - Plugin usage (active count, frequency, overhead)
   - Workflow patterns (steps, branches, loops, parallel tasks)
   - **Updates with every execution**

3. **Combined Score** (0-10): Smart blend of creation + execution
   - **Formula depends on `min_executions_for_score`**

---

## Combined Score Calculation

### **Before Threshold** (executions < min_executions_for_score)

```typescript
combined_score = creation_score  // 100% creation
```

**Why?**
Not enough execution data to trust. Use the design estimate.

**Example (threshold = 5):**
```
Execution #0: combined = 3.5 (creation only)
Execution #1: combined = 3.5 (creation only)
Execution #2: combined = 3.5 (creation only)
Execution #3: combined = 3.5 (creation only)
Execution #4: combined = 3.5 (creation only)
```

---

### **At/After Threshold** (executions >= min_executions_for_score)

```typescript
combined_score = (creation_score × 0.30) + (execution_score × 0.70)
```

**Why?**
Enough data to trust execution metrics. Blend creation (30%) with execution (70%).

**Example (threshold = 5):**
```
Execution #5: combined = (3.5 × 0.30) + (6.2 × 0.70) = 5.39 ← Switches!
Execution #6: combined = (3.5 × 0.30) + (6.5 × 0.70) = 5.60
Execution #7: combined = (3.5 × 0.30) + (6.8 × 0.70) = 5.81
```

---

## Real-World Example

### 3-Plugin Email Agent

**Design Characteristics:**
- 3 plugins (Gmail, Calendar, Slack)
- 5 workflow steps
- Simple trigger (on-demand)

**Creation Score**: 3.5 (low-medium complexity)

### Execution History

| Run # | Execution Score | Combined Score | Calculation |
|-------|----------------|----------------|-------------|
| **0** (creation) | 5.0 (default) | **3.5** | creation only |
| **1** | 6.2 | **3.5** | creation only (< 5) |
| **2** | 6.3 | **3.5** | creation only (< 5) |
| **3** | 6.1 | **3.5** | creation only (< 5) |
| **4** | 6.4 | **3.5** | creation only (< 5) |
| **5** ✅ | 6.2 | **5.4** | (3.5×0.3) + (6.2×0.7) ← **SWITCH!** |
| **6** | 6.5 | **5.6** | (3.5×0.3) + (6.5×0.7) |
| **10** | 7.0 | **6.0** | (3.5×0.3) + (7.0×0.7) |

**Observation**: Combined score changed from 3.5 → 5.4 at run #5, reflecting real execution complexity.

---

## Relationship with Model Routing

### 🚨 Critical Rule: `min_executions_for_score` ≤ `routing_min_executions`

**Why this matters:**

Routing needs accurate scores. If routing starts before score blending, it uses stale creation scores!

| Config | Behavior | Problem? |
|--------|----------|----------|
| `min_executions_for_score = 3`<br>`routing_min_executions = 3` | ✅ Both switch at run 3 | **IDEAL** - perfectly aligned |
| `min_executions_for_score = 3`<br>`routing_min_executions = 5` | ✅ Blended scores start at run 3, routing at run 5 | **GOOD** - routing sees accurate scores |
| `min_executions_for_score = 5`<br>`routing_min_executions = 3` | ❌ Routing starts at run 3 with creation score (3.5), blending starts at run 5 | **BAD** - routing uses stale scores at runs 3-4! |
| `min_executions_for_score = 5`<br>`routing_min_executions = 5` | ✅ Both switch at run 5 | **IDEAL** - perfectly aligned |

**Example of the Problem:**

```
Config: min_executions_for_score=5, routing_min_executions=3

Run 3: combined_score = 3.5 (creation only) → Routes to GPT-4o-mini
Run 4: combined_score = 3.5 (creation only) → Routes to GPT-4o-mini
       ↑ WRONG! Real execution score is 6.5, should use Claude Haiku!
Run 5: combined_score = 5.4 (blended) → Routes to Claude Haiku ✅
```

**Validation**:
The API enforces `min_executions_for_score <= routing_min_executions` to prevent routing with stale scores.

**Best Practice**: Set both to the same value!

---

## Recommended Values

### Development Environment

```yaml
min_executions_for_score: 3
routing_min_executions: 3
```

**Why?**
- Limited execution data available
- Want fast feedback on scoring changes
- Can test routing behavior quickly
- Agents might only run 5-10 times total

---

### Production Environment

```yaml
min_executions_for_score: 5
routing_min_executions: 5
```

**Why?**
- More statistically valid (5 data points)
- Better confidence in execution metrics
- Success rate calculation is meaningful (e.g., 4/5 = 80%)
- Agents run 10-100+ times

---

### Conservative (High-Stakes Applications)

```yaml
min_executions_for_score: 10
routing_min_executions: 10
```

**Why?**
- Maximum statistical confidence
- Critical applications require proven metrics
- Can afford to wait for data accumulation
- Reduces risk of premature routing changes

---

## Practical Guidelines

### When to Lower (3)

✅ **Use lower values when:**
- Testing in development
- High-volume agent testing
- Want rapid iteration on AIS config
- Agents run frequently

❌ **Don't use if:**
- Production environment
- Mission-critical agents
- Low execution volume

---

### When to Keep Default (5)

✅ **Use default when:**
- Balanced production environment
- Standard SaaS applications
- Agents run 10-50+ times
- Want reliable metrics without delays

✅ **Best for:** Most use cases

---

### When to Raise (7-10)

✅ **Use higher values when:**
- Mission-critical systems
- Financial/healthcare/legal applications
- Low-volume, high-stakes agents
- Need maximum confidence

⚠️ **Trade-off:** Slower cost optimization

---

## Impact on Cost Optimization

### Example: Email Agent (creation=3.5, execution=6.5)

**Routing Thresholds:**
- Low: ≤ 3.0 → GPT-4o-mini
- Medium: ≤ 6.0 → Claude Haiku
- High: > 6.0 → GPT-4o

**With `min_executions_for_score = 3`:**

| Run | Combined Score | Model | Cost/1M Tokens |
|-----|----------------|-------|----------------|
| 1-2 | 3.5 | GPT-4o-mini | $0.60 (cheap) |
| 3 | 5.5 | Claude Haiku | $3.00 (mid) |
| 4+ | 5.5-6.5 | Claude Haiku | $3.00 (mid) |

**Cost Impact**: Switches to mid-tier quickly (run 3)

---

**With `min_executions_for_score = 10`:**

| Run | Combined Score | Model | Cost/1M Tokens |
|-----|----------------|-------|----------------|
| 1-9 | 3.5 | GPT-4o-mini | $0.60 (cheap) |
| 10 | 5.5 | Claude Haiku | $3.00 (mid) |
| 11+ | 5.5-6.5 | Claude Haiku | $3.00 (mid) |

**Cost Impact**: Stays on cheap tier longer (saves $2.40/1M tokens × 7 runs)

---

## Admin Interface

**Location**: Admin → AIS Config → System Limits

**Field**: "Min Executions For Score"

**Description**:
> Controls combined score calculation: **< threshold** = 100% creation score (design estimate), **≥ threshold** = 30% creation + 70% execution (blended). Recommended: 3-5 for development, 5-10 for production.

**Validation**: Must be ≥ `routing_min_executions`

---

## Technical Implementation

### Code Location

**Primary Logic**: `/lib/utils/updateAgentIntensity.ts:168-173`

```typescript
const combined_score = total_executions < minExecutionsForScore
  ? creation_score  // Not enough data - use creation score only
  : (
      creation_score * COMBINED_WEIGHTS.CREATION +
      execution_score * COMBINED_WEIGHTS.EXECUTION
    );
```

**Validation**: `/app/api/admin/system-limits/route.ts:28-47`

```typescript
if (limits.minExecutionsForScore < routingMinExecutions) {
  return NextResponse.json({
    success: false,
    error: `min_executions_for_score must be >= routing_min_executions`
  }, { status: 400 });
}
```

---

## Monitoring

### Logs to Watch

```
📊 [AIS] Score calculation for agent abc-123:
   Total executions: 4, Threshold: 5
   Creation: 3.50, Execution: 6.20
   Combined: 3.50 (creation-only)
```

```
📊 [AIS] Score calculation for agent abc-123:
   Total executions: 5, Threshold: 5
   Creation: 3.50, Execution: 6.20
   Combined: 5.39 (weighted blend)  ← SWITCHED!
```

---

## Common Mistakes

### ❌ Setting Too Low (1-2)

**Problem**: Not statistically significant
- One bad run skews everything
- Success rate unreliable (1/2 = 50%?)
- Premature routing changes

---

### ❌ Setting Lower Than Routing

**Problem**: Invalid configuration
- System rejects the save
- Error: "must be >= routing_min_executions"

---

### ❌ Setting Too High (20+)

**Problem**: Defeats the purpose
- Never see execution-based routing in practice
- Stuck with creation estimates forever
- Cost optimization delayed

---

## Summary

**What it controls**: When combined scores switch from 100% creation to 30% creation + 70% execution

**Why it matters**: Balances early cost optimization vs statistical confidence

**Best practice**:
- Development: 3
- Production: 5
- Critical systems: 7-10

**Critical rule**: Must be ≥ `routing_min_executions`

**Implementation date**: 2025-01-31
