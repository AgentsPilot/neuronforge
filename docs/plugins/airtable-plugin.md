# Airtable Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Productivity
**Last Updated**: 2025-11-30

---

## Overview

Access Airtable bases, tables, and records for data management and workflow automation. Airtable is a cloud-based database platform that combines spreadsheet simplicity with database power. Use this plugin to read/write records, manage tables, filter and query views, handle attachments, and integrate structured data into your workflows and dashboards.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://airtable.com/developers/web/guides/oauth-integrations | Airtable uses standard OAuth 2.0 with PKCE required for security |
| Authorization Endpoint | https://www.airtable.com/oauth2/v1/authorize | Standard authorization URL for initiating OAuth flow |
| Token Endpoint | https://airtable.com/oauth2/v1/token | Token exchange and refresh endpoint |
| Scopes Reference | https://airtable.com/developers/web/api/scopes | Required scopes: data.records:read, data.records:write, schema.bases:read, user.email:read |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| API Overview | https://airtable.com/developers/web/api/introduction | REST API with base URL: https://api.airtable.com/v0 |
| Records API | https://airtable.com/developers/web/api/list-records | CRUD operations for records with filtering, sorting, pagination |
| Attachments | https://airtable.com/developers/web/api/attachment-overview | Attachments via URL upload, temporary download URLs (2hr expiry) |
| Rate Limits | https://airtable.com/developers/web/api/rate-limits | 5 requests per second per base |

---

## High-Level Decisions

- **OAuth Flow**: Standard OAuth 2.0 with PKCE (required by Airtable)
- **Token Expiry**: 3600 seconds (1 hour), with refresh token support
- **Rate Limiting**: 5 requests per second per base (enforced by Airtable)
- **Batch Operations**: Max 10 records per create/update request

---

## Actions

### 1. list_bases
**Description**: List all accessible Airtable bases for the authenticated user

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v0/meta/bases` |
| Parameters | None |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| bases | array | Array of accessible bases |
| bases[].id | string | Base ID (starts with 'app') |
| bases[].name | string | Base display name |
| bases[].permission_level | string | User's permission level (owner, editor, commenter, read) |
| base_count | integer | Total number of bases returned |

---

### 2. list_records
**Description**: List and query records from a table with filtering, sorting, and pagination

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v0/{base_id}/{table_name}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |
| table_name | string | Yes | The name or ID of the table to query |
| view | string | No | Name of a specific view to use for filtering and sorting |
| fields | array | No | Array of field names to return (returns all fields if omitted) |
| filter_by_formula | string | No | Airtable formula to filter records (e.g., '{Status} = "Active"') |
| sort | array | No | Array of sort objects to order results |
| max_records | integer | No | Maximum number of records to return (default: 100, max: 1000) |
| page_size | integer | No | Number of records per page (max: 100) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| records | array | Array of matching records |
| records[].id | string | Unique record ID (starts with 'rec') |
| records[].fields | object | Record field values as key-value pairs |
| records[].createdTime | string | ISO 8601 timestamp of record creation |
| record_count | integer | Number of records returned in this response |
| offset | string | Pagination cursor for next page (null if no more results) |
| has_more | boolean | Whether more records are available via pagination |

---

### 3. get_record
**Description**: Get a single record by ID with all field details

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v0/{base_id}/{table_name}/{record_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |
| table_name | string | Yes | The name or ID of the table |
| record_id | string | Yes | The ID of the record to retrieve (starts with 'rec') |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique record ID (starts with 'rec') |
| fields | object | Record field values as key-value pairs |
| created_time | string | ISO 8601 timestamp of record creation |

---

### 4. create_records
**Description**: Create one or multiple new records in a table

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v0/{base_id}/{table_name}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |
| table_name | string | Yes | The name or ID of the table |
| records | array | Yes | Array of records to create (max 10 records per request) |
| records[].fields | object | Yes | Object containing field names as keys and values |
| typecast | boolean | No | If true, Airtable will attempt to convert string values to the appropriate field type |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| records | array | Array of created records |
| records[].id | string | Assigned record ID (starts with 'rec') |
| records[].fields | object | Record field values as key-value pairs |
| records[].createdTime | string | ISO 8601 timestamp of record creation |
| record_count | integer | Number of records successfully created |
| created_at | string | ISO 8601 timestamp of when the operation completed |

---

### 5. update_records
**Description**: Update existing records with new field values

| Property | Value |
|----------|-------|
| HTTP Method | PATCH (partial) / PUT (destructive) |
| Endpoint | `/v0/{base_id}/{table_name}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |
| table_name | string | Yes | The name or ID of the table |
| records | array | Yes | Array of records to update (max 10 records per request) |
| records[].id | string | Yes | The ID of the record to update |
| records[].fields | object | Yes | Object containing field names and new values |
| typecast | boolean | No | If true, Airtable will attempt to convert string values |
| destructive | boolean | No | If true, clears fields not included in the request (full replacement) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| records | array | Array of updated records |
| records[].id | string | Record ID (starts with 'rec') |
| records[].fields | object | Updated record field values |
| records[].createdTime | string | ISO 8601 timestamp of original record creation |
| record_count | integer | Number of records successfully updated |
| updated_at | string | ISO 8601 timestamp of when the operation completed |
| destructive | boolean | Whether destructive mode was used |

---

### 6. list_tables
**Description**: List all tables in a specific base with metadata

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v0/meta/bases/{base_id}/tables` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| tables | array | Array of tables in the base |
| tables[].id | string | Table ID (starts with 'tbl') |
| tables[].name | string | Table display name |
| tables[].primary_field_id | string | ID of the primary field (starts with 'fld') |
| tables[].field_count | integer | Number of fields in the table |
| tables[].view_count | integer | Number of views in the table |
| table_count | integer | Total number of tables in the base |

---

### 7. upload_attachment
**Description**: Upload a file attachment to a record's attachment field

| Property | Value |
|----------|-------|
| HTTP Method | PATCH |
| Endpoint | `/v0/{base_id}/{table_name}/{record_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |
| table_name | string | Yes | The name or ID of the table |
| record_id | string | Yes | The ID of the record to attach the file to |
| field_name | string | Yes | The name of the attachment field |
| attachment.url | string | Yes | Publicly accessible URL of the file to attach |
| attachment.filename | string | Yes | The filename to use for the attachment |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| record_id | string | Record ID that was updated |
| field_name | string | Name of the attachment field |
| attachments | array | Array of all attachments in the field |
| attachments[].id | string | Attachment ID (starts with 'att') |
| attachments[].url | string | URL to download the attachment |
| attachments[].filename | string | Original filename |
| attachments[].size | integer | File size in bytes |
| attachments[].type | string | MIME type of the file |
| attachment_count | integer | Total number of attachments after upload |

---

### 8. get_attachment_urls
**Description**: Get download URLs for attachments from a record (URLs expire after 2 hours)

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v0/{base_id}/{table_name}/{record_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| base_id | string | Yes | The ID of the Airtable base (starts with 'app') |
| table_name | string | Yes | The name or ID of the table |
| record_id | string | Yes | The ID of the record containing attachments |
| field_name | string | Yes | The name of the attachment field |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| attachments | array | Array of attachment objects with download URLs |
| attachments[].id | string | Attachment ID (starts with 'att') |
| attachments[].url | string | Temporary download URL (expires in ~2 hours) |
| attachments[].filename | string | Original filename |
| attachments[].size | integer | File size in bytes |
| attachments[].type | string | MIME type of the file |
| attachments[].width | integer | Image width in pixels (null for non-images) |
| attachments[].height | integer | Image height in pixels (null for non-images) |
| attachment_count | integer | Number of attachments in the field |
| expiry_note | string | Note about URL expiration policy |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/airtable-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/airtable-plugin-executor.ts` | Executor class implementing all Airtable actions |

---

## Environment Variables

```bash
AIRTABLE_CLIENT_ID=your_airtable_client_id_here
AIRTABLE_CLIENT_SECRET=your_airtable_client_secret_here
```

To obtain credentials:
1. Go to https://airtable.com/create/oauth
2. Create a new OAuth integration
3. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/airtable`
4. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 8 actions: list_bases, list_records, get_record, create_records, update_records, list_tables, upload_attachment, get_attachment_urls |
