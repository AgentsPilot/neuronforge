# Google Sheets Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Productivity
**Last Updated**: 2025-11-30

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
