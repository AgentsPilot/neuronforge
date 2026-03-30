# Calibration Loop Fix - Complete Root Cause Analysis

**Date**: 2026-03-23
**Status**: ✅ Fix applied

## Problem Summary

Calibration runs in an infinite loop:
1. Step2 has `field: "emails"` (wrong - should be "attachments")
2. Execution fails: "Flatten operation extracted 0 items using field 'emails'"
3. RepairEngine suggests `extractField: "emails"` (same wrong field)
4. Calibration applies it → same error
5. Loop continues forever

## Root Cause: WorkflowValidator Had Inconsistent Scoring

WorkflowValidator has two code paths:
1. **Missing field validation** (lines 244-362) - When `config.field` is null/undefined
2. **Wrong field validation** (lines 365-465) - When `config.field` exists but is invalid

**The Bug:** Only path #1 was updated with Fix #1's description-prioritized scoring. Path #2 still used OLD scoring.

**Result:** When step2 had `field="emails"` (wrong but not missing), WorkflowValidator used OLD scoring and failed to suggest "attachments".

## The Complete Fix

### Fix #1.5: Update Wrong Field Scoring ✅

**File**: [lib/pilot/WorkflowValidator.ts:401-450](lib/pilot/WorkflowValidator.ts#L401-L450)

Applied description-prioritized scoring to WRONG fields (same as missing fields).

**Impact:**
- Description: "Extract PDF **attachments**"
- OLD scoring: "attachments"=3, "emails"=3, "labels"=3 (all equal)
- NEW scoring: "attachments"=15, "emails"=3, "labels"=3 (clear winner)

## Testing

Now restart calibration and verify:
1. WorkflowValidator detects field="emails" is wrong
2. Suggests field="attachments" (based on description)
3. Calibration applies fix
4. Execution succeeds
5. No loop

---

## Why Not Manual Fix?

You correctly rejected manually fixing the workflow because:
1. **Doesn't solve root cause** - Bug remains in WorkflowValidator
2. **Not scalable** - Every workflow needs manual intervention
3. **Defeats calibration** - System should auto-fix these issues
4. **Violates CLAUDE.md** - "Fix at Root Cause" principle

The correct fix is making WorkflowValidator consistent for ALL workflows.
