# Phase 1: HardRequirements Extraction - COMPLETE

**Date:** February 9, 2026
**Status:** ✅ READY FOR NEXT PHASE

---

## What Was Fixed

### Issue 1: Threshold Detection Failed
**Problem:** Pattern `/(if|only if|when)\s+(\w+)\s*([><=!]+)\s*(\d+)/i` didn't match "greater than" spelled out as words.

**Solution:** Added support for word-based operators:
- "greater than" → `gt`
- "less than" → `lt`
- "greater than or equal to" → `gte`
- "less than or equal to" → `lte`
- "equal to" → `eq`
- "not equal to" → `ne`

**Pattern Added:**
```typescript
/(if|only if|when)\s+(?:the\s+)?(?:extracted\s+)?(\w+)\s+is\s+(greater than|less than|...)\s+(\d+)/i
```

### Issue 2: Side Effect Constraints Not Detected
**Problem:** Logic was looking for `lower.includes('only')` which was too specific.

**Solution:** **Generic approach** - If an action text contains BOTH a threshold AND describes an operation, it's a side effect constraint. No hardcoded action names.

```typescript
if (field && operator && value !== undefined) {
  // This action has a threshold - it's conditional
  hardReqs.side_effect_constraints.push({
    action: action.trim(), // Use full text, no mapping
    allowed_when: `${field}${opSymbol}${value}`,
    forbidden_when: `NOT(${field}${opSymbol}${value})`
  })
}
```

### Issue 3: Duplicate Requirement IDs
**Problem:** `reqIdCounter` was passed by value, not incremented across function calls.

**Solution:** Changed to object reference:
```typescript
const reqIdCounter = { value: 1 } // Pass by reference
// Usage: reqIdCounter.value++
```

### Issue 4: Multiple Unit_of_Work Requirements
**Problem:** Creating 5 unit_of_work requirements (one per data line) instead of 1.

**Solution:** Analyze all data items together, only set `unit_of_work` once:
```typescript
if (!hardReqs.unit_of_work) {
  const allDataText = data.join(' ').toLowerCase()
  // Check patterns once across all data
}
```

---

## Test Results

**Test Enhanced Prompt:** Invoice/Expense workflow (from user example)

### Extracted Requirements (6 total):
```
R1: [unit_of_work] unit_of_work=attachment (source: data[])
R2: [invariant] create_folder→upload_file (sequential) (source: actions[4])
R3: [required_output] output.includes('drive_link') (source: actions[6])
R4: [threshold] Amount>50 (source: actions[8])
R5: [side_effect_constraint] conditional_action[Amount>50] (source: actions[8])
R6: [invariant] delivery AFTER processing (data availability) (source: delivery[0])
```

### Validation Results:
```
✅ unit_of_work: PASS (attachment)
✅ thresholds: PASS (1 threshold: Amount > 50)
✅ invariants: PASS (2 invariants)
✅ required_outputs: PASS (1 output: drive_link)
✅ side_effect_constraints: PASS (1 constraint)

🎉 ALL CHECKS PASSED
```

---

## Key Principles Applied

### 1. No Hardcoding
- **Before:** Checking for specific verbs like "append", "send", "notify"
- **After:** Generic pattern - if threshold exists in action text, it's conditional

### 2. Use Existing Information
- Threshold field name comes from the text itself ("Amount")
- Action description is the full text, not mapped to predefined names
- Side effect constraint captures the relationship, not specific implementation

### 3. Simplicity
- One unit_of_work for entire workflow (not per-line)
- Pass counter by reference (simple object: `{ value: 1 }`)
- Pattern matching for both operators (`>`) and words ("greater than")

---

## Files Modified

1. **`lib/agentkit/v6/requirements/HardRequirementsExtractor.ts`**
   - Added word-based threshold pattern matching
   - Made side effect constraint detection generic
   - Fixed requirement ID counter (pass by reference)
   - Simplified unit_of_work detection (once per workflow)

2. **`scripts/test-hard-requirements.ts`** (NEW)
   - Test script for Phase 1
   - Validates extraction against expected requirements
   - Clear PASS/FAIL output

---

## What Works Now

✅ **Thresholds:** Detects both "Amount > 50" and "Amount is greater than 50"
✅ **Side Effect Constraints:** Generic detection (any action with threshold)
✅ **Unit of Work:** Single requirement, correct priority (attachment > email > row)
✅ **Invariants:** Sequential dependencies + data availability
✅ **Required Outputs:** Detects drive_link, message_id, etc.
✅ **No Duplicates:** Clean requirement IDs (R1, R2, R3...)

---

## Known Limitations

### Still Hardcoded (Acceptable):
- **Unit of work types:** `'email' | 'attachment' | 'row' | 'file' | 'record'`
  - **Why:** ValidationGates uses these specific types for validation logic
  - **Alternative:** Would require changing type system to `string | null`

- **Threshold operators:** gt, lt, gte, lte, eq, ne
  - **Why:** Standard comparison operators, unlikely to need others
  - **Alternative:** Could parse any comparison word, but these cover 99% of cases

### Not Yet Detected:
- **Empty behavior from output section:**
  - "If no matching items are found in the last 24 hours, send a digest email stating that no invoices/expenses were found"
  - Currently only checks data section for "if no" / "if nothing"
  - **TODO:** Extend to output/delivery sections

- **Routing rules:**
  - Pattern: `/(invoice|expense|bill)\s*→\s*(\w+)/i`
  - Only detects explicit arrow notation
  - **TODO:** Detect "route [type] to [destination]" patterns

---

## Next Steps

### Phase 2: Semantic Plan Validation
Now that HardRequirements extraction is working, we can move to Gate 1 validation:

1. **Test semantic plan generation** with extracted requirements
2. **Validate mapping:** Ensure every requirement (R1-R6) maps to semantic plan
3. **Fix semantic plan schema issues** (current blocker)
4. **Verify requirements preserved** through semantic → grounding → IR → DSL

### Testing
```bash
# Run HardRequirements test
npx tsx scripts/test-hard-requirements.ts

# Run full pipeline (when ready)
npm run dev
# Then click "✅ Run with Validation & Auto-Recovery" button
```

---

## Success Metrics

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Duplicate requirements | 5 unit_of_work | 1 unit_of_work | ✅ FIXED |
| Threshold detection | 0/1 | 1/1 | ✅ FIXED |
| Side effect constraints | 0/1 | 1/1 | ✅ FIXED |
| Requirement IDs | R1, R2, R3, R1, R2 (duplicates) | R1, R2, R3, R4, R5, R6 (unique) | ✅ FIXED |
| Test passing | ⚠️ 3/5 checks | ✅ 5/5 checks | ✅ FIXED |

---

## Conclusion

✅ **Phase 1 Complete:** HardRequirements extraction is working correctly.
✅ **Generic Approach:** No hardcoded patterns for specific use cases.
✅ **Test Passing:** All 5 validation checks pass.
✅ **Ready for Phase 2:** Can now move to Semantic Plan validation (Gate 1).

**Status:** 🚀 READY FOR PHASE 2
