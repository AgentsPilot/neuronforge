# IR Formalization - Schema Mapping

Map Grounded Semantic Plan → Declarative IR (JSON)

All reasoning is complete. Your job: **Mechanical schema mapping.**

---

## Output Schema

```typescript
{
  ir_version: "3.0"                             // REQUIRED: Always "3.0"
  goal: string                                  // REQUIRED: From semantic_plan.goal
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
- **REQUIRED FIELDS** (NEVER null):
  - `type`: `"api" | "tabular" | "webhook" | "database" | "file" | "stream"`
  - `source`: Source system name (e.g., `"google-mail"`, `"google-sheets"`)
  - `location`: Location identifier (e.g., `"inbox"`, `"Sheet1"`)
  - `plugin_key`: Plugin identifier (e.g., `"google-mail"`)
  - `operation_type`: EXACT action name from plugin (READ operations only)
- Optional: `role` (human-readable description), `config` (plugin parameters)
- WRITE operations belong in `file_operations` (storage) or `delivery_rules` (communication), NOT here

### Normalization
- Use ONLY for tabular data sources (Google Sheets, CSV files) that need header validation
- Structure: `{required_headers?, case_sensitive?, missing_header_action?, description?, fields?}`
- `required_headers`: Array of expected column names
- `case_sensitive`: Boolean for header matching
- `missing_header_action`: `"error" | "warn" | "ignore"`
- **IMPORTANT:** Set to `null` for API data sources (Gmail, Slack, etc.)
- **DO NOT** use `type` or `mappings` fields (not in schema)

### File Operations (Generate Files Only)
- Use ONLY for: Generate PDF/CSV/Excel files from data and optionally upload to storage
- Structure: `{type, source_data, output_config, upload_destination}`
- `type`: MUST be one of: `generate_pdf | generate_csv | generate_excel | upload_file`
- `output_config`: REQUIRED - `{format, filename, columns?, template?}`
- `upload_destination`: Optional - `{plugin_key, operation_type: "upload", location, overwrite?, permissions?}`
- **CRITICAL:** file_operations is for GENERATING NEW files, NOT for uploading existing files
- **WRONG:** Using file_operations to upload email attachments (use multiple_destinations instead)
- **WRONG:** Using `operation_type`, `plugin_key`, `query_source` in file_operations (schema doesn't support these)
- **RIGHT:** Using multiple_destinations with create_folder → upload_file → share_file for existing files
- **Set to null** if no file generation needed

### Filters
- `field`: From grounded facts (tabular) OR Available Plugins "Output Fields" (API)
- `operator`: MUST be one of these EXACT values:
  - `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches_regex`
  - `greater_than`, `less_than`, `greater_than_or_equals`, `less_than_or_equals`
  - `in`, `not_in`, `is_empty`, `is_not_empty`
  - `within_last_days`, `before`, `after`
- `value`: Concrete literal (string/number) OR `null`
- **NEVER use placeholders**: `<topic>`, `{query}`, `{{var}}` are INVALID
- **Set `filters: null`** if:
  - Data source already filters (research plugins, search with query param)
  - No concrete literal value available
- **CRITICAL for `in`/`not_in` operators:**
  - These operators **ONLY work with arrays of PRIMITIVES** (strings, numbers, booleans)
  - **CANNOT compare against arrays containing OBJECTS**
  - If the array contains objects (rows with multiple fields), you MUST first add a normalization/transform step to extract ONLY the comparison field into a simple array of primitives
  - Then use `in`/`not_in` against that extracted primitive array

### AI Operations
- `type`: `extract | classify | summarize | generate | analyze | transform | deterministic_extract`
- `instruction`: Business-level description
- `context`: What data to process
- `output_schema`: V6 custom schema (NOT standard JSON Schema):
  - **For object type**: `{"type": "object", "fields": [{name, type, required, description}]}`
  - **For array type**: `{"type": "array", "items": {...}}`
  - **For string type**: `{"type": "string"}`
  - **FORBIDDEN**: Standard JSON Schema syntax (`properties`, `$schema`, `definitions`)
- `constraints`: REQUIRED object with:
  - `model_preference`: `null` (let runtime choose)
  - `temperature`: `null` or number
  - `max_tokens`: `null` or number
- **FORBIDDEN**: `input_description` field (use `context` instead)

### Delivery Rules
- `send_when_no_results`: boolean - ALWAYS required
- At least ONE delivery method non-null (set others to `null`):
  - `summary_delivery` (single message with all results)
  - `per_item_delivery` (one message per item)
  - `per_group_delivery` (one message per group)
  - `multiple_destinations` (array of operations executed in sequence)
- Each delivery: `plugin_key` + `operation_type` (WRITE operations)
- **CRITICAL - Delivery fields:**
  - `summary_delivery`: Use `recipient` (string), `cc` (array), `subject`, `body_template`
  - `per_item_delivery` and `per_group_delivery`: Use `recipient_source` (field name), `cc`, `subject`, `body_template` - NO `recipient` field
  - Use `config` object for plugin-specific params (e.g., `{to: [...]}` for Gmail)
- **multiple_destinations Usage:**
  - Array of operations executed in ORDER
  - Can reference outputs from previous operations: `{{step_result.folder_id}}`, `{{step_result.file_id}}`
  - Use for: Upload existing files to Drive (create_folder → upload_file → share_file → notify)
  - Each destination: `{plugin_key, operation_type, config?, execution_scope?, ...}`
  - **execution_scope:** `"summary"` (default) runs once after all items; `"per_item"` runs inside loop for each item
  - **Pattern:** "For each X..." or "Store each attachment..." → set `execution_scope: "per_item"`
  - **IMPORTANT:** Do NOT add conditional/skip_condition/if/when fields to destinations - use `post_ai_filters` or `conditionals` array instead

### Post-AI Filters (filter extracted items)
- **IMPORTANT:** Use `post_ai_filters` to filter items AFTER AI extraction based on extracted fields
- **Pattern:** "Only append if amount > 50" → use `post_ai_filters` with amount condition
- **Structure:** Same as `filters` - has `conditions` array, `combineWith` logic
- **DO NOT** use `conditionals` for filtering - use `post_ai_filters` instead

### Conditionals (if/then logic)
- **USE SPARINGLY:** Only for branching logic with different actions, NOT for filtering items
- **REQUIRED:** `condition` object with `type: "simple" | "complex"`
- **Simple condition:** Set `type: "simple"`, `field`, `operator`, `value`
- **Complex condition:** Set `type: "complex"`, `combineWith: "AND" | "OR"`, `conditions: []`
- **then_actions:** Array with `type` field (enum: `set_field | skip_delivery | use_template | send_to_recipient | abort | continue`)
- **else_actions:** Optional array (same structure)
- **DO NOT** use `plugin_key`/`operation_type` inside conditionals - use action `type` enum only
- **CRITICAL for `in`/`not_in` in conditions:**
  - Same restriction as filters: these operators **ONLY work with arrays of primitives**
  - If comparing against array of objects, you MUST add a normalization step FIRST to extract the comparison field
  - The conditional's `value` field must reference the extracted primitive array, NOT the original object array

### Edge Cases
- **condition:** MUST be enum value:
  - `no_rows_after_filter | empty_data_source | missing_required_field | missing_required_headers | duplicate_records | rate_limit_exceeded | api_error | no_attachments_found | ai_extraction_failed`
- **action:** MUST be enum value:
  - `send_empty_result_message | skip_execution | use_default_value | retry | alert_admin`
- **Optional:** `message`, `recipient` (free-form strings)

### Processing Order
- **DO NOT** include `processing_order` field in IR (not supported by schema)
- Compiler automatically determines execution order from dependencies
- Enhanced Prompt's `processing_steps` can be ignored for IR generation

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
  "ir_version": "3.0",
  "goal": "Extract invoice data from Gmail attachments and email summary",
  "runtime_inputs": null,
  "data_sources": [{
    "type": "api",
    "source": "google-mail",
    "location": "inbox",
    "role": "Email attachments",
    "plugin_key": "google-mail",
    "operation_type": "search_messages",
    "config": {"query": "has:attachment"}
  }],
  "normalization": null,
  "filters": null,
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract invoice data",
    "context": "Email attachments",
    "output_schema": {
      "type": "object",
      "fields": [
        {"name": "invoice_number", "type": "string", "required": true, "description": "Invoice number"},
        {"name": "vendor", "type": "string", "required": true, "description": "Vendor name"},
        {"name": "amount", "type": "number", "required": true, "description": "Invoice amount"}
      ]
    },
    "constraints": {"model_preference": null, "temperature": null, "max_tokens": null}
  }],
  "post_ai_filters": null,
  "partitions": null,
  "grouping": null,
  "rendering": {
    "type": "email_embedded_table",
    "columns_in_order": ["invoice_number", "vendor", "amount"]
  },
  "file_operations": null,
  "conditionals": null,
  "delivery_rules": {
    "send_when_no_results": true,
    "summary_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "recipient": "finance@company.com",
      "subject": "Invoice Summary",
      "body_template": "Found {{count}} invoices",
      "config": null
    },
    "per_item_delivery": null,
    "per_group_delivery": null,
    "multiple_destinations": null
  },
  "edge_cases": null,
  "clarifications_required": null
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
  "ir_version": "3.0",
  "goal": "Research AI trends and send to Slack",
  "runtime_inputs": null,
  "data_sources": [{
    "type": "api",
    "source": "chatgpt-research",
    "location": "AI trends topic",
    "role": "Research results",
    "plugin_key": "chatgpt-research",
    "operation_type": "research",
    "config": {"query": "AI trends"}
  }],
  "normalization": null,
  "filters": null,
  "ai_operations": null,
  "post_ai_filters": null,
  "partitions": null,
  "grouping": null,
  "rendering": {
    "type": "summary_block",
    "columns_in_order": ["title", "snippet", "url"]
  },
  "file_operations": null,
  "conditionals": null,
  "delivery_rules": {
    "send_when_no_results": false,
    "summary_delivery": {
      "plugin_key": "slack",
      "operation_type": "send_message",
      "recipient": null,
      "body_template": "Research results",
      "config": {"channel": "#research"}
    },
    "per_item_delivery": null,
    "per_group_delivery": null,
    "multiple_destinations": null
  },
  "edge_cases": null,
  "clarifications_required": null
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
  "ir_version": "3.0",
  "goal": "Filter spreadsheet by stage 4, group by vendor, email each group",
  "runtime_inputs": null,
  "data_sources": [{
    "type": "tabular",
    "source": "google-sheets",
    "location": "MyLeads spreadsheet",
    "role": "Lead data",
    "plugin_key": "google-sheets",
    "operation_type": "read_range",
    "config": {"spreadsheet_id": "...", "range": "Sheet1!A:Z"}
  }],
  "normalization": null,
  "filters": {
    "combineWith": "AND",
    "conditions": [{
      "field": "Stage",
      "operator": "equals",
      "value": "4",
      "description": null
    }],
    "groups": []
  },
  "ai_operations": null,
  "post_ai_filters": null,
  "partitions": null,
  "grouping": {
    "group_by": "vendor",
    "per_group_rendering": true
  },
  "rendering": {
    "type": "email_embedded_table",
    "columns_in_order": ["name", "email", "stage"]
  },
  "file_operations": null,
  "conditionals": null,
  "delivery_rules": {
    "send_when_no_results": false,
    "summary_delivery": null,
    "per_item_delivery": null,
    "per_group_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "recipient_source": "email",
      "subject": "Leads for {{group_key}}",
      "body_template": "Here are your stage 4 leads",
      "config": null
    },
    "multiple_destinations": null
  },
  "edge_cases": null,
  "clarifications_required": null
}
```

### Pattern 4: Generate NEW File from Data (file_operations)
```
Data Source (google-sheets.read_range)
  → File Operations (GENERATE NEW CSV file from data, upload to Drive)
  → Delivery (email with link)

NOTE: This is for GENERATING files, not uploading existing files!
For uploading existing email attachments → use Pattern 5 (multiple_destinations)
```

**IR:**
```json
{
  "ir_version": "3.0",
  "goal": "Generate CSV report from spreadsheet and upload to Drive",
  "runtime_inputs": null,
  "data_sources": [{
    "type": "tabular",
    "source": "google-sheets",
    "location": "Sales Data",
    "role": "Sales records",
    "plugin_key": "google-sheets",
    "operation_type": "read_range",
    "config": {"spreadsheet_id": "...", "range": "Sheet1!A:Z"}
  }],
  "normalization": null,
  "filters": null,
  "ai_operations": null,
  "post_ai_filters": null,
  "partitions": null,
  "grouping": null,
  "rendering": null,
  "file_operations": [{
    "type": "generate_csv",
    "source_data": "step1.data",
    "output_config": {
      "format": "csv",
      "filename": "sales_report.csv",
      "columns": ["date", "product", "amount"],
      "template": null
    },
    "upload_destination": {
      "plugin_key": "google-drive",
      "operation_type": "upload",
      "location": "/Reports",
      "overwrite": false,
      "permissions": "anyone_with_link"
    }
  }],
  "conditionals": null,
  "delivery_rules": {
    "send_when_no_results": false,
    "summary_delivery": {
      "plugin_key": "google-mail",
      "operation_type": "send_message",
      "recipient": "sales@company.com",
      "subject": "Sales Report Ready",
      "body_template": "Your CSV report has been uploaded to Drive.",
      "config": null
    },
    "per_item_delivery": null,
    "per_group_delivery": null,
    "multiple_destinations": null
  },
  "edge_cases": null,
  "clarifications_required": null
}
```

### Pattern 5: Upload Existing Files to Drive (Email Attachments)
```
Data Source (gmail.search_messages)
  → AI Operation (deterministic_extract)
  → Multiple Destinations (create folders, upload attachments, share files, send email)
```

**IR:**
```json
{
  "ir_version": "3.0",
  "goal": "Extract invoice data from Gmail PDFs and store in Google Drive",
  "runtime_inputs": null,
  "data_sources": [{
    "type": "api",
    "source": "google-mail",
    "location": "inbox",
    "role": "Email attachments",
    "plugin_key": "google-mail",
    "operation_type": "search_messages",
    "config": {"query": "has:attachment newer_than:1d"}
  }],
  "normalization": null,
  "filters": null,
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract vendor, amount, invoice number from PDF",
    "context": "PDF attachments",
    "output_schema": {
      "type": "object",
      "fields": [
        {"name": "vendor", "type": "string", "required": true, "description": "Vendor name"},
        {"name": "amount", "type": "number", "required": true, "description": "Invoice amount"},
        {"name": "invoice_number", "type": "string", "required": true, "description": "Invoice number"}
      ]
    },
    "constraints": {"model_preference": null, "temperature": null, "max_tokens": null}
  }],
  "post_ai_filters": null,
  "partitions": null,
  "grouping": null,
  "rendering": {
    "type": "email_embedded_table",
    "columns_in_order": ["vendor", "amount", "invoice_number"]
  },
  "file_operations": null,
  "conditionals": null,
  "delivery_rules": {
    "send_when_no_results": true,
    "summary_delivery": null,
    "per_item_delivery": null,
    "per_group_delivery": null,
    "multiple_destinations": [
      {
        "plugin_key": "google-drive",
        "operation_type": "create_folder",
        "execution_scope": "per_item",
        "config": {
          "folder_name": "{{vendor}}",
          "parent_folder_id": "root"
        }
      },
      {
        "plugin_key": "google-drive",
        "operation_type": "upload_file",
        "execution_scope": "per_item",
        "config": {
          "file_content": "{{attachment_content}}",
          "file_name": "{{vendor}}_{{invoice_number}}.pdf",
          "folder_id": "{{step_result.folder_id}}",
          "mime_type": "application/pdf"
        }
      },
      {
        "plugin_key": "google-drive",
        "operation_type": "share_file",
        "execution_scope": "per_item",
        "config": {
          "file_id": "{{step_result.file_id}}",
          "permission_type": "anyone",
          "permission_role": "reader"
        }
      },
      {
        "plugin_key": "google-mail",
        "operation_type": "send_message",
        "execution_scope": "summary",
        "recipient": "finance@company.com",
        "subject": "Invoice Processing Complete",
        "body_template": "Found {{count}} invoices. Drive links: {{drive_links}}",
        "config": null
      }
    ]
  },
  "edge_cases": null,
  "clarifications_required": null
}
```

**Key Points:**
- Use `multiple_destinations` when you need to call MULTIPLE plugin operations in sequence
- Each destination is executed in order, can reference outputs from previous operations
- Variable interpolation: `{{vendor}}`, `{{step_result.folder_id}}`, `{{attachment_content}}`
- Common pattern: create_folder → upload_file → share_file → send_notification
- file_operations is for GENERATING files (PDF/CSV/Excel) and optionally uploading
- NOT for direct plugin operations like create_folder or share_file
- For uploading existing files (like email attachments), use delivery_rules with multiple_destinations

### Pattern 6: Conditional Delivery (If/Then Logic)
```
Data Source (gmail) → AI Extract → If amount > 50 THEN append to Sheets ELSE skip
```

**IR:**
```json
{
  "ir_version": "3.0",
  "goal": "Process invoices and conditionally append to Google Sheets",
  "runtime_inputs": null,
  "data_sources": [{
    "type": "api",
    "source": "google-mail",
    "location": "inbox",
    "role": "Invoice emails",
    "plugin_key": "google-mail",
    "operation_type": "search_messages",
    "config": {"query": "subject:invoice"}
  }],
  "normalization": null,
  "filters": null,
  "ai_operations": [{
    "type": "deterministic_extract",
    "instruction": "Extract amount from invoice",
    "context": "Email body",
    "output_schema": {
      "type": "object",
      "fields": [
        {"name": "amount", "type": "number", "required": true, "description": "Invoice amount"}
      ]
    },
    "constraints": {"model_preference": null, "temperature": null, "max_tokens": null}
  }],
  "post_ai_filters": null,
  "partitions": null,
  "grouping": null,
  "rendering": {
    "type": "email_embedded_table",
    "columns_in_order": ["amount"]
  },
  "file_operations": null,
  "conditionals": [{
    "condition": {
      "type": "simple",
      "field": "amount",
      "operator": "greater_than",
      "value": 50
    },
    "then_actions": [{
      "type": "continue"
    }],
    "else_actions": [{
      "type": "skip_delivery"
    }]
  }],
  "delivery_rules": {
    "send_when_no_results": false,
    "summary_delivery": null,
    "per_item_delivery": {
      "plugin_key": "google-sheets",
      "operation_type": "append_rows",
      "config": {
        "spreadsheet_id": "abc123",
        "range": "Sheet1!A:B",
        "values": "{{amount}}"
      }
    },
    "per_group_delivery": null,
    "multiple_destinations": null
  },
  "edge_cases": null,
  "clarifications_required": null
}
```

**CRITICAL - Conditionals Structure:**
- `condition` object MUST have `type` field: `"simple"` or `"complex"`
- **Simple condition:** `{type: "simple", field, operator, value}`
- **Complex condition:** `{type: "complex", combineWith: "AND" | "OR", conditions: [{field, operator, value}, ...]}`
- **DO NOT** use `groups` property (not allowed in schema)
- `then_actions` and `else_actions` MUST use `type` enum: `set_field`, `skip_delivery`, `use_template`, `send_to_recipient`, `abort`, `continue`
- **DO NOT** use `plugin_key` or `operation_type` in actions (conditionals can't trigger plugin operations)
- For conditional plugin operations, use `post_ai_filters` instead + explicit delivery

---

## Validation Checklist

Before returning IR, verify:

✅ `ir_version` = `"3.0"`
✅ `goal` is populated
✅ `data_sources[]` has ≥1 source
✅ Every data source has ALL required fields:
   - `type` (api/tabular/webhook/database/file/stream)
   - `source` (system name)
   - `location` (identifier)
   - `plugin_key` (plugin identifier)
   - `operation_type` (READ action name)
✅ `file_operations` uses `type` enum (generate_pdf/generate_csv/generate_excel/upload_file) with `output_config`
✅ Every delivery: `plugin_key` + `operation_type` (WRITE communication actions)
✅ File generation (PDF/CSV) goes in `file_operations`; uploading existing files goes in `multiple_destinations`
✅ `delivery_rules.send_when_no_results` exists (boolean)
✅ ALL delivery methods set to null except the one being used
✅ Delivery uses `recipient` or `recipient_source` (NOT `recipients`, `to`, or `to_field`)
✅ Plugin-specific params go in `config` object (e.g., Slack channel)
✅ `ai_operations[].output_schema` has `type` field and appropriate structure:
   - object type: MUST have `fields` array with name/type/required/description
   - array type: MUST have `items` object
   - string type: Just `{"type": "string"}`
✅ `ai_operations[].constraints` uses `model_preference` (NOT `model`)
✅ `rendering.type` is valid enum: `email_embedded_table | html_table | summary_block | alert | json | csv`
✅ `conditionals[].condition` has `type: "simple" | "complex"` field
✅ `conditionals[].then_actions[]` uses action `type` enum (NOT `plugin_key`)
✅ `edge_cases[].condition` is enum value (NOT free-form string)
✅ `edge_cases[].action` is enum value (NOT free-form string)
✅ No forbidden fields: `id`, `step_id`, `input_description`, `properties`, `required`, `recipients`, `to`, `to_field`, etc.
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
