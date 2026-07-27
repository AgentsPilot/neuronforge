# Google Calendar Plugin Documentation

**Plugin Version**: 1.2.0
**Category**: Communication
**Last Updated**: 2026-07-27

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
| HTTP Method | GET (fetch existing) + PUT (write merged event) |
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

### 6. get_free_busy
**Description**: Query busy/free intervals across one or more calendars over a time window (availability primitive)

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/calendar/v3/freeBusy` |
| Idempotent | Yes (read-only) |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| calendar_ids | array\<string\> | No | Calendar identifier(s) to query (default: `["primary"]`; at most 50 per query) |
| time_min | string | Yes | Start of the availability window (RFC3339/ISO 8601, e.g. `2026-03-27T00:00:00Z`) |
| time_max | string | Yes | End of the availability window (RFC3339/ISO 8601); must be strictly after `time_min` |
| time_zone | string | No | IANA time zone used to interpret the response (default: `UTC`) |

**Behavior & guarantees**:
- **Privacy-safe**: returns only busy `start`/`end` intervals — never event titles, attendees, descriptions, or any other event detail. The executor copies solely `start`/`end` and never enriches a busy block with a secondary lookup.
- **Partial success**: the `freebusy.query` response may carry per-calendar `errors` (e.g. `notFound`) inside an HTTP 200. Those are surfaced per calendar (in `calendars[].errors`) and do **not** fail the action — other calendars still return their busy intervals. Only a top-level HTTP failure fails the action.
- **Pre-fetch guards**: rejects a request where `time_min`/`time_max` are missing or not valid RFC3339, or where the window is inverted/degenerate (`time_min >= time_max`), before any network call. Requests over 50 calendars are rejected before the call (Google's `calendarExpansionMax`).

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| calendars | array | Per-calendar availability |
| calendars[].calendar_id | string | Calendar these intervals belong to |
| calendars[].busy | array | Busy intervals (`{ start, end }` only) within the window |
| calendars[].busy[].start | string | Busy interval start (RFC3339/ISO 8601) |
| calendars[].busy[].end | string | Busy interval end (RFC3339/ISO 8601) |
| calendars[].errors | array | Per-calendar errors (present only on partial failure, e.g. `notFound`) |
| time_min | string | Start of the queried window (echoed) |
| time_max | string | End of the queried window (echoed) |
| time_zone | string | Time zone used to interpret the response (echoed) |
| queried_at | string | Timestamp when the free/busy query ran (ISO 8601) |

---

### 7. list_calendars
**Description**: List the user's calendars (calendar list)

| Property | Value |
|----------|-------|
| HTTP Method | GET |
| Endpoint | `/calendar/v3/users/me/calendarList` |
| Idempotent | Yes (read-only) |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| min_access_role | string | No | Only return calendars where the user has at least this access role. One of `freeBusyReader`, `reader`, `writer`, `owner`. Omit to return all calendars. |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| calendars | array | The user's calendars |
| calendars[].id | string | Calendar identifier (use as `calendar_id` in other actions) |
| calendars[].summary | string | Calendar name/title |
| calendars[].description | string | Calendar description |
| calendars[].time_zone | string | Calendar time zone (IANA) |
| calendars[].primary | boolean | Whether this is the user's primary calendar |
| calendars[].access_role | string | The user's access role (freeBusyReader, reader, writer, owner) |
| total_found | integer | Number of calendars returned |
| listed_at | string | Timestamp when calendars were listed (ISO 8601) |

> **Note**: this is the `list_calendars` **action** (returns the schema-shaped payload above). It is distinct from the internal `list_calendars` dropdown-options fetcher used to populate `calendar_id`/`calendar_ids` dropdowns, which returns `{ value, label, ... }` option objects and is not an agent-invokable action.

---

### 8. list_available_slots
**Description**: Compute open, bookable time slots by subtracting busy intervals (plus optional buffer and a minimum-notice floor) from working-hours windows, then slicing the free time into fixed-length slots.

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | `/calendar/v3/freeBusy` (the slot arithmetic runs in the executor, not via the API) |
| Idempotent | Yes (read-only computation) |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| range_start | string | Yes | Start of the overall search window (RFC3339/ISO 8601, e.g. `2026-08-01T00:00:00Z`) |
| range_end | string | Yes | End of the search window (RFC3339/ISO 8601); must be strictly after `range_start`, and the window must not exceed 92 days |
| slot_duration_minutes | number | Yes | Length of each bookable slot in minutes (positive integer, e.g. 30) |
| working_hours | object | Yes | Availability windows + IANA `time_zone` (see shape below). `time_zone` is required — there is no silent UTC default |
| calendar_ids | array\<string\> | No | Calendars whose busy blocks make a slot unavailable (default: `["primary"]`; at most 50 per query) |
| buffer_minutes | number | No | Padding (minutes) around **each busy block on both sides** before subtracting — a gap required before/after existing meetings (default: 0) |
| min_notice_minutes | number | No | Earliest bookable time relative to now, in minutes (e.g. 120 = no slots within the next 2 hours; default: 0) |
| max_slots | number | No | Maximum slots to return, chronological/earliest-first (default: 500) |

**`working_hours` shape**:
```json
{
  "time_zone": "America/New_York",
  "windows": [
    { "days": ["monday", "tuesday", "wednesday", "thursday", "friday"], "start": "09:00", "end": "17:00" }
  ]
}
```
- `time_zone` — IANA zone that interprets every window `start`/`end` (wall-clock `HH:MM`, 24-hour) and the day boundaries. Required.
- `windows[]` — each rule lists lowercase weekday `days` + a `start`/`end` wall-clock window. A weekday not covered by any window is unavailable. Multiple windows may share a day to express intra-day breaks (e.g. a lunch break = one `09:00–12:00` + one `13:00–17:00` window on the same day); same-day windows are unioned before slicing.

**Behavior & semantics**:
- **In-executor slot math (deterministic)**: the action queries busy intervals (`freebusy.query`) and computes availability in TypeScript — it is one self-contained, unit-tested capability, not a freebusy call plus a natural-language transform.
- **`buffer_minutes` semantic**: padding is applied around busy blocks on **both** sides (before/after meetings). It does **not** insert gaps between adjacent free slots — slots within a free window remain back-to-back.
- **Output time zone**: slots are emitted as **UTC `Z`** RFC3339 instants (unambiguous across boundaries); the working-hours `time_zone` is echoed so a caller can render locally. DST is handled per-instant (wall-clock→UTC conversion resolves the offset at each date, so spring-forward/fall-back days are correct).
- **Boundary-safe slicing**: a slot is emitted only when it fully fits the free run (`slotStart + duration ≤ runEnd`) — no partial slot at a window/busy boundary.
- **Reports availability, does not reserve**: this action books nothing and holds nothing. A returned slot is **not** reserved and could be taken before an event is created (authoritative double-booking prevention is out of scope for this action).
- **Privacy-safe**: the busy intervals used internally are `start`/`end` only (via the shared freebusy fetch) and are never surfaced — the output is only computed free `{ start, end }` slots.
- **Pre-fetch guards** (reject before any network call): missing/invalid RFC3339 range; `range_end ≤ range_start`; window span > 92 days; `slot_duration_minutes` not a positive integer; missing/invalid `working_hours.time_zone`; empty/invalid windows; > 50 calendars; negative `buffer_minutes`/`min_notice_minutes`/`max_slots`.

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| slots | array | Open bookable slots (chronological, earliest first). Each item is `{ start, end }` as UTC `Z` instants — annotated `x-semantic-type: "time_slot"` |
| slots[].start | string | Slot start (RFC3339 UTC `Z` instant) |
| slots[].end | string | Slot end (RFC3339 UTC `Z` instant) |
| slot_count | integer | Number of slots returned (`slots.length`) |
| range_start | string | Start of the search window (echoed) |
| range_end | string | End of the search window (echoed) |
| time_zone | string | IANA time zone from `working_hours` (echoed) |
| slot_duration_minutes | integer | Slot length in minutes (echoed) |
| computed_at | string | Timestamp when availability was computed (ISO 8601) |

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
| 1.2.0 | 2026-07-27 | Added `list_available_slots` (Phase 2): one self-contained, read-only, in-executor slot-computation action over `freebusy.query`. Computes bookable slots by subtracting busy intervals (+ `buffer_minutes` padding around busy blocks and a `min_notice_minutes` floor) from timezone-aware `working_hours` windows, then slicing into fixed-length slots. Emits UTC `Z` slots annotated with the new `time_slot` V6 semantic type. DST-correct wall-clock→UTC conversion via built-in `Intl` (no new dependency). The slot math lives in a pure, unit-tested `lib/server/calendar-slot-math.ts` module; the shared `fetchBusyIntervals` freebusy helper is reused by both `get_free_busy` and `list_available_slots`. |
| 1.1.0 | 2026-07-27 | Added 2 read-only availability actions: `get_free_busy` (freebusy.query — per-calendar busy intervals, privacy-safe start/end only, partial-success on per-calendar errors) and `list_calendars` (calendarList.list). Corrected the `update_event` HTTP-method row (GET + PUT, not PATCH). |
| 1.0.0 | 2025-11-30 | Initial plugin with 5 actions: list_events, create_event, update_event, delete_event, get_event_details |
