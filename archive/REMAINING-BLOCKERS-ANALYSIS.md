# Remaining Blockers for Generic Intent V1

**Date:** 2026-02-26
**Status:** Generated contract is schema-valid but has **5 hard blockers** requiring compiler features

---

## Hard Blockers (Cannot Compile Without These Features)

### 1. Aggregate Subset Auto-Promotion (CRITICAL) ✅ FIXED

**Problem:** Steps reference subset outputs directly, but they're not top-level RefNames.

**Examples:**
```json
// split_by_amount creates subsets:
"outputs": [
  {"name": "valid_transactions", "type": "subset", ...},
  {"name": "over_threshold", "type": "subset", ...}
]

// Later steps reference them directly:
"inputs": ["valid_transactions"]  // ✅ Now valid!
"inputs": ["over_threshold"]      // ✅ Now valid!
```

**Where it happens:**
- Line 363: `split_valid_by_threshold.inputs = ["valid_transactions"]`
- Line 417: `calculate_totals.inputs = ["valid_transactions", "over_threshold"]`
- Line 447: `write_to_sheets.inputs = ["over_threshold"]`
- Line 564-567: `generate_summary_email.inputs` uses all subset refs

**Fix Implemented:**
Created `SubsetRefResolver` class in `/lib/agentkit/v6/capability-binding/SubsetRefResolver.ts`

**How it works:**
1. Scans all AggregateStep nodes in Intent contract
2. Extracts subset outputs (type: "subset")
3. Promotes each subset to a global RefName
4. Validates that subset refs are only used after the aggregate step that defines them
5. Allows subsets to be referenced within the same aggregate (for `of` field)

**Test Results:** ✅ All tests passing (see `scripts/test-subset-resolver.ts`)
- 4 subsets discovered and promoted correctly
- Usage validation working (detects forward references)
- Handles nested steps (loops, decisions, parallel branches)

---

### 2. Aggregate Subset Item Context (CRITICAL) ✅ FIXED

**Problem:** Subset conditions reference the collection, not the current item being evaluated.

**Example:**
```json
{
  "aggregate": {
    "input": "processed_attachments",
    "outputs": [{
      "name": "valid_transactions",
      "where": {
        "op": "test",
        "left": {"kind": "ref", "ref": "processed_attachments", "field": "amount"},
        "comparator": "exists"
      }
    }]
  }
}
```

The `ref: "processed_attachments"` references the collection, and **by convention** this means "current item being evaluated".

**Where it happens:**
- Line 328: `split_by_amount` subset conditions (follows convention ✅)
- Line 376: `split_valid_by_threshold` subset conditions (follows convention ✅)

**Fix Implemented:**
Extended `SubsetRefResolver` to validate item context convention (Option C).

**How it works:**
1. For each aggregate step with subset outputs
2. Extract all refs from subset where-conditions
3. Validate that condition refs match the aggregate.input (the convention)
4. If ref doesn't match aggregate.input, emit a warning
5. Compiler interprets `{ref: <aggregate.input>}` as "current item"

**Convention Enforced (Option C):**
- In subset conditions, `{ref: <aggregate.input>, field: "field_name"}` means "current item's field"
- The condition is evaluated per-item to determine subset membership
- This is documented in system prompt (lines 477-490) and now enforced by compiler

**Test Results:** ✅ All tests passing
- Contract follows convention correctly (no warnings)
- Violation test correctly detects non-conforming refs (see `scripts/test-subset-item-context-violation.ts`)

---

### 3. Aggregate Sum/Min/Max Missing `of` Field (FIXED ✅)

**Problem:** Generated contract uses `of` on `sum` output, but schema didn't support it.

**Example:**
```json
{
  "name": "total_amount_over_threshold",
  "type": "sum",
  "of": "over_threshold",
  "field": "amount"
}
```

**Fix Applied:**
- ✅ Extended TypeScript schema (line 460-462) to add `of?: RefName` to sum/min/max
- ✅ Updated system prompt (line 502-505) to document this feature

**Status:** RESOLVED - No longer a blocker

---

### 4. Condition AST Semantic Issue (Minor)

**Problem:** Using `"op": "or"` with single condition is redundant.

**Example:**
```json
{
  "where": {
    "op": "or",
    "conditions": [
      {"op": "test", ...}  // Only one condition!
    ]
  }
}
```

**Where it happens:**
- Line 390-406: `at_or_under_threshold` subset uses OR with single condition

**Fix:** LLM should simplify to just the test condition directly (not urgent).

---

### 5. Undefined Subset Refs in Downstream Steps ✅ FIXED

**Problem:** This is a consequence of blocker #1, but worth calling out separately.

**Previously undefined refs (now resolved):**
- `valid_transactions` (used in 3 steps, now promoted as global RefName by `split_by_amount`)
- `over_threshold` (used in 3 steps, now promoted as global RefName by `split_valid_by_threshold`)
- `skipped_attachments` (used in 1 step, now promoted as global RefName by `split_by_amount`)
- `at_or_under_threshold` (now promoted as global RefName by `split_valid_by_threshold`)

**Fix:** Same as blocker #1 - SubsetRefResolver promotes all subset outputs to global scope.

---

## Binding Risks (Not Blockers, But Will Cause Mis-Binding)

### 6. Domain Inconsistency for Gmail

**Issue:** Contract uses `domain="messaging"` for Gmail, but Gmail should be `domain="email"`.

**Where:**
- Line 52: `fetch_unread_emails.uses[0].domain = "messaging"`
- Line 64: `source.domain = "messaging"`
- Line 528: `send_summary_email.uses[0].domain = "messaging"`

**Fix:** System prompt should clarify:
- Email services (Gmail, Outlook): `domain="email"`
- Messaging platforms (Slack, WhatsApp): `domain="messaging"`

---

### 7. Capability Mismatch for Append

**Issue:** Using `capability="create"` for append operation, but should use `capability="append"`.

**Where:**
- Line 467: `append_row.uses[0].capability = "create"` (should be "append")

pregnancyFix:** System prompt should guide: use capability that matches intent verb.

---

### 8. Field Name Inconsistency

**Issue:** Mapping references fields like `sender`, `subject`, `drive_link` that may not exist.

**Where:**
- Lines 527-544: Deliver mapping assumes exact field names
- But earlier transform steps (line 304) just say "merge with email metadata" without defining field names

**Fix:** Either:
1. Compiler infers field names from transform descriptions (brittle)
2. System prompt guides explicit field naming in transform steps
3. Runtime binding resolves field names dynamically

---

## Summary

| Issue | Type | Severity | Requires Compiler Change | Status |
|-------|------|----------|--------------------------|--------|
| 1. Subset auto-promotion | BLOCKER | CRITICAL | YES | ✅ FIXED |
| 2. Subset item context | BLOCKER | CRITICAL | YES | ✅ FIXED |
| 3. `of` on sum/min/max | BLOCKER | HIGH | YES (schema) | ✅ FIXED |
| 4. Redundant OR condition | Semantic | LOW | NO | 🟡 MINOR |
| 5. Undefined subset refs | BLOCKER | CRITICAL | Same as #1 | ✅ FIXED |
| 6. Domain "messaging" vs "email" | Binding risk | MEDIUM | NO (prompt fix) | 🟡 CAN FIX |
| 7. Capability "create" vs "append" | Binding risk | LOW | NO (prompt fix) | 🟡 CAN FIX |
| 8. Field name inconsistency | Binding risk | MEDIUM | MAYBE | 🟡 DEFER |

---

## Next Steps

### For Compiler Team:

1. **Implement aggregate subset auto-promotion** (blocker #1)
   - Track subset outputs as global RefNames
   - Validate refs are only used after aggregate step

2. **Define and enforce item context rule** (blocker #2)
   - Document: `{ref: <aggregate.input>}` in subset where = current item
   - Compiler interprets this during condition evaluation

3. **Extend schema or fix generation** (blocker #3)
   - Add `of?: RefName` to sum/min/max types
   - OR remove `of` usage from generated contracts

### For System Prompt:

1. **Clarify email vs messaging domain** (risk #6)
2. **Guide capability to match intent verb** (risk #7)
3. **Consider explicit field naming in transforms** (risk #8)

---

**Bottom Line:** The generated contract is **NOT ready for CapabilityBinder** until compiler implements subset auto-promotion and item context rules. These are architectural features, not prompt fixes.
