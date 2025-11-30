# Slack Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Communication
**Last Updated**: 2025-11-30

---

## Overview

Send messages, manage channels, upload files, and interact with your Slack workspace. Use for team communication, sending notifications, reading messages, managing channels, looking up users, adding reactions, uploading files, and integrating Slack workflows with agent actions.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://api.slack.com/authentication/oauth-v2 | Slack OAuth 2.0 with user and bot scopes |
| Authorization Endpoint | https://slack.com/oauth/v2/authorize | Slack authorization URL |
| Token Endpoint | https://slack.com/api/oauth.v2.access | Token exchange endpoint |
| Scopes Reference | https://api.slack.com/scopes | Complete list of available scopes |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Web API Overview | https://api.slack.com/web | Slack Web API for all operations |
| Messages API | https://api.slack.com/methods#chat | Send, update, delete messages |
| Channels API | https://api.slack.com/methods#conversations | Channel management operations |
| Users API | https://api.slack.com/methods#users | User lookup and information |
| Files API | https://api.slack.com/methods#files | File upload and management |

---

## High-Level Decisions

- **OAuth Flow**: Standard OAuth 2.0 with both user and bot scopes
- **User Scopes**: identity.basic
- **Bot Scopes**: channels:read/write/join/history, groups:read/write/history, chat:write, im:read/write/history, mpim:read/history, users:read, reactions:read/write, files:read/write
- **Max Message Length**: 4000 characters
- **Max Users/Channels Per Request**: 1000 items

---

## Actions

### 1. send_message
**Description**: Send a message to a Slack channel, direct message, or thread

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/api/chat.postMessage` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel_id | string | Yes | The ID of the channel or DM (e.g., C1234567890, D1234567890) |
| message_text | string | Yes | The text content to send (max 4000 chars) |
| thread_timestamp | string | No | Timestamp of parent message to reply in a thread |
| as_user | boolean | No | Send as the authenticated user (default: true) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| message_timestamp | string | Slack timestamp (ts) of the sent message |
| channel_id | string | Channel ID where the message was sent |
| success | boolean | Whether the message was sent successfully |
| message_text | string | The text content that was sent |
| is_threaded | boolean | Whether the message was sent as a thread reply |

---

### 2. read_messages
**Description**: Read message history from a Slack channel or direct message

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/api/conversations.history` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel_id | string | Yes | The ID of the channel or DM to read from |
| limit | number | No | Max messages to retrieve (default: 15, max: 100) |
| oldest_timestamp | string | No | Only messages after this timestamp |
| latest_timestamp | string | No | Only messages before this timestamp |
| include_all_metadata | boolean | No | Include reactions, attachments, etc. (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| messages | array | Array of messages in reverse chronological order |
| messages[].timestamp | string | Message timestamp (ts) |
| messages[].user | string | User ID who sent the message |
| messages[].text | string | Message content |
| messages[].thread_timestamp | string | Parent thread timestamp if in a thread |
| messages[].reply_count | integer | Number of replies if thread parent |
| messages[].reactions | array | Reactions on the message (if metadata requested) |
| messages[].is_thread_parent | boolean | Whether this message started a thread |
| message_count | integer | Number of messages returned |
| has_more | boolean | Whether more messages are available |

---

### 3. update_message
**Description**: Update or edit a previously sent message

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/api/chat.update` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel_id | string | Yes | The ID of the channel containing the message |
| message_timestamp | string | Yes | The timestamp of the message to update |
| new_message_text | string | Yes | The new text content (max 4000 chars) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| message_timestamp | string | Timestamp of the updated message |
| channel_id | string | Channel containing the message |
| text | string | The new message text |
| success | boolean | Whether the update was successful |
| updated_at | string | ISO 8601 timestamp of update |

---

### 4. add_reaction
**Description**: Add an emoji reaction to a message

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/api/reactions.add` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel_id | string | Yes | The ID of the channel containing the message |
| message_timestamp | string | Yes | The timestamp of the message to react to |
| emoji_name | string | Yes | The emoji name without colons (e.g., 'thumbsup', 'heart') |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the reaction was added successfully |
| emoji | string | The emoji name that was added |
| message_timestamp | string | Timestamp of the message reacted to |
| channel_id | string | Channel containing the message |

---

### 5. remove_reaction
**Description**: Remove an emoji reaction from a message

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/api/reactions.remove` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel_id | string | Yes | The ID of the channel containing the message |
| message_timestamp | string | Yes | The timestamp of the message |
| emoji_name | string | Yes | The emoji name without colons |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the reaction was removed successfully |
| emoji | string | The emoji name that was removed |
| message_timestamp | string | Timestamp of the message |
| channel_id | string | Channel containing the message |

---

### 6. create_channel
**Description**: Create a new Slack channel (public or private)

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/api/conversations.create` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel_name | string | Yes | Channel name (lowercase, numbers, hyphens, underscores only, max 80 chars) |
| is_private | boolean | No | Whether the channel should be private (default: false) |
| description | string | No | Optional description for the channel |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| channel_id | string | ID of the newly created channel |
| channel_name | string | Name of the channel |
| is_private | boolean | Whether the channel is private |
| success | boolean | Whether creation was successful |
| created_at | string | ISO 8601 timestamp of creation |

---

### 7. list_channels
**Description**: List all channels the bot has access to

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/api/conversations.list` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| types | string | No | Comma-separated types: public_channel, private_channel, im, mpim |
| limit | number | No | Max channels to retrieve (default: 100, max: 1000) |
| exclude_archived | boolean | No | Exclude archived channels (default: true) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| channels | array | Array of channel objects |
| channels[].channel_id | string | Channel ID |
| channels[].name | string | Channel name |
| channels[].is_private | boolean | Whether private |
| channels[].is_archived | boolean | Whether archived |
| channels[].member_count | integer | Number of members |
| channels[].topic | string | Channel topic |
| channels[].purpose | string | Channel purpose/description |
| total_count | integer | Number of channels returned |
| has_more | boolean | Whether more channels available |

---

### 8. list_users
**Description**: Get a list of all users in the Slack workspace

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/api/users.list` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| limit | number | No | Max users to retrieve (default: 100, max: 1000) |
| include_deleted | boolean | No | Include deleted/deactivated users (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| users | array | Array of user objects |
| users[].user_id | string | User ID |
| users[].name | string | Username |
| users[].real_name | string | Full name |
| users[].display_name | string | Display name |
| users[].email | string | Email address |
| users[].is_bot | boolean | Whether this is a bot |
| users[].is_admin | boolean | Whether workspace admin |
| users[].status | string | User's status text |
| users[].avatar | string | URL to 72px avatar |
| total_count | integer | Number of users returned |

---

### 9. get_user_info
**Description**: Get detailed information about a specific user

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/api/users.info` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| user_id | string | Yes | The ID of the user (e.g., U1234567890) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| user_id | string | User ID |
| name | string | Username |
| real_name | string | Full name |
| display_name | string | Display name |
| email | string | Email address |
| phone | string | Phone number |
| title | string | Job title |
| status_text | string | Status message |
| status_emoji | string | Status emoji |
| is_bot | boolean | Whether this is a bot |
| is_admin | boolean | Whether workspace admin |
| timezone | string | User's timezone identifier |
| avatar_512 | string | URL to 512px avatar |

---

### 10. upload_file
**Description**: Upload and share a file to Slack channels or direct messages

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/api/files.upload` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| filename | string | Yes | The name of the file to upload |
| file_content | string | Yes | File content (base64 for binary, or plain text) |
| channel_ids | array | No | Array of channel IDs to share the file |
| title | string | No | Optional title for the file |
| initial_comment | string | No | Optional message to include with the file |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| file_id | string | ID of the uploaded file |
| filename | string | Name of the file |
| title | string | Title of the file |
| url | string | Permalink URL to access the file |
| channels | array | Channel IDs where file was shared |
| success | boolean | Whether upload was successful |
| uploaded_at | string | ISO 8601 timestamp of upload |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/slack-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/slack-plugin-executor.ts` | Executor class implementing all Slack actions |

---

## Environment Variables

```bash
SLACK_CLIENT_ID=your_slack_client_id_here
SLACK_CLIENT_SECRET=your_slack_client_secret_here
SLACK_REDIRECT_URI=your_base_url_here
```

To obtain credentials:
1. Go to https://api.slack.com/apps
2. Create a new app
3. Add OAuth scopes under "OAuth & Permissions"
4. Set redirect URI: `${SLACK_REDIRECT_URI}/oauth/callback/slack`
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 10 actions: send_message, read_messages, update_message, add_reaction, remove_reaction, create_channel, list_channels, list_users, get_user_info, upload_file |
