# Smart Fallback Detection for Null Field Values

## Feature Summary
Automatically detects when required parameters receive null/empty values and applies **context-aware fallback values** without hardcoding specific field names.

## Problem Solved
When a scatter-gather step fails with "X is required" error because a field resolved to null:
- ❌ **Before:** Requires manual intervention or hardcoded fixes
- ✅ **After:** Automatically generates appropriate fallback based on field name

## How It Works

### Detection (Lines 648-712)
```typescript
// Pattern: "folder_name is required"
const requiredParamPattern = /(\w+)\s+is\s+required/i;
const requiredMatch = firstError.match(requiredParamPattern);

if (requiredMatch) {
  // Extract field name from variable reference
  // "{{extracted_fields.vendor}}" -> "vendor"
  const varMatch = paramValue.match(/\{\{[^.]+\.([^}]+)\}\}/);
  const fieldName = varMatch ? varMatch[1] : 'value';

  // Generate smart fallback based on field name
  // "vendor" -> "Unknown Vendor"
  // "category" -> "Unknown Category"
  // "folder" -> "Unknown Folder"
  const suggestedFallback = `Unknown ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
}
```

### Fix Application (Lines 1212-1239)
```typescript
if (proposal.type === 'add_extraction_fallback') {
  // Find the extraction step (document-extractor or ai_processing)
  const extractionStep = scatterStep.scatter.steps.find((step: any) =>
    (step.type === 'action' && step.plugin === 'document-extractor') ||
    (step.type === 'ai_processing' && step.output_schema?.properties?.[change.field])
  );

  // Update description to include fallback instruction
  const fallbackInstruction = ` If ${change.field} not found, use ${change.fallback}`;
  extractionStep.description += fallbackInstruction;
}
```

## Examples

### Example 1: vendor Field
**Error:** `folder_name is required`
**Config:** `"folder_name": "{{extracted_fields.vendor}}"`
**Detection:** Field `vendor` is null
**Fallback:** `Unknown Vendor`
**Fix:** Update extraction step description:
```
"Extract invoice fields. If vendor not found, use Unknown Vendor"
```

### Example 2: category Field
**Error:** `category_name is required`
**Config:** `"category_name": "{{item.category}}"`
**Detection:** Field `category` is null
**Fallback:** `Unknown Category`
**Fix:** Update extraction step description:
```
"Classify transaction. If category not found, use Unknown Category"
```

### Example 3: title Field
**Error:** `title is required`
**Config:** `"title": "{{doc.title}}"`
**Detection:** Field `title` is null
**Fallback:** `Unknown Title`
**Fix:** Update extraction step description:
```
"Extract document metadata. If title not found, use Unknown Title"
```

## Why This Approach

### ✅ Advantages
1. **No hardcoding** - Works for any field name (vendor, category, title, etc.)
2. **Context-aware** - Fallback includes the field name ("Unknown Vendor" not just "Unknown")
3. **Generic solution** - Scales to all use cases without specific rules
4. **Self-documenting** - The fallback value clearly indicates what field is missing

### ❌ Alternative Approaches (Rejected)
1. **Hardcode "Unknown Vendor"** - Only works for vendor field
2. **Use generic "Unknown"** - Loses context about what field is missing
3. **Require user input** - Slows down calibration, requires manual intervention
4. **Skip failed items** - Loses data, creates incomplete results

## Pattern Matching

The detection supports multiple variable reference formats:

| Format | Field Extracted | Fallback Generated |
|--------|----------------|-------------------|
| `{{extracted_fields.vendor}}` | `vendor` | `Unknown Vendor` |
| `{{item.category}}` | `category` | `Unknown Category` |
| `{{data.customer_name}}` | `customer_name` | `Unknown Customer_name` |
| `{{result.status}}` | `status` | `Unknown Status` |

## Confidence Level

**85% confidence** for auto-fixing because:
- ✅ Field name is explicitly stated in error message
- ✅ Variable reference clearly shows which field is null
- ✅ Fallback pattern is universally sensible
- ⚠️ User might prefer different fallback (e.g., "N/A", "Unspecified")

## Integration with Calibration Loop

1. **Iteration N:** Workflow fails with "folder_name is required"
2. **Detection:** Identifies field `vendor` is null, suggests "Unknown Vendor"
3. **Classification:** Marked as `autoRepairAvailable: true`, confidence 0.85
4. **Fix Application:** Updates extraction step description with fallback
5. **Iteration N+1:** Re-runs workflow with updated extraction
6. **Success:** Extraction now returns "Unknown Vendor" instead of null
7. **Completion:** Workflow processes all items successfully

## Real-World Example

### Before Fix
```json
{
  "id": "step6",
  "type": "action",
  "plugin": "document-extractor",
  "description": "Extract structured invoice/expense fields from PDF",
  "config": {
    "fields": ["vendor", "amount", "date"]
  }
}
```
**Result:** Some PDFs don't have vendor → `vendor: null` → Step7 fails

### After Fix
```json
{
  "id": "step6",
  "type": "action",
  "plugin": "document-extractor",
  "description": "Extract structured invoice/expense fields from PDF. If vendor not found, use Unknown Vendor",
  "config": {
    "fields": ["vendor", "amount", "date"]
  }
}
```
**Result:** All PDFs succeed → `vendor: "Unknown Vendor"` → Step7 creates folder

## Files Modified
- `app/api/v2/calibrate/batch/route.ts`
  - Lines 584-587: Added required parameter pattern
  - Lines 648-712: Smart fallback detection logic
  - Lines 1212-1239: Fix application handler

## Testing

### Test Case 1: Vendor Field
```bash
# Trigger workflow with PDF that has no vendor
# Expected: Detects "folder_name is required"
# Expected: Generates fallback "Unknown Vendor"
# Expected: Updates step6 description
# Expected: Re-runs successfully with "Unknown Vendor" folder
```

### Test Case 2: Generic Field
```bash
# Create workflow with any field that might be null
# Expected: Generates "Unknown [FieldName]" fallback
# Expected: Scales to any field without hardcoding
```

## Next Steps

1. **Immediate:** Test with vendor null scenario
2. **Short-term:** Add more sophisticated fallback logic (e.g., based on data type)
3. **Medium-term:** Support user-configurable default values
4. **Long-term:** Implement variable fallback syntax in IR compiler
