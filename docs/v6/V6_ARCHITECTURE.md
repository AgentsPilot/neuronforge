# V6 Agent Generation System - Architecture

This document provides a deep technical dive into each phase of the V6 generation pipeline.

## Table of Contents

1. [Phase 1: Understanding (Semantic Plan)](#phase-1-understanding-semantic-plan)
2. [Phase 2: Grounding](#phase-2-grounding)
3. [Phase 3: Formalization (IR Generation)](#phase-3-formalization-ir-generation)
4. [Phase 4: Compilation](#phase-4-compilation)
5. [Phase 5: Validation & Normalization](#phase-5-validation--normalization)
6. [Data Flow](#data-flow)
7. [Error Handling](#error-handling)

---

## Phase 1: Understanding (Semantic Plan)

### Purpose
Generate a semantic representation of user intent that explicitly captures assumptions, ambiguities, and reasoning - without being forced to produce precise, executable IR.

### Key Component
`lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts`

### Input: Enhanced Prompt
```typescript
interface EnhancedPrompt {
  sections: {
    data: string[]          // Data sources to read
    actions?: string[]      // Operations to perform
    output?: string[]       // Output format specifications
    delivery: string[]      // Where to deliver results
    processing_steps?: string[]  // Additional processing
  }
  user_context?: {
    original_request: string
    clarifications?: Record<string, string>
  }
}
```

### Output: Semantic Plan
```typescript
interface SemanticPlan {
  plan_version: string
  goal: string

  // Core understanding
  understanding: {
    data_sources: DataSourceUnderstanding[]
    operations: OperationUnderstanding[]
    delivery: DeliveryUnderstanding
  }

  // Explicit uncertainty
  assumptions: Assumption[]      // Things the LLM assumed
  ambiguities: Ambiguity[]       // Unclear aspects
  inferences: Inference[]        // Logical deductions

  // Debugging support
  reasoning_trace: ReasoningStep[]
}

interface Assumption {
  id: string                           // e.g., "email_field_assumption"
  category: 'field_name' | 'data_type' | 'value_format' | 'structure' | 'behavior'
  description: string                  // "The email column is named 'email' or 'email_address'"
  impact_if_wrong: 'critical' | 'major' | 'minor'
  fallback?: string                    // What to do if wrong
  validation_strategy: {
    method: 'field_match' | 'data_sample' | 'pattern_match' | 'heuristic'
    parameters?: {
      candidates?: string[]            // Field name candidates to try
      expected_type?: string
      pattern?: string
    }
  }
}
```

### Design Philosophy
- **Higher temperature** (0.3): We want reasoning, not just precision
- **Permissive validation**: Structural issues generate warnings, not errors
- **Explicit uncertainty**: LLM is encouraged to express what it doesn't know

### LLM Providers
Supports both OpenAI and Anthropic:
- OpenAI: Uses JSON Schema strict mode for guaranteed structure
- Anthropic: Parses JSON from markdown-wrapped responses

---

## Phase 2: Grounding

### Purpose
Validate semantic plan assumptions against real data, resolving fuzzy field names to exact matches.

### Key Components
- `lib/agentkit/v6/semantic-plan/grounding/GroundingEngine.ts` - Main orchestrator
- `lib/agentkit/v6/semantic-plan/grounding/FieldMatcher.ts` - Fuzzy field matching
- `lib/agentkit/v6/semantic-plan/grounding/DataSampler.ts` - Data validation

### Input
```typescript
interface GroundingContext {
  semantic_plan: SemanticPlan
  data_source_metadata: DataSourceMetadata
  config?: GroundingConfig
}

interface DataSourceMetadata {
  headers?: string[]                        // Column names
  fields?: { name: string; description?: string }[]  // Rich field info
  sample_rows?: Record<string, any>[]       // Sample data
}
```

### Output: Grounded Semantic Plan
```typescript
interface GroundedSemanticPlan extends SemanticPlan {
  grounded: true
  grounding_results: GroundingResult[]
  grounding_errors: GroundingError[]
  grounding_confidence: number              // 0.0 - 1.0
  grounding_timestamp: string
  validated_assumptions_count: number
  skipped_assumptions_count: number
}

interface GroundingResult {
  assumption_id: string
  validated: boolean
  confidence: number
  resolved_value: any                       // The actual field name found
  validation_method: string
  evidence: string
  alternatives?: { value: string; confidence: number; reasoning: string }[]
}
```

### Field Matching Algorithms

The `FieldMatcher` uses multiple strategies:

1. **Exact Match**: Direct string equality
2. **Case-Insensitive Match**: `email` = `Email` = `EMAIL`
3. **Separator Normalization**: `email_address` = `emailAddress` = `email-address`
4. **Fuzzy Match**: Levenshtein distance with configurable threshold
5. **Semantic Match**: Uses field descriptions when available

```typescript
// Example: Matching "email" against actual headers
const result = fieldMatcher.matchMultipleCandidates(
  ['email', 'email_address', 'emailAddr'],  // Candidates from assumption
  ['id', 'email_addr', 'name', 'created_at'], // Actual headers
  { min_similarity: 0.7 }
)
// Result: { matched: true, actual_field_name: 'email_addr', confidence: 0.85 }
```

### Validation Categories

| Category | What it validates | Method |
|----------|------------------|--------|
| `field_name` | Column exists with similar name | Field matching |
| `data_type` | Field contains expected type | Data sampling |
| `value_format` | Values match pattern (email, date) | Pattern matching |
| `structure` | Data has expected structure | Structure check |
| `behavior` | Filter/transform produces results | Heuristic |

### Graceful Degradation
When metadata is missing (common in multi-datasource workflows):
- Assumptions are marked as `skipped`, not `failed`
- Confidence is set to 0.0 for skipped assumptions
- If >50% of assumptions are skipped, grounding fails entirely

---

## Phase 3: Formalization (IR Generation)

### Purpose
Mechanically map grounded semantic plan to precise Declarative IR using exact field names from grounding.

### Key Component
`lib/agentkit/v6/semantic-plan/IRFormalizer.ts`

### Design Philosophy
- **Very low temperature** (0.0): This is mechanical mapping, not reasoning
- **No guessing**: Uses only grounded facts for field names
- **Plugin-aware**: Injects available plugin schemas for correct operation types

### Input
Grounded Semantic Plan with validated field names.

### Output: Declarative IR
```typescript
interface DeclarativeLogicalIR {
  ir_version: '2.0'
  goal: string

  // Data sources with plugin bindings
  data_sources: {
    source: string
    type: 'tabular' | 'api'
    plugin_key: string          // e.g., 'google-sheets', 'google-mail'
    operation_type: string      // e.g., 'read_range', 'search_emails'
    role?: string               // 'primary', 'reference', 'destination'
    config?: Record<string, any>
  }[]

  // Filtering (with grounded field names)
  filters?: {
    combineWith: 'AND' | 'OR'
    conditions: FilterCondition[]
    groups?: FilterGroup[]
  }

  // AI operations
  ai_operations?: {
    task_type: 'classify' | 'extract' | 'summarize' | 'transform' | 'analyze'
    instruction: string
    context: string | string[]
    output_schema?: Record<string, any>
    constraints?: {
      temperature?: number
      max_tokens?: number
    }
  }[]

  // Output configuration
  delivery_rules: {
    destination: string
    format: 'table' | 'email' | 'message' | 'document'
    plugin_key: string
    operation_type: string
    // ... additional config
  }
}
```

### Plugin Injection
The IRFormalizer injects available plugin schemas into the LLM context:
```
## Available Plugins (Use these plugin_key values)

- **google-mail**: Gmail integration
  Actions:
    - search_emails: Search emails in Gmail
      • query (string): Gmail search query (e.g., "newer_than:7d")
      • max_results (number): Maximum emails to return
      **Output Fields**: id, subject, from, snippet, body, date, ...

- **google-sheets**: Google Sheets integration
  Actions:
    - read_range: Read data from a range
      • spreadsheetId (string) (required): The spreadsheet ID
      • range (string) (required): A1 notation range
```

This ensures the LLM uses correct `plugin_key` and `operation_type` values.

---

## Phase 4: Compilation

### Purpose
Compile Declarative IR to executable PILOT DSL workflow. This is **deterministic** - same IR always produces same workflow.

### Key Component
`lib/agentkit/v6/compiler/DeclarativeCompiler.ts` (~4,000 lines)

### Design Philosophy
The IR says **WHAT**, the compiler figures out **HOW**:
- Infers loops from delivery patterns
- Generates operation IDs automatically
- Manages variable flow between steps
- Auto-injects missing transforms (e.g., attachment extraction)
- Binds to appropriate plugins

### Compilation Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    DeclarativeCompiler.compile()                │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │ Validate IR │    │  Semantic   │    │ Initialize  │
   │   Schema    │    │ Validation  │    │   Context   │
   └─────────────┘    └─────────────┘    └─────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                    Compile Data Sources                      │
   │  - Primary data sources (read operations)                    │
   │  - Reference data sources (for deduplication)                │
   └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                      Compile Filters                         │
   │  - Convert IR conditions to filter steps                     │
   │  - Handle AND/OR groups                                      │
   └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                  Compile Delivery Pattern                    │
   │  - Detect loop requirements (per-item vs batch)              │
   │  - Compile AI operations                                     │
   │  - Compile transforms                                        │
   │  - Compile rendering                                         │
   └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                  Compile Write Operations                    │
   │  - Destination writes (sheets, email, etc.)                  │
   │  - Apply execution constraints                               │
   │  - Apply edge case handlers                                  │
   └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                    Normalize Inputs                          │
   │  - Fix data type mismatches                                  │
   │  - Ensure variable references are valid                      │
   └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                      WorkflowStep[]
```

### Output: PILOT DSL Workflow
```typescript
interface WorkflowStep {
  id: string              // Auto-generated: "step_1_read_sheets"
  name: string            // Human-readable name
  type: 'action' | 'transform' | 'ai' | 'loop' | 'filter' | 'render'
  plugin?: string         // Plugin to use (for action steps)
  action?: string         // Plugin action (for action steps)
  params?: Record<string, any>
  input?: string          // Variable reference: "{{step_1.data}}"
  output_schema?: any     // For schema-aware execution
  on_error?: ErrorHandler
}
```

### Compiler Context
The compiler maintains state during compilation:
```typescript
interface CompilerContext {
  currentVariable: string    // Current data in pipeline
  stepCounter: number        // For unique IDs
  warnings: string[]
  logs: string[]
  dataSourceConfigs: Map<string, any>
  primaryDataSourcePlugin?: string
  aiOutputFields?: string[]
  tabularDataVariable?: string
  contentDataVariable?: string
}
```

### Smart Inference Examples

**Loop Inference**:
```typescript
// IR with per-item delivery
delivery_rules: {
  strategy: 'per_item',
  destination: 'Send notification email'
}

// Compiler infers: Need a loop
→ Generates: { type: 'loop', iterate_over: '{{filtered_data}}', ... }
```

**Auto Transform Injection**:
```typescript
// IR with AI operation on attachments
ai_operations: [{
  context: ['attachment_content'],
  instruction: 'Extract invoice details'
}]

// Compiler detects: Need attachment extraction
→ Auto-injects: { type: 'transform', operation: 'extract_attachments', ... }
```

---

## Phase 5: Validation & Normalization

### Purpose
Ensure compiled workflow is valid and can execute without runtime errors.

### Key Components
- `lib/agentkit/v6/compiler/PilotNormalizer.ts` - Workflow normalization
- `lib/agentkit/v6/compiler/WorkflowPostValidator.ts` - Schema-driven validation

### Validation Rules

| Rule | Description | Auto-Fix |
|------|-------------|----------|
| Step ID uniqueness | All step IDs must be unique | Rename duplicates |
| Variable references | Referenced variables must exist | Error |
| Plugin existence | Plugin must be registered | Error |
| Action existence | Action must exist on plugin | Error |
| Parameter types | Params match expected types | Coerce when safe |
| Input compatibility | Step input matches previous output | Insert transform |

### Normalization Examples

**Step ID Collision**:
```typescript
// Before: Two steps with id "filter_1"
// After: "filter_1", "filter_1_2"
```

**Type Coercion**:
```typescript
// Before: temperature: "0.7" (string)
// After: temperature: 0.7 (number)
```

**Transform Injection**:
```typescript
// Before: AI step expects array, but input is object with .data property
// After: Insert transform step to extract .data
```

---

## Data Flow

### Variable Reference System

Variables flow through the pipeline using template syntax:

```
step_1_read → {{step_1_read.data}}
     │
     ▼
step_2_filter → {{step_2_filter.data}}
     │
     ▼
step_3_ai → {{step_3_ai.data}}
     │
     ▼
step_4_write (uses {{step_3_ai.data}})
```

### Plugin Output Schema Awareness

The compiler is aware of each plugin's output schema:

```typescript
// Google Sheets returns: { values: [...] }
// Gmail returns: { emails: [...] }
// The compiler knows which field contains the array:

ctx.currentVariable = `${stepId}.data.values`  // For sheets
ctx.currentVariable = `${stepId}.data.emails`  // For gmail
```

---

## Error Handling

### Phase-Specific Errors

| Phase | Error Type | Recovery |
|-------|------------|----------|
| Phase 1 | JSON parse failure | Retry with cleaner prompt |
| Phase 1 | Schema validation | Return with warnings |
| Phase 2 | Field not found | Use alternatives or fail |
| Phase 2 | >50% skipped | Fail grounding |
| Phase 3 | Invalid plugin | Error with available plugins |
| Phase 4 | Ungrounded fields | Fail compilation |
| Phase 5 | Invalid workflow | Error with details |

### Error Propagation

```typescript
// API returns structured errors
{
  success: false,
  error: 'Compilation failed',
  details: {
    phase: 'compilation',
    errors: [
      'Filter condition 1 has null field - cannot compile deterministically'
    ],
    suggestions: [
      'Check clarifications_required in the IR for missing grounded facts'
    ]
  }
}
```

---

## Performance Considerations

### LLM Call Optimization

| Phase | LLM Calls | Typical Latency |
|-------|-----------|-----------------|
| Phase 1 | 1 | 800-1500ms |
| Phase 2 | 0 | 50-150ms |
| Phase 3 | 1 | 500-900ms |
| Phase 4 | 0 | 100-200ms |
| Phase 5 | 0 | 20-50ms |

Total: ~2 LLM calls, ~1.5-3 seconds total

### Caching Opportunities

- **Plugin schemas**: Cached at startup
- **Grounding results**: Can be cached per data source
- **Compilation rules**: Static, no caching needed

---

*Next: [API Reference](./V6_API_REFERENCE.md)*
