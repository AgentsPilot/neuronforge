# Per-Step Intelligent Routing - Testing Guide

## Overview

This guide will help you test the complete per-step intelligent model routing system for Pilot workflows. The system includes:

- **Dynamic complexity analysis** (6 configurable factors)
- **Per-step model tier routing** (tier1/tier2/tier3)
- **Memory-based learning** (improves over time)
- **Audit trail integration** (SOC2 compliance)
- **Admin UI configuration** (19 configurable parameters)

## Prerequisites

1. Database tables created (pilot_step_routing_history, agent_memories)
2. Admin access to system configuration
3. At least one Pilot-enabled agent created

## Testing Phases

### Phase 1: Enable & Configure the System

#### 1.1 Enable Per-Step Routing

1. Navigate to `/admin/system-config`
2. Scroll to "Per-Step Intelligent Routing" section
3. Toggle **Enable Per-Step Routing** to ON
4. Select routing strategy:
   - **Conservative**: 60% AIS, 40% Step Complexity (safer, uses higher tiers)
   - **Balanced**: 40% AIS, 60% Step Complexity (recommended)
   - **Aggressive**: 20% AIS, 80% Step Complexity (more cost-efficient)
5. Click "Save Changes"

**Expected Result**: You should see a success message confirming the configuration was saved.

#### 1.2 Configure Complexity Analysis

1. Navigate to `/admin/ais-config`
2. Scroll down to **"Complexity Factor Weights"** section
3. Review the 6 step type configurations:
   - LLM Decision Steps
   - Transform Steps
   - Conditional Steps
   - Action Steps
   - API Call Steps
   - Default Steps
4. For initial testing, **keep default weights** (each should sum to 1.0)
5. Scroll to **"Complexity Scoring Thresholds"** section
6. Review the 4 factor thresholds:
   - Prompt Length
   - Data Size
   - Condition Count
   - Context Depth
7. For initial testing, **keep default thresholds**

**Expected Result**: All weight sums should show in green (sum = 1.000).

### Phase 2: Test Basic Routing (No Memory Yet)

#### 2.1 Create a Test Agent

Create a Pilot-enabled agent with these characteristics:

```json
{
  "name": "Test Routing Agent",
  "description": "Testing per-step routing system",
  "pilot_enabled": true,
  "intensity_score": 5,  // Medium intensity for balanced testing
  "pilot_steps": [
    {
      "id": "step1",
      "name": "Simple Decision",
      "type": "llm_decision",
      "prompt": "What is 2+2?",
      "outputs": ["result"]
    },
    {
      "id": "step2",
      "name": "Complex Analysis",
      "type": "llm_decision",
      "prompt": "Analyze the following complex dataset and provide insights on patterns, trends, and anomalies. Consider temporal dependencies, statistical significance, and predictive indicators. Generate a comprehensive report with visualizations.",
      "inputs": ["result"],
      "outputs": ["analysis"]
    },
    {
      "id": "step3",
      "name": "Transform Data",
      "type": "transform",
      "prompt": "Convert {{result}} to uppercase",
      "inputs": ["result"],
      "outputs": ["transformed"]
    }
  ]
}
```

#### 2.2 Run the Agent

1. Execute the test agent
2. Monitor the console logs (or check Supabase logs)
3. Look for routing decisions:

```
🧭 [PerStepModelRouter] Routing step: Simple Decision
   Step complexity: 0.15 | Agent AIS: 5.00 | Effective: 3.09
   Selected: tier1 (gpt-4o-mini)

🧭 [PerStepModelRouter] Routing step: Complex Analysis
   Step complexity: 0.82 | Agent AIS: 5.00 | Effective: 6.64
   Selected: tier3 (gpt-4o)

🧭 [PerStepModelRouter] Routing step: Transform Data
   Step complexity: 0.08 | Agent AIS: 5.00 | Effective: 2.42
   Selected: tier1 (gpt-4o-mini)
```

**Expected Results**:
- Simple steps should route to **tier1** (gpt-4o-mini)
- Complex steps should route to **tier3** (gpt-4o)
- Transform steps should route to **tier1** or **tier2**

#### 2.3 Verify Database Records

Query the routing history table:

```sql
SELECT
  step_name,
  step_type,
  selected_tier,
  step_complexity,
  agent_ais,
  effective_complexity,
  routing_source,
  created_at
FROM pilot_step_routing_history
WHERE agent_id = 'YOUR_AGENT_ID'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected Results**:
- One record per step executed
- `routing_source` should be `'per_step_routing'` (no memory yet)
- `selected_tier` should match console logs
- `step_complexity`, `agent_ais`, `effective_complexity` should have values

#### 2.4 Verify Audit Trail

Query the audit logs:

```sql
SELECT
  action,
  entity_type,
  entity_id,
  resource_name,
  details,
  created_at
FROM audit_logs
WHERE action = 'PILOT_ROUTING_DECISION'
  AND entity_id = 'YOUR_EXECUTION_ID'
ORDER BY created_at DESC;
```

**Expected Results**:
- One audit log per routing decision
- `action` = `'PILOT_ROUTING_DECISION'`
- `details` contains full routing information

### Phase 3: Test Memory-Based Learning

#### 3.1 Run the Same Agent Multiple Times

Execute the same test agent **5 times** (to build up learning data).

**What to Watch For**:
- After 3 executions, you should see learning messages:
```
🧠 [RoutingMemory] Learning from execution: llm_decision → tier1 (success: true)
✅ [RoutingMemory] Updated pattern for llm_decision: tier1 (confidence: 30%)
💾 [RoutingMemory] Stored memory for llm_decision: prefer tier1
```

#### 3.2 Verify Memory Storage

Query the agent_memories table:

```sql
SELECT
  agent_id,
  memory_type,
  memory_key,
  memory_value,
  importance,
  usage_count,
  created_at
FROM agent_memories
WHERE agent_id = 'YOUR_AGENT_ID'
  AND memory_type = 'routing_pattern'
ORDER BY created_at DESC;
```

**Expected Results**:
- After 3+ executions, you should see memory entries
- `memory_type` = `'routing_pattern'`
- `memory_key` = `'routing_llm_decision'`, `'routing_transform'`, etc.
- `memory_value` should contain JSON with:
  ```json
  {
    "stepType": "llm_decision",
    "preferredTier": "tier1",
    "successRate": 1.0,
    "avgTokens": 150,
    "costSavings": 80,
    "totalRuns": 5,
    "recommendation": "Use tier1 for llm_decision steps (100% success)",
    "confidence": "medium"
  }
  ```

#### 3.3 Run Again and Watch for Memory Override

On the **6th execution**, watch for memory-based routing:

```
🧠 [PerStepModelRouter] MEMORY OVERRIDE: Simple Decision → gpt-4o-mini
   Historical data shows tier1 performs well for llm_decision steps (100% success, 80% savings)
```

Query routing history to verify:

```sql
SELECT
  step_name,
  routing_source,
  selected_tier,
  explanation
FROM pilot_step_routing_history
WHERE agent_id = 'YOUR_AGENT_ID'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected Results**:
- `routing_source` = `'routing_memory'` (instead of `'per_step_routing'`)
- `explanation` mentions "MEMORY" and historical data
- Same tier as before (but now chosen based on learning, not calculation)

### Phase 4: Test Configuration Changes

#### 4.1 Change Routing Strategy

1. Go to `/admin/system-config`
2. Change routing strategy from "balanced" to "aggressive"
3. Save changes
4. Run the test agent again

**Expected Results**:
- Steps should now prefer **lower tiers** (more cost-efficient)
- Effective complexity calculation changes (20% AIS, 80% step complexity)
- Check logs for new complexity scores

#### 4.2 Adjust Complexity Weights

1. Go to `/admin/ais-config`
2. Expand "LLM Decision Steps"
3. Increase `reasoningDepth` weight to 0.5 (decrease others proportionally)
4. Save changes
5. Run the test agent again

**Expected Results**:
- Steps with high reasoning requirements should show **higher complexity scores**
- May route to higher tiers if reasoning is complex

### Phase 5: Advanced Testing Scenarios

#### 5.1 Test Fallback Behavior

1. Temporarily disable per-step routing in `/admin/system-config`
2. Run the test agent

**Expected Results**:
- All steps should use agent's default model preference
- `routing_source` = `'agent_default'` or `'fallback'`
- Console logs should indicate fallback mode

#### 5.2 Test Different Step Types

Create agents with these step types:
- **Conditional steps** (multiple if/else branches)
- **API call steps** (external integrations)
- **Transform steps** (data manipulation)
- **Action steps** (execute operations)

**Expected Results**:
- Each step type should use its specific complexity weights
- Different routing decisions based on step type characteristics

#### 5.3 Test High AIS Agent

1. Create an agent with `intensity_score: 9` (very high)
2. Add simple steps with short prompts
3. Run the agent

**Expected Results**:
- Even simple steps may route to **tier2** or **tier3** due to high AIS
- Effective complexity heavily influenced by agent intensity

#### 5.4 Test Memory Confidence Thresholds

1. Create a new agent
2. Run it 2 times (low confidence)
3. Check if memory override happens (it shouldn't - need 3+ runs)
4. Run 3 more times (confidence should increase)
5. Check if memory override now happens

**Expected Results**:
- Memory override only occurs when:
  - `totalExecutions >= 3`
  - `confidence >= 0.6`
  - `successRate >= 0.85` (for medium confidence) or `>= 0.9` (for high)

## Verification Checklist

After testing, verify the following:

### Database Integrity
- [ ] No duplicate records in `pilot_step_routing_history`
- [ ] No duplicate records in `audit_logs` (one per routing decision)
- [ ] No duplicate records in `agent_memories` (upsert works correctly)
- [ ] All foreign keys valid (agent_id, user_id, execution_id)

### Routing Accuracy
- [ ] Simple steps route to tier1 (gpt-4o-mini)
- [ ] Complex steps route to tier3 (gpt-4o)
- [ ] Medium steps route to tier2 (claude-3-5-haiku)
- [ ] Routing strategy affects tier selection
- [ ] Agent AIS influences effective complexity

### Memory System
- [ ] Learning happens after 3+ executions
- [ ] Memory entries stored in `agent_memories` table
- [ ] Memory override occurs when confident
- [ ] `routing_source` = `'routing_memory'` when overriding
- [ ] Confidence increases with more executions
- [ ] Exponential moving average updates statistics

### Audit Trail
- [ ] Every routing decision logged to `audit_logs`
- [ ] `action` = `'PILOT_ROUTING_DECISION'`
- [ ] All routing parameters included in `details`
- [ ] No missing or null fields in audit logs

### UI Configuration
- [ ] System config toggle enables/disables routing
- [ ] Strategy dropdown affects routing calculations
- [ ] AIS config weight sliders update complexity analysis
- [ ] Threshold inputs affect scoring
- [ ] Save functionality persists to database
- [ ] Real-time validation (weight sums = 1.0)

## Troubleshooting

### Issue: Routing Not Happening

**Check:**
1. Is per-step routing enabled in `/admin/system-config`?
2. Is the agent `pilot_enabled = true`?
3. Are there any console errors?
4. Check database: `SELECT * FROM system_settings WHERE setting_key = 'pilot_per_step_routing_enabled';`

### Issue: All Steps Use Same Tier

**Check:**
1. Is routing strategy too conservative or aggressive?
2. Are complexity weights balanced correctly (sum = 1.0)?
3. Is agent AIS score appropriate (0-10 range)?
4. Check complexity analysis logs for actual scores

### Issue: Memory Not Learning

**Check:**
1. Have you run the agent 3+ times?
2. Are executions completing successfully?
3. Query `pilot_step_routing_history` for execution records
4. Check console logs for learning messages
5. Verify `RoutingMemoryService` is not throwing errors

### Issue: Duplicate Records in Database

**Check:**
1. Query counts: `SELECT agent_id, step_type, COUNT(*) FROM pilot_step_routing_history WHERE execution_id = 'X' GROUP BY agent_id, step_type HAVING COUNT(*) > 1;`
2. If duplicates exist, review StepExecutor.ts integration (should only call once per step)
3. Check for race conditions (multiple concurrent executions)

## Expected Performance Improvements

After the system learns (10+ executions per agent):

- **Token reduction**: 30-50% fewer tokens used
- **Cost savings**: 40-60% lower AI costs
- **Faster execution**: Simple steps execute faster on tier1 models
- **Higher accuracy**: Complex steps use more capable tier3 models
- **Adaptive routing**: System optimizes based on actual performance

## Success Criteria

The system is working correctly if:

1. ✅ Routing decisions are made per-step (not per-agent)
2. ✅ Complexity analysis uses 6 configurable factors
3. ✅ Memory system learns after 3+ executions
4. ✅ Memory overrides complexity-based routing when confident
5. ✅ All routing decisions logged to audit trail
6. ✅ No duplicate database records
7. ✅ Configuration changes take effect immediately
8. ✅ Token usage decreases over time as system learns

## Next Steps

After successful testing:

1. **Monitor production performance** - Track token usage, costs, and accuracy
2. **Tune complexity weights** - Adjust based on real-world patterns
3. **Expand memory insights** - Add more routing patterns for different scenarios
4. **Create dashboards** - Visualize routing decisions and learning progress
5. **Optimize thresholds** - Fine-tune based on actual execution data

---

**Document Version**: 1.0
**Last Updated**: 2025-11-03
**Implementation Status**: Complete - Ready for Testing
