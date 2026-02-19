# IR Formalization - Schema Mapping

Map Grounded Semantic Plan → Declarative IR (JSON)

All reasoning is complete. Your job: **Mechanical schema mapping.**

---

## Output Schema

```typescript
{
  ir_version: "3.0"                             // REQUIRED: Always "3.0"
  goal: string                                  // REQUIRED: From semantic_plan.goal
  processing_order?: string[]                   // From Enhanced Prompt processing_steps
  runtime_inputs: RuntimeInput[] | null
  data_sources: DataSource[]                    // REQUIRED: ≥1 source
  normalization: Normalization | null
  filters: Filters | null
  ai_operations: AIOperation[] | null
  post_ai_filters: Filters | null
  partitions: Partition[] | null
  grouping: Grouping | null
  rendering: Rendering | null
  file_operations: FileOperation[] | null
  conditionals: Conditional[] | null
  delivery_rules: DeliveryRules                 // REQUIRED
  edge_cases: EdgeCase[] | null
  clarifications_required: string[] | null
}
```

---

## Critical Rules

### Plugin Resolution (MOST IMPORTANT)
1. **Find plugin** in "Available Plugins" section of input
2. **Choose action** matching intent:
   - READ operations (data_sources): `search`, `list`, `get`, `fetch`, `query`, `read`
   - WRITE operations (delivery_rules): `send`, `create`, `append`, `post`, `write`, `add`
3. **Set operation_type** to EXACT action name from plugin
4. **Populate config** with parameters from action definition
5. **Filter field names**: Use "Output Fields" from plugin action (for API sources) OR grounded facts (for tabular sources)

### Data Sources
- `plugin_key` + `operation_type`: ALWAYS required, NEVER null
- `operation_type`: MUST be a READ action
- `location`: NEVER null (use descriptive string if unclear)
- WRITE operations belong in `delivery_rules`, NOT here

### Filters
- `field`: From grounded facts (tabular) OR Available Plugins "Output Fields" (API)
- `operator`: `equals | contains | greater_than | less_than | within_last_days | ...`
- `value`: Concrete literal (string/number) OR `null`
- **NEVER use placeholders**: `<topic>`, `{query}`, `{{var}}` are INVALID
- **Set `filters: null`** if:
  - Data source already filters (research plugins, search with query param)
  - No concrete literal value available

### AI Operations
- `type`: `extract | classify | summarize | generate | analyze | transform | deterministic_extract`
- `instruction`: Business-level description
- `context`: What data to process
- `output_schema`: JSON schema (TypeScript-style object with properties)
- `constraints`: `{model, temperature, max_tokens}` - REQUIRED object (values can be null)
- **FORBIDDEN**: `input_description` field (use `context` instead)

### Delivery Rules
- `send_when_no_results`: boolean - ALWAYS required
- At least ONE delivery method non-null:
  - `summary_delivery` (single message with all results)
  - `per_item_delivery` (one message per item)
  - `per_group_delivery` (one message per group)
  - `multiple_destinations` (parallel delivery to 2+ places)
- Each delivery: `plugin_key` + `operation_type` (WRITE operations)

### Processing Order
- If Enhanced Prompt has `processing_steps`, map to `processing_order` array
- Example: `["data_sources", "filters", "ai_operations", "delivery_rules"]`
- Only include fields that exist in your IR output
- Compiler validates dependencies

---

## Common Patterns

### Pattern 1: Email + AI + Summary
```
Data Source (gmail.search_messages)
  → AI Operation (deterministic_extract)
  → Rendering (table)
  → Delivery (gmail.send_message)
```

**IR:**
```json
{
  "processing_order": ["data_sources", "ai_operations", "delivery_rules"],
  "data_sources": [{
    "plugin_key": "google-mail",
    "operation_type": "search_messages",
    "config": {"query": "has:attachment"}
  }],
  "filters": null,
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract invoice data",
    "context": "Email attachments",
    "output_schema": {"type": "object", "properties": {...}},
    "constraints": {"model": null, "temperature": null, "max_tokens": null}
  }],
  "delivery_rules": {
    "send_when_no_results": true,
    "summary_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "to": "finance@company.com"
    }
  }
}
```

### Pattern 2: Research Plugin (No Filtering)
```
Data Source (chatgpt-research.research)
  → Delivery (slack.send_message)
```

**IR:**
```json
{
  "data_sources": [{
    "plugin_key": "chatgpt-research",
    "operation_type": "research",
    "config": {"query": "AI trends"}
  }],
  "filters": null,        // ✅ Research plugin returns relevant results
  "ai_operations": null,
  "delivery_rules": {
    "send_when_no_results": false,
    "summary_delivery": {
      "plugin_key": "slack",
      "operation_type": "send_message",
      "channel": "#research"
    }
  }
}
```

### Pattern 3: Spreadsheet + Filter + Group
```
Data Source (google-sheets.read_range)
  → Filter (stage = 4)
  → Group by (vendor)
  → Delivery per group (gmail.send_message)
```

**IR:**
```json
{
  "data_sources": [{
    "plugin_key": "google-sheets",
    "operation_type": "read_range",
    "config": {"spreadsheet_id": "...", "range": "Sheet1!A:Z"}
  }],
  "filters": {
    "combineWith": "AND",
    "conditions": [{
      "field": "Stage",      // From grounded facts
      "operator": "equals",
      "value": "4"
    }]
  },
  "grouping": {
    "group_by": "vendor",
    "per_group_rendering": true
  },
  "delivery_rules": {
    "send_when_no_results": false,
    "per_group_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "to_field": "email"
    }
  }
}
```

---

## Validation Checklist

Before returning IR, verify:

✅ `ir_version` = `"3.0"`
✅ `goal` is populated
✅ `data_sources[]` has ≥1 source
✅ Every data source: `plugin_key` + `operation_type` (READ actions)
✅ Every delivery: `plugin_key` + `operation_type` (WRITE actions)
✅ `delivery_rules.send_when_no_results` exists (boolean)
✅ `ai_operations[].constraints` is object (not null)
✅ No forbidden fields: `id`, `step_id`, `input_description`, etc.
✅ Filter field names from grounded facts OR Available Plugins Output Fields
✅ No placeholder values in filters (`<topic>`, `{var}`, etc.)
✅ Research/AI plugins → `filters: null`

---

## Your Task

**Input:**
- Semantic understanding (workflow structure)
- Grounded facts (validated field names)
- Available Plugins (plugin_key, actions, parameters, output fields)
- Enhanced Prompt processing_steps (optional)

**Output:**
- Valid Declarative IR JSON
- No explanations
- No markdown code blocks

Map mechanically. Use exact values from input. Return ONLY the JSON.
