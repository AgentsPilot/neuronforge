# CRITICAL EXECUTABILITY FINDINGS - V6 Pipeline

**Date**: 2026-03-10
**Auditor**: Claude Sonnet 4.5
**Scope**: Deep executability audit of Gmail Urgency Flagging workflow

---

## 🚨 EXECUTIVE SUMMARY

**CRITICAL DISCOVERY**: The V6 pipeline is passing validation but producing **non-executable workflows**.

### The Problem

✅ **Validation**: 100% pass rate (4/4 tests)
❌ **Executability**: 40% (workflows run but fail silently)

### Root Cause

The **ExecutionGraphCompiler is incomplete** - it validates structure but doesn't compile business logic:

1. ❌ **Deliver step mappings NOT compiled** → Actions run with missing parameters
2. ❌ **Data source filters NOT compiled** → Queries don't exclude already-processed items
3. ❌ **AI prompts lack context** → Classification doesn't use specified keywords

---

## 🔴 CRITICAL ISSUE #1: Deliver Mappings Not Compiled

### What The IntentContract Says

```json
{
  "kind": "deliver",
  "deliver": {
    "domain": "email",
    "intent": "update",
    "input": "urgent_email",
    "mapping": [
      {
        "from": { "kind": "literal", "value": true },
        "to": "important"
      }
    ]
  }
}
```

**Intent**: "Mark the email as important (set important flag to true)"

### What The Compiler Produces

```json
{
  "plugin": "google-mail",
  "operation": "modify_message",
  "config": {
    "message_id": "{{urgent_email.id}}"
    // ❌ MISSING: "mark_important": true
  }
}
```

### What Actually Happens at Runtime

```javascript
// Gmail API receives:
modifyMessage({
  messageId: "abc123",
  // No other parameters!
})

// Gmail API response:
{
  message_id: "abc123",
  // No changes made - email is NOT marked important!
}
```

### User Impact

**User sees**: "3 urgent emails were marked as important!"
**Reality**: Emails were NOT modified at all.

**This is a FALSE POSITIVE bug** - the worst kind.

---

## 🔴 CRITICAL ISSUE #2: Filters Not Compiled to Query Strings

### What The IntentContract Says

```json
{
  "kind": "data_source",
  "query": "in:inbox",
  "filters": [
    {
      "field": "label",
      "op": "ne",
      "value": { "kind": "config", "key": "tracking_label_name" }
    }
  ]
}
```

**Intent**: "Search inbox emails that DON'T have the AI-Reviewed label"

### What The Compiler Produces

```json
{
  "plugin": "google-mail",
  "operation": "search_emails",
  "config": {
    "query": "in:inbox"
    // ❌ MISSING: "-label:AI-Reviewed"
  }
}
```

### What Actually Happens at Runtime

```javascript
// Gmail API searches:
gmail.users.messages.list({
  q: "in:inbox"
  // Returns ALL inbox emails, including already-processed ones
})

// On second run:
// - Processes the SAME emails again
// - Marks them as important again (if fix #1 is applied)
// - Applies duplicate labels
// - Sends duplicate summary emails
```

### User Impact

**Every workflow run processes the same emails repeatedly** because the deduplication filter is being dropped during compilation.

---

## 🟡 MODERATE ISSUE #3: AI Classification Missing Keyword Context

### What The Enhanced Prompt Says

> "Determine whether an email is urgent by checking whether the subject OR body contains any of these keywords/phrases (case-insensitive): 'today', 'urgent', 'immediately', 'now', 'sensitive'."

### What The Compiler Produces

```json
{
  "type": "ai_processing",
  "prompt": "Classify each item into one of these categories: urgent, not_urgent. Store the classification result in the 'urgency_classification' field for each item.",
  "config": {
    "ai_type": "classify",
    "labels": ["urgent", "not_urgent"]
  }
}
```

**Prompt does NOT mention the urgency keywords!**

### What Actually Happens at Runtime

```javascript
// AI receives:
// - Email list
// - Generic prompt: "classify as urgent or not_urgent"
// - NO keyword list

// AI uses general reasoning instead of explicit keyword matching
// Results are inconsistent and may miss keyword-based urgency
```

### User Impact

**AI may classify emails incorrectly** because it doesn't know to look for specific keywords.

---

## 📊 Full Workflow Executability Breakdown

| Step | Component | Validated | Executable | Issue |
|------|-----------|-----------|------------|-------|
| 1. Search Inbox | Query | ✅ | ❌ | Missing filter compilation |
| 2. AI Classify | Prompt | ✅ | ⚠️ | Missing keyword context |
| 3. Filter Urgent | Transform | ✅ | ✅ | Working correctly |
| 4. Count Urgent | Transform | ✅ | ✅ | Working correctly |
| 5. Loop | Control Flow | ✅ | ✅ | Working correctly |
| 6. Mark Important | Action | ✅ | ❌ | Missing mark_important param |
| 7. Apply Label | Action | ✅ | ❌ | Missing add_labels param |
| 8. Generate Summary | AI | ✅ | ✅ | Working correctly |
| 9. Send Email | Action | ✅ | ✅ | Working correctly |

**Executable Steps: 4/9 (44%)**

---

## 🔍 Why Validation Passes But Execution Fails

### What Validation Checks

1. ✅ Plugin bindings exist (google-mail.modify_message)
2. ✅ Required parameters present (message_id)
3. ✅ Variable references exist (urgent_email.id)
4. ✅ Data types match (string for message_id)
5. ✅ No syntax errors

### What Validation Doesn't Check

1. ❌ Are ALL necessary parameters provided? (mark_important, add_labels)
2. ❌ Is business logic complete? (filters compiled, context injected)
3. ❌ Will the action produce the intended effect?
4. ❌ Are there silent failures?

**The validator checks STRUCTURE, not COMPLETENESS.**

---

## 🛠️ Required Fixes

### Fix #1: Compile Deliver Mappings to Action Parameters ⚠️ CRITICAL

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`
**Function**: `compileDeliverNode()`

**Current Behavior**:
- Only extracts fields via x-variable-mapping (message_id)
- Ignores deliver.mapping array

**Required Behavior**:
- Process deliver.mapping array
- Add mapped values to action config
- Map semantic names to plugin parameter names:
  - `"important"` → `"mark_important"`
  - `"add_label"` → `"add_labels"` (array)

**Implementation**:

```typescript
private compileDeliverNode(node: DeliverNode): PilotStep {
  const config: any = {};

  // Extract required params from x-variable-mapping
  const schema = this.pluginManager.getActionSchema(
    node.binding.plugin,
    node.binding.action
  );

  for (const [param, spec] of Object.entries(schema.parameters.properties)) {
    if (spec['x-variable-mapping']) {
      const fieldPath = spec['x-variable-mapping'].field_path;
      const inputVar = node.deliver.input;
      config[param] = `{{${inputVar}.${fieldPath}}}`;
    }
  }

  // ⭐ NEW: Process deliver.mapping array
  if (node.deliver.mapping && node.deliver.mapping.length > 0) {
    for (const mapping of node.deliver.mapping) {
      const targetField = mapping.to; // e.g., "important" or "add_label"
      const sourceValue = this.resolveValueRef(mapping.from);

      // Map semantic field names to plugin parameter names
      const paramName = this.mapDeliverFieldToParameter(
        targetField,
        node.binding.plugin,
        node.binding.action
      );

      // Handle array vs scalar
      if (paramName === 'add_labels') {
        config.add_labels = Array.isArray(sourceValue)
          ? sourceValue
          : [sourceValue];
      } else {
        config[paramName] = sourceValue;
      }
    }
  }

  return {
    step_id: node.id,
    type: 'action',
    plugin: node.binding.plugin,
    operation: node.binding.action,
    config,
    output_variable: node.output
  };
}

private mapDeliverFieldToParameter(
  semanticField: string,
  plugin: string,
  action: string
): string {
  // Map generic semantic names to plugin-specific parameter names
  const mappings: Record<string, string> = {
    'important': 'mark_important',
    'add_label': 'add_labels',
    'read': 'mark_read',
    // Add more as needed
  };

  return mappings[semanticField] || semanticField;
}

private resolveValueRef(valueRef: ValueRef): any {
  switch (valueRef.kind) {
    case 'literal':
      return valueRef.value;
    case 'config':
      return `{{config.${valueRef.key}}}`;
    case 'ref':
      return `{{${valueRef.ref}.${valueRef.field}}}`;
    default:
      throw new Error(`Unknown value ref kind: ${valueRef.kind}`);
  }
}
```

**Testing**:
```typescript
// Input IntentContract deliver step:
{
  deliver: {
    mapping: [
      { from: { kind: 'literal', value: true }, to: 'important' },
      { from: { kind: 'config', key: 'tracking_label_name' }, to: 'add_label' }
    ]
  }
}

// Expected PILOT DSL:
{
  config: {
    message_id: "{{urgent_email.id}}",
    mark_important: true,
    add_labels: ["{{config.tracking_label_name}}"]
  }
}
```

---

### Fix #2: Compile Data Source Filters to Provider Query Syntax ⚠️ HIGH PRIORITY

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Function**: `convertDataSourceStep()`

**Current Behavior**:
- Copies query string as-is
- Ignores filters array

**Required Behavior**:
- Process filters array
- Convert to provider-specific query syntax
- Gmail: append `-label:X` for label exclusions
- Sheets: use WHERE clauses
- HubSpot: use filter objects

**Implementation**:

```typescript
private convertDataSourceStep(step: DataSourceStep): FetchNode {
  let queryString = step.query || '';

  // ⭐ NEW: Process filters and compile to provider query syntax
  if (step.filters && step.filters.length > 0) {
    const domain = step.source.domain;

    for (const filter of step.filters) {
      const filterClause = this.compileFilterToQuerySyntax(
        filter,
        domain,
        step.uses[0]?.preferences?.provider_family
      );

      if (filterClause) {
        queryString += ` ${filterClause}`;
      }
    }
  }

  return {
    type: 'operation',
    operationType: 'fetch',
    binding: { /* ... */ },
    config: {
      query: queryString.trim(),
      /* ... */
    },
    output: step.output
  };
}

private compileFilterToQuerySyntax(
  filter: Filter,
  domain: string,
  provider?: string
): string | null {
  // Gmail-specific syntax
  if (provider === 'google' && domain === 'email') {
    if (filter.field === 'label' && filter.op === 'ne') {
      const labelValue = this.resolveFilterValue(filter.value);
      return `-label:${labelValue}`;
    }
    if (filter.field === 'from' && filter.op === 'eq') {
      const fromValue = this.resolveFilterValue(filter.value);
      return `from:${fromValue}`;
    }
  }

  // Sheets-specific syntax
  if (provider === 'google' && domain === 'table') {
    // Return WHERE clause components
    // Will be assembled by Sheet-specific query builder
  }

  // HubSpot-specific syntax
  if (provider === 'hubspot') {
    // Return filter objects
  }

  // Unknown filter type - log warning
  console.warn(`[IntentToIRConverter] Unknown filter type: ${JSON.stringify(filter)}`);
  return null;
}

private resolveFilterValue(value: ValueRef): string {
  if (value.kind === 'literal') {
    return value.value;
  } else if (value.kind === 'config') {
    return `{{config.${value.key}}}`;
  }
  return '';
}
```

**Testing**:
```typescript
// Input IntentContract:
{
  query: "in:inbox",
  filters: [
    { field: "label", op: "ne", value: { kind: "config", key: "tracking_label_name" } }
  ]
}

// Expected output:
{
  config: {
    query: "in:inbox -label:{{config.tracking_label_name}}"
  }
}
```

---

### Fix #3: Inject Context into AI Processing Prompts ⚠️ MEDIUM PRIORITY

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`
**Function**: `compileAIProcessingNode()`

**Current Behavior**:
- Uses generic classification prompt
- Doesn't reference config values with classification rules

**Required Behavior**:
- Check if config contains classification rules (e.g., urgency_keywords)
- Inject relevant config context into prompt
- Make AI classification explicit about rules to follow

**Implementation**:

```typescript
private compileAIProcessingNode(node: AINode): PilotStep {
  let prompt = node.instruction || '';

  // ⭐ NEW: Inject context from config if relevant
  if (node.config.ai_type === 'classify') {
    // Check if there's a config value that defines classification criteria
    const relevantConfig = this.findRelevantConfigForClassification(
      node.config.labels,
      this.workflowConfig
    );

    if (relevantConfig) {
      prompt = this.enhanceClassificationPrompt(
        prompt,
        node.config.labels,
        relevantConfig
      );
    }
  }

  return {
    step_id: node.id,
    type: 'ai_processing',
    input: node.inputs[0],
    prompt,
    config: node.config,
    output_variable: node.output
  };
}

private findRelevantConfigForClassification(
  labels: string[],
  config: WorkflowConfig[]
): ConfigValue | null {
  // Look for config keys that match classification criteria
  // E.g., "urgency_keywords" for ["urgent", "not_urgent"] classification

  for (const configItem of config) {
    const keyLower = configItem.key.toLowerCase();

    // Check if config key relates to classification labels
    for (const label of labels) {
      if (keyLower.includes(label.toLowerCase()) &&
          keyLower.includes('keyword')) {
        return configItem;
      }
    }
  }

  return null;
}

private enhanceClassificationPrompt(
  basePrompt: string,
  labels: string[],
  config: ConfigValue
): string {
  // Inject specific classification criteria from config
  return `${basePrompt}

Specifically, classify based on the following criteria from config.${config.key}:
{{config.${config.key}}}

Match these keywords case-insensitively against the item's subject and body text.`;
}
```

**Testing**:
```typescript
// Input:
{
  config: [
    { key: "urgency_keywords", default: ["today", "urgent", "now"] }
  ],
  ai_step: {
    config: { labels: ["urgent", "not_urgent"] }
  }
}

// Expected prompt:
"Classify each item into one of these categories: urgent, not_urgent.

Specifically, classify based on the following criteria from config.urgency_keywords:
{{config.urgency_keywords}}

Match these keywords case-insensitively against the item's subject and body text."
```

---

## 🧪 Testing Strategy

### Unit Tests (Add These)

```typescript
describe('ExecutionGraphCompiler - Deliver Mappings', () => {
  it('should compile deliver mapping to mark_important parameter', () => {
    const node: DeliverNode = {
      deliver: {
        mapping: [
          { from: { kind: 'literal', value: true }, to: 'important' }
        ]
      }
    };

    const result = compiler.compileDeliverNode(node);

    expect(result.config.mark_important).toBe(true);
  });

  it('should compile deliver mapping to add_labels array', () => {
    const node: DeliverNode = {
      deliver: {
        mapping: [
          { from: { kind: 'config', key: 'label_name' }, to: 'add_label' }
        ]
      }
    };

    const result = compiler.compileDeliverNode(node);

    expect(result.config.add_labels).toEqual(['{{config.label_name}}']);
  });
});

describe('IntentToIRConverter - Filter Compilation', () => {
  it('should compile Gmail label exclusion filter', () => {
    const step: DataSourceStep = {
      query: 'in:inbox',
      filters: [
        { field: 'label', op: 'ne', value: { kind: 'literal', value: 'AI-Reviewed' } }
      ]
    };

    const result = converter.convertDataSourceStep(step);

    expect(result.config.query).toBe('in:inbox -label:AI-Reviewed');
  });
});
```

### Integration Tests (Add These)

```typescript
describe('Gmail Urgency Flagging - E2E', () => {
  it('should actually mark emails as important', async () => {
    // Mock Gmail API
    const gmailMock = jest.fn();

    // Run workflow
    await executeWorkflow('enhanced-prompt-urgency-flagging.json');

    // Assert modify_message was called with correct params
    expect(gmailMock).toHaveBeenCalledWith({
      messageId: expect.any(String),
      mark_important: true  // ⭐ CRITICAL CHECK
    });
  });

  it('should not re-process labeled emails on second run', async () => {
    // Run workflow twice
    await executeWorkflow('enhanced-prompt-urgency-flagging.json');
    const firstRunCount = getProcessedEmailCount();

    await executeWorkflow('enhanced-prompt-urgency-flagging.json');
    const secondRunCount = getProcessedEmailCount();

    // Second run should find 0 emails (all already labeled)
    expect(secondRunCount).toBe(0);
  });
});
```

---

## 📈 Impact Assessment

### Current State (Before Fixes)

| Metric | Value | Status |
|--------|-------|--------|
| Validation Pass Rate | 100% (4/4) | ✅ Good |
| Actual Executability | 40% | ❌ Bad |
| Silent Failures | 3/9 steps | ❌ Critical |
| False Positive Reports | Yes | ❌ Dangerous |
| Production Ready | No | ❌ Blocked |

### After Fixes Applied

| Metric | Expected Value | Status |
|--------|----------------|--------|
| Validation Pass Rate | 100% (4/4) | ✅ Maintained |
| Actual Executability | 90-95% | ✅ Fixed |
| Silent Failures | 0/9 steps | ✅ Eliminated |
| False Positive Reports | No | ✅ Fixed |
| Production Ready | Yes | ✅ Unblocked |

---

## ⏱️ Estimated Fix Effort

| Fix | Complexity | Effort | Priority |
|-----|------------|--------|----------|
| #1: Deliver Mappings | Medium | 4-6 hours | 🔴 Critical |
| #2: Filter Compilation | High | 8-12 hours | 🟠 High |
| #3: AI Prompt Context | Low | 2-3 hours | 🟡 Medium |
| **Total** | | **14-21 hours** | |

**Recommended order**:
1. Fix #1 (Deliver Mappings) - Highest impact, medium complexity
2. Fix #2 (Filter Compilation) - Prevents duplicate processing
3. Fix #3 (AI Prompt Context) - Improves accuracy

---

## 🎯 Recommendation

### Immediate Actions

1. **STOP claiming 100% success rate** - Add disclaimer: "Passes validation, executability audit pending"
2. **Add integration tests** - Mock API calls and assert correct parameters
3. **Implement Fix #1 first** - Highest impact, unblocks email modification workflows
4. **Document limitations** - Be transparent about what's not yet working

### Before Production

- ✅ All 3 fixes implemented
- ✅ Integration tests passing
- ✅ Real API testing completed
- ✅ User acceptance testing done
- ✅ Documentation updated with examples

### Communication to Stakeholders

> "The V6 pipeline architecture is solid and the validation layer works correctly. However, we discovered that the compiler is not yet generating complete executable code for certain operations (deliver mappings, filters, AI context). These are well-defined compiler gaps that can be fixed deterministically. Estimated 2-3 weeks to production-ready."

---

## 📚 Lessons Learned

### What Went Right

1. ✅ Plugin binding architecture is sound
2. ✅ Variable resolution works correctly
3. ✅ Schema validation catches structural errors
4. ✅ IntentContract captures business logic well

### What Needs Improvement

1. ❌ Validation doesn't check parameter completeness
2. ❌ Compiler doesn't process all IntentContract fields
3. ❌ No integration tests with real APIs
4. ❌ "Passing validation" was mistaken for "production-ready"

### Key Insight

**Validation ≠ Executability**

A workflow can be:
- ✅ Structurally valid (all references exist, types match)
- ❌ Functionally incomplete (missing parameters, wrong logic)

We need **two validation layers**:
1. **Structural validation** (current) - Schema compliance
2. **Semantic validation** (NEW) - Business logic completeness

---

## Conclusion

The Gmail Urgency Flagging workflow **looks correct but doesn't work as intended**. This is a **compiler implementation gap**, not an architecture flaw.

**Good news**: All issues are deterministic compiler bugs with clear fixes.
**Bad news**: None of the 4 workflows are truly production-ready until these fixes are applied.

**Action Required**: Implement the 3 compiler fixes before claiming production readiness.
