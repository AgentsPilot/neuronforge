# OpenAI Strict Schema Fix - DataSource.source Field

## Error Message

```
400 Invalid schema for response_format 'extended_logical_ir':
In context=('properties', 'data_sources', 'items'), 'required' is required to be supplied
and to be an array including every key in properties. Missing 'source'.
```

## Root Cause

OpenAI's **strict JSON schema mode** has a specific requirement:

> **All properties defined in a schema MUST be listed in the `required` array**

In our schema, we had:
- `source` field defined in `properties`
- `source` NOT in the `required` array

This violated OpenAI's strict mode requirement.

## Fix Applied

### 1. Updated JSON Schema (extended-ir-schema.ts)

**File:** `lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts:39`

```typescript
// Before
required: ['id', 'type', 'location'],

// After
required: ['id', 'type', 'location', 'source'],
```

### 2. Updated TypeScript Types (extended-ir-types.ts)

**File:** `lib/agentkit/v6/logical-ir/schemas/extended-ir-types.ts:55`

```typescript
// Before
export interface DataSource {
  id: string
  type: DataSourceType
  source?: string  // Optional
  location: string
  ...
}

// After
export interface DataSource {
  id: string
  type: DataSourceType
  source: string   // Required
  location: string
  ...
}
```

### 3. Updated Test Files

**File:** `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts`

Added `source: 'googlesheets'` to all DataSource test objects.

## Why `source` Should Be Required

The `source` field specifies which plugin to use for data access:

- `'googlesheets'` → Google Sheets plugin
- `'rest_api'` → REST API plugin
- `'webhook'` → Webhook handler
- `'database'` → Database connector

**This is critical information for the compiler** - it can't compile a data source step without knowing which plugin to use.

Making it required ensures:
1. The LLM always specifies the plugin
2. The compiler has all necessary information
3. No ambiguity in data source resolution

## OpenAI Strict Mode Rules

For future reference, OpenAI's strict JSON schema mode requires:

1. **All properties must be in `required` array**
   - Even if logically optional, they must be in the array
   - Alternative: Remove from properties entirely if truly optional

2. **No `additionalProperties: true`**
   - Must explicitly set `additionalProperties: false`

3. **All objects with properties MUST have `required` array**
   - Even if it's an empty array: `required: []`

4. **Recursive definitions must be bounded**
   - We handle this with explicit nesting levels (L1-L5)

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
      "tab": "Leads"
    }],
    ...
  }
}
```

## Impact

### ✅ What Works Now

- OpenAI API calls with structured outputs ✅
- IR generation succeeds ✅
- Schema validation passes ✅
- All test files updated ✅

### ⚠️ Breaking Change

This is technically a **breaking change** if you had existing code that created DataSource objects without `source`.

**Migration:**
```typescript
// Before (now invalid)
const ds: DataSource = {
  id: 'data',
  type: 'tabular',
  location: 'MySheet'
}

// After (valid)
const ds: DataSource = {
  id: 'data',
  type: 'tabular',
  source: 'googlesheets',
  location: 'MySheet'
}
```

## Files Modified

1. `lib/agentkit/v6/logical-ir/schemas/extended-ir-schema.ts` - Added 'source' to required array
2. `lib/agentkit/v6/logical-ir/schemas/extended-ir-types.ts` - Made source required (removed ?)
3. `lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts` - Added source to test objects

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

**Error:** OpenAI strict schema validation - RESOLVED
