# Google Sheets Plugin Documentation

**Plugin Version**: 1.1.0
**Category**: Productivity
**Last Updated**: 2026-07-26

---

## Overview

Read, write, and manage data in Google Sheets spreadsheets. Use for reading data from spreadsheets, writing structured output, appending rows, creating new spreadsheets, and managing spreadsheet data as structured input/output for agents.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.google.com/identity/protocols/oauth2 | Google-style OAuth 2.0 with refresh token support |
| Authorization Endpoint | https://accounts.google.com/o/oauth2/v2/auth | Google authorization URL |
| Token Endpoint | https://oauth2.googleapis.com/token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.google.com/sheets/api/guides/authorizing | Required scopes for Sheets access |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Sheets API Overview | https://developers.google.com/sheets/api/reference/rest | REST API for Google Sheets operations |
| Spreadsheets Resource | https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets | CRUD operations for spreadsheets |
| Values Resource | https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values | Read and write cell values |
| A1 Notation | https://developers.google.com/sheets/api/guides/concepts#a1_notation | Range notation format |

---

## High-Level Decisions

- **OAuth Flow**: Google-style OAuth 2.0 with openid, email, profile scopes plus sheets-specific scopes
- **Required Scopes**: openid, email, profile, spreadsheets, drive
- **Max Cells Per Operation**: 10,000 cells per read/write operation
- **Max Rows Per Append**: 1,000 rows per append operation
- **Max Sheets Per Create**: 20 sheets when creating a new spreadsheet
- **Drive Scope**: Required for spreadsheet creation

---

## Actions

### 1. read_range
**Description**: Read data from a specific range of cells in a spreadsheet

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}/values/{range}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet (from URL or file ID) |
| range | string | Yes | A1 notation range (e.g., 'Sheet1!A1:D10', 'Data!A:C') |
| include_formula_values | boolean | No | Return formula values instead of calculated results (default: false) |
| major_dimension | string | No | Read as ROWS or COLUMNS (default: ROWS) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| range | string | The actual range that was read |
| values | array | 2D array of cell values (rows of cells) |
| row_count | integer | Number of rows returned |
| column_count | integer | Number of columns returned |
| major_dimension | string | How data is organized (ROWS or COLUMNS) |
| retrieved_at | string | Timestamp when data was retrieved |

---

### 2. write_range
**Description**: Write or update data in a specific range of cells

| Property | Value |
|----------|-------|
| HTTP Method | PUT |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}/values/{range}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet |
| range | string | Yes | A1 notation range (e.g., 'Sheet1!A1:D10') |
| values | array | Yes | 2D array of values (array of rows, each row is array of cell values) |
| input_option | string | No | RAW (as-is) or USER_ENTERED (parse formulas, dates). Default: USER_ENTERED |
| overwrite_existing | boolean | No | Overwrite existing data (default: true) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| updated_range | string | The range that was updated |
| updated_rows | integer | Number of rows updated |
| updated_columns | integer | Number of columns updated |
| updated_cells | integer | Total number of cells updated |
| values | array | The values that were written |
| updated_at | string | Timestamp when data was written |

---

### 3. append_rows
**Description**: Append new rows of data to the end of a sheet

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}/values/{range}:append` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet |
| range | string | Yes | Sheet name or range where data should be appended (e.g., 'Sheet1' or 'Sheet1!A:D') |
| values | array | Yes | Array of rows to append |
| input_option | string | No | RAW or USER_ENTERED (default: USER_ENTERED) |
| insert_data_option | string | No | OVERWRITE or INSERT_ROWS (default: INSERT_ROWS) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| updated_range | string | The range where data was appended |
| appended_rows | integer | Number of rows appended |
| appended_columns | integer | Number of columns in appended data |
| appended_cells | integer | Total number of cells appended |
| table_range | string | Full range of the table including appended data |
| sheet_name | string | Name of the sheet where data was appended |
| values | array | The values that were appended |
| appended_at | string | Timestamp when data was appended |

---

### 4. create_spreadsheet
**Description**: Create a new Google Sheets spreadsheet

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v4/spreadsheets` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | Yes | The title/name of the new spreadsheet (max 255 chars) |
| sheet_names | array | No | Names of sheets to create (default: single 'Sheet1') |
| initial_data | object | No | Optional initial data for first sheet |
| initial_data.range | string | No | Starting range for initial data (e.g., 'A1') |
| initial_data.values | array | No | 2D array of initial values |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | Unique identifier for the new spreadsheet |
| spreadsheet_url | string | URL to open the spreadsheet |
| title | string | Title of the created spreadsheet |
| sheet_count | integer | Number of sheets in the spreadsheet |
| sheets | array | List of sheets with sheet_id, title, index |
| created_at | string | Timestamp when spreadsheet was created |

---

### 5. get_spreadsheet_info
**Description**: Get metadata and information about a spreadsheet

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet |
| include_sheet_data | boolean | No | Include detailed info about each sheet (default: false) |
| include_data_ranges | boolean | No | Include info about data ranges in each sheet (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | Unique spreadsheet identifier |
| spreadsheet_url | string | URL to open the spreadsheet |
| title | string | Spreadsheet title |
| locale | string | Locale setting of the spreadsheet |
| time_zone | string | Time zone of the spreadsheet |
| sheet_count | integer | Number of sheets |
| sheets | array | List of sheets with details |
| sheets[].sheet_id | integer | Unique sheet ID |
| sheets[].title | string | Sheet name |
| sheets[].index | integer | Sheet position (0-based) |
| sheets[].sheet_type | string | Type of sheet (GRID, CHART, etc.) |
| sheets[].row_count | integer | Number of rows (when include_sheet_data is true) |
| sheets[].column_count | integer | Number of columns (when include_sheet_data is true) |

---

### 6. get_or_create_spreadsheet
**Description**: Get an existing spreadsheet by title or create it if it doesn't exist (idempotent — prevents duplicates)

| Property | Value |
|----------|-------|
| HTTP Method | GET (Drive search) + POST (create if missing) |
| Endpoint | `drive/v3/files` (search) → `/v4/spreadsheets` (create) |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | Yes | Title of the spreadsheet to find or create (max 255 chars) |
| sheet_names | array | No | Names of sheets to create (only used when creating new) |
| initial_data | object | No | Optional initial data (only used when creating new) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | Unique identifier (existing or newly created) |
| spreadsheet_url | string | URL to open the spreadsheet |
| title | string | Title of the spreadsheet |
| created | boolean | True if newly created, false if it already existed |
| sheet_count | integer | Number of sheets |
| sheets | array | List of sheets with sheet_id, title, index |
| created_at | string | Timestamp when created or found |

---

### 7. get_or_create_sheet_tab
**Description**: Get an existing sheet tab or create it if it doesn't exist within a spreadsheet (idempotent)

| Property | Value |
|----------|-------|
| HTTP Method | GET (list tabs) + POST (batchUpdate addSheet if missing) |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}` → `/v4/spreadsheets/{spreadsheet_id}:batchUpdate` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet containing the tab |
| tab_name | string | Yes | Name of the sheet tab to find or create |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | ID of the spreadsheet |
| sheet_id | integer | Unique numeric ID of the sheet tab |
| sheet_name | string | Name of the sheet tab |
| tab_name | string | Name of the sheet tab (alias for sheet_name) |
| existed | boolean | True if the tab already existed, false if newly created |

---

### 8. format_cells
**Description**: Apply formatting to a range of cells — bold text, a background color, and/or a frozen header row

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}:batchUpdate` (`repeatCell` + `updateSheetProperties`) |
| Idempotent | Yes |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet to format |
| range | string | Yes | A1 range to format (e.g., 'Sheet1!A1:D1'). No sheet-name prefix → the first tab is used. |
| bold | boolean | No | Set the text in the range to bold (true) or non-bold (false) |
| background_color | string | No | Background color as a hex string (e.g., '#FDE68A') |
| freeze_rows | integer | No | Freeze the first N rows of the sheet (header freeze). 0 unfreezes. Sheet-level — independent of the `range` row bounds. |

If no formatting field is provided the action is a no-op success.

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | ID of the formatted spreadsheet |
| sheet_id | integer | Numeric ID of the formatted tab |
| sheet_name | string | Name of the formatted tab |
| range | string | The A1 range that was formatted |
| format_summary | object | `{ bold_applied, background_applied, frozen_rows }` — what was applied |
| formatted_at | string | Timestamp when formatting was applied |

**Notes**: Only the supplied format subfields are written (the `repeatCell` `fields` mask is scoped to exactly `userEnteredFormat.textFormat.bold` and/or `userEnteredFormat.backgroundColor`), so unrelated existing cell formatting is preserved. Phase 1 scope is bold + background + frozen rows; font/size/alignment/conditional formatting are deferred to a later phase and will extend this same action.

---

### 9. clear_range
**Description**: Clear the values in an A1 range (formatting and notes are preserved). Destructive — declares a confirmation rule.

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}/values/{range}:clear` |
| Idempotent | Yes (clearing an empty range is a safe no-op) |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet to clear values in |
| range | string | Yes | A1 range to clear (e.g., 'Sheet1!A2:D100'). Only values are cleared; formatting is preserved. |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | ID of the spreadsheet |
| cleared_range | string | The A1 range whose values were cleared |
| cleared_at | string | Timestamp when the range was cleared |

**Notes**: Clears exactly the requested A1 range — never the whole sheet.

---

### 10. delete_rows
**Description**: Delete a range of rows from a sheet tab (shifts the rows below up). Destructive + structural — declares a confirmation rule. **NOT idempotent.**

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v4/spreadsheets/{spreadsheet_id}:batchUpdate` (`deleteDimension`) |
| Idempotent | No — `deleteDimension` shifts subsequent row indices, so re-running the same range deletes a different set of rows |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| spreadsheet_id | string | Yes | The ID of the spreadsheet to delete rows from |
| sheet_name | string | No | Sheet tab whose rows are deleted. Defaults to the first tab if omitted. |
| start_row | integer | Yes | First row to delete — **1-based, inclusive** (matches the row number shown in the Sheets UI) |
| end_row | integer | Yes | Last row to delete — **1-based, inclusive**. Must be >= start_row. |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| spreadsheet_id | string | ID of the spreadsheet |
| sheet_id | integer | Numeric ID of the tab rows were deleted from |
| sheet_name | string | Name of the tab rows were deleted from |
| deleted_row_count | integer | Number of rows deleted (`end_row - start_row + 1`) |
| start_row | integer | First row deleted (1-based, inclusive) |
| end_row | integer | Last row deleted (1-based, inclusive) |
| deleted_at | string | Timestamp when the rows were deleted |

**Notes**: The 1-based inclusive inputs are converted internally to Google's 0-based half-open range (rows 2–5 → `startIndex:1, endIndex:5`). A bounds guard (`start_row >= 1`, `end_row >= start_row`) runs before any API call, and the emitted `deleteDimension` range always carries a finite `endIndex` so a malformed range can never widen into a whole-sheet delete.

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/google-sheets-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/google-sheets-plugin-executor.ts` | Executor class implementing all Google Sheets actions |

---

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

To obtain credentials:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/google-sheets`
4. Enable the Google Sheets API and Google Drive API in your project
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: read_range, write_range, append_rows, create_spreadsheet, get_spreadsheet_info |
| 1.1.0 | 2026-07-26 | Phase 1 formatting/structural actions added: format_cells (bold + background + frozen header), clear_range (values-only clear), delete_rows (1-based inclusive, bounded delete). Back-filled docs for the two previously-undocumented existing actions: get_or_create_spreadsheet and get_or_create_sheet_tab. Doc now covers all 10 actions. |
