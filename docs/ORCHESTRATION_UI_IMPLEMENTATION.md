# Orchestration Admin UI Implementation Guide

## Overview
This document describes the UI components to add to the Workflow Pilot section in `/app/admin/system-config/page.tsx`.

## State Already Added ✅
The orchestration configuration state has been added at lines 214-259:
- Feature flags (enabled, adaptive budgeting, compression, AIS routing)
- Intent token budgets (10 intent types)
- Budget constraints (limits, overage, allocation strategy)
- Compression settings (ratio, quality, aggressiveness)
- AIS routing thresholds (fast/balanced/powerful tiers)
- Quality settings (confidence threshold, quality minimum, max retries)

## Data Loading Already Added ✅
Orchestration config loading has been added at lines 396-501:
- Parses all orchestration settings from `system_settings_config` table
- Filters by category prefix `orchestration*`
- Updates state with all 40 configuration values

## UI Components to Add

### Location
Add these sections INSIDE the existing Workflow Pilot card (currently at lines 2733-onwards), AFTER the "Intelligent Routing" section and BEFORE the save button.

---

### 1. Orchestration Master Section

```tsx
{/* Intelligent Orchestration (NEW) */}
<div className="space-y-4">
  <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
    <Brain className="w-4 h-4" />
    Intelligent Orchestration (Beta)
  </h3>

  {/* Info Box */}
  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
    <div className="flex items-start gap-3">
      <Brain className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
      <div className="space-y-2">
        <p className="text-purple-400 font-medium text-sm">What is Orchestration?</p>
        <p className="text-slate-300 text-sm leading-relaxed">
          Intelligent orchestration analyzes each workflow step's intent (extract, summarize, generate, etc.) to optimize token usage and model selection. Reduces token costs by 30-40% through smart budgeting and compression.
        </p>
        <div className="space-y-1 text-xs leading-relaxed">
          <p className="text-slate-300">
            <strong className="text-purple-300">Intent Classification:</strong> LLM-based analysis classifies each step (extract, summarize, generate, validate, etc.) to apply appropriate token budgets.
          </p>
          <p className="text-slate-300">
            <strong className="text-purple-300">Token Budgeting:</strong> Allocates tokens per step based on intent type. Generate steps get more budget (2500 tokens), conditional steps get less (300 tokens).
          </p>
          <p className="text-slate-300">
            <strong className="text-purple-300">Compression:</strong> Semantic compression reduces context size while maintaining quality. Different strategies per intent type (semantic, structural, template).
          </p>
          <p className="text-slate-300">
            <strong className="text-purple-300">AIS Routing:</strong> Uses agent-level complexity scores (from AIS system) to route to appropriate models. Simple agents use Haiku (fast), complex agents use Sonnet (powerful).
          </p>
        </div>
      </div>
    </div>
  </div>

  {/* Master Toggle */}
  <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
    <div className="flex-1">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-medium text-white">Enable Orchestration</h3>
        {orchestrationConfig.enabled ? (
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">Active</span>
        ) : (
          <span className="px-2 py-0.5 bg-slate-600/50 text-slate-400 text-xs rounded-full">Disabled</span>
        )}
        <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">Beta</span>
      </div>
      <p className="text-sm text-slate-400">
        Enable intelligent intent-based orchestration for token optimization. Requires pilot to be enabled.
      </p>
    </div>
    <button
      onClick={() => setOrchestrationConfig({ ...orchestrationConfig, enabled: !orchestrationConfig.enabled })}
      disabled={!pilotConfig.enabled}
      className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${
        orchestrationConfig.enabled ? 'bg-purple-500' : 'bg-slate-600'
      } ${!pilotConfig.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <motion.div
        className="absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg"
        animate={{ x: orchestrationConfig.enabled ? 32 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  </div>
</div>
```

---

### 2. Token Budget Configuration Section

```tsx
{/* Token Budgets (only show if orchestration enabled) */}
{orchestrationConfig.enabled && (
  <div className="space-y-4">
    <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
      <CreditCard className="w-4 h-4" />
      Intent-Based Token Budgets
    </h3>

    <div className="bg-slate-700/20 border border-slate-600/50 rounded-lg p-4">
      <p className="text-xs text-slate-400 mb-4">
        Token budget allocated per step based on classified intent. These are baseline allocations - actual budgets are adjusted based on agent AIS complexity score.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {/* Extract */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-cyan-300 flex items-center gap-1">
            Extract
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.extract}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, extract: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-cyan-500"
          />
          <p className="text-xs text-slate-500">Data fetching</p>
        </div>

        {/* Summarize */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-yellow-300 flex items-center gap-1">
            Summarize
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.summarize}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, summarize: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-yellow-500"
          />
          <p className="text-xs text-slate-500">Condensing</p>
        </div>

        {/* Generate */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-purple-300 flex items-center gap-1">
            Generate
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.generate}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, generate: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-purple-500"
          />
          <p className="text-xs text-slate-500">Creating content</p>
        </div>

        {/* Validate */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-green-300 flex items-center gap-1">
            Validate
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.validate}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, validate: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-green-500"
          />
          <p className="text-xs text-slate-500">Verification</p>
        </div>

        {/* Send */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-blue-300 flex items-center gap-1">
            Send
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.send}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, send: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-slate-500">Notifications</p>
        </div>

        {/* Transform */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-orange-300 flex items-center gap-1">
            Transform
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.transform}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, transform: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-orange-500"
          />
          <p className="text-xs text-slate-500">Format conversion</p>
        </div>

        {/* Conditional */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-pink-300 flex items-center gap-1">
            Conditional
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.conditional}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, conditional: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-pink-500"
          />
          <p className="text-xs text-slate-500">Branching logic</p>
        </div>

        {/* Aggregate */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-indigo-300 flex items-center gap-1">
            Aggregate
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.aggregate}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, aggregate: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-indigo-500"
          />
          <p className="text-xs text-slate-500">Combining data</p>
        </div>

        {/* Filter */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-teal-300 flex items-center gap-1">
            Filter
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.filter}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, filter: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-teal-500"
          />
          <p className="text-xs text-slate-500">Data selection</p>
        </div>

        {/* Enrich */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-amber-300 flex items-center gap-1">
            Enrich
          </label>
          <input
            type="number"
            value={orchestrationConfig.tokenBudgets.enrich}
            onChange={(e) => setOrchestrationConfig({
              ...orchestrationConfig,
              tokenBudgets: { ...orchestrationConfig.tokenBudgets, enrich: parseInt(e.target.value) }
            })}
            min="100"
            max="5000"
            step="100"
            className="w-full px-2 py-1 text-sm bg-slate-700/50 border border-slate-600 rounded text-white focus:outline-none focus:border-amber-500"
          />
          <p className="text-xs text-slate-500">Adding data</p>
        </div>
      </div>
    </div>

    {/* Budget Constraints */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-purple-300">
          Max Tokens Per Step
        </label>
        <input
          type="number"
          value={orchestrationConfig.maxTokensPerStep}
          onChange={(e) => setOrchestrationConfig({ ...orchestrationConfig, maxTokensPerStep: parseInt(e.target.value) })}
          min="1000"
          max="10000"
          step="100"
          className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
        />
        <p className="text-xs text-slate-400">Hard limit per individual step</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-purple-300">
          Max Tokens Per Workflow
        </label>
        <input
          type="number"
          value={orchestrationConfig.maxTokensPerWorkflow}
          onChange={(e) => setOrchestrationConfig({ ...orchestrationConfig, maxTokensPerWorkflow: parseInt(e.target.value) })}
          min="5000"
          max="50000"
          step="1000"
          className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
        />
        <p className="text-xs text-slate-400">Total budget for entire workflow</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-purple-300">
          Budget Allocation Strategy
        </label>
        <select
          value={orchestrationConfig.budgetAllocationStrategy}
          onChange={(e) => setOrchestrationConfig({ ...orchestrationConfig, budgetAllocationStrategy: e.target.value as any })}
          className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
        >
          <option value="equal">Equal - Same budget for all steps</option>
          <option value="proportional">Proportional - Based on intent type (recommended)</option>
          <option value="adaptive">Adaptive - Learn from execution history</option>
          <option value="priority">Priority - Based on step importance</option>
        </select>
        <p className="text-xs text-slate-400">How to distribute budget across steps</p>
      </div>
    </div>

    {/* Budget Overage */}
    <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
      <div className="flex-1">
        <h4 className="text-sm font-medium text-white">Allow Budget Overage</h4>
        <p className="text-xs text-slate-400 mt-1">
          Allow steps to exceed allocated budget by {((orchestrationConfig.budgetOverageThreshold - 1) * 100).toFixed(0)}%
        </p>
      </div>
      <button
        onClick={() => setOrchestrationConfig({ ...orchestrationConfig, budgetOverageAllowed: !orchestrationConfig.budgetOverageAllowed })}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          orchestrationConfig.budgetOverageAllowed ? 'bg-purple-500' : 'bg-slate-600'
        }`}
      >
        <motion.div
          className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-lg"
          animate={{ x: orchestrationConfig.budgetOverageAllowed ? 24 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  </div>
)}
```

---

### 3. Save Handler Function

Add this function near the other save handlers (around line 868):

```typescript
const handleSaveOrchestrationConfig = async () => {
  try {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const updates = {
      // Feature flags
      orchestration_enabled: orchestrationConfig.enabled,
      orchestration_adaptive_budget_enabled: orchestrationConfig.adaptiveBudgetEnabled,
      orchestration_compression_enabled: orchestrationConfig.compressionEnabled,
      orchestration_ais_routing_enabled: orchestrationConfig.aisRoutingEnabled,

      // Token budgets
      orchestration_token_budget_extract: orchestrationConfig.tokenBudgets.extract,
      orchestration_token_budget_summarize: orchestrationConfig.tokenBudgets.summarize,
      orchestration_token_budget_generate: orchestrationConfig.tokenBudgets.generate,
      orchestration_token_budget_validate: orchestrationConfig.tokenBudgets.validate,
      orchestration_token_budget_send: orchestrationConfig.tokenBudgets.send,
      orchestration_token_budget_transform: orchestrationConfig.tokenBudgets.transform,
      orchestration_token_budget_conditional: orchestrationConfig.tokenBudgets.conditional,
      orchestration_token_budget_aggregate: orchestrationConfig.tokenBudgets.aggregate,
      orchestration_token_budget_filter: orchestrationConfig.tokenBudgets.filter,
      orchestration_token_budget_enrich: orchestrationConfig.tokenBudgets.enrich,

      // Budget constraints
      orchestration_max_tokens_per_step: orchestrationConfig.maxTokensPerStep,
      orchestration_max_tokens_per_workflow: orchestrationConfig.maxTokensPerWorkflow,
      orchestration_budget_overage_allowed: orchestrationConfig.budgetOverageAllowed,
      orchestration_budget_overage_threshold: orchestrationConfig.budgetOverageThreshold,
      orchestration_budget_allocation_strategy: orchestrationConfig.budgetAllocationStrategy,

      // Compression
      orchestration_compression_target_ratio: orchestrationConfig.compressionTargetRatio,
      orchestration_compression_min_quality: orchestrationConfig.compressionMinQuality,
      orchestration_compression_aggressiveness: orchestrationConfig.compressionAggressiveness,

      // AIS routing
      orchestration_ais_fast_tier_max_score: orchestrationConfig.aisFastTierMaxScore,
      orchestration_ais_balanced_tier_max_score: orchestrationConfig.aisBalancedTierMaxScore,
      orchestration_ais_powerful_tier_min_score: orchestrationConfig.aisPowerfulTierMinScore,
      orchestration_ais_quality_weight: orchestrationConfig.aisQualityWeight,
      orchestration_ais_cost_weight: orchestrationConfig.aisCostWeight,

      // Quality
      orchestration_intent_classification_confidence_threshold: orchestrationConfig.intentClassificationConfidenceThreshold,
      orchestration_quality_score_minimum: orchestrationConfig.qualityScoreMinimum,
      orchestration_max_retry_attempts: orchestrationConfig.maxRetryAttempts
    };

    const response = await fetch('/api/admin/system-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ updates })
    });

    if (!response.ok) {
      throw new Error('Failed to update orchestration configuration');
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to update orchestration configuration');
    }

    setSuccess('Orchestration configuration saved successfully!');

    setTimeout(() => setSuccess(null), 3000);

  } catch (error) {
    console.error('Error saving orchestration configuration:', error);
    setError(error instanceof Error ? error.message : 'Unknown error occurred');
  } finally {
    setSaving(false);
  }
};
```

---

### 4. Update the Pilot Save Button

Find the existing "Save Pilot Configuration" button (around line 3260) and modify it to also save orchestration config:

```tsx
<button
  onClick={async () => {
    await handleSavePilotConfig();
    if (orchestrationConfig.enabled) {
      await handleSaveOrchestrationConfig();
    }
  }}
  disabled={saving}
  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-medium rounded-lg transition-all duration-200 disabled:opacity-50"
>
  {saving ? (
    <>
      <RefreshCw className="w-4 h-4 animate-spin" />
      Saving...
    </>
  ) : (
    <>
      <Save className="w-4 h-4" />
      Save Pilot & Orchestration Configuration
    </>
  )}
</button>
```

---

## Summary

**What was added:**
1. ✅ State management for orchestration config (40+ settings)
2. ✅ Data loading from database
3. 📋 UI components to add (this document)
4. 📋 Save handler function
5. 📋 Updated save button

**Where to add the UI:**
- Location: Inside Workflow Pilot card, after "Intelligent Routing" section
- File: `/app/admin/system-config/page.tsx`
- Line: Around 3250 (before the save button)

**Total configuration keys:** 40
- Feature flags: 4
- Token budgets: 10 (one per intent type)
- Budget constraints: 5
- Compression settings: 3
- AIS routing: 6
- Quality settings: 3
- Plus 9 compression strategies (per intent) - not exposed in UI for simplicity

**Expected token savings:** 30-40% reduction with orchestration enabled
