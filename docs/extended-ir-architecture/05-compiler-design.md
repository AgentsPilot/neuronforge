# Compiler Design

## Overview

The compiler is a **deterministic, rule-based system** that converts Logical IR → PILOT_DSL workflows.

**Key Principle:** No LLM calls during compilation = predictable, fast, testable.

## Compiler Architecture

```typescript
class LogicalIRCompiler {
  private rules: CompilerRule[]
  
  compile(ir: ExtendedLogicalIR, context: CompilerContext): CompilerResult {
    // 1. Validate IR
    const validation = validateIR(ir)
    if (!validation.valid) {
      return { success: false, errors: validation.errors }
    }
    
    // 2. Find matching rule
    for (const rule of this.rules) {
      if (rule.supports(ir)) {
        return rule.compile(ir, context)
      }
    }
    
    // 3. No rule found
    return {
      success: false,
      errors: ['No compiler rule supports this IR pattern']
    }
  }
}
```

## Compiler Rule Interface

```typescript
interface CompilerRule {
  name: string
  priority: number
  
  // Does this rule support this IR?
  supports(ir: ExtendedLogicalIR): boolean
  
  // Compile IR to PILOT_DSL
  compile(ir: ExtendedLogicalIR, context: CompilerContext): CompilerResult
}

interface CompilerContext {
  plugins: PluginDefinition[]
  availableActions: Map<string, ActionDefinition>
}

interface CompilerResult {
  success: boolean
  workflow?: PilotWorkflow
  errors?: string[]
  warnings?: string[]
  metadata?: {
    compiler_rule: string
    optimizations: string[]
  }
}
```

## 5 Core Compiler Rules

### 1. TabularGroupedDeliveryRule

**Supports:**
- Tabular data sources
- Filtering + Grouping
- Per-group delivery (email/slack)

**Pattern:**
```
Read spreadsheet → Filter → Group by field → Send per group
```

**Example IR:**
```json
{
  "data_sources": [{ "type": "tabular", "location": "MyLeads" }],
  "filters": [{ "field": "stage", "operator": "equals", "value": 4 }],
  "grouping": { "group_by": "Sales Person" },
  "delivery": [{ "method": "email", "recipient_source": "group_key" }]
}
```

**Compiled Steps:**
1. Action: Google Sheets read
2. Validation: Check headers
3. Transform: Filter
4. Transform: Partition
5. Scatter-Gather: Loop groups
   - Transform: Render table
   - Conditional: Check partition name
     - If missing → Email to fallback
     - Else → Email to group_key

---

### 2. EventTriggeredRule

**Supports:**
- Webhook/event data sources
- Optional filtering
- Single or conditional actions

**Pattern:**
```
Webhook trigger → Validate → [Optional: Filter/Transform] → Action(s)
```

**Example IR:**
```json
{
  "data_sources": [{ "type": "webhook", "trigger": "form_submit" }],
  "filters": [{ "field": "email", "operator": "is_not_empty" }],
  "delivery": [
    { "method": "api_call", "endpoint": "crm", "action": "create_contact" },
    { "method": "email", "recipient": "{{email}}", "subject": "Welcome!" }
  ]
}
```

**Compiled Steps:**
1. Action: Webhook receive
2. Validation: Required fields
3. Transform: Filter (optional)
4. Action: CRM API call
5. Action: Send email

---

### 3. ConditionalBranchRule

**Supports:**
- Conditionals as primary pattern
- If/then/else workflows
- Approval flows

**Pattern:**
```
Read data → Evaluate condition → Branch A or B
```

**Example IR:**
```json
{
  "conditionals": [{
    "when": { "field": "amount", "operator": "greater_than", "value": 10000 },
    "then": [{ "type": "delivery", "config": { "method": "email", "recipient": "manager@..." } }],
    "else": [{ "type": "delivery", "config": { "method": "api_call", "action": "auto_approve" } }]
  }]
}
```

**Compiled Steps:**
1. Conditional step with then_steps and else_steps

---

### 4. AgentChainRule

**Supports:**
- Sequential AI operations
- Multi-step NLP pipelines

**Pattern:**
```
Read → AI Op 1 → AI Op 2 → ... → Deliver
```

**Example IR:**
```json
{
  "ai_operations": [
    { "type": "summarize", "instruction": "Summarize email" },
    { "type": "classify", "instruction": "Classify urgency" },
    { "type": "extract", "instruction": "Extract action items" }
  ],
  "delivery": [{ "method": "slack", "channel": "#support" }]
}
```

**Compiled Steps:**
1. Action: Read emails
2. AI Processing: Summarize
3. AI Processing: Classify
4. AI Processing: Extract
5. Action: Post to Slack

---

### 5. SingleActionRule (Fallback)

**Supports:**
- Simple workflows
- Single data source → single action

**Pattern:**
```
Read → [Optional: Transform] → Single Action
```

**Example IR:**
```json
{
  "data_sources": [{ "type": "api", "endpoint": "analytics" }],
  "delivery": [{ "method": "email", "recipient": "team@..." }]
}
```

**Compiled Steps:**
1. Action: API call
2. Action: Send email

---

## Resolvers (Shared Logic)

### DataSourceResolver

```typescript
resolveDataSource(ds: DataSource): ActionStep {
  const plugin = this.findPlugin(ds.source)
  return {
    step_id: `read_${ds.id}`,
    type: 'action',
    plugin: plugin.id,
    action: 'read_data', // or specific action
    params: {
      location: ds.location,
      tab: ds.tab
    }
  }
}
```

### TransformResolver

```typescript
resolveFilter(filter: Filter): TransformStep {
  return {
    step_id: `filter_${filter.id}`,
    type: 'transform',
    operation: 'filter',
    config: {
      source: '{{previous_step.output}}',
      condition: {
        field: filter.field,
        operator: filter.operator,
        value: filter.value
      }
    }
  }
}

resolveGroup(grouping: Grouping): TransformStep {
  return {
    step_id: 'group_data',
    type: 'transform',
    operation: 'group',
    config: {
      source: '{{filtered_data}}',
      group_by: grouping.group_by
    }
  }
}
```

### AIOperationResolver

```typescript
resolveAIOperation(aiOp: AIOperation): AIProcessingStep {
  return {
    step_id: `ai_${aiOp.id}`,
    type: 'ai_processing',
    operation_type: aiOp.type,
    instruction: aiOp.instruction,
    context: aiOp.input_source,
    expected_output: aiOp.output_schema,
    model_config: {
      max_tokens: aiOp.constraints?.max_tokens || 500,
      temperature: aiOp.constraints?.temperature || 0.5
    }
  }
}
```

### ConditionalResolver

```typescript
resolveConditional(cond: Conditional): ConditionalStep {
  return {
    step_id: `cond_${cond.id}`,
    type: 'conditional',
    condition: this.buildCondition(cond.when),
    then_steps: this.compileIntents(cond.then),
    else_steps: cond.else ? this.compileIntents(cond.else) : []
  }
}
```

### LoopResolver

```typescript
resolveLoop(loop: Loop): ScatterGatherStep {
  return {
    step_id: `loop_${loop.id}`,
    type: 'scatter_gather',
    scatter: {
      input: loop.for_each,
      item_variable: loop.item_variable,
      steps: this.compileIntents(loop.do)
    },
    gather: {
      operation: 'collect',
      output_key: 'loop_results'
    }
  }
}
```

### DeliveryResolver

```typescript
resolveDelivery(delivery: Delivery): ActionStep {
  const plugin = this.findDeliveryPlugin(delivery.method)
  return {
    step_id: `deliver_${delivery.id}`,
    type: 'action',
    plugin: plugin.id,
    action: this.mapDeliveryAction(delivery.method),
    params: delivery.config
  }
}
```

## Compilation Example

**Input IR:**
```json
{
  "data_sources": [{ "type": "tabular", "location": "Leads" }],
  "filters": [{ "field": "stage", "operator": "equals", "value": 4 }],
  "grouping": { "group_by": "Sales Person" },
  "delivery": [{ "method": "email" }]
}
```

**Compilation Process:**
```
1. Check TabularGroupedDeliveryRule.supports(ir)
   → data_sources[0].type === "tabular" ✓
   → grouping !== undefined ✓
   → delivery[0].method === "email" ✓
   → MATCH!

2. TabularGroupedDeliveryRule.compile(ir)
   → DataSourceResolver.resolveDataSource() → step1 (action)
   → TransformResolver.resolveFilter() → step2 (transform)
   → TransformResolver.resolvePartition() → step3 (transform)
   → LoopResolver.resolveScatterGather() → step4 (scatter_gather)
     → DeliveryResolver.resolveDelivery() → nested action

3. Return CompilerResult {
     success: true,
     workflow: { workflow_steps: [step1, step2, step3, step4] },
     metadata: { compiler_rule: "TabularGroupedDeliveryRule" }
   }
```

**Output PILOT_DSL:**
```json
{
  "workflow_steps": [
    { "step_id": "step1", "type": "action", "plugin": "google-sheets", ... },
    { "step_id": "step2", "type": "transform", "operation": "filter", ... },
    { "step_id": "step3", "type": "transform", "operation": "partition", ... },
    { "step_id": "step4", "type": "scatter_gather", ... }
  ]
}
```

## Error Handling

### Compilation Errors

```typescript
if (!rule.supports(ir)) {
  return {
    success: false,
    errors: [
      'No compiler rule supports this workflow pattern.',
      'Supported patterns:',
      '- Tabular data with grouping and delivery',
      '- Event-triggered actions',
      '- Conditional branching',
      'Please simplify your workflow or request support for this pattern.'
    ]
  }
}
```

### Plugin Not Found

```typescript
if (!plugin) {
  return {
    success: false,
    errors: [
      `Plugin for ${ds.source} not found.`,
      `Available plugins: ${availablePlugins.join(', ')}`,
      'Please connect the required plugin or choose an alternative.'
    ]
  }
}
```

### Invalid IR

```typescript
const validation = validateIR(ir)
if (!validation.valid) {
  // Invoke IR Repair Loop
  const repairedIR = await repairIR(ir, validation.errors)
  return compile(repairedIR)
}
```

## Optimizations

The compiler applies optimizations during compilation:

1. **Merge consecutive transforms** - combine filter + filter into single step
2. **Eliminate redundant steps** - remove no-op transforms
3. **Hoist invariants** - move constant computations outside loops
4. **Parallelize independent steps** - detect parallel opportunities

Example:
```json
// Before optimization
[
  { "type": "transform", "operation": "filter", "config": { "field": "a" } },
  { "type": "transform", "operation": "filter", "config": { "field": "b" } }
]

// After optimization
[
  {
    "type": "transform",
    "operation": "filter",
    "config": {
      "condition": {
        "type": "complex_and",
        "conditions": [
          { "field": "a", ... },
          { "field": "b", ... }
        ]
      }
    }
  }
]
```

## Testing

```typescript
describe('LogicalIRCompiler', () => {
  it('compiles tabular grouped delivery pattern', () => {
    const ir = {
      data_sources: [{ type: 'tabular', location: 'Leads' }],
      filters: [{ field: 'stage', operator: 'equals', value: 4 }],
      grouping: { group_by: 'Sales Person' },
      delivery: [{ method: 'email' }]
    }
    
    const result = compiler.compile(ir)
    
    expect(result.success).toBe(true)
    expect(result.workflow.workflow_steps).toHaveLength(4)
    expect(result.workflow.workflow_steps[0].type).toBe('action')
    expect(result.workflow.workflow_steps[1].type).toBe('transform')
    expect(result.metadata.compiler_rule).toBe('TabularGroupedDeliveryRule')
  })
})
```

---

**Next:** [Natural Language UX](./06-natural-language-ux.md)
