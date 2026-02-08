# V6 Architecture Gap: Missing Generic Plugin Operations Layer

## Problem Statement

V6 IR schema cannot represent **intermediate plugin operations** that don't fit into predefined categories (data_sources, ai_operations, file_operations, delivery_rules).

### Example: Invoice Processing with Google Drive

**User Intent:**
1. Search Gmail for invoices
2. **Store attachments in Google Drive** ← CANNOT BE REPRESENTED
3. Extract fields with AI
4. **Append to Google Sheets** ← FORCED INTO delivery_rules (wrong semantic)
5. Email summary

**Current IR Limitations:**
- `data_sources`: Only for READ operations (Gmail search ✓)
- `ai_operations`: Only for LLM operations (extraction ✓)
- `file_operations`: Limited to file generation/upload (Drive upload ✗ - wrong semantic)
- `delivery_rules`: Only for FINAL output (Sheets append forced here ✗, email ✓)

**What's Missing:** A way to represent "Store in Drive" as an intermediate operation step.

## Root Cause

The IR schema assumes a **linear pipeline**:
```
INPUT (data_sources) → PROCESS (ai_operations) → OUTPUT (delivery_rules)
```

But real workflows are **multi-step with plugin actions**:
```
Gmail → Drive Upload → AI Extract → Sheets Write → Email Send
  ↓         ↓             ↓             ↓            ↓
data_   [MISSING]   ai_operations  [MISSING]   delivery_
sources                                          rules
```

## Impact

**Affects 100+ plugins:**
- ❌ Google Drive upload/create folder
- ❌ WhatsApp send message
- ❌ Slack post message
- ❌ Airtable update record
- ❌ Notion create page
- ❌ Trello create card
- ❌ Asana create task
- ❌ Any plugin action that's not READ, AI, or FINAL DELIVERY

## Proposed Solution

### Option 1: Add `plugin_operations[]` to IR Schema

```typescript
export interface DeclarativeLogicalIR {
  // ... existing fields ...

  // NEW: Generic plugin operations layer
  plugin_operations?: PluginOperation[]

  // ... rest of fields ...
}

export interface PluginOperation {
  id: string
  plugin_key: string  // e.g., "google-drive", "whatsapp", "slack"
  operation_type: string  // e.g., "upload_file", "send_message", "create_record"
  description: string  // What this operation does

  // Generic config - plugin-specific parameters
  config: Record<string, any>

  // Input data for this operation
  input_source?: string  // Variable reference (e.g., "{{data.attachments}}")

  // Output variable name (for use in later steps)
  output_variable?: string  // e.g., "drive_links"

  // When to execute (ordering)
  depends_on?: string[]  // IDs of operations that must complete first

  // Error handling
  on_error?: 'fail' | 'continue' | 'retry'
  retry_count?: number
}
```

**Example usage:**
```json
{
  "plugin_operations": [
    {
      "id": "upload_to_drive",
      "plugin_key": "google-drive",
      "operation_type": "upload_file",
      "description": "Store email attachments in vendor-organized folders",
      "config": {
        "folder_id": "1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-",
        "create_subfolder": true,
        "subfolder_name": "{{extracted.vendor}}"
      },
      "input_source": "{{data.attachments}}",
      "output_variable": "drive_links",
      "depends_on": [],
      "on_error": "fail"
    },
    {
      "id": "append_to_sheets",
      "plugin_key": "google-sheets",
      "operation_type": "append_row",
      "description": "Log invoice to tracking sheet",
      "config": {
        "spreadsheet_id": "1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE",
        "tab_name": "Invoices",
        "values": ["{{extracted.date}}", "{{extracted.vendor}}", "{{extracted.amount}}", "{{drive_links[0]}}"]
      },
      "depends_on": ["upload_to_drive"],
      "on_error": "continue"
    }
  ]
}
```

### Option 2: Extend `ai_operations` to Support Non-AI Plugin Actions

Rename `ai_operations` to `operations` and add more types:

```typescript
export interface Operation {
  type: 'ai_extract' | 'ai_classify' | 'plugin_action' | 'transform' | ...

  // For plugin_action type:
  plugin_key?: string
  operation_type?: string
  config?: Record<string, any>

  // ... rest of fields ...
}
```

**Pros:**
- Smaller change to existing schema
- Operations stay in processing layer

**Cons:**
- Semantically confusing (not all operations are "AI")
- Harder to maintain

### Option 3: Make `delivery_rules` Support Intermediate Destinations

Allow `delivery_rules.multiple_destinations` to have an `is_intermediate` flag:

```typescript
{
  "multiple_destinations": [
    {
      "name": "Store in Drive",
      "plugin_key": "google-drive",
      "operation_type": "upload_file",
      "is_intermediate": true,  // NOT final delivery
      "output_variable": "drive_links",
      ...
    },
    {
      "name": "Email summary",
      "plugin_key": "gmail",
      "operation_type": "send_email",
      "is_intermediate": false,  // Final delivery
      ...
    }
  ]
}
```

**Pros:**
- No new top-level field needed
- Reuses existing structure

**Cons:**
- Semantic confusion ("delivery" for intermediate ops)
- Execution order ambiguity (which runs first?)

## Recommendation

**Option 1** is the cleanest architectural solution:
1. ✅ Semantically clear (plugin_operations are intermediate actions)
2. ✅ Scalable to all 100+ plugins
3. ✅ Explicit execution ordering with `depends_on`
4. ✅ Output variables enable data flow between steps
5. ✅ No prompt engineering needed - LLM just follows schema

## Implementation Steps

1. **Update IR Schema** (`declarative-ir-types.ts`)
   - Add `PluginOperation` interface
   - Add `plugin_operations?: PluginOperation[]` to `DeclarativeLogicalIR`

2. **Update IR Schema Validation** (`declarative-ir-schema.ts`)
   - Add JSON schema for `plugin_operations`

3. **Update Formalization Prompt** (`formalization-system.md`)
   - Add section 2.11 for `plugin_operations[]` mapping
   - Explain when to use vs `data_sources` / `delivery_rules`

4. **Update IR Executor** (V6 executor/compiler)
   - Execute `plugin_operations` after `ai_operations` but before `delivery_rules`
   - Resolve `depends_on` for execution order
   - Store `output_variable` in context for later steps

5. **Test with Real Scenarios**
   - Gmail → Drive → Sheets workflow
   - Multi-step Slack/WhatsApp workflows
   - Complex Airtable/Notion automations

## Alternative: Stop Using V6

If this change is too large, consider:
- Use V5 (AgentKit) for complex workflows - it has full plugin support
- Use V6 only for simple READ → AI → DELIVER workflows
- Deprecate V6 until generic operations are added

The current V6 architecture is **fundamentally incomplete** for real-world automation.
