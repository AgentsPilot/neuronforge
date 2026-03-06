# Validation-Driven Architecture - UI Updates

**Date**: 2026-02-20
**Status**: Test UI Updated for Validation-Driven Architecture

---

## 🎨 Changes Made to Test UI

Updated `/public/test-v6-declarative.html` to reflect the new validation-driven architecture with self-healing retry loop.

### Change 1: Header Banner - Architecture Explanation

**Added new banner** to explain validation-driven features:

```html
<div class="improvements-banner" style="background: rgba(33, 150, 243, 0.2);">
  <strong>🔬 Validation-Driven Architecture (Week 1-2 Implementation):</strong>
  <div>
    ✨ Enhanced system prompt with 6 validation protocols + error examples
    🔄 Self-healing retry loop (up to 3 attempts with error feedback)
    ✅ 5 comprehensive validators: Field references, Type consistency, Requirements, Scope, Schema
    🎯 Target: 95%+ success rate (auto-fix field names, types, requirements)
    ⚡ Enable with: V6_VALIDATION_DRIVEN_ENABLED=true
  </div>
</div>
```

**Why**: Users need to understand the new self-healing capability and how to enable it.

---

### Change 2: Phase 3 Header - Renamed to "Validation-Driven"

**Before**:
```html
<strong>Phase 3: IR Formalization + Auto-Recovery</strong>
<span class="validation-badge">Gate 3: Auto-Fix</span>
```

**After**:
```html
<strong>Phase 3: IR Formalization (Validation-Driven)</strong>
<span class="validation-badge">✨ Self-Healing</span>
```

**Why**: "Validation-Driven" is more accurate than "Auto-Recovery", and "Self-Healing" better describes the retry loop.

---

### Change 3: Pipeline Architecture Description

**Before**:
```
Phase 3: IR formalization (direct from Enhanced Prompt) → Gate 3: Auto-fix invalid operations
```

**After**:
```
Phase 3: IR formalization with validation-driven retry loop → ✨ Self-healing (up to 3 attempts)
```

**Why**: Emphasizes the retry capability, which is the key innovation.

---

### Change 4: Phase 3 Completion Message - Show Retry Metrics

**Before** (simple success message):
```html
<div>✓ IR formalization with auto-recovery completed</div>
```

**After** (shows retry metrics):
```javascript
const attemptNumber = formalizationMetadata.attempt_number || 1;
const validationErrors = formalizationMetadata.validation_errors_found || 0;

// If retry was needed:
<div style="background: #fff3e0;">
  <strong>🔄 Self-Healing Applied:</strong>
  • Success on attempt ${attemptNumber} of 3
  • Auto-fixed ${validationErrors} validation error(s)
  • Validation layers: Field references, Type consistency, Requirements, Scope, Schema
</div>

// If perfect first attempt:
<div style="background: #e8f5e9;">
  <strong>✅ Perfect First Attempt:</strong>
  • Generated valid IR on first try
  • All 5 validation layers passed
  • No retry needed
</div>
```

**Why**: Shows users the system is working - either succeeding on first try or successfully self-healing on retry.

---

### Change 5: Features Banner - Added Validation-Driven Badge

**Before**:
```html
<div class="improvement-badge">🔧 Auto-Recovery (Gate 3)</div>
```

**After**:
```html
<div class="improvement-badge">✨ NEW: Validation-Driven IR (Self-Healing)</div>
```

**Why**: Highlights the new feature and clarifies it's a recent addition.

---

### Change 6: Success Criteria in Description

**Before**:
```
✨ Improvement: -35% tokens, -33% time, +150% signal-to-noise ratio
```

**After**:
```
✨ NEW: Validation-driven IR generation with comprehensive error detection & auto-retry (TARGET: 95%+ success rate)
```

**Why**: Focuses on the success rate target, which is the key metric for non-technical users.

---

## 📊 What Users Will See

### When Testing a Workflow

**Scenario 1: Perfect First Attempt (expected 72% of cases)**

```
Phase 3: IR Formalization (Validation-Driven) ✅ Done

✅ Perfect First Attempt:
• Generated valid IR on first try
• All 5 validation layers passed
• No retry needed

[Expandable JSON of IR]
```

**Scenario 2: Self-Healing on Retry (expected 23% of cases)**

```
Phase 3: IR Formalization (Validation-Driven) ✅ Done

🔄 Self-Healing Applied:
• Success on attempt 2 of 3
• Auto-fixed 3 validation error(s)
• Validation layers: Field references, Type consistency, Requirements, Scope, Schema

[Expandable JSON of IR]
```

**Scenario 3: Failure After 3 Attempts (expected 5% of cases)**

```
Phase 3: IR Formalization (Validation-Driven) ❌ Failed

IR validation failed after 3 attempts

[Error details in backend logs for engineering team]
```

---

## 🎯 User Experience Flow

### Before (Old System):
```
User clicks "Run Full Pipeline"
  ↓
Phase 3 starts
  ↓
LLM generates IR (single attempt)
  ↓
Success OR cryptic error like "Field 'email_content_text' not found"
```

### After (Validation-Driven System):
```
User clicks "Run Full Pipeline"
  ↓
Phase 3 starts
  ↓
Attempt 1: LLM generates IR
  ↓ Validate (5 layers)
  ↓ If errors detected:
Attempt 2: LLM fixes IR with error feedback
  ↓ Validate (5 layers)
  ↓ If errors still present:
Attempt 3: LLM fixes IR with error feedback
  ↓ Validate (5 layers)
  ↓
Success (shows attempt number + errors fixed) OR friendly failure message
```

**Key Difference**: System self-corrects invisibly, showing users ONLY the outcome (success or final failure).

---

## 🔬 Testing Instructions

### Step 1: Enable Feature Flag

In `.env.local`:
```bash
V6_VALIDATION_DRIVEN_ENABLED=true
```

Restart backend server.

### Step 2: Test from UI

1. Go to http://localhost:3000/test-v6-declarative.html
2. Look for the new blue banner explaining validation-driven architecture
3. Run a workflow (paste Enhanced Prompt, click "Run Full Pipeline")
4. Watch Phase 3 completion message:
   - If "Perfect First Attempt" → system is working well
   - If "Self-Healing Applied" → retry loop is working
   - Note the attempt number and error count

### Step 3: Check Backend Logs

Look for:
```
[V6] [IRFormalizer] formalize - Starting validation-driven formalization (attempt 1)
[V6] [IRFormalizer] validateIRComprehensive - Running 5 validation layers
[V6] [IRFormalizer] validateIRComprehensive - ✅ All validations passed (0 errors)
```

OR (if retry needed):
```
[V6] [IRFormalizer] validateIRComprehensive - ❌ Found 3 validation errors
[V6] [IRFormalizer] formalize - ⚠️ Validation failed on attempt 1, retrying...
[V6] [IRFormalizer] fixIRAttempt - Starting retry attempt 2
[V6] [IRFormalizer] validateIRComprehensive - ✅ All validations passed (0 errors)
[V6] [IRFormalizer] formalize - ✅ Success on attempt 2 (fixed 3 errors)
```

---

## 📝 Metadata Format

The UI expects this metadata structure from `IRFormalizer`:

```typescript
interface FormalizationMetadata {
  attempt_number: number          // 1, 2, or 3
  validation_passed: boolean      // Did validation pass?
  validation_errors_found: number // How many errors were found (on failed attempts)
  total_latency_ms: number       // Total time including retries
  tokens_used: number            // Total tokens across all attempts
}
```

This metadata is returned in:
```typescript
{
  ir: DeclarativeLogicalIRv4,
  formalization_metadata: FormalizationMetadata
}
```

---

## ✅ Summary

### What Changed
- ✅ Header banner explains validation-driven architecture
- ✅ Phase 3 renamed to "Validation-Driven" with "Self-Healing" badge
- ✅ Completion message shows retry metrics (attempt number, errors fixed)
- ✅ Visual distinction between "Perfect First Attempt" and "Self-Healing Applied"
- ✅ Clear indication of feature flag requirement

### What Stays the Same
- Pipeline flow (Phases 0 → 3 → 4 → 5)
- All other phase displays
- Execution, Saved, Diagnostics tabs
- Overall UI structure and styling

### Next Steps
1. Enable feature flag: `V6_VALIDATION_DRIVEN_ENABLED=true`
2. Test from UI: http://localhost:3000/test-v6-declarative.html
3. Monitor backend logs for validation metrics
4. Measure success rate across diverse workflows

---

**UI is ready for testing!** 🎉
