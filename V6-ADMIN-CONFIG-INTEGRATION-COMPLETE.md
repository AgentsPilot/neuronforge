# V6 Admin Config Integration - Complete

**Date**: February 17, 2026
**Status**: ✅ ALL PHASES NOW USE ADMIN CONFIG

## Summary

All three V6 pipeline phases now correctly fetch their LLM model and provider configuration from the admin UI settings stored in the database, for both test HTML page AND production flows.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin UI (app/admin/agent-generation-config)                    │
│ - Configure provider (openai/anthropic) per phase               │
│ - Configure model name per phase                                │
│ - Configure temperature per phase                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Database (system_settings_config table)                         │
│ - agent_generation_phase_requirements_provider                  │
│ - agent_generation_phase_requirements_model                     │
│ - agent_generation_phase_requirements_temperature               │
│ - agent_generation_phase_semantic_provider                      │
│ - agent_generation_phase_semantic_model                         │
│ - agent_generation_phase_semantic_temperature                   │
│ - agent_generation_phase_formalization_provider                 │
│ - agent_generation_phase_formalization_model                    │
│ - agent_generation_phase_formalization_temperature              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ AgentGenerationConfigService (cached, 5-min TTL)                │
│ - getAgentGenerationConfig() returns all phase configs          │
│ - Includes provider, model, temperature for each phase          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ V6PipelineOrchestrator                                          │
│ - Loads admin config once at start                              │
│ - Priority: user config > admin config > defaults               │
│ - Passes config to each phase generator                         │
└─────────────────────────────────────────────────────────────────┘
          ↓                   ↓                   ↓
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ Phase 0:         │ │ Phase 1:         │ │ Phase 3:         │
│ Requirements     │ │ Semantic         │ │ Formalization    │
│                  │ │                  │ │                  │
│ Uses admin cfg   │ │ Uses admin cfg   │ │ Uses admin cfg   │
│ ✅ NEW           │ │ ✅ FIXED         │ │ ✅ FIXED         │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

## Changes Made

### 1. AgentGenerationConfigService (lib/agentkit/v6/config/AgentGenerationConfigService.ts)

**Problem**: Config interface only had `model` and `temperature`, missing `provider` field.

**Fix**: Added `provider` field to all phase configs.

```typescript
export interface PhaseModelConfig {
  provider: 'openai' | 'anthropic';  // ✅ ADDED
  model: string;
  temperature: number;
}

const DEFAULT_CONFIG: AgentGenerationConfig = {
  requirements: {
    provider: 'openai',        // ✅ ADDED
    model: 'gpt-4o-mini',
    temperature: 0.0
  },
  semantic: {
    provider: 'anthropic',     // ✅ ADDED
    model: 'claude-opus-4-6',
    temperature: 0.3
  },
  formalization: {
    provider: 'anthropic',     // ✅ ADDED
    model: 'claude-opus-4-6',
    temperature: 0.0
  }
};

// Database loading now includes provider fields
if (key === 'agent_generation_phase_requirements_provider') config.requirements.provider = parsedValue;
if (key === 'agent_generation_phase_semantic_provider') config.semantic.provider = parsedValue;
if (key === 'agent_generation_phase_formalization_provider') config.formalization.provider = parsedValue;
```

### 2. HardRequirementsExtractor (lib/agentkit/v6/requirements/HardRequirementsExtractor.ts)

**Problem**: Hardcoded to use OpenAI's `gpt-4o-mini` model. No configuration support.

**Fix**: Added configuration support for both OpenAI and Anthropic.

```typescript
export interface RequirementsExtractorConfig {
  provider?: 'openai' | 'anthropic'
  model?: string
  temperature?: number
}

export class HardRequirementsExtractor {
  private openai?: OpenAI
  private anthropic?: Anthropic
  private config: Required<RequirementsExtractorConfig>

  constructor(config: RequirementsExtractorConfig = {}) {
    // Set defaults from config or use fallback
    this.config = {
      provider: config.provider || 'openai',
      model: config.model || 'gpt-4o-mini',
      temperature: config.temperature ?? 0.0
    }

    // Initialize correct LLM client
    if (this.config.provider === 'openai') {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    } else {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    }
  }

  async extract(enhancedPrompt: EnhancedPrompt): Promise<HardRequirements> {
    console.log(`[HardRequirementsExtractor] Starting LLM-based extraction (${this.config.provider}/${this.config.model})...`)

    if (this.config.provider === 'openai' && this.openai) {
      // OpenAI implementation with structured output
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
        // ...
      })
    } else if (this.config.provider === 'anthropic' && this.anthropic) {
      // Anthropic implementation
      const response = await this.anthropic.messages.create({
        model: this.config.model,
        temperature: this.config.temperature,
        // ...
      })
    }
  }
}
```

### 3. V6PipelineOrchestrator (lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts)

**Problem**:
1. Instantiated `HardRequirementsExtractor` in constructor without config
2. **CRITICAL BUG**: Used `inferProvider(adminConfig.semantic.model)` instead of `adminConfig.semantic.provider`
3. This caused the system to try using OpenAI models with Anthropic API and vice versa

**Fix**:
- Removed extractor from constructor
- Instantiate extractor in `run()` method with admin config
- **Fixed provider selection**: Now uses `adminConfig.semantic.provider` and `adminConfig.formalization.provider` directly
- Removed unused `inferProvider()` method
- All three phases now follow same pattern

```typescript
export class V6PipelineOrchestrator {
  private recovery: AutoRecoveryHandler

  constructor() {
    this.recovery = new AutoRecoveryHandler()
    // ✅ REMOVED: this.extractor = new HardRequirementsExtractor()
  }

  async run(enhancedPrompt: EnhancedPrompt, config?: PipelineConfig): Promise<PipelineResult> {
    // Load admin configuration (cached, 5-minute TTL)
    const adminConfig = await getAgentGenerationConfig()

    try {
      // ✅ Phase 0: Extract Hard Requirements - NOW USES ADMIN CONFIG
      const requirementsConfig = {
        provider: config?.provider || adminConfig.requirements.provider,
        model: config?.model || adminConfig.requirements.model,
        temperature: config?.temperature ?? adminConfig.requirements.temperature
      }
      const extractor = new HardRequirementsExtractor(requirementsConfig)
      hardReqs = await extractor.extract(enhancedPrompt)

      // ✅ Phase 1: Semantic - NOW CORRECTLY USING ADMIN CONFIG PROVIDER
      const semanticConfig = {
        model_provider: config?.provider || adminConfig.semantic.provider,  // FIXED: was inferProvider()
        model_name: config?.model || adminConfig.semantic.model,
        temperature: config?.temperature ?? adminConfig.semantic.temperature,
        max_tokens: config?.max_tokens
      }
      const semanticGenerator = new SemanticPlanGenerator(semanticConfig)
      const semanticPlanResult = await semanticGenerator.generate(enhancedPrompt, hardReqs)

      // ✅ Phase 3: Formalization - NOW CORRECTLY USING ADMIN CONFIG PROVIDER
      const irConfig = {
        model: config?.model || adminConfig.formalization.model,
        model_provider: config?.provider || adminConfig.formalization.provider,  // FIXED: was inferProvider()
        temperature: config?.temperature ?? adminConfig.formalization.temperature,
        max_tokens: config?.max_tokens,
        // ...
      }
      const formalizer = new IRFormalizer(irConfig)
      const formalizationResult = await formalizer.formalize(groundedPlan, hardReqs)
    }
  }
}
```

## Configuration Priority Chain

For all three phases, the configuration priority is:

1. **User config** (passed to `orchestrator.run(enhancedPrompt, config)`)
2. **Admin config** (from database via `getAgentGenerationConfig()`)
3. **Hardcoded defaults** (fallback if database unavailable)

Example for Semantic phase:
```typescript
const semanticConfig = {
  model_provider: config?.provider || adminConfig.semantic.provider,  // user > admin
  model_name: config?.model || adminConfig.semantic.model,            // user > admin
  temperature: config?.temperature ?? adminConfig.semantic.temperature // user > admin
}
```

## Production Flow Verification

### Test HTML Page Flow
```
test-v6-declarative.html
  → Fetches /api/admin/agent-generation-config
  → Passes config to /api/v6/generate-ir-semantic
  → API queries database if client doesn't provide full config
  → API calls V6PipelineOrchestrator.run(enhancedPrompt, config)
  → Orchestrator loads admin config from database
  → Each phase uses: client config > admin config > defaults
```

### Production Agent Creation Flow
```
Help bot / Agent creation UI
  → Calls /api/v6/generate-ir-semantic WITHOUT config
  → API queries database for admin config
  → API calls V6PipelineOrchestrator.run(enhancedPrompt, config)
  → Orchestrator loads admin config from database
  → Each phase uses: admin config > defaults
```

## Default Models (Fallback)

If database is unavailable, these defaults are used:

| Phase | Provider | Model | Temperature |
|-------|----------|-------|-------------|
| Phase 0: Requirements | OpenAI | gpt-4o-mini | 0.0 |
| Phase 1: Semantic | Anthropic | claude-opus-4-6 | 0.3 |
| Phase 3: Formalization | Anthropic | claude-opus-4-6 | 0.0 |

## Caching Behavior

- **AgentGenerationConfigService** uses in-memory cache with 5-minute TTL
- Database is only queried once every 5 minutes per server instance
- Cache refreshes automatically when TTL expires
- Manual refresh available via `refreshConfigCache()`

## Testing Checklist

- [x] Phase 0 (Requirements) reads from admin config
- [x] Phase 1 (Semantic) reads from admin config
- [x] Phase 3 (Formalization) reads from admin config
- [x] Test HTML page uses admin config
- [x] Production API uses admin config when client doesn't provide it
- [x] Provider field stored in database
- [x] Provider field included in AgentGenerationConfigService
- [x] All TypeScript errors resolved
- [x] Backward compatibility maintained (config parameter is optional)

## Related Files

### Modified Files
- `lib/agentkit/v6/config/AgentGenerationConfigService.ts` - Added provider field
- `lib/agentkit/v6/requirements/HardRequirementsExtractor.ts` - Added configuration support
- `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` - Phase 0 now uses admin config

### Existing Files (Already Correct)
- `app/api/admin/agent-generation-config/route.ts` - Admin API with provider fields
- `app/api/v6/generate-ir-semantic/route.ts` - API with database config fetch
- `public/test-v6-declarative.html` - Test page with admin config fetch

## Migration

Database migration already applied:
- `supabase/migrations/20260217_add_provider_to_agent_generation_config.sql`

## Conclusion

✅ **ALL V6 PHASES NOW USE ADMIN CONFIG**

The V6 pipeline is now fully integrated with the admin configuration system. All three phases (Requirements, Semantic, Formalization) read their LLM provider and model settings from the database via the admin UI, with proper caching and fallback behavior.

This works for:
- Test HTML page (`test-v6-declarative.html`)
- Production agent creation (help bot, agent creation UI)
- Any API calls to `/api/v6/generate-ir-semantic`

The configuration priority chain ensures flexibility:
1. Explicit config passed by client
2. Admin settings from database
3. Sensible hardcoded defaults
