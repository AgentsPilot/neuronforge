# Calibration Data Transformation Auto-Fix

> **Date**: 2026-04-24
> **Status**: Implemented - Ready for Testing

## Overview

Added generic data transformation auto-fix capability to the calibration system to handle parameter format mismatches between workflow steps and plugin requirements.

## Problem Statement

The calibration system could detect missing required parameters but couldn't auto-fix cases where:
1. A required parameter was missing (e.g., `values`)
2. An alternative format was provided (e.g., `fields` object)
3. A transformation was needed to convert between formats

**Example**: Google Sheets `append_rows` requires a `values` parameter (2D array), but workflows were generated with a `fields` object mapping.

## Solution: Generic Parameter Transformation Detection

### Detection Logic

**Location**: `app/api/v2/calibrate/batch/route.ts` (lines ~1869-1936)

The system now:

1. **Detects missing required parameters** from plugin schema
2. **Checks if an alternative format exists** (e.g., `fields` when `values` is required)
3. **Analyzes parameter types** from plugin definition:
   - Missing parameter expects: `array` (especially 2D arrays)
   - Provided parameter is: `object` (field mapping)
4. **Creates auto-repair proposal** with 92% confidence

**Key Features**:
- ✅ **No hardcoding** - reads plugin schema dynamically
- ✅ **Generic** - works for any plugin with similar parameter mismatches
- ✅ **Schema-driven** - uses plugin definitions to understand requirements

### Transformation Logic

**Location**: `app/api/v2/calibrate/batch/route.ts` (lines ~2542-2699)

The auto-fix:

1. **Inserts an AI transform step** before the problematic step
2. **Converts fields mapping to required array format**
3. **Updates parameter references** to use transformed data
4. **Removes the incompatible parameter**

**Handles two scenarios**:
- **Scatter-gather context**: Per-item transformation (single row)
- **Top-level context**: Batch transformation (multiple rows)

## Example Transformation

### Before (Fields Format):
```json
{
  "id": "step14",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "config": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "{{input.sheet_tab_name}}",
    "fields": {
      "Date": "high_value_items.date",
      "Type": "high_value_items.type",
      "Amount": "high_value_items.amount",
      "Vendor": "high_value_items.vendor"
    }
  }
}
```

### After (Values Format with Transform Step):
```json
// NEW: Transform step inserted before append_rows
{
  "id": "step14_transform",
  "type": "ai_processing",
  "config": {
    "type": "generate",
    "ai_type": "generate",
    "instruction": "Convert input to array format. Extract fields in order: Date, Type, Amount, Vendor...",
    "output_schema": {
      "type": "object",
      "required": ["values"],
      "properties": {
        "values": {
          "type": "array",
          "items": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    }
  },
  "input": "high_value_items",
  "output_variable": "step14_transformed_data"
},

// UPDATED: Original step now uses transformed data
{
  "id": "step14",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "config": {
    "spreadsheet_id": "{{input.spreadsheet_id}}",
    "range": "{{input.sheet_tab_name}}",
    "values": "{{step14_transformed_data.values}}"  // ✅ Now has required parameter
  }
}
```

## Generic Design Principles

### 1. Schema-Driven Detection
```typescript
// Read from plugin definition - NO hardcoding
const pluginDef = pluginManager.getPluginDefinition(targetStep.plugin);
const actionDef = pluginDef?.actions?.find(a => a.name === targetStep.action);

// Find missing required parameters
const requiredParams = actionDef.parameters.filter(p => p.required);
const missingParams = requiredParams.filter(p => !providedParams.includes(p.name));

// Check parameter types to detect format mismatch
const arrayParamMissing = missingParams.find(p =>
  p.type === 'array' &&
  (p.items?.type === 'array' || p.description?.includes('2d array'))
);
```

### 2. Dynamic Parameter Names
```typescript
// Use detected parameter names - not hardcoded
const missingParam = arrayParamMissing.name;  // e.g., "values"
const providedParam = 'fields';  // detected from config

// Build generic transformation instruction
const instruction = `Convert input to ${missingParam} format...`;
```

### 3. Convergence Protection
```typescript
// Prevent infinite loops
const canApplyFix = trackFix(
  change.stepId,
  `transform_${providedParam}_to_${missingParam}`
);
if (!canApplyFix) {
  logger.warn('CONVERGENCE FAILURE: Transformation already applied');
  continue;
}
```

## Benefits

### For Users
- ✅ **Automatic workflow fixes** - no manual intervention needed
- ✅ **Works across plugins** - any action with similar parameter mismatches
- ✅ **Preserves intent** - field mapping is honored in transformation

### For Developers
- ✅ **No plugin-specific code** - uses schema metadata
- ✅ **Extensible** - automatically works for new plugins
- ✅ **Maintainable** - single transformation pattern handles many cases

## Testing

### Test Case: Google Sheets append_rows

**Input**: Workflow with `fields` mapping
**Expected**:
1. Calibration detects missing `values` parameter
2. Auto-fix proposal created (confidence: 0.92)
3. Transform step inserted
4. `values` parameter added with reference to transformed data
5. Next iteration: step 14 executes successfully

### Verification Commands

```bash
# Run calibration
# Check logs for auto-fix detection
grep "Pattern 4 matched: fields-to-array transformation needed" /tmp/nextjs-calibration.log

# Check for auto-fix application
grep "Auto-applied: transform_.*_to_.*" /tmp/nextjs-calibration.log

# Verify step 14 execution
grep "step14.*completed\|append_rows.*success" /tmp/nextjs-calibration.log
```

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `app/api/v2/calibrate/batch/route.ts` | 1869-1936 | Detection: Schema-driven parameter mismatch detection |
| `app/api/v2/calibrate/batch/route.ts` | 2542-2699 | Application: Generic transformation insertion |

## Architecture Notes

### Why This Approach?

**Previous approach**:
- ❌ Logged issue but didn't auto-fix
- ❌ Expected IR compiler to handle
- ❌ Required workflow regeneration

**New approach**:
- ✅ Runtime auto-fix during calibration
- ✅ No workflow regeneration needed
- ✅ Works with existing workflows
- ✅ Generic pattern handles future cases

### When to Apply This Pattern

**Good candidates** for auto-fix:
- ✅ Format conversions (object → array, array → object)
- ✅ Field mappings to positional data
- ✅ Envelope unwrapping
- ✅ Pagination flattening

**Not suitable** for auto-fix:
- ❌ Business logic changes
- ❌ Semantic transformations requiring domain knowledge
- ❌ Ambiguous mappings with multiple valid interpretations

## Future Enhancements

### Potential Extensions

1. **Reverse transformations**: Array → object mapping
2. **Type coercion**: String → number, date formatting
3. **Default value injection**: Missing optional parameters
4. **Schema validation**: Ensure transformed data matches expected schema

### Plugin Developer Guidelines

To ensure your plugin actions work with calibration auto-fix:

1. **Define parameter types accurately** in plugin definition
2. **Mark required parameters** with `required: true`
3. **Include clear descriptions** (e.g., "2D array of cell values")
4. **Document array structures** in `items` schema
5. **Avoid ambiguous parameter names**

## Summary

The calibration system can now automatically fix **data transformation issues** between steps by:

1. **Reading plugin schemas** to understand requirements
2. **Detecting format mismatches** (object vs array)
3. **Inserting AI transform steps** to convert data
4. **Updating parameter references** to use transformed data

This makes the calibration system significantly more powerful, especially for common patterns like Google Sheets field-to-values transformations.

**Key Principle**: Fix issues at the root cause with generic, schema-driven solutions that scale to all plugins.
