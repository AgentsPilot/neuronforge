# V6 Step ID Simplification

**Date:** 2026-01-07
**Status:** ✅ COMPLETE
**Impact:** Step IDs now use simple `step1`, `step2`, etc. pattern

---

## Change Summary

Updated the DeclarativeCompiler to generate simple sequential step IDs instead of descriptive prefixes.

---

## Before

Step IDs used descriptive prefixes based on the operation type:

```json
[
  { "id": "fetch_google_mail_1", ... },
  { "id": "read_reference_2", ... },
  { "id": "extract_existing_ids_3", ... },
  { "id": "precompute_dedup_4", ... },
  { "id": "filter_new_items_5", ... },
  { "id": "filter_group_1_7", ... },
  { "id": "render_table_8", ... },
  { "id": "send_summary_9", ... }
]
```

**Issues:**
- Inconsistent naming (some descriptive, some not)
- Hard to reference in dependency chains
- Not user-friendly for manual inspection

---

## After

Step IDs use simple sequential numbers:

```json
[
  { "id": "step1", "name": "Fetch google_mail Data", ... },
  { "id": "step2", "name": "Read google_sheets", ... },
  { "id": "step3", "name": "Extract Existing IDs", ... },
  { "id": "step4", "name": "Pre-compute Deduplication Check", ... },
  { "id": "step5", "name": "Filter New Items Only", ... },
  { "id": "step6", "name": "Extract Original Items", ... },
  { "id": "step7", "name": "Filter Group 1", ... },
  { "id": "step8", "name": "Render Table", ... },
  { "id": "step9", "name": "Send Summary via google-sheets", ... }
]
```

**Benefits:**
- ✅ Consistent, predictable pattern
- ✅ Easy to reference (step1, step2, etc.)
- ✅ User-friendly for debugging
- ✅ Aligns with common workflow conventions

---

## Implementation

### File Modified

**lib/agentkit/v6/compiler/DeclarativeCompiler.ts**

```typescript
private generateStepId(prefix: string, ctx: CompilerContext): string {
  // Use simple step1, step2, etc. pattern instead of descriptive prefixes
  const id = `step${ctx.stepCounter}`
  ctx.stepCounter++
  return id
}
```

**Change:** Line 1849-1851
- Old: `const id = \`\${prefix}_\${ctx.stepCounter}\``
- New: `const id = \`step\${ctx.stepCounter}\``

**Note:** The `prefix` parameter is still passed to the method for compatibility with all call sites, but it's now ignored. The descriptive name is still preserved in the `name` field.

---

## Variable References

Variable references automatically update to match the new step IDs:

**Before:**
```json
{
  "input": "{{fetch_google_mail_1.data}}"
}
```

**After:**
```json
{
  "input": "{{step1.data}}"
}
```

This happens automatically because the compiler uses the generated step ID when creating variable references.

---

## Backward Compatibility

**Breaking Change:** Yes
- Workflows compiled with the old naming scheme will have different step IDs
- However, since step IDs are generated at compile time, this only affects:
  1. Saved workflows in the database (need recompilation)
  2. Manual references to specific step IDs

**Migration:** Re-compile existing workflows to get the new step IDs.

---

## Testing

### Test Script

**test-step-ids.ts:**

```typescript
import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2'

const pluginManager = new PluginManagerV2()
const compiler = new DeclarativeCompiler(pluginManager)
const result = await compiler.compile(testIR)

result.workflow.forEach((step, i) => {
  console.log(`${i + 1}. ${step.id} - ${step.name}`)
})
```

**Output:**
```
1. step1 - Fetch google_mail Data
2. step2 - Render Table
3. step3 - Send Summary via google-mail
```

✅ Verified: Simple sequential IDs work correctly.

---

## Impact on PILOT DSL

The PILOT DSL `workflow_steps` array now contains steps with simple IDs:

```json
{
  "workflow_steps": [
    { "id": "step1", "name": "Fetch google_mail Data", ... },
    { "id": "step2", "name": "Read google_sheets", ... },
    ...
  ]
}
```

This makes the DSL easier to read and debug in the test page UI.

---

## Conclusion

**Step ID simplification complete:**
- ✅ Step IDs now use `step1`, `step2`, etc.
- ✅ Consistent, predictable pattern
- ✅ Better UX for debugging
- ✅ Tested and verified

---

**Author:** Claude (Sonnet 4.5)
**Date:** 2026-01-07
**Status:** ✅ COMPLETE
