# V6 Agent Generation System - Developer Guide

This guide covers how to extend, integrate, and debug the V6 agent generation system.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Integrating V6 in Your Application](#integrating-v6-in-your-application)
3. [Extending the System](#extending-the-system)
4. [Adding New Plugins](#adding-new-plugins)
5. [Customizing Compilation Rules](#customizing-compilation-rules)
6. [Debugging and Troubleshooting](#debugging-and-troubleshooting)
7. [Testing](#testing)
8. [Best Practices](#best-practices)

---

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API key (for LLM calls)
- Optional: Anthropic API key (alternative LLM provider)

### Environment Variables

```env
# Required
OPENAI_API_KEY=sk-...

# Optional
ANTHROPIC_API_KEY=sk-ant-...
SEMANTIC_PLAN_PROMPT_VERSION=condensed  # or 'full' for verbose prompts
DEBUG_IR_FORMALIZER=true                 # Enable debug logging
```

### Quick Test

```typescript
import { SemanticPlanGenerator } from '@/lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'

const generator = new SemanticPlanGenerator({
  model_provider: 'openai',
  model_name: 'gpt-4o'
})

const result = await generator.generate({
  sections: {
    data: ['Read my Google Sheet "Contacts"'],
    delivery: ['Send an email to each contact']
  }
})

console.log(result.semantic_plan)
```

---

## Integrating V6 in Your Application

### Basic Integration

```typescript
// Using the main orchestration endpoint
async function generateWorkflow(userPrompt: string) {
  const response = await fetch('/api/v6/generate-ir-semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enhanced_prompt: {
        sections: {
          data: [userPrompt],
          delivery: ['Return results']
        },
        user_context: {
          original_request: userPrompt
        }
      }
    })
  })

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error)
  }

  return result.dsl  // Full PILOT DSL workflow
}
```

### With Grounding (Recommended for Production)

```typescript
async function generateWorkflowWithGrounding(
  userPrompt: string,
  dataSourceMetadata: DataSourceMetadata
) {
  const response = await fetch('/api/v6/generate-ir-semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enhanced_prompt: {
        sections: {
          data: [userPrompt],
          delivery: ['Write to spreadsheet']
        }
      },
      // Provide real data for grounding
      data_source_metadata: {
        type: 'tabular',
        headers: dataSourceMetadata.headers,
        sample_rows: dataSourceMetadata.sample_rows.slice(0, 5)
      }
    })
  })

  const result = await response.json()

  // Check grounding confidence
  if (result.intermediate?.grounded_plan?.grounding_confidence < 0.7) {
    console.warn('Low grounding confidence - some field names may be incorrect')
  }

  return result
}
```

### Fetching Data Source Metadata

```typescript
// Use the fetch-plugin-data endpoint to get metadata
async function fetchMetadataForGrounding(
  userId: string,
  pluginKey: string,
  params: Record<string, any>
) {
  const response = await fetch('/api/v6/fetch-plugin-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      plugin_key: pluginKey,
      action_name: 'read_range',  // or appropriate action
      parameters: params,
      limit: 10  // Just need a few rows for metadata
    })
  })

  const result = await response.json()

  return {
    type: 'tabular',
    headers: result.metadata?.headers || [],
    sample_rows: result.metadata?.sample_rows || []
  }
}
```

### Step-by-Step Integration (Advanced)

For maximum control, call each phase individually:

```typescript
async function generateWorkflowStepByStep(enhancedPrompt: EnhancedPrompt) {
  // Phase 1: Understanding
  const semanticResult = await fetch('/api/v6/generate-semantic-plan', {
    method: 'POST',
    body: JSON.stringify({ enhanced_prompt: enhancedPrompt })
  }).then(r => r.json())

  if (!semanticResult.success) {
    throw new Error(`Phase 1 failed: ${semanticResult.error}`)
  }

  // Phase 2: Grounding (optional but recommended)
  let groundedPlan = semanticResult.semantic_plan
  if (dataSourceMetadata) {
    const groundingResult = await fetch('/api/v6/ground-semantic-plan', {
      method: 'POST',
      body: JSON.stringify({
        semantic_plan: semanticResult.semantic_plan,
        data_source_metadata: dataSourceMetadata
      })
    }).then(r => r.json())

    if (groundingResult.success) {
      groundedPlan = groundingResult.grounded_plan
    }
  }

  // Phase 3: Formalization
  const irResult = await fetch('/api/v6/formalize-to-ir', {
    method: 'POST',
    body: JSON.stringify({ grounded_plan: groundedPlan })
  }).then(r => r.json())

  if (!irResult.success) {
    throw new Error(`Phase 3 failed: ${irResult.error}`)
  }

  // Phase 4: Compilation
  const compilationResult = await fetch('/api/v6/compile-declarative', {
    method: 'POST',
    body: JSON.stringify({ ir: irResult.ir })
  }).then(r => r.json())

  return compilationResult
}
```

---

## Extending the System

### Adding Custom Assumption Categories

Extend the `SemanticPlan` schema to support new assumption types:

```typescript
// lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types.ts

export type AssumptionCategory =
  | 'field_name'
  | 'data_type'
  | 'value_format'
  | 'structure'
  | 'behavior'
  | 'custom_category'  // Add your category

// Update validation in GroundingEngine
// lib/agentkit/v6/semantic-plan/grounding/GroundingEngine.ts

private async validateAssumption(assumption: Assumption, ...): Promise<GroundingResult> {
  switch (assumption.category) {
    // ... existing cases

    case 'custom_category':
      return this.validateCustomCategoryAssumption(assumption, metadata, config)

    // ...
  }
}
```

### Adding Custom Field Matching Strategies

```typescript
// lib/agentkit/v6/semantic-plan/grounding/FieldMatcher.ts

export class FieldMatcher {
  // Add a custom matching method
  matchWithCustomStrategy(
    candidate: string,
    availableFields: string[],
    customLogic: (candidate: string, field: string) => number
  ): FieldMatchResult {
    let bestMatch: FieldMatchResult = {
      matched: false,
      actual_field_name: null,
      confidence: 0,
      match_method: 'custom'
    }

    for (const field of availableFields) {
      const score = customLogic(candidate, field)

      if (score > bestMatch.confidence) {
        bestMatch = {
          matched: score >= this.config.min_similarity,
          actual_field_name: field,
          confidence: score,
          match_method: 'custom'
        }
      }
    }

    return bestMatch
  }
}
```

### Custom Post-Compilation Validators

```typescript
// lib/agentkit/v6/compiler/validators/CustomValidator.ts

export interface WorkflowValidator {
  validate(workflow: WorkflowStep[]): ValidationResult
}

export class CustomValidator implements WorkflowValidator {
  validate(workflow: WorkflowStep[]): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    for (const step of workflow) {
      // Your custom validation logic
      if (step.type === 'ai' && !step.instruction) {
        errors.push(`AI step ${step.id} missing instruction`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }
}

// Register in compilation pipeline
const customValidator = new CustomValidator()
const validation = customValidator.validate(compiledWorkflow)
```

---

## Adding New Plugins

The V6 system automatically discovers plugins through the PluginManager. To add a new plugin:

### 1. Create Plugin Definition

```typescript
// lib/plugins/my-plugin/definition.ts

export const myPluginDefinition = {
  plugin: {
    name: 'my-plugin',
    description: 'My custom plugin for XYZ',
    version: '1.0.0'
  },
  actions: {
    fetch_data: {
      description: 'Fetch data from XYZ service',
      usage_context: 'Use when reading data from XYZ',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query'
          },
          limit: {
            type: 'number',
            default: 100,
            description: 'Maximum results'
          }
        },
        required: ['query']
      },
      output_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                value: { type: 'number' }
              }
            }
          }
        }
      }
    },
    write_data: {
      description: 'Write data to XYZ service',
      parameters: {
        // ...
      }
    }
  }
}
```

### 2. Register Plugin

```typescript
// lib/server/plugin-manager-v2.ts

import { myPluginDefinition } from '@/lib/plugins/my-plugin/definition'

// Add to available plugins
this.availablePlugins['my-plugin'] = myPluginDefinition
```

### 3. Plugin is Automatically Available

The IRFormalizer will now include your plugin in the available plugins section sent to the LLM, and the DeclarativeCompiler will resolve it correctly.

---

## Customizing Compilation Rules

### Adding Custom Compilation Rules

```typescript
// lib/agentkit/v6/compiler/rules/MyCustomRule.ts

import type { DeclarativeLogicalIR } from '../logical-ir/schemas/declarative-ir-types'
import type { WorkflowStep } from '@/lib/pilot/types/pilot-dsl-types'

export class MyCustomRule {
  /**
   * Check if this rule applies to the given IR
   */
  matches(ir: DeclarativeLogicalIR): boolean {
    // Define when this rule should be used
    return (
      ir.data_sources.some(ds => ds.plugin_key === 'my-plugin') &&
      ir.ai_operations?.length > 0
    )
  }

  /**
   * Compile IR using this rule
   */
  compile(ir: DeclarativeLogicalIR, ctx: CompilerContext): WorkflowStep[] {
    const steps: WorkflowStep[] = []

    // Your custom compilation logic
    steps.push({
      id: `step_${ctx.stepCounter++}`,
      name: 'Custom Step',
      type: 'action',
      plugin: 'my-plugin',
      action: 'fetch_data',
      params: {
        query: ir.data_sources[0].config?.query
      }
    })

    return steps
  }
}
```

### Registering Custom Rules

```typescript
// lib/agentkit/v6/compiler/DeclarativeCompiler.ts

import { MyCustomRule } from './rules/MyCustomRule'

export class DeclarativeCompiler {
  private rules: CompilationRule[] = [
    new MyCustomRule(),  // Add your rule
    // ... existing rules
  ]

  async compile(ir: DeclarativeLogicalIR): Promise<CompilationResult> {
    // Rules are checked in order
    for (const rule of this.rules) {
      if (rule.matches(ir)) {
        return { success: true, workflow: rule.compile(ir, ctx) }
      }
    }

    // Fall back to default compilation
    return this.defaultCompile(ir, ctx)
  }
}
```

---

## Debugging and Troubleshooting

### Enable Debug Logging

```typescript
// Environment variables
DEBUG_IR_FORMALIZER=true
SEMANTIC_PLAN_PROMPT_VERSION=full  // See full prompts

// Or programmatically
process.env.DEBUG_IR_FORMALIZER = 'true'
```

### Inspecting Intermediate Results

Always request intermediate results when debugging:

```typescript
const result = await fetch('/api/v6/generate-ir-semantic', {
  method: 'POST',
  body: JSON.stringify({
    // ...
    config: {
      return_intermediate_results: true
    }
  })
}).then(r => r.json())

// Inspect each phase
console.log('Semantic Plan:', result.intermediate?.semantic_plan)
console.log('Assumptions:', result.intermediate?.semantic_plan?.assumptions)
console.log('Grounded Facts:', result.intermediate?.grounded_plan?.grounding_results)
console.log('IR:', result.intermediate?.declarative_ir)
console.log('Compiled Steps:', result.workflow?.steps)
```

### Common Issues and Solutions

#### Issue: Field Names Not Matching

**Symptom**: Grounding fails with "No matching field found"

**Solution**:
1. Check the actual headers in your data source
2. Provide field descriptions for semantic matching:

```typescript
data_source_metadata: {
  fields: [
    { name: 'email_addr', description: 'The email address of the contact' }
  ]
}
```

#### Issue: Compilation Fails with "Ungrounded Fields"

**Symptom**: `Filter condition has null field`

**Solution**:
1. Ensure grounding succeeded before compilation
2. Check `grounding_confidence` - if too low, provide better metadata
3. Review `grounding_errors` for specific failures

#### Issue: Wrong Plugin Action Selected

**Symptom**: Workflow uses wrong action (e.g., `write` instead of `append`)

**Solution**:
1. Check your plugin definition's `usage_context`
2. Make action descriptions more distinct
3. Add explicit `operation_type` in enhanced prompt

#### Issue: LLM Timeout

**Symptom**: Request times out after 30-90 seconds

**Solution**:
1. Use `condensed` prompt version
2. Reduce complexity of enhanced prompt
3. Split into multiple simpler workflows

### Compiler Metrics

Access compilation metrics for monitoring:

```typescript
import { compilerMetrics } from '@/lib/agentkit/v6/compiler/CompilerMetrics'

// Get recent compilation stats
const stats = compilerMetrics.getStats()
console.log('Success rate:', stats.successRate)
console.log('Average time:', stats.averageTimeMs)
console.log('Common errors:', stats.commonErrors)
```

---

## Testing

### Unit Testing Phases

```typescript
// __tests__/SemanticPlanGenerator.test.ts

describe('SemanticPlanGenerator', () => {
  it('should generate assumptions for field names', async () => {
    const generator = new SemanticPlanGenerator({
      model_provider: 'openai'
    })

    const result = await generator.generate({
      sections: {
        data: ['Read emails from Gmail'],
        delivery: ['Write to spreadsheet']
      }
    })

    expect(result.success).toBe(true)
    expect(result.semantic_plan.assumptions.length).toBeGreaterThan(0)
    expect(result.semantic_plan.assumptions.some(
      a => a.category === 'field_name'
    )).toBe(true)
  })
})
```

### Testing Grounding

```typescript
// __tests__/GroundingEngine.test.ts

describe('GroundingEngine', () => {
  it('should match fuzzy field names', async () => {
    const engine = new GroundingEngine()

    const result = await engine.ground({
      semantic_plan: mockSemanticPlan,
      data_source_metadata: {
        type: 'tabular',
        headers: ['email_addr', 'first_name', 'last_name']
      }
    })

    // Should match "email" assumption to "email_addr"
    const emailResult = result.grounding_results.find(
      r => r.assumption_id === 'email_field'
    )
    expect(emailResult?.validated).toBe(true)
    expect(emailResult?.resolved_value).toBe('email_addr')
  })
})
```

### Integration Testing

```typescript
// __tests__/v6-integration.test.ts

describe('V6 Full Pipeline', () => {
  it('should generate valid workflow end-to-end', async () => {
    const result = await fetch('/api/v6/generate-ir-semantic', {
      method: 'POST',
      body: JSON.stringify({
        enhanced_prompt: {
          sections: {
            data: ['Read data from spreadsheet'],
            delivery: ['Send summary email']
          }
        }
      })
    }).then(r => r.json())

    expect(result.success).toBe(true)
    expect(result.dsl.workflow.steps.length).toBeGreaterThan(0)

    // Validate each step has required fields
    for (const step of result.dsl.workflow.steps) {
      expect(step.id).toBeDefined()
      expect(step.type).toBeDefined()
    }
  })
})
```

---

## Best Practices

### 1. Always Provide Grounding Data

```typescript
// Good: Provide actual headers for better accuracy
data_source_metadata: {
  headers: actualDataHeaders,
  sample_rows: actualData.slice(0, 5)
}

// Avoid: Skipping grounding entirely
data_source_metadata: undefined  // Leads to guessed field names
```

### 2. Use Specific Plugin Keys

```typescript
// Good: Explicit plugin specification
specifics: {
  services_involved: ['google-mail', 'google-sheets']
}

// Avoid: Letting the system guess
specifics: {}  // May pick wrong plugins
```

### 3. Handle Low Confidence Results

```typescript
if (result.intermediate?.grounded_plan?.grounding_confidence < 0.7) {
  // Ask user to confirm field mappings
  const confirmedMappings = await showConfirmationDialog(
    result.intermediate.grounded_plan.grounding_results
  )

  // Retry with confirmed mappings
  // ...
}
```

### 4. Validate Before Execution

```typescript
import { validateWorkflowStructure } from '@/lib/pilot/schema'

const validation = validateWorkflowStructure(workflow)
if (!validation.valid) {
  console.error('Workflow validation failed:', validation.errors)
  // Handle error
}
```

### 5. Log Intermediate Results for Debugging

```typescript
// In production, log phase outputs for debugging
logger.info('V6 Generation', {
  userId,
  phases: {
    understanding: result.intermediate?.semantic_plan ? 'success' : 'failed',
    grounding: result.intermediate?.grounded_plan?.grounding_confidence,
    formalization: result.intermediate?.declarative_ir ? 'success' : 'failed',
    compilation: result.success
  },
  totalTimeMs: result.metadata?.total_time_ms
})
```

### 6. Use Type Safety

```typescript
import type { EnhancedPrompt } from '@/lib/agentkit/v6/generation/types'
import type { SemanticPlan } from '@/lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types'
import type { DeclarativeLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

// TypeScript will catch structural errors
const prompt: EnhancedPrompt = {
  sections: {
    data: ['...'],
    delivery: ['...']
  }
}
```

---

## Additional Resources

- **[V6 Overview](./V6_OVERVIEW.md)** - High-level introduction
- **[V6 Architecture](./V6_ARCHITECTURE.md)** - Deep dive into each phase
- **[V6 API Reference](./V6_API_REFERENCE.md)** - Complete API documentation
- **Test Suites**: `__tests__/DeclarativeCompiler-*.test.ts`
- **Example Workflows**: `docs/V6_WORKFLOW_PATTERN_CATALOG.md`

---

*V6 Agent Generation System - Neuronforge*
