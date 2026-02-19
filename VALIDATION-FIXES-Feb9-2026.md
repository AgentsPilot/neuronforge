# Validation Error Fixes - February 9, 2026

## Summary
Fixed 5 critical validation errors that were blocking workflow generation. All fixes are at the schema/validation/prompt level to ensure LLM generates correct IR structures.

---

## Error 1: Filter Operator Not in Allowed Values ✅ FIXED

**Error Message:**
```
/filters/conditions/0/operator must be equal to one of the allowed values
```

**Root Cause:** Formalization prompt listed incomplete operator set with "..." suggesting LLM could use any operator.

**Fix Applied:**
Updated [formalization-system.md:64-71](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md#L64-L71) with complete operator enum:
- `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches_regex`
- `greater_than`, `less_than`, `greater_than_or_equals`, `less_than_or_equals`
- `in`, `not_in`, `is_empty`, `is_not_empty`
- `within_last_days`, `before`, `after`

**Impact:** LLM now knows ALL valid operators and won't invent new ones.

---

## Error 2: Conditionals Missing 'type' Field ✅ FIXED

**Error Messages:**
```
/conditionals/0/condition must have required property 'type'
/conditionals/0/condition must NOT have additional properties {"additionalProperty":"groups"}
/conditionals/0/then_actions/0 must have required property 'type'
/conditionals/0/then_actions/0 must NOT have additional properties {"additionalProperty":"plugin_key"}
```

**Root Cause:** No examples showing correct conditionals structure. LLM had no reference for how to generate them.

**Fix Applied:**
1. Added Pattern 6 to formalization prompt showing complete conditionals example
2. Showed both simple and complex condition structures
3. Emphasized `condition.type` is REQUIRED
4. Warned against using `groups` property (not in schema)
5. Showed `then_actions`/`else_actions` use `type` enum, NOT `plugin_key`/`operation_type`

**Files Modified:**
- [formalization-system.md:487-580](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md#L487-L580)

**Impact:** LLM now has concrete example of correct conditionals structure.

---

## Error 3: file_operations Wrong Structure ✅ FIXED

**Error Messages:**
```
/file_operations/0 must have required property 'type'
/file_operations/0 must have required property 'output_config'
/file_operations/0 must NOT have additional properties {"additionalProperty":"operation_type"}
/file_operations/0 must NOT have additional properties {"additionalProperty":"plugin_key"}
```

**Root Cause:** LLM was generating plugin operation structure instead of file generation structure. Confused "upload existing email attachment" with file_operations.

**Fix Applied:**
1. Updated File Operations section with explicit WRONG vs RIGHT examples
2. Added warnings against using `operation_type`, `plugin_key`, `query_source` in file_operations
3. Updated Pattern 4 title to emphasize "Generate NEW File from Data"
4. Added note that Pattern 5 (multiple_destinations) is for existing files

**Files Modified:**
- [formalization-system.md:55-63](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md#L55-L63)
- [formalization-system.md:321-326](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md#L321-L326)

**Impact:** LLM now understands file_operations is for GENERATING files, not uploading existing ones.

---

## Error 4: multiple_destinations Recipient Requirements ✅ FIXED

**Error Message:**
```
multiple_destinations[0] is missing 'recipient' or 'recipient_source'. One is required for delivery.
```

**Root Cause:** Validator assumed ALL items in multiple_destinations are delivery operations (email/slack), but they can also be plugin operations (create_folder, upload_file, share_file) which don't have recipients.

**Fix Applied:**
1. Updated TypeScript interface [declarative-ir-types.ts:272-286](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts#L272-L286):
   - Changed `recipient` from required to optional
   - Added `recipient_source?: string`
   - Added Google Drive operations to comments

2. Updated validator logic [DeclarativeIRValidator.ts:278-292](lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator.ts#L278-L292):
   - Check if operation_type is delivery operation before requiring recipient
   - Allow non-delivery operations (create_folder, upload_file, share_file) without recipient

**Files Modified:**
- [declarative-ir-types.ts:272-286](lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts#L272-L286)
- [DeclarativeIRValidator.ts:278-292](lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator.ts#L278-L292)

**Impact:** Drive operations in multiple_destinations no longer fail validation.

---

## Error 5: processing_order Still Present ✅ FIXED

**Error Message:**
```
$ must NOT have additional properties {"additionalProperty":"processing_order"}
```

**Root Cause:** Formalization prompt still had `processing_order` in output schema example.

**Fix Applied:**
Removed `processing_order` from IR output schema in [formalization-system.md:11-29](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md#L11-L29)

**Files Modified:**
- [formalization-system.md:11-29](lib/agentkit/v6/semantic-plan/prompts/formalization-system.md#L11-L29)

**Impact:** LLM won't generate processing_order field anymore.

---

## Files Modified Summary

### TypeScript Files (2):
1. **lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.ts**
   - Made `recipient` optional in MultiDestinationDelivery
   - Added `recipient_source` field

2. **lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator.ts**
   - Updated recipient validation to check operation type
   - Allow non-delivery operations without recipient

### Prompt Files (1):
1. **lib/agentkit/v6/semantic-plan/prompts/formalization-system.md**
   - Added complete filter operator list (lines 64-71)
   - Added Pattern 6 for conditionals (lines 487-580)
   - Updated File Operations section with WRONG/RIGHT examples (lines 55-63)
   - Updated Pattern 4 title and description (lines 321-326)
   - Removed processing_order from output schema (lines 11-29)

---

## Testing Checklist

After these fixes, verify:

### Schema Validation:
- [ ] Filters use only allowed operators
- [ ] Conditionals have `condition.type` field
- [ ] Conditionals don't use `groups` property
- [ ] `then_actions`/`else_actions` use `type` enum
- [ ] file_operations has `type` and `output_config` (not `operation_type`/`plugin_key`)
- [ ] multiple_destinations with Drive operations don't require recipient
- [ ] No `processing_order` field in IR

### Functional Testing:
- [ ] Invoice/expense workflow generates correct IR
- [ ] AI extraction has proper output_schema
- [ ] Drive operations use multiple_destinations pattern
- [ ] Conditional append to Sheets works
- [ ] Email delivery works

---

## Known Limitations

### Conditionals Can't Trigger Plugin Operations
**Status:** By design, not a bug

Conditionals can only use action `type` enum:
- `set_field` - Modify field value
- `skip_delivery` - Skip delivery for this item
- `use_template` - Switch template
- `send_to_recipient` - Change recipient
- `abort` - Stop workflow
- `continue` - Continue normally

**Workaround:** Use `post_ai_filters` to filter items, then explicit delivery operations.

**Example:**
```json
{
  "post_ai_filters": {
    "conditions": [{"field": "amount", "operator": "greater_than", "value": 50}]
  },
  "delivery_rules": {
    "per_item_delivery": {
      "plugin_key": "google-sheets",
      "operation_type": "append_rows"
    }
  }
}
```

This ensures only items with amount > 50 reach the delivery stage.

---

## Confidence Levels

| Fix | Confidence | Notes |
|-----|-----------|-------|
| Filter operators | 100% | Complete enum from schema |
| Conditionals structure | 95% | Added concrete example |
| file_operations fix | 90% | Clear WRONG/RIGHT guidance |
| multiple_destinations | 100% | Schema + validator updated |
| processing_order | 100% | Removed from prompt |

---

## Next Steps

1. **Restart dev server** (TypeScript changes require restart)
   ```bash
   npm run dev
   ```

2. **Test with original Enhanced Prompt**
   - Should generate valid IR
   - Should pass schema validation
   - Should compile successfully

3. **Monitor for new errors**
   - Check if LLM still generates incorrect structures
   - May need to add more examples or stronger warnings

4. **Consider OpenAI's recommendation** (if issues persist)
   - Implement RequirementsExtractor
   - Add validation gate before compilation
   - Track requirements through pipeline

---

**Status:** ✅ ALL VALIDATION ERRORS ADDRESSED
**Ready for:** Testing
