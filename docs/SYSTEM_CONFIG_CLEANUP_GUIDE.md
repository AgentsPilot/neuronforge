# System Config Page Cleanup Guide

## Sections to Remove from system-config/page.tsx

### 1. Remove State Variables (around lines 56-68)

**Remove:**
```typescript
// Routing configuration state
const [routingEnabled, setRoutingEnabled] = useState(false);
const [lowThreshold, setLowThreshold] = useState(3.9);
const [mediumThreshold, setMediumThreshold] = useState(6.9);
const [minSuccessRate, setMinSuccessRate] = useState(85);
const [anthropicEnabled, setAnthropicEnabled] = useState(true);

// Model routing configuration state (Phase 3)
const [modelRoutingConfig, setModelRoutingConfig] = useState({
  low: { model: 'gpt-4o-mini', provider: 'openai' as 'openai' | 'anthropic' },
  medium: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' as 'openai' | 'anthropic' },
  high: { model: 'gpt-4o', provider: 'openai' as 'openai' | 'anthropic' }
});
const [savingModelRouting, setSavingModelRouting] = useState(false);
```

**Reason:** These control obsolete routing systems (System 1 & Phase 3)

---

### 2. Remove fetchConfig() Routing Parsing (around lines 293-306)

**Remove:**
```typescript
// Parse routing settings
const routingSettings = settingsResult.data.filter((s: SystemSetting) => s.category === 'routing');
routingSettings.forEach((setting: SystemSetting) => {
  switch (setting.key) {
    case 'intelligent_routing_enabled':
      setRoutingEnabled(setting.value === true || setting.value === 'true');
      break;
    case 'routing_low_threshold':
      setLowThreshold(parseFloat(setting.value));
      break;
    case 'routing_medium_threshold':
      setMediumThreshold(parseFloat(setting.value));
      break;
    case 'routing_min_success_rate':
      setMinSuccessRate(parseInt(setting.value));
      break;
  }
});
```

**Reason:** Loads obsolete System 1 settings

---

### 3. Remove fetchConfig() Model Routing API Call (around lines 628-650)

**Remove:**
```typescript
// Fetch model routing configuration (Phase 3)
try {
  const modelRoutingResponse = await fetch('/api/admin/model-routing', {
    headers: {
      'Content-Type': 'application/json',
    }
  });

  if (modelRoutingResponse.ok) {
    const modelRoutingResult = await modelRoutingResponse.json();
    console.log('[SystemConfig] Model routing result:', modelRoutingResult);

    if (modelRoutingResult.success && modelRoutingResult.config) {
      setModelRoutingConfig(modelRoutingResult.config);
      console.log('[SystemConfig] ✅ Model routing config loaded successfully');
    } else {
      console.error('[SystemConfig] ❌ Model routing API returned unsuccessful');
    }
  } else {
    console.error('[SystemConfig] ❌ Model routing API returned non-OK status:', modelRoutingResponse.status);
  }
} catch (modelRoutingError) {
  console.error('[SystemConfig] ❌ Failed to fetch model routing config:', modelRoutingError);
}
```

**Reason:** Calls deleted API endpoint

---

### 4. Remove handleSaveRoutingConfig() Function (around lines 662-706)

**Remove entire function:**
```typescript
const handleSaveRoutingConfig = async () => {
  try {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const updates = {
      intelligent_routing_enabled: routingEnabled,
      routing_low_threshold: lowThreshold,
      routing_medium_threshold: mediumThreshold,
      routing_min_success_rate: minSuccessRate,
      anthropic_provider_enabled: anthropicEnabled
    };

    const response = await fetch('/api/admin/system-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: updates })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save routing configuration');
    }

    setSuccess('✅ Routing configuration saved successfully!');
    setTimeout(() => setSuccess(null), 5000);

    // Refresh config
    await fetchConfig();
  } catch (error) {
    console.error('Error saving routing config:', error);
    setError(error instanceof Error ? error.message : 'Failed to save routing configuration');
  } finally {
    setSaving(false);
  }
};
```

**Reason:** Saves obsolete System 1 settings

---

### 5. Remove handleSaveModelRoutingConfig() Function (around lines 708-736)

**Remove entire function:**
```typescript
const handleSaveModelRoutingConfig = async () => {
  try {
    setSavingModelRouting(true);
    setError(null);
    setSuccess(null);

    console.log('[SystemConfig] Saving model routing config:', modelRoutingConfig);

    const response = await fetch('/api/admin/model-routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: modelRoutingConfig })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `Failed to save model routing config: ${response.status}`);
    }

    setSuccess('✅ Model routing configuration saved successfully!');
    console.log('[SystemConfig] ✅ Model routing config saved');
    setTimeout(() => setSuccess(null), 5000);
  } catch (error) {
    console.error('[SystemConfig] Error saving model routing config:', error);
    setError(error instanceof Error ? error.message : 'Failed to save model routing configuration');
  } finally {
    setSavingModelRouting(false);
  }
};
```

**Reason:** Saves to deleted API endpoint

---

### 6. Remove "Intelligent Model Routing" UI Section (around lines 1181-1540)

**Remove entire section:**
```tsx
{/* Intelligent Routing Configuration */}
<motion.div ...>
  <div className="p-6 border-b border-white/10">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Zap className="w-6 h-6 text-yellow-400" />
        <div>
          <h3 className="text-xl font-bold text-white">
            Intelligent Model Routing
          </h3>
          <p className="text-sm text-slate-400">
            Route agents to cost-efficient AI models based on complexity scores. Reduces costs by up to 94%.
          </p>
        </div>
      </div>
      {/* Toggle and other UI */}
    </div>
  </div>
  {/* Rest of section content */}
</motion.div>
```

**Reason:** This is System 1 UI - completely obsolete

---

### 7. Remove Pilot Config Per-Step Routing Fields (around lines 763-765)

**In handleSavePilotConfig(), remove:**
```typescript
// Per-Step Intelligent Routing
pilot_per_step_routing_enabled: pilotConfig.perStepRoutingEnabled,
pilot_routing_default_strategy: pilotConfig.routingStrategy,
```

**In Pilot Config UI section, remove:**
```tsx
{/* Per-Step Intelligent Routing Toggle */}
<div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
  <div>
    <p className="text-white font-medium">Per-Step Intelligent Routing</p>
    <p className="text-sm text-slate-400">
      Analyze and route each workflow step individually
    </p>
  </div>
  {/* Toggle switch */}
</div>
```

**Reason:** System 2 routing is now integrated into orchestration

---

### 8. Keep Orchestration Config Section (NO CHANGES)

**Keep as-is but add note:**
```tsx
{/* Orchestration Configuration */}
<motion.div ...>
  {/* Add info box at top */}
  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl mb-4">
    <p className="text-sm text-blue-300">
      ℹ️ <strong>Advanced orchestration settings</strong> are now managed in the dedicated{' '}
      <a href="/admin/orchestration-config" className="text-blue-400 underline hover:text-blue-300">
        Orchestration Config
      </a> page.
    </p>
  </div>
  {/* Keep existing orchestration controls */}
</motion.div>
```

**Reason:** This section controls the unified system, keep it but point to new page

---

## Summary of Changes

### State Variables Removed:
- `routingEnabled`, `lowThreshold`, `mediumThreshold`, `minSuccessRate`, `anthropicEnabled`
- `modelRoutingConfig`, `savingModelRouting`

### Functions Removed:
- `handleSaveRoutingConfig()`
- `handleSaveModelRoutingConfig()`

### Code Sections Removed:
- Routing settings parsing in `fetchConfig()`
- Model routing API call in `fetchConfig()`
- "Intelligent Model Routing" UI section (large section ~350 lines)
- Pilot per-step routing fields

### UI Sections Kept:
- ✅ Orchestration Configuration (add pointer to new page)
- ✅ Pricing Models
- ✅ Calculator Config
- ✅ Memory Config
- ✅ Pilot Config (minus per-step routing)
- ✅ Billing Config
- ✅ Boost Packs

---

## Replacement Approach

**Option 1: Manual Editing**
- Search for each section above
- Delete or comment out the code
- Test the page works

**Option 2: Automated Script**
Use grep to find line numbers, then use sed to remove sections:
```bash
# Example: Remove lines 56-68 (state variables)
sed -i.bak '56,68d' system-config/page.tsx

# Example: Comment out lines 1181-1540 (Intelligent Routing section)
sed -i.bak '1181,1540s/^/\/\/ OBSOLETE: /' system-config/page.tsx
```

**Option 3: New File**
Create a cleaned version from scratch, copying only the sections to keep.

---

## Testing After Cleanup

1. Navigate to `/admin/system-config`
2. Verify page loads without errors
3. Test remaining sections still work:
   - Pricing models management
   - Calculator config save
   - Memory config save
   - Pilot config save (without per-step routing)
   - Billing config
   - Boost packs CRUD
4. Verify no console errors about missing functions
5. Check that orchestration section has pointer to new page

---

## Related Cleanup

After System Config cleanup, also clean up:
- [AIS Config page](./AIS_CONFIG_CLEANUP_GUIDE.md) - Remove per-step routing section
- Database - Remove obsolete settings
