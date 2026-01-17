# V6 Architecture Gap Analysis - Root Cause

## The Fundamental Problem

**Current Architecture:**
```
User Request → Enhanced Prompt → [LLM in isolation] → Declarative IR → [Dumb Compiler] → DSL
                                      ↑
                                      |
                                Only sees schema
                                No plugin knowledge
                                No data flow understanding
```

**Why Chat LLMs Work:**
```
User Request → [LLM with full knowledge] → Perfect Steps
                    ↑
                    |
                Full context:
                - Plugin capabilities
                - Data structures
                - Common patterns
                - Can ask questions
```

## The Critical Gaps

### Gap 1: LLM Lacks Plugin Knowledge

**Problem:**
The LLM generating declarative IR doesn't know:
- Gmail supports advanced search syntax: `(subject:A OR subject:B)`
- Gmail attachments are in `message.attachments[]` array
- Email objects have: `{id, subject, from, to, date, attachments: [{id, filename, mimeType, data}]}`
- PDF mimeType is `application/pdf`

**Evidence from Current IR:**
```json
{
  "filters": [
    {"field": "subject", "operator": "contains", "value": "expenses"},
    {"field": "subject", "operator": "contains", "value": "receipt"}
  ]
}
```

The LLM doesn't know:
- Should these be OR or AND?
- Can Gmail handle this in the query?
- What's the email object structure?

**Why Chat LLMs Work:**
- They've seen Gmail API docs in training
- They know common patterns
- They can infer from context

**Our LLM Only Sees:**
```typescript
"filters": {
  type: 'array',
  items: {
    properties: {
      field: { type: 'string' },
      operator: { enum: ['contains', ...] }
    }
  }
}
```

No information about:
- What fields exist
- What the data structure is
- How filters should combine

### Gap 2: Schema Doesn't Capture Data Flow

**Problem:**
The schema has:
- `data_sources` - WHERE data comes from
- `filters` - WHAT to filter
- `ai_operations` - WHAT AI does

But it's missing:
- HOW to get from emails to attachments to PDFs
- WHAT the intermediate data shapes are
- WHEN transformations happen

**Example:**
```json
{
  "data_sources": [{"type": "api", "source": "gmail"}],
  "ai_operations": [{
    "context": "PDF attachments from filtered emails"  // ← Vague!
  }]
}
```

**What's Missing:**
```json
{
  "data_flow": [
    {
      "from": "emails",           // Email[]
      "extract": "attachments",   // → Attachment[][]
      "flatten": true,            // → Attachment[]
      "filter": {"field": "mimeType", "equals": "application/pdf"},
      "output": "pdf_attachments" // → PDF[]
    }
  ]
}
```

### Gap 3: No Plugin-Specific Intelligence

**Problem:**
Each plugin has unique capabilities:
- **Gmail**: Advanced search, has:attachment, newer_than, OR syntax
- **Google Sheets**: A1 notation, named ranges, formulas
- **Slack**: Channel mentions, thread replies
- **Airtable**: Views, linked records

The LLM doesn't know these exist.

**Evidence:**
Generated IR uses generic filters instead of Gmail search:
```json
// Current (wrong)
{
  "filters": [
    {"field": "subject", "contains": "expenses"},
    {"field": "subject", "contains": "receipt"},
    {"field": "date", "within_last_days": 7}
  ]
}

// Should be (Gmail-specific)
{
  "data_sources": [{
    "source": "gmail",
    "query": "has:attachment (subject:expenses OR subject:receipt) newer_than:7d"
  }]
}
```

### Gap 4: Compiler Can't Reliably Infer Intent

**Problem:**
The compiler sees:
```json
{
  "filters": [
    {"field": "subject", "contains": "expenses"},
    {"field": "subject", "contains": "receipt"}
  ]
}
```

**Possible Interpretations:**
1. `subject contains "expenses" AND subject contains "receipt"` (current behavior)
2. `subject contains "expenses" OR subject contains "receipt"` (correct)
3. `subject contains "expenses receipt"` (literal)
4. `subject matches regex /expenses|receipt/` (alternative)

**Without explicit intent, the compiler guesses wrong.**

### Gap 5: No Clarification Mechanism

**Problem:**
When chat LLMs are unsure, they ask:
- "Should I filter emails with 'expenses' OR 'receipt' in the subject?"
- "Do you want one email per PDF or one summary email?"

Our system has:
```json
"clarifications_required": []  // Always empty in practice
```

The LLM can't ask questions because:
- It's a single-shot generation
- No feedback loop
- No user interaction

## Comparison: Chat vs. Our System

### Chat LLM Process (Works)

```
User: "Extract expenses from Gmail PDFs"

LLM Reasoning:
1. Gmail API → knows structure: {subject, attachments: [{mimeType, data}]}
2. "expenses OR receipt" → understands OR logic
3. PDFs → knows mimeType = "application/pdf"
4. Extract → knows needs OCR/AI
5. Multiple PDFs → infers scatter-gather loop

Output:
1. Fetch emails (Gmail query: has:attachment (subject:expenses OR subject:receipt))
2. Extract attachments
3. Filter to PDFs
4. Loop each PDF:
   - AI extract
5. Combine results
6. Send email
```

### Our System Process (Fails)

```
User: "Extract expenses from Gmail PDFs"
↓
Enhanced Prompt (text sections)
↓
LLM sees:
- Schema (abstract)
- No Gmail structure
- No plugin capabilities
- No data flow hints
↓
Generates ambiguous IR:
{
  "filters": [array of filters],  // Ambiguous combination
  "ai_operations": [{
    "context": "PDF attachments"  // Vague
  }]
}
↓
Compiler guesses:
- AND filter logic (wrong)
- Single-level data structure (wrong)
- Generic transforms (inefficient)
↓
Wrong DSL
```

## The Architecture We Need

### Option A: Rich Context to LLM (Recommended)

```
Enhanced Prompt
    ↓
    +-------------------+
    | LLM Generation    |
    | WITH:             |
    | - Plugin schemas  |← Gmail: {search_query, attachment_structure}
    | - Data shapes     |← Email[], Attachment[], PDF[]
    | - Pattern library |← "Extract from nested array" pattern
    | - Example IR      |← Similar workflows
    +-------------------+
    ↓
Declarative IR (explicit)
{
  "data_sources": [{
    "source": "gmail",
    "query": "has:attachment (subject:expenses OR subject:receipt) newer_than:7d"
  }],
  "data_transformations": [
    {"extract": "attachments", "flatten": true},
    {"filter": "mimeType = application/pdf"}
  ],
  "ai_operations": [{
    "input": "pdf_attachments",
    "process_each": true
  }]
}
    ↓
Smart Compiler (validates + expands)
    ↓
DSL (correct)
```

### Option B: Two-Phase Generation (Alternative)

```
Phase 1: Plan Generation
Enhanced Prompt → LLM → Execution Plan
{
  "steps": [
    "Fetch emails with Gmail query",
    "Extract attachments",
    "Filter to PDFs",
    "Process each PDF with AI",
    "Combine and send"
  ],
  "clarifications": ["Should filters be OR or AND?"]
}
    ↓
User Reviews/Answers
    ↓
Phase 2: IR Generation
Plan + Answers → LLM → Declarative IR
    ↓
Compiler → DSL
```

### Option C: Executable IR (Radical)

```
Skip Declarative IR entirely.

Enhanced Prompt → LLM → DSL directly
(with plugin schemas and DSL schema)

Pros:
- LLM can use full knowledge
- No ambiguous intermediate step
- Matches chat LLM behavior

Cons:
- Violates "LLM describes WHAT not HOW"
- May hallucinate step IDs
- Less declarative purity
```

## Detailed Solution: Option A (Rich Context)

### 1. Plugin Schema Registry

Create `/lib/plugins/schemas/gmail-schema.ts`:
```typescript
export const GMAIL_PLUGIN_SCHEMA = {
  name: "gmail",
  data_structures: {
    Email: {
      fields: {
        id: "string",
        subject: "string",
        from: "string",
        to: "string[]",
        date: "Date",
        body: "string",
        attachments: "Attachment[]"
      }
    },
    Attachment: {
      fields: {
        id: "string",
        filename: "string",
        mimeType: "string",
        size: "number",
        data: "Buffer"
      }
    }
  },
  capabilities: {
    search: {
      supports_advanced_query: true,
      query_operators: {
        has_attachment: "has:attachment",
        subject: "subject:term",
        or: "(A OR B)",
        date_newer: "newer_than:Nd"
      },
      examples: [
        "has:attachment (subject:expenses OR subject:receipt) newer_than:7d"
      ]
    },
    fetch: {
      returns: "Email[]",
      includes_attachments: true
    }
  },
  common_patterns: [
    {
      name: "extract_attachments",
      description: "Get all attachments from emails",
      transform: {
        operation: "map",
        extract: "attachments",
        flatten: true
      }
    },
    {
      name: "filter_pdf_attachments",
      description: "Filter attachments to PDFs only",
      filter: {
        field: "mimeType",
        operator: "equals",
        value: "application/pdf"
      }
    }
  ]
}
```

### 2. Enhanced System Prompt

Update `declarative-ir-system.md`:
```markdown
# Available Plugins

## Gmail Plugin

**Data Structure:**
- Email: {id, subject, from, to, date, body, attachments: Attachment[]}
- Attachment: {id, filename, mimeType, size, data}

**Capabilities:**
- Advanced search queries: `has:attachment (subject:A OR subject:B) newer_than:7d`
- Returns emails with attachments included
- Supports OR logic in search

**Common Patterns:**
- Extract all attachments: Use data_transformations with extract="attachments", flatten=true
- Filter to PDFs: Filter attachments by mimeType="application/pdf"

**Example:**
```json
{
  "data_sources": [{
    "source": "gmail",
    "query": "has:attachment (subject:expenses OR subject:receipt) newer_than:7d"
  }],
  "data_transformations": [
    {
      "operation": "extract",
      "field": "attachments",
      "flatten": true,
      "output_name": "all_attachments"
    },
    {
      "operation": "filter",
      "input": "all_attachments",
      "field": "mimeType",
      "operator": "equals",
      "value": "application/pdf",
      "output_name": "pdf_attachments"
    }
  ]
}
```

### 3. Enhanced Schema with Data Transformations

```typescript
export const DECLARATIVE_IR_SCHEMA_V3_1 = {
  // ... existing fields ...

  data_transformations: {
    type: 'array',
    description: 'Explicit data transformations to apply before AI operations',
    items: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: {
          type: 'string',
          enum: ['extract', 'flatten', 'filter', 'map_fields', 'merge'],
          description: 'Type of transformation'
        },
        input: {
          type: 'string',
          description: 'Input data name (from previous step or data source)'
        },
        field: {
          type: 'string',
          description: 'Field to extract/transform'
        },
        flatten: {
          type: 'boolean',
          description: 'Whether to flatten nested arrays'
        },
        filter_condition: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            operator: { type: 'string' },
            value: { oneOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' }
            ]}
          }
        },
        output_name: {
          type: 'string',
          description: 'Name for the transformed data (for use in later steps)'
        }
      }
    }
  },

  ai_operations: {
    // ... existing ...
    items: {
      properties: {
        // ... existing fields ...
        input_source: {
          type: 'string',
          description: 'Which data to process (e.g., "pdf_attachments", "filtered_emails")'
        },
        process_each: {
          type: 'boolean',
          description: 'Whether to process each item individually (triggers scatter-gather)'
        }
      }
    }
  },

  filters: {
    type: 'object',  // ← Changed from array
    properties: {
      combineWith: {
        type: 'string',
        enum: ['AND', 'OR'],
        description: 'How to combine multiple filter conditions'
      },
      conditions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['field', 'operator'],
          properties: {
            field: { type: 'string' },
            operator: { type: 'string', enum: [...] },
            value: { oneOf: [...] }
          }
        }
      }
    }
  }
}
```

### 4. Inject Plugin Context into LLM

Update `EnhancedPromptToDeclarativeIRGenerator.ts`:
```typescript
private buildUserMessage(enhancedPrompt: EnhancedPrompt): string {
  // ... existing prompt building ...

  // Detect which plugins are needed
  const plugins = this.detectPlugins(enhancedPrompt);

  message += '\n\n# Available Plugins for This Workflow\n\n';

  plugins.forEach(pluginName => {
    const schema = PLUGIN_SCHEMAS[pluginName];
    if (schema) {
      message += `## ${schema.name}\n\n`;
      message += `**Data Structures:**\n`;
      message += JSON.stringify(schema.data_structures, null, 2);
      message += `\n\n**Capabilities:**\n`;
      message += JSON.stringify(schema.capabilities, null, 2);
      message += `\n\n**Common Patterns:**\n`;
      schema.common_patterns.forEach(pattern => {
        message += `- **${pattern.name}**: ${pattern.description}\n`;
      });
      message += '\n';
    }
  });

  return message;
}
```

## Expected Outcome with Fixed Architecture

### Input: Enhanced Prompt
```json
{
  "sections": {
    "data": ["Gmail emails with expenses or receipt in subject"],
    "actions": ["Extract expense data from PDF attachments"],
    "delivery": ["Send summary to offir.omer@gmail.com"]
  }
}
```

### Generated IR (with plugin context)
```json
{
  "ir_version": "3.0",
  "goal": "Extract expense data from Gmail PDFs",

  "data_sources": [{
    "type": "api",
    "source": "gmail",
    "query": "has:attachment (subject:expenses OR subject:receipt) newer_than:7d",
    "role": "Expense emails with PDF receipts"
  }],

  "data_transformations": [
    {
      "operation": "extract",
      "field": "attachments",
      "flatten": true,
      "output_name": "all_attachments",
      "description": "Extract all attachments from filtered emails"
    },
    {
      "operation": "filter",
      "input": "all_attachments",
      "filter_condition": {
        "field": "mimeType",
        "operator": "equals",
        "value": "application/pdf"
      },
      "output_name": "pdf_attachments",
      "description": "Keep only PDF attachments"
    }
  ],

  "ai_operations": [{
    "type": "extract",
    "instruction": "Extract expense line items...",
    "input_source": "pdf_attachments",
    "process_each": true,
    "output_schema": {...}
  }],

  "rendering": {...},
  "delivery_rules": {...}
}
```

### Compiled DSL
```json
[
  {
    "step_id": "fetch_emails_1",
    "type": "action",
    "plugin": "gmail",
    "operation": "search",
    "config": {
      "query": "has:attachment (subject:expenses OR subject:receipt) newer_than:7d"
    },
    "output_variable": "emails"
  },
  {
    "step_id": "extract_attachments_1",
    "type": "transform",
    "operation": "map",
    "input": "{{emails}}",
    "config": {
      "extract": "attachments",
      "flatten": true
    },
    "output_variable": "all_attachments"
  },
  {
    "step_id": "filter_pdfs_1",
    "type": "transform",
    "operation": "filter",
    "input": "{{all_attachments}}",
    "config": {
      "field": "mimeType",
      "operator": "equals",
      "value": "application/pdf"
    },
    "output_variable": "pdf_attachments"
  },
  {
    "step_id": "scatter_pdfs_1",
    "type": "scatter_gather",
    "scatter": {
      "input": "{{pdf_attachments}}",
      "itemVariable": "pdf",
      "actions": [
        {
          "step_id": "ai_extract_1",
          "type": "ai_processing",
          "config": {...}
        }
      ]
    },
    "gather": {"operation": "collect"},
    "output_variable": "extracted_expenses"
  },
  {
    "step_id": "render_table_1",
    "type": "transform",
    "operation": "map",
    "config": {"type": "email_embedded_table"},
    "output_variable": "rendered_table"
  },
  {
    "step_id": "send_email_1",
    "type": "action",
    "plugin": "gmail",
    "operation": "send_email",
    "config": {
      "to": "offir.omer@gmail.com",
      "subject": "Expense Report",
      "body": "{{rendered_table}}"
    }
  }
]
```

## Implementation Priority

1. **Phase 1: Plugin Schemas** (1-2 days)
   - Define Gmail, Google Sheets, Airtable schemas
   - Document data structures and capabilities

2. **Phase 2: Enhanced IR Schema** (1 day)
   - Add `data_transformations`
   - Add `combineWith` to filters
   - Add `input_source` to ai_operations

3. **Phase 3: Context Injection** (1 day)
   - Update system prompt with plugin info
   - Inject plugin schemas into LLM context

4. **Phase 4: Compiler Updates** (2 days)
   - Handle `data_transformations`
   - Use explicit `combineWith` for filters
   - Validate against plugin capabilities

5. **Phase 5: Testing** (2 days)
   - Test 20+ diverse workflows
   - Verify no regressions
   - Document coverage

## Success Criteria

A workflow is **correctly generated** if:
1. ✅ Filters use correct logic (AND/OR explicitly stated)
2. ✅ Data transformations are explicit (no guessing)
3. ✅ Plugin capabilities are utilized (Gmail search, etc.)
4. ✅ AI operations have clear inputs
5. ✅ Variable flow is correct
6. ✅ Loops are properly inferred
7. ✅ DSL executes successfully

## Risk Mitigation

**Risk:** Breaking existing workflows
**Mitigation:**
- Version the schema (v3.0 → v3.1)
- Support both old and new format
- Gradual migration

**Risk:** LLM confused by too much context
**Mitigation:**
- Only inject relevant plugin schemas
- Use clear formatting
- Test with various models

**Risk:** Schema becomes too complex
**Mitigation:**
- Keep plugin schemas simple
- Use examples heavily
- Validate with real workflows
