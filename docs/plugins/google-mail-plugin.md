# Google Mail (Gmail) Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Communication
**Last Updated**: 2025-11-30

---

## Overview

Send, read, and manage Gmail emails. Use for all Gmail email-related tasks including sending messages, searching conversations, and managing drafts.

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
| Drafts Resource | https://developers.google.com/gmail/api/reference/rest/v1/users.drafts | Create and manage drafts |
| Search Operators | https://support.google.com/mail/answer/7190 | Gmail search query syntax |

---

## High-Level Decisions

- **OAuth Flow**: Google-style OAuth 2.0 with openid, email, profile scopes plus gmail-specific scopes
- **Required Scopes**: openid, email, profile, gmail.readonly, gmail.send, gmail.modify
- **Max Recipients**: 50 recipients per email
- **Max Search Results**: 100 emails per search
- **Subject Length**: Maximum 200 characters

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
| emails[].body | string | Email body text |
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
| 1.0.0 | 2025-11-30 | Initial plugin with 3 actions: send_email, search_emails, create_draft |
