# V6 Test HTML Config Fix - Root Cause Resolution

**Date**: February 17, 2026
**Status**: ✅ FIXED

## Issue

The V6 pipeline was failing with error:
```
NotFoundError: 404 model: gpt-4o
[HardRequirementsExtractor] Starting LLM-based extraction (anthropic/gpt-4o)...
```

## Root Cause

The test HTML page ([public/test-v6-declarative.html](public/test-v6-declarative.html)) was:

1. Fetching the admin config from the database
2. Extracting **ONLY the semantic phase config** (Phase 1)
3. Passing it as the **global config parameter** to the orchestrator
4. This caused the orchestrator to use the **semantic config for ALL phases**

### Before (Broken):
```javascript
// Fetch admin config
const adminConfigResp = await fetch('/api/admin/agent-generation-config');
const adminConfigData = await adminConfigResp.json();

// Extract ONLY semantic phase config
const semanticProvider = adminConfigData.config.semantic.provider;  // "anthropic"
const semanticModel = adminConfigData.config.semantic.model;        // "gpt-4o" (WRONG!)
const semanticTemp = adminConfigData.config.semantic.temperature;

// Pass semantic config as GLOBAL config (applies to ALL phases!)
const pipelineResp = await fetch('/api/v6/generate-ir-semantic', {
  body: JSON.stringify({
    enhanced_prompt: enhancedPrompt,
    userId: userId,
    use_v6_orchestrator: true,
    config: {
      provider: semanticProvider,    // ❌ Used for Phase 0, 1, AND 3
      model: semanticModel,          // ❌ Used for Phase 0, 1, AND 3
      understanding_temperature: semanticTemp
    }
  })
});
```

### The Problem Flow:

1. Admin config in database:
   - Phase 0 (Requirements): `openai/gpt-4o-mini`
   - Phase 1 (Semantic): `anthropic/claude-opus-4-6`
   - Phase 3 (Formalization): `anthropic/claude-opus-4-6`

2. Test HTML extracted semantic config: `anthropic/gpt-4o` (user had saved wrong model)

3. Orchestrator received config parameter: `{provider: "anthropic", model: "gpt-4o"}`

4. Orchestrator used this for ALL phases:
   ```typescript
   // Phase 0: Requirements
   const requirementsConfig = {
     provider: config?.provider || adminConfig.requirements.provider,  // ❌ "anthropic" from config
     model: config?.model || adminConfig.requirements.model,            // ❌ "gpt-4o" from config
   }

   // Phase 1: Semantic
   const semanticConfig = {
     model_provider: config?.provider || adminConfig.semantic.provider,  // ❌ "anthropic" from config
     model_name: config?.model || adminConfig.semantic.model,            // ❌ "gpt-4o" from config
   }

   // Phase 3: Formalization
   const irConfig = {
     model_provider: config?.provider || adminConfig.formalization.provider,  // ❌ "anthropic" from config
     model: config?.model || adminConfig.formalization.model,                  // ❌ "gpt-4o" from config
   }
   ```

5. Result: Tried to send `gpt-4o` to Anthropic API → 404 error

## Fix Applied

**Remove the config parameter entirely** and let the orchestrator use the admin config directly for each phase.

### After (Fixed):
```javascript
// Fetch admin configuration to display what models will be used
const adminConfigResp = await fetch('/api/admin/agent-generation-config');
const adminConfigData = await adminConfigResp.json();

if (adminConfigData.success) {
  // ✅ Display config for transparency
  console.log(`[Pipeline] Using admin config:`);
  console.log(`  Phase 0 (Requirements): ${adminConfigData.config.requirements.provider}/${adminConfigData.config.requirements.model}`);
  console.log(`  Phase 1 (Semantic): ${adminConfigData.config.semantic.provider}/${adminConfigData.config.semantic.model}`);
  console.log(`  Phase 3 (Formalization): ${adminConfigData.config.formalization.provider}/${adminConfigData.config.formalization.model}`);
}

// ✅ Don't pass config - let orchestrator use admin config for each phase
const pipelineResp = await fetch('/api/v6/generate-ir-semantic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    enhanced_prompt: enhancedPrompt,
    userId: userId,
    use_v6_orchestrator: true  // No config parameter
  })
});
```

### Now the Orchestrator Works Correctly:

```typescript
// Phase 0: Requirements
const requirementsConfig = {
  provider: config?.provider || adminConfig.requirements.provider,  // ✅ "openai" from adminConfig.requirements
  model: config?.model || adminConfig.requirements.model,            // ✅ "gpt-4o-mini" from adminConfig.requirements
}

// Phase 1: Semantic
const semanticConfig = {
  model_provider: config?.provider || adminConfig.semantic.provider,  // ✅ "anthropic" from adminConfig.semantic
  model_name: config?.model || adminConfig.semantic.model,            // ✅ "claude-opus-4-6" from adminConfig.semantic
}

// Phase 3: Formalization
const irConfig = {
  model_provider: config?.provider || adminConfig.formalization.provider,  // ✅ "anthropic" from adminConfig.formalization
  model: config?.model || adminConfig.formalization.model,                  // ✅ "claude-opus-4-6" from adminConfig.formalization
}
```

## Additional Safety: Admin UI Validation

Also added validation to the admin UI to prevent users from saving invalid provider/model combinations:

### Validation Function:
```typescript
const validateProviderModelMatch = (provider: string, model: string): boolean => {
  const modelLower = model.toLowerCase();

  if (provider === 'anthropic') {
    return modelLower.includes('claude') ||
           modelLower.includes('opus') ||
           modelLower.includes('sonnet') ||
           modelLower.includes('haiku');
  } else {
    return modelLower.includes('gpt') ||
           modelLower.includes('o1') ||
           modelLower.startsWith('text-');
  }
};
```

### Visual Indicators:
- Red border on dropdown if provider/model mismatch
- Warning text: "⚠️ Invalid combination"
- Blocks save with clear error message

## Modified Files

1. [public/test-v6-declarative.html](public/test-v6-declarative.html)
   - **PRIMARY FIX**: Removed config parameter from API call (lines 876-903)
   - Added console logging to show which models will be used per phase
   - Let orchestrator use admin config directly for each phase

2. [app/admin/agent-generation-config/page.tsx](app/admin/agent-generation-config/page.tsx)
   - **SAFETY MEASURE**: Added validation to prevent invalid saves
   - Added `validateProviderModelMatch()` function
   - Added visual indicators for invalid combinations
   - Pre-save validation checks

## Testing

1. **Open test HTML page**: Navigate to `/test-v6-declarative.html`

2. **Check console logs**: Should see:
   ```
   [Pipeline] Using admin config:
     Phase 0 (Requirements): openai/gpt-4o-mini (temp: 0.0)
     Phase 1 (Semantic): anthropic/claude-opus-4-6 (temp: 0.3)
     Phase 3 (Formalization): anthropic/claude-opus-4-6 (temp: 0.0)
   ```

3. **Run test workflow**: Should complete without 404 errors

4. **Verify each phase uses correct model**:
   - Phase 0 should use `openai/gpt-4o-mini`
   - Phase 1 should use `anthropic/claude-opus-4-6`
   - Phase 3 should use `anthropic/claude-opus-4-6`

## Architecture Principle

**Each phase should use its own dedicated configuration from the admin settings.**

The `config` parameter in the orchestrator is intended for **manual overrides** during testing or special cases, NOT for production use. In production:

- Test HTML page: No config parameter → Uses admin config per phase
- Agent creation UI: No config parameter → Uses admin config per phase
- Admin UI: Saves separate config for each phase to database

## Success Criteria

✅ Test HTML page doesn't pass config parameter
✅ Console shows correct models per phase
✅ No 404 model errors
✅ Phase 0 uses requirements config from admin
✅ Phase 1 uses semantic config from admin
✅ Phase 3 uses formalization config from admin
✅ Admin UI validates provider/model combinations
✅ Admin UI prevents saving invalid combinations

## Related Documentation

- [V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md](V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md) - Original admin config integration
- [V6-ADMIN-UI-PROVIDER-FIX-COMPLETE.md](V6-ADMIN-UI-PROVIDER-FIX-COMPLETE.md) - Adding provider field to UI
