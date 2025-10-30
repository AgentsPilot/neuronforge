# Analytics Page - Pilot Credits & Intelligent Routing Cost Fix

## Current Situation Analysis

### What We Found:

**1. Token Display Issue**
- Analytics currently shows RAW TOKENS everywhere
- Should show **Pilot Credits** (tokens ÷ 10)
- Affects: Overview, Insights, Activities, Agents tabs

**2. Cost Calculation Issue** ⚠️ CRITICAL
- Cost is calculated using HARDCODED pricing in `usageTracker.ts`
- Does NOT account for intelligent routing model selection
- Example problem:
  - Agent runs with intelligent routing → uses `gpt-4o-mini`
  - Analytics calculates cost using default `gpt-4o` pricing
  - **Result**: Cost shown is ~16x HIGHER than actual!

**3. Current Cost Calculation Flow**
```
AI Provider (OpenAI/Anthropic)
  ↓
BaseProvider tracks usage
  ↓
AIAnalyticsService inserts to token_usage table
  ↓
Cost calculated using MODEL_PRICING hardcoded values (WRONG!)
  ↓
Analytics displays incorrect cost
```

### Files Involved:

**Analytics Display:**
- `/components/analytics/AnalyticsView.tsx` - Main analytics UI
- `/components/analytics/MetricsCards.tsx` - Overview cards
- `/lib/utils/analyticsHelpers.ts` - Formatting helpers (formatTokens, formatCost)
- `/app/admin/analytics/page.tsx` - Admin analytics page

**Cost Calculation:**
- `/lib/utils/usageTracker.ts` - DEPRECATED but still has hardcoded pricing
- `/lib/analytics/aiAnalytics.ts` - New analytics service
- `/lib/ai/providers/baseProvider.ts` - Base AI provider
- `/lib/ai/providers/openaiProvider.ts` - OpenAI provider with tracking

**Database:**
- `token_usage` table - Stores: `model_name`, `input_tokens`, `output_tokens`, `cost_usd`
- `ai_model_pricing` table - Database-backed pricing (NOT CURRENTLY USED FOR ANALYTICS!)

---

## The Problem in Detail

### Example Scenario:

**Agent runs with intelligent routing:**
1. AIS determines agent is LOW intensity
2. Routing selects `gpt-4o-mini` (cheap)
3. Agent uses 10,000 tokens
4. **Actual cost**: 10,000 tokens × $0.00015/1k = **$1.50**
5. **Analytics shows**: 10,000 tokens × $0.0025/1k (gpt-4o pricing) = **$25.00**
6. **Error**: 16x OVERCHARGE shown to user!

### Root Cause:

The `cost_usd` stored in `token_usage` table is calculated using:
```typescript
// From usageTracker.ts (DEPRECATED but still used)
const MODEL_PRICING = {
  'openai': {
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  }
}
```

BUT the tracking doesn't know which model was ACTUALLY used by intelligent routing!

---

## Solution Plan

### Phase 1: Fix Cost Calculation (CRITICAL - Do First!)

**Problem**: Cost stored in DB doesn't reflect actual model used

**Solution**: Ensure `model_name` field is accurately populated during tracking

**Changes Needed:**

1. **Verify Model Tracking in AIAnalyticsService**
   - File: `/lib/analytics/aiAnalytics.ts`
   - Ensure when we track usage, we store the ACTUAL model used
   - Check that intelligent routing's selected model is passed through

2. **Update Cost Calculation to Use Actual Model**
   - Currently: Uses hardcoded MODEL_PRICING
   - New: Query `ai_model_pricing` table for actual pricing
   - Create helper: `getModelPricing(provider, model_name)`

3. **Recalculate Historical Data** (Optional)
   - Script to update `cost_usd` for existing records
   - Use actual `model_name` from each record
   - Query `ai_model_pricing` for correct pricing

**Code Changes:**

```typescript
// NEW: lib/ai/pricing.ts
export async function getModelPricing(
  supabase: SupabaseClient,
  provider: string,
  modelName: string
): Promise<{ input: number; output: number } | null> {
  const { data, error } = await supabase
    .from('ai_model_pricing')
    .select('input_cost_per_token, output_cost_per_token')
    .eq('provider', provider)
    .eq('model_name', modelName)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;

  return {
    input: data.input_cost_per_token,
    output: data.output_cost_per_token
  };
}

export async function calculateActualCost(
  supabase: SupabaseClient,
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number
): Promise<number> {
  const pricing = await getModelPricing(supabase, provider, modelName);

  if (!pricing) {
    console.warn(`No pricing found for ${provider}/${modelName}`);
    return 0;
  }

  const inputCost = inputTokens * pricing.input;
  const outputCost = outputTokens * pricing.output;

  return inputCost + outputCost;
}
```

---

### Phase 2: Convert Tokens to Pilot Credits (UI Only)

**Problem**: Analytics shows raw tokens instead of Pilot Credits

**Solution**: Update all formatTokens() calls and labels

**Changes Needed:**

1. **Update formatTokens Helper**
   - File: `/lib/utils/analyticsHelpers.ts`
   - Rename: `formatTokens()` → `formatPilotCredits()`
   - Formula: `pilotCredits = Math.round(tokens / 10)`

2. **Update All Labels**
   - "Tokens" → "Pilot Credits"
   - "Total Tokens" → "Total Pilot Credits"
   - "Tokens Used" → "Pilot Credits Used"

3. **Update Display Components**
   - MetricsCards.tsx - Overview cards
   - AnalyticsView.tsx - Insights, Activities, Agents tabs
   - Admin analytics page

**Code Changes:**

```typescript
// lib/utils/analyticsHelpers.ts

// OLD:
export const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return Math.floor(tokens).toLocaleString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
};

// NEW:
export const formatPilotCredits = (tokens: number | null | undefined): string => {
  if (tokens == null || typeof tokens !== 'number' || isNaN(tokens)) return '0';

  const pilotCredits = Math.round(tokens / 10); // 10 tokens = 1 Pilot Credit

  if (pilotCredits === 0) return '0';
  if (pilotCredits < 1000) return Math.floor(pilotCredits).toLocaleString();
  if (pilotCredits < 1000000) return `${(pilotCredits / 1000).toFixed(1)}K`;
  return `${(pilotCredits / 1000000).toFixed(1)}M`;
};

// Keep old function for backward compatibility, but mark deprecated
/** @deprecated Use formatPilotCredits instead */
export const formatTokens = formatPilotCredits;
```

---

### Phase 3: Add Model Breakdown in Analytics

**Enhancement**: Show cost breakdown by model used

**New Section in Insights Tab:**

```
Model Usage Breakdown
┌─────────────────────────────────────┐
│ gpt-4o-mini                         │
│ 850 Pilot Credits • $8.50 • 85%    │
│ ████████████████████░░░░░░░░        │
├─────────────────────────────────────┤
│ gpt-4o                              │
│ 150 Pilot Credits • $1.50 • 15%    │
│ ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░     │
└─────────────────────────────────────┘
```

**Benefits:**
- Users see intelligent routing is saving them money
- Shows % of requests using cheaper models
- Transparent about which models are being used

---

## Implementation Checklist

### Phase 1: Fix Cost Calculation ✅ PRIORITY
- [ ] Create `/lib/ai/pricing.ts` with database-backed pricing
- [ ] Update AIAnalyticsService to use actual model pricing
- [ ] Test cost calculation with mixed models
- [ ] Create migration script to recalculate historical costs

### Phase 2: Pilot Credits Display
- [ ] Rename `formatTokens` → `formatPilotCredits`
- [ ] Update MetricsCards.tsx labels
- [ ] Update AnalyticsView.tsx all tabs
- [ ] Update admin analytics page
- [ ] Test with various token amounts

### Phase 3: Model Breakdown (Optional Enhancement)
- [ ] Add model grouping to analytics processor
- [ ] Create ModelBreakdown component
- [ ] Add to Insights tab
- [ ] Show cost savings from intelligent routing

---

## Testing Plan

1. **Create test agent with known intensity**
2. **Run agent multiple times**
3. **Verify in analytics:**
   - Correct model shown (gpt-4o-mini vs gpt-4o)
   - Cost matches actual model pricing
   - Pilot Credits = tokens ÷ 10
4. **Test with mixed usage:**
   - Some runs with gpt-4o (high intensity)
   - Some runs with gpt-4o-mini (low intensity)
   - Verify total cost is accurate

---

## Expected Results

### Before:
```
Total Tokens: 100,000
Total Cost: $250.00 (WRONG - using gpt-4o pricing)
```

### After:
```
Total Pilot Credits: 10,000 (100k tokens ÷ 10)
Total Cost: $15.00 (CORRECT - 90% used gpt-4o-mini)

Model Breakdown:
- gpt-4o-mini: 9,000 credits ($13.50) - 90%
- gpt-4o: 1,000 credits ($2.50) - 10%
```

---

## Migration Notes

- **Backward Compatibility**: Keep `formatTokens()` as alias to `formatPilotCredits()`
- **Database**: No schema changes needed
- **Historical Data**: Optional recalculation script for accurate historical costs
- **User Communication**: Explain Pilot Credits = simpler pricing (10 tokens = 1 credit)

---

## Files to Update

### Cost Calculation:
- `/lib/ai/pricing.ts` - NEW: Database-backed pricing helpers
- `/lib/analytics/aiAnalytics.ts` - Use new pricing helpers
- `/lib/utils/usageTracker.ts` - Mark fully deprecated

### UI/Display:
- `/lib/utils/analyticsHelpers.ts` - Add formatPilotCredits
- `/components/analytics/MetricsCards.tsx` - Update labels
- `/components/analytics/AnalyticsView.tsx` - Update all tabs
- `/app/admin/analytics/page.tsx` - Update admin view

### Scripts:
- `/scripts/recalculate-analytics-costs.ts` - NEW: Fix historical data
