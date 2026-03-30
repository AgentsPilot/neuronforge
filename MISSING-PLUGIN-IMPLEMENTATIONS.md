# Missing Plugin Operation Implementations

## Analysis Date
2026-03-24

## Summary
Found **5 missing operation implementations** across **3 plugins** in the AgentPilot codebase.

---

## 1. Google Sheets Plugin

**File:** `lib/plugins/definitions/google-sheets-plugin-v2.json`
**Executor:** `lib/server/google-sheets-plugin-executor.ts`

### Missing Implementation: `get_or_create_sheet_tab`

**Description:** Get existing sheet tab or create if it doesn't exist within a spreadsheet (prevents duplicates)

**Usage Context:** Use when you need to ensure a specific sheet/tab exists within an existing spreadsheet. Perfect for workflows that append data to a specific tab across multiple runs.

**Parameters:**
- `spreadsheet_id` (required): The ID of the spreadsheet containing the tab
- `tab_name` (required): Name of the sheet tab to find or create

**Expected Output:**
```json
{
  "spreadsheet_id": "string",
  "sheet_id": "integer",
  "sheet_name": "string",
  "tab_name": "string",
  "existed": "boolean"
}
```

**Impact:** This is an idempotent operation that's crucial for recurring workflows to avoid duplicate tabs.

---

## 2. Gmail Plugin (google-mail)

**File:** `lib/plugins/definitions/google-mail-plugin-v2.json`
**Executor:** `lib/server/gmail-plugin-executor.ts`

### Missing Implementation: `modify_message`

**Description:** Modify Gmail message properties (mark important, add/remove labels, mark read/unread)

**Usage Context:** Use when you need to update email flags, labels, or read status. Requires message ID from search_emails result.

**Parameters:**
- `message_id` (required): Gmail message ID to modify
- `add_labels` (optional): Labels to add to the message (creates label if it doesn't exist)
- `remove_labels` (optional): Labels to remove from the message
- `mark_important` (optional): Set message importance flag (true=important, false=not important)
- `mark_read` (optional): Set message read status (true=mark as read, false=mark as unread)

**Expected Output:**
```json
{
  "message_id": "string",
  "labels": ["string"],
  "important": "boolean",
  "read": "boolean",
  "modified_at": "string (ISO 8601)"
}
```

**Impact:** Critical for email management workflows that need to organize, flag, or mark emails programmatically.

---

## 3. HubSpot Plugin

**File:** `lib/plugins/definitions/hubspot-plugin-v2.json`
**Executor:** `lib/server/hubspot-plugin-executor.ts`

### Missing Implementations (4 actions):

#### 3.1 `create_contact`

**Description:** Create a new contact in HubSpot CRM

**Parameters:**
- Contact properties (email, firstname, lastname, etc.)

**Expected Output:**
- Contact ID, properties, creation timestamp

#### 3.2 `create_contact_note`

**Description:** Add a note/comment to a contact record

**Parameters:**
- `contact_id` (required): HubSpot contact ID
- `note_body` (required): Note content

**Expected Output:**
- Note ID, contact ID, timestamp

#### 3.3 `create_deal`

**Description:** Create a new deal/opportunity in HubSpot

**Parameters:**
- Deal properties (dealname, amount, dealstage, etc.)

**Expected Output:**
- Deal ID, properties, creation timestamp

#### 3.4 `create_task`

**Description:** Create a task in HubSpot CRM

**Parameters:**
- Task details (subject, body, due_date, associated contacts/deals)

**Expected Output:**
- Task ID, properties, creation timestamp

**Impact:** These are fundamental CRM write operations. Without them, users can only READ from HubSpot but cannot CREATE new records, significantly limiting automation capabilities.

---

## Recommendations

### Priority 1: HubSpot Create Operations
The 4 missing HubSpot operations represent core CRM functionality. Users expect to be able to:
- Create contacts from form submissions
- Add notes after calls or meetings
- Create deals from qualified leads
- Create tasks for follow-ups

### Priority 2: Gmail modify_message
Email management workflows often need to:
- Auto-label emails based on content
- Mark emails as read after processing
- Flag important emails for follow-up

### Priority 3: Google Sheets get_or_create_sheet_tab
While less critical, this provides idempotent tab management which is useful for recurring workflows that organize data by tabs.

---

## Technical Notes

### Implementation Pattern
All executors follow this pattern in `executeSpecificAction()`:

```typescript
switch (actionName) {
  case 'existing_action':
    result = await this.existingAction(connection, parameters);
    break;
  case 'missing_action': // ADD THIS
    result = await this.missingAction(connection, parameters);
    break;
  default:
    return {
      success: false,
      error: 'Unknown action',
      message: `Action ${actionName} not supported`
    };
}
```

### API Endpoints
- **Gmail modify_message**: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/modify`
- **Google Sheets create sheet**: `POST https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate`
- **HubSpot create contact**: `POST https://api.hubapi.com/crm/v3/objects/contacts`
- **HubSpot create note**: `POST https://api.hubapi.com/crm/v3/objects/notes`
- **HubSpot create deal**: `POST https://api.hubapi.com/crm/v3/objects/deals`
- **HubSpot create task**: `POST https://api.hubapi.com/crm/v3/objects/tasks`

---

## Files Analyzed

### Plugin Definitions (19 total)
✅ All 19 plugin definition files were analyzed

### Plugin Executors (21 total)
✅ All corresponding executor files were checked

### Plugins with Complete Implementations
The following plugins have ALL operations implemented:
- ✅ Google Drive (9/9 actions)
- ✅ Google Docs (5/5 actions)
- ✅ Google Calendar (5/5 actions)
- ✅ Slack (11/11 actions)
- ✅ Airtable (8/8 actions)
- ✅ Notion (8/8 actions)
- ✅ Document Extractor (1/1 action)
- ✅ OneDrive
- ✅ Outlook
- ✅ Discord
- ✅ Salesforce
- ✅ Meta Ads
- ✅ Dropbox
- ✅ WhatsApp
- ✅ LinkedIn
- ✅ ChatGPT Research

---

## Verification Command

To verify this analysis yourself:

```bash
for json_file in lib/plugins/definitions/*.json; do
    plugin=$(basename "$json_file" | sed 's/-plugin-v2.json//')
    executor=$([ "$plugin" = "google-mail" ] && echo "gmail" || echo "$plugin")
    exec_file="lib/server/${executor}-plugin-executor.ts"
    
    defined=$(cat "$json_file" | jq -r '.actions | keys[]' 2>/dev/null | sort)
    implemented=$(grep -oE "case '[a-z_]+'" "$exec_file" 2>/dev/null | sed "s/case '//g" | sed "s/'//g" | sort | uniq)
    
    missing=""
    for action in $defined; do
        if ! echo "$implemented" | grep -q "^${action}$"; then
            missing="$missing $action"
        fi
    done
    
    if [[ -n "$missing" ]]; then
        echo "❌ $plugin: $missing"
    fi
done
```

