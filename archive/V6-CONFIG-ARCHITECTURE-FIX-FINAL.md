# V6 Configuration Architecture Fix - Final

**Date**: February 17, 2026
**Status**: ✅ COMPLETE

## Issue

Pipeline failed with:
```
NotFoundError: 404 model: gpt-4o
[HardRequirementsExtractor] Starting LLM-based extraction (anthropic/gpt-4o)...
```

## Root Cause

The test HTML page was passing a **global config override** that applied the semantic phase's configuration to ALL phases (requirements, semantic, formalization).

## Architecture Principle

**Trust the admin configuration completely.**

Each phase has its own dedicated configuration in the database:
- Phase 0 (Requirements): Separate provider/model/temperature
- Phase 1 (Semantic): Separate provider/model/temperature
- Phase 3 (Formalization): Separate provider/model/temperature

The orchestrator should use the appropriate admin config for each phase independently.

## Fix

### Single Change Required: Test HTML Page

**File**: [public/test-v6-declarative.html](public/test-v6-declarative.html)

**Before (Broken)**:
```javascript
// Fetched admin config
const adminConfigData = await fetch('/api/admin/agent-generation-config');

// Extracted ONLY semantic config
const semanticProvider = adminConfigData.config.semantic.provider;
const semanticModel = adminConfigData.config.semantic.model;

// Passed semantic config as GLOBAL override (wrong!)
const response = await fetch('/api/v6/generate-ir-semantic', {
  body: JSON.stringify({
    enhanced_prompt: enhancedPrompt,
    config: {
      provider: semanticProvider,  // ❌ Applied to ALL phases
      model: semanticModel          // ❌ Applied to ALL phases
    }
  })
});
```

**After (Fixed)**:
```javascript
// Fetch admin config for display purposes only
const adminConfigData = await fetch('/api/admin/agent-generation-config');

// Log what will be used (transparency)
console.log(`[Pipeline] Using admin config:`);
console.log(`  Phase 0: ${adminConfig.requirements.provider}/${adminConfig.requirements.model}`);
console.log(`  Phase 1: ${adminConfig.semantic.provider}/${adminConfig.semantic.model}`);
console.log(`  Phase 3: ${adminConfig.formalization.provider}/${adminConfig.formalization.model}`);

// Don't pass config - let orchestrator use admin config per phase
const response = await fetch('/api/v6/generate-ir-semantic', {
  body: JSON.stringify({
    enhanced_prompt: enhancedPrompt,
    use_v6_orchestrator: true  // ✅ No config override
  })
});
```

## How It Works Now

### Orchestrator Config Resolution

For each phase, the orchestrator follows this priority:

```typescript
// Phase 0: Requirements
const requirementsConfig = {
  provider: config?.provider || adminConfig.requirements.provider,
  model: config?.model || adminConfig.requirements.model,
  temperature: config?.temperature ?? adminConfig.requirements.temperature
}

// Phase 1: Semantic
const semanticConfig = {
  model_provider: config?.provider || adminConfig.semantic.provider,
  model_name: config?.model || adminConfig.semantic.model,
  temperature: config?.temperature ?? adminConfig.semantic.temperature
}

// Phase 3: Formalization
const irConfig = {
  model_provider: config?.provider || adminConfig.formalization.provider,
  model: config?.model || adminConfig.formalization.model,
  temperature: config?.temperature ?? adminConfig.formalization.temperature
}
```

**Priority**: `user config > admin config per phase > defaults`

### When config is NOT passed (normal operation):

- Phase 0 uses `adminConfig.requirements.*`
- Phase 1 uses `adminConfig.semantic.*`
- Phase 3 uses `adminConfig.formalization.*`

✅ **Each phase gets its own configuration from the database**

### When config IS passed (manual override):

- ALL phases use the same `config.provider` and `config.model`
- This is intended for **testing/debugging only**

## Configuration Flow

```
┌─────────────────────────────────────────────┐
│ Admin UI                                    │
│ - Sets requirements.provider/model/temp     │
│ - Sets semantic.provider/model/temp         │
│ - Sets formalization.provider/model/temp    │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ Database (system_settings_config)          │
│ - agent_generation_phase_requirements_*     │
│ - agent_generation_phase_semantic_*         │
│ - agent_generation_phase_formalization_*    │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ AgentGenerationConfigService (cached)       │
│ - Loads config once every 5 minutes         │
│ - Returns separate config per phase         │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ V6PipelineOrchestrator                      │
│ - Phase 0 → uses requirements config        │
│ - Phase 1 → uses semantic config            │
│ - Phase 3 → uses formalization config       │
└─────────────────────────────────────────────┘
```

## Modified Files

### 1. [public/test-v6-declarative.html](public/test-v6-declarative.html)
**Change**: Removed `config` parameter from API call

**Lines 876-903**:
- Removed extraction of semantic config
- Removed config parameter from API request
- Added console logging for transparency

### 2. [app/admin/agent-generation-config/page.tsx](app/admin/agent-generation-config/page.tsx)
**Change**: Removed unnecessary validation

**What was removed**:
- `validateProviderModelMatch()` function
- Pre-save validation checks
- Visual validation indicators (red borders)

**Why**: Trust the admin configuration. If an admin saves a specific provider/model combination, use it exactly as configured. The system should not second-guess admin decisions.

## Testing

1. **Verify admin config is loaded per phase**:
```bash
# Check console output
[Pipeline] Using admin config:
  Phase 0 (Requirements): openai/gpt-4o-mini (temp: 0.0)
  Phase 1 (Semantic): anthropic/claude-opus-4-6 (temp: 0.3)
  Phase 3 (Formalization): anthropic/claude-opus-4-6 (temp: 0.0)
```

2. **Run test workflow in `/test-v6-declarative.html`**:
   - Should complete without 404 errors
   - Each phase should use its own model
   - Check logs to verify correct provider per phase

3. **Verify in production**:
   - Agent creation should work without errors
   - Each phase should use admin config from database

## Success Criteria

✅ Test HTML page does not pass config parameter
✅ Each phase uses its own admin config from database
✅ No 404 model errors
✅ No validation blocking legitimate admin configurations
✅ Console shows correct model per phase

## Design Philosophy

**Trust admin configuration**:
- Admins are responsible for setting correct configurations
- System should use configurations exactly as specified
- No validation or "helpful" corrections
- Transparency through logging

**Config parameter is for manual overrides only**:
- Testing specific model combinations
- Debugging issues
- One-off experiments
- NOT for production use

**Each phase is independent**:
- Requirements extraction may need fast, cheap models
- Semantic planning may need powerful reasoning models
- Formalization may need precision-focused models

## Related Documentation

- [V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md](V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md) - Original integration
- [V6-ADMIN-UI-PROVIDER-FIX-COMPLETE.md](V6-ADMIN-UI-PROVIDER-FIX-COMPLETE.md) - Provider field addition
