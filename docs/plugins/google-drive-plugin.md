# Google Drive Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Productivity
**Last Updated**: 2025-11-30

---

## Overview

Access, search, and read files and folders in Google Drive. Use for accessing Google Drive files, searching documents, reading file contents, and browsing folder structures.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.google.com/identity/protocols/oauth2 | Google-style OAuth 2.0 with refresh token support |
| Authorization Endpoint | https://accounts.google.com/o/oauth2/v2/auth | Google authorization URL |
| Token Endpoint | https://oauth2.googleapis.com/token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.google.com/drive/api/guides/api-specific-auth | Required scopes for Drive access |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Drive API Overview | https://developers.google.com/drive/api/v3/reference | REST API for Google Drive operations |
| Files Resource | https://developers.google.com/drive/api/v3/reference/files | CRUD operations for files and folders |
| Search Queries | https://developers.google.com/drive/api/guides/search-files | Query syntax for file searching |
| Export Formats | https://developers.google.com/drive/api/guides/manage-downloads | Export formats for Google Workspace files |

---

## High-Level Decisions

- **OAuth Flow**: Google-style OAuth 2.0 with openid, email, profile scopes plus drive-specific scopes
- **Required Scopes**: openid, email, profile, drive.readonly, drive.metadata.readonly, drive.file
- **Max Files Per Request**: 100 files per list/search operation
- **Max File Read Size**: 10MB for content extraction
- **Export Formats**: text/plain, text/html, application/pdf for Google Workspace files

---

## Actions

### 1. list_files
**Description**: List files and folders in Google Drive with optional filtering

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/drive/v3/files` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| folder_id | string | No | ID of folder to list from (lists recent if not provided) |
| max_results | number | No | Maximum files to return (1-100, default: 20) |
| order_by | string | No | Order by: modifiedTime, name, createdTime, folder, starred |
| file_types | array | No | Filter by: document, spreadsheet, presentation, pdf, image, video, folder, all |
| include_trashed | boolean | No | Include files in trash (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| files | array | List of files and folders |
| files[].id | string | Unique file ID |
| files[].name | string | File or folder name |
| files[].mimeType | string | MIME type of the file |
| files[].size | string | File size in bytes |
| files[].createdTime | string | Creation timestamp (ISO 8601) |
| files[].modifiedTime | string | Last modification timestamp |
| files[].webViewLink | string | URL to view the file |
| files[].shared | boolean | Whether file is shared |
| files[].starred | boolean | Whether file is starred |
| file_count | integer | Number of files returned |
| next_page_token | string | Token for fetching next page |
| has_more | boolean | Whether more files are available |

---

### 2. search_files
**Description**: Search for files and folders using Google Drive's query syntax

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/drive/v3/files` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query (supports Drive operators like 'name contains', 'mimeType =', 'fullText contains') |
| max_results | number | No | Maximum files to return (1-100, default: 20) |
| search_scope | string | No | Scope: all, owned_by_me, shared_with_me, starred |
| file_types | array | No | Filter by: document, spreadsheet, presentation, pdf, image, video, folder |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| files | array | List of matching files and folders |
| file_count | integer | Number of files found |
| search_query | string | The search query that was executed |
| next_page_token | string | Token for fetching next page |
| has_more | boolean | Whether more results are available |
| searched_at | string | Timestamp when search was performed |

---

### 3. get_file_metadata
**Description**: Get detailed information about a specific file or folder

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/drive/v3/files/{file_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | The ID of the file or folder |
| include_permissions | boolean | No | Include sharing permissions (default: false) |
| include_export_links | boolean | No | Include export links for Workspace files (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | Unique file identifier |
| file_name | string | Name of the file or folder |
| file_type | string | Friendly file type (document, spreadsheet, folder, etc.) |
| mime_type | string | MIME type of the file |
| size_bytes | integer | File size in bytes |
| created_at | string | Creation timestamp |
| modified_at | string | Last modification timestamp |
| owner | string | File owner name or email |
| web_view_link | string | URL to view the file in browser |
| is_folder | boolean | Whether this is a folder |

---

### 4. read_file_content
**Description**: Read and extract text content from a file

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/drive/v3/files/{file_id}?alt=media` or `/drive/v3/files/{file_id}/export` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | The ID of the file to read |
| export_format | string | No | Export format: text/plain, text/html, application/pdf (default: text/plain) |
| max_size_mb | number | No | Maximum file size to read in MB (1-10, default: 5) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the file that was read |
| file_name | string | Name of the file |
| file_size | string | Human-readable file size |
| mime_type | string | MIME type of the file |
| content | string | Text content extracted from the file |
| content_length | integer | Length of extracted content in characters |
| export_format | string | Format actually produced (`text/plain` for Google-Docs export and parsed PDFs; `original` for plain-text files) |
| read_at | string | Timestamp when file was read |

**Behavior by file type** (the `content` field — binary files are never UTF-8-decoded, which would corrupt them):
- **Google Docs/Sheets/Slides** → exported as text (`export_format` controls the target; default `text/plain`).
- **PDF** → the PDF's **text layer** is extracted via `pdf-parse`; `export_format` is reported as `text/plain`. Scanned / image-only PDFs have **no text layer** and return little/no text — use [`download_file`](#5-download_file) → `document-extractor` (OCR) for those.
- **Plain-text files** (`.txt`, `.csv`, `.html`, `.json`) → returned as-is (`export_format`: `original`).
- **Other binaries** (docx/xlsx/images) → not text-extractable here; use [`download_file`](#5-download_file) + `document-extractor`.

See **WP-57** in `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`.

---

### 5. download_file
**Description**: Download a file's raw bytes as base64 (for binary files — PDF, image, DOCX) so file-based extractors (e.g. `document-extractor`) can OCR/parse them. Unlike `read_file_content` (which returns extracted *text*), this returns the original *bytes*.

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/drive/v3/files/{file_id}?alt=media` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | The ID of the file to download (from list_files / search_files) |
| max_size_mb | number | No | Maximum file size to download in MB (1-50, default: 25) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the downloaded file |
| filename | string | Name of the file |
| mimeType | string | MIME type (e.g. application/pdf, image/png) |
| content | string | Base64-encoded raw file bytes — pass to `document-extractor.file_content` (which reads a file object's `content` field) |
| file_size | string | Human-readable file size |

> **Note**: Native Google Workspace files (Docs/Sheets/Slides) have no downloadable bytes — use `read_file_content` (export) for those. The download uses `arrayBuffer()` → base64 (never `.text()`, which corrupts binary). The output carries `x-semantic-type: file_attachment` so the V6 pipeline routes it to `document-extractor` rather than AI text extraction. See **WP-57** in `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md`.

---

### 6. get_folder_contents
**Description**: Get all files and subfolders within a specific folder

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/drive/v3/files` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| folder_id | string | Yes | The ID of the folder (use 'root' for root folder) |
| max_results | number | No | Maximum items to return (1-100, default: 50) |
| recursive | boolean | No | Include files from subfolders recursively (default: false) |
| order_by | string | No | Order by: name, modifiedTime, createdTime, folder |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| folder_id | string | ID of the folder that was explored |
| folder_name | string | Name of the folder |
| items | array | All items (files and folders) in the folder |
| item_count | integer | Total number of items |
| folder_count | integer | Number of subfolders |
| file_count | integer | Number of files |
| folders | array | List of subfolders only |
| files | array | List of files only |
| has_more | boolean | Whether more items are available |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/google-drive-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/google-drive-plugin-executor.ts` | Executor class implementing all Google Drive actions |

---

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

To obtain credentials:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/google-drive`
4. Enable the Google Drive API in your project
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.2.0 | 2026-06-13 | `read_file_content` now extracts the real text layer from PDFs (`pdf-parse`) instead of UTF-8-decoding the binary (which corrupted it); `export_format` reports the actual format (`text/plain` for parsed PDFs). Scanned/image PDFs still need `download_file` + document-extractor. See WP-57. |
| 1.1.0 | 2026-06-10 | Added `download_file` (base64 binary download for document extraction; `x-semantic-type: file_attachment`). Fixed `read_file_content` `output_schema.required` (referenced non-existent fields `id`/`name`/`mimeType`). See WP-57. |
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: list_files, search_files, get_file_metadata, read_file_content, get_folder_contents |
