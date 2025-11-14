# Pilot Per-Step Routing - Admin UI Specification

## Overview
This document specifies the Admin UI configuration for Pilot Per-Step Intelligent Model Routing.

## Configuration Distribution

### System Config Page (`/app/admin/system-config`)
**Section:** Workflow Pilot > Per-Step Intelligent Routing

| Parameter | Type | Description | Config Table |
|-----------|------|-------------|--------------|
| `pilot_per_step_routing_enabled` | Boolean | Enable/disable per-step routing | `system_settings_config` |
| `pilot_routing_default_strategy` | String | Default strategy: conservative/balanced/aggressive | `system_settings_config` |

**Status:** ✅ Implemented

---

### AIS Config Page (`/app/admin/ais-config`)
**New Section:** Per-Step Routing Configuration

#### 1. Complexity Thresholds (Tier Assignment)
| Parameter | Type | Default | Description | Config Table |
|-----------|------|---------|-------------|--------------|
| `pilot_routing_complexity_thresholds.tier1_max` | Number | 3.9 | Max complexity for Tier 1 (gpt-4o-mini) | `ais_system_config` |
| `pilot_routing_complexity_thresholds.tier2_max` | Number | 6.9 | Max complexity for Tier 2 (Claude Haiku) | `ais_system_config` |

**UI:** Two number inputs (0-10 range, step 0.1)

---

#### 2. Model Tier Configuration
| Parameter | Type | Default | Description | Config Table |
|-----------|------|---------|-------------|--------------|
| `pilot_routing_tier1_model.model` | String | gpt-4o-mini | Model name for Tier 1 | `ais_system_config` |
| `pilot_routing_tier1_model.provider` | String | openai | Provider for Tier 1 | `ais_system_config` |
| `pilot_routing_tier2_model.model` | String | claude-3-5-haiku-20241022 | Model name for Tier 2 | `ais_system_config` |
| `pilot_routing_tier2_model.provider` | String | anthropic | Provider for Tier 2 | `ais_system_config` |
| `pilot_routing_tier3_model.model` | String | gpt-4o | Model name for Tier 3 | `ais_system_config` |
| `pilot_routing_tier3_model.provider` | String | openai | Provider for Tier 3 | `ais_system_config` |

**UI:** Three rows with model + provider dropdowns. Costs fetched dynamically from `ai_model_pricing` table.

---

#### 3. Complexity Factor Weights (By Step Type)
**Parameters:** 6 weights per step type (must sum to 1.0)

| Step Type | Config Key | Description |
|-----------|------------|-------------|
| LLM Decision | `pilot_complexity_weights_llm_decision` | Emphasizes reasoning depth (30%) |
| Transform | `pilot_complexity_weights_transform` | Emphasizes data size (30%) |
| Conditional | `pilot_complexity_weights_conditional` | Emphasizes condition count (30%) |
| Action | `pilot_complexity_weights_action` | Balanced weights |
| API Call | `pilot_complexity_weights_api_call` | Lower reasoning weight |
| Default | `pilot_complexity_weights_default` | Fallback for unknown types |

**Factors for each type:**
- `prompt_length` - Character count of prompt
- `data_size` - Byte size of input data
- `condition_count` - Number of conditional branches
- `context_depth` - Number of context references
- `reasoning_depth` - Complexity of logical reasoning
- `output_complexity` - Complexity of expected output

**UI:**
- Collapsible section per step type
- 6 sliders per step type (0-1 range, step 0.01)
- Real-time validation: Must sum to 1.0
- Visual indicator showing total weight

---

#### 4. Complexity Scoring Thresholds
**Parameters:** Thresholds for scoring each factor (0-10 scale)

| Factor | Config Key | Low | Medium | High |
|--------|------------|-----|--------|------|
| Prompt Length | `pilot_complexity_thresholds_prompt_length` | 200 chars | 500 chars | 1000 chars |
| Data Size | `pilot_complexity_thresholds_data_size` | 1KB | 10KB | 50KB |
| Condition Count | `pilot_complexity_thresholds_condition_count` | 2 | 5 | 10 |
| Context Depth | `pilot_complexity_thresholds_context_depth` | 2 | 5 | 10 |

**Scoring Logic:**
- Below "low" threshold → Score 0-3
- Between "low" and "medium" → Score 4-6
- Between "medium" and "high" → Score 7-8
- Above "high" threshold → Score 9-10

**UI:**
- 4 rows (one per factor)
- 3 number inputs per row (low, medium, high)
- Help text explaining scoring ranges

---

## Implementation Plan

### Phase 1: System Config ✅ COMPLETED
- [x] Add state variables for per-step routing
- [x] Add loading logic from database
- [x] Add save logic to API
- [x] Add UI section in Pilot configuration
- [x] Add enable toggle
- [x] Add strategy dropdown

### Phase 2: AIS Config (IN PROGRESS)
- [ ] Add state variables for all routing parameters
- [ ] Add loading logic from `ais_system_config`
- [ ] Add save logic to AIS Config API
- [ ] Add "Per-Step Routing" collapsible section
- [ ] Add complexity thresholds UI
- [ ] Add tier model configuration UI
- [ ] Add complexity factor weights UI (collapsible per step type)
- [ ] Add scoring thresholds UI
- [ ] Add validation logic (weights sum to 1.0)

### Phase 3: API Updates
- [ ] Ensure System Config API handles new keys
- [ ] Ensure AIS Config API handles new keys
- [ ] Add validation for weight sums

### Phase 4: Testing
- [ ] Test save/load for all parameters
- [ ] Test validation (weights sum to 1.0)
- [ ] Test tier model dropdown population
- [ ] Test strategy selection
- [ ] Test enable/disable toggle

---

## UI Layout (AIS Config Page)

```
┌─────────────────────────────────────────────────────┐
│ Per-Step Routing Configuration          [Collapse] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ℹ️ Info Box: Explains per-step routing benefits    │
│                                                     │
│ ┌─ Complexity Thresholds ─────────────────────┐   │
│ │ Tier 1 Max: [3.9]  (0-3.9 → gpt-4o-mini)   │   │
│ │ Tier 2 Max: [6.9]  (4.0-6.9 → Claude Haiku) │   │
│ │ Tier 3: 7.0-10.0 (gpt-4o)                    │   │
│ └──────────────────────────────────────────────┘   │
│                                                     │
│ ┌─ Model Tier Configuration ──────────────────┐   │
│ │ Tier 1: [gpt-4o-mini ▼] [openai ▼]         │   │
│ │         Cost: $0.15/1M tokens (from DB)      │   │
│ │ Tier 2: [claude-3-5-haiku ▼] [anthropic ▼] │   │
│ │         Cost: $1.00/1M tokens (from DB)      │   │
│ │ Tier 3: [gpt-4o ▼] [openai ▼]              │   │
│ │         Cost: $5.00/1M tokens (from DB)      │   │
│ └──────────────────────────────────────────────┘   │
│                                                     │
│ ┌─ Complexity Factor Weights ─────────────────┐   │
│ │                                              │   │
│ │ [▼] LLM Decision Steps                      │   │
│ │ [▶] Transform Steps                         │   │
│ │ [▶] Conditional Steps                       │   │
│ │ [▶] Action Steps                            │   │
│ │ [▶] API Call Steps                          │   │
│ │ [▶] Default (Unknown) Steps                 │   │
│ └──────────────────────────────────────────────┘   │
│                                                     │
│ ┌─ Complexity Scoring Thresholds ─────────────┐   │
│ │ Prompt Length:   Low[200] Med[500] High[1000]│   │
│ │ Data Size:       Low[1KB] Med[10KB] High[50KB]│   │
│ │ Condition Count: Low[2]   Med[5]    High[10] │   │
│ │ Context Depth:   Low[2]   Med[5]    High[10] │   │
│ └──────────────────────────────────────────────┘   │
│                                                     │
│ [Save Per-Step Routing Config]                    │
└─────────────────────────────────────────────────────┘
```

### Expanded Weight Editor (Example for LLM Decision)
```
┌─ LLM Decision Steps [▼] ──────────────────────────┐
│                                                    │
│ Prompt Length:      [●●●──────] 0.15 (15%)       │
│ Data Size:          [●●────────] 0.10 (10%)       │
│ Condition Count:    [●●●──────] 0.15 (15%)       │
│ Context Depth:      [●●●──────] 0.15 (15%)       │
│ Reasoning Depth:    [●●●●●●──] 0.30 (30%) ⭐     │
│ Output Complexity:  [●●●──────] 0.15 (15%)       │
│                                                    │
│ Total Weight: 1.00 ✅                             │
└────────────────────────────────────────────────────┘
```

---

## Data Flow

### Load Flow
1. Component mounts → `fetchAISConfig()`
2. Fetch from `/api/admin/ais-config`
3. Parse `ais_system_config` entries with keys starting with `pilot_routing_` or `pilot_complexity_`
4. Populate state variables
5. Fetch `ai_model_pricing` for cost display

### Save Flow
1. User clicks "Save Per-Step Routing Config"
2. Validate weights sum to 1.0 for each step type
3. POST to `/api/admin/ais-config` with updates
4. API uses `AISConfigService.setMultiple()`
5. Refresh config from database
6. Show success message

---

## Validation Rules

1. **Complexity Thresholds:**
   - `tier1_max` must be < `tier2_max`
   - Both must be in range [0, 10]
   - Step size: 0.1

2. **Model Tier Configuration:**
   - Model must exist in `ai_model_pricing` table
   - Provider must match model's provider

3. **Complexity Factor Weights:**
   - Each step type's 6 weights must sum to exactly 1.0
   - Individual weights must be in range [0, 1]
   - Step size: 0.01

4. **Complexity Scoring Thresholds:**
   - `low` < `medium` < `high`
   - All values must be positive integers

---

## Error Handling

- Show inline validation errors for weight sums
- Show error toast for API failures
- Disable save button if validation fails
- Auto-normalize weights if sum is close to 1.0 (e.g., 0.99-1.01)

---

## Status

- System Config UI: ✅ Complete
- AIS Config UI: 🚧 In Progress
- API Integration: ⏳ Pending
- Testing: ⏳ Pending
