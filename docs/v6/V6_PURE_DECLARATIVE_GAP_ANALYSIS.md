# V6 Pure Declarative Architecture - Comprehensive Gap Analysis

**Date:** 2025-12-25
**Status:** COMPREHENSIVE AUDIT COMPLETE
**Scope:** IR Schema, Compiler, Plugin Resolution, Future Scenarios

---

## Executive Summary

This document provides a thorough analysis of the V6 Pure Declarative Architecture to identify:
- What is currently supported
- What gaps exist in the implementation
- What scenarios might fail in production
- What future capabilities should be added

**Overall Assessment:** The V6 architecture is well-designed with strong foundations, but has several gaps that need addressing for production readiness across ALL workflow patterns.

---

## 1. IR Schema Coverage Analysis

### File: `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts`

### ✅ Confirmed Supported Patterns

#### Data Sources (Lines 36-79)
- ✅ Tabular sources (Google Sheets, Airtable, Excel, Notion)
- ✅ API sources (Gmail, REST APIs, Slack)
- ✅ Webhook sources (schema defined)
- ✅ Database sources (schema defined)
- ✅ File sources (schema defined)
- ✅ Stream sources (schema defined)

**Coverage:** 6 data source types defined

#### Filter Operations (Lines 108-202)
- ✅ Simple conditions with AND/OR logic
- ✅ Complex nested groups (e.g., (A AND B) OR (C AND D))
- ✅ 11 operators: equals, not_equals, contains, greater_than, less_than, in, is_empty, is_not_empty, within_last_days, before, after
- ✅ Field-based filtering
- ✅ Grouped conditions with combineWith

**Coverage:** Comprehensive filtering with nested logic

#### AI Operations (Lines 208-269)
- ✅ 6 operation types: summarize, extract, classify, sentiment, generate, decide
- ✅ Output schema specification (string, object, array, number, boolean)
- ✅ Constraints (max_tokens, temperature, model_preference)
- ✅ Context specification

**Coverage:** Solid AI operation foundation

#### Control Flow
- ✅ Partitioning by field value or condition (Lines 275-300)
- ✅ Grouping with emit_per_group (Lines 302-315)
- ❌ NO explicit loops (compiler infers from delivery_rules)
- ❌ NO conditionals/branching (missing from declarative schema)

#### Delivery Patterns (Lines 351-417)
- ✅ Per-item delivery
- ✅ Per-group delivery
- ✅ Summary delivery
- ✅ send_when_no_results flag
- ✅ Plugin-agnostic (plugin_key + operation_type)

**Coverage:** 3 delivery patterns, extensible to any plugin

#### Edge Cases (Lines 424-459)
- ✅ 9 error conditions defined
- ✅ 5 error actions defined
- ✅ Recipient/message specification

**Coverage:** Basic error handling covered

### ❌ Missing from Schema

#### 1. Conditional Branching (CRITICAL GAP)
**Problem:** No way to express if/then/else logic in declarative IR

**Current State:**
- Extended IR has conditionals (v2.0 schema)
- Declarative IR (v3.0) does NOT have conditionals

**Impact:** Cannot express workflows like:
```
If high-value lead → Alert sales manager immediately
Else → Add to weekly digest
```

**Recommendation:** Add to declarative schema:
```typescript
conditionals?: {
  when: Condition
  then_delivery?: DeliveryRules
  else_delivery?: DeliveryRules
}[]
```

#### 2. Multi-Source Workflows
**Problem:** Schema only handles single data source well

**Current State:**
```typescript
data_sources: DataSource[]  // Array exists but...
```

**Compiler Reality:**
```typescript
const dataSource = ir.data_sources[0]  // Only uses first!
```

**Impact:** Cannot express:
- Join data from Google Sheets + Airtable
- Merge Gmail + Slack messages
- Cross-reference multiple databases

**Recommendation:** Add merge/join configuration:
```typescript
data_merge?: {
  strategy: 'union' | 'join' | 'merge'
  join_keys?: Record<string, string>
}
```

#### 3. Transformations (Data Manipulation)
**Problem:** No explicit transforms in declarative schema

**Current State:**
- Extended IR has transforms (map, filter, reduce, sort, group, etc.)
- Declarative IR relies on compiler auto-injection

**Impact:** Cannot express:
- Custom field mapping
- Data enrichment
- Format conversions
- Deduplication

**Recommendation:** Add optional transforms:
```typescript
transforms?: {
  type: 'map' | 'deduplicate' | 'sort' | 'enrich'
  config: Record<string, any>
}[]
```

#### 4. Retry Logic & Rate Limiting
**Problem:** No way to specify retry behavior or rate limits

**Current State:**
- Edge cases have "retry" action but no configuration
- No rate limiting specified

**Impact:** Cannot express:
- "Retry API call 3 times with exponential backoff"
- "Rate limit to 10 calls per second"
- "Timeout after 30 seconds"

**Recommendation:** Add execution constraints:
```typescript
execution_constraints?: {
  retry?: {
    max_attempts: number
    backoff_strategy: 'fixed' | 'exponential'
    initial_delay_ms: number
  }
  rate_limit?: {
    max_per_second: number
    max_per_minute: number
  }
  timeout_ms?: number
}
```

#### 5. Chained/Sequential AI Operations
**Problem:** ai_operations is flat array, no sequencing

**Current State:**
```typescript
ai_operations?: AIOperation[]  // No ordering guarantee
```

**Impact:** Cannot express:
- "First extract data, THEN classify it, THEN summarize"
- Dependencies between AI operations
- Multi-stage AI pipelines

**Recommendation:** Add stage concept:
```typescript
ai_operations?: {
  stage: number
  depends_on?: string[]  // IDs of previous AI operations
  ...AIOperation
}[]
```

#### 6. Webhook Triggers
**Problem:** Webhook defined as data source type, but no trigger configuration

**Current State:**
```typescript
type: 'webhook'
trigger?: string  // Just a string, no structure
```

**Impact:** Cannot express:
- What webhook event to listen for
- Webhook validation/security
- Payload parsing rules

**Recommendation:** Enhance webhook configuration:
```typescript
webhook_config?: {
  event_type: string
  validation: {
    secret?: string
    signature_header?: string
  }
  payload_schema: OutputSchema
}
```

#### 7. Scheduled Execution
**Problem:** No way to specify when workflow should run

**Current State:** Not in schema at all

**Impact:** Cannot express:
- "Run every Monday at 9am"
- "Run daily at midnight"
- "Run when data changes"

**Recommendation:** Add scheduling:
```typescript
schedule?: {
  type: 'cron' | 'interval' | 'event'
  cron_expression?: string
  interval_minutes?: number
  trigger_event?: string
}
```

#### 8. Data Validation Rules
**Problem:** Only normalization for headers, no data validation

**Current State:**
```typescript
normalization?: {
  required_headers: string[]
  case_sensitive: boolean
  missing_header_action: 'error' | 'warn' | 'ignore'
}
```

**Impact:** Cannot validate:
- Email format is valid
- Numbers are within range
- Required fields are not empty
- Data types are correct

**Recommendation:** Add validation rules:
```typescript
validation_rules?: {
  field: string
  type: 'email' | 'url' | 'phone' | 'date' | 'number' | 'regex'
  pattern?: string
  min?: number
  max?: number
  required?: boolean
  action: 'error' | 'warn' | 'skip_row' | 'use_default'
  default_value?: any
}[]
```

#### 9. Database Operations
**Problem:** Database defined as source type but no write operations

**Current State:**
```typescript
type: 'database'
// No write configuration
```

**Impact:** Cannot express:
- Write results back to database
- Update records
- Delete records
- Upsert operations

**Recommendation:** Add database operations to delivery:
```typescript
database_delivery?: {
  table: string
  operation: 'insert' | 'update' | 'upsert' | 'delete'
  key_fields?: string[]
  plugin_key?: string
}
```

#### 10. File Operations
**Problem:** File source defined but no file write operations

**Current State:**
```typescript
type: 'file'
// No write configuration
```

**Impact:** Cannot express:
- Save results to CSV
- Generate PDF report
- Write to Google Drive
- Upload to S3

**Recommendation:** Add file delivery:
```typescript
file_delivery?: {
  format: 'csv' | 'json' | 'pdf' | 'xlsx'
  destination: string
  plugin_key?: string
  operation_type?: string
}
```

---

## 2. Compiler Coverage Analysis

### File: `lib/agentkit/v6/compiler/DeclarativeCompiler.ts`

### ✅ Confirmed Implemented Patterns

1. **Data Source Compilation** (Lines 120-213)
   - ✅ Tabular sources with plugin resolution
   - ✅ API sources with plugin resolution
   - ✅ Header normalization
   - ✅ Config building from parameter schemas

2. **Filter Compilation** (Lines 219-296)
   - ✅ AND logic (sequential filters)
   - ✅ OR logic (single filter with multiple conditions)
   - ✅ Nested groups

3. **Delivery Pattern Compilation** (Lines 302-659)
   - ✅ Per-group delivery with partition + group + loop
   - ✅ Per-item delivery with loop
   - ✅ Summary delivery with optional AI operations
   - ✅ Auto-injection of PDF extraction (Lines 526-541)
   - ✅ Flatten transform after AI extraction (Lines 562-576)

4. **AI Operation Compilation** (Lines 665-681)
   - ✅ AI operation config generation
   - ✅ Output schema mapping
   - ✅ Constraints configuration

### ❌ Compiler Gaps

#### 1. Database & File Sources Not Compiled
**Location:** Lines 120-213 only handle tabular and api

**Problem:**
```typescript
if (dataSource.type === 'tabular') { ... }
else if (dataSource.type === 'api') { ... }
// ❌ No handling for database, file, stream, webhook
```

**Impact:** Will fail on workflows using:
- PostgreSQL/MySQL data sources
- CSV file uploads
- Real-time streams
- Webhook triggers

**Recommendation:** Add compilation branches for all 6 source types

#### 2. Conditional Branching Not Compiled
**Problem:** Compiler has no logic for conditionals (because schema doesn't have them)

**Impact:** Cannot compile if/then/else workflows

**Recommendation:** 
1. Add conditionals to declarative schema first
2. Then add compilation logic:
```typescript
if (ir.conditionals) {
  steps.push(this.compileConditionals(ir, ctx))
}
```

#### 3. Normalization Ignored for API Sources
**Location:** Lines 161-174 only apply to tabular

**Problem:**
```typescript
if (ir.normalization?.required_headers) {
  // Only runs in tabular branch
}
```

**Impact:** API responses can't be normalized/validated

**Recommendation:** Move normalization to separate step after data fetch

#### 4. No Multi-Source Merge Compilation
**Problem:** Only uses first data source

**Location:** Line 121
```typescript
const dataSource = ir.data_sources[0]  // ❌ Ignores rest!
```

**Impact:** Cannot compile workflows with multiple data sources

**Recommendation:** Add multi-source handling:
```typescript
ir.data_sources.forEach((ds, idx) => {
  const steps = this.compileDataSource(ds, ctx, idx)
  allSteps.push(...steps)
})
if (ir.data_sources.length > 1 && ir.data_merge) {
  allSteps.push(this.compileMerge(ir.data_merge, ctx))
}
```

#### 5. Partitions Only Used in Per-Group Delivery
**Location:** Lines 337-354

**Problem:** Partitions ignored in other delivery patterns

**Impact:** Cannot partition data without per-group delivery

**Recommendation:** Move partitioning to separate compilation phase

#### 6. No Transform Compilation
**Problem:** Compiler relies on auto-injection only

**Impact:** Cannot compile explicit transforms specified by user

**Recommendation:** Add transform compilation:
```typescript
if (ir.transforms) {
  steps.push(...this.compileTransforms(ir, ctx))
}
```

#### 7. Rendering Hardcoded to Specific Types
**Location:** Lines 376-391, 612-627

**Problem:**
```typescript
operation: 'render_table'  // Hardcoded!
rendering_type: ir.rendering.type
```

**Impact:** Cannot support custom rendering engines

**Recommendation:** Make rendering more flexible with plugin-based renderers

#### 8. Edge Cases Not Compiled
**Problem:** Edge cases validated but not compiled into executable steps

**Location:** Edge cases exist in schema (Lines 424-459) but not compiled

**Impact:** Error handling specified in IR won't execute

**Recommendation:** Add edge case compilation:
```typescript
if (ir.edge_cases) {
  steps.push(...this.compileEdgeCases(ir, ctx))
}
```

#### 9. Plugin Config Building is Simplistic
**Location:** Lines 710-742

**Problem:**
```typescript
private buildConfigFromSchema(...): Record<string, any> {
  // Very basic mapping
  if (paramName === 'query') config[paramName] = ''
  if (paramName === 'max_results') config[paramName] = 100
  // Not comprehensive
}
```

**Impact:** Many plugin parameters won't be set correctly

**Recommendation:** Enhance config builder with:
- Schema introspection
- Type coercion
- Required vs optional handling
- Nested object support

#### 10. No Validation of Compiled Steps
**Problem:** Compiler doesn't validate generated PILOT DSL

**Impact:** May generate invalid workflows that fail at execution

**Recommendation:** Add post-compilation validation:
```typescript
const compiledSteps = [...steps]
const validation = validatePILOTDSL(compiledSteps)
if (!validation.valid) {
  return { success: false, errors: validation.errors }
}
```

---

## 3. Plugin Resolution Coverage Analysis

### File: `lib/agentkit/v6/compiler/utils/PluginResolver.ts`

### ✅ Confirmed Supported Operations

1. **Data Source Resolution** (Lines 43-65, 128-152)
   - ✅ Tabular data sources (Google Sheets, Airtable, Excel, Notion)
   - ✅ Generic data source resolution by operation type
   - ✅ read, search, list, fetch operations

2. **Delivery Resolution** (Lines 69-94, 98-122)
   - ✅ Generic delivery resolution by plugin_key and operation_type
   - ✅ Email delivery (google-mail, outlook-mail)
   - ✅ send, post, publish operations

3. **Specific Integrations** (Lines 155-195)
   - ✅ Slack message delivery
   - ✅ Webhook/HTTP delivery
   - ✅ Database delivery (operation specified)

4. **Plugin Introspection** (Lines 334-388)
   - ✅ Find operations by type (read, search, send, etc.)
   - ✅ Keyword matching
   - ✅ Fallback to operation type

### ❌ Plugin Resolution Gaps

#### 1. Limited Operation Type Coverage
**Problem:** Only handles 7 operation types

**Current State:**
```typescript
type: 'read' | 'search' | 'list' | 'fetch' | 'send' | 'post' | 'publish'
```

**Missing Operations:**
- write, update, delete (database)
- upload, download (files)
- subscribe, unsubscribe (webhooks)
- invoke, call (functions)

**Impact:** Cannot resolve plugins for write operations

**Recommendation:** Expand operation types:
```typescript
type OperationType =
  | 'read' | 'search' | 'list' | 'fetch'      // Read operations
  | 'write' | 'update' | 'delete' | 'upsert'  // Write operations
  | 'send' | 'post' | 'publish'               // Delivery operations
  | 'upload' | 'download'                     // File operations
  | 'subscribe' | 'unsubscribe'               // Event operations
  | 'invoke' | 'call' | 'execute'             // Function operations
```

#### 2. No Parameter Validation
**Problem:** PluginResolver returns parameter schemas but doesn't validate them

**Location:** Lines 146-150
```typescript
return {
  plugin_name: pluginName,
  operation,
  action_def: actionDef,
  parameters_schema: actionDef?.parameters,  // ❌ Not validated
  output_schema: actionDef?.output_schema
}
```

**Impact:** Invalid parameters passed to plugins will fail at runtime

**Recommendation:** Add parameter validation:
```typescript
validateParameters(config: any, schema: any): ValidationResult {
  // Validate config against parameter schema
  // Check required fields, types, constraints
}
```

#### 3. No Plugin Capability Discovery
**Problem:** Can't check if plugin supports required operations

**Impact:** May try to use plugin that doesn't have needed capability

**Recommendation:** Add capability checking:
```typescript
supportsOperation(pluginName: string, operation: string): boolean {
  const plugin = this.availablePlugins[pluginName]
  return plugin?.actions[operation] !== undefined
}

listCapabilities(pluginName: string): string[] {
  return Object.keys(this.availablePlugins[pluginName]?.actions || {})
}
```

#### 4. No Plugin Version Handling
**Problem:** No way to specify or check plugin versions

**Impact:** Breaking changes in plugins will cause failures

**Recommendation:** Add version awareness:
```typescript
interface PluginResolution {
  plugin_name: string
  plugin_version: string  // ← Add this
  operation: string
  ...
}
```

#### 5. Database Plugin Resolution Incomplete
**Location:** Lines 189-195

**Problem:**
```typescript
resolveDatabaseDelivery(operation: string = 'insert'): PluginResolution {
  return {
    plugin_name: 'database',  // ❌ Hardcoded! Which database?
    operation
  }
}
```

**Impact:** Cannot distinguish between PostgreSQL, MySQL, MongoDB, etc.

**Recommendation:** Add database type parameter:
```typescript
resolveDatabaseDelivery(
  databaseType: 'postgres' | 'mysql' | 'mongodb' | 'sqlite',
  operation: string
): PluginResolution
```

#### 6. No Fallback Plugin Strategy
**Problem:** If plugin not found, returns fallback name without warning

**Location:** Lines 234-240, 344
```typescript
if (!plugin) {
  console.warn(`[PluginResolver] Plugin not found: ${pluginName}, using fallback`)
  return 'read'  // ❌ Silent failure!
}
```

**Impact:** Workflow will fail at execution but compile succeeds

**Recommendation:** Add strict mode:
```typescript
constructor(pluginManager?: PluginManagerV2, strict: boolean = true) {
  this.strict = strict
}

// In resolution methods:
if (!plugin && this.strict) {
  throw new Error(`Plugin not found: ${pluginName}`)
}
```

#### 7. Limited Plugin Source Mapping
**Location:** Lines 691-704

**Problem:** Only 7 source mappings defined

```typescript
const mapping: Record<string, string> = {
  gmail: 'google-mail',
  outlook: 'outlook-mail',
  google_sheets: 'google-sheets',
  airtable: 'airtable',
  slack: 'slack',
  notion: 'notion',
  hubspot: 'hubspot'
  // ❌ Missing: Salesforce, Stripe, Shopify, etc.
}
```

**Impact:** New plugins require code changes

**Recommendation:** Make mapping configurable:
```typescript
private pluginAliases: Record<string, string> = {...}

addPluginAlias(alias: string, pluginKey: string) {
  this.pluginAliases[alias] = pluginKey
}
```

---

## 4. Future Scenarios Analysis

### Streaming Data Sources

**Use Case:** Real-time monitoring, live dashboards, event processing

**Current Support:** ❌ None
- Schema has `type: 'stream'` but no configuration
- Compiler doesn't handle streams
- PluginResolver doesn't resolve stream operations

**Requirements:**
```typescript
data_sources: [{
  type: 'stream',
  source: 'kafka' | 'kinesis' | 'pubsub' | 'websocket',
  stream_config: {
    topic?: string,
    partition?: string,
    offset?: string,
    batch_size?: number,
    window_size_seconds?: number
  }
}]
```

**Compilation Challenges:**
- Streams are infinite - no "done" state
- Need window/batch processing
- Need backpressure handling
- Need stream aggregation

**Recommendation:** Add stream processing support as Phase 2 feature

---

### Webhook Triggers (Inbound)

**Use Case:** Event-driven workflows, API integrations, form submissions

**Current Support:** ❌ Partial
- Schema has `type: 'webhook'` but minimal config
- No webhook registration/security
- No payload validation

**Requirements:**
```typescript
data_sources: [{
  type: 'webhook',
  webhook_config: {
    path: string,
    method: 'POST' | 'GET' | 'PUT',
    authentication: {
      type: 'signature' | 'token' | 'basic',
      secret?: string,
      header_name?: string
    },
    payload_schema: OutputSchema,
    response_template?: string
  }
}]
```

**Compilation Challenges:**
- Need to register webhook endpoint
- Validate incoming payload
- Handle webhook retries
- Send appropriate response

**Recommendation:** Priority feature for production readiness

---

### Database Sources (Read/Write)

**Use Case:** Sync data between databases, ETL workflows, backup/restore

**Current Support:** ❌ Partial
- Schema has `type: 'database'` but no operations
- PluginResolver has hardcoded 'database' plugin
- No actual database plugin integration

**Requirements:**
```typescript
// Read
data_sources: [{
  type: 'database',
  plugin_key: 'postgres' | 'mysql' | 'mongodb' | 'supabase',
  operation_type: 'query' | 'read_table' | 'execute',
  database_config: {
    table?: string,
    query?: string,
    limit?: number,
    offset?: number
  }
}]

// Write
delivery_rules: {
  database_delivery: {
    plugin_key: 'postgres',
    operation_type: 'insert' | 'update' | 'upsert' | 'delete',
    table: string,
    key_fields?: string[],
    conflict_strategy?: 'replace' | 'skip' | 'error'
  }
}
```

**Compilation Challenges:**
- Connection pooling
- Transaction handling
- Error recovery
- Schema validation

**Recommendation:** Critical for enterprise adoption

---

### Complex Nested Conditionals

**Use Case:** Multi-stage decision trees, complex business logic

**Current Support:** ❌ None in declarative IR
- Extended IR has simple conditionals
- Declarative IR has none
- No nested conditional support

**Requirements:**
```typescript
conditionals: [{
  type: 'if_then_else',
  condition: {
    and: [
      { field: 'amount', operator: 'greater_than', value: 1000 },
      {
        or: [
          { field: 'status', operator: 'equals', value: 'urgent' },
          { field: 'priority', operator: 'equals', value: 'high' }
        ]
      }
    ]
  },
  then: {
    delivery_rules: { /* immediate alert */ }
  },
  else: {
    conditionals: [{  // Nested!
      condition: { /* another check */ },
      then: { /* ... */ },
      else: { /* ... */ }
    }]
  }
}]
```

**Compilation Challenges:**
- Nested condition compilation
- Variable scoping in branches
- Merging results from branches
- Dead code elimination

**Recommendation:** Add as advanced feature with clear examples

---

### Multi-Stage AI Operations

**Use Case:** Extract → Classify → Summarize pipelines, complex AI workflows

**Current Support:** ❌ Partial
- Can define multiple AI operations
- No ordering guarantee
- No dependency specification
- Results from stage 1 don't flow to stage 2

**Requirements:**
```typescript
ai_operations: [{
  stage: 1,
  type: 'extract',
  instruction: 'Extract data from PDF',
  output_variable: 'extracted_data'
}, {
  stage: 2,
  depends_on: ['extracted_data'],
  type: 'classify',
  instruction: 'Classify each item by category',
  input_source: '{{extracted_data}}',
  output_variable: 'classified_data'
}, {
  stage: 3,
  depends_on: ['classified_data'],
  type: 'summarize',
  instruction: 'Summarize by category',
  input_source: '{{classified_data}}',
  output_variable: 'summary'
}]
```

**Compilation Challenges:**
- Topological sorting of AI operations
- Variable flow between stages
- Error handling in pipeline
- Cost estimation (multiple AI calls)

**Recommendation:** High-value feature for complex workflows

---

### Custom Transformations

**Use Case:** Data enrichment, format conversion, custom business logic

**Current Support:** ❌ Limited to auto-injection
- Compiler auto-injects some transforms (PDF extraction, flatten)
- No user-specified transforms in declarative IR

**Requirements:**
```typescript
transforms: [{
  type: 'map',
  description: 'Calculate total price',
  mapping: {
    total: '{{item.quantity}} * {{item.unit_price}}'
  }
}, {
  type: 'enrich',
  description: 'Add customer details',
  lookup: {
    source: 'customer_db',
    key: 'customer_id',
    fields: ['name', 'email', 'tier']
  }
}, {
  type: 'deduplicate',
  description: 'Remove duplicate emails',
  key_fields: ['email']
}]
```

**Compilation Challenges:**
- Expression parsing for calculations
- Lookup table joins
- Custom function execution
- Performance for large datasets

**Recommendation:** Essential for production workflows

---

### Retry Logic and Error Handling

**Use Case:** API rate limits, transient failures, network issues

**Current Support:** ❌ Partial
- Edge cases define "retry" action
- No retry configuration (attempts, backoff, etc.)
- No circuit breaker pattern

**Requirements:**
```typescript
execution_constraints: {
  retry: {
    max_attempts: 3,
    backoff_strategy: 'exponential',
    initial_delay_ms: 1000,
    max_delay_ms: 30000,
    retry_on: ['rate_limit', 'timeout', 'network_error'],
    do_not_retry_on: ['auth_error', 'invalid_input']
  },
  timeout_ms: 300000,
  circuit_breaker: {
    failure_threshold: 5,
    reset_timeout_ms: 60000
  }
}
```

**Compilation Challenges:**
- Retry wrapper generation
- Exponential backoff calculation
- Circuit breaker state management
- Error classification

**Recommendation:** Critical for production reliability

---

### Rate Limiting

**Use Case:** API quota management, cost control, fair usage

**Current Support:** ❌ None

**Requirements:**
```typescript
execution_constraints: {
  rate_limit: {
    max_per_second: 10,
    max_per_minute: 100,
    max_per_hour: 1000,
    burst_size: 20,
    strategy: 'token_bucket' | 'sliding_window'
  }
}
```

**Compilation Challenges:**
- Rate limiter injection
- Distributed rate limiting
- Per-plugin rate limits
- Cost estimation

**Recommendation:** Important for API-heavy workflows

---

### Parallel Execution Constraints

**Use Case:** Control concurrency, resource management

**Current Support:** ❌ Partial
- Scatter-gather has max_concurrency in extended IR
- Not in declarative IR
- No global concurrency control

**Requirements:**
```typescript
execution_constraints: {
  max_concurrent_steps: 10,
  max_concurrent_ai_operations: 3,
  max_concurrent_api_calls: 5,
  resource_limits: {
    max_memory_mb: 512,
    max_execution_time_ms: 300000
  }
}
```

**Compilation Challenges:**
- Concurrency pool management
- Resource tracking
- Deadlock prevention
- Priority queue

**Recommendation:** Important for scalability

---

### File Upload/Download Operations

**Use Case:** Report generation, data export, file processing

**Current Support:** ❌ None
- Schema has `type: 'file'` but no operations
- No file delivery defined

**Requirements:**
```typescript
// Upload
delivery_rules: {
  file_delivery: {
    format: 'csv' | 'pdf' | 'xlsx' | 'json',
    destination: {
      plugin_key: 'google-drive' | 's3' | 'dropbox',
      path: string,
      filename_template: string
    },
    options: {
      overwrite?: boolean,
      public?: boolean
    }
  }
}

// Download
data_sources: [{
  type: 'file',
  plugin_key: 'google-drive',
  operation_type: 'download',
  file_config: {
    file_id?: string,
    path?: string,
    format?: string
  }
}]
```

**Compilation Challenges:**
- File format conversion
- Large file handling
- Streaming uploads
- Temporary storage

**Recommendation:** Essential for reporting workflows

---

### Scheduled/Recurring Workflows

**Use Case:** Daily reports, weekly summaries, automated backups

**Current Support:** ❌ None
- No scheduling in IR schema
- Workflows are one-shot only

**Requirements:**
```typescript
schedule: {
  type: 'cron' | 'interval' | 'event',
  cron_expression?: string,  // '0 9 * * MON'
  interval_minutes?: number,
  timezone?: string,
  enabled: boolean,
  start_date?: string,
  end_date?: string
}
```

**Compilation Challenges:**
- Cron expression parsing
- Timezone handling
- Schedule storage
- Trigger management

**Recommendation:** High-value feature for automation

---

### Multi-Tenant Data Isolation

**Use Case:** SaaS applications, customer data separation

**Current Support:** ❌ None
- No tenant context in IR
- No data isolation

**Requirements:**
```typescript
context: {
  tenant_id: string,
  user_id: string,
  permissions: string[]
}

data_sources: [{
  type: 'database',
  tenant_isolated: true,  // Auto-filter by tenant_id
  ...
}]
```

**Compilation Challenges:**
- Automatic filter injection
- Permission checking
- Cross-tenant prevention
- Audit logging

**Recommendation:** Critical for SaaS deployment

---

## 5. Gap Summary

### Critical Gaps (Block Production Use)

1. ❌ **Conditional Branching** - Cannot express if/then/else logic
2. ❌ **Database Read/Write** - Cannot integrate with databases
3. ❌ **Error Handling & Retry** - No robust error recovery
4. ❌ **File Operations** - Cannot generate/upload files
5. ❌ **Webhook Triggers** - Cannot respond to events

### High-Priority Gaps (Limit Use Cases)

6. ❌ **Multi-Source Workflows** - Cannot merge data sources
7. ❌ **Custom Transformations** - Limited data manipulation
8. ❌ **Multi-Stage AI** - Cannot chain AI operations
9. ❌ **Rate Limiting** - No API quota management
10. ❌ **Scheduled Execution** - No recurring workflows

### Medium-Priority Gaps (Nice to Have)

11. ❌ **Stream Processing** - No real-time data support
12. ❌ **Advanced Validation** - Limited data quality checks
13. ❌ **Parallel Constraints** - No concurrency control
14. ❌ **Plugin Versioning** - No version management
15. ❌ **Multi-Tenant** - No data isolation

---

## 6. Recommendations

### Phase 1: Production Essentials (4-6 weeks)

**Goal:** Make V6 production-ready for basic workflows

1. **Add Conditional Branching to Schema** (1 week)
   - Update declarative-ir-schema-strict.ts
   - Add compiler support
   - Add tests

2. **Implement Database Integration** (2 weeks)
   - Add database read/write to schema
   - Implement database plugin resolver
   - Add compilation logic
   - Test with Postgres, MySQL

3. **Add Retry & Error Handling** (1 week)
   - Add execution_constraints to schema
   - Compile retry wrappers
   - Add circuit breaker support

4. **Implement File Operations** (1 week)
   - Add file delivery to schema
   - Integrate with Google Drive, S3
   - Test upload/download

5. **Add Webhook Support** (1 week)
   - Enhance webhook configuration
   - Add webhook registration
   - Add payload validation

### Phase 2: Advanced Features (6-8 weeks)

**Goal:** Support complex workflows and scaling

6. **Multi-Source Merge** (2 weeks)
7. **Custom Transformations** (2 weeks)
8. **Multi-Stage AI Pipelines** (2 weeks)
9. **Rate Limiting** (1 week)
10. **Scheduled Execution** (1 week)

### Phase 3: Enterprise Features (8-10 weeks)

**Goal:** Enable enterprise deployment

11. **Stream Processing** (3 weeks)
12. **Advanced Validation** (2 weeks)
13. **Concurrency Control** (2 weeks)
14. **Plugin Versioning** (1 week)
15. **Multi-Tenant Support** (2 weeks)

---

## 7. Confirmed Supported Scenarios (Production Ready)

### ✅ Works Great Today

1. **Tabular Data → Filter → Email**
   - Google Sheets, Airtable, Excel
   - Multi-filter pipelines (AND/OR)
   - Per-item, per-group, or summary delivery
   - **Status:** ✅ Production Ready

2. **Gmail → AI Extraction → Summary Email**
   - API data source (Gmail, Outlook)
   - Scatter-gather with AI operations
   - PDF extraction auto-injection
   - Flatten/aggregate results
   - **Status:** ✅ Production Ready

3. **Tabular → Partition → Group → Deliver**
   - Partition by field
   - Group by field
   - Per-group delivery with table rendering
   - **Status:** ✅ Production Ready

4. **API → Multi-Filter → Summary**
   - Complex filter conditions
   - Nested groups (AND/OR)
   - Summary delivery
   - **Status:** ✅ Production Ready

5. **AI Operations (Single Stage)**
   - Extract, classify, summarize, sentiment, generate, decide
   - Structured output schemas
   - Constraints (max_tokens, temperature, model)
   - **Status:** ✅ Production Ready

### ✅ Supported Data Sources

- Google Sheets (read)
- Airtable (read)
- Gmail (read)
- Outlook (read)
- Slack (read)
- Notion (read)
- HubSpot (read)
- Any REST API (with plugin)

### ✅ Supported Delivery Methods

- Email (Gmail, Outlook, SendGrid)
- Slack messages
- Any plugin with send/post/publish operation

---

## 8. Scenarios That Will Fail

### ❌ Guaranteed to Fail

1. **If/Then/Else Logic**
   - No conditionals in declarative schema
   - Compiler doesn't support branching

2. **Database Write Operations**
   - No database delivery defined
   - PluginResolver returns hardcoded 'database'

3. **Multi-Source Joins**
   - Compiler only uses first data source
   - No merge/join logic

4. **Webhook-Triggered Workflows**
   - No webhook registration
   - No payload validation

5. **File Generation/Upload**
   - No file delivery configured
   - No file format conversion

6. **Streaming Data**
   - No stream processing logic
   - No window/batch support

7. **Chained AI Operations**
   - No dependency tracking
   - Results don't flow between stages

8. **Retry on Failure**
   - Edge cases defined but not compiled
   - No retry wrapper generation

9. **Rate Limited API Calls**
   - No rate limiter
   - Will hit quota limits

10. **Scheduled Recurring Runs**
    - No schedule support
    - One-shot execution only

---

## 9. Testing Recommendations

### Unit Tests Needed

1. **Schema Validation Tests**
   - Test all edge cases in declarative-ir-schema-strict.ts
   - Verify forbidden token detection
   - Test required field validation

2. **Compiler Tests**
   - Test each delivery pattern
   - Test filter compilation (AND/OR/nested)
   - Test AI operation compilation
   - Test auto-injection logic

3. **Plugin Resolution Tests**
   - Test all operation types
   - Test fallback behavior
   - Test parameter schema mapping

### Integration Tests Needed

1. **End-to-End Workflow Tests**
   - Test complete IR → Compiler → Execution flow
   - Test with real plugins (mocked OAuth)
   - Test error scenarios

2. **Performance Tests**
   - Test with large datasets (1000+ rows)
   - Test scatter-gather concurrency
   - Test AI operation batching

### Stress Tests Needed

1. **Load Tests**
   - 100 concurrent workflows
   - 10,000 row datasets
   - API rate limit scenarios

---

## 10. Documentation Gaps

### Missing Documentation

1. **IR Schema Reference**
   - Field-by-field documentation
   - Examples for each pattern
   - Validation rules explanation

2. **Compiler Architecture**
   - How loop inference works
   - Auto-injection rules
   - Variable flow management

3. **Plugin Development Guide**
   - How to add new plugin
   - Parameter schema format
   - Output schema format

4. **Best Practices**
   - When to use per-item vs per-group vs summary
   - How to structure complex filters
   - AI operation design patterns

5. **Troubleshooting Guide**
   - Common compilation errors
   - How to debug workflows
   - Performance optimization tips

---

## Conclusion

The V6 Pure Declarative Architecture has a **solid foundation** with excellent support for:
- Tabular data workflows
- API-based workflows with AI operations
- Complex filtering and grouping
- Flexible delivery patterns

However, to be production-ready for **ALL** workflow patterns, it needs:

**Critical Additions:**
1. Conditional branching
2. Database integration
3. Error handling & retry
4. File operations
5. Webhook triggers

**High-Value Additions:**
6. Multi-source workflows
7. Custom transformations
8. Multi-stage AI pipelines
9. Rate limiting
10. Scheduled execution

**Current Recommendation:** 
- ✅ **Deploy for supported scenarios** (tabular + API + AI extraction)
- ❌ **Do not deploy for unsupported scenarios** (database, conditionals, files, webhooks)
- 🎯 **Prioritize Phase 1 features** for broader production readiness

---

**Assessment Date:** 2025-12-25
**Reviewer:** V6 Architecture Analysis
**Next Review:** After Phase 1 implementation
**Status:** COMPREHENSIVE GAPS IDENTIFIED - ACTION REQUIRED
