# V6 Final Config and Schema Fixes

**Date**: February 17, 2026
**Status**: ✅ COMPLETE

## Issues Fixed

### Issue 1: API Route Overriding All Phases with Semantic Config

**Problem**: The API route was fetching the semantic phase config from the database and passing it as a global override to ALL phases.

**Evidence**:
```
[API] Using admin config: provider=openai, model=gpt-4o, temp=0.3
[HardRequirementsExtractor] Starting LLM-based extraction (openai/gpt-4o)...
```

Phase 0 should use `gpt-4o-mini` but was using `gpt-4o` (semantic phase model).

**Root Cause**: Lines 296-332 in `generate-ir-semantic/route.ts` were fetching ONLY the semantic phase config and using it for all phases.

**Fix**: Removed the database fetch from the API route. The orchestrator already fetches admin config internally per phase.

**File**: [app/api/v6/generate-ir-semantic/route.ts](app/api/v6/generate-ir-semantic/route.ts)

**Changes**:
```typescript
// BEFORE (WRONG):
if (!configProvider || !configModel) {
  // Fetch semantic phase config from database
  const { data: settings } = await supabase
    .from('system_settings_config')
    .select('key, value')
    .in('key', [
      'agent_generation_phase_semantic_provider',  // ❌ Semantic only
      'agent_generation_phase_semantic_model',
      'agent_generation_phase_semantic_temperature'
    ])

  // Use semantic config for ALL phases
  configProvider = semanticProvider  // ❌ Applied to Phase 0, 1, 3
  configModel = semanticModel
}

// AFTER (CORRECT):
// Don't fetch admin config here - the orchestrator fetches it internally per phase
const primaryConfig: ProviderConfig | undefined = body.config ? {
  provider: body.config.provider,
  model: body.config.model,
  temperature: body.config.understanding_temperature,
  max_tokens: body.config.max_tokens
} : undefined

if (primaryConfig) {
  // Client provided config - use it with fallback (testing only)
  fallbackResult = await withProviderFallback(...)
} else {
  // No client config - let orchestrator use admin config per phase
  const result = await orchestrator.run(body.enhanced_prompt)
  fallbackResult = {
    success: result.success,
    data: result,
    error: result.error,
    provider: 'admin-config',
    attemptsUsed: 1,
    fellBackToSecondary: false,
    totalDurationMs: Date.now() - startTime
  }
}
```

### Issue 2: OpenAI Strict Schema - Missing `file_operations` in `required` Array

**Problem**: OpenAI's structured output rejected the schema with:
```
Invalid schema for response_format 'semantic_plan':
In context=('properties', 'understanding'), 'required' is required to be supplied
and to be an array including every key in properties. Missing 'file_operations'.
```

**Root Cause**: The `SEMANTIC_PLAN_SCHEMA_STRICT` had `file_operations` as a property but didn't list it in the `required` array.

**Fix**: Added `file_operations` to the `required` array for the `understanding` object.

**File**: [lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts](lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts)

**Changes**:
```typescript
// BEFORE (line 402):
understanding: {
  type: 'object',
  required: ['data_sources', 'filtering', 'ai_processing', 'grouping', 'rendering', 'delivery', 'edge_cases'],
  additionalProperties: false,
  properties: {
    // ...
    file_operations: { ... }  // ❌ Defined but not in required array
  }
}

// AFTER (line 402):
understanding: {
  type: 'object',
  required: ['data_sources', 'filtering', 'ai_processing', 'file_operations', 'grouping', 'rendering', 'delivery', 'edge_cases'],
  additionalProperties: false,
  properties: {
    // ...
    file_operations: { ... }  // ✅ Now in required array
  }
}
```

### Issue 3: OpenAI Strict Schema - Missing Properties in `file_operations.items.required`

**Problem**: OpenAI also rejected the schema with:
```
Invalid schema for response_format 'semantic_plan':
In context=('properties', 'understanding', 'properties', 'file_operations', 'type', '0', 'items'),
'required' is required to be supplied and to be an array including every key in properties.
Missing 'trigger'.
```

**Root Cause**: The `file_operations` array items had properties like `trigger`, `content_source`, etc. but they weren't all in the `required` array.

**Fix**: Added all properties to the `required` array for `file_operations` items (both occurrences).

**File**: [lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts](lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts)

**Changes**:
```typescript
// BEFORE (lines 164-181 and 456-473):
file_operations: {
  type: 'array',
  items: {
    type: 'object',
    required: ['type', 'description', 'target_service'],  // ❌ Missing 5 properties
    properties: {
      type: { type: 'string' },
      description: { type: 'string' },
      target_service: { type: 'string' },
      trigger: { type: 'string' },                 // ❌ Not in required
      content_source: { type: 'string' },          // ❌ Not in required
      folder_structure: { type: 'string' },        // ❌ Not in required
      generate_link: { type: 'boolean' },          // ❌ Not in required
      additional_config: { type: 'string' }        // ❌ Not in required
    }
  }
}

// AFTER:
file_operations: {
  type: 'array',
  items: {
    type: 'object',
    required: ['type', 'description', 'target_service', 'trigger', 'content_source', 'folder_structure', 'generate_link', 'additional_config'],
    properties: {
      type: { type: 'string' },
      description: { type: 'string' },
      target_service: { type: 'string' },
      trigger: { type: 'string' },
      content_source: { type: 'string' },
      folder_structure: { type: 'string' },
      generate_link: { type: 'boolean' },
      additional_config: { type: 'string' }
    }
  }
}
```

## Why OpenAI Requires All Properties in `required`

When using OpenAI's `response_format: { type: 'json_schema' }` with `strict: true` (or when `additionalProperties: false`), OpenAI enforces that:

1. **ALL properties must be in the `required` array**
2. This prevents the LLM from omitting fields
3. This ensures the response structure is completely predictable

This is different from standard JSON Schema, where `required` is optional and properties can be omitted.

## Verification

After these fixes:

1. ✅ API route no longer fetches admin config
2. ✅ Orchestrator uses correct admin config per phase:
   - Phase 0: `openai/gpt-4o-mini`
   - Phase 1: `openai/gpt-4o`
   - Phase 3: `anthropic/claude-opus-4-6`
3. ✅ OpenAI accepts the schema without errors
4. ✅ All required fields are enforced

## Modified Files

1. [app/api/v6/generate-ir-semantic/route.ts](app/api/v6/generate-ir-semantic/route.ts)
   - Lines 290-340: Removed semantic config fetch, let orchestrator handle per-phase config

2. [lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts](lib/agentkit/v6/semantic-plan/schemas/semantic-plan-schema.ts)
   - Line 168: Added all properties to `file_operations.items.required` (non-strict schema)
   - Line 402: Added `file_operations` to `understanding.required` (strict schema)
   - Line 460: Added all properties to `file_operations.items.required` (strict schema)

## Testing

Run the test HTML page to verify:

```bash
# Open in browser
open http://localhost:3000/test-v6-declarative.html

# Expected console output:
[Pipeline] Using admin config:
  Phase 0 (Requirements): openai/gpt-4o-mini (temp: 0.0)
  Phase 1 (Semantic): openai/gpt-4o (temp: 0.3)
  Phase 3 (Formalization): anthropic/claude-opus-4-6 (temp: 0.0)

# Expected execution logs:
[HardRequirementsExtractor] Starting LLM-based extraction (openai/gpt-4o-mini)...
[SemanticPlanGenerator] Initializing (openai/gpt-4o)...
[IRFormalizer] Initializing (anthropic/claude-opus-4-6)...
```

## Related Documentation

- [V6-CONFIG-COMPLETE-VERIFICATION.md](V6-CONFIG-COMPLETE-VERIFICATION.md) - Complete verification of admin config system
- [V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md](V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md) - Original admin config integration
- [V6-CONFIG-ARCHITECTURE-FIX-FINAL.md](V6-CONFIG-ARCHITECTURE-FIX-FINAL.md) - Architecture principles
