# Google Calendar Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: Communication
**Last Updated**: 2025-11-30

---

## Overview

Manage events, meetings, and schedules in Google Calendar. Use for fetching calendar events, creating meetings, scheduling appointments, setting reminders, managing attendees, and organizing time-based activities for agents.

---

## Research Sources

### OAuth Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OAuth 2.0 Setup | https://developers.google.com/identity/protocols/oauth2 | Google-style OAuth 2.0 with refresh token support |
| Authorization Endpoint | https://accounts.google.com/o/oauth2/v2/auth | Google authorization URL |
| Token Endpoint | https://oauth2.googleapis.com/token | Token exchange and refresh endpoint |
| Scopes Reference | https://developers.google.com/calendar/api/auth | Required scopes for calendar access |

### API Documentation
| Information | URL | Summary |
|-------------|-----|---------|
| Calendar API Overview | https://developers.google.com/calendar/api/v3/reference | REST API for Google Calendar operations |
| Events Resource | https://developers.google.com/calendar/api/v3/reference/events | CRUD operations for calendar events |
| Rate Limits | https://developers.google.com/calendar/api/guides/quota | API quota and rate limits |

---

## High-Level Decisions

- **OAuth Flow**: Google-style OAuth 2.0 with openid, email, profile scopes plus calendar-specific scopes
- **Required Scopes**: openid, email, profile, calendar, calendar.events
- **Max Attendees**: 100 attendees per event
- **Max Events Fetch**: 2500 events per request
- **Conference Support**: Google Meet link generation available via `hangoutsMeet`

---

## Actions

### 1. list_events
**Description**: List calendar events within a specified time range

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/calendar/v3/calendars/{calendar_id}/events` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| calendar_id | string | No | Calendar identifier (default: 'primary') |
| time_min | string | Yes | Start of time range (ISO 8601 format) |
| time_max | string | No | End of time range (ISO 8601 format) |
| max_results | number | No | Maximum events to return (default: 50, max: 2500) |
| single_events | boolean | No | Expand recurring events into instances (default: true) |
| order_by | string | No | Order by: startTime or updated (default: startTime) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| calendar_id | string | The calendar identifier that was queried |
| event_count | integer | Number of events returned |
| events | array | List of calendar events |
| events[].id | string | Unique event identifier |
| events[].summary | string | Event title/summary |
| events[].description | string | Event description |
| events[].location | string | Event location |
| events[].start | string | Event start time (ISO 8601) |
| events[].end | string | Event end time (ISO 8601) |
| events[].attendees | array | List of event attendees |
| events[].organizer | string | Organizer email address |
| events[].html_link | string | URL to view event in Google Calendar |
| events[].conference_data | object | Conference/meeting data if present |
| time_range | object | The time range that was queried |
| retrieved_at | string | Timestamp when events were retrieved |

---

### 2. create_event
**Description**: Create a new calendar event or meeting

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/calendar/v3/calendars/{calendar_id}/events` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| calendar_id | string | No | Calendar identifier (default: 'primary') |
| summary | string | Yes | Event title/summary |
| description | string | No | Event description or notes |
| location | string | No | Event location |
| start_time | string | Yes | Event start time (ISO 8601 format) |
| end_time | string | Yes | Event end time (ISO 8601 format) |
| attendees | array | No | List of attendee email addresses |
| reminders | object | No | Reminder settings |
| send_notifications | boolean | No | Send email notifications to attendees (default: true) |
| conference_solution | string | No | Generate Google Meet link: 'hangoutsMeet' or 'none' |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| event_id | string | Unique identifier for the created event |
| summary | string | Event title/summary |
| start_time | string | Event start time (ISO 8601) |
| end_time | string | Event end time (ISO 8601) |
| html_link | string | URL to view event in Google Calendar |
| hangout_link | string | Google Hangout link if conference was created |
| meet_link | string | Google Meet video call link if conference was created |
| attendee_count | integer | Number of attendees added |
| created_at | string | Timestamp when event was created |

---

### 3. update_event
**Description**: Update an existing calendar event

| Property | Value |
|----------|-------|
| HTTP Method | PATCH |
| Endpoint | `/calendar/v3/calendars/{calendar_id}/events/{event_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| calendar_id | string | No | Calendar identifier (default: 'primary') |
| event_id | string | Yes | ID of the event to update |
| summary | string | No | New event title/summary |
| description | string | No | New event description |
| location | string | No | New event location |
| start_time | string | No | New start time (ISO 8601 format) |
| end_time | string | No | New end time (ISO 8601 format) |
| attendees | array | No | Updated list of attendee email addresses |
| send_notifications | boolean | No | Send email notifications about the update (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| event_id | string | Unique identifier of the updated event |
| summary | string | Updated event title/summary |
| start_time | string | Event start time (ISO 8601) |
| end_time | string | Event end time (ISO 8601) |
| html_link | string | URL to view event in Google Calendar |
| updated_at | string | Timestamp when event was updated |

---

### 4. delete_event
**Description**: Delete a calendar event

| Property | Value |
|----------|-------|
| HTTP Method | DELETE |
| Endpoint | `/calendar/v3/calendars/{calendar_id}/events/{event_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| calendar_id | string | No | Calendar identifier (default: 'primary') |
| event_id | string | Yes | ID of the event to delete |
| send_notifications | boolean | No | Send cancellation notifications to attendees (default: false) |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| event_id | string | ID of the deleted event |
| deleted | boolean | Whether the event was successfully deleted |
| deleted_at | string | Timestamp when event was deleted |

---

### 5. get_event_details
**Description**: Get detailed information about a specific calendar event

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/calendar/v3/calendars/{calendar_id}/events/{event_id}` |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| calendar_id | string | No | Calendar identifier (default: 'primary') |
| event_id | string | Yes | ID of the event to retrieve |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| event_id | string | Unique event identifier |
| summary | string | Event title/summary |
| description | string | Event description |
| location | string | Event location |
| start | string | Event start time (ISO 8601) |
| end | string | Event end time (ISO 8601) |
| attendees | array | List of event attendees with details |
| attendees[].email | string | Attendee email address |
| attendees[].display_name | string | Attendee display name |
| attendees[].organizer | boolean | Whether attendee is the organizer |
| attendees[].response_status | string | Response status (needsAction, declined, tentative, accepted) |
| attendees[].optional | boolean | Whether attendee is optional |
| organizer | object | Event organizer information |
| reminders | object | Event reminder settings |
| html_link | string | URL to view event in Google Calendar |
| hangout_link | string | Google Hangout link if present |
| meet_link | string | Google Meet video call link if present |
| status | string | Event status (confirmed, tentative, cancelled) |
| created | string | When the event was created |
| updated | string | When the event was last updated |
| retrieved_at | string | Timestamp when details were retrieved |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/google-calendar-plugin-v2.json` | Plugin definition with OAuth config, actions, and schemas |
| `lib/server/google-calendar-plugin-executor.ts` | Executor class implementing all Google Calendar actions |

---

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

To obtain credentials:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID
3. Set redirect URI: `${NEXT_PUBLIC_APP_URL}/oauth/callback/google-calendar`
4. Enable the Google Calendar API in your project
5. Copy Client ID and Client Secret

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: list_events, create_event, update_event, delete_event, get_event_details |
