# V6 Plugin Registry Schema - Complete Definition

**Date:** 2026-02-26
**Status:** ✅ SCHEMA DEFINED
**Phase:** Step 1 of Plugin Registry Enhancement

---

## Executive Summary

This document defines the **complete TypeScript schema** for V6 plugin registry enhancement, enabling **deterministic capability binding** without hardcoded plugin logic.

**Key Achievement:**
- Extended `ActionDefinition` interface with 9 new metadata fields
- Extended `PluginDefinition` interface with `provider_family` field
- All changes are **backward compatible** (fields are optional with TODO comments)
- Build passes with zero TypeScript errors

---

## Schema Extensions

### 1. Plugin-Level Metadata

**File:** [lib/types/plugin-types.ts](lib/types/plugin-types.ts:34-56)

```typescript
export interface PluginDefinition {
  plugin: {
    name: string;
    displayName?: string;
    version: string;
    description: string;
    context: string;
    category: PluginCategory;
    auth_config: PluginAuthConfig;

    // === NEW: V6 CAPABILITY BINDING METADATA ===
    /**
     * Provider family identifier for capability binding preferences.
     * REQUIRED: Enables CapabilityUse.preferences.provider_family matching.
     * Examples: "google", "microsoft", "slack", "hubspot", "airtable"
     */
    provider_family?: string; // TODO: Make required after all plugins updated
  };
  actions: Record<string, ActionDefinition>;
}
```

**Why This Matters:**
- Enables intent contracts to specify `preferences: { provider_family: "google" }`
- Binder can filter/score based on provider preference
- No hardcoded provider logic needed in binder

---

### 2. Action-Level Metadata

**File:** [lib/types/plugin-types.ts](lib/types/plugin-types.ts:114-172)

```typescript
export interface ActionDefinition {
  // ... existing fields ...
  description: string;
  usage_context: string;
  parameters: any;
  rules: ActionRuleDefinition;
  output_schema?: ActionOutputSchema;
  output_guidance: ActionOutputGuidance;
  idempotent?: boolean;
  idempotent_alternative?: string;

  // === NEW: V6 CAPABILITY BINDING METADATA ===

  /**
   * Semantic domain this action operates in.
   * REQUIRED: Must match Domain enum from intent-schema-types.ts exactly.
   * Examples: "email", "storage", "table", "crm", "messaging"
   */
  domain?: Domain;

  /**
   * Semantic capability this action provides.
   * REQUIRED: Must match Capability enum from intent-schema-types.ts exactly.
   * Examples: "search", "create", "update", "send_message", "extract_structured_data"
   */
  capability?: Capability;

  /**
   * Entity type this action operates on (input).
   * null if the action doesn't require an existing entity as input.
   * Examples: "email", "file", "folder", "row", "contact"
   */
  input_entity?: string | null;

  /**
   * Entity type this action produces (output).
   * Examples: "email", "file", "folder", "row", "contact"
   */
  output_entity?: string;

  /**
   * Input cardinality: does this action operate on a single item or collection?
   * null if no input entity required.
   */
  input_cardinality?: "single" | "collection" | null;

  /**
   * Output cardinality: does this action produce a single item or collection?
   */
  output_cardinality?: "single" | "collection";

  /**
   * List of output field names this action GUARANTEES to return.
   * Used by compiler to validate downstream field references without runtime guessing.
   * Examples: ["id", "sender", "subject", "body", "date"] for search_emails
   */
  output_fields?: string[];

  /**
   * Required parameter names (must be provided for action to succeed).
   * Extracted from parameters schema for explicit validation.
   */
  required_params?: string[];

  /**
   * Optional parameter names (can be provided but not required).
   * Extracted from parameters schema for explicit validation.
   */
  optional_params?: string[];

  /**
   * Capability flags this action supports (for filtering).
   * Used in CapabilityUse.preferences.must_support matching.
   * Examples: ["unread_filter", "attachment_metadata", "html_email"]
   */
  must_support?: string[];
}
```

---

## Complete Example: Gmail search_emails

### BEFORE (Insufficient Metadata)

```json
{
  "search_emails": {
    "description": "Search for emails in the user's Gmail account",
    "usage_context": "When user wants to find specific emails matching criteria",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "max_results": { "type": "number" }
      }
    },
    "rules": { "limits": {}, "confirmations": {} },
    "output_guidance": {
      "success_description": "Returns matching emails",
      "common_errors": {}
    }
  }
}
```

**Problems:**
- ❌ Binder doesn't know this is for `domain: "email"`
- ❌ Binder doesn't know this provides `capability: "search"`
- ❌ Compiler can't validate if `email.subject` field reference is safe
- ❌ No way to match provider preferences
- ❌ No way to filter by must_support requirements

---

### AFTER (Complete Metadata)

```json
{
  "search_emails": {
    "description": "Search for emails in the user's Gmail account",
    "usage_context": "When user wants to find specific emails matching criteria",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "max_results": { "type": "number" }
      }
    },
    "rules": { "limits": {}, "confirmations": {} },
    "output_guidance": {
      "success_description": "Returns matching emails",
      "common_errors": {}
    },

    "domain": "email",
    "capability": "search",
    "input_entity": null,
    "output_entity": "email",
    "input_cardinality": null,
    "output_cardinality": "collection",
    "output_fields": [
      "id",
      "sender",
      "subject",
      "body",
      "date",
      "is_unread",
      "has_attachments"
    ],
    "required_params": [],
    "optional_params": ["query", "max_results", "include_spam_trash"],
    "must_support": ["unread_filter", "attachment_metadata", "html_email"]
  }
}
```

**Benefits:**
- ✅ Binder matches on `domain: "email"` + `capability: "search"`
- ✅ Compiler validates `email.subject` is safe (in `output_fields`)
- ✅ Provider preferences work via plugin-level `provider_family: "google"`
- ✅ Must-support filtering works via `must_support` array
- ✅ Entity contract validation ensures type safety

---

## How Deterministic Binding Works

### Example Intent Contract Step

```typescript
{
  id: "fetch_emails",
  kind: "data_source",
  summary: "Search for unread emails",
  uses: [{
    domain: "email",
    capability: "search",
    preferences: {
      provider_family: "google",
      must_support: ["unread_filter", "attachment_metadata"]
    }
  }],
  output: "emails"
}
```

### Binding Algorithm

```typescript
// Phase 1: Domain + Capability Matching
const candidates = pluginManager.findActionsByCapability({
  domain: "email",
  capability: "search"
})
// Returns: [
//   { plugin: "google-mail", action: "search_emails", domain: "email", capability: "search" },
//   { plugin: "microsoft-outlook", action: "search_messages", domain: "email", capability: "search" }
// ]

// Phase 2: Provider Preference Filtering
const filtered = candidates.filter(action =>
  action.plugin.provider_family === preferences.provider_family // "google"
)
// Returns: [
//   { plugin: "google-mail", action: "search_emails" }
// ]

// Phase 3: Must-Support Validation
const validated = filtered.filter(action =>
  preferences.must_support.every(flag =>
    action.must_support.includes(flag)
  )
)
// Returns: [
//   { plugin: "google-mail", action: "search_emails" }
// ] (if must_support includes both flags)

// Phase 4: Entity Contract Validation
const safe = validated.filter(action =>
  action.output_entity === nextStep.input_entity &&
  action.output_cardinality === nextStep.input_cardinality
)

// Phase 5: Field Guarantee Validation
const fieldSafe = safe.filter(action =>
  downstreamFieldRefs.every(field =>
    action.output_fields.includes(field)
  )
)

// Result: Single deterministic match
```

**No Hardcoded Logic Required!**

---

## Field Reference Table

| Field | Purpose | Example Values | Validation |
|-------|---------|----------------|------------|
| **domain** | Semantic domain | `"email"`, `"storage"`, `"table"` | Must match `Domain` enum |
| **capability** | Semantic verb | `"search"`, `"create"`, `"update"` | Must match `Capability` enum |
| **input_entity** | Input type | `"email"`, `"file"`, `null` | String or null |
| **output_entity** | Output type | `"email"`, `"file"`, `"folder"` | String |
| **input_cardinality** | Input quantity | `"single"`, `"collection"`, `null` | Enum or null |
| **output_cardinality** | Output quantity | `"single"`, `"collection"` | Enum |
| **output_fields** | Guaranteed fields | `["id", "sender", "subject"]` | String array |
| **required_params** | Required params | `["folder_id"]` | String array |
| **optional_params** | Optional params | `["max_results", "query"]` | String array |
| **must_support** | Capability flags | `["unread_filter"]` | String array |
| **provider_family** | Provider group | `"google"`, `"microsoft"` | String |

---

## Migration Strategy

### Phase 1: Schema Definition ✅ COMPLETE
- Extended TypeScript interfaces
- Added comprehensive documentation
- Build passes with zero errors

### Phase 2: Plugin Updates (NEXT STEP)
Update all 11 plugins with complete metadata:

1. **Google Plugins (5)**
   - [google-mail-plugin-v2.json](lib/plugins/definitions/google-mail-plugin-v2.json)
   - [google-drive-plugin-v2.json](lib/plugins/definitions/google-drive-plugin-v2.json)
   - [google-sheets-plugin-v2.json](lib/plugins/definitions/google-sheets-plugin-v2.json)
   - [google-docs-plugin-v2.json](lib/plugins/definitions/google-docs-plugin-v2.json)
   - [google-calendar-plugin-v2.json](lib/plugins/definitions/google-calendar-plugin-v2.json)

2. **Communication Plugins (3)**
   - [slack-plugin-v2.json](lib/plugins/definitions/slack-plugin-v2.json)
   - [whatsapp-plugin-v2.json](lib/plugins/definitions/whatsapp-plugin-v2.json)
   - [linkedin-plugin-v2.json](lib/plugins/definitions/linkedin-plugin-v2.json)

3. **Other Plugins (3)**
   - [hubspot-plugin-v2.json](lib/plugins/definitions/hubspot-plugin-v2.json)
   - [airtable-plugin-v2.json](lib/plugins/definitions/airtable-plugin-v2.json)
   - [chatgpt-research-plugin-v2.json](lib/plugins/definitions/chatgpt-research-plugin-v2.json)

### Phase 3: Binder Refactor
Refactor `CapabilityBinder` to use structured matching:
- Remove dependency on `intent.plugins`
- Extract requirements from per-step `uses` fields
- Implement domain + capability matching algorithm
- Add preference scoring without hardcoded rules

### Phase 4: Optional Enhancements
- Add small generic synonym normalizer if needed
- Add validation tools to detect missing metadata
- Add migration scripts to validate all plugins

---

## Validation Requirements

### Plugin-Level Validation

```typescript
function validatePluginMetadata(plugin: PluginDefinition): string[] {
  const errors: string[] = []

  // 1. Provider family must be present
  if (!plugin.plugin.provider_family) {
    errors.push("Missing required field: plugin.provider_family")
  }

  // 2. All actions must have complete metadata
  for (const [actionName, action] of Object.entries(plugin.actions)) {
    const actionErrors = validateActionMetadata(actionName, action)
    errors.push(...actionErrors)
  }

  return errors
}
```

### Action-Level Validation

```typescript
function validateActionMetadata(name: string, action: ActionDefinition): string[] {
  const errors: string[] = []

  // 1. Domain and capability are required
  if (!action.domain) {
    errors.push(`${name}: Missing required field: domain`)
  }
  if (!action.capability) {
    errors.push(`${name}: Missing required field: capability`)
  }

  // 2. Entity contracts must be complete
  if (action.output_entity === undefined) {
    errors.push(`${name}: Missing required field: output_entity`)
  }
  if (action.output_cardinality === undefined) {
    errors.push(`${name}: Missing required field: output_cardinality`)
  }

  // 3. Output fields must be array
  if (action.output_fields && !Array.isArray(action.output_fields)) {
    errors.push(`${name}: output_fields must be an array`)
  }

  // 4. Required/optional params must be arrays
  if (action.required_params && !Array.isArray(action.required_params)) {
    errors.push(`${name}: required_params must be an array`)
  }
  if (action.optional_params && !Array.isArray(action.optional_params)) {
    errors.push(`${name}: optional_params must be an array`)
  }

  // 5. Must-support must be array
  if (action.must_support && !Array.isArray(action.must_support)) {
    errors.push(`${name}: must_support must be an array`)
  }

  return errors
}
```

---

## Design Principles

### 1. NO Hardcoded Plugin Logic ✅

**Wrong Approach:**
```typescript
// ❌ DO NOT DO THIS
if (step.uses[0].domain === "email" && user.hasGmail) {
  return pluginManager.getAction("google-mail", "search_emails")
}
```

**Right Approach:**
```typescript
// ✅ DO THIS
const matches = pluginManager.findActionsByCapability({
  domain: step.uses[0].domain,
  capability: step.uses[0].capability
})
const scored = scoreByPreferences(matches, step.uses[0].preferences)
return scored[0] // Highest scoring match
```

### 2. Data-Driven, Not Algorithm-Driven ✅

The solution is **metadata**, not **matching algorithms**.

**Problem:** Binder can't choose between actions
**Wrong Fix:** Add complex heuristic matching logic
**Right Fix:** Add structured metadata so simple matching works

### 3. Scalable to Custom Plugins ✅

Any plugin that declares:
```json
{
  "domain": "email",
  "capability": "search",
  "provider_family": "custom",
  "output_fields": ["id", "subject", "body"]
}
```

Will work **exactly the same** as Gmail plugin. No special cases.

---

## Next Steps

**Immediately After This:**

1. **Step 2: Update Google Mail Plugin**
   - Start with `search_emails` action
   - Add all 9 metadata fields
   - Validate with schema
   - Test with capability binder

2. **Step 3: Update Remaining Google Plugins**
   - Drive, Sheets, Docs, Calendar
   - Follow same pattern

3. **Step 4: Update All Other Plugins**
   - Slack, WhatsApp, LinkedIn
   - HubSpot, Airtable, ChatGPT Research

4. **Step 5: Refactor CapabilityBinder**
   - Implement deterministic matching
   - Test with Generic Intent V1 contract
   - Verify end-to-end workflow execution

---

## Files Modified

### New Files
1. ✅ [V6-PLUGIN-REGISTRY-SCHEMA.md](V6-PLUGIN-REGISTRY-SCHEMA.md) (this file)

### Modified Files
1. ✅ [lib/types/plugin-types.ts](lib/types/plugin-types.ts)
   - Added `Domain` and `Capability` imports
   - Extended `ActionDefinition` with 9 new fields
   - Extended `PluginDefinition.plugin` with `provider_family`
   - Added comprehensive example documentation

---

## Success Metrics

✅ **TypeScript schema defined** with complete field documentation
✅ **Build passes** with zero errors
✅ **Backward compatible** (all new fields optional)
✅ **Example documented** showing before/after
✅ **Binding algorithm explained** with no hardcoded logic
✅ **Validation strategy defined** for plugin updates
✅ **Migration strategy clear** for next phases

---

## Conclusion

**Step 1 is COMPLETE.** The TypeScript schema for V6 plugin registry enhancement is fully defined, documented, and validated.

**Status:** 🟢 READY FOR STEP 2 (Plugin Updates)

**Next Milestone:** Update all 11 plugins with complete metadata, starting with Google Mail plugin.
