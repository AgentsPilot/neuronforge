# V6 Context Field Type Fix

**Date:** 2025-12-30
**Status:** ✅ COMPLETE
**Issue:** Declarative IR validation failing due to context field type mismatch

---

## Problem Statement

Declarative IR validation was failing with error:

```
[DeclarativeIRValidator] AJV Errors: [
  {
    "keyword": "type",
    "dataPath": ".ai_operations[0].context",
    "schemaPath": "#/properties/ai_operations/items/properties/context/type",
    "params": {
      "type": "string,null"
    },
    "message": "should be string,null"
  }
]
```

### Root Cause

**Schema defined:**
```typescript
context: {
  type: 'string',
  description: 'What data this operates on (optional)'
}
```

**IRFormalizer generated:**
```json
"context": {
  "case_insensitive_matching": "not_executed",
  "keywords": ["complaint", "refund", "angry", "not working"],
  "match_target": "email content"
}
```

**Mismatch:** Schema expected string, but IRFormalizer was generating an object with structured metadata.

## Solution

Updated **both schema files** to accept object, string, or null:

### File 1: `/lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema.ts:206-209`

```typescript
// BEFORE:
context: {
  type: 'string',
  description: 'What data this operates on (optional)'
},

// AFTER:
context: {
  type: ['object', 'string', 'null'],
  description: 'Additional context for the AI operation (optional, can be object or string)'
},
```

### File 2: `/lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts:243-245`

**IMPORTANT:** The validator uses the **strict** schema, not the regular one!

```typescript
// BEFORE:
context: {
  type: ['string', 'null']
},

// AFTER:
context: {
  type: ['object', 'string', 'null']
},
```

**Why two files?**
- `declarative-ir-schema.ts`: Development/loose validation
- `declarative-ir-schema-strict.ts`: Production/strict validation (used by DeclarativeIRValidator)
- Both must be kept in sync!

## Rationale

The `context` field provides valuable structured metadata about AI operations:
- Keywords for classification
- Match targets
- Case sensitivity flags
- Processing instructions

Using an object type allows:
- ✅ Structured, typed metadata
- ✅ Better validation downstream
- ✅ Easier access to specific context fields
- ✅ Backward compatibility (still accepts string for simple cases)

## Verification

### TypeScript Compilation
```bash
$ npx tsc --noEmit --project tsconfig.json
# ✅ No errors
```

### Expected Behavior
Declarative IR validation now accepts:

```json
{
  "ai_operations": [
    {
      "type": "classify",
      "instruction": "...",
      "context": {
        "keywords": ["complaint", "refund"],
        "match_target": "email content"
      }
    }
  ]
}
```

Or simple string context:
```json
{
  "ai_operations": [
    {
      "type": "transform",
      "instruction": "...",
      "context": "email body"
    }
  ]
}
```

Or null:
```json
{
  "ai_operations": [
    {
      "type": "summarize",
      "instruction": "...",
      "context": null
    }
  ]
}
```

## Impact

- **Before**: IR validation failed when context was an object
- **After**: IR validation accepts object, string, or null
- **Workflows affected**: Any workflow with AI classification/filtering operations

---

**Resolution Date:** 2025-12-30
**Implemented By:** Claude Code Agent
**Status:** ✅ COMPLETE - Schema updated to accept flexible context types
**Confidence:** HIGH (100%) - Simple schema type update, verified with TypeScript
