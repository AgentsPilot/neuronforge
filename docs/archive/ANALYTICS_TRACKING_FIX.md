# Analytics Tracking Fix - Missing Token Usage Records

## Problem Found! 🎯

Agent executions with intelligent routing are **NOT being tracked** in the `token_usage` table, so they don't appear in analytics!

### Evidence:

**Execution with gpt-4o-mini:**
- ✅ Logged in `audit_trail` (model_used: gpt-4o-mini, 9308 tokens)
- ❌ **NOT in `token_usage` table** (completely missing!)
- ❌ Logged in `agent_logs` with WRONG model (shows gpt-4o)

**Result**: Analytics page shows NOTHING for this execution!

---

## Root Cause

### Problem Flow:

```
runAgentKit.ts
  ↓
ProviderFactory.getProvider('openai')
  ↓
new OpenAIProvider(apiKey)  ← NO ANALYTICS PASSED!
  ↓
BaseProvider.callWithTracking()
  ↓
this.analytics?.track()  ← analytics is undefined!
  ↓
❌ Nothing tracked in token_usage table
```

### The Bug:

**File**: `/lib/ai/providerFactory.ts` (Line 58)

```typescript
// CURRENT (BROKEN):
this.openaiInstance = new OpenAIProvider(apiKey);  // ← Missing analytics!

// SHOULD BE:
const aiAnalytics = AIAnalyticsService.getInstance(supabase);
this.openaiInstance = new OpenAIProvider(apiKey, aiAnalytics);
```

---

## The Fix

### Step 1: Update ProviderFactory

**File**: `/lib/ai/providerFactory.ts`

```typescript
import { OpenAIProvider } from './providers/openaiProvider';
import { AnthropicProvider } from './providers/anthropicProvider';
import { BaseAIProvider } from './providers/baseProvider';
import { AIAnalyticsService } from '../analytics/aiAnalytics';  // ADD THIS
import { createClient } from '@supabase/supabase-js';  // ADD THIS

export class ProviderFactory {
  private static openaiInstance: OpenAIProvider | null = null;
  private static anthropicInstance: AnthropicProvider | null = null;
  private static aiAnalytics: AIAnalyticsService | null = null;  // ADD THIS

  // ADD THIS METHOD
  private static getAnalytics(): AIAnalyticsService {
    if (!this.aiAnalytics) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      this.aiAnalytics = AIAnalyticsService.getInstance(supabase);
    }
    return this.aiAnalytics;
  }

  private static getOpenAIProvider(): OpenAIProvider {
    if (!this.openaiInstance) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not configured.');
      }

      console.log('🔧 Initializing OpenAI Provider WITH analytics');
      const analytics = this.getAnalytics();  // ADD THIS
      this.openaiInstance = new OpenAIProvider(apiKey, analytics);  // CHANGE THIS
    }
    return this.openaiInstance;
  }

  private static getAnthropicProvider(): AnthropicProvider {
    if (!this.anthropicInstance) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is not configured.');
      }

      console.log('🔧 Initializing Anthropic Provider WITH analytics');
      const analytics = this.getAnalytics();  // ADD THIS
      this.anthropicInstance = new AnthropicProvider(apiKey, analytics);  // CHANGE THIS
    }
    return this.anthropicInstance;
  }

  static clearInstances(): void {
    console.log('🧹 Clearing provider instances');
    this.openaiInstance = null;
    this.anthropicInstance = null;
    this.aiAnalytics = null;  // ADD THIS
  }
}
```

---

## Expected Results After Fix

### Before:
```
Agent runs with gpt-4o-mini
→ audit_trail: ✅ Recorded (model_used: gpt-4o-mini)
→ token_usage: ❌ MISSING
→ agent_logs: ❌ Wrong model (gpt-4o)
→ Analytics: ❌ Shows nothing
```

### After:
```
Agent runs with gpt-4o-mini
→ audit_trail: ✅ Recorded (model_used: gpt-4o-mini)
→ token_usage: ✅ Recorded (model_name: gpt-4o-mini, correct cost)
→ agent_logs: ✅ Correct model (gpt-4o-mini)
→ Analytics: ✅ Shows execution with correct model and cost
```

---

## Testing Plan

1. **Apply the fix** to ProviderFactory
2. **Restart server** to clear provider cache
3. **Run agent with LOW intensity** (should use gpt-4o-mini)
4. **Verify in database**:
   ```sql
   SELECT * FROM token_usage
   WHERE model_name = 'gpt-4o-mini'
   ORDER BY created_at DESC LIMIT 1;
   ```
5. **Check analytics page** - Should show the execution
6. **Verify cost calculation** - Should use gpt-4o-mini pricing

---

## Additional Findings

### agent_logs Model Name Issue

The `agent_logs` table is also showing wrong model (gpt-4o instead of gpt-4o-mini).

**File**: `/app/api/run-agent/route.ts` (Lines 187-194)

We already fixed this in the earlier session by adding `result.model`:

```typescript
full_output: {
  message: result.response,
  agentkit_metadata: {
    model: result.model || 'gpt-4o',  // ✅ Already fixed
    // ...
  }
}
```

This should now work correctly once AgentKit returns the model.

---

## Impact

### Before Fix:
- ❌ No analytics data for intelligent routing executions
- ❌ Can't see cost savings
- ❌ Can't track model usage
- ❌ Analytics is incomplete

### After Fix:
- ✅ Complete analytics data
- ✅ Accurate cost tracking
- ✅ Model usage visibility
- ✅ Intelligent routing savings shown
- ✅ Correct pricing (gpt-4o-mini vs gpt-4o)

---

## Files to Update

1. ✅ `/lib/ai/providerFactory.ts` - Add AIAnalyticsService
2. ⏹️ `/lib/agentkit/runAgentKit.ts` - No changes needed
3. ⏹️ `/lib/ai/providers/openaiProvider.ts` - No changes needed
4. ⏹️ `/app/api/run-agent/route.ts` - Already fixed in previous session

---

## Priority: CRITICAL 🔴

This fix is critical because:
1. Analytics is completely broken for intelligent routing
2. Users can't see their actual usage
3. Cost tracking is inaccurate
4. Intelligent routing savings are invisible

**Estimated time**: 10 minutes to implement and test
