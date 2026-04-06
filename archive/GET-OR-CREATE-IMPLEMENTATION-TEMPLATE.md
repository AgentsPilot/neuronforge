# Get-or-Create Implementation Template

## Overview
Add `get_or_create_{resource}` actions to plugins that create resources which might already exist.

---

## Priority Plugins

### ✅ DONE: Google Drive
- Action: `get_or_create_folder`
- Implementation: `/lib/server/google-drive-plugin-executor.ts`
- Status: Complete

### TODO: Google Sheets
- Action: `get_or_create_spreadsheet`
- Search by: title
- Implementation: `/lib/server/google-sheets-plugin-executor.ts`

### TODO: Slack
- Action: `get_or_create_channel`
- Search by: channel name
- Implementation: `/lib/server/slack-plugin-executor.ts`

### TODO: Airtable
- Action: `get_or_create_base`
- Search by: base name
- Implementation: `/lib/server/airtable-plugin-executor.ts`

---

## Template: Plugin Definition

Add after the `create_{resource}` action:

```json
{
  "get_or_create_{resource}": {
    "description": "Get existing {resource} by name or create if it doesn't exist (prevents duplicates)",
    "usage_context": "Use this instead of create_{resource} for idempotent operations. Perfect for recurring workflows.",
    "parameters": {
      "type": "object",
      "required": ["{resource}_name"],
      "properties": {
        "{resource}_name": {
          "type": "string",
          "description": "Name of the {resource} to find or create"
        },
        // ... other parameters from create_{resource}
      }
    },
    "output_schema": {
      "type": "object",
      "properties": {
        "{resource}_id": { "type": "string", "description": "ID of the {resource} (existing or newly created)" },
        "{resource}_name": { "type": "string", "description": "Name of the {resource}" },
        "created": { "type": "boolean", "description": "True if newly created, false if already existed" },
        // ... other fields from create_{resource} output
      }
    }
  }
}
```

---

## Template: Handler Implementation

Add method to the plugin executor:

```typescript
private async getOrCreate{Resource}(connection: any, parameters: any): Promise<any> {
  this.logger.debug('Get or create {resource}');

  const resourceName = parameters.{resource}_name;
  if (!resourceName) {
    throw new Error('{resource}_name is required');
  }

  // 1. Search for existing resource
  const searchQuery = `name='${resourceName.replace(/'/g, "\\'")}' and ...`;
  const searchResponse = await this.search{Resources}(connection, { query: searchQuery, max_results: 1 });

  // 2. If exists, return it
  if (searchResponse.{resources} && searchResponse.{resources}.length > 0) {
    const existing = searchResponse.{resources}[0];
    this.logger.debug({ id: existing.id }, 'Found existing {resource}');

    return {
      {resource}_id: existing.id,
      {resource}_name: existing.name,
      created: false,
      ...existing
    };
  }

  // 3. If not exists, create it
  this.logger.debug('Creating new {resource}');
  const created = await this.create{Resource}(connection, parameters);

  return {
    ...created,
    created: true
  };
}
```

---

## Template: Switch Case

Add to `executeSpecificAction` method:

```typescript
case 'get_or_create_{resource}':
  result = await this.getOrCreate{Resource}(connection, parameters);
  break;
```

---

## Example: Google Sheets

### Plugin Definition Addition

```json
{
  "get_or_create_spreadsheet": {
    "description": "Get existing spreadsheet by title or create if it doesn't exist",
    "usage_context": "Use for idempotent spreadsheet creation in recurring workflows",
    "parameters": {
      "type": "object",
      "required": ["title"],
      "properties": {
        "title": {
          "type": "string",
          "description": "Title of the spreadsheet to find or create"
        },
        "sheet_names": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Sheet names (only used if creating new spreadsheet)"
        }
      }
    },
    "output_schema": {
      "type": "object",
      "properties": {
        "spreadsheet_id": { "type": "string" },
        "spreadsheet_url": { "type": "string" },
        "title": { "type": "string" },
        "created": { "type": "boolean", "description": "True if newly created" },
        "sheet_count": { "type": "integer" }
      }
    }
  }
}
```

### Handler Implementation

```typescript
private async getOrCreateSpreadsheet(connection: any, parameters: any): Promise<any> {
  const title = parameters.title;
  if (!title) {
    throw new Error('title is required');
  }

  // Search for existing spreadsheet by title
  // Note: Google Sheets doesn't have native title search, need to list and filter
  const listUrl = `${this.googleApisUrl}/drive/v3/files`;
  const query = `name='${title.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;

  const searchResponse = await fetch(`${listUrl}?q=${encodeURIComponent(query)}&pageSize=1`, {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Accept': 'application/json',
    }
  });

  if (!searchResponse.ok) {
    throw new Error(`Search failed: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();

  if (searchData.files && searchData.files.length > 0) {
    const existing = searchData.files[0];

    return {
      spreadsheet_id: existing.id,
      spreadsheet_url: `https://docs.google.com/spreadsheets/d/${existing.id}`,
      title: existing.name,
      created: false
    };
  }

  // Create new spreadsheet
  const created = await this.createSpreadsheet(connection, parameters);

  return {
    ...created,
    created: true
  };
}
```

---

## Testing Checklist

After implementation:

- [ ] Action appears in plugin definition JSON
- [ ] Handler method exists in executor
- [ ] Switch case added to executeSpecificAction
- [ ] Search logic returns existing resource correctly
- [ ] Create logic only fires when resource doesn't exist
- [ ] `created` boolean flag is correct
- [ ] Running twice with same name returns same ID
- [ ] No duplicates created

---

## Summary

**Pattern:** Search first, create only if not found
**Key Field:** `created: boolean` - tells caller if resource was new or existing
**Benefit:** Idempotent operations, no duplicates
**Application:** Any plugin that creates named resources (folders, spreadsheets, channels, bases, etc.)
