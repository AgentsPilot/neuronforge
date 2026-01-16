# AIS Config Page Cleanup Guide

## Sections to Remove from ais-config/page.tsx

### 1. Remove Per-Step Routing State Variables (around lines 121-150)

**Remove:**
```typescript
// Per-Step Routing state
const [routingExpanded, setRoutingExpanded] = useState(false);
const [savingRouting, setSavingRouting] = useState(false);
const [routingError, setRoutingError] = useState<string | null>(null);
const [routingSuccess, setRoutingSuccess] = useState<string | null>(null);
const [perStepRouting, setPerStepRouting] = useState({
  complexityThresholds: {
    tier1Max: 3.9,
    tier2Max: 6.9
  },
  tierModels: {
    tier1: { model: 'gpt-4o-mini', provider: 'openai' },
    tier2: { model: 'gpt-4o', provider: 'openai' },
    tier3: { model: 'o1-preview', provider: 'openai' }
  },
  complexityFactorWeights: {
    llmDecision: { promptLength: 0.25, dataSize: 0.20, conditionCount: 0.15, contextDepth: 0.20, reasoningDepth: 0.15, outputComplexity: 0.05 },
    transform: { promptLength: 0.15, dataSize: 0.35, conditionCount: 0.10, contextDepth: 0.15, reasoningDepth: 0.10, outputComplexity: 0.15 },
    conditional: { promptLength: 0.20, dataSize: 0.15, conditionCount: 0.30, contextDepth: 0.20, reasoningDepth: 0.10, outputComplexity: 0.05 },
    action: { promptLength: 0.15, dataSize: 0.25, conditionCount: 0.10, contextDepth: 0.15, reasoningDepth: 0.20, outputComplexity: 0.15 },
    apiCall: { promptLength: 0.15, dataSize: 0.30, conditionCount: 0.10, contextDepth: 0.15, reasoningDepth: 0.10, outputComplexity: 0.20 },
    default: { promptLength: 0.20, dataSize: 0.20, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.15, outputComplexity: 0.15 }
  },
  complexityScoringThresholds: {
    promptLength: { low: 200, medium: 500, high: 1000 },
    dataSize: { low: 1024, medium: 10240, high: 51200 },
    conditionCount: { low: 2, medium: 5, high: 10 },
    contextDepth: { low: 2, medium: 5, high: 10 }
  }
});
```

**Reason:** System 2 per-step routing is now managed in the Orchestration Config page

---

### 2. Remove Per-Step Routing Load Logic in fetchConfig()

**Remove from fetchConfig():**
```typescript
// Load Per-Step Routing Configuration
if (data.config.perStepRouting) {
  const r = data.config.perStepRouting;
  console.log('🔄 [Frontend] Updating perStepRouting state');
  setPerStepRouting({
    complexityThresholds: r.complexityThresholds || perStepRouting.complexityThresholds,
    tierModels: r.tierModels || perStepRouting.tierModels,
    complexityFactorWeights: r.complexityFactorWeights || perStepRouting.complexityFactorWeights,
    complexityScoringThresholds: r.complexityScoringThresholds || perStepRouting.complexityScoringThresholds
  });
}
```

**Reason:** No longer loading this configuration

---

### 3. Remove handleSavePerStepRouting() Function

**Remove entire function:**
```typescript
const handleSavePerStepRouting = async () => {
  try {
    setSavingRouting(true);
    setRoutingError(null);
    setRoutingSuccess(null);

    const response = await fetch('/api/admin/ais-config/per-step-routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: perStepRouting
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save per-step routing configuration');
    }

    setRoutingSuccess('✅ Per-step routing configuration saved successfully!');
    setTimeout(() => setRoutingSuccess(null), 5000);
  } catch (err) {
    console.error('[AIS Config] Error saving per-step routing:', err);
    setRoutingError(err instanceof Error ? err.message : 'Failed to save per-step routing configuration');
  } finally {
    setSavingRouting(false);
  }
};
```

**Reason:** Function no longer needed

---

### 4. Remove "Per-Step Routing Configuration" UI Section

**Remove entire section (large section, search for "Per-Step Routing Configuration"):**
```tsx
{/* Per-Step Routing Configuration */}
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.3 }}
  className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
>
  <button
    onClick={() => setRoutingExpanded(!routingExpanded)}
    className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
  >
    {/* Header content */}
  </button>

  {routingExpanded && (
    <div className="p-6 border-t border-white/10 space-y-6">
      {/* All per-step routing configuration UI */}
    </div>
  )}
</motion.div>
```

**This section includes:**
- Complexity thresholds (tier1Max, tier2Max)
- Tier models (tier1, tier2, tier3)
- Complexity factor weights (6 step types × 6 factors each)
- Complexity scoring thresholds (4 factors)
- Save button for per-step routing

**Reason:** This configuration is now in the Orchestration Config page

---

### 5. Add Pointer to New Orchestration Page

**Add this info box at the top of the page (after the header):**
```tsx
{/* Info Box - Routing Moved */}
<div className="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
  <div className="flex items-start gap-3">
    <Brain className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
    <div className="text-sm text-slate-300">
      <p className="font-medium text-blue-400 mb-1">Routing Configuration Moved</p>
      <p>
        <strong>Per-step routing configuration</strong> has been consolidated into the unified orchestration system.
        Visit the{' '}
        <a href="/admin/orchestration-config" className="text-blue-400 underline hover:text-blue-300">
          Orchestration Config
        </a>{' '}
        page to manage routing settings, complexity weights, and model tier configuration.
      </p>
    </div>
  </div>
</div>
```

**Reason:** Help users find the new location for routing settings

---

## Summary of Changes

### State Variables Removed:
- `routingExpanded`
- `savingRouting`
- `routingError`
- `routingSuccess`
- `perStepRouting` (entire complex object)

### Functions Removed:
- `handleSavePerStepRouting()`

### Code Sections Removed:
- Per-step routing load logic in `fetchConfig()`
- Entire "Per-Step Routing Configuration" UI section (~500 lines)

### UI Sections Kept:
- ✅ AIS Mode (best_practice vs dynamic)
- ✅ System Limits
- ✅ AIS Weights (Dimension Weights)
- ✅ Combined Score Weights
- ✅ Creation Component Weights
- ✅ Creation Ranges
- ✅ Execution Ranges

### UI Added:
- ✅ Info box pointing to new Orchestration Config page

---

## Lines to Remove (Approximate)

Based on the grep results, the per-step routing section is extensive. Here's a rough estimate:

1. **State variables:** Lines ~121-150 (30 lines)
2. **fetchConfig() loading:** Find and remove perStepRouting loading block
3. **handleSavePerStepRouting():** Find and remove entire function (~40 lines)
4. **UI section:** Large section with:
   - Section header and expand/collapse
   - Complexity thresholds inputs
   - Tier models configuration (3 tiers)
   - Complexity factor weights (6 step types × 6 factors each = extensive UI)
   - Complexity scoring thresholds (4 factors)
   - Save button
   - Success/error messages
   - **Estimated:** ~500-700 lines

**Total removal:** ~600-800 lines

---

## Testing After Cleanup

1. Navigate to `/admin/ais-config`
2. Verify page loads without errors
3. Verify info box appears pointing to Orchestration Config
4. Test remaining sections still work:
   - AIS mode switching
   - System limits save
   - AIS weights save
   - Combined score weights save
   - Creation component weights save
5. Verify no console errors about missing functions
6. Click link to Orchestration Config and verify it works

---

## Keep These Sections Unchanged

The AIS Config page should retain all AIS-specific configuration:

### ✅ AIS Mode Section
- Best practice vs dynamic mode
- Min executions threshold
- Statistics display

### ✅ System Limits Section
- Min/max agent intensity
- Min executions for score

### ✅ AIS Weights Section
- Dimension weights (tokens, execution, plugins, workflow, memory)
- Subdimension weights (execution_*, plugin_*, workflow_*, memory_*)
- Weight validation (must sum to 1.0)

### ✅ Combined Score Weights Section
- Creation weight (default: 0.3)
- Execution weight (default: 0.7)

### ✅ Creation Component Weights Section
- Workflow weight (default: 0.5)
- Plugins weight (default: 0.3)
- IO Schema weight (default: 0.2)

### ✅ Ranges Sections
- Creation Ranges (collapsible)
- Execution Ranges (collapsible)
- Dynamic range updates

---

## Related Cleanup

After AIS Config cleanup:
- [System Config cleanup](./SYSTEM_CONFIG_CLEANUP_GUIDE.md) - Remove obsolete routing sections
- Database cleanup - Remove obsolete settings
- Test new Orchestration Config page thoroughly
