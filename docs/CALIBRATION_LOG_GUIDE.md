# Calibration Log Monitoring Guide

> **Quick Reference**: What to look for when testing Multi-Step Structural Detection

## How to Monitor Logs

### Option 1: Use the monitoring script
```bash
./monitor-calibration.sh
```

### Option 2: Check background task output directly
```bash
tail -f /tmp/claude/-Users-yaelomer-Documents-neuronforge/tasks/bc36e40.output | grep -E 'Layer 2 Enhanced|MultiStepDetector'
```

### Option 3: Check server console
The dev server console will show filtered logs (excluding noisy queries).

## What to Look For

### ✅ Success Pattern (Multi-Step Detection & Fix)

When calibration detects and fixes a missing intermediate flatten step, you should see:

```
[Layer 2 Enhanced] Running multi-step structural detection
  sessionId: "xxx"
  agentId: "yyy"

[MultiStepDetector] Starting structural analysis
  agentId: "yyy"

[MultiStepDetector] Detected missing intermediate flatten step
  stepId: "step2"
  actualFields: ["id", "subject", "attachments"]
  declaredFields: ["attachment_id", "filename"]
  missingFields: ["attachment_id", "filename"]
  nestedArrayField: "attachments"

[MultiStepDetector] Schema-output mismatch detection complete
  schemaIssues: 1

[MultiStepDetector] Structural analysis complete
  totalIssues: 1
  byType: { missing_intermediate_flatten_step: 1 }

[Layer 2 Enhanced] Multi-step structural detection complete
  totalStructuralIssues: 1
  byType: { missing_intermediate_flatten_step: 1 }

[MultiStepDetector] Generating intermediate flatten step fix
  originalStepId: "step2"
  newStepId: "step2a"
  targetField: "attachments"
  downstreamUpdates: 1

[ConstrainedSemanticValidator] Inserted new step into workflow
  newStepId: "step2a"
  insertPosition: "after"
  targetStepId: "step2"
  insertIndex: 2

[ConstrainedSemanticValidator] Updated downstream step input reference
  stepId: "step3"
  oldInput: "{{all_attachments}}"
  newInput: "{{flattened_attachments}}"

[Layer 2 Enhanced] Auto-applied high-confidence multi-step fix
  action: "insert_step"
  affectedSteps: ["step2", "step2a", "step3"]
  confidence: 0.85
  reasoning: "Flatten \"emails\" produces objects with nested \"attachments\" array..."

Persisting Layer 2 semantic and multi-step fixes to database
  highConfidenceFixes: X
  mediumConfidenceFixes: Y
  multiStepFixes: 1
  total: Z
```

### 🔍 Detection Only (No Issues Found)

If workflow structure is correct, you'll see:

```
[Layer 2 Enhanced] Running multi-step structural detection
  sessionId: "xxx"
  agentId: "yyy"

[MultiStepDetector] Starting structural analysis
  agentId: "yyy"

[MultiStepDetector] Schema-output mismatch detection complete
  schemaIssues: 0

[MultiStepDetector] Structural analysis complete
  totalIssues: 0
  byType: {}

[Layer 2 Enhanced] Multi-step structural detection complete
  totalStructuralIssues: 0
  byType: {}
```

This is normal and means no structural issues were detected.

### ⚠️ Medium Confidence Fix (With Notification)

If fix confidence is 0.70-0.84:

```
[Layer 2 Enhanced] Auto-applied medium-confidence multi-step fix (notification required)
  action: "insert_step"
  affectedSteps: ["step2", "step2a", "step3"]
  confidence: 0.75
  reasoning: "..."
```

User will see notification in calibration UI.

### ❌ Low Confidence (Skipped)

If confidence < 0.70:

```
[Layer 2 Enhanced] Skipping low-confidence multi-step fix
  issueType: "missing_intermediate_flatten_step"
  confidence: 0.65
```

No auto-fix applied, requires manual review.

## Key Log Markers

| Log Pattern | Meaning |
|-------------|---------|
| `[Layer 2 Enhanced] Running multi-step structural detection` | Multi-step detection started |
| `[MultiStepDetector] Starting structural analysis` | Core detector running |
| `Detected missing intermediate flatten step` | Found nested array issue |
| `Schema-output mismatch detection complete` | Detection phase done |
| `Generating intermediate flatten step fix` | Creating fix |
| `Inserted new step into workflow` | Fix applied (step inserted) |
| `Updated downstream step input reference` | Downstream rewiring complete |
| `Auto-applied high-confidence multi-step fix` | Fix successfully applied |
| `multiStepFixes: N` | N multi-step fixes applied |

## Testing Checklist

### Before Running Calibration

- ✅ Server is running (`npm run dev`)
- ✅ Monitoring script running (`./monitor-calibration.sh`) OR console visible
- ✅ Test workflow created with nested structure (Gmail → flatten attachments)

### During Calibration

Watch for:
1. ✅ `[Layer 2 Enhanced]` logs appear
2. ✅ Detection finds structural issue (if workflow has nested arrays)
3. ✅ Fix is generated and applied
4. ✅ Database persistence includes `multiStepStructuralFixes`

### After Calibration

Check:
1. ✅ Workflow JSON includes new intermediate step (step2a)
2. ✅ Original step's output_schema updated
3. ✅ Downstream step inputs rewired
4. ✅ Dry-run execution returns results (not empty)

## Common Scenarios

### Scenario 1: Gmail → Flatten Attachments

**Expected**: Detects missing flatten for "attachments" nested in emails

**Logs to Look For**:
```
actualFields: ["id", "subject", "attachments"]
declaredFields: ["attachment_id", "filename"]
nestedArrayField: "attachments"
```

### Scenario 2: Google Drive → Flatten Files

**Expected**: Detects missing flatten for "files" nested in folders

**Logs to Look For**:
```
actualFields: ["name", "id", "files"]
declaredFields: ["file_id", "file_name"]
nestedArrayField: "files"
```

### Scenario 3: Shopify → Flatten Order Items

**Expected**: Detects missing flatten for "items" nested in orders

**Logs to Look For**:
```
actualFields: ["order_id", "customer", "items"]
declaredFields: ["product_id", "quantity"]
nestedArrayField: "items"
```

## Troubleshooting

### No [Layer 2 Enhanced] logs appear

**Possible causes**:
- Calibration didn't reach Layer 2 (failed earlier)
- Logs filtered out by grep pattern
- Check full server output: `tail -f /tmp/claude/.../bc36e40.output`

### Detection runs but finds no issues

**Possible causes**:
- Workflow structure is already correct
- No nested array patterns in workflow
- Transform steps don't have output_schema to compare

**Solution**: Verify workflow has:
1. Step with flatten operation
2. Source step returns object with nested array
3. Flatten step has output_schema expecting fields from nested array

### Fix generated but not applied

**Possible causes**:
- Confidence < 0.70 (check confidence score in logs)
- Fix validation failed
- Error in applyMultiStepFix (check error logs)

**Solution**: Look for error logs with `Failed to apply multi-step fix`

## Expected Performance

| Phase | Time | Notes |
|-------|------|-------|
| Detection | 50-100ms | Schema comparison |
| Fix Generation | 20-50ms | Step creation |
| Fix Application | 10-30ms | Array splicing |
| **Total Overhead** | **~150ms** | Added to Layer 2 |

Should not significantly impact calibration time (Layer 2 already takes 2-3s for LLM calls).

---

**Quick Test**: Create Gmail workflow, run calibration, watch for `[Layer 2 Enhanced]` logs. If you see "Detected missing intermediate flatten step", the system is working! 🎉
