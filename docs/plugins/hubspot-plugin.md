# HubSpot Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: CRM
**Last Updated**: 2025-11-30

---

## Overview

Access HubSpot CRM data including contacts, deals, companies, and activity timelines. Use for retrieving contact information, viewing deal pipelines, accessing customer activity history, searching CRM records, and integrating HubSpot customer data with agent workflows.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.hubspot.com/docs/api/oauth/tokens | HubSpot OAuth 2.0 implementation |
| Authorization Endpoint | https://app.hubspot.com/oauth/authorize | HubSpot authorization URL |
| Token Endpoint | https://api.hubapi.com/oauth/v1/token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.hubspot.com/docs/api/oauth/scopes | Required scopes for CRM access |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Contacts API | https://developers.hubspot.com/docs/api/crm/contacts | CRUD operations for contacts |
| Deals API | https://developers.hubspot.com/docs/api/crm/deals | Deal pipeline and management |
| Engagements API | https://developers.hubspot.com/docs/api/crm/engagements | Activities like calls, emails, meetings |
| Search API | https://developers.hubspot.com/docs/api/crm/search | Search CRM objects with filters |

---

## High-Level Decisions

- **OAuth Flow**: HubSpot OAuth 2.0 with CRM-specific scopes
- **Required Scopes**: oauth, crm.objects.contacts.read/write, crm.objects.deals.read, crm.objects.companies.read, crm.objects.owners.read
- **Max Results Per Request**: 100 items for deals/activities, 100 contacts for search
- **Activity Types Supported**: calls, emails, notes, meetings, tasks

---

## Actions

### 1. get_contact
**Description**: Retrieve detailed contact information by ID or email address

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/crm/v3/objects/contacts/{contact_id}` or search by email |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| contact_identifier | string | Yes | The contact ID or email address to look up |
| identifier_type | string | No | Type of identifier: 'id' or 'email' (default: 'email') |
| properties | array | No | Specific properties to retrieve (e.g., ['firstname', 'lastname', 'phone']) |
| include_associations | boolean | No | Include associated companies and deals (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the request was successful |
| data.contact_id | string | HubSpot contact ID |
| data.properties | object | Contact properties (firstname, lastname, email, etc.) |
| data.created_at | string | ISO 8601 timestamp of contact creation |
| data.updated_at | string | ISO 8601 timestamp of last update |
| data.archived | boolean | Whether the contact is archived |
| data.associations | object | Associated deals and companies (if requested) |

---

### 2. get_contact_deals
**Description**: Get all deals associated with a specific contact

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/crm/v3/objects/contacts/{contact_id}/associations/deals` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| contact_id | string | Yes | The ID of the contact |
| limit | number | No | Maximum deals to retrieve (default: 50, max: 100) |
| include_deal_details | boolean | No | Include full deal properties (default: true) |
| deal_properties | array | No | Specific deal properties to retrieve |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the request was successful |
| data.contact_id | string | HubSpot contact ID |
| data.deals | array | Array of associated deals |
| data.deals[].deal_id | string | Deal ID |
| data.deals[].deal_name | string | Deal name |
| data.deals[].amount | string | Deal amount |
| data.deals[].stage | string | Deal stage |
| data.deals[].close_date | string | Expected close date |
| data.deals[].pipeline | string | Pipeline identifier |
| data.deals[].owner_id | string | HubSpot owner ID |
| data.total_count | integer | Number of deals |
| data.total_deal_value | number | Sum of all deal amounts |

---

### 3. get_contact_activities
**Description**: Retrieve recent activities and engagement history for a contact

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/crm/v3/objects/contacts/{contact_id}/associations/{activity_type}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| contact_id | string | Yes | The ID of the contact |
| activity_types | array | No | Types: calls, emails, notes, meetings, tasks (default: all) |
| limit | number | No | Max activities per type (default: 25, max: 100) |
| since_date | string | No | Only retrieve activities after this date (ISO 8601 format) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the request was successful |
| data.contact_id | string | HubSpot contact ID |
| data.activities | array | Array of activities sorted by date (newest first) |
| data.activities[].activity_id | string | Activity ID |
| data.activities[].type | string | Activity type (calls, emails, notes, meetings, tasks) |
| data.activities[].timestamp | string | Activity timestamp |
| data.activities[].title | string | Activity title/subject |
| data.activities[].body | string | Activity content/description |
| data.total_count | integer | Total number of activities |
| data.counts_by_type | object | Activity counts grouped by type |

---

### 4. search_contacts
**Description**: Search for contacts using filters and query terms

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/crm/v3/objects/contacts/search` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | No | Search query term (searches name, email, company) |
| filters | object | No | Property filters as key-value pairs |
| limit | number | No | Maximum contacts to return (default: 25, max: 100) |
| properties | array | No | Specific properties to retrieve for each contact |
| sort_by | string | No | Property to sort by (e.g., 'createdate', 'lastmodifieddate') |
| sort_direction | string | No | 'ASCENDING' or 'DESCENDING' (default: 'DESCENDING') |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the request was successful |
| data.contacts | array | Array of matching contacts |
| data.contacts[].contact_id | string | HubSpot contact ID |
| data.contacts[].properties | object | Contact properties |
| data.contacts[].created_at | string | Contact creation timestamp |
| data.contacts[].updated_at | string | Last update timestamp |
| data.total_count | integer | Number of contacts returned |
| data.has_more | boolean | Whether more results are available |

---

### 5. get_deal
**Description**: Get detailed information about a specific deal

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/crm/v3/objects/deals/{deal_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| deal_id | string | Yes | The ID of the deal to retrieve |
| properties | array | No | Specific deal properties to retrieve |
| include_associations | boolean | No | Include associated contacts and companies (default: true) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Whether the request was successful |
| data.deal_id | string | HubSpot deal ID |
| data.properties | object | Deal properties (dealname, amount, dealstage, etc.) |
| data.created_at | string | Deal creation timestamp |
| data.updated_at | string | Last update timestamp |
| data.archived | boolean | Whether the deal is archived |
| data.associations | object | Associated contacts and companies |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/hubspot-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/hubspot-plugin-executor.ts` | Executor class implementing all HubSpot actions |

---

## Environment Variables

```bash
HUBSPOT_CLIENT_ID=your_hubspot_client_id_here
HUBSPOT_CLIENT_SECRET=your_hubspot_client_secret_here
```

To obtain credentials:
1. Go to https://developers.hubspot.com/
2. Create a new app in your HubSpot developer account
3. Configure OAuth settings with required scopes
4. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/hubspot`
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: get_contact, get_contact_deals, get_contact_activities, search_contacts, get_deal |
