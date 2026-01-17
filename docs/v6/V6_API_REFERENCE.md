# V6 Agent Generation System - API Reference

Complete API documentation for the V6 agent generation endpoints.

## Table of Contents

1. [Overview](#overview)
2. [Main Orchestration Endpoint](#main-orchestration-endpoint)
3. [Individual Phase Endpoints](#individual-phase-endpoints)
4. [Utility Endpoints](#utility-endpoints)
5. [Common Types](#common-types)
6. [Error Handling](#error-handling)

---

## Overview

### Base URL
All V6 endpoints are available under `/api/v6/`.

### Authentication
Most endpoints require a valid user session. Include the session cookie or authorization header.

### Content Type
All requests and responses use `application/json`.

---

## Main Orchestration Endpoint

### POST /api/v6/generate-ir-semantic

**Purpose**: Complete 5-phase workflow generation in a single call. This is the recommended endpoint for production use.

**Full Flow**: Enhanced Prompt → Semantic Plan → Grounding → IR → DSL → Validation

#### Request

```typescript
interface GenerateIRSemanticRequest {
  // Required: Structured prompt
  enhanced_prompt: {
    sections: {
      data: string[]           // Data source descriptions
      actions?: string[]       // Operations to perform
      output?: string[]        // Output format specifications
      delivery: string[]       // Delivery destinations
      processing_steps?: string[]
    }
    user_context?: {
      original_request: string // Original user prompt
      clarifications?: Record<string, string>
    }
    specifics?: {
      services_involved?: string[] // Plugin keys (e.g., ['google-mail', 'google-sheets'])
    }
  }

  // Optional: Data source metadata for grounding
  data_source_metadata?: {
    type: 'tabular' | 'api'
    headers?: string[]          // Column names
    fields?: { name: string; description?: string }[]
    sample_rows?: Record<string, any>[]
  }

  // Optional: Auto-fetch metadata using authenticated plugin
  userId?: string
  data_source_config?: {
    plugin_key: string
    action_name?: string
    parameters: Record<string, any>
  }

  // Optional: Configuration
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    understanding_temperature?: number   // Default: 0.3
    formalization_temperature?: number   // Default: 0.0
    grounding_min_confidence?: number    // Default: 0.7
    return_intermediate_results?: boolean // Default: true
  }
}
```

#### Response

```typescript
interface GenerateIRSemanticResponse {
  success: boolean

  // Final executable workflow
  workflow?: {
    steps: WorkflowStep[]
    metadata: {
      goal: string
      plugins_used: string[]
    }
  }

  // Full PILOT DSL (ready for execution)
  dsl?: {
    pilot_dsl_version: string
    workflow: {
      id: string
      name: string
      description: string
      steps: WorkflowStep[]
    }
    metadata: {
      generated_at: string
      ir_version: string
    }
  }

  // Intermediate results (when return_intermediate_results: true)
  intermediate?: {
    semantic_plan: SemanticPlan
    grounded_plan: GroundedSemanticPlan
    declarative_ir: DeclarativeLogicalIR
    compilation_result: CompilationResult
  }

  // Error information
  error?: string
  details?: {
    phase: string
    errors: string[]
    suggestions?: string[]
  }

  // Metrics
  metadata?: {
    total_time_ms: number
    phase_times: {
      understanding: number
      grounding: number
      formalization: number
      compilation: number
      validation: number
    }
    tokens_used?: {
      understanding: number
      formalization: number
      total: number
    }
  }
}
```

#### Example

```bash
curl -X POST http://localhost:3000/api/v6/generate-ir-semantic \
  -H "Content-Type: application/json" \
  -d '{
    "enhanced_prompt": {
      "sections": {
        "data": ["Read emails from Gmail from the last 7 days"],
        "actions": ["Categorize each email as urgent, normal, or low priority"],
        "delivery": ["Write results to Google Sheets \"Email Summary\""]
      },
      "user_context": {
        "original_request": "Categorize my recent emails and save to spreadsheet"
      },
      "specifics": {
        "services_involved": ["google-mail", "google-sheets"]
      }
    },
    "config": {
      "return_intermediate_results": true
    }
  }'
```

---

## Individual Phase Endpoints

### POST /api/v6/generate-semantic-plan

**Purpose**: Phase 1 - Generate semantic plan from enhanced prompt.

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    temperature?: number   // Default: 0.3
    max_tokens?: number    // Default: 6000
  }
}
```

#### Response

```typescript
{
  success: boolean
  semantic_plan?: SemanticPlan
  metadata: {
    phase: 'understanding'
    provider: string
    model: string
    timestamp: string
  }
  error?: string
  details?: string
}
```

---

### POST /api/v6/ground-semantic-plan

**Purpose**: Phase 2 - Validate semantic plan assumptions against real data.

#### Request

```typescript
{
  semantic_plan: SemanticPlan
  data_source_metadata: {
    type: 'tabular' | 'api'
    headers?: string[]
    fields?: { name: string; description?: string }[]
    sample_rows?: Record<string, any>[]
  }
  config?: {
    min_confidence?: number              // Default: 0.7
    fail_fast?: boolean                  // Default: false
    require_confirmation_threshold?: number // Default: 0.85
    max_candidates?: number              // Default: 3
  }
}
```

#### Response

```typescript
{
  success: boolean
  grounded_plan?: GroundedSemanticPlan
  grounded_facts?: Record<string, any>  // Validated field mappings
  metadata: {
    phase: 'grounding'
    validated_count: number
    total_count: number
    confidence: number
    errors_count: number
    timestamp: string
  }
  error?: string
}
```

---

### POST /api/v6/formalize-to-ir

**Purpose**: Phase 3 - Convert grounded semantic plan to Declarative IR.

#### Request

```typescript
{
  grounded_plan: GroundedSemanticPlan
  config?: {
    model?: string         // Default: 'gpt-4o'
    temperature?: number   // Default: 0.0
    max_tokens?: number    // Default: 4000
  }
}
```

#### Response

```typescript
{
  success: boolean
  ir?: DeclarativeLogicalIR
  formalization_metadata?: {
    provider: string
    model: string
    grounded_facts_used: Record<string, any>
    missing_facts: string[]
    formalization_confidence: number
    timestamp: string
  }
  error?: string
}
```

---

### POST /api/v6/compile-declarative

**Purpose**: Phase 4 - Compile Declarative IR to PILOT DSL workflow.

#### Request

```typescript
{
  ir: DeclarativeLogicalIR
  userId?: string
  agentId?: string
  pipeline_context?: {
    semantic_plan?: {
      goal: string
      understanding?: any
      reasoning_trace?: any[]
    }
    grounded_facts?: Record<string, any>
    formalization_metadata?: {
      grounded_facts_used: Record<string, any>
      missing_facts: string[]
      formalization_confidence: number
    }
  }
  compiler_config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
  }
}
```

#### Response

```typescript
{
  success: boolean
  workflow?: WorkflowStep[]      // Legacy format
  dsl?: {                        // Full PILOT DSL
    pilot_dsl_version: string
    workflow: {
      id: string
      name: string
      description: string
      steps: WorkflowStep[]
    }
    metadata: any
  }
  validation?: {
    valid: boolean
    errors?: any[]
  }
  metadata?: {
    compilation_time_ms: number
    step_count: number
    plugins_used: string[]
    compiler_used?: string
    fallback_reason?: string
  }
  errors?: string[]
}
```

---

### POST /api/v6/compile-workflow

**Purpose**: Compile workflow and execute (for testing).

#### Request

```typescript
{
  workflow: WorkflowStep[]
  userId: string
  dryRun?: boolean  // If true, don't actually execute
}
```

---

## Utility Endpoints

### POST /api/v6/generate-declarative-ir

**Purpose**: Generate Declarative IR directly from enhanced prompt (skips semantic plan phase).

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    temperature?: number
  }
}
```

---

### POST /api/v6/generate-workflow-plan

**Purpose**: Generate a workflow plan (for planning mode).

#### Request

```typescript
{
  enhanced_prompt: EnhancedPrompt
  userId?: string
  config?: {
    provider?: string
    model?: string
  }
}
```

---

### POST /api/v6/update-workflow-plan

**Purpose**: Update an existing workflow plan with modifications.

#### Request

```typescript
{
  existing_plan: any
  modifications: string[]
  userId?: string
}
```

---

### POST /api/v6/fetch-plugin-data

**Purpose**: Fetch data from a plugin for metadata/grounding purposes.

#### Request

```typescript
{
  userId: string
  plugin_key: string
  action_name: string
  parameters: Record<string, any>
  limit?: number  // Limit rows returned
}
```

#### Response

```typescript
{
  success: boolean
  data?: any
  metadata?: {
    headers?: string[]
    row_count?: number
    sample_rows?: any[]
  }
  error?: string
}
```

---

### POST /api/v6/test-direct-generation

**Purpose**: Testing endpoint for direct workflow generation.

---

### POST /api/v6/execute-test

**Purpose**: Execute a test workflow in sandbox mode.

---

## Common Types

### EnhancedPrompt

```typescript
interface EnhancedPrompt {
  sections: {
    data: string[]              // Required: data source descriptions
    actions?: string[]          // Optional: operations to perform
    output?: string[]           // Optional: output format specs
    delivery: string[]          // Required: delivery destinations
    processing_steps?: string[] // Optional: explicit processing steps
  }
  user_context?: {
    original_request: string    // The user's original input
    clarifications?: Record<string, string>
  }
  specifics?: {
    services_involved?: string[]  // Plugin keys
    time_window?: string
    output_format?: string
  }
}
```

### SemanticPlan

```typescript
interface SemanticPlan {
  plan_version: string
  goal: string

  understanding: {
    data_sources: {
      name: string
      type: 'tabular' | 'api'
      plugin_key?: string
      search_criteria?: any
    }[]
    operations: {
      type: string
      description: string
      inputs: string[]
      output: string
    }[]
    delivery: {
      destination: string
      format: string
      plugin_key?: string
    }
  }

  assumptions: {
    id: string
    category: 'field_name' | 'data_type' | 'value_format' | 'structure' | 'behavior'
    description: string
    impact_if_wrong: 'critical' | 'major' | 'minor'
    fallback?: string
    validation_strategy: {
      method: 'field_match' | 'data_sample' | 'pattern_match' | 'heuristic'
      parameters?: {
        candidates?: string[]
        expected_type?: string
        pattern?: string
      }
    }
  }[]

  ambiguities: {
    id: string
    description: string
    possible_interpretations: string[]
    default_choice: string
    reasoning: string
  }[]

  inferences: {
    id: string
    conclusion: string
    based_on: string[]
    confidence: 'high' | 'medium' | 'low'
  }[]

  reasoning_trace: {
    step: number
    thought: string
    choice_made: string
    reasoning: string
  }[]
}
```

### DeclarativeLogicalIR

```typescript
interface DeclarativeLogicalIR {
  ir_version: '2.0'
  goal: string

  data_sources: {
    source: string
    type: 'tabular' | 'api'
    plugin_key: string
    operation_type: string
    role?: 'primary' | 'reference' | 'destination'
    config?: Record<string, any>
  }[]

  filters?: {
    combineWith: 'AND' | 'OR'
    conditions: {
      field: string
      operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'in' | 'not_in'
      value: any
    }[]
    groups?: {
      combineWith: 'AND' | 'OR'
      conditions: FilterCondition[]
    }[]
  }

  ai_operations?: {
    task_type: 'classify' | 'extract' | 'summarize' | 'transform' | 'analyze'
    instruction: string
    context: string | string[]
    output_schema?: Record<string, any>
    constraints?: {
      temperature?: number
      max_tokens?: number
      model?: string
    }
  }[]

  grouping?: {
    group_by: string
    aggregations?: {
      field: string
      operation: 'count' | 'sum' | 'avg' | 'min' | 'max'
      alias: string
    }[]
  }

  rendering?: {
    format: 'table' | 'html' | 'text' | 'json'
    columns_in_order?: string[]
    template?: string
  }

  delivery_rules: {
    destination: string
    format: 'table' | 'email' | 'message' | 'document'
    plugin_key: string
    operation_type: string
    config?: Record<string, any>
    strategy?: 'batch' | 'per_item'
  }

  execution_constraints?: {
    max_retries?: number
    timeout_ms?: number
    error_handling?: 'fail_fast' | 'continue_on_error' | 'retry'
  }

  edge_cases?: {
    condition: string
    handling: string
  }[]
}
```

### WorkflowStep

```typescript
interface WorkflowStep {
  id: string
  name: string
  type: 'action' | 'transform' | 'ai' | 'loop' | 'filter' | 'render' | 'scatter_gather'

  // For action steps
  plugin?: string
  action?: string
  params?: Record<string, any>

  // For transform steps
  operation?: string
  config?: Record<string, any>

  // For AI steps
  model?: string
  instruction?: string
  input_fields?: string[]
  output_schema?: Record<string, any>

  // For loop/scatter_gather steps
  iterate_over?: string
  steps?: WorkflowStep[]
  scatter?: {
    input: string
    steps: WorkflowStep[]
  }
  gather?: {
    operation: 'collect' | 'merge' | 'reduce'
  }

  // Common
  input?: string
  output_schema?: any
  on_error?: {
    action: 'skip' | 'fail' | 'retry'
    max_retries?: number
  }
}
```

---

## Error Handling

### Standard Error Response

```typescript
{
  success: false
  error: string           // Short error message
  details?: string        // Detailed error information
  phase?: string          // Which phase failed
  suggestions?: string[]  // How to fix the error
  stack?: string          // Stack trace (development only)
}
```

### Common Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid input structure |
| 401 | Unauthorized - Missing or invalid authentication |
| 403 | Forbidden - User lacks permission |
| 422 | Unprocessable Entity - Semantic validation failed |
| 500 | Internal Server Error - Unexpected error |
| 504 | Gateway Timeout - LLM call timed out |

### Phase-Specific Errors

**Phase 1 (Understanding)**:
- `JSON parse error`: LLM returned invalid JSON
- `Schema validation failed`: Output doesn't match semantic plan schema

**Phase 2 (Grounding)**:
- `No matching field found`: Field name couldn't be resolved
- `Insufficient validation`: >50% of assumptions skipped

**Phase 3 (Formalization)**:
- `Invalid plugin_key`: Plugin doesn't exist
- `Invalid operation_type`: Action doesn't exist on plugin

**Phase 4 (Compilation)**:
- `IR validation failed`: IR doesn't match schema
- `Ungrounded fields`: Filter has null field names

**Phase 5 (Validation)**:
- `Invalid step structure`: Step missing required fields
- `Variable reference error`: Referenced variable doesn't exist

---

*Next: [Developer Guide](./V6_DEVELOPER_GUIDE.md)*
