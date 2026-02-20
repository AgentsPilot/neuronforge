# Deduplication Pattern Solution - February 19, 2026

## Problem Statement

**Observed Behavior:**
Workflow creates duplicate folders every time it runs:
- Multiple "Email Attachments - Expenses" folders in Drive
- Each run creates a NEW folder instead of using existing one
- Results in clutter and disorganization

**User Insight:**
> "I noticed another issue. The created folder doesn't check duplication so it creates many folders at the same name. (not sure why drive is allowing it) However think about other plugin that we need to check duplication not just drive so it needs to be plugin agnostic."

**Google Drive allows duplicate names** because:
- Folders are identified by ID, not name
- Multiple folders can have the same name
- User can create "Folder1", "Folder1", "Folder1" all as separate entities

**Need:** Plugin-agnostic deduplication pattern

---

## Current Workflow (BUGGY)

```json
{
  "id": "step2",
  "type": "action",
  "action": "create_folder",
  "params": {
    "folder_name": "Email Attachments - Expenses"
  },
  "plugin": "google-drive",
  "output_variable": "drive_folder"
}
```

**Result:** Creates new folder EVERY time, even if "Email Attachments - Expenses" already exists.

---

## Solution: "Find or Create" Pattern

### Pattern Structure

**Step 1: Search for existing resource**
```json
{
  "id": "step2a",
  "type": "action",
  "action": "search_files",  // or search_folders, find_record, etc.
  "params": {
    "query": "name='Email Attachments - Expenses' and mimeType='application/vnd.google-apps.folder'",
    "max_results": 1
  },
  "plugin": "google-drive",
  "output_variable": "existing_folder"
}
```

**Step 2: Conditional - Create only if not found**
```json
{
  "id": "step2b",
  "type": "conditional",
  "condition": {
    "type": "simple",
    "variable": "existing_folder.files",
    "operator": "is_empty",
    "value": true
  },
  "then": [
    {
      "id": "step2c",
      "type": "action",
      "action": "create_folder",
      "params": {
        "folder_name": "Email Attachments - Expenses"
      },
      "plugin": "google-drive",
      "output_variable": "created_folder"
    }
  ],
  "else": []
}
```

**Step 3: Transform - Select the folder to use**
```json
{
  "id": "step2d",
  "type": "transform",
  "operation": "map",
  "config": {
    "mapping": {
      "folder_id": "{{existing_folder.files[0].id || created_folder.folder_id}}"
    }
  },
  "output_variable": "drive_folder"
}
```

**Problem:** This is verbose (3 steps instead of 1) and requires IR-level logic.

---

## Better Solution: IR-Level Deduplication Directive

### Extend IR Schema with Deduplication

**Add to IR operation config:**
```typescript
interface DeliveryConfig {
  plugin_key: string
  action: string
  config: any
  deduplication?: {
    enabled: boolean
    search_action: string  // Action to search for existing resource
    search_params: Record<string, any>  // Params for search
    match_field: string  // Field to check for match (e.g., "name")
    match_value: string  // Value to match (e.g., folder name)
    id_field: string  // Field containing the ID if found (e.g., "id")
  }
}
```

**Example IR:**
```json
{
  "operation_type": "deliver",
  "deliver": {
    "plugin_key": "google-drive",
    "action": "create_folder",
    "config": {
      "folder_name": "Email Attachments - Expenses"
    },
    "deduplication": {
      "enabled": true,
      "search_action": "search_files",
      "search_params": {
        "query": "name='{{folder_name}}' and mimeType='application/vnd.google-apps.folder'",
        "max_results": 1
      },
      "match_field": "name",
      "id_field": "id"
    }
  }
}
```

### Compiler Expansion

**Compiler sees deduplication directive → Expands to 3 steps:**

```typescript
// In ExecutionGraphCompiler.compileDeliverOperation()
if (deliver.deduplication?.enabled) {
  // Generate search step
  const searchStep = {
    type: 'action',
    plugin: deliver.plugin_key,
    action: deliver.deduplication.search_action,
    params: deliver.deduplication.search_params,
    output_variable: `${stepId}_search`
  }

  // Generate conditional create step
  const conditionalStep = {
    type: 'conditional',
    condition: {
      type: 'simple',
      variable: `${stepId}_search.files`,
      operator: 'is_empty',
      value: true
    },
    then: [{
      type: 'action',
      plugin: deliver.plugin_key,
      action: deliver.action,
      params: deliver.config,
      output_variable: `${stepId}_created`
    }]
  }

  // Generate transform to select result
  const selectStep = {
    type: 'transform',
    operation: 'map',
    config: {
      mapping: {
        [deliver.deduplication.id_field]:
          `{{${stepId}_search.files[0].${deliver.deduplication.id_field} || ${stepId}_created.${deliver.deduplication.id_field}}}`
      }
    },
    output_variable: stepId  // Original output variable
  }

  return [searchStep, conditionalStep, selectStep]
}
```

**Pros:**
- ✅ Plugin-agnostic (works for any plugin with search capability)
- ✅ Declarative (specify in IR, compiler handles expansion)
- ✅ Keeps workflow clean (1 IR operation → 3 DSL steps automatically)
- ✅ Reusable pattern

**Cons:**
- Requires IR schema extension
- Requires compiler logic update
- Backward compatibility considerations

---

## Alternative: Simpler "Get or Create" Action

### Add New Action Type to Plugins

**For Google Drive:** Add `get_or_create_folder` action

```json
{
  "get_or_create_folder": {
    "description": "Get existing folder by name or create if doesn't exist",
    "parameters": {
      "folder_name": {
        "type": "string",
        "description": "Name of the folder to find or create"
      },
      "parent_folder_id": {
        "type": "string",
        "description": "Parent folder ID (optional)"
      }
    },
    "output_schema": {
      "type": "object",
      "properties": {
        "folder_id": { "type": "string" },
        "name": { "type": "string" },
        "created": { "type": "boolean", "description": "True if newly created, false if existed" }
      }
    }
  }
}
```

**Handler Implementation:**
```typescript
async function getOrCreateFolder(params: { folder_name: string, parent_folder_id?: string }) {
  // 1. Search for existing folder
  const searchQuery = `name='${params.folder_name}' and mimeType='application/vnd.google-apps.folder'`
    + (params.parent_folder_id ? ` and '${params.parent_folder_id}' in parents` : '')

  const existing = await drive.files.list({
    q: searchQuery,
    pageSize: 1,
    fields: 'files(id, name)'
  })

  // 2. Return existing if found
  if (existing.data.files && existing.data.files.length > 0) {
    return {
      folder_id: existing.data.files[0].id,
      name: existing.data.files[0].name,
      created: false
    }
  }

  // 3. Create if not found
  const created = await drive.files.create({
    requestBody: {
      name: params.folder_name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: params.parent_folder_id ? [params.parent_folder_id] : undefined
    },
    fields: 'id, name'
  })

  return {
    folder_id: created.data.id,
    name: created.data.name,
    created: true
  }
}
```

**Workflow becomes:**
```json
{
  "id": "step2",
  "type": "action",
  "action": "get_or_create_folder",  // Changed from create_folder
  "params": {
    "folder_name": "Email Attachments - Expenses"
  },
  "plugin": "google-drive",
  "output_variable": "drive_folder"
}
```

**Pros:**
- ✅ Simple workflow (1 step, not 3)
- ✅ Plugin-specific optimization
- ✅ Clean API
- ✅ Easy to implement

**Cons:**
- ❌ Need to add `get_or_create_*` variant for every creation action
- ❌ Not automatically plugin-agnostic
- ❌ Requires updating every plugin

---

## Recommended Solution: Hybrid Approach

### Phase 1: Quick Fix (Add get_or_create actions)

**Immediate:** Add `get_or_create_folder` to Google Drive plugin
- Simple implementation
- Fixes current workflow
- Can be done today

**Apply to common patterns:**
- Drive: `get_or_create_folder`
- Sheets: `get_or_create_spreadsheet`
- Airtable: `get_or_create_base`
- Slack: `get_or_create_channel`

### Phase 2: Long-term (IR Deduplication Directive)

**Later:** Extend IR schema with deduplication directive
- More flexible
- Plugin-agnostic
- Handles complex cases

**Teaching LLM:**
Update formalization prompt to use `get_or_create_*` actions when available, or deduplication directive for custom cases.

---

## Implementation Plan

### Step 1: Add `get_or_create_folder` to Drive Plugin

**File:** `lib/plugins/definitions/google-drive-plugin-v2.json`

```json
{
  "get_or_create_folder": {
    "description": "Get existing folder by name or create if doesn't exist (prevents duplicates)",
    "usage_context": "When you need a folder but want to avoid creating duplicates. Use this instead of create_folder for idempotent operations.",
    "parameters": {
      "type": "object",
      "required": ["folder_name"],
      "properties": {
        "folder_name": {
          "type": "string",
          "description": "Name of the folder to find or create"
        },
        "parent_folder_id": {
          "type": "string",
          "description": "ID of the parent folder. If not provided, searches/creates in root"
        },
        "description": {
          "type": "string",
          "description": "Optional description (only used if creating new folder)"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "properties": {
        "folder_id": {
          "type": "string",
          "description": "ID of the folder (existing or newly created)"
        },
        "name": {
          "type": "string",
          "description": "Name of the folder"
        },
        "created": {
          "type": "boolean",
          "description": "True if folder was newly created, false if it already existed"
        },
        "web_view_link": {
          "type": "string",
          "description": "URL to view the folder in Drive"
        }
      }
    }
  }
}
```

### Step 2: Implement Handler

**File:** Create or update Drive handler

```typescript
async function handleGetOrCreateFolder(
  params: { folder_name: string; parent_folder_id?: string; description?: string },
  context: PluginContext
) {
  const { folder_name, parent_folder_id, description } = params
  const drive = await getDriveClient(context)

  // Build search query
  let query = `name='${folder_name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  if (parent_folder_id) {
    query += ` and '${parent_folder_id}' in parents`
  }

  // Search for existing folder
  const searchResponse = await drive.files.list({
    q: query,
    pageSize: 1,
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive'
  })

  // Return existing folder if found
  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    const folder = searchResponse.data.files[0]
    return {
      folder_id: folder.id!,
      name: folder.name!,
      web_view_link: folder.webViewLink!,
      created: false
    }
  }

  // Create new folder if not found
  const createResponse = await drive.files.create({
    requestBody: {
      name: folder_name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parent_folder_id ? [parent_folder_id] : undefined,
      description: description || undefined
    },
    fields: 'id, name, webViewLink'
  })

  return {
    folder_id: createResponse.data.id!,
    name: createResponse.data.name!,
    web_view_link: createResponse.data.webViewLink!,
    created: true
  }
}
```

### Step 3: Update Formalization Prompt

**File:** `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`

**Add section:**
```markdown
#### Deduplication Pattern: Get or Create

**When creating resources that might already exist:**

Use `get_or_create_*` actions instead of `create_*` to prevent duplicates:

**❌ DON'T:** Create without checking
```json
{
  "operation_type": "deliver",
  "deliver": {
    "plugin_key": "google-drive",
    "action": "create_folder",  // Creates duplicate every time!
    "config": {
      "folder_name": "My Folder"
    }
  }
}
```

**✅ DO:** Use get_or_create for idempotency
```json
{
  "operation_type": "deliver",
  "deliver": {
    "plugin_key": "google-drive",
    "action": "get_or_create_folder",  // Reuses existing or creates
    "config": {
      "folder_name": "My Folder"
    }
  }
}
```

**Available get_or_create actions:**
- `google-drive.get_or_create_folder` - Drive folders
- `google-sheets.get_or_create_spreadsheet` - Sheets
- `airtable.get_or_create_base` - Airtable bases
- `slack.get_or_create_channel` - Slack channels

**When to use:**
- Recurring workflows (avoid creating duplicates on each run)
- Organizational structures (folders, channels, bases)
- Templates and boilerplate resources
```

### Step 4: Test

- [ ] Add action to Drive plugin definition
- [ ] Implement handler
- [ ] Test manually with Drive API
- [ ] Regenerate workflow
- [ ] Verify it uses `get_or_create_folder` instead of `create_folder`
- [ ] Run workflow multiple times
- [ ] Verify only ONE folder exists

---

## Plugin-Agnostic Pattern Template

For adding `get_or_create` to any plugin:

**Template:**
```typescript
async function getOrCreate<T>(
  resourceType: string,
  searchParams: Record<string, any>,
  createParams: Record<string, any>,
  searchFn: () => Promise<T[]>,
  createFn: () => Promise<T>,
  idExtractor: (item: T) => string
): Promise<{ item: T; created: boolean }> {
  // 1. Search for existing
  const existing = await searchFn()
  if (existing.length > 0) {
    return { item: existing[0], created: false }
  }

  // 2. Create if not found
  const created = await createFn()
  return { item: created, created: true }
}
```

**Usage:**
```typescript
// Drive folder
const result = await getOrCreate(
  'folder',
  { name: 'My Folder' },
  { name: 'My Folder', mimeType: 'application/vnd.google-apps.folder' },
  () => drive.files.list({ q: "name='My Folder'" }),
  () => drive.files.create({ requestBody: { name: 'My Folder', mimeType: 'folder' } }),
  (file) => file.id
)

// Airtable base
const result = await getOrCreate(
  'base',
  { name: 'My Base' },
  { name: 'My Base' },
  () => airtable.bases.list().filter(b => b.name === 'My Base'),
  () => airtable.bases.create({ name: 'My Base' }),
  (base) => base.id
)
```

---

## Cost/Performance Considerations

**get_or_create vs create:**

**Search + Create (if needed):**
- First run: 1 search (miss) + 1 create = 2 API calls
- Subsequent runs: 1 search (hit) = 1 API call

**Always Create:**
- Every run: 1 create = 1 API call
- But results in N duplicate folders after N runs
- User has to manually delete duplicates

**Verdict:** Slight overhead on first run, but prevents duplicate cleanup work.

---

## Files to Create/Modify

### New Files:
None (if using existing handler structure)

### Modified Files:
1. `lib/plugins/definitions/google-drive-plugin-v2.json` - Add `get_or_create_folder` action
2. `lib/plugins/handlers/googleDriveHandler.ts` (or wherever Drive actions are implemented) - Add handler function
3. `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` - Add deduplication pattern guidance

---

## Next Steps

1. Implement `get_or_create_folder` for Google Drive
2. Update formalization prompt with pattern
3. Regenerate workflow to use new action
4. Test deduplication behavior
5. Add similar actions for Sheets, Airtable, Slack (as needed)
6. Consider IR-level deduplication directive for future enhancement

---

## Summary

**Problem:** Workflows create duplicate resources on every run
**Root Cause:** Using `create_*` actions without checking for existing resources
**Solution:** Add `get_or_create_*` actions that search first, create only if not found
**Benefit:** Idempotent workflows, no duplicates, cleaner organization
