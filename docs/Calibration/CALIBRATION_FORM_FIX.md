# Calibration Input Form - Always Show Before Test

> **Status**: ✅ Fixed
> **Last Updated**: 2026-04-22

## Problem

The input form was only appearing **sometimes** during calibration:
- ✅ **Showed**: When issues were detected and fixes applied
- ❌ **Didn't show**: When workflow had no issues (clean workflow)

**User expectation**: Form should **ALWAYS** appear before calibration runs, regardless of whether fixes were applied.

## Desired Flow

```
User clicks "Start Test"
    ↓
System checks for missing config
    ↓
If has input_schema:
    → Show input form
    → User fills values (Google Drive folder ID, etc.)
    → User clicks "Run Calibration"
    ↓
Validation runs (Layer 1 + 2 + 3)
    ↓
Calibration executes
```

## Root Cause

**File**: `/components/v2/calibration/CalibrationSetup.tsx`

### Issue 1: Form visibility condition (Line 1726-1736)

**Before**:
```typescript
{msg.showInputForm && fixesHaveBeenApplied && agent.input_schema && inputSchemaArray.length > 0 && (
  // Form JSX
)}
```

**Problem**: Required `fixesHaveBeenApplied` to be true, so form only showed after fixes were applied.

**After**:
```typescript
{msg.showInputForm && agent.input_schema && inputSchemaArray.length > 0 && (
  // Form JSX
)}
```

**Fix**: Removed `fixesHaveBeenApplied` requirement. Form now shows whenever `msg.showInputForm` is true.

### Issue 2: Start test skips form (Line 720-725)

**Before**:
```typescript
} else {
  // No config needed, run calibration immediately
  console.log('[CalibrationSetup] No missing config, running calibration')
  setHasStarted(true)
  onRun(inputValues)  // ← Runs immediately without showing form!
}
```

**Problem**: When no config was missing, calibration ran immediately without showing the input form.

**After**:
```typescript
} else {
  // No config needed, but still show input form if agent has input_schema
  console.log('[CalibrationSetup] No missing config, checking for input schema')

  if (agent.input_schema && inputSchemaArray.length > 0) {
    // Show input form before running calibration
    console.log('[CalibrationSetup] Has input schema, showing input form')
    setMessages(prev => [
      ...prev,
      {
        id: 'prompt-input',
        type: 'bot',
        content: 'Great! Now please provide the input values to test your workflow.',
        timestamp: new Date(),
        showInputForm: true
      }
    ])
    setHasStarted(true)
  } else {
    // No input schema either, run calibration immediately
    console.log('[CalibrationSetup] No input schema, running calibration immediately')
    setHasStarted(true)
    onRun(inputValues)
  }
}
```

**Fix**: Added check for `input_schema`. If agent has input fields, show the form before running calibration.

## Changes Summary

| File | Lines Changed | Description |
|------|---------------|-------------|
| [CalibrationSetup.tsx](../components/v2/calibration/CalibrationSetup.tsx#L720-L745) | 720-745 | Added logic to show input form when no config is missing |
| [CalibrationSetup.tsx](../components/v2/calibration/CalibrationSetup.tsx#L1724-L1733) | 1724-1733 | Removed `fixesHaveBeenApplied` requirement from form visibility |

## Testing

### Test Case 1: Workflow with Issues (Fixes Applied)

**Before**: Form showed ✅
**After**: Form still shows ✅

**Flow**:
1. Click "Start Test"
2. Issues detected → Fixes applied
3. Bot asks: "Now please provide the input values..."
4. **Form shows** ✅
5. User fills form → Clicks "Run Calibration"
6. Validation + Execution runs

### Test Case 2: Clean Workflow (No Issues)

**Before**: Form **didn't show** ❌ → Went directly to calibration
**After**: Form **shows** ✅

**Flow**:
1. Click "Start Test"
2. No config missing → No fixes needed
3. Bot asks: "Great! Now please provide the input values..."
4. **Form shows** ✅ (FIXED!)
5. User fills form → Clicks "Run Calibration"
6. Validation + Execution runs

### Test Case 3: No Input Schema (Edge Case)

**Before**: Calibration runs immediately ✅
**After**: Still runs immediately ✅

**Flow**:
1. Click "Start Test"
2. No `input_schema` defined
3. Calibration runs immediately (no form needed)

## Verification

After changes, the form will **ALWAYS** appear when:
- ✅ Agent has `input_schema` defined
- ✅ `input_schema` has at least one field
- ✅ User clicks "Start Test"

The form will **NOT** appear only when:
- ⬜ Agent has no `input_schema` (no inputs needed)

## Next Steps

User can now:
1. Click "Start Test"
2. Fill the input form **every time** (predictable UX)
3. See validation results (Layer 1 + 2 + 3) in logs
4. Review calibration results

---

**Status**: ✅ **Ready to test**

User should now see the input form consistently on every "Start Test" click for agents with input schemas.
