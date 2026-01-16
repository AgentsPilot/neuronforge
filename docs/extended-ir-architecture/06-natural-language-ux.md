# Natural Language UX Layer

## Overview

The Natural Language UX layer transforms technical Logical IR into user-friendly plain English plans.

**Key Principle:** Non-technical users never see JSON/IR - only understandable explanations.

## Component: IRToNaturalLanguageTranslator

```typescript
class IRToNaturalLanguageTranslator {
  translate(ir: ExtendedLogicalIR): NaturalLanguagePlan {
    const steps: PlanStep[] = []
    
    // Data sources → "📊 Read data from X"
    if (ir.data_sources) {
      steps.push(this.translateDataSources(ir.data_sources))
    }
    
    // Filters → "🔍 Filter to rows where Y"
    if (ir.filters) {
      steps.push(this.translateFilters(ir.filters))
    }
    
    // AI operations → "🤖 [instruction]"
    if (ir.ai_operations) {
      steps.push(...this.translateAIOperations(ir.ai_operations))
    }
    
    // Transforms → "📐 Group by X" / "📊 Sort by Y"
    if (ir.transforms) {
      steps.push(...this.translateTransforms(ir.transforms))
    }
    
    // Grouping → "👥 Group by X"
    if (ir.grouping) {
      steps.push(this.translateGrouping(ir.grouping))
    }
    
    // Delivery → "📧 Send via email"
    if (ir.delivery) {
      steps.push(...this.translateDelivery(ir.delivery))
    }
    
    return {
      goal: ir.goal,
      steps,
      edgeCases: this.translateEdgeCases(ir.edge_cases),
      estimation: this.estimateScope(ir)
    }
  }
}
```

## Translation Rules

### Data Sources
```typescript
translateDataSources(sources: DataSource[]): PlanStep {
  const ds = sources[0]
  return {
    icon: '📊',
    title: 'Read data',
    details: [
      `From ${this.formatSource(ds)}`,
      ds.tab ? `Tab: "${ds.tab}"` : '',
      `Check for required columns: ${this.getRequiredHeaders()}`
    ].filter(Boolean)
  }
}

formatSource(ds: DataSource): string {
  switch (ds.type) {
    case 'tabular': return `Google Sheet: "${ds.location}"`
    case 'api': return `API: ${ds.endpoint}`
    case 'webhook': return `Webhook trigger: ${ds.trigger}`
    case 'database': return `Database: ${ds.location}`
    default: return ds.location
  }
}
```

### Filters
```typescript
translateFilters(filters: Filter[]): PlanStep {
  return {
    icon: '🔍',
    title: 'Filter data',
    details: filters.map(f => 
      `Keep only rows where ${f.field} ${this.operatorToEnglish(f.operator)} ${f.value}`
    )
  }
}

operatorToEnglish(op: FilterOperator): string {
  const map = {
    equals: '=',
    not_equals: '≠',
    greater_than: '>',
    less_than: '<',
    contains: 'contains',
    is_empty: 'is empty',
    in: 'is one of'
  }
  return map[op] || op
}
```

### AI Operations
```typescript
translateAIOperations(ops: AIOperation[]): PlanStep[] {
  return ops.map(op => ({
    icon: '🤖',
    title: this.aiTypeToTitle(op.type),
    details: [
      op.instruction,
      `Processing: ${op.input_source}`,
      `Output: ${this.formatOutputSchema(op.output_schema)}`
    ]
  }))
}

aiTypeToTitle(type: AIOperationType): string {
  const map = {
    summarize: 'Summarize content',
    classify: 'Classify items',
    extract: 'Extract data',
    sentiment: 'Analyze sentiment',
    generate: 'Generate text'
  }
  return map[type] || type
}
```

### Grouping/Partitions
```typescript
translateGrouping(grouping: Grouping): PlanStep {
  return {
    icon: '👥',
    title: `Group by ${grouping.group_by}`,
    details: [
      'Create one group per unique value',
      grouping.emit_per_group ? 'Process each group separately' : 'Combine all groups'
    ]
  }
}
```

### Delivery
```typescript
translateDelivery(delivery: Delivery[]): PlanStep[] {
  return delivery.map(d => ({
    icon: this.getDeliveryIcon(d.method),
    title: `Send via ${d.method}`,
    details: this.formatDeliveryDetails(d)
  }))
}

getDeliveryIcon(method: DeliveryMethod): string {
  const icons = {
    email: '📧',
    slack: '💬',
    webhook: '🔗',
    database: '💾',
    api_call: '🔌'
  }
  return icons[method] || '📤'
}

formatDeliveryDetails(d: Delivery): string[] {
  switch (d.method) {
    case 'email':
      return [
        `To: ${d.config.recipient || d.config.recipient_source}`,
        d.config.cc ? `CC: ${d.config.cc.join(', ')}` : '',
        d.config.subject ? `Subject: "${d.config.subject}"` : ''
      ].filter(Boolean)
    
    case 'slack':
      return [`Channel: ${d.config.channel}`]
    
    case 'webhook':
      return [`URL: ${d.config.url}`, `Method: ${d.config.method || 'POST'}`]
    
    default:
      return []
  }
}
```

### Edge Cases
```typescript
translateEdgeCases(cases: EdgeCase[]): string[] {
  return cases.map(ec => {
    switch (ec.condition) {
      case 'no_rows_after_filter':
        return `If zero results → ${ec.message}`
      case 'missing_required_field':
        return `If missing data → ${ec.action}`
      default:
        return `${ec.condition} → ${ec.action}`
    }
  })
}
```

### Estimation
```typescript
estimateScope(ir: ExtendedLogicalIR): EstimationResult {
  const hasGrouping = !!ir.grouping
  const hasAI = !!ir.ai_operations?.length
  const hasLoops = !!ir.loops?.length
  
  // Rough estimates
  const estimatedGroups = hasGrouping ? 5 : 1
  const estimatedIterations = hasLoops ? 10 : 1
  const estimatedAICalls = hasAI ? ir.ai_operations.length * estimatedIterations : 0
  
  const executionTime = this.estimateTime(estimatedAICalls, hasLoops)
  const cost = this.estimateCost(estimatedAICalls, estimatedIterations)
  
  return {
    emails: hasGrouping ? `~${estimatedGroups}-${estimatedGroups * 2} emails` : '1 email',
    time: executionTime,
    cost: `~$${cost.toFixed(2)}`
  }
}

estimateTime(aiCalls: number, hasLoops: boolean): string {
  const baseTime = 10 // seconds
  const aiTime = aiCalls * 3 // 3 sec per AI call
  const loopOverhead = hasLoops ? 10 : 0
  
  const total = baseTime + aiTime + loopOverhead
  
  if (total < 60) return `~${total} seconds`
  return `~${Math.ceil(total / 60)} minutes`
}

estimateCost(aiCalls: number, iterations: number): number {
  const pluginCost = 0.005 // per action
  const aiCost = 0.02 // per AI call
  const baseCost = 0.01
  
  return baseCost + (aiCalls * aiCost) + (iterations * pluginCost)
}
```

## Component: NaturalLanguageCorrectionHandler

```typescript
class NaturalLanguageCorrectionHandler {
  async handleCorrection(
    originalIR: ExtendedLogicalIR,
    correction: string
  ): Promise<ExtendedLogicalIR> {
    // 1. Use LLM to extract correction intent
    const correctionIntent = await this.extractCorrectionIntent(
      originalIR,
      correction
    )
    
    // 2. Apply correction to IR
    const updatedIR = this.applyCorrection(originalIR, correctionIntent)
    
    // 3. Validate updated IR
    const validation = validateIR(updatedIR)
    if (!validation.valid) {
      throw new Error('Correction resulted in invalid IR')
    }
    
    return updatedIR
  }
  
  private async extractCorrectionIntent(
    ir: ExtendedLogicalIR,
    correction: string
  ): Promise<CorrectionIntent> {
    const prompt = `
Original IR goal: ${ir.goal}

Current filters: ${JSON.stringify(ir.filters)}
Current grouping: ${JSON.stringify(ir.grouping)}
Current delivery: ${JSON.stringify(ir.delivery)}

User correction: "${correction}"

Extract what the user wants to change as a structured correction:
{
  "field_to_update": "filters" | "grouping" | "delivery" | "ai_operations",
  "change_type": "replace" | "add" | "remove",
  "new_value": { ... }
}
`
    
    return await this.llm.generateStructured({
      prompt,
      schema: CORRECTION_INTENT_SCHEMA
    })
  }
  
  private applyCorrection(
    ir: ExtendedLogicalIR,
    intent: CorrectionIntent
  ): ExtendedLogicalIR {
    const updated = { ...ir }
    
    switch (intent.field_to_update) {
      case 'filters':
        updated.filters = this.applyFilterCorrection(ir.filters, intent)
        break
      case 'grouping':
        updated.grouping = intent.new_value
        break
      case 'delivery':
        updated.delivery = this.applyDeliveryCorrection(ir.delivery, intent)
        break
      // ... other fields
    }
    
    return updated
  }
}
```

## Example Translations

### Example 1: Simple Tabular Workflow

**IR:**
```json
{
  "goal": "Send stage 4 leads to sales people",
  "data_sources": [{ "type": "tabular", "location": "Leads" }],
  "filters": [{ "field": "stage", "operator": "equals", "value": 4 }],
  "grouping": { "group_by": "Sales Person" },
  "delivery": [{ "method": "email", "recipient_source": "group_key" }]
}
```

**Natural Language Plan:**
```
Your Workflow Plan

Here's what I'll do:

📊 1. Read data
   • From Google Sheet: "Leads"
   • Check for required columns: stage, Sales Person

🔍 2. Filter data
   • Keep only rows where stage = 4

👥 3. Group by Sales Person
   • Create one group per unique value
   • Process each group separately

📧 4. Send via email
   • One email per group
   • To: Sales Person from each group

⏱️ Estimated: ~5-10 emails, ~30 seconds, ~$0.02
```

### Example 2: AI Processing Workflow

**IR:**
```json
{
  "goal": "Analyze customer feedback and route to teams",
  "data_sources": [{ "type": "api", "endpoint": "feedback_api" }],
  "ai_operations": [
    { "type": "sentiment", "instruction": "Analyze sentiment of each feedback" },
    { "type": "classify", "instruction": "Classify into product/support/billing" }
  ],
  "conditionals": [{
    "when": { "field": "sentiment", "operator": "equals", "value": "negative" },
    "then": [{ "type": "delivery", "config": { "method": "slack", "channel": "#urgent" } }]
  }]
}
```

**Natural Language Plan:**
```
Your Workflow Plan

Here's what I'll do:

📊 1. Read data
   • From API: feedback_api

🤖 2. Analyze sentiment
   • Analyze sentiment of each feedback
   • Processing: feedback items
   • Output: sentiment score (positive/negative/neutral)

🤖 3. Classify items
   • Classify into product/support/billing
   • Processing: feedback with sentiment
   • Output: category

🔀 4. Route based on sentiment
   • If sentiment = negative → Send to #urgent Slack channel
   • Otherwise → Continue to next step

⏱️ Estimated: ~20 items, ~2 minutes, ~$0.40
```

### Example 3: Correction Flow

**Original Plan:**
```
🔍 Filter data
   • Keep only rows where stage = 4
```

**User Correction:** "Actually filter stage 5 instead"

**System Actions:**
1. Extract intent: Change filter value from 4 to 5
2. Update IR: `filters[0].value = 5`
3. Re-translate to English

**Updated Plan:**
```
🔍 Filter data
   • Keep only rows where stage = 5  ← Changed
```

---

**Next:** [UI Integration](./07-ui-integration.md)
