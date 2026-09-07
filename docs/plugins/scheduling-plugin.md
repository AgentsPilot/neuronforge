# Scheduling Plugin - User Documentation

> **Last Updated**: 2026-08-10

## Overview

The Scheduling plugin manages your **internal Business OS scheduling** — bookable services and client appointments (bookings) — directly from your AgentPilot automations and the AI assistant. Like CRM, it is **internal**: it reads and writes your own AgentPilot scheduling data, so there is nothing to connect and no external account to authorize.

Use it to define the services clients can book, create and manage bookings, reschedule or cancel appointments, mark attendance (completed / no-show), and check available time slots.

---

## Connection

**No connection required.** The Scheduling plugin is a built-in internal capability — there is no OAuth login and no token to manage.

It is available to any **active Business OS account** (one that has completed initial setup and has a business profile). Access is checked automatically on the server each time an action runs (the `db_active` strategy); if an account is not an active Business OS tenant, the action returns an `access_denied` result. Every operation is automatically scoped to your own account's data.

### Where it appears (visibility)

Scheduling is a **Business-OS-only** internal module: it is **hidden by default from the general plugin catalog** (Settings → Connected Apps, the agent-builder capability hints, and the V6 binder) — its `visibility` is `business_os`. It remains fully **resolvable and executable by key** for Business OS surfaces, the AI assistant, and automations. See [PLUGIN_VISIBILITY_SCOPING.md](/docs/PLUGIN_VISIBILITY_SCOPING.md).

---

## Available Actions

All actions operate only on the current account's scheduling data.

### Services

| Action | Purpose |
|---|---|
| `create_service` | Create a bookable service (name, duration, price, buffer, etc.). |
| `list_services` | List / filter your services. |
| `get_service` | Fetch one service by `id`. |
| `update_service` | Edit service fields. |
| `publish_service` | Move a `draft` service to `active` (bookable). |
| `delete_service` | Delete a service (hard delete). |

### Bookings

| Action | Purpose |
|---|---|
| `create_booking` | Book an appointment for a client on a service. Checks for time-slot conflicts before creating. |
| `list_bookings` | List / filter bookings (by service, contact, status, date range). |
| `get_booking` | Fetch one booking by `id`. |
| `update_booking` | Edit booking fields. |
| `cancel_booking` | Cancel a booking (status → `cancelled`). |
| `complete_booking` | Mark a booking `completed` (attended). |
| `mark_no_show` | Mark a booking `no_show`. |
| `reschedule_booking` | Move a booking to a new time — re-checks conflicts and the owner's availability window, preserving the service duration. |

### Utility

| Action | Purpose |
|---|---|
| `count_bookings` | Count bookings for a service (scoped to your account). |
| `check_availability` | Check whether a given time falls inside the owner's configured weekly availability. |

---

## Automatic activities

When a booking is made or its status changes, the system updates your CRM **automatically** via database triggers — the executor does **not** re-emit these (no double-logging):

| Event | Automatic side-effect |
|---|---|
| A booking is created for a known contact | The contact is linked, and a booking activity is logged on the contact's CRM timeline (trigger T1/T2). |
| A booking's status changes (cancel / complete / no-show) | A corresponding CRM activity is logged (trigger T2), **only** when the booking has a linked `contact_id`. |

> A `create_booking` with **no** linked contact correctly produces **zero** CRM activities — this is expected, not a bug.

---

## Testing

Run Scheduling operations interactively from the **Modules** tab of the internal `/test-business-os` page (session-based, so operations run as your logged-in account):

1. On the **Overview** tab, use **Account Setup → Seed Profile** to make your account an active tenant (creates a `business_profiles` row).
2. Go to **Modules** → **Load modules** → select **Scheduling** → pick an operation → fill the auto-generated form → **Run**.

Without a seeded profile you'll get `access_denied` (the `db_active` guard). See [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) § Tab: Modules.

> **Note:** the plugin registry is cached at server cold-start, so after this plugin is first added a **dev-server restart** is needed for it to appear in the Modules list.

---

## Known limitations & open items

- ⬜ **Read dashboards not yet repo-routed** (fast-follow) — the aggregate scheduling reads behind `app/api/business-os/{stats,my-day,metrics/summary}` and `cron/insight-detect` are low-risk and still read directly; they land in a later pass. (Scheduling workplan item 0.6.)
- 🅿️ **External calendar sync = leaf (out of scope for v1)** — Google/Outlook two-way sync stays behind `ExternalCalendarEventRepository` / the `calendar-sync` routes; the executor ignores a booking's `external_calendar_event_id` / sync fields. External events are treated as busy blocks when checking availability.
- 🅿️ **Public/token booking surface = leaf** — the unauthenticated website booking pages (`app/api/website/booking/*`, `app/api/book/manage/[token]/*`) are subdomain- / signed-token-scoped and cannot pass the user-scoped `db_active` gate, so they remain public leaves (not part of this plugin).
- ⬜ **`scheduling_availability_exceptions`** is an orphan table (no repository, no runtime reader) — one-off availability overrides are not yet modeled.
- ℹ️ **Timezone** — availability windows are currently evaluated against the owner's wall-clock time with a UTC assumption (a `business_profiles` timezone column is a known TODO).

---

## Notes

- Every action is automatically scoped to your own account — you can only read and write your own scheduling data.
- `delete_service` is permanent (hard delete). Bookings are cancelled/completed, not deleted.
- The plugin is also available to the AI assistant and the V6 agent pipeline (`domain: calendar`), so automations can create and manage bookings as workflow steps.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Initial documentation | Documented the internal Scheduling plugin: `db_active` no-connection access model, the 16 service/booking/utility operations, the automatic CRM booking activities (triggers T1/T2, no double-log), the Modules-tab testing flow, and v1 known limitations (read dashboards, external-calendar & public-booking leaves). |
