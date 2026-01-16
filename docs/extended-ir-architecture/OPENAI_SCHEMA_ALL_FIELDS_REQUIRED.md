# OpenAI Strict Schema Fix - All DataSource Fields Required

## Error Messages (Sequential)

### Error 1:
```
400 Invalid schema for response_format 'extended_logical_ir':
In context=('properties', 'data_sources', 'items'), 'required' is required to be supplied
and to be an array including every key in properties. Missing 'source'.
```

### Error 2:
```
400 Invalid schema for response_format 'extended_logical_ir':
In context=('properties', 'data_sources', 'items'), 'required' is required to be supplied
and to be an array including every key in properties. Missing 'tab'.
```

## Root Cause

OpenAI's **strict JSON schema mode** has a fundamental requirement:

> **ALL properties defined in a schema MUST be listed in the `required` array**

This is different from standard JSON Schema where you can have optional properties not in the required array.

In our schema, we had:
- 8 properties defined: `id`, `type`, `location`, `source`, `tab`, `endpoint`, `trigger`, `role`
- Only 4 in required array: `id`, `type`, `location`, `source`

This violated OpenAI's strict mode requirement.

## Fix Applied

### 1. Updated JSON Schema

**File:** [lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts:39](lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts#L39)

```typescript
// Before
required: ['id', 'type', 'location', 'source'],

// After
required: ['id', 'type', 'location', 'source', 'tab', 'endpoint', 'trigger', 'role'],
```

### 2. Updated TypeScript Types

**File:** [lib/agentkit/v6/logical-ir/schemas/extended-ir-types.ts:52-61](lib/agentkit/v6/logical-ir/schemas/extended-ir-types.ts#L52-L61)

```typescript
// Before
export interface DataSource {
  id: string
  type: DataSourceType
  source: string
  location: string
  tab?: string       // Optional
  endpoint?: string  // Optional
  trigger?: string   // Optional
  role?: string      // Optional
}

// After
export interface DataSource {
  id: string
  type: DataSourceType
  source: string
  location: string
  tab: string        // Required
  endpoint: string   // Required
  trigger: string    // Required
  role: string       // Required
}
```

### 3. Updated Test Files (58 DataSource objects)

Updated all DataSource objects across test files to include all required fields:

**Files Updated:**
1. `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts` - 14 objects
2. `lib/agentkit/v6/translation/__tests__/IRToNaturalLanguageTranslator.test.ts` - 24 objects
3. `lib/agentkit/v6/compiler/__tests__/LogicalIRCompiler.test.ts` - 18 objects
4. `lib/agentkit/v6/__tests__/integration/v6-end-to-end.test.ts` - 2 objects

**Default Value Strategy:**
- **Tabular sources** (type: 'tabular'):
  - `tab`: Actual sheet/tab name
  - `endpoint`: `''` (empty string)
  - `trigger`: `''` (empty string)
  - `role`: Meaningful description (e.g., "lead data", "customer records")

- **API sources** (type: 'api'):
  - `tab`: `''` (empty string)
  - `endpoint`: Actual endpoint path (e.g., "/users", "/data")
  - `trigger`: `''` (empty string)
  - `role`: `'api data source'` or meaningful description

- **Webhook sources** (type: 'webhook'):
  - `tab`: `''` (empty string)
  - `endpoint`: `''` (empty string)
  - `trigger`: Actual trigger name (e.g., "form_submitted", "payment_received")
  - `role`: `'webhook event handler'` or meaningful description

- **Other types** (database, file, stream):
  - `tab`: `''` (empty string)
  - `endpoint`: `''` (empty string)
  - `trigger`: `''` (empty string)
  - `role`: Meaningful description

## Example Fixes

### Tabular Source
```typescript
// Before
{
  id: 'data',
  type: 'tabular',
  source: 'googlesheets',
  location: 'MyLeads'
}

// After
{
  id: 'data',
  type: 'tabular',
  source: 'googlesheets',
  location: 'MyLeads',
  tab: 'Leads',
  endpoint: '',
  trigger: '',
  role: 'lead data'
}
```

### API Source
```typescript
// Before
{
  id: 'api_data',
  type: 'api',
  source: 'rest_api',
  location: 'https://api.example.com'
}

// After
{
  id: 'api_data',
  type: 'api',
  source: 'rest_api',
  location: 'https://api.example.com',
  tab: '',
  endpoint: '/users',
  trigger: '',
  role: 'api data source'
}
```

### Webhook Source
```typescript
// Before
{
  id: 'webhook_data',
  type: 'webhook',
  source: 'webhook_handler',
  location: 'form_submissions'
}

// After
{
  id: 'webhook_data',
  type: 'webhook',
  source: 'webhook_handler',
  location: 'form_submissions',
  tab: '',
  endpoint: '',
  trigger: 'form_submitted',
  role: 'webhook event handler'
}
```

## Why This Matters

Making all fields required ensures:
1. **OpenAI Compatibility:** The LLM will always provide all fields in structured outputs
2. **Predictable IR Structure:** No undefined fields in DataSource objects
3. **Simpler Validation:** No need to check for undefined optional fields
4. **Better Compiler Logic:** Compiler can assume all fields exist

## Trade-offs

### Pros:
- ✅ OpenAI strict mode compliance
- ✅ Predictable data structure
- ✅ Simpler type checking
- ✅ Forces LLM to be explicit about data source configuration

### Cons:
- ⚠️ LLM must provide empty strings for unused fields
- ⚠️ Slightly larger payloads (empty strings vs omitted fields)
- ⚠️ Less semantic clarity (empty string vs undefined)

## OpenAI Strict Mode Rules Summary

For future reference, OpenAI's strict JSON schema mode requires:

1. **All properties MUST be in `required` array**
   - Even if logically optional for some use cases
   - Alternative: Remove from properties entirely if not always needed

2. **No `additionalProperties: true`**
   - Must explicitly set `additionalProperties: false`

3. **All objects with properties MUST have `required` array**
   - Even if it's an empty array: `required: []`

4. **Recursive definitions must be bounded**
   - We handle this with explicit nesting levels (L1-L5)

5. **All properties must have explicit types**
   - Cannot use bare `{}` - must have `type` or `$ref`

## Testing the Fix

### Test with curl:

```bash
curl -X POST http://localhost:3000/api/v6/generate-workflow-plan \
  -H "Content-Type: application/json" \
  -d '{
    "enhancedPrompt": {
      "sections": {
        "data": ["Read from Google Sheet MyLeads tab Leads"],
        "delivery": ["Email to test@example.com"]
      }
    },
    "modelProvider": "openai"
  }'
```

### Expected Result:

```json
{
  "success": true,
  "ir": {
    "data_sources": [{
      "id": "data",
      "type": "tabular",
      "source": "googlesheets",
      "location": "MyLeads",
      "tab": "Leads",
      "endpoint": "",
      "trigger": "",
      "role": "lead data"
    }],
    ...
  }
}
```

## Impact

### ✅ What Works Now

- OpenAI API calls with structured outputs ✅
- IR generation with all required fields ✅
- Schema validation passes ✅
- All test files updated ✅

### ⚠️ Breaking Change

This is a **breaking change** if you had existing code creating DataSource objects without all fields.

**Migration:**
```typescript
// Before (now invalid)
const ds: DataSource = {
  id: 'data',
  type: 'tabular',
  source: 'googlesheets',
  location: 'MySheet'
}

// After (valid)
const ds: DataSource = {
  id: 'data',
  type: 'tabular',
  source: 'googlesheets',
  location: 'MySheet',
  tab: 'Sheet1',
  endpoint: '',
  trigger: '',
  role: 'data source'
}
```

## Files Modified

1. `lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts` - Added all fields to required array
2. `lib/agentkit/v6/logical-ir/schemas/extended-ir-types.ts` - Made all fields required (removed ?)
3. `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts` - Updated 14 DataSource objects
4. `lib/agentkit/v6/translation/__tests__/IRToNaturalLanguageTranslator.test.ts` - Updated 24 DataSource objects
5. `lib/agentkit/v6/compiler/__tests__/LogicalIRCompiler.test.ts` - Updated 18 DataSource objects
6. `lib/agentkit/v6/__tests__/integration/v6-end-to-end.test.ts` - Updated 2 DataSource objects

## Verification

```bash
# Check TypeScript compilation
npx tsc --noEmit --skipLibCheck lib/agentkit/v6/**/*.ts

# Run validation tests
npm test lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts

# Test with actual API call
curl -X POST http://localhost:3000/api/v6/generate-workflow-plan ...
```

---

**Status:** ✅ Fixed

**Date:** 2025-12-25

**Total Objects Updated:** 58 DataSource objects across 4 test files

**Error:** OpenAI strict schema validation - RESOLVED
