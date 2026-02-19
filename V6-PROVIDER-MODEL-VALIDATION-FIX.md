# V6 Provider/Model Validation Fix

**Date**: February 17, 2026
**Status**: ✅ FIXED

## Issue

The V6 pipeline was failing with error:
```
NotFoundError: 404 model: gpt-4o
[HardRequirementsExtractor] Starting LLM-based extraction (anthropic/gpt-4o)...
```

**Root Cause**: The database contained an invalid provider/model combination:
- `semantic.provider = "anthropic"`
- `semantic.model = "gpt-4o"`

This caused the system to try sending `gpt-4o` (an OpenAI model) to the Anthropic API, which rejected it with a 404 error.

## How This Happened

The admin UI was missing validation to prevent users from saving invalid provider/model combinations. Users could:
1. Select a model from the dropdown
2. The `inferProvider()` function would auto-detect the correct provider
3. BUT if the user had previously saved a config, the provider field could become mismatched
4. The UI would allow saving this invalid configuration

## Fix Applied

### 1. Added Provider/Model Validation

Added a validation function that checks if the provider matches the model:

```typescript
const validateProviderModelMatch = (provider: string, model: string): boolean => {
  const modelLower = model.toLowerCase();

  if (provider === 'anthropic') {
    // Anthropic models must contain claude/opus/sonnet/haiku
    return modelLower.includes('claude') ||
           modelLower.includes('opus') ||
           modelLower.includes('sonnet') ||
           modelLower.includes('haiku');
  } else {
    // OpenAI models must contain gpt/o1
    return modelLower.includes('gpt') ||
           modelLower.includes('o1') ||
           modelLower.startsWith('text-');
  }
};
```

### 2. Pre-Save Validation

Modified `handleSave()` to validate all phase configurations before saving:

```typescript
// Validate provider/model combinations
const validationErrors: string[] = [];

if (!validateProviderModelMatch(config.requirements.provider, config.requirements.model)) {
  validationErrors.push(`Requirements: ${config.requirements.model} is not a valid ${config.requirements.provider} model`);
}

if (!validateProviderModelMatch(config.semantic.provider, config.semantic.model)) {
  validationErrors.push(`Semantic: ${config.semantic.model} is not a valid ${config.semantic.provider} model`);
}

if (!validateProviderModelMatch(config.formalization.provider, config.formalization.model)) {
  validationErrors.push(`Formalization: ${config.formalization.model} is not a valid ${config.formalization.provider} model`);
}

if (validationErrors.length > 0) {
  throw new Error('Invalid provider/model combinations:\n' + validationErrors.join('\n'));
}
```

### 3. Visual Validation Indicators

Updated the model dropdown to show visual warnings for invalid combinations:

```typescript
const isValid = validateProviderModelMatch(config[phase].provider, config[phase].model);

// Red border if invalid
className={`... ${isValid ? 'border-gray-600' : 'border-red-500'}`}

// Warning text if invalid
{!isValid && (
  <p className="text-xs text-red-400 font-medium">
    ⚠️ Invalid combination
  </p>
)}
```

## What the User Needs to Do

### IMMEDIATE ACTION REQUIRED:

1. **Open the Admin UI**: Navigate to `/admin/agent-generation-config`

2. **Check for Red Borders**: Look for any model dropdowns with red borders and "⚠️ Invalid combination" warnings

3. **Fix Invalid Combinations**:
   - For each phase with a red border:
     - Either change the model to match the current provider
     - OR the provider will auto-correct when you select a different model from the dropdown

4. **Save the Configuration**: Click "Save Configuration"

5. **Verify**: The errors should now show green borders and the pipeline should work

### Example Fix

If you see:
- Provider: `anthropic`
- Model: `gpt-4o`
- ⚠️ Invalid combination

**Option 1**: Change model to an Anthropic model:
- Select `claude-opus-4-6` or `claude-sonnet-4-5` from dropdown
- Provider will remain `anthropic`

**Option 2**: Change model to an OpenAI model correctly:
- Select `gpt-4o` again from the dropdown
- Provider will auto-correct to `openai`

## Technical Details

### Validation Rules

**Anthropic Models** (provider must be `anthropic`):
- Must contain: `claude`, `opus`, `sonnet`, or `haiku`
- Examples: `claude-opus-4-6`, `claude-sonnet-4-5`, `claude-3-5-haiku-20241022`

**OpenAI Models** (provider must be `openai`):
- Must contain: `gpt` or `o1`
- OR start with: `text-`
- Examples: `gpt-4o`, `gpt-4o-mini`, `o1-preview`, `text-davinci-003`

### Where Validation Happens

1. **Frontend Validation** ([app/admin/agent-generation-config/page.tsx](app/admin/agent-generation-config/page.tsx)):
   - Visual indicators (red borders)
   - Pre-save validation
   - Prevents invalid saves

2. **Auto-Correction** ([app/admin/agent-generation-config/page.tsx:166-177](app/admin/agent-generation-config/page.tsx#L166-L177)):
   - When user selects a new model from dropdown
   - `inferProvider()` auto-detects correct provider
   - Provider field is automatically updated

## Modified Files

- [app/admin/agent-generation-config/page.tsx](app/admin/agent-generation-config/page.tsx)
  - Added `validateProviderModelMatch()` function (before `handleSave`)
  - Added validation checks in `handleSave()` (lines 95-135)
  - Added visual indicators in `renderModelDropdown()` (lines 160-204)

## Testing

After fixing your configuration in the admin UI:

1. **Test in Admin UI**:
   - Open `/admin/agent-generation-config`
   - Verify all phases show green borders (no red borders)
   - Click "Save Configuration"
   - Should see "Configuration saved successfully!"

2. **Test in Pipeline**:
   - Open `/test-v6-declarative.html`
   - Run a test workflow
   - Should see no more 404 model errors
   - All phases should use correct provider/model combinations

## Success Criteria

✅ No red borders in admin UI
✅ Configuration saves without validation errors
✅ Pipeline runs without 404 model errors
✅ Correct provider used for each model:
   - `gpt-4o` → OpenAI API
   - `claude-opus-4-6` → Anthropic API
   - etc.

## Related Documentation

- [V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md](V6-ADMIN-CONFIG-INTEGRATION-COMPLETE.md) - Original admin config integration
- [V6-ADMIN-UI-PROVIDER-FIX-COMPLETE.md](V6-ADMIN-UI-PROVIDER-FIX-COMPLETE.md) - Adding provider field to UI
