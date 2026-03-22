# WhatsApp Business Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Communication
**Plugin Key**: `whatsapp-business`
**Last Updated**: 2026-02-13

---

## Overview

Send templated messages, manage customer conversations, and automate WhatsApp Business messaging. Use for customer communication, sending notifications, managing WhatsApp Business conversations, responding to customer messages, and integrating WhatsApp messaging workflows with agent actions. Supports template messages, interactive buttons, and real-time text messaging.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.facebook.com/docs/facebook-login/guides/access-tokens | Facebook/Meta OAuth 2.0 for WhatsApp Business API |
| Authorization Endpoint | https://www.facebook.com/v23.0/dialog/oauth | Meta authorization URL |
| Token Endpoint | https://graph.facebook.com/v23.0/oauth/access_token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.facebook.com/docs/permissions | whatsapp_business_messaging, whatsapp_business_management |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| WhatsApp Business API | https://developers.facebook.com/docs/whatsapp/cloud-api | Cloud API for messaging operations |
| Message Templates | https://developers.facebook.com/docs/whatsapp/message-templates | Template creation and usage |
| Interactive Messages | https://developers.facebook.com/docs/whatsapp/guides/interactive-messages | Buttons and list messages |
| Webhooks | https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks | Receiving incoming messages and status updates |

---

## High-Level Decisions

- **OAuth Flow**: Meta/Facebook OAuth 2.0 with WhatsApp-specific scopes
- **Required Scopes**: whatsapp_business_messaging, whatsapp_business_management
- **Webhook Required**: Yes - for receiving incoming messages and delivery status
- **24-Hour Window**: Free-form messages only within 24 hours of customer's last message
- **Template Messages**: Required for business-initiated conversations outside 24-hour window
- **Rate Limit**: 80 messages per second per phone number

---

## Actions

### 1. send_template_message
**Description**: Send a pre-approved template message to initiate or continue a conversation with a customer

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/{phone_number_id}/messages` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| recipient_phone | string | Yes | Customer's phone in international format (e.g., +15551234567) |
| template_name | string | Yes | Name of the approved message template |
| language_code | string | Yes | Language and locale code (e.g., en_US, es_MX) |
| template_parameters | object | No | Dynamic values for placeholders: {body: [...], header: [...]} |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the message was sent successfully |
| message_id | string | WhatsApp message ID (WAMID) for tracking |
| recipient | string | Phone number message was sent to |
| template_name | string | Name of the template used |
| message | string | Status message describing the result |

---

### 2. send_text_message
**Description**: Send a free-form text message to a customer within the 24-hour customer service window

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/{phone_number_id}/messages` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| recipient_phone | string | Yes | Customer's phone in international format |
| message_text | string | Yes | Text content (max 4096 chars). Supports *bold*, _italic_, ~strikethrough~, ```monospace``` |
| preview_url | boolean | No | Show URL preview for links (default: false) |
| reply_to_message_id | string | No | WhatsApp message ID to reply to (contextual reply) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the message was sent successfully |
| message_id | string | WhatsApp message ID (WAMID) for tracking |
| recipient | string | Phone number message was sent to |
| is_reply | boolean | Whether this was a reply to another message |
| message | string | Status message describing the result |

---

### 3. send_interactive_message
**Description**: Send a message with interactive buttons or selection lists to guide customer through workflows

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/{phone_number_id}/messages` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| recipient_phone | string | Yes | Customer's phone in international format |
| body_text | string | Yes | Main message text explaining options (max 1024 chars) |
| interaction_type | string | Yes | Type: 'button' for quick replies or 'list' for selection menu |
| header_text | string | No | Header text (max 60 chars, only for lists) |
| footer_text | string | No | Footer text (max 60 chars) |
| buttons | array | No | Button objects: [{id, title}]. Max 3 buttons, 20 chars per title |
| list_button_text | string | No | Text on button that opens list (required for type='list', max 20 chars) |
| list_sections | array | No | Sections with rows: [{title, rows: [{id, title, description}]}]. Max 10 rows total |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the message was sent successfully |
| message_id | string | WhatsApp message ID (WAMID) for tracking |
| recipient | string | Phone number message was sent to |
| interaction_type | string | Type of interactive message (button or list) |
| message | string | Status message describing the result |

---

### 4. list_message_templates
**Description**: Retrieve all approved message templates available for your WhatsApp Business Account

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/{waba_id}/message_templates` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| limit | number | No | Max templates to retrieve (default: 50, max: 250) |
| status_filter | string | No | Filter by: 'APPROVED', 'PENDING', 'REJECTED', or empty for all |
| name_filter | string | No | Filter templates by name (partial match) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether templates were retrieved successfully |
| templates | array | List of available message templates |
| templates[].name | string | Template name for use with send_template_message |
| templates[].status | string | Approval status (APPROVED, PENDING, REJECTED) |
| templates[].language | string | Language code (e.g., en_US) |
| templates[].category | string | Template category (MARKETING, UTILITY, etc.) |
| templates[].components | array | Template components (header, body, footer, buttons) |
| templates[].parameter_count | integer | Number of parameters required in body |
| total_count | integer | Total templates returned |
| has_more | boolean | Whether more templates are available |

---

### 5. mark_message_read
**Description**: Mark an incoming customer message as read to improve customer experience and conversation management

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/{phone_number_id}/messages` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| message_id | string | Yes | WhatsApp message ID (WAMID) from incoming message webhook |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the message was marked as read |
| message_id | string | The message ID that was marked as read |
| message | string | Status message describing the result |

---

## Webhook Configuration

WhatsApp requires webhooks for receiving incoming messages and delivery status updates.

| Configuration | Value |
|--------------|-------|
| Endpoint Path | `/api/plugins/webhooks/whatsapp-business` |
| Events | messages, message_status |
| Verify Token Required | Yes |
| Profile Data Required | phone_number_id, waba_id |

**Setup Instructions**:
1. After OAuth, configure webhook in Meta App Dashboard > WhatsApp > Configuration
2. Subscribe to 'messages' field
3. Webhook URL will be provided after connection

---

## Additional Configuration

This plugin requires additional configuration fields after OAuth:

| Field | Label | Description |
|-------|-------|-------------|
| phone_number_id | Phone Number ID | Your WhatsApp Business phone number ID from Meta Business Manager |
| waba_id | WhatsApp Business Account ID | Your WABA ID from Meta Business Manager |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/whatsapp-business-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/whatsapp-business-plugin-executor.ts` | Executor class implementing all WhatsApp actions |
| `app/api/plugins/webhooks/whatsapp-business/route.ts` | Webhook route for incoming messages and status updates |

---

## Environment Variables

```bash
WHATSAPP_CLIENT_ID=your_whatsapp_client_id_here
WHATSAPP_CLIENT_SECRET=your_whatsapp_client_secret_here
WHATSAPP_CONFIG_ID=your_whatsapp_config_id_here
WHATSAPP_VERIFY_TOKEN=your_random_verify_token_here
```

To obtain credentials:
1. Go to https://developers.facebook.com/apps
2. Create a new app with WhatsApp product
3. Configure WhatsApp in App Dashboard
4. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/whatsapp-business`
5. Copy App ID (Client ID) and App Secret (Client Secret)
6. Get Config ID from WhatsApp product settings
7. Set `WHATSAPP_VERIFY_TOKEN` to any random string — use the same value when configuring the webhook in Meta's dashboard

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: send_template_message, send_text_message, send_interactive_message, list_message_templates, mark_message_read |
| 1.0.1 | 2026-02-13 | Standardized plugin key to `whatsapp-business`, renamed files, fixed icon, aligned API to v23.0, added WHATSAPP_VERIFY_TOKEN |
