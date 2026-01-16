# Logical IR Schema Specification

## Complete Extended IR Schema

```typescript
interface ExtendedLogicalIR {
  // Metadata
  ir_version: string              // "2.0"
  goal: string                    // Human-readable workflow goal

  // Data Layer (WHERE data comes from)
  data_sources: DataSource[]
  normalization?: Normalization

  // Processing Layer (WHAT to do with data)
  filters?: Filter[]
  transforms?: Transform[]
  ai_operations?: AIOperation[]

  // Control Flow (HOW to process)
  conditionals?: Conditional[]
  loops?: Loop[]
  partitions?: Partition[]
  grouping?: Grouping

  // Output Layer (WHERE results go)
  rendering?: Rendering
  delivery: Delivery[]

  // Error Handling
  edge_cases?: EdgeCase[]
  clarifications_required: string[]
}
```

## Field Definitions

### Data Sources

```typescript
interface DataSource {
  id: string                      // Unique identifier
  type: DataSourceType
  source?: string                 // Plugin name (optional)
  location: string                // Business identifier
  tab?: string                    // For tabular data
  role?: string                   // Business description
}

type DataSourceType =
  | "tabular"      // Spreadsheets, databases
  | "api"          // REST APIs
  | "webhook"      // Event triggers
  | "database"     // Direct DB queries
  | "file"         // Files (CSV, JSON, PDF)
  | "stream"       // Real-time data
```

**Example:**
```json
{
  "id": "leads_data",
  "type": "tabular",
  "source": "google_sheets",
  "location": "MyLeads",
  "tab": "Leads",
  "role": "lead tracking data"
}
```

---

### Normalization

```typescript
interface Normalization {
  required_headers: string[]
  case_sensitive?: boolean
  missing_header_action?: "error" | "warn" | "ignore"
}
```

**Example:**
```json
{
  "required_headers": ["stage", "Sales Person", "Email"],
  "case_sensitive": false
}
```

---

### Filters

```typescript
interface Filter {
  id?: string
  field: string
  operator: FilterOperator
  value: any
  description?: string
}

type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty"
```

**Example:**
```json
{
  "id": "stage_filter",
  "field": "stage",
  "operator": "equals",
  "value": 4,
  "description": "High-qualified leads only"
}
```

---

### Transforms

```typescript
interface Transform {
  id?: string
  operation: TransformOperation
  config: TransformConfig
}

type TransformOperation =
  | "map"          // Transform each item
  | "filter"       // Subset based on condition (alternative to Filter[])
  | "reduce"       // Aggregate into single value
  | "sort"         // Order data
  | "group"        // Group by field
  | "aggregate"    // sum, count, average
  | "join"         // Merge datasets
  | "deduplicate"  // Remove duplicates
  | "flatten"      // Flatten nested arrays

interface TransformConfig {
  source?: string               // Input data reference
  field?: string                // Field to operate on
  group_by?: string             // For grouping
  sort_by?: string              // For sorting
  order?: "asc" | "desc"
  aggregation?: AggregationType
  join_key?: string
  // ... operation-specific config
}

type AggregationType = "sum" | "count" | "average" | "min" | "max"
```

**Examples:**
```json
// Group by
{
  "operation": "group",
  "config": {
    "source": "{{filtered_leads}}",
    "group_by": "Sales Person"
  }
}

// Sort
{
  "operation": "sort",
  "config": {
    "source": "{{leads}}",
    "sort_by": "created_date",
    "order": "desc"
  }
}

// Aggregate
{
  "operation": "aggregate",
  "config": {
    "source": "{{sales}}",
    "field": "amount",
    "aggregation": "sum"
  }
}
```

---

### AI Operations (NEW - Critical)

```typescript
interface AIOperation {
  id?: string
  type: AIOperationType
  instruction: string             // What to do (business language)
  input_source: string            // {{variable}} reference
  output_schema: OutputSchema     // Expected output structure
  constraints?: AIConstraints
}

type AIOperationType =
  | "summarize"      // Text summarization
  | "extract"        // Extract structured data
  | "classify"       // Categorize into classes
  | "sentiment"      // Sentiment analysis
  | "generate"       // Generate text
  | "decide"         // Make a decision

interface OutputSchema {
  type: "string" | "object" | "array" | "number" | "boolean"
  fields?: OutputField[]
  enum?: string[]               // For classification
}

interface OutputField {
  name: string
  type: string
  required?: boolean
  description?: string
}

interface AIConstraints {
  max_tokens?: number
  temperature?: number          // 0-1, lower = more deterministic
  model_preference?: string     // "fast" | "accurate" | "balanced"
}
```

**Examples:**
```json
// Summarization
{
  "type": "summarize",
  "instruction": "Summarize each customer email in 2-3 sentences, focusing on their main request",
  "input_source": "{{customer_emails}}",
  "output_schema": {
    "type": "array",
    "fields": [
      { "name": "email_id", "type": "string", "required": true },
      { "name": "summary", "type": "string", "required": true },
      { "name": "action_items", "type": "array" }
    ]
  },
  "constraints": {
    "max_tokens": 150,
    "temperature": 0.3
  }
}

// Classification
{
  "type": "classify",
  "instruction": "Classify each support ticket by urgency level",
  "input_source": "{{tickets}}",
  "output_schema": {
    "type": "object",
    "fields": [
      { "name": "ticket_id", "type": "string" },
      {
        "name": "urgency",
        "type": "string",
        "enum": ["critical", "high", "medium", "low"]
      }
    ]
  }
}

// Extraction
{
  "type": "extract",
  "instruction": "Extract invoice details from PDF text",
  "input_source": "{{pdf_text}}",
  "output_schema": {
    "type": "object",
    "fields": [
      { "name": "invoice_number", "type": "string", "required": true },
      { "name": "date", "type": "string", "required": true },
      { "name": "total_amount", "type": "number", "required": true },
      { "name": "vendor_name", "type": "string" },
      { "name": "line_items", "type": "array" }
    ]
  }
}
```

---

### Conditionals

```typescript
interface Conditional {
  id?: string
  when: Condition
  then: Intent[]                // Nested intent blocks
  else?: Intent[]
}

interface Condition {
  type: "simple" | "complex_and" | "complex_or" | "complex_not"
  field?: string                // For simple conditions
  operator?: FilterOperator
  value?: any
  conditions?: Condition[]      // For complex conditions
}

type Intent =
  | { type: "filter", config: Filter }
  | { type: "transform", config: Transform }
  | { type: "ai_operation", config: AIOperation }
  | { type: "delivery", config: Delivery }
  | { type: "conditional", config: Conditional }
```

**Examples:**
```json
// Simple conditional
{
  "when": {
    "type": "simple",
    "field": "total_amount",
    "operator": "greater_than",
    "value": 10000
  },
  "then": [
    {
      "type": "delivery",
      "config": {
        "method": "email",
        "recipient": "manager@company.com",
        "subject": "High-value invoice requires approval"
      }
    }
  ],
  "else": [
    {
      "type": "delivery",
      "config": {
        "method": "api_call",
        "endpoint": "accounting_system",
        "action": "auto_approve"
      }
    }
  ]
}

// Complex conditional (AND)
{
  "when": {
    "type": "complex_and",
    "conditions": [
      { "type": "simple", "field": "status", "operator": "equals", "value": "new" },
      { "type": "simple", "field": "priority", "operator": "equals", "value": "high" }
    ]
  },
  "then": [...]
}
```

---

### Loops

```typescript
interface Loop {
  id?: string
  for_each: string              // Source to iterate ({{variable}})
  item_variable: string         // Name for current item
  do: Intent[]                  // Actions for each iteration
  max_iterations?: number       // Safety limit
  max_concurrency?: number      // Parallel processing limit
}
```

**Example:**
```json
{
  "for_each": "{{customers}}",
  "item_variable": "customer",
  "do": [
    {
      "type": "ai_operation",
      "config": {
        "type": "generate",
        "instruction": "Draft personalized email for {{customer.name}} based on their order history",
        "output_schema": { "type": "string" }
      }
    },
    {
      "type": "delivery",
      "config": {
        "method": "email",
        "recipient": "{{customer.email}}",
        "body": "{{generated_email}}"
      }
    }
  ],
  "max_concurrency": 5
}
```

---

### Partitions

```typescript
interface Partition {
  id?: string
  field: string
  split_by: "value" | "condition"
  condition?: Condition         // For conditional partitioning
  handle_empty?: {
    partition_name: string
    description?: string
  }
}
```

**Example:**
```json
{
  "field": "Sales Person",
  "split_by": "value",
  "handle_empty": {
    "partition_name": "missing_sales_person",
    "description": "Leads without assigned salesperson"
  }
}
```

---

### Grouping

```typescript
interface Grouping {
  input_partition: string       // Which partition to group
  group_by: string              // Field to group by
  emit_per_group: boolean       // Create separate output per group
}
```

**Example:**
```json
{
  "input_partition": "all",
  "group_by": "Sales Person",
  "emit_per_group": true
}
```

---

### Rendering

```typescript
interface Rendering {
  type: RenderingType
  template?: string             // For template-based rendering
  engine?: "jinja" | "handlebars" | "mustache"
  columns_in_order?: string[]   // For table rendering
  empty_message?: string
}

type RenderingType =
  | "html_table"
  | "email_embedded_table"
  | "json"
  | "csv"
  | "template"
  | "summary_block"
  | "alert"
  | "none"
```

**Example:**
```json
{
  "type": "html_table",
  "columns_in_order": ["Date", "Lead Name", "Email", "Phone"],
  "empty_message": "No leads found"
}
```

---

### Delivery

```typescript
interface Delivery {
  id?: string
  method: DeliveryMethod
  config: DeliveryConfig
}

type DeliveryMethod =
  | "email"
  | "slack"
  | "webhook"
  | "database"
  | "api_call"
  | "file"
  | "sms"

interface DeliveryConfig {
  // Email
  recipient?: string | string[]
  recipient_source?: string     // Field containing recipient
  cc?: string[]
  bcc?: string[]
  subject?: string
  body?: string

  // Slack
  channel?: string
  message?: string

  // Webhook/API
  url?: string
  endpoint?: string
  method?: "GET" | "POST" | "PUT" | "DELETE"
  headers?: Record<string, string>
  payload?: any

  // Database
  table?: string
  operation?: "insert" | "update" | "delete"

  // File
  path?: string
  format?: "json" | "csv" | "txt"
}
```

**Examples:**
```json
// Email delivery
{
  "method": "email",
  "config": {
    "recipient_source": "{{group_key}}",
    "cc": ["meiribarak@gmail.com"],
    "subject": "Your Stage 4 Leads",
    "body": "{{html_table}}"
  }
}

// Webhook delivery
{
  "method": "webhook",
  "config": {
    "url": "https://api.example.com/leads",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{api_key}}" },
    "payload": {
      "leads": "{{filtered_leads}}",
      "timestamp": "{{now}}"
    }
  }
}

// Database write
{
  "method": "database",
  "config": {
    "table": "processed_leads",
    "operation": "insert",
    "payload": "{{grouped_leads}}"
  }
}
```

---

### Edge Cases

```typescript
interface EdgeCase {
  condition: EdgeCaseCondition
  action: EdgeCaseAction
  message?: string
  recipient?: string
}

type EdgeCaseCondition =
  | "no_rows_after_filter"
  | "empty_data_source"
  | "missing_required_field"
  | "duplicate_records"
  | "rate_limit_exceeded"
  | "api_error"

type EdgeCaseAction =
  | "send_empty_result_message"
  | "skip_execution"
  | "use_default_value"
  | "retry"
  | "alert_admin"
```

**Example:**
```json
{
  "condition": "no_rows_after_filter",
  "action": "send_empty_result_message",
  "message": "0 high qualified leads found",
  "recipient": "meiribarak@gmail.com"
}
```

---

## Complete Real-World Example

### Your Enhanced Prompt → Logical IR

**Input (Enhanced Prompt):**
```json
{
  "sections": {
    "data": [
      "Read from Google Sheet MyLeads tab Leads",
      "Column 'stage' = qualification indicator"
    ],
    "actions": [
      "Filter rows where stage = 4",
      "Group by Sales Person column",
      "Handle missing Sales Person → email Barak"
    ],
    "delivery": [
      "Send one email per salesperson",
      "CC Barak on all emails"
    ]
  }
}
```

**Output (Logical IR):**
```json
{
  "ir_version": "2.0",
  "goal": "Send stage 4 leads to sales people with Barak CC'd",

  "data_sources": [
    {
      "id": "leads_data",
      "type": "tabular",
      "source": "google_sheets",
      "location": "MyLeads",
      "tab": "Leads",
      "role": "lead tracking data"
    }
  ],

  "normalization": {
    "required_headers": ["stage", "Sales Person", "Date", "Lead Name", "Email", "Phone"],
    "case_sensitive": false
  },

  "filters": [
    {
      "id": "stage_filter",
      "field": "stage",
      "operator": "equals",
      "value": 4,
      "description": "High-qualified leads only"
    }
  ],

  "partitions": [
    {
      "id": "by_sales_person",
      "field": "Sales Person",
      "split_by": "value",
      "handle_empty": {
        "partition_name": "missing_sales_person",
        "description": "Leads without assigned salesperson"
      }
    }
  ],

  "grouping": {
    "input_partition": "by_sales_person",
    "group_by": "Sales Person",
    "emit_per_group": true
  },

  "rendering": {
    "type": "html_table",
    "columns_in_order": ["Date", "Lead Name", "Email", "Phone"],
    "empty_message": "No leads in this group"
  },

  "delivery": [
    {
      "id": "per_group_email",
      "method": "email",
      "config": {
        "recipient_source": "group_key",
        "cc": ["meiribarak@gmail.com"],
        "subject": "Your Stage 4 Leads",
        "body": "{{html_table}}"
      }
    },
    {
      "id": "missing_salesperson_email",
      "method": "email",
      "config": {
        "recipient": "meiribarak@gmail.com",
        "subject": "Leads Missing Sales Person Assignment",
        "body": "The following leads don't have an assigned salesperson:\n\n{{html_table}}"
      }
    }
  ],

  "edge_cases": [
    {
      "condition": "no_rows_after_filter",
      "action": "send_empty_result_message",
      "message": "0 high qualified leads found",
      "recipient": "meiribarak@gmail.com"
    }
  ],

  "clarifications_required": []
}
```

---

## JSON Schema for Validation

The IR is validated using JSON Schema for OpenAI structured outputs:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ExtendedLogicalIR",
  "type": "object",
  "required": ["ir_version", "goal", "data_sources", "delivery", "clarifications_required"],
  "additionalProperties": false,
  "properties": {
    "ir_version": { "type": "string", "enum": ["2.0"] },
    "goal": { "type": "string", "minLength": 5 },
    "data_sources": { ... },
    "filters": { ... },
    "transforms": { ... },
    "ai_operations": { ... },
    "conditionals": { ... },
    "loops": { ... },
    "delivery": { ... },
    "edge_cases": { ... },
    "clarifications_required": { "type": "array", "items": { "type": "string" } }
  }
}
```

Full schema: `lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts`

---

## Validation Rules

1. **Required fields must be present**
2. **No execution tokens allowed** (no "plugin", "action", "step_id", "execute")
3. **Variable references must use {{}} syntax**
4. **AI operations must have output_schema**
5. **Conditionals must have both when and then**
6. **Loops must have for_each and do**
7. **Delivery must have valid method + config**

---

**Next:** [Compiler Design](./05-compiler-design.md)
