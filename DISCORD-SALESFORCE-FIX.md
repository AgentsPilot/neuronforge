# Discord & Salesforce Plugin Dialog Fix ✅

## Issue
Discord and Salesforce plugins were not appearing in the connect plugin dialog.

## Root Cause
**Discord plugin was using the OLD JSON format** instead of the new format that the PluginManagerV2 expects.

### Format Difference:

**OLD Format (Discord before fix):**
```json
{
  "key": "discord",
  "name": "Discord",
  "auth": { ... },
  "actions": [ ... ]
}
```

**NEW Format (required):**
```json
{
  "plugin": {
    "name": "discord",
    "auth_config": { ... }
  },
  "actions": {
    "action_name": { ... }
  }
}
```

## Fix Applied

### 1. Updated Discord Plugin Definition
- Converted [discord-plugin-v2.json](lib/plugins/definitions/discord-plugin-v2.json) to new format
- Added `"plugin": {...}` wrapper
- Changed `"auth"` → `"auth_config"`
- Changed `"actions": [...]` → `"actions": {...}` (array to object)
- Added all required fields: `usage_context`, `idempotent`, `domain`, `capability`, etc.
- Added `output_guidance` with sample outputs and common errors
- Added `x-guaranteed` fields in output schemas

### 2. Salesforce Already Correct
- Salesforce was already using the correct format
- No changes needed

### 3. Made Plugin Dialog Wider
**Before:** `w-80` (320px) with 3 columns
**After:** `w-[650px]` (650px) with 4 columns
**Height:** Increased from `32rem` to `38rem`

**Changes in [Footer.tsx](components/v2/Footer.tsx:984):**
```tsx
// Before
className="... w-80 max-h-[32rem] ..."
<div className="grid grid-cols-3 gap-2">

// After
className="... w-[650px] max-h-[38rem] ..."
<div className="grid grid-cols-4 gap-2">
```

This shows more plugins at once (4 columns instead of 3) and requires less scrolling.

## Result

✅ **Discord** now appears in the plugin connection dialog
✅ **Salesforce** now appears in the plugin connection dialog
✅ **Dialog is wider** with 4 columns instead of 3
✅ **Less scrolling** needed due to increased height

## Testing

1. Restart your dev server if it's running
2. Click the plugins button (⚡) in the footer
3. You should now see both Discord and Salesforce in the list
4. The dialog should be wider with 4 columns showing more plugins

## Format Consistency

All plugins now use the consistent NEW format:
- ✅ Google Drive
- ✅ Google Sheets
- ✅ Google Docs
- ✅ Google Calendar
- ✅ Gmail
- ✅ Slack
- ✅ OneDrive
- ✅ Outlook
- ✅ Notion
- ✅ **Discord** (fixed)
- ✅ **Salesforce** (already correct)
