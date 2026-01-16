# V6 Workflow Execution Guide

**Date**: 2025-12-30
**Status**: ✅ PRODUCTION READY

## Overview

This guide explains how to execute V6 workflows through the complete pipeline from user request to final results.

---

## Complete V6 Pipeline (End-to-End)

```
User Request
    ↓
Phase 0: Enhanced Prompt Generation
    ↓
Phase 1: Semantic Plan Generation (Understanding)
    ↓
Phase 1.5: Plugin Schema Extraction (Grounding Preparation)
    ↓
Phase 2: Grounding (Assumption Validation)
    ↓
Phase 3: IR Formalization (Declarative IR)
    ↓
Phase 4: DSL Compilation (PILOT DSL)
    ↓
Phase 5: Workflow Execution (Runtime)
    ↓
Results
```

---

## Execution Methods

### Method 1: Full Pipeline Execution (All Phases)

**Use Case**: Testing the complete V6 pipeline from enhanced prompt to execution

**API Endpoint**: Not yet implemented (requires creating full pipeline endpoint)

**Alternative**: Run phases sequentially via individual endpoints

---

### Method 2: Sequential Phase Execution

Execute each phase individually for maximum control and debugging.

#### Step 1: Generate Semantic Plan (Phase 1)

**Endpoint**: `POST /api/v6/generate-semantic-plan`

**Request**:
```json
{
  "enhanced_prompt": {
    "sections": {
      "data": [
        "Fetch emails from Gmail containing complaints"
      ],
      "delivery": [
        "Send summary to admin@company.com"
      ]
    },
    "specifics": {
      "services_involved": ["google-mail"]
    }
  },
  "config": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

**Response**:
```json
{
  "success": true,
  "semantic_plan": {
    "plan_version": "1.0",
    "goal": "...",
    "understanding": {...},
    "assumptions": [...],
    "inferences": [...],
    "ambiguities": []
  }
}
```

---

#### Step 2: Ground Semantic Plan + Formalize to IR (Phase 2 + 3)

**Endpoint**: `POST /api/v6/generate-ir-semantic`

**Request**:
```json
{
  "enhanced_prompt": {
    "sections": {
      "data": ["Fetch emails from Gmail containing complaints"],
      "delivery": ["Send summary to admin@company.com"]
    },
    "specifics": {
      "services_involved": ["google-mail"]
    }
  }
}
```

**What Happens**:
1. Generates semantic plan (Phase 1)
2. Extracts plugin schema metadata (Phase 1.5 - NO AUTH REQUIRED)
3. Grounds assumptions via field name fuzzy matching (Phase 2)
4. Formalizes to Declarative IR (Phase 3)

**Response**:
```json
{
  "success": true,
  "declarative_ir": {
    "workflow_type": "data_processing",
    "data_sources": [...],
    "processing": {...},
    "outputs": [...]
  },
  "grounding_results": {
    "validated": 5,
    "total": 5,
    "confidence": 0.95
  }
}
```

---

#### Step 3: Compile IR to DSL (Phase 4)

**Endpoint**: `POST /api/v6/compile-declarative`

**Request**:
```json
{
  "declarative_ir": {
    "workflow_type": "data_processing",
    "data_sources": [
      {
        "id": "ds1",
        "plugin": "google-mail",
        "action": "search_emails",
        "config": {
          "query": "complaint",
          "max_results": 100
        }
      }
    ],
    "processing": {
      "filters": [
        {
          "data_source_id": "ds1",
          "conditions": [...]
        }
      ],
      "ai_operations": [...]
    },
    "outputs": [...]
  },
  "enhanced_prompt": {
    "specifics": {
      "services_involved": ["google-mail"]
    }
  }
}
```

**Response**:
```json
{
  "success": true,
  "dsl": {
    "workflow": [
      {
        "step_id": "step1",
        "name": "Fetch complaints from Gmail",
        "type": "action",
        "dependencies": [],
        "plugin": "google-mail",
        "action": "search_emails",
        "params": {
          "query": "complaint",
          "max_results": 100
        }
      },
      {
        "step_id": "step2",
        "name": "Filter emails",
        "type": "transform",
        "dependencies": ["step1"],
        "operation": "filter",
        "input": "{{step1.data}}",
        "config": {
          "condition": "item.subject.toLowerCase().includes('complaint')"
        }
      }
    ]
  },
  "plugins_required": ["google-mail"]
}
```

---

#### Step 4: Execute DSL Workflow (Phase 5)

**Endpoint**: `POST /api/v6/execute-test`

**Request**:
```json
{
  "workflow": [
    {
      "step_id": "step1",
      "name": "Fetch complaints from Gmail",
      "type": "action",
      "dependencies": [],
      "plugin": "google-mail",
      "action": "search_emails",
      "params": {
        "query": "complaint",
        "max_results": 100
      }
    },
    {
      "step_id": "step2",
      "name": "Filter emails",
      "type": "transform",
      "dependencies": ["step1"],
      "operation": "filter",
      "input": "{{step1.data}}",
      "config": {
        "condition": "item.subject.toLowerCase().includes('complaint')"
      }
    }
  ],
  "plugins_required": ["google-mail"],
  "user_id": "user@example.com"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "stepsCompleted": 2,
    "stepsFailed": 0,
    "stepsSkipped": 0,
    "execution_time_ms": 1234,
    "tokens_used": 0,
    "output": {
      "emails_found": 15,
      "filtered_emails": 12,
      "data": [...]
    },
    "completedStepIds": ["step1", "step2"],
    "failedStepIds": [],
    "skippedStepIds": []
  }
}
```

---

### Method 3: Test Page Execution (Recommended for Testing)

**Location**: `/public/test-v6-declarative.html`

**Features**:
- Interactive UI for testing each phase
- Visual display of results at each step
- Auto-fill with example workflows
- Real-time execution feedback
- No authentication required for schema-based grounding

**How to Use**:

1. **Open test page**:
   ```
   http://localhost:3000/test-v6-declarative.html
   ```

2. **Fill in Enhanced Prompt** (or use example):
   ```json
   {
     "sections": {
       "data": ["Fetch emails from Gmail inbox"],
       "delivery": ["Log to Google Sheets"]
     },
     "specifics": {
       "services_involved": ["google-mail", "google-sheets"]
     }
   }
   ```

3. **Click through phases**:
   - "Generate Semantic Plan" → See assumptions and understanding
   - "Generate IR" → See declarative IR with grounded facts
   - "Compile to DSL" → See executable PILOT DSL workflow
   - "Execute Workflow" → See actual execution results

4. **View Results**:
   - Each phase displays formatted JSON output
   - Errors shown with detailed messages
   - Execution time and token usage tracked

---

## Execution Architecture

### Phase 5: Runtime Execution Engine

**Main Components**:

1. **WorkflowPilot** ([WorkflowPilot.ts](../lib/pilot/WorkflowPilot.ts))
   - Main orchestrator
   - Manages execution lifecycle
   - Coordinates all pilot components

2. **StepExecutor** ([StepExecutor.ts](../lib/pilot/StepExecutor.ts))
   - Executes individual steps
   - Routes by step type (action, transform, ai_call, scatter_gather)
   - Resolves template variables
   - Handles retries with token de-duplication

3. **ExecutionContext** ([ExecutionContext.ts](../lib/pilot/ExecutionContext.ts))
   - Manages in-memory execution state
   - Stores step outputs
   - Resolves `{{variable}}` references
   - Tracks token usage and execution time

4. **ParallelExecutor** ([ParallelExecutor.ts](../lib/pilot/ParallelExecutor.ts))
   - Handles parallel execution with concurrency limits
   - Executes loops and scatter-gather patterns
   - Chunks parallel steps for resource management

---

## Template Variable Resolution

The execution engine resolves template variables at runtime using the ExecutionContext.

### Supported Syntax

| Syntax | Example | Description |
|--------|---------|-------------|
| Step output | `{{step1.data}}` | Access entire step result |
| Nested field | `{{step1.data.emails[0].subject}}` | Access nested data |
| Input value | `{{input.recipient}}` | User-provided input |
| Loop variable | `{{item.id}}` | Current loop item |
| Loop index | `{{loop.index}}` | Current iteration number |

### Resolution Process

1. **Extract variable path**: `"{{step1.data.emails}}"` → `"step1.data.emails"`
2. **Identify root**:
   - `"step1"` → fetch from step outputs
   - `"input"` → fetch from input variables
   - `"item"` → fetch from loop context
3. **Navigate path**: `step1.data.emails` → traverse nested structure
4. **Return value**: Resolved value or throw `VariableResolutionError`

### Example Variable Resolution

**Step Definition**:
```json
{
  "step_id": "step2",
  "type": "transform",
  "operation": "map",
  "input": "{{step1.data.emails}}",
  "config": {
    "expression": "{subject: item.subject, from: item.from}"
  }
}
```

**Runtime Resolution**:
1. Resolve `{{step1.data.emails}}`:
   - Get step1 output from context
   - Access `.data` property
   - Access `.emails` array
   - Returns: `[{subject: "...", from: "..."}, ...]`

2. For each item in array, create loop context:
   - Set `{{item}}` = current email object
   - Evaluate expression with `item` in scope
   - Collect mapped results

---

## Step Execution Flow

### 1. Action Steps (Plugin Operations)

**Example**:
```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-mail",
  "action": "search_emails",
  "params": {
    "query": "complaint",
    "max_results": 100
  }
}
```

**Execution**:
1. Resolve params template variables
2. Get plugin executor via PluginManagerV2
3. Execute plugin action with resolved params
4. Store result in context as `step1.data`
5. Track tokens used (if AI action)

---

### 2. Transform Steps (Data Operations)

**Example**:
```json
{
  "step_id": "step2",
  "type": "transform",
  "operation": "filter",
  "input": "{{step1.data}}",
  "config": {
    "condition": "item.subject.includes('urgent')"
  }
}
```

**Execution**:
1. Resolve input variable → get step1 data
2. Route to transform operation handler (filter, map, sort, etc.)
3. Apply operation:
   - **filter**: Evaluate condition for each item, keep matches
   - **map**: Transform each item via expression
   - **sort**: Sort by field
   - **group_by**: Group items by field value
4. Store filtered/transformed result in context

---

### 3. Scatter-Gather Steps (Loops)

**Example**:
```json
{
  "step_id": "step3",
  "type": "scatter_gather",
  "config": {
    "data": "{{step1.data}}",
    "item_variable": "email",
    "actions": [
      {
        "step_id": "step3_1",
        "type": "ai_call",
        "params": {
          "messages": [{
            "role": "user",
            "content": "Classify: {{email.subject}}"
          }]
        }
      }
    ]
  },
  "output_variable": "classified_emails"
}
```

**Execution**:
1. Resolve `data` → get array to iterate
2. For each item:
   - Create child context with `{{email}}` = current item
   - Execute nested actions sequentially
   - Collect result
3. Aggregate results based on gather config
4. Store in context as `classified_emails`

---

### 4. AI Call Steps (LLM Operations)

**Example**:
```json
{
  "step_id": "step4",
  "type": "ai_call",
  "params": {
    "messages": [
      {"role": "system", "content": "You are a complaint classifier"},
      {"role": "user", "content": "Classify this: {{step1.data[0].subject}}"}
    ],
    "temperature": 0,
    "response_format": "json_object"
  }
}
```

**Execution**:
1. Resolve template variables in messages
2. Route through orchestration layer (automatic model selection)
3. Call LLM with resolved messages
4. Parse response (handle JSON mode if specified)
5. Store result + track tokens used

---

## Parallel Execution and Dependencies

### Dependency-Based Execution Levels

The WorkflowPilot organizes steps into **execution levels** based on dependencies:

```
Level 0: [step1] (no dependencies)
Level 1: [step2, step3] (both depend on step1 only)
Level 2: [step4] (depends on step2 or step3)
```

**Execution Order**:
1. Execute Level 0 sequentially
2. Wait for Level 0 completion
3. Execute Level 1 steps **in parallel** (up to concurrency limit)
4. Wait for Level 1 completion
5. Execute Level 2 steps
6. Continue until all levels complete

### Concurrency Control

**ParallelExecutor** limits concurrent steps to prevent resource exhaustion:

- **Default max concurrency**: 3 steps
- **Chunking**: Divides parallel group into chunks
- **Sequential chunks**: Processes chunks one at a time
- **Parallel within chunk**: All steps in chunk run concurrently

**Example**:
```
Parallel group: [step2, step3, step4, step5, step6] (5 steps)
Max concurrency: 3

Chunk 1: [step2, step3, step4] → Execute in parallel
Wait for chunk 1 completion
Chunk 2: [step5, step6] → Execute in parallel
Wait for chunk 2 completion
```

---

## Error Handling and Retries

### Retry Logic

StepExecutor supports configurable retry policies:

```typescript
{
  "step_id": "step1",
  "retry_policy": {
    "max_attempts": 3,
    "backoff_ms": 1000,
    "exponential_backoff": true
  }
}
```

**Retry Behavior**:
1. Execute step
2. If fails, wait `backoff_ms` (exponentially if enabled)
3. Retry up to `max_attempts` times
4. **Token de-duplication**: Previous attempt tokens subtracted from total

### Error Propagation

- **Step failure**: Marks step as failed, stores error
- **Dependent steps**: Skipped if dependency failed
- **Workflow result**: `success: false` if any critical step fails
- **Partial results**: Completed steps still available in output

---

## Token Usage and Cost Tracking

### Token Accounting

ExecutionContext tracks tokens with retry de-duplication:

```typescript
setStepOutput(stepId, output) {
  // Check if this is a retry
  const previousOutput = this.stepOutputs.get(stepId);

  if (previousOutput) {
    // De-duplicate: subtract previous attempt tokens
    const previousTokens = getTokenTotal(previousOutput.metadata.tokensUsed);
    this.totalTokensUsed -= previousTokens;
  }

  // Store new output
  this.stepOutputs.set(stepId, output);

  // Add new attempt tokens
  const newTokens = getTokenTotal(output.metadata.tokensUsed);
  this.totalTokensUsed += newTokens;
}
```

**Why This Matters**: Ensures users aren't charged for failed AI call attempts.

### Token Tracking Sources

- **AI calls**: Direct LLM token usage
- **Plugin actions**: AI-powered plugins report tokens
- **Orchestration**: Compressed prompts track savings

---

## Performance Optimizations

### 1. Step Caching

Deterministic steps (no randomness) are cached:

```typescript
// Check cache before execution
const cacheKey = generateCacheKey(step, resolvedParams);
const cachedResult = this.cache.get(cacheKey);

if (cachedResult) {
  return cachedResult; // Skip re-execution
}
```

**Cacheable Steps**:
- Transforms (filter, map, sort)
- Plugin actions with fixed params
- AI calls with `temperature: 0`

### 2. Orchestration Integration

AI calls route through orchestration for optimization:

- **Prompt compression**: Reduces token usage
- **Model selection**: Chooses cheapest capable model
- **Batch processing**: Combines multiple calls when possible

### 3. Concurrency Limits

Prevents resource exhaustion:
- Max 3 concurrent steps (configurable)
- Chunked parallel execution
- Database connection pooling

---

## Debugging and Monitoring

### Debug Mode

Enable step-by-step execution tracking:

```typescript
const result = await pilot.execute(
  agent,
  userId,
  'Test execution',
  {},
  undefined, // sessionId
  undefined, // stepEmitter
  true // debugMode ← Enable debugging
);
```

**Debug Features**:
- Step-by-step breakpoints
- Variable inspection
- Execution trace logging
- Performance profiling

### Real-Time Progress

Use StateManager for real-time updates:

```typescript
const stateManager = new StateManager(supabase);

// Subscribe to execution updates
stateManager.onStepComplete((stepId, result) => {
  console.log(`Step ${stepId} completed:`, result);
});

await pilot.execute(agent, userId, 'Live execution', {});
```

---

## Common Execution Patterns

### Pattern 1: Data Fetch → Transform → AI → Output

```json
{
  "workflow": [
    {
      "step_id": "step1",
      "type": "action",
      "plugin": "google-mail",
      "action": "search_emails"
    },
    {
      "step_id": "step2",
      "type": "transform",
      "operation": "filter",
      "input": "{{step1.data}}",
      "dependencies": ["step1"]
    },
    {
      "step_id": "step3",
      "type": "ai_call",
      "params": {
        "messages": [
          {"role": "user", "content": "Summarize: {{step2.data}}"}
        ]
      },
      "dependencies": ["step2"]
    },
    {
      "step_id": "step4",
      "type": "action",
      "plugin": "google-mail",
      "action": "send_email",
      "params": {
        "to": "admin@company.com",
        "body": "{{step3.data.summary}}"
      },
      "dependencies": ["step3"]
    }
  ]
}
```

**Execution**: Sequential (each step waits for previous)

---

### Pattern 2: Parallel Data Sources → Merge → Process

```json
{
  "workflow": [
    {
      "step_id": "step1",
      "type": "action",
      "plugin": "google-mail",
      "action": "search_emails",
      "dependencies": []
    },
    {
      "step_id": "step2",
      "type": "action",
      "plugin": "google-sheets",
      "action": "read_range",
      "dependencies": []
    },
    {
      "step_id": "step3",
      "type": "transform",
      "operation": "merge",
      "config": {
        "sources": ["{{step1.data}}", "{{step2.data}}"]
      },
      "dependencies": ["step1", "step2"]
    }
  ]
}
```

**Execution**:
- Level 0: step1 and step2 run in parallel
- Level 1: step3 waits for both, then merges

---

### Pattern 3: Scatter-Gather with Deduplication

```json
{
  "workflow": [
    {
      "step_id": "step1",
      "type": "action",
      "plugin": "google-mail",
      "action": "search_emails"
    },
    {
      "step_id": "step2",
      "type": "action",
      "plugin": "google-sheets",
      "action": "read_range"
    },
    {
      "step_id": "step3",
      "type": "scatter_gather",
      "dependencies": ["step1", "step2"],
      "config": {
        "data": "{{step1.data}}",
        "item_variable": "newEmail",
        "actions": [
          {
            "step_id": "step3_1",
            "type": "transform",
            "operation": "filter",
            "input": "{{step2.data}}",
            "config": {
              "condition": "item.email_id !== newEmail.id"
            }
          }
        ]
      },
      "output_variable": "deduplicated_emails"
    }
  ]
}
```

**Execution**:
- Fetch emails and existing records in parallel
- Loop over new emails
- For each email, check if it exists in step2 data
- Keep only new emails (not in existing records)

---

## Troubleshooting

### Issue 1: "Variable not found" Error

**Error**: `VariableResolutionError: Variable {{step1.data}} not found`

**Cause**: Step1 hasn't executed yet or failed

**Fix**: Check dependencies array - ensure step2 depends on step1:
```json
{
  "step_id": "step2",
  "dependencies": ["step1"],  // ← Add this!
  "input": "{{step1.data}}"
}
```

---

### Issue 2: Plugin Authentication Failure

**Error**: `Plugin execution failed: Not authenticated for google-mail`

**Cause**: User hasn't connected plugin OAuth

**Fix**: Ensure user has valid OAuth tokens in database:
```sql
SELECT * FROM user_plugins
WHERE user_id = '...' AND plugin_key = 'google-mail';
```

---

### Issue 3: Template Variables in Function Bodies

**Error**: `SyntaxError: Unexpected token {{`

**Cause**: Template variables used inside JavaScript function closures

**Wrong**:
```json
{
  "condition": "(() => { const x = {{step1.data}}; return x > 5; })()"
}
```

**Correct**:
```json
{
  "input": "{{step1.data}}",
  "condition": "item > 5"
}
```

---

### Issue 4: High Token Usage

**Cause**: Inefficient prompt construction or missing orchestration

**Fix**:
1. Enable orchestration routing (automatic model selection)
2. Use `temperature: 0` for cacheable AI calls
3. Minimize prompt size - reference only needed data
4. Use structured `response_format: "json_object"` to reduce output tokens

---

## Next Steps

1. **Test the pipeline**: Use `/public/test-v6-declarative.html`
2. **Monitor executions**: Check `workflow_executions` table in Supabase
3. **Review logs**: Check console for detailed execution traces
4. **Optimize workflows**: Use parallel execution and caching
5. **Handle errors**: Add retry policies for flaky operations

---

## Related Documentation

- [V6 Architecture Overview](./V6_DECLARATIVE_ARCHITECTURE.md)
- [V6 DSL Compiler Fixes](./V6_DSL_COMPILER_FIXES.md)
- [V6 Schema-Based Grounding](./V6_SCHEMA_BASED_GROUNDING.md)
- [WorkflowPilot Source](../lib/pilot/WorkflowPilot.ts)
- [StepExecutor Source](../lib/pilot/StepExecutor.ts)
- [ExecutionContext Source](../lib/pilot/ExecutionContext.ts)

---

## Status

✅ **All execution components production-ready**

- WorkflowPilot execution engine: ✅ Complete
- Template variable resolution: ✅ Complete
- Parallel execution with dependencies: ✅ Complete
- Token de-duplication on retries: ✅ Complete
- Error handling and propagation: ✅ Complete
- Test endpoint `/api/v6/execute-test`: ✅ Complete
- Test page UI: ✅ Complete

**Ready for production use!**
