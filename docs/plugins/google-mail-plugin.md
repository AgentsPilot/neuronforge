# Google Mail (Gmail) Plugin Documentation

**Plugin Version**: 1.1.0
**Category**: Communication
**Last Updated**: 2026-03-29

---

## Overview

Send, read, and manage Gmail emails. Use for all Gmail email-related tasks including sending messages, searching conversations, managing drafts, downloading attachments, and modifying email labels.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.google.com/identity/protocols/oauth2 | Google-style OAuth 2.0 with refresh token support |
| Authorization Endpoint | https://accounts.google.com/o/oauth2/v2/auth | Google authorization URL |
| Token Endpoint | https://oauth2.googleapis.com/token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.google.com/gmail/api/auth/scopes | Required scopes for Gmail access |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Gmail API Overview | https://developers.google.com/gmail/api/reference/rest | REST API for Gmail operations |
| Messages Resource | https://developers.google.com/gmail/api/reference/rest/v1/users.messages | Send, read, and manage messages |
| Messages.modify | https://developers.google.com/gmail/api/reference/rest/v1/users.messages/modify | Modify message labels |
| Labels Resource | https://developers.google.com/gmail/api/reference/rest/v1/users.labels | List and create labels |
| Drafts Resource | https://developers.google.com/gmail/api/reference/rest/v1/users.drafts | Create and manage drafts |
| Search Operators | https://support.google.com/mail/answer/7190 | Gmail search query syntax |

---

## High-Level Decisions

- **OAuth Flow**: Google-style OAuth 2.0 with openid, email, profile scopes plus gmail-specific scopes
- **Required Scopes**: openid, email, profile, gmail.readonly, gmail.send, gmail.modify
- **Max Recipients**: 50 recipients per email
- **Max Search Results**: 100 emails per search
- **Subject Length**: Maximum 200 characters
- **Label Resolution**: System labels (IMPORTANT, STARRED, UNREAD, etc.) are used directly as IDs; custom labels are resolved by name via the Labels API, and created if not found

---

## Actions

### 1. send_email
**Description**: Compose and send an email message

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/gmail/v1/users/me/messages/send` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| recipients.to | array | Yes | Primary recipients (email addresses) |
| recipients.cc | array | No | Carbon copy recipients |
| recipients.bcc | array | No | Blind carbon copy recipients |
| content.subject | string | Yes | Email subject line (max 200 chars) |
| content.body | string | No | Plain text email body |
| content.html_body | string | No | HTML formatted email body |
| options.send_immediately | boolean | No | Send immediately or save as draft (default: true) |
| options.request_read_receipt | boolean | No | Request read receipt (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| message_id | string | Gmail message ID |
| thread_id | string | Gmail thread ID |
| sent_at | string | ISO 8601 timestamp when email was sent |
| recipient_count | integer | Total number of recipients |
| recipients | object | Recipient addresses (to, cc, bcc) |
| subject | string | Email subject line |

---

### 2. search_emails
**Description**: Search for emails in the user's Gmail account

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/gmail/v1/users/me/messages` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | No | Search query (supports Gmail operators like 'from:', 'subject:', 'in:'). Default: search inbox |
| max_results | number | No | Maximum emails to return (1-100, default: 10) |
| include_attachments | boolean | No | Include attachment metadata (default: false) |
| content_level | string | No | How much content to fetch: metadata, snippet, full (default: snippet) |
| folder | string | No | Folder to search: inbox, sent, drafts, spam, trash, all (default: inbox) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| emails | array | Array of matching emails |
| emails[].id | string | Gmail message ID |
| emails[].thread_id | string | Gmail thread ID |
| emails[].subject | string | Email subject |
| emails[].from | string | Sender address |
| emails[].to | string | Recipient addresses |
| emails[].date | string | Email date |
| emails[].snippet | string | Email preview snippet |
| emails[].labels | array | Gmail labels |
| emails[].body | string | Email body text (only when content_level is 'full') |
| emails[].attachments | array | Attachment metadata (if requested) |
| total_found | integer | Number of emails returned |
| total_available | integer | Estimated total matching emails |
| search_query | string | The search query that was executed |

---

### 3. create_draft
**Description**: Create a draft email without sending

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/gmail/v1/users/me/drafts` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| recipients.to | array | No | Primary recipients |
| recipients.cc | array | No | Carbon copy recipients |
| recipients.bcc | array | No | Blind carbon copy recipients |
| content.subject | string | No | Email subject line (max 200 chars) |
| content.body | string | No | Plain text email body |
| content.html_body | string | No | HTML formatted email body |
| save_location | string | No | Where to save: drafts or templates (default: drafts) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| draft_id | string | Gmail draft ID |
| message_id | string | Gmail message ID of the draft |
| created_at | string | ISO 8601 timestamp when draft was created |
| recipient_count | integer | Total number of recipients |
| recipients | object | Recipient addresses |
| subject | string | Draft subject line |

---

### 4. get_email_attachment
**Description**: Download email attachment content for processing

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/gmail/v1/users/me/messages/{message_id}/attachments/{attachment_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| message_id | string | Yes | Gmail message ID containing the attachment |
| attachment_id | string | Yes | Gmail attachment ID from search_emails result |
| filename | string | No | Original filename for reference (recommended for MIME detection) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| filename | string | Attachment filename |
| mimeType | string | MIME type (application/pdf, image/png, etc.) |
| size | integer | File size in bytes |
| data | string | Base64-encoded file content |
| extracted_text | string | Extracted text from PDF/document (if applicable) |
| is_image | boolean | True if attachment is an image or PDF |

---

### 5. modify_email
**Description**: Modify email labels -- mark as important, apply/remove labels, mark read/unread

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/gmail/v1/users/me/messages/{message_id}/modify` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| message_id | string | Yes | Gmail message ID to modify |
| add_labels | array | No | Label names or system labels to add (e.g. 'IMPORTANT', 'STARRED', or custom name like 'AgentsPilot') |
| remove_labels | array | No | Label names or system labels to remove (e.g. 'UNREAD', 'INBOX') |
| mark_important | boolean | No | Shorthand: true adds 'IMPORTANT', false removes it |
| mark_read | boolean | No | Shorthand: true removes 'UNREAD', false adds it |

**Label Resolution**:
- **System labels** (`IMPORTANT`, `STARRED`, `UNREAD`, `INBOX`, `SPAM`, `TRASH`, `SENT`, `DRAFT`, `CATEGORY_*`) are used directly as label IDs.
- **Custom labels** (e.g. `"AgentsPilot"`) are resolved by name via `GET /users/me/labels`. If not found, a new label is automatically created via `POST /users/me/labels`.
- The `mark_important` and `mark_read` shorthands are additive -- they merge with any explicit `add_labels`/`remove_labels` arrays.

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| message_id | string | The modified message ID |
| labels_added | array | Label IDs that were added |
| labels_removed | array | Label IDs that were removed |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/google-mail-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/gmail-plugin-executor.ts` | Executor class implementing all Gmail actions |

---

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

To obtain credentials:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/google-mail`
4. Enable the Gmail API in your project
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-03-29 | Added `modify_email` action (Gmail Urgency Flagging Agent - Phase E blocker). Added `get_email_attachment` to docs (was missing). Added label resolution documentation. |
| 1.0.0 | 2025-11-30 | Initial plugin with 3 actions: send_email, search_emails, create_draft |
