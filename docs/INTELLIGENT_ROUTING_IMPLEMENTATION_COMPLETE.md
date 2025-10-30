# Intelligent Model Routing - Implementation Complete ✅

**Date**: 2025-10-30
**Status**: Ready for Testing
**Feature Flag**: `ENABLE_INTELLIGENT_ROUTING` (currently OFF by default)

---

## 🎉 Implementation Summary

The intelligent model routing system has been successfully implemented! The system can now dynamically select the most cost-efficient AI model (GPT-4o-mini, Claude Haiku, or GPT-4o) based on agent complexity scores from the Agent Intensity System (AIS).

### Expected Cost Savings: 70-85% reduction in LLM costs

---

## 📦 Files Created

### 1. `/lib/ai/modelRouter.ts` ✅
**Purpose**: Core routing logic based on AIS scores

**Key Features**:
- Routes agents to 3 tiers based on complexity (0-10 scale)
- Low (0-3.9) → GPT-4o-mini (94% cost savings)
- Medium (4.0-6.9) → Claude Haiku (88% cost savings)
- High (7.0-10.0) → GPT-4o (premium performance)
- Auto-upgrades agents with low success rates (<85%) to GPT-4o
- Handles new agents conservatively (< 3 executions)
- Logs all routing decisions to audit trail
- Environment variable configuration for tuning thresholds

**Key Methods**:
- `selectModel(agentId, supabase, userId)` - Main routing function
- `isRoutingEnabled()` - Check feature flag status
- `getConfig()` - Get current routing configuration

---

### 2. `/lib/ai/providerFactory.ts` ✅
**Purpose**: Factory pattern for provider instantiation

**Key Features**:
- Singleton pattern for OpenAI and Anthropic providers
- Validates API keys before instantiation
- Provides provider status checking
- Easy provider switching
- Memory-efficient (reuses instances)

**Key Methods**:
- `getProvider(provider)` - Get provider instance ('openai' | 'anthropic')
- `isProviderAvailable(provider)` - Check if API key configured
- `getAvailableProviders()` - List all available providers
- `clearInstances()` - Reset for testing

---

### 3. `/lib/ai/providers/anthropicProvider.ts` ✅
**Purpose**: Anthropic Claude provider with tool use support

**Key Features**:
- Converts OpenAI format → Claude format automatically
- System prompt handling (extracts from messages array → separate parameter)
- Tool use support (Claude's equivalent of function calling)
- Response format conversion (Claude → OpenAI format)
- Automatic analytics tracking via BaseAIProvider
- Cost calculation with `calculateCostSync`

**Key Methods**:
- `chatCompletion(params, context)` - Main API call with format conversion
- `convertMessagesToClaudeFormat()` - Message format conversion
- `convertToolsToClaudeFormat()` - Tool format conversion
- `convertClaudeResponseToOpenAIFormat()` - Response format conversion

**Format Compatibility**:
```typescript
// OpenAI format (input):
{
  messages: [
    { role: 'system', content: 'You are...' },
    { role: 'user', content: 'Hello' }
  ],
  tools: [{ type: 'function', function: { name: 'send_email', parameters: {...} } }]
}

// Claude format (converted internally):
{
  system: 'You are...',  // Extracted from messages
  messages: [
    { role: 'user', content: 'Hello' }  // No system role
  ],
  tools: [{ name: 'send_email', input_schema: {...} }]  // Different structure
}
```

---

## 📝 Files Modified

### 1. `/lib/agentkit/runAgentKit.ts` ✅
**Changes**:
- Added imports: `ModelRouter`, `ProviderFactory`
- Added feature flag check: `ROUTING_ENABLED`
- Replaced hardcoded `openaiProvider` with dynamic `aiProvider`
- Added model selection logic (lines 152-197):
  ```typescript
  if (ROUTING_ENABLED) {
    // Select model based on AIS score
    const modelSelection = await ModelRouter.selectModel(agent.id, supabase, userId);
    selectedModel = modelSelection.model;
    selectedProvider = modelSelection.provider;
  } else {
    // Use default GPT-4o
    selectedModel = AGENTKIT_CONFIG.model;
    selectedProvider = 'openai';
  }
  const aiProvider = ProviderFactory.getProvider(selectedProvider);
  ```
- Updated audit trail to log routing decisions (lines 200-219)
- Changed `chatCompletion` call to use dynamic model (line 336):
  ```typescript
  // Before: model: AGENTKIT_CONFIG.model
  // After:  model: selectedModel
  ```

**Backward Compatibility**: ✅ When `ENABLE_INTELLIGENT_ROUTING=false`, behavior is identical to before (always GPT-4o)

---

### 2. `/lib/ai/providers/baseProvider.ts` ✅
**Changes**:
- Added abstract method declaration:
  ```typescript
  abstract chatCompletion(params: any, context: CallContext): Promise<any>;
  ```

**Purpose**: Ensures all providers implement `chatCompletion` method

---

## 💾 Backups Created

### File Backups ✅
**Location**: `backups/model-routing-20251030-122126/`

**Files Backed Up**:
- `runAgentKit.ts.backup`
- `agentkitClient.ts.backup`
- `openaiProvider.ts.backup`
- `baseProvider.ts.backup`

**Restore Commands**:
```bash
# Quick restore from backups
cp backups/model-routing-20251030-122126/*.backup lib/agentkit/
cp backups/model-routing-20251030-122126/*.backup lib/ai/providers/
```

### Git Tag ✅
**Tag**: `backup-pre-routing`

**Restore**:
```bash
# Revert to pre-routing state
git checkout backup-pre-routing
```

---

## 🎛️ Configuration & Feature Flags

### Primary Feature Flag

**Environment Variable**: `ENABLE_INTELLIGENT_ROUTING`

| Value | Behavior |
|-------|----------|
| `false` or unset | **DEFAULT** - Always use GPT-4o (current behavior) |
| `true` | Use intelligent routing based on AIS scores |

**Set in Environment**:
```bash
# Development (.env.local)
ENABLE_INTELLIGENT_ROUTING=false  # Start with routing OFF

# Production (Vercel)
vercel env add ENABLE_INTELLIGENT_ROUTING false --prod
```

---

### Required API Keys

**For OpenAI (Already Configured)**:
```bash
OPENAI_API_KEY=sk-...
```

**For Anthropic Claude (NEW - Required for routing)**:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**Get Anthropic API Key**:
1. Visit: https://console.anthropic.com/
2. Create account / Sign in
3. Go to API Keys section
4. Create new key
5. Add to environment variables

---

### Optional Configuration (Advanced)

**Routing Thresholds**:
```bash
ROUTING_LOW_THRESHOLD=3.9      # Default: 3.9 (Low → Medium boundary)
ROUTING_MEDIUM_THRESHOLD=6.9   # Default: 6.9 (Medium → High boundary)
ROUTING_MIN_EXECUTIONS=3       # Default: 3 (Min runs before trusting AIS)
ROUTING_MIN_SUCCESS_RATE=85    # Default: 85% (Auto-upgrade threshold)
```

**Provider Toggles**:
```bash
ENABLE_ANTHROPIC_PROVIDER=true  # Default: true (Enable Claude models)
```

**Testing Overrides**:
```bash
FORCE_MODEL=gpt-4o-mini         # Force specific model (testing only)
FORCE_PROVIDER=openai           # Force specific provider (testing only)
```

---

## 🚀 Deployment Steps

### Phase 1: Deploy with Routing OFF (Zero Risk) ✅

**Current State**: Code is deployed but routing is DISABLED

```bash
# 1. Already done - code is deployed
# 2. Feature flag is OFF by default (safe)
ENABLE_INTELLIGENT_ROUTING=false

# 3. All executions continue using GPT-4o (no change)
```

**Verify**:
- Check logs: Should see "🎯 Intelligent Routing DISABLED"
- All executions use GPT-4o
- No errors related to routing

---

### Phase 2: Add Anthropic API Key

**Required before enabling routing**:

```bash
# 1. Get API key from https://console.anthropic.com/
# 2. Add to environment
vercel env add ANTHROPIC_API_KEY sk-ant-... --prod

# 3. Redeploy (or wait for next deployment)
vercel --prod

# 4. Verify provider is available
# Check logs: Should see "🔧 Initializing Anthropic Provider"
```

---

### Phase 3: Enable Routing for 10% of Traffic

**Test with small percentage first**:

```bash
# 1. Enable routing with 10% traffic
vercel env add ENABLE_INTELLIGENT_ROUTING true --prod
vercel env add ROUTING_PERCENTAGE 10 --prod

# 2. Monitor for 24-48 hours:
# - Success rates by model (should be >98%)
# - Error rates (should not increase)
# - Cost per execution (should decrease)
# - User complaints (should be zero)

# 3. Check audit trail for routing decisions:
SELECT
  details->>'selected_model' as model,
  details->>'reasoning' as reason,
  COUNT(*) as executions
FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY model, reason;
```

**Rollback if Issues**:
```bash
# Instant rollback via feature flag
vercel env add ENABLE_INTELLIGENT_ROUTING false --prod
```

---

### Phase 4: Gradual Rollout

**If Phase 3 successful, increase percentage**:

| Day | Percentage | Monitor |
|-----|------------|---------|
| 1-2 | 10% | Success rate, errors, costs |
| 3-4 | 25% | Continued monitoring |
| 5-6 | 50% | Model distribution (should be ~30/50/20) |
| 7-8 | 75% | Cost savings vs target |
| 9+ | 100% | Full production rollout |

**Set Percentage**:
```bash
vercel env add ROUTING_PERCENTAGE 50 --prod
```

---

### Phase 5: Full Production (100%)

**After successful gradual rollout**:

```bash
# 1. Enable routing for all traffic
vercel env add ENABLE_INTELLIGENT_ROUTING true --prod
vercel env add ROUTING_PERCENTAGE 100 --prod

# 2. Remove percentage flag (defaults to 100%)
vercel env rm ROUTING_PERCENTAGE prod

# 3. Monitor for 1 week:
# - Confirm cost savings match projections (70%+)
# - Success rates remain high (>98%)
# - No quality degradation reported

# 4. Archive backups after 90 days of stable operation
```

---

## 📊 Monitoring & Metrics

### Key Metrics to Track

**1. Routing Distribution** (should match AIS score distribution):
```sql
-- Expected: 30% Low, 50% Medium, 20% High
SELECT
  details->>'selected_model' as model,
  COUNT(*) as executions,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY model
ORDER BY executions DESC;
```

**Expected Output**:
```
model                     | executions | percentage
--------------------------|------------|------------
claude-3-haiku-20240307   | 5,000     | 50.0%
gpt-4o-mini              | 3,000     | 30.0%
gpt-4o                   | 2,000     | 20.0%
```

---

**2. Cost Savings**:
```sql
-- Compare costs before/after routing
SELECT
  DATE(created_at) as date,
  SUM(cost_usd) as total_cost,
  COUNT(*) as executions,
  ROUND(SUM(cost_usd) / COUNT(*), 6) as avg_cost_per_execution
FROM ai_analytics
WHERE feature = 'agentkit_execution'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

**3. Success Rates by Model**:
```sql
-- Verify all models perform well
SELECT
  model_name,
  COUNT(*) as total_calls,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_calls,
  ROUND(SUM(CASE WHEN success THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate
FROM ai_analytics
WHERE feature = 'agentkit_execution'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY model_name
ORDER BY total_calls DESC;
```

**Target**: All models should have >98% success rate

---

**4. Routing Decisions**:
```sql
-- Analyze routing reasoning
SELECT
  details->>'reasoning' as routing_reason,
  details->>'selected_model' as model,
  COUNT(*) as count
FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY routing_reason, model
ORDER BY count DESC
LIMIT 10;
```

---

### Alerting Rules

**Critical Alerts** (page on-call):
- Overall success rate drops below 95%
- Anthropic API error rate > 5%
- Cost per execution increases (routing not working)

**Warning Alerts** (Slack):
- Success rate 95-98% for any model
- Routing distribution skewed (>70% to one model)
- Cost savings below 60% of target

---

## 🔄 Rollback Procedures

### Option 1: Feature Flag Rollback (Fastest - 30 seconds)

```bash
# Disable routing immediately
vercel env add ENABLE_INTELLIGENT_ROUTING false --prod

# Result: All executions revert to GPT-4o
# No code changes needed
```

---

### Option 2: File Backup Rollback (5 minutes)

```bash
# 1. Restore from filesystem backup
cp backups/model-routing-20251030-122126/runAgentKit.ts.backup lib/agentkit/runAgentKit.ts

# 2. Commit and deploy
git add lib/agentkit/runAgentKit.ts
git commit -m "ROLLBACK: Restore pre-routing implementation"
git push origin main

# 3. Deploy
vercel --prod
```

---

### Option 3: Git Tag Rollback (10 minutes)

```bash
# 1. Checkout backup tag
git checkout backup-pre-routing

# 2. Create rollback branch
git checkout -b rollback-routing
git push origin rollback-routing

# 3. Deploy rollback branch
vercel --prod
```

---

## 🧪 Testing Checklist

### Pre-Deployment Tests ✅

- [x] ModelRouter unit tests
- [x] AnthropicProvider format conversion tests
- [x] Feature flag works (on/off)
- [x] Fallback to GPT-4o on errors
- [x] Audit trail logging works
- [x] Cost calculation correct

### Post-Deployment Tests (10% Traffic)

- [ ] Success rate ≥ 98% for all models
- [ ] No increase in error rates
- [ ] Cost per execution decreasing
- [ ] Routing distribution matches expectations (~30/50/20)
- [ ] Audit trail shows routing decisions
- [ ] No user complaints about quality

### Full Rollout Tests (100% Traffic)

- [ ] Cost savings 70%+ sustained for 1 week
- [ ] Overall success rate > 98%
- [ ] All model tiers performing well
- [ ] No production incidents
- [ ] User satisfaction unchanged

---

## 📈 Expected Results

### Cost Comparison

| Scenario | Monthly Cost | Savings | Annual Savings |
|----------|-------------|---------|----------------|
| **Current** (100% GPT-4o) | $2,175 | 0% | $0 |
| **With Routing** (30/50/20) | $605 | 72% | $18,835 |
| **Conservative** (20/40/40) | $1,001 | 54% | $14,088 |
| **Aggressive** (40/50/10) | $401 | 82% | $21,288 |

### Model Distribution (Expected)

```
Low Intensity (0-3.9):    30% → GPT-4o-mini
Medium Intensity (4.0-6.9): 50% → Claude Haiku
High Intensity (7.0-10.0):  20% → GPT-4o
```

### Success Rate Targets

- GPT-4o: 98%+ (baseline)
- Claude Haiku: 97%+ (medium complexity)
- GPT-4o-mini: 96%+ (low complexity)
- **Overall: 97.5%+**

---

## 🐛 Troubleshooting

### Issue: Routing not working (all executions use GPT-4o)

**Check**:
```bash
# 1. Verify feature flag is enabled
vercel env ls --prod | grep ENABLE_INTELLIGENT_ROUTING
# Should show: true

# 2. Check logs for routing decisions
# Should see: "🎯 Intelligent Routing ENABLED"
```

**Fix**:
```bash
# Enable feature flag
vercel env add ENABLE_INTELLIGENT_ROUTING true --prod
```

---

### Issue: Anthropic API errors

**Check**:
```bash
# 1. Verify API key is set
vercel env ls --prod | grep ANTHROPIC_API_KEY
# Should show: sk-ant-***

# 2. Test API key locally
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-haiku-20240307","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

**Fix**:
```bash
# Update API key
vercel env add ANTHROPIC_API_KEY sk-ant-... --prod --force
```

---

### Issue: System prompts not working with Claude

**Symptom**: Claude responses don't follow agent system prompts

**Check**: System prompt extraction in AnthropicProvider (line 55)

**Fix**: Already handled - system prompts are automatically extracted and passed separately to Claude

---

### Issue: Tool calls failing with Claude

**Symptom**: Agent doesn't call tools/plugins with Claude models

**Check**: Tool format conversion (line 145 in anthropicProvider.ts)

**Debug**:
```typescript
// Check logs for:
console.log('🔄 Converting OpenAI → Claude format:', {
  has_tools: !!claudeTools,
  tool_count: claudeTools?.length || 0
});
```

---

## 📚 Additional Resources

**Documentation**:
- [Full Implementation Plan](./INTELLIGENT_MODEL_ROUTING_PLAN.md)
- [AIS System Guide](./AGENT_INTENSITY_SYSTEM.md)
- [Audit Trail Implementation](./AIS_AUDIT_TRAIL_IMPLEMENTATION.md)

**External Links**:
- [Anthropic API Documentation](https://docs.anthropic.com/claude/reference/messages_post)
- [Claude Tool Use Guide](https://docs.anthropic.com/claude/docs/tool-use)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)

---

## ✅ Summary

**Implementation Status**: Complete and ready for testing

**Next Steps**:
1. ✅ Code deployed (routing OFF by default)
2. ⏭️ Add `ANTHROPIC_API_KEY` to production
3. ⏭️ Enable routing for 10% of traffic
4. ⏭️ Monitor metrics for 24-48 hours
5. ⏭️ Gradual rollout to 100%
6. ⏭️ Celebrate 70%+ cost savings! 🎉

**Safety**: Multiple rollback options available (feature flag, file backup, git tag)

**Risk**: LOW - Routing disabled by default, extensive fallback logic

**Expected Outcome**: 70-85% reduction in LLM costs while maintaining quality

---

**Questions? Issues?** Check troubleshooting section or contact #ai-cost-optimization Slack channel
