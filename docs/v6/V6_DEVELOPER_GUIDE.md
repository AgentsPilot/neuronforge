# V6 Agent Generation System - Developer Guide

> **Last aligned to code**: 2026-02-22

This guide covers how to integrate, extend, debug, and test the V6 agent generation system.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Integrating V6 in Your Application](#integrating-v6-in-your-application)
3. [Extending the System](#extending-the-system)
4. [Debugging and Troubleshooting](#debugging-and-troubleshooting)
5. [Reading the Dev Log](#reading-the-dev-log)
6. [Common Execution Issues](#common-execution-issues)
7. [Testing](#testing)
8. [Best Practices](#best-practices)

---

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API key (for Phase 0 — requirements extraction)
- Anthropic API key (for Phase 3 — IR formalization)
- Supabase instance (for plugin connections and admin config)

### Environment Variables

```env
# Required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# Optional
DEBUG_IR_FORMALIZER=true                # Enable Phase 3 debug logging
```

### Quick Test

The fastest way to test the full pipeline:

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000/test-v6-declarative.html`
3. Enter a User ID with connected plugins (e.g., `offir.omer@gmail.com`)
4. Paste or edit the Enhanced Prompt JSON
5. Click "Run Full Pipeline"
6. Switch to Execution tab and click "Execute Workflow"

See [V6_TEST_DECLARATIVE.md](./V6_TEST_DECLARATIVE.md) for the full test page guide.

---

## Integrating V6 in Your Application

### Orchestrator Mode (Recommended)

```typescript
async function generateWorkflow(enhancedPrompt: EnhancedPrompt, userId: string) {
  const response = await fetch('/api/v6/generate-ir-semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enhanced_prompt: enhancedPrompt,
      userId,
      use_v6_orchestrator: true     // ← Required for orchestrator mode
    })
  })

  const result = await response.json()

  if (!result.success) {
    // Check which phase failed
    console.error(`Pipeline failed at phase: ${result.phase}`, result.error)
    throw new Error(result.error)
  }

  return {
    workflow: result.workflow,                    // WorkflowStep[] (PILOT format)
    requirements: result.hard_requirements,       // Phase 0 output
    requirementMap: result.requirement_map,        // Enforcement tracking
    validationResults: result.validation_results,  // Gate pass/fail
    ir: result.phase3_ir,                          // Full IR for debugging
    dslBeforeTranslation: result.phase4_dsl_before_translation  // Pre-translation DSL
  }
}
```

### Execute a Compiled Workflow

```typescript
async function executeWorkflow(
  workflow: WorkflowStep[],
  userId: string,
  pluginsRequired: string[]
) {
  const response = await fetch('/api/v6/execute-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow,
      plugins_required: pluginsRequired,
      user_id: userId,
      workflow_name: 'My Workflow',
      input_variables: {}
    })
  })

  const result = await response.json()

  if (!result.success) {
    console.error('Execution failed:', result.error)
  }

  return result.data  // { stepsCompleted, stepsFailed, execution_time_ms, ... }
}
```

### Programmatic Execution (Direct, No HTTP)

```typescript
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot'

const pilot = new WorkflowPilot(supabase, stateManager)
const result = await pilot.execute(
  agent,            // Agent object with pilot_steps
  userId,
  'Execution name',
  inputVariables,
  sessionId,
  stepEmitter,      // Optional: real-time progress events
  debugMode         // Optional: step-by-step tracing
)
```

### Override Admin Configuration

The orchestrator uses admin-configured models by default. To override for testing:

```typescript
{
  use_v6_orchestrator: true,
  enhanced_prompt: {...},
  config: {
    provider: 'openai',        // Override all phases to use OpenAI
    model: 'gpt-4o',
    formalization_temperature: 0.0
  }
}
```

When `config` is provided, the `withProviderFallback()` wrapper is activated, which retries the entire pipeline with a secondary provider on failure.

---

## Extending the System

### Adding New Plugins

The V6 system auto-discovers plugins through the PluginManager. To add a new plugin:

1. **Create plugin definition** with actions, parameters, and output schemas
2. **Register** in `lib/server/plugin-manager-v2.ts`
3. The IRFormalizer will automatically inject the plugin's schema into the LLM context
4. The ExecutionGraphCompiler will resolve the plugin during compilation

### Adding Custom Compilation Rules

The `ExecutionGraphCompiler` processes nodes by type. To add a new operation type:

1. Add the operation type to `OperationConfig` in `declarative-ir-types-v4.ts`
2. Add a compilation method in `ExecutionGraphCompiler.ts`
3. Add a resolver in `lib/agentkit/v6/compiler/resolvers/`
4. Add the step type to `StepType` in `pilot-dsl-types.ts`
5. Add execution handling in `StepExecutor.ts`

### Adding New Requirement Types

To track new types of constraints through the pipeline:

1. Add the type to the extraction prompt in `hard-requirements-extraction-system.md`
2. Update `HardRequirements` interface in `HardRequirementsExtractor.ts`
3. Add validation rules in `ValidationGates.ts` (Gates 3, 4, 5)
4. Add auto-recovery handling in `AutoRecoveryHandler.ts` if applicable

---

## Debugging and Troubleshooting

### Inspecting Intermediate Results

The orchestrator returns all phase outputs for debugging:

```typescript
const result = await fetch('/api/v6/generate-ir-semantic', {
  method: 'POST',
  body: JSON.stringify({
    enhanced_prompt: {...},
    use_v6_orchestrator: true
  })
}).then(r => r.json())

// Phase 0: What constraints were extracted?
console.log('Requirements:', result.hard_requirements)
console.log('Requirement Map:', result.requirement_map)

// Phase 3: What IR was produced?
console.log('IR:', result.phase3_ir)
console.log('Execution Graph Nodes:', Object.keys(result.phase3_ir?.execution_graph?.nodes || {}))

// Phase 4: What DSL was compiled BEFORE translation?
console.log('Pre-translation DSL:', result.phase4_dsl_before_translation)
console.log('DSL step count:', result.phase4_dsl_before_translation?.length)

// Phase 5: What PILOT steps were produced?
console.log('Final workflow:', result.workflow)
console.log('Final step count:', result.workflow?.length)

// Gate results
console.log('Gates:', result.validation_results)

// Compilation diagnostics
console.log('Compilation logs:', result.compilation_logs)
console.log('Compilation errors:', result.compilation_errors)
```

### Step Count Changes Between Phases

A common debugging scenario: Phase 4 produces N steps but Phase 5 outputs fewer. This is expected when:
- Nested steps are absorbed into parent `conditional` or `scatter_gather` steps
- `end` nodes produce no steps
- `parallel` nodes are expanded inline

Compare `phase4_dsl_before_translation.length` vs `workflow.length` — the difference should be accounted for by nesting.

### Debugging Conditional Branches

If a conditional step isn't executing its branches:

1. Check the condition in the compiled output — does it have `then`/`else` arrays?
2. Check Phase 4 DSL — were branch steps present before translation?
3. Check the condition evaluation — is the field resolving to the expected value?
4. **Empty array gotcha**: `{{result.items}}` where items is `[]` evaluates as **truthy** (use `is_empty`/`is_not_empty` operator instead)

---

## Reading the Dev Log

The `dev.log` captures the full execution trace from compilation through execution. Here's how to read it.

### Log Prefixes

| Prefix | Source | What It Logs |
|--------|--------|-------------|
| `[API]` | `app/api/v6/generate-ir-semantic/route.ts` | Pipeline orchestration: request received, phase transitions, provider info, timing |
| `[V6-TEST-EXEC]` | `app/api/v6/execute-test/route.ts` | Execution API: workflow steps count, plugins required, user resolution, timing |
| `[HardRequirementsExtractor]` | `lib/agentkit/v6/requirements/HardRequirementsExtractor.ts` | Phase 0: LLM call start, extracted requirement counts |
| `[AgentGenerationConfig]` | `lib/agentkit/v6/config/AgentGenerationConfigService.ts` | Admin config: loaded from DB, cache refresh, defaults used |
| `[ExecutionGraphCompiler]` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Phase 4: compilation warnings (unknown conditions, combineWith operators) |
| `[AutoRecovery]` | `lib/agentkit/v6/requirements/AutoRecoveryHandler.ts` | Gate 3 recovery: error categorization, fix attempts |
| `[WorkflowPilot]` | `lib/pilot/WorkflowPilot.ts` | Execution engine: config, step execution, metadata persistence, errors |
| `[StepExecutor]` | `lib/pilot/StepExecutor.ts` | Step execution: cache misses, batch calibration decisions |
| `[BatchCalibration]` | `lib/pilot/StepExecutor.ts` | Error classification and continue/stop decisions |
| `[ShadowAgent]` | `lib/pilot/WorkflowPilot.ts` | Shadow agent initialization (calibration vs production mode) |
| `[ResumeOrchestrator]` | `lib/pilot/WorkflowPilot.ts` | Step repair and re-execution after failure |

### Tracing a Compilation Flow

Look for this sequence in the log:

```
[API] /api/v6/generate-ir-semantic - POST
[API] Using V6 Pipeline Orchestrator with requirements tracking
[AgentGenerationConfig] ✓ Loaded from database
[HardRequirementsExtractor] Starting LLM-based extraction (openai/gpt-4o-mini)...
[HardRequirementsExtractor] Extracted N requirements
[API] V6 Orchestrator run completed, success: true
[API] Used provider: anthropic (primary), attempts: 1, duration: Xms
```

If the pipeline fails:
```
[API] V6 pipeline failed after all retries and fallback: <error>
[API] V6 Orchestrator error: <error detail>
[API] V6 Orchestrator stack: <stack trace>
```

### Tracing an Execution Flow

Look for this sequence:

```
[V6-TEST-EXEC] Test execution request received
[V6-TEST-EXEC] Workflow steps: N
[V6-TEST-EXEC] Plugins required: [google-mail, google-sheets]
[V6-TEST-EXEC] Resolved user UUID: <uuid>
[V6-TEST-EXEC] Created temporary agent: <agent-id>
[V6-TEST-EXEC] Starting workflow execution...
[WorkflowPilot] Configuration loaded: {...}
... (individual step logs) ...
[V6-TEST-EXEC] Execution complete in Xms
[V6-TEST-EXEC] Success: true
[V6-TEST-EXEC] Steps completed: N
```

### What to Look For When "Execution Succeeded But Nothing Happened"

This is a common debugging scenario where the UI shows success but the expected side effects (email sent, sheet updated) didn't occur. Check:

1. **Step count at execution**: `[V6-TEST-EXEC] Workflow steps: N` — if N is unexpectedly low, the Phase 5 translation may have dropped steps
2. **Conditional evaluation**: Look for condition evaluation logs — did the condition resolve to the expected branch?
3. **Step results**: Check if action steps returned empty data (e.g., `total_found: 0`)
4. **Branch content**: If a conditional step completed with just `{ result: true/false }` but no branch steps ran, the `then`/`else` arrays may be empty in the compiled output

### Interpreting External API Calls in the Log

The dev.log also captures HTTP calls to external services:

| Log Pattern | What It Means |
|-------------|---------------|
| `POST api.openai.com/v1/chat/completions` | Phase 0 LLM call (requirements extraction) |
| `POST api.anthropic.com/v1/messages` | Phase 3 LLM call (IR formalization) |
| `GET gmail.googleapis.com/gmail/v1/users/me/messages` | Gmail search during execution |
| `POST www.googleapis.com/upload/...` | Google Drive/Sheets upload during execution |
| `POST api.openai.com/v1/chat/completions` (during execution) | AI processing step or memory summarization |

---

## Common Execution Issues

### Issue 1: Empty Array Treated as Truthy

**Symptom**: Conditional takes the wrong branch when data is empty

**Root cause**: In JavaScript, `[]` is truthy. A condition like `{{emails.items}}` evaluates to `true` even when the array is empty.

**Fix**: Use explicit operators:
```json
{ "field": "{{emails.items}}", "operator": "is_not_empty" }
```
Or check length:
```json
{ "field": "{{emails.total_found}}", "operator": "greater_than", "value": 0 }
```

### Issue 2: Conditional Branch Steps Not Executing

**Symptom**: Conditional step completes with `{ result: true }` but no branch steps run

**Root cause**: The `then`/`else` arrays are empty in the compiled workflow — branch steps were lost during Phase 5 translation.

**Debug**: Compare `phase4_dsl_before_translation` (should have branch steps) with `workflow` (may be missing them). Check if the DSL uses `steps`/`else_steps` (old format) vs `then`/`else` (PILOT format).

### Issue 3: Variable Not Found

**Error**: `VariableResolutionError: Variable {{step1.data}} not found`

**Cause**: Step1 hasn't executed yet (missing dependency) or failed

**Fix**: Ensure the step has correct `dependencies` array:
```json
{ "step_id": "step2", "dependencies": ["step1"], "input": "{{step1.data}}" }
```

### Issue 4: Plugin Authentication Failure

**Error**: `Plugin execution failed: Not authenticated for google-mail`

**Cause**: User hasn't connected plugin OAuth or tokens expired

**Fix**: Check `user_plugins` table:
```sql
SELECT * FROM user_plugins WHERE user_id = '...' AND plugin_key = 'google-mail';
```

### Issue 5: Scatter-Gather Returns Empty

**Symptom**: Loop step completes but result is empty array

**Cause**: The scatter input array was empty — the loop body never executes

**Fix**: Add a conditional before the scatter-gather to check if the input array is non-empty. Or handle in the workflow logic.

### Issue 6: Step Count Drop After Phase 5

**Symptom**: Phase 4 produced 19 steps but Phase 5 only has 2

**Cause**: Phase 5 `translateToPilotFormat()` nests branch/loop steps inside their parent conditional/scatter_gather steps. The top-level count drops because nested steps are inside parent step objects, not flat in the array.

**Not a bug**: This is expected. Check the `then`, `else`, and `scatter.steps` arrays inside the parent steps — the nested steps should be there.

### Issue 7: FK Constraint Errors in Post-Execution

**Symptom**: Log shows FK constraint errors for `agent_id` not found in `agents` table

**Cause**: The execute-test endpoint creates a temporary agent that may not persist. Metrics/memory systems try to reference it.

**Impact**: Non-blocking — execution results are still returned correctly. These are logging artifacts.

---

## Testing

### Unit Testing Individual Phases

```typescript
// Test Phase 0
import { HardRequirementsExtractor } from '@/lib/agentkit/v6/requirements/HardRequirementsExtractor'

const extractor = new HardRequirementsExtractor({ provider: 'openai', model: 'gpt-4o-mini', temperature: 0 })
const { requirements, requirementMap } = await extractor.extract(enhancedPrompt)
expect(requirements.requirements.length).toBeGreaterThan(0)
```

```typescript
// Test Phase 4
import { ExecutionGraphCompiler } from '@/lib/agentkit/v6/compiler/ExecutionGraphCompiler'

const compiler = new ExecutionGraphCompiler()
const { steps, errors } = await compiler.compile(ir, hardRequirements)
expect(errors).toHaveLength(0)
expect(steps.length).toBeGreaterThan(0)
```

### Integration Testing

```typescript
const result = await fetch('/api/v6/generate-ir-semantic', {
  method: 'POST',
  body: JSON.stringify({
    enhanced_prompt: testPrompt,
    use_v6_orchestrator: true
  })
}).then(r => r.json())

expect(result.success).toBe(true)
expect(result.workflow.length).toBeGreaterThan(0)
expect(result.validation_results.final.result).toBe('PASS')
```

### Test Suites

| Test File | Coverage |
|-----------|----------|
| `__tests__/DeclarativeCompiler-comprehensive.test.ts` | Core compilation |
| `__tests__/DeclarativeCompiler-dataflow.test.ts` | Variable flow |
| `__tests__/DeclarativeCompiler-regression.test.ts` | Bug regression |
| `__tests__/v6-integration.test.ts` | End-to-end pipeline |

---

## Best Practices

### 1. Always Use Orchestrator Mode

```typescript
// Good: use the orchestrator for full pipeline + gates
{ use_v6_orchestrator: true }

// Avoid: legacy mode doesn't have Phase 0, validation gates, or auto-recovery
{ /* no flag */ }
```

### 2. Provide services_involved

```typescript
// Good: tells the IRFormalizer which plugin schemas to inject (token optimization)
specifics: { services_involved: ['google-mail', 'google-sheets'] }

// Bad: IRFormalizer injects ALL plugin schemas (~14,400 extra tokens)
specifics: {}
```

### 3. Provide resolved_user_inputs

```typescript
// Good: literal values are injected into the IR
resolved_user_inputs: [
  { key: 'spreadsheet_id', value: 'abc123' },
  { key: 'filter_keywords', value: ['complaint', 'refund'] }
]

// Bad: LLM has to guess or use placeholder values
resolved_user_inputs: []
```

### 4. Check Gate Results, Not Just Success

```typescript
if (result.success) {
  // Also verify gates
  const gates = result.validation_results
  if (gates.final.result !== 'PASS') {
    console.warn('Pipeline succeeded but Gate 5 has concerns:', gates.final.reason)
  }

  // Check requirement enforcement
  const total = result.metadata.total_requirements
  const enforced = result.metadata.requirements_enforced
  if (enforced < total) {
    console.warn(`Only ${enforced}/${total} requirements enforced`)
  }
}
```

### 5. Use the Test Page Download Feature

After a successful compilation, click "Download All Phases" to get a single JSON with all phase outputs. This is invaluable for debugging — you can see exactly what each phase produced and where issues started.

### 6. Compare Phase 4 vs Phase 5 Output

When debugging unexpected behavior, always compare `phase4_dsl_before_translation` (the raw compiled DSL) with the final `workflow` (PILOT format). This reveals whether issues originated in compilation (Phase 4) or translation (Phase 5).

---

## Additional Resources

- [V6 Overview](./V6_OVERVIEW.md) — High-level introduction
- [V6 Architecture](./V6_ARCHITECTURE.md) — Deep dive into each phase
- [V6 API Reference](./V6_API_REFERENCE.md) — Complete API documentation
- [V6 Execution Guide](./V6_EXECUTION_GUIDE.md) — Runtime engine internals
- [V6 Test Declarative](./V6_TEST_DECLARATIVE.md) — Test page UI guide

---

*V6 Agent Generation System - Neuronforge*
