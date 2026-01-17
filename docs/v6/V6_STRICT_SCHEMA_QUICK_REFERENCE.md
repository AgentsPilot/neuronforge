# OpenAI Strict Schema Quick Reference

## TL;DR

**With `strict: true`, the LLM CANNOT generate invalid IR. It's mathematically impossible.**

## Key Rules for OpenAI Strict Mode

### 1. All Properties Must Be Required

```typescript
// ❌ WRONG - OpenAI will reject this
{
  type: 'object',
  required: ['name'],  // Only 'name' is required
  properties: {
    name: { type: 'string' },
    age: { type: 'number' }  // ← ERROR: 'age' not in required but not nullable
  }
}

// ✅ CORRECT - All properties in required array
{
  type: 'object',
  required: ['name', 'age'],
  properties: {
    name: { type: 'string' },
    age: { type: 'number' }
  }
}

// ✅ ALSO CORRECT - Optional fields use null
{
  type: 'object',
  required: ['name', 'age'],  // Still required, but can be null
  properties: {
    name: { type: 'string' },
    age: { type: ['number', 'null'] }  // ← Can be null
  }
}
```

### 2. All Objects Need additionalProperties: false

```typescript
// ❌ WRONG - Missing additionalProperties
{
  type: 'object',
  properties: {
    name: { type: 'string' }
  }
}

// ✅ CORRECT
{
  type: 'object',
  additionalProperties: false,  // ← Required for strict mode
  properties: {
    name: { type: 'string' }
  }
}
```

### 3. Enums Must Include null if Nullable

```typescript
// ❌ WRONG - type is nullable but null not in enum
{
  type: ['string', 'null'],
  enum: ['send', 'post', 'publish']  // ← Missing null
}

// ✅ CORRECT
{
  type: ['string', 'null'],
  enum: ['send', 'post', 'publish', null]  // ← null included
}
```

### 4. No oneOf, anyOf, allOf

```typescript
// ❌ WRONG - Strict mode doesn't support oneOf
{
  oneOf: [
    { type: 'string' },
    { type: 'number' }
  ]
}

// ✅ CORRECT - Use explicit nullable types
{
  type: 'string'  // If you truly need union types, make separate fields
}

// ✅ ALSO CORRECT - For truly optional values
{
  type: ['string', 'null']
}
```

## Common Patterns

### Optional String Field

```typescript
{
  type: 'object',
  required: ['optional_field'],  // Must be in required
  additionalProperties: false,
  properties: {
    optional_field: {
      type: ['string', 'null'],  // Can be string OR null
      description: 'Optional field (null if not provided)'
    }
  }
}
```

### Optional Array Field

```typescript
{
  type: 'object',
  required: ['optional_array'],
  additionalProperties: false,
  properties: {
    optional_array: {
      type: ['array', 'null'],  // Can be array OR null
      items: { type: 'string' }
    }
  }
}
```

### Optional Enum Field

```typescript
{
  type: 'object',
  required: ['optional_enum'],
  additionalProperties: false,
  properties: {
    optional_enum: {
      type: ['string', 'null'],
      enum: ['option1', 'option2', 'option3', null]  // null in enum!
    }
  }
}
```

### Optional Object Field

```typescript
{
  type: 'object',
  required: ['optional_nested'],
  additionalProperties: false,
  properties: {
    optional_nested: {
      type: ['object', 'null'],  // Entire object can be null
      required: ['field1', 'field2'],
      additionalProperties: false,
      properties: {
        field1: { type: 'string' },
        field2: { type: 'number' }
      }
    }
  }
}
```

## Testing Your Schema

Always run this after schema changes:

```bash
npx tsx scripts/test-strict-schema.ts
```

**Expected output:**
```
✓ Schema is FULLY COMPATIBLE with OpenAI strict mode
✓ The LLM will be FORCED to follow the schema exactly
✓ No more "new prompt, new error" problems!
```

## Common Errors and Fixes

### Error: "Missing required property in 'required' array"

```
'required' is required to be supplied and to be an array
including every key in properties. Missing 'field_name'.
```

**Fix:** Add the field to the `required` array:

```typescript
{
  type: 'object',
  required: ['field_name'],  // ← Add here
  additionalProperties: false,
  properties: {
    field_name: { type: ['string', 'null'] }
  }
}
```

### Error: "additionalProperties must be false"

```
additionalProperties must be false
```

**Fix:** Add `additionalProperties: false` to all objects:

```typescript
{
  type: 'object',
  additionalProperties: false,  // ← Add this
  properties: {
    // ...
  }
}
```

### Error: "oneOf is not supported"

```
oneOf is not supported in strict mode
```

**Fix:** Use nullable types instead:

```typescript
// Instead of:
oneOf: [
  { type: 'string' },
  { type: 'number' }
]

// Use:
type: 'string'  // Pick one type, or make multiple fields
```

## How the LLM is Constrained

When you use `strict: true`, OpenAI's API:

1. **Parses the schema** before generation
2. **Constrains token generation** to only produce valid JSON
3. **Enforces enums** at the token level (impossible to generate invalid values)
4. **Validates structure** during generation (not after)

**Result:** The LLM literally cannot produce invalid output. It's baked into the generation process.

## Example: Adding a New Edge Case

If you need to support a new edge case like `"rate_limit_reached"`:

### Step 1: Add to the enum in strict schema

```typescript
// In declarative-ir-schema-strict.ts
condition: {
  type: 'string',
  enum: [
    'no_rows_after_filter',
    'empty_data_source',
    'missing_required_field',
    'missing_required_headers',
    'rate_limit_reached',  // ← New value
    // ... other values
  ]
}
```

### Step 2: Add to the validation schema

```typescript
// In declarative-ir-schema.ts (for AJV validation)
condition: {
  type: 'string',
  enum: [
    'no_rows_after_filter',
    'empty_data_source',
    'missing_required_field',
    'missing_required_headers',
    'rate_limit_reached',  // ← New value
    // ... other values
  ]
}
```

### Step 3: Test compatibility

```bash
npx tsx scripts/test-strict-schema.ts
```

### Step 4: Update system prompt (optional)

If you want to guide the LLM to use the new value, update the system prompt:

```markdown
// In declarative-ir-system.md

### Edge Cases

When rate limits are encountered, use:
{
  "condition": "rate_limit_reached",
  "action": "retry",
  "message": "Rate limit reached. Retrying after delay."
}
```

**That's it!** The LLM can now use `"rate_limit_reached"` and will be constrained to only use valid enum values.

## Benefits Summary

| Feature | Benefit |
|---------|---------|
| **Strict enums** | Impossible to generate invalid values |
| **Required all properties** | Every field is either provided or explicitly null |
| **additionalProperties: false** | No unexpected fields can appear |
| **No oneOf/anyOf** | Simple, deterministic schema |
| **Token-level constraint** | Validation happens during generation, not after |

## When to Use Strict Mode

✅ **Use strict mode when:**
- Generating structured data (like our IR)
- You need guaranteed schema compliance
- Validation errors are costly
- You want predictable behavior

❌ **Don't use strict mode when:**
- You need flexible, exploratory output
- Schema might change frequently during development
- You want the LLM to suggest new fields

For V6 declarative IR, **strict mode is essential** because we need guaranteed valid output for compilation.

## Quick Checklist

Before deploying a schema change:

- [ ] All objects have `additionalProperties: false`
- [ ] All properties are in `required` array
- [ ] Optional fields use `type: ['T', 'null']`
- [ ] Nullable enums include `null` in enum array
- [ ] No `oneOf`, `anyOf`, or `allOf` constructs
- [ ] Run `npx tsx scripts/test-strict-schema.ts`
- [ ] Test with real IR generation

If all checkboxes pass, your schema is guaranteed to work with OpenAI strict mode!
