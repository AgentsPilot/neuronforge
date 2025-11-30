# Google Docs Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Productivity
**Last Updated**: 2025-11-30

---

## Overview

Read, write, and manage content in Google Docs documents. Use for reading document text, inserting content, appending text, creating new documents, and managing document content as structured input/output for agents.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.google.com/identity/protocols/oauth2 | Google-style OAuth 2.0 with refresh token support |
| Authorization Endpoint | https://accounts.google.com/o/oauth2/v2/auth | Google authorization URL |
| Token Endpoint | https://oauth2.googleapis.com/token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.google.com/docs/api/auth | Required scopes for document access |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Docs API Overview | https://developers.google.com/docs/api/reference/rest | REST API for Google Docs operations |
| Documents Resource | https://developers.google.com/docs/api/reference/rest/v1/documents | CRUD operations for documents |
| BatchUpdate | https://developers.google.com/docs/api/reference/rest/v1/documents/batchUpdate | Batch update operations for inserting/modifying content |

---

## High-Level Decisions

- **OAuth Flow**: Google-style OAuth 2.0 with openid, email, profile scopes plus docs-specific scopes
- **Required Scopes**: openid, email, profile, documents, drive
- **Max Text Insert**: 50,000 characters per operation
- **Max Document Read**: 100,000 characters (large documents blocked)
- **Drive Scope**: Required for document creation and full access

---

## Actions

### 1. read_document
**Description**: Read the full content and structure of a Google Docs document

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v1/documents/{document_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | string | Yes | The ID of the document to read (from URL or file ID) |
| include_formatting | boolean | No | Include text formatting info (bold, italic, etc.). Default: false |
| plain_text_only | boolean | No | Return only plain text without structural elements. Default: true |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| document_id | string | Unique document identifier |
| title | string | Document title |
| char_count | integer | Total character count in the document |
| content | string | Plain text content of the document |
| structured_content | array | Document structure with paragraphs (when plain_text_only is false) |
| full_document | object | Complete document object with formatting (when include_formatting is true) |
| retrieved_at | string | Timestamp when document was retrieved |

---

### 2. insert_text
**Description**: Insert text at a specific position in the document

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v1/documents/{document_id}:batchUpdate` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | string | Yes | The ID of the document to insert text into |
| text | string | Yes | The text content to insert |
| index | number | Yes | Character position to insert at (1 = start, -1 = end) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| document_id | string | ID of the document that was modified |
| char_count | integer | Number of characters inserted |
| index | integer | Position where text was inserted |
| inserted_at | string | Timestamp when text was inserted |

---

### 3. append_text
**Description**: Append text to the end of the document

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v1/documents/{document_id}:batchUpdate` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | string | Yes | The ID of the document to append text to |
| text | string | Yes | The text content to append |
| add_line_break | boolean | No | Add a line break before appending. Default: true |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| document_id | string | ID of the document that was modified |
| title | string | Title of the document |
| char_count | integer | Number of characters appended |
| appended_at | string | Timestamp when text was appended |

---

### 4. create_document
**Description**: Create a new Google Docs document

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/v1/documents` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | Yes | The title/name of the new document (max 255 chars) |
| initial_content | string | No | Optional initial text content to add |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| document_id | string | Unique identifier for the new document |
| document_url | string | URL to open the document in Google Docs |
| title | string | Title of the created document |
| created_at | string | Timestamp when document was created |

---

### 5. get_document_info
**Description**: Get metadata and information about a document

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/v1/documents/{document_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | string | Yes | The ID of the document to get information about |
| include_content_summary | boolean | No | Include content summary (char count, paragraph count). Default: false |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| document_id | string | Unique document identifier |
| title | string | Document title |
| char_count | integer | Character count (when include_content_summary is true) |
| paragraph_count | integer | Paragraph count (when include_content_summary is true) |
| end_index | integer | End index of document content for positioning text |
| retrieved_at | string | Timestamp when info was retrieved |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/google-docs-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/google-docs-plugin-executor.ts` | Executor class implementing all Google Docs actions |

---

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

To obtain credentials:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/google-docs`
4. Enable the Google Docs API and Google Drive API in your project
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: read_document, insert_text, append_text, create_document, get_document_info |
