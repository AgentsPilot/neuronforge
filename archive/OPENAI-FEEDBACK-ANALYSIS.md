# OpenAI Feedback Analysis - Generic Intent V1 Contract

**Date:** 2026-02-26
**Contract:** `output/generic-intent-v1-contract.json`
**Focus:** Binder/Compiler Determinism Issues

---

## Issue Classification

### ✅ Schema-Valid but Binder-Breaking Issues (10 found)

These are NOT TypeScript schema violations, but semantic/binding ambiguities that will break CapabilityBinder or ExecutionGraphCompiler.

---

## Issue 1: Wrong Domain Values (CRITICAL - System Prompt Fix)

**Problem:** Gmail is modeled as `domain="messaging"` instead of `domain="email"`

**Locations:**
- `fetch_unread_emails.uses[].domain = "messaging"` (line 53)
- `fetch_unread_emails.source.domain = "messaging"` (line 65)
- `send_summary_email.uses[].domain = "messaging"` (line 554)

**Expected:**
- Gmail operations should use `domain="email"`
- `domain="messaging"` should be for chat platforms (Slack, Discord, etc.)

**Impact:** CapabilityBinder will fail to match capabilities to Gmail plugin actions

**Fix Location:** ❌ **NOT a system prompt issue** - The system prompt correctly uses generic examples and doesn't hardcode domains. The LLM chose "messaging" based on the user prompt mentioning "Gmail emails". This is a **CapabilityBinder configuration issue** - the binder needs to know that Gmail provider supports both "email" and "messaging" domains, OR the enhanced prompt should specify domain preferences.

**Recommended Solution:**
1. **Short-term:** Update CapabilityBinder to map both `email.search` and `messaging.search` to Gmail plugin
2. **Long-term:** Add domain hints to enhanced prompt generation based on detected services

---

## Issue 2: Invalid Retrieval Shape (System Prompt Fix NEEDED)

**Problem:** `fetch_unread_emails.retrieval` includes `"include_related_data": true` which is NOT in the schema

**Schema Definition:**
```typescript
retrieval?: {
  max_results?: number,
  include_content?: "none" | "snippet" | "full",
  include_attachments?: boolean,
  include_metadata?: boolean
}
```

**Generated (line 86-90):**
```json
"retrieval": {
  "include_content": "full",
  "include_metadata": true,
  "include_related_data": true  // ❌ NOT IN SCHEMA
}
```

**Impact:** Strict validation will fail, or field will be silently ignored (non-deterministic)

**Root Cause:** System prompt line 207 defines `include_related_data?: boolean` which doesn't match the actual TypeScript schema in `intent-schema-types.ts`

**Fix Location:** ✅ **System Prompt Fix Required**

**Action:** Update system prompt line 207 from:
```typescript
"include_related_data"?: boolean,
```
To:
```typescript
"include_attachments"?: boolean,
```

---

## Issue 3: Missing Step Output Shapes (Compiler/Schema Fix)

**Problem:** Several steps rely on implied fields but don't declare them

**Example:** `extract_attachments` (flatten) claims it preserves `sender/subject`, but no explicit contract that attachment objects contain:
- `email_sender`
- `email_subject`
- `message_id`
- `attachment_id`
- `mimeType`
- `filename`
- `drive_link` (added later)

**Later Usage:** `append_transaction_row` mapping expects these fields (lines 441-503)

**Impact:** Compiler doesn't have canonical "attachment shape" - becomes guessing

**Fix Location:** ❌ **NOT a system prompt issue** - This is a **compiler responsibility**. The Intent layer is intentionally execution-agnostic. Field shape inference should happen during IR compilation based on plugin schemas and transform operations.

**Recommended Solution:** ExecutionGraphCompiler should:
1. Track semantic field propagation through transform operations
2. Validate field references against inferred shapes
3. Provide clear errors if fields don't exist

---

## Issue 4: ArtifactStep Options Type Mismatch (Schema Ambiguity)

**Problem:** `artifact.options` contains ValueRef objects, but schema defines it as `JsonObject`

**Schema Definition:**
```typescript
artifact: {
  strategy: string,
  name_hint?: string,
  options?: JsonObject
}
```

**Generated (lines 141-146):**
```json
"options": {
  "name": {
    "kind": "config",
    "key": "drive_folder_name"
  }
}
```

**Impact:** If binder expects plain JSON primitives in `options`, this will fail. If `options` accepts ValueRef, it's untyped and binder-specific.

**Fix Location:** ❌ **NOT a system prompt issue** - This is a **schema design decision**. Either:
1. Schema should define `options` as `Record<string, ValueRef | JsonValue>` explicitly
2. Or system prompt should guide to ONLY use `name_hint` for simple names

**Current System Prompt (line 231):** Says `name_hint` MUST be plain string, and `options` is for ValueRef - this is CORRECT guidance.

**Recommended Solution:** Update TypeScript schema to allow ValueRef in options:
```typescript
options?: Record<string, ValueRef | JsonPrimitive>
```

---

## Issue 5: Aggregate Subset Outputs Not Promoted to Top-Level Refs (CRITICAL - Compiler Invariant)

**Problem:** `split_by_amount` outputs ONLY `"transaction_metrics"`, but creates subsets named:
- `valid_transactions`
- `invalid_transactions`
- `over_threshold_transactions`

**Later steps reference these as top-level refs:**
- `write_to_sheets.inputs` includes `"over_threshold_transactions"` (line 404)
- `generate_summary_email.inputs` includes `"valid_transactions"`, `"over_threshold_transactions"`, `"invalid_transactions"` (lines 515-518)

**Schema Definition (AggregateStep):**
```typescript
{
  output?: RefName,  // SINGLE output
  aggregate: {
    outputs: Array<{
      name: string,  // subset names
      type: "subset" | "count" | "sum" | ...
    }>
  }
}
```

**Impact:** Compiler break unless there's an auto-promotion rule

**Fix Location:** ❌ **NOT a system prompt issue** - This requires a **compiler invariant**

**Recommended Solution:**
**Option 1 (Preferred):** Compiler auto-promotes aggregate subset outputs to top-level RefNames
- Add invariant: "Aggregate outputs with `type: 'subset'` are promoted to top-level symbolic refs"
- Document in CLAUDE.md
- Implement in ExecutionGraphCompiler

**Option 2:** Change system prompt to nest references:
- `split_by_amount` outputs: `"transaction_metrics"`
- Downstream steps reference: `"transaction_metrics"` as input
- Use ValueRef with field access: `{kind:"ref", ref:"transaction_metrics", field:"valid_transactions"}`

**Current System Prompt Guidance:** Line 475 says "subset outputs create named symbolic refs that downstream steps can reference directly" - this ASSUMES compiler auto-promotion.

**Action Required:** Document this as a compiler invariant in CLAUDE.md and implement in compiler.

---

## Issue 6: Condition AST Error - Wrong Field Name (System Prompt Fix NEEDED)

**Problem:** `invalid_transactions.where` uses `conditions` (array) instead of `condition` (singular)

**Generated (lines 345-358):**
```json
{
  "op": "not",
  "conditions": [  // ❌ WRONG - should be "condition"
    {
      "op": "test",
      "left": { ... },
      "comparator": "exists"
    }
  ]
}
```

**Schema Definition:**
```typescript
type Condition =
  | { op: "and" | "or", conditions: Condition[] }
  | { op: "not", condition: Condition }  // ← SINGULAR
  | { op: "test", left: ValueRef, comparator: Comparator, right?: ValueRef }
```

**Impact:** Schema violation - will break validation/compiler

**Fix Location:** ✅ **System Prompt Fix Required**

**Action:** Update system prompt line 387 from:
```typescript
{
  "op": "and" | "or" | "not",
  "conditions": Condition[]
}
```
To:
```typescript
{
  "op": "and" | "or",
  "conditions": Condition[]
}
OR
{
  "op": "not",
  "condition": Condition  // SINGULAR for "not"
}
```

---

## Issue 7: Wrong Condition Left Operand in Aggregate (Schema/Compiler Ambiguity)

**Problem:** Aggregate subset conditions reference the entire collection, not individual items

**Generated (lines 334-339):**
```json
"left": {
  "kind": "ref",
  "ref": "processed_attachments",  // ← references ENTIRE collection
  "field": "amount"
}
```

**Question:** Does this mean:
- "Any item in processed_attachments has amount field"?
- "Each item in processed_attachments has amount field"?
- Something else?

**Impact:** Non-deterministic - compiler doesn't know if this checks any/all/each

**Fix Location:** ❌ **NOT a system prompt issue** - This is a **schema/compiler semantic definition**

**Recommended Solution:** Add schema documentation that in AggregateStep subset `where` conditions:
- `ref` implicitly refers to "each item in the input collection"
- The condition is evaluated per-item to determine subset membership

**Alternative:** Add explicit `item_ref` convention:
```json
"left": {
  "kind": "ref",
  "ref": "$item",  // ← magic ref meaning "current item"
  "field": "amount"
}
```

**Current System Prompt:** Doesn't explicitly define this semantic. Should add clarification.

**Action:** Add to system prompt section 6.10 (Aggregate):
```
NOTE: In subset conditions, ValueRef with ref=<input_collection> and field=<field_name>
means "evaluate this field on each item in the collection". The condition is tested
per-item to determine subset membership.
```

---

## Issue 8: Capability + Domain Inconsistencies for Sheets (System Prompt Guidance)

**Problem:** Sheets append uses `domain="storage"` instead of `domain="table"`

**Generated (lines 424, 435):**
```json
"capability": "append_record",
"domain": "storage"  // ❌ Should be "table"?
```

**Impact:** If binder maps `table.append` to Sheets, `storage.append_record` is ambiguous (could be Drive, DB, etc.)

**Fix Location:** ❌ **NOT a system prompt issue** - System prompt correctly uses generic examples. This is a **CapabilityBinder mapping issue**.

**Recommended Solution:** CapabilityBinder should support multiple domain mappings for the same plugin:
- Google Sheets supports: `table.*`, `storage.*` (for compatibility)
- Or enhanced prompt should specify domain preferences based on detected artifact type

---

## Issue 9: Missing Collect Config in write_to_sheets Loop (Minor - Best Practice)

**Problem:** `write_to_sheets` loop has no `collect.enabled`

**Generated (lines 407-508):**
```json
"loop": {
  "over": "over_threshold_transactions",
  "item_ref": "transaction",
  "unit_of_work": { "entity": "transaction" },
  "do": [ ... ]
  // ❌ No collect config
}
```

**Impact:** No audit/tracking of per-row append results. Not a schema violation, but may cause runtime issues if error handling needs per-item status.

**Fix Location:** ⚠️ **System Prompt Guidance Optional** - Could add recommendation to always include `collect` for error handling

**Recommended Solution:** Add to system prompt loop guidance:
```
NOTE: If loop body steps can fail individually, consider enabling collect to capture
per-item results for error handling and audit trails.
```

---

## Issue 10: Extract Step Input Ambiguity (Compiler/Binder Responsibility)

**Problem:** `extract_transaction_fields` uses `input: "uploaded_file"` (Drive file ref). Extract expects content.

**Generated (line 256):**
```json
"extract": {
  "input": "uploaded_file",  // ← storage ref, not content
  ...
}
```

**Impact:** Extract step needs file content (bytes/text). If input is just a storage reference, binder must auto-fetch content.

**Fix Location:** ❌ **NOT a system prompt issue** - This is a **binder responsibility**

**Recommended Solution:** CapabilityBinder should:
1. Detect when extract step input is a storage ref
2. Auto-inject a "fetch_content" operation before extract
3. Or recognize that some extract providers can accept storage refs directly (e.g., Claude with Drive URLs)

---

## Summary: Required Fixes

### 🔴 System Prompt Fixes (2 required)

1. ✅ **Issue 2:** Remove `include_related_data` from retrieval schema (line 207)
2. ✅ **Issue 6:** Fix Condition AST for `not` operator (line 387)

### 🟡 System Prompt Enhancements (2 optional)

3. ⚠️ **Issue 7:** Add semantic clarification for aggregate subset conditions
4. ⚠️ **Issue 9:** Add guidance to use collect for error handling

### 🟢 Compiler/Binder Fixes (6 required)

5. ❌ **Issue 1:** CapabilityBinder domain mapping flexibility
6. ❌ **Issue 3:** ExecutionGraphCompiler field shape inference
7. ❌ **Issue 4:** TypeScript schema to allow ValueRef in artifact.options
8. ❌ **Issue 5:** Compiler invariant: auto-promote aggregate subset outputs
9. ❌ **Issue 8:** CapabilityBinder multi-domain support for same plugin
10. ❌ **Issue 10:** CapabilityBinder auto-fetch content for extract steps

---

## Next Actions

### Immediate (System Prompt)
1. Fix `include_related_data` → `include_attachments` (line 207)
2. Fix Condition AST `not` operator to use singular `condition` (line 387)
3. Add aggregate subset condition semantic clarification
4. Regenerate contract and verify fixes

### Follow-up (Compiler/Binder)
1. Document aggregate subset auto-promotion invariant in CLAUDE.md
2. Implement field shape tracking in ExecutionGraphCompiler
3. Add multi-domain capability mapping to CapabilityBinder
4. Implement auto-content-fetch for extract steps in CapabilityBinder
5. Update TypeScript schema to support ValueRef in artifact.options

---

**Status:** 🟡 2 critical system prompt fixes identified, 6 compiler/binder improvements needed
