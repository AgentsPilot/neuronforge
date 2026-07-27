# Google Drive Plugin Documentation

**Plugin Version**: 1.3.0
**Category**: Productivity
**Last Updated**: 2026-07-27

> **Version note (doc/definition drift):** The plugin **definition** (`lib/plugins/definitions/google-drive-plugin-v2.json`) still declares `plugin.version: "1.0.0"` even though it now ships **15 actions** and prior doc slices already advanced to 1.1.0 / 1.2.0. This doc uses **1.3.0** to stay in sequence with its own Version History and at parity with the sibling Google-suite plugins (Sheets 1.1.0, Docs 1.1.0, Gmail 1.2.0). The definition's `plugin.version` should be reconciled to `1.3.0` in a follow-up **code** change — it was intentionally **not** modified in this documentation-only pass.

---

## Overview

Access, search, read, upload, and **manage** files and folders in Google Drive. Beyond read/search/upload, the plugin now supports full file management: **move**, **rename**, **copy**, **trash** (soft delete), and **unshare** (revoke a sharing permission). Use it for browsing Drive, reading and downloading file contents, uploading and organising files into folders, sharing files, and reorganising or cleaning up a Drive.

The plugin exposes **15 actions**: 6 read/browse (`list_files`, `search_files`, `get_file_metadata`, `read_file_content`, `download_file`, `get_folder_contents`), 4 create/upload/share (`upload_file`, `create_folder`, `get_or_create_folder`, `share_file`), and 5 file-management (`move_file`, `rename_file`, `copy_file`, `delete_file`, `revoke_access`).

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
- **Required Scopes** (from `google-drive-plugin-v2.json`): `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.file`. The full `drive` scope (read/write) is what allows the create/upload/share and the file-management actions (move/rename/copy/trash/unshare) — all of which fit the **already-granted** scope, so the Phase 1 file-management slice added **no new scope and requires no re-consent**.
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

### 7. upload_file
**Description**: Upload a new file to Google Drive

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/upload/drive/v3/files?uploadType=multipart` |
| Idempotent | No — each run creates a new file. For duplicate-safe folder creation use `get_or_create_folder`. |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_content | string | Yes | File content — base64 for binary files, or plain text |
| file_name | string | Yes | Name for the uploaded file |
| folder_id | string | No | ID of the folder to upload into (uploads to root if omitted) |
| mime_type | string | No | MIME type of the file (e.g. 'application/pdf', 'image/jpeg') |
| description | string | No | Optional description for the file |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the uploaded file |
| file_name | string | Name of the uploaded file |
| file_size | string | Human-readable size of the uploaded file |
| mime_type | string | MIME type of the file |
| web_view_link | string | URL to view the file |
| web_content_link | string | URL to download the file |
| folder_id | string | ID of the folder containing the file |
| uploaded_at | string | Timestamp when the file was uploaded (ISO 8601) |

---

### 8. create_folder
**Description**: Create a new folder in Google Drive

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/drive/v3/files` (body `mimeType: application/vnd.google-apps.folder`) |
| Idempotent | No — creates a new folder every run. Use `get_or_create_folder` for idempotent creation. |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| folder_name | string | Yes | Name for the new folder |
| parent_folder_id | string | No | ID of the parent folder (creates in root if omitted) |
| description | string | No | Optional description for the folder |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| folder_id | string | ID of the created folder |
| folder_name | string | Name of the created folder |
| web_view_link | string | URL to view the folder |
| parent_folder_id | string | ID of the parent folder |
| created_at | string | Timestamp when the folder was created (ISO 8601) |

---

### 9. get_or_create_folder
**Description**: Get an existing folder by name or create it if it doesn't exist (idempotent — prevents duplicate folders)

| Property | Value |
|----------|-------|
| HTTP Method | GET (Drive search) + POST (create if missing) |
| Endpoint | `/drive/v3/files` (search) → `/drive/v3/files` (create) |
| Idempotent | Yes — perfect for recurring workflows so each run reuses the same folder instead of creating duplicates |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| folder_name | string | Yes | Name of the folder to find or create |
| parent_folder_id | string | No | ID of the parent folder (searches/creates in root if omitted) |
| description | string | No | Optional description (only used when a new folder is created) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| folder_id | string | ID of the folder (existing or newly created) |
| folder_name | string | Name of the folder |
| web_view_link | string | URL to view the folder |
| parent_folder_id | string | ID of the parent folder |
| created | boolean | True if the folder was newly created, false if it already existed |
| created_at | string | Timestamp when the folder was created (if new) or found (if existing) |

---

### 10. share_file
**Description**: Share a file or folder and get a shareable link (see `revoke_access` for the inverse)

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/drive/v3/files/{file_id}/permissions` |
| Idempotent | Yes |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | ID of the file or folder to share |
| permission_type | string | No | `anyone` (default, anyone with the link), `user`/`group` (specific people), `domain` (whole organization) |
| role | string | No | `reader` (default), `commenter`, or `writer` |
| email_addresses | array | No | Email addresses to share with (used when permission_type is `user`/`group` — one permission is created per address) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the shared file |
| file_name | string | Name of the shared file |
| web_view_link | string | Shareable URL to view the file |
| web_content_link | string | URL to download the file (if applicable) |
| permission_id | string | ID of the created permission (single-permission share). Pass this to `revoke_access` to unshare. |
| permission_ids | array | IDs of the created permissions when sharing with multiple `email_addresses` |
| permission_type | string | Type of permission granted |
| shared_with | array | Users/audience the file was shared with |
| shared_at | string | Timestamp when the file was shared (ISO 8601) |

**Notes**: Legacy `permission_type` values are normalised for backward compatibility (`anyone_with_link`, `anyone_can_view`, `anyone_can_edit` → `anyone`; `specific_users` → `user`). Keep the returned `permission_id` if you intend to revoke the share later.

---

### 11. move_file
**Description**: Move a file to a different folder in Google Drive

| Property | Value |
|----------|-------|
| HTTP Method | PATCH |
| Endpoint | `/drive/v3/files/{file_id}?addParents={target}&removeParents={current}` |
| Idempotent | Yes — if the file is already in the target folder the action is a safe no-op (`moved: false`, no PATCH issued) |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | ID of the file to move |
| target_folder_id | string | Yes | ID of the destination folder to move the file into |
| remove_from_current_parents | boolean | No | Default `true` — the file leaves its current folder(s) (a **true move**). Set `false` to add the file to the target folder while keeping its existing folders (Drive's multi-parent "add to folder"). |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the moved file |
| file_name | string | Name of the moved file |
| parents | array | Current parent folder IDs after the move |
| previous_parents | array | Parent folder IDs the file had before the move |
| moved | boolean | True if the file was moved; false if it was already in the target folder (idempotent no-op) |
| web_view_link | string | URL to view the file |
| moved_at | string | Timestamp when the file was moved (ISO 8601) |

**Semantics / safety**: Non-destructive. The set of folders to remove is computed from the file's **live** current parents fetched at execution time (never assuming a single parent), and the target is always excluded from the remove-set, so re-running is safe and idempotent.

---

### 12. rename_file
**Description**: Rename a file in Google Drive

| Property | Value |
|----------|-------|
| HTTP Method | PATCH |
| Endpoint | `/drive/v3/files/{file_id}` (body `{ "name": "<new_name>" }`) |
| Idempotent | Yes — setting the name to its current value is a safe no-op |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | ID of the file to rename |
| new_name | string | Yes | New name for the file |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the renamed file |
| file_name | string | New name of the file |
| previous_name | string | Name the file had before renaming |
| web_view_link | string | URL to view the file |
| renamed_at | string | Timestamp when the file was renamed (ISO 8601) |

**Semantics / safety**: Non-destructive. The current name is fetched before the PATCH so `previous_name` can be reported.

---

### 13. copy_file
**Description**: Create a duplicate of a file in Google Drive

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/drive/v3/files/{file_id}/copy` |
| Idempotent | **No** — each run creates a new copy, so recurring workflows produce duplicates by design |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | ID of the source file to copy |
| new_name | string | No | Name for the copy. If omitted, Google names it 'Copy of <original>'. |
| target_folder_id | string | No | ID of the folder to place the copy in. If omitted, the copy is placed alongside the source. |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the new copy |
| file_name | string | Name of the new copy |
| source_file_id | string | ID of the original file that was copied |
| mime_type | string | MIME type of the copy |
| parents | array | Parent folder IDs of the copy |
| web_view_link | string | URL to view the copy |
| copied_at | string | Timestamp when the file was copied (ISO 8601) |

**Semantics / safety**: Additive — always creates a new file. There is intentionally no dedupe: use with care in scheduled/recurring agents, which will accumulate copies on each run.

---

### 14. delete_file
**Description**: Move a file to Google Drive Trash (**soft delete** — restorable for 30 days). This is **not** a permanent/hard delete.

| Property | Value |
|----------|-------|
| HTTP Method | PATCH |
| Endpoint | `/drive/v3/files/{file_id}` (body `{ "trashed": true }`) |
| Idempotent | Yes — trashing an already-trashed file is a safe no-op |
| Confirmation | Yes — declares a `confirm_trash` confirmation rule |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | ID of the file to move to Trash |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the trashed file |
| file_name | string | Name of the trashed file |
| trashed | boolean | Always `true` on success — the file was moved to Trash |
| restorable | boolean | Always `true` — the file went to Trash (not permanently deleted) and can be restored |
| trashed_at | string | Timestamp when the file was trashed (ISO 8601) |

**Semantics / safety**: **Trash-by-default, never a hard delete.** The action is implemented exclusively as `PATCH { trashed: true }` — a hard `DELETE /drive/v3/files/{file_id}` is intentionally **never** issued, so permanent deletion is structurally impossible (not merely gated by the confirmation). The declared confirmation rule is surfaced to the UI but is advisory in the executor; the non-destructive guarantee is enforced in code. Trashed files can be restored from Google Drive Trash within 30 days.

---

### 15. revoke_access
**Description**: Remove a single sharing permission from a file — the inverse of `share_file`

| Property | Value |
|----------|-------|
| HTTP Method | DELETE |
| Endpoint | `/drive/v3/files/{file_id}/permissions/{permission_id}` (returns `204 No Content`) |
| Idempotent | Yes — revoking an already-removed permission (404) is treated as success (`already_absent: true`), not an error |
| Confirmation | Yes — declares a `confirm_revoke` confirmation rule |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_id | string | Yes | ID of the file to revoke access from |
| permission_id | string | Yes | ID of the permission to remove — from `share_file`'s output `permission_id`, or from `get_file_metadata` with `include_permissions` |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the file access was revoked from |
| permission_id | string | ID of the permission that was removed |
| revoked | boolean | Always `true` on success — the permission is no longer present |
| already_absent | boolean | True if the permission was already gone (404) — treated as success, not an error |
| revoked_at | string | Timestamp when access was revoked (ISO 8601) |

**Semantics / safety**: **Narrow by design** — removes exactly one named permission (`permission_id`), never a blanket unshare. It intentionally takes a `permission_id` (a stable symbolic reference emitted by `share_file`) rather than an email, avoiding the ambiguity of one email mapping to multiple permissions. The confirmation rule is advisory (surfaced to the UI).

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
| 1.3.0 | 2026-07-27 | **Documentation backfill for the Phase 1 file-management slice (commit `bc2ea49`).** Documented the 5 file-management actions shipped in that commit but never added to this doc: `move_file` (true-move by default, idempotent no-op), `rename_file` (idempotent), `copy_file` (**not idempotent** — duplicates by design), `delete_file` (**trash-by-default soft delete, never hard delete** + confirmation), `revoke_access` (`permission_id`-based single-permission removal + confirmation; 404 → `already_absent`). Also back-filled 4 previously-undocumented existing actions: `upload_file`, `create_folder`, `get_or_create_folder`, `share_file`. Doc now covers all **15 actions** and corrected the Required Scopes to match the definition (`drive` + `drive.file`, not readonly). **Definition `plugin.version` remains `1.0.0` (stale) — recommend reconciling to 1.3.0 in a follow-up code change; not touched in this doc-only pass.** |
| 1.2.0 | 2026-06-13 | `read_file_content` now extracts the real text layer from PDFs (`pdf-parse`) instead of UTF-8-decoding the binary (which corrupted it); `export_format` reports the actual format (`text/plain` for parsed PDFs). Scanned/image PDFs still need `download_file` + document-extractor. See WP-57. |
| 1.1.0 | 2026-06-10 | Added `download_file` (base64 binary download for document extraction; `x-semantic-type: file_attachment`). Fixed `read_file_content` `output_schema.required` (referenced non-existent fields `id`/`name`/`mimeType`). See WP-57. |
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: list_files, search_files, get_file_metadata, read_file_content, get_folder_contents |
