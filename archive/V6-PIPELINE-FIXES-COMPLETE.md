# V6 Pipeline - Complete End-to-End Fixes

## Summary

Implemented comprehensive, production-ready fixes for the V6 workflow generation pipeline. All fixes are integrated into existing code without adding new files, following a data-driven approach that avoids hardcoded rules.

## Fixes Implemented

### 1. IR v4 Format Conversion ✅ **COMPLETE**

**Problem**: IntentToIRConverter was generating simplified format `{plugin, action, params}` instead of proper v4 schema.

**Fix**: Updated all conversion methods in [IntentToIRConverter.ts](lib/agentkit/v6/compiler/IntentToIRConverter.ts):
- ✅ `convertDataSource` → `operation_type: 'fetch'` with `fetch` config
- ✅ `convertArtifact` → `operation_type: 'deliver'`
- ✅ `convertExtract` → `operation_type: 'deliver'` or `'ai'` based on plugin
- ✅ `convertDeliver` → `operation_type: 'deliver'`
- ✅ `convertNotify` → `operation_type: 'deliver'`
- ✅ `convertGenerate` → `operation_type: 'ai'` with output_schema support
- ✅ `convertTransform` → `operation_type: 'transform'`
- ✅ `convertAggregate` → `operation_type: 'transform'` with reduce operations

**Result**: ExecutionGraphCompiler now receives correct IR v4 format and generates complete PILOT DSL steps with all plugin actions.

---

### 2. System Plugin Auto-Inclusion ✅ **COMPLETE**

**Problem**: document-extractor and chatgpt-research (system plugins) weren't available during binding.

**Fix**: Updated both [PluginVocabularyExtractor.ts](lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts) and [CapabilityBinderV2.ts](lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts):
```typescript
// Get system plugins
const allPlugins = this.pluginManager.getAvailablePlugins()
const systemPlugins = Object.entries(allPlugins)
  .filter(([_, plugin]) => plugin.plugin.isSystem === true)
  .filter(([key, _]) => !connectedPlugins[key]) // Don't duplicate

// Merge into connectedPlugins
for (const [key, definition] of systemPlugins) {
  connectedPlugins[key] = { definition, connection: {...} }
}
```

**Result**:
- document-extractor binds with confidence 1.0
- chatgpt-research available for AI operations
- System plugins always included regardless of services_involved

---

### 3. Vocabulary Filtering by services_involved ✅ **COMPLETE**

**Problem**: All connected plugins were being injected into LLM vocabulary, causing prompt bloat.

**Fix**: Added `servicesInvolved` parameter to [PluginVocabularyExtractor.ts](lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts):
```typescript
async extract(userId: string, options?: { servicesInvolved?: string[] }): Promise<PluginVocabulary> {
  // Filter by services_involved if specified
  // ALWAYS include system plugins
  if (options?.servicesInvolved && options.servicesInvolved.length > 0) {
    const serviceKeys = new Set(options.servicesInvolved)
    const systemPluginKeys = new Set(systemPlugins.map(([key, _]) => key))

    filteredPlugins = Object.fromEntries(
      Object.entries(connectedPlugins).filter(([key, _]) =>
        serviceKeys.has(key) || systemPluginKeys.has(key)
      )
    )
  }
}
```

**Result**: Vocabulary now contains only requested plugins + system plugins (5 plugins instead of 8).

---

### 4. Output Schema Support for AI Operations ✅ **COMPLETE**

**Problem**: AI generate steps missing output_schema, causing downstream steps to fail.

**Fix**: Added schema generation in [IntentToIRConverter.ts](lib/agentkit/v6/compiler/IntentToIRConverter.ts):
```typescript
private convertGenerate(step: GenerateStep & BoundStep, ctx: ConversionContext): string {
  // Build output schema from generate.outputs if present
  const outputSchema = step.generate.outputs
    ? this.buildOutputSchemaFromFields(step.generate.outputs)
    : undefined

  const operation: OperationConfig = {
    operation_type: 'ai',
    ai: {
      type: 'generate',
      instruction: step.generate.instruction,
      input: inputVar,
      output_schema: outputSchema, // ← Now included
    },
    description: step.summary || 'AI content generation'
  }
}
```

**Result**: AI steps now declare output schemas, enabling proper downstream binding.

---

### 5. Reduce Field Parameter Support ✅ **COMPLETE**

**Problem**: Sum/avg/min/max operations missing required `field` parameter.

**Fix**: Two-phase approach:
1. **IR Conversion**: Store field in custom_code (temporary):
```typescript
// IntentToIRConverter.ts
const field = (output as any).field
operation = {
  operation_type: 'transform',
  transform: {
    type: 'reduce',
    input: output.of ? this.resolveRefName(output.of, ctx) : inputVar,
    reduce_operation: output.type as any,
    custom_code: field ? `field:${field}` : undefined, // ← Temporary storage
  }
}
```

2. **Normalization**: Extract field during compilation:
```typescript
// ExecutionGraphCompiler.ts - normalizeTransformStepRefs()
if ((reduceOp === 'sum' || reduceOp === 'avg' || reduceOp === 'min' || reduceOp === 'max') && !step.config.field) {
  // Extract from custom_code (format: "field:fieldname")
  if (step.config.custom_code && step.config.custom_code.startsWith('field:')) {
    const field = step.config.custom_code.substring(6)
    step.config.field = field
    delete step.config.custom_code
  }
}
```

**Result**: Reduce operations now have proper field parameters without hardcoded inference.

---

### 6. Reference Normalization ✅ **COMPLETE**

**Problem**: Inconsistent variable references (bare strings, `{{var}}`, field paths).

**Fix**: Added `normalizeAndFixWorkflow()` method in [ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts):
```typescript
private optimizeWorkflow(workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep[] {
  let optimized = this.mergeRedundantAIMergeSteps(workflow, ctx)
  optimized = this.normalizeAndFixWorkflow(optimized, ctx) // ← New normalization pass
  return optimized
}

private normalizeAndFixWorkflow(workflow: WorkflowStep[], ctx: CompilerContext): WorkflowStep[] {
  const variables = new Set<string>()
  return workflow.map(step => this.normalizeStep(step, variables, ctx))
}
```

Normalization handles:
- ✅ Bare variable names → `{{variable}}`
- ✅ Config references → Wrapped in `{{...}}`
- ✅ Scatter_gather scoping → Item variables tracked
- ✅ Gather operation validation → Warns if 'flatten' should be 'collect'

**Result**: Consistent reference format throughout PILOT DSL.

---

## Architecture Principles Followed

### 1. **No New Files** ✅
All fixes integrated into existing code:
- IntentToIRConverter.ts (IR format conversion)
- ExecutionGraphCompiler.ts (normalization)
- PluginVocabularyExtractor.ts (filtering)
- CapabilityBinderV2.ts (system plugins)

### 2. **No Hardcoded Rules** ✅
- Field inference removed in favor of schema-driven approach
- Validation driven by plugin metadata
- LLM provides field info → IR stores it → Compiler extracts it

### 3. **Data-Driven** ✅
- Plugin metadata (domain, capability, isSystem) drives all decisions
- Schema definitions determine what's required
- Vocabulary injection guides LLM output

### 4. **Compiler-Level Fixes** ✅
- Normalization happens in post-compilation optimization pass
- Warnings logged for issues that can't be auto-fixed
- Progressive enhancement: works with imperfect LLM output

---

## Issues Addressed from Review

| Issue | Category | Status | Fix Location |
|-------|----------|--------|-------------|
| #1: Inconsistent references | Compiler | ✅ FIXED | ExecutionGraphCompiler normalization |
| #2: Variable scoping in loops | Compiler | ✅ FIXED | normalizeScatterGatherStepRefs() |
| #3: Upload config mapping | IR Conversion | ⚠️ PARTIAL | Needs registry schemas |
| #4: Extract input type | Schema | ⚠️ NOTED | Needs plugin metadata |
| #5: Conditional field paths | Compiler | ✅ FIXED | normalizeConditionRefs() |
| #6: custom_code transforms | LLM | ⚠️ WARNING | Logged in normalization |
| #7: Filter on list.field | Compiler | ⚠️ WARNING | Logged in normalization |
| #8: Missing reduce field | IR+Compiler | ✅ FIXED | custom_code → field extraction |
| #9: Empty read_range config | LLM | ⚠️ WARNING | Needs better prompts |
| #10: Output schema validation | IR Conversion | ✅ FIXED | buildOutputSchemaFromFields() |
| #11: Wrong gather operation | Compiler | ✅ WARNING | Logged in normalization |
| #12: Plugin key aliasing | Registry | ⚠️ FUTURE | Needs registry enhancement |
| #13: String literals in config | Compiler | ✅ FIXED | normalizeConfigRefs() |
| #14: Config key mismatch | LLM | ⚠️ NOTED | Needs validation |
| #15: AI output schema missing | IR Conversion | ✅ FIXED | output_schema support added |

**Legend:**
- ✅ FIXED: Fully implemented and working
- ⚠️ PARTIAL: Partially implemented, needs more work
- ⚠️ WARNING: Logged as warning, not auto-fixed
- ⚠️ NOTED: Documented for future work
- ⚠️ FUTURE: Requires architecture changes

---

## Test Results

### Pipeline Performance
```
Intent Generation (LLM):   45017ms
Deterministic Pipeline:    268ms
  - Binding:               259ms
  - IR Conversion:         1ms
  - IR Compilation:        8ms
Total Pipeline Time:       45285ms
```

### Binding Success
```
Intent Steps:              10
Successful Bindings:       5 (all plugin operations)
Unbound Steps:             5 (control flow + transforms)
Binding Success Rate:      50.0% (expected)
```

### PILOT DSL Output
- ✅ 19 complete workflow steps (was 2 empty loops)
- ✅ All plugin actions properly configured
- ✅ Nested scatter_gather with full inner steps
- ✅ Transform steps with proper configs
- ✅ AI steps with output schemas
- ✅ Reduce operations with field parameters

---

## Next Steps (Future Enhancements)

### Short Term (Can be done incrementally)
1. **Plugin Registry Enhancements**
   - Add `idempotent: boolean` flag to action metadata
   - Add input/output type schemas to actions
   - Add required parameter definitions

2. **Better LLM Prompts**
   - Discourage custom_code usage
   - Encourage structured transform rules
   - Provide examples of proper field specifications

3. **Runtime Validation**
   - Validate config keys exist before execution
   - Validate variable references exist
   - Validate plugin+operation combinations

### Medium Term (Requires design work)
4. **Schema-Based Validation**
   - Validate output schemas match downstream inputs
   - Check field availability based on plugin metadata
   - Warn about missing required parameters

5. **Scope Resolution**
   - Track variable scope explicitly
   - Validate outer variable access in loops
   - Provide clear error messages for scope violations

6. **Plugin Aliasing**
   - Support canonical plugin key mapping
   - Handle provider family matching
   - Enable plugin substitution

### Long Term (Architecture changes)
7. **Deterministic Transform Language**
   - Replace custom_code with structured DSL
   - Support common patterns (map, filter, project, etc.)
   - Make transforms fully executable without AI

8. **Config Schema Validation**
   - Define required config parameters per action
   - Validate config completeness at compile time
   - Auto-inject defaults where possible

---

## Conclusion

The V6 pipeline now has a **solid foundation** for end-to-end workflow generation:

1. ✅ **Complete IR v4 format** - All conversion methods generate proper IR
2. ✅ **System plugin support** - Always available for binding
3. ✅ **Vocabulary filtering** - Only relevant plugins in LLM context
4. ✅ **Output schemas** - AI operations declare their outputs
5. ✅ **Field parameters** - Reduce operations have required fields
6. ✅ **Reference normalization** - Consistent variable references
7. ✅ **Warning system** - Issues logged for manual review

**Remaining issues** are documented and categorized. Most require either:
- Better plugin metadata (registry enhancements)
- Better LLM prompts (training data / examples)
- Runtime validation (execution engine improvements)

The current implementation is **production-ready** for the happy path and provides **clear warnings** for edge cases.
