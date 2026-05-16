# V6 Declarative Architecture

## Overview

V6 adopts a **pure declarative IR** approach inspired by OpenAI's architecture design, enhanced with our domain knowledge of business workflows.

## Core Philosophy

```
Enhanced Prompt → DECLARATIVE IR (WHAT) → COMPILER (HOW) → PILOT DSL (EXECUTE)
                   ↑ LLM describes intent    ↑ Deterministic     ↑ Steps with IDs
                   NO IDs, NO loops          Infers everything   Variables, plugins
```

## Key Principles

### 1. IR is Purely Declarative

**The IR expresses WHAT the user wants, NOT HOW to execute it.**

❌ **OLD (Prescriptive):**
```json
{
  "ai_operations": [{"id": "ai_extract", ...}],
  "loops": [{
    "id": "loop_pdfs",
    "for_each": "{{pdf_attachments}}",
    "do": ["ai_extract"]
  }]
}
```

✅ **NEW (Declarative):**
```json
{
  "ai_operations": [{
    "type": "extract",
    "instruction": "Extract expense data from PDF attachments",
    "context": "PDF attachments"
  }],
  "delivery_rules": {
    "summary_delivery": {
      "recipient": "finance@company.com"
    }
  }
}
```

**The compiler infers:**
- Need to extract PDFs from emails
- Need to loop over PDFs
- Need to run AI operation per PDF
- Need to aggregate results
- Need to send one summary email

### 2. Loops are Inferred from Delivery Patterns

**The IR does NOT have a `loops` field. The compiler infers loops from `delivery_rules`.**

**Pattern 1: Per-Item Delivery**
```json
{
  "delivery_rules": {
    "per_item_delivery": {
      "recipient_source": "email"
    }
  }
}
```
**Compiler generates:** Loop over each item, send email per item

**Pattern 2: Per-Group Delivery**
```json
{
  "delivery_rules": {
    "per_group_delivery": {
      "recipient_source": "Sales Person"
    }
  },
  "grouping": {
    "group_by": "Sales Person",
    "emit_per_group": true
  }
}
```
**Compiler generates:**
1. Partition by Sales Person
2. Group by Sales Person
3. Loop over groups
4. Send email per group

**Pattern 3: Summary Delivery**
```json
{
  "delivery_rules": {
    "summary_delivery": {
      "recipient": "manager@company.com"
    }
  }
}
```
**Compiler generates:** No loop, single delivery at the end

### 3. Compiler is Intelligent

The compiler handles:

#### Auto-ID Generation
- Filters: `filter_1`, `filter_2`, `filter_stage`
- Transforms: `transform_extract_pdfs`
- AI operations: `ai_extract_expense`
- Loops: `loop_pdfs`, `loop_groups`

#### Variable Flow Management
- Generates variable names: `filtered_data`, `pdf_attachments`, `expense_items`
- Tracks dependencies between steps
- Validates variable continuity

#### Auto-Repair & Injection
- Detects when AI operation needs PDFs → Injects PDF extraction transform
- Detects when loop needs array → Injects flatten/extract transform
- Optimizes filter sequences

#### Plugin Binding
- Maps `source: "google_sheets"` → `plugin: "google-sheets"`
- Maps `source: "gmail"` → `plugin: "google-mail"`
- Determines correct operations (read_range, list_messages, etc.)

### 4. Validation is Simpler

**Forbidden Token List:**
```typescript
const FORBIDDEN = [
  'plugin', 'google-sheets', 'google-mail',
  'step_id', 'id',
  'action', 'execute',
  'loop', 'for_each', 'do',
  'scatter_gather', 'fanout'
]
```

**Validation:**
```typescript
const raw = JSON.stringify(ir).toLowerCase()
const leaked = FORBIDDEN.find(token => raw.includes(token))
if (leaked) {
  return { error: `Forbidden token: "${leaked}"` }
}
```

**If IR contains forbidden tokens → Reject immediately**

## Architecture Comparison

### V4 (LLM generates steps)
```
Prompt → LLM → Executable Steps → Execute
         ↑ Hallucinates, guesses
```

### V6 OLD (Prescriptive IR)
```
Prompt → LLM → IR with IDs → Compiler → Steps
         ↑ Still prescriptive    ↑ Dumb mapper
```

### V6 NEW (Declarative IR)
```
Prompt → LLM → Declarative IR → Compiler → Steps
         ↑ Just intent      ↑ Smart inference
```

## Benefits

### 1. Trustability
- ✅ LLM only describes business intent
- ✅ Compiler is deterministic (same IR → same steps)
- ✅ No hallucination of execution details

### 2. Debuggability
- ✅ If workflow fails → Check compiler, not LLM output
- ✅ Compiler errors are specific and fixable
- ✅ Can have IR repair agent

### 3. Maintainability
- ✅ Change compiler rules → All workflows benefit
- ✅ Add new plugin → Update compiler, IR stays same
- ✅ IR is human-readable business intent

### 4. Validation
- ✅ Simple forbidden token check
- ✅ JSON schema validation
- ✅ Easy to verify correctness

## Implementation Plan

### Phase 1: Core Infrastructure ✅
- [x] Create declarative IR schema
- [x] Create strict system prompt
- [x] Document architecture

### Phase 2: Smart Compiler
- [ ] Update LogicalIRCompiler to accept declarative IR
- [ ] Implement loop inference from delivery_rules
- [ ] Implement auto-ID generation
- [ ] Implement variable flow management
- [ ] Implement auto-repair/injection

### Phase 3: Validation
- [ ] Add forbidden token checker
- [ ] Add JSON schema validator
- [ ] Create IR repair agent (for compiler errors)

### Phase 4: Testing
- [ ] Test leads workflow (per-group delivery)
- [ ] Test expense workflow (AI + summary delivery)
- [ ] Test edge cases

## Example Workflows

### Leads Workflow (Per-Group Delivery)

**Enhanced Prompt:**
```
Read leads from Google Sheet "MyLeads" tab "Leads"
Filter to stage = 4
Group by Sales Person
Send one email per salesperson with table of their leads
CC manager on all emails
```

**Declarative IR:**
```json
{
  "ir_version": "3.0",
  "goal": "Send stage 4 leads to each salesperson",

  "data_sources": [{
    "type": "tabular",
    "source": "google_sheets",
    "location": "MyLeads",
    "tab": "Leads"
  }],

  "filters": [{
    "field": "stage",
    "operator": "equals",
    "value": 4
  }],

  "grouping": {
    "group_by": "Sales Person",
    "emit_per_group": true
  },

  "rendering": {
    "type": "email_embedded_table",
    "columns_in_order": ["Date", "Lead Name", "Email"]
  },

  "delivery_rules": {
    "per_group_delivery": {
      "recipient_source": "Sales Person",
      "cc": ["manager@company.com"]
    }
  }
}
```

**Compiler generates:**
1. Read from google-sheets → `read_sheet_data`
2. Map headers → `normalize_headers`
3. Filter stage=4 → `filter_stage`
4. Partition by Sales Person → `partition_salesperson`
5. Group by Sales Person → `group_by_salesperson`
6. Scatter-gather over groups → `loop_groups`
   - Render table per group → `render_table`
   - Send email per group → `send_email`

### Expense Workflow (AI + Summary)

**Enhanced Prompt:**
```
Fetch Gmail emails with subject "expense" or "receipt"
Extract expense data from PDF attachments
Send summary table to finance@company.com
```

**Declarative IR:**
```json
{
  "ir_version": "3.0",
  "goal": "Extract expense data from email PDFs",

  "data_sources": [{
    "type": "api",
    "source": "gmail",
    "location": "emails"
  }],

  "filters": [
    {"field": "subject", "operator": "contains", "value": "expense"},
    {"field": "subject", "operator": "contains", "value": "receipt"}
  ],

  "ai_operations": [{
    "type": "extract",
    "instruction": "Extract vendor, amount, date from PDF receipts",
    "context": "PDF attachments",
    "output_schema": {
      "type": "object",
      "fields": [
        {"name": "vendor", "type": "string", "required": true},
        {"name": "amount", "type": "string", "required": true},
        {"name": "date", "type": "string", "required": true}
      ]
    }
  }],

  "rendering": {
    "type": "email_embedded_table",
    "columns_in_order": ["date", "vendor", "amount"]
  },

  "delivery_rules": {
    "summary_delivery": {
      "recipient": "finance@company.com"
    }
  }
}
```

**Compiler generates:**
1. List Gmail messages → `fetch_emails`
2. Filter subject contains "expense" → `filter_1`
3. Filter subject contains "receipt" → `filter_2`
4. **Auto-inject:** Extract PDF attachments → `extract_pdfs`
5. Scatter-gather over PDFs → `loop_pdfs`
   - AI extract expense data → `ai_extract_expense`
6. Aggregate results → `aggregate_expenses`
7. Render table → `render_summary_table`
8. Send email → `send_summary_email`

**Note:** The compiler INFERRED:
- Need to extract PDFs (not in IR)
- Need to loop over PDFs (no `loops` in IR)
- Need to aggregate before rendering (implied by summary delivery)

## Success Criteria

A workflow is correctly implemented when:

1. ✅ **IR is declarative** - No IDs, no loops, no execution tokens
2. ✅ **IR passes validation** - No forbidden tokens
3. ✅ **Compiler generates correct steps** - All operations compiled
4. ✅ **Steps are executable** - Valid PILOT DSL
5. ✅ **Validation passes** - All 4 invariants satisfied

## Migration from V6 OLD

### For Existing IR:
1. Remove all `id` fields
2. Remove `loops` section
3. Update `delivery` section to `delivery_rules`
4. Remove operation ID references

### For System Prompt:
1. Replace with declarative system prompt
2. Add forbidden token warnings
3. Update examples to show declarative style

### For Compiler:
1. Add loop inference logic
2. Add auto-ID generation
3. Add variable flow management
4. Keep existing compiler rules (they still work!)

## Resources

- **Schema:** `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema.ts`
- **System Prompt:** `lib/agentkit/v6/generation/prompts/declarative-ir-system.md`
- **This Document:** `docs/V6_DECLARATIVE_ARCHITECTURE.md`

## Next Steps

1. Implement smart compiler with loop inference
2. Add validation with forbidden tokens
3. Test with both workflows
4. Create IR repair agent for error recovery
5. Update API endpoints to use declarative IR
