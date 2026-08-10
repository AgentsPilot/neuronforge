# CRM Plugin - User Documentation

> **Last Updated**: 2026-08-09

## Overview

The CRM plugin manages your **internal Business OS CRM** — contacts, tasks, activities, and pipeline stages — directly from your AgentPilot automations and the AI assistant. Unlike integrations such as Gmail or Stripe, the CRM plugin is **internal**: it reads and writes your own AgentPilot CRM data, so there is nothing to connect and no external account to authorize.

Use it to create and find contacts, move them through your pipeline, add and complete follow-up tasks, log activities on a contact's timeline, and read your pipeline stages.

---

## Connection

**No connection required.** The CRM plugin is a built-in internal capability — there is no OAuth login and no token to manage.

It is available to any **active Business OS account** (an account that has completed initial setup and has a business profile). Access is checked automatically on the server each time an action runs; if an account is not an active Business OS tenant, the action returns an `access_denied` result. Every operation is automatically scoped to your own account's data.

### Where it appears (visibility)

CRM is a **Business-OS-only** internal module: it is **hidden by default from the general plugin catalog** (Settings → Connected Apps, the agent-builder capability hints, and the V6 binder) — its `visibility` is `business_os`. It remains fully **resolvable and executable by key** for Business OS surfaces, the AI assistant, and automations. Promoting CRM platform-wide later is a one-line change (`visibility: public`). See [PLUGIN_VISIBILITY_SCOPING.md](/docs/PLUGIN_VISIBILITY_SCOPING.md).

---

## Available Actions

All actions operate only on the current account's CRM data.

### Contacts

#### `create_contact`
Create a new contact.

**Parameters:** `first_name`, `last_name`, `email`, `phone`, `stage` (pipeline stage key; defaults to `lead`), `tags` (array), `custom_fields` (object), `source` (e.g. `manual`, `website_form`, `booking`) — all optional.

**Returns:** the created contact (`id`, name, email, phone, `stage`, `tags`, `source`, `created_at`).

> A `contact_created` activity is logged **automatically** — do not also call `log_activity` for it (see [Automatic activities](#automatic-activities)).

**Example use cases:**
- "Add a new lead named Dana Levi with email dana@example.com"
- "Create a contact from this website form submission"

#### `get_contact`
Fetch one contact by id. **Parameters:** `id` (required). **Returns:** the full contact record.

#### `list_contacts`
List / search / filter contacts. **Parameters:** `stage`, `tags`, `search` (matches name, email, phone), `limit`, `offset`, `order_by` (`created_at` | `updated_at` | `first_name` | `last_name`), `order_direction` (`asc` | `desc`). **Returns:** an array of contacts.

**Example:** "Show my leads added this month, newest first."

#### `count_contacts`
Count contacts, optionally filtered by `stage`, `tags`, or `search`. **Returns:** a number.

#### `update_contact`
Edit contact fields. **Parameters:** `id` (required) plus any of `first_name`, `last_name`, `email`, `phone`, `stage`, `tags`, `custom_fields`. To change only the pipeline stage, prefer `move_stage`.

#### `move_stage`
Move a contact to a different pipeline stage. **Parameters:** `id` (required), `stage` (required, a pipeline stage key), `validate_stage` (optional, default `false` — when `true`, rejects a stage that isn't one of your configured pipeline stages).

**Example:** "Move Dana Levi to the active client stage."

#### `delete_contact`
Permanently delete a contact. **Parameters:** `id` (required). This is a hard delete.

### Tasks

#### `add_task`
Create a follow-up task, optionally linked to a contact. **Parameters:** `title` (required), `description`, `contact_id`, `priority` (`low` | `medium` | `high` | `urgent`, default `medium`), `status` (`pending` | `in_progress` | `completed` | `cancelled`, default `pending`), `due_date`, `reminder_at`, `tags`.

**Example:** "Remind me to call Dana next Tuesday — high priority."

#### `get_task`
Fetch one task by id. **Parameters:** `id` (required).

#### `list_tasks`
List / filter tasks. **Parameters:** `contact_id`, `status`, `priority`, `due_before`, `due_after`, `include_completed` (default `false`), `search`, `limit`, `offset`, `order_by` (`due_date` | `created_at` | `priority`), `order_direction`.

#### `count_tasks`
Count tasks grouped by status, optionally for one contact (`contact_id`). **Returns:** counts for `pending`, `in_progress`, `completed`, `cancelled`.

#### `update_task`
Edit a task. **Parameters:** `id` (required) plus any of `title`, `description`, `priority`, `status`, `due_date`, `reminder_at`, `contact_id`, `tags`.

#### `complete_task`
Mark a task completed. **Parameters:** `id` (required).

#### `delete_task`
Permanently delete a task. **Parameters:** `id` (required).

### Activities

#### `log_activity`
Log a manual activity (note, call, meeting, …) on a contact's timeline. **Parameters:** `contact_id` (required), `activity_type` (required, e.g. `note`, `call`, `meeting`), `title` (required), `description`, `source_capability` (defaults to `manual`), `source_entity_id`, `activity_date` (defaults to now).

**Example:** "Log a call with Dana: discussed the proposal, following up Friday."

> `log_activity` is the **only** action that writes an activity. Contact-created, booking, payment, and email activities are logged automatically (see below).

#### `list_activities`
List a contact's activities, most recent first. **Parameters:** `contact_id` (required), `limit` (default 50).

### Pipeline

#### `list_pipeline_stages`
List your account's configured pipeline stages, ordered by position. **Returns:** an array of stages (`id`, `stage_key`, `stage_label`, `position`, `color`). Useful before `move_stage` or for rendering a pipeline.

---

## Automatic activities

Some contact-timeline activities are created **automatically** by the system whenever the underlying event happens — you do **not** log them yourself:

| Event | Auto-logged activity |
|---|---|
| A contact is created (`create_contact`) | `contact_created` |
| A booking is made for a contact | booking activity |
| A payment succeeds for a contact | payment activity |
| An automated email is sent to a contact | email activity |

`log_activity` is only for **manual** entries (notes, calls, meetings). Creating or updating a contact never double-logs — the automatic activity is the single source for those events.

---

## Testing

Run CRM operations interactively from the **Modules** tab of the internal `/test-business-os` page (session-based, so operations run as your logged-in account):

1. On the **Overview** tab, use **Account Setup** → **Seed Profile** to make your account an active tenant (creates a `business_profiles` row + seeds pipeline stages).
2. Go to **Modules** → **Load modules** → select **CRM** → pick an operation → fill the auto-generated form → **Run**.

Without a seeded profile you'll get `access_denied` (the `db_active` guard). See [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) § Tab: Modules.

---

## Known limitations & open items

- ⬜ **Website forms / intake still write phantom columns** (tracked as `task_dda5f400`) — the public website form-submission path writes `crm_contacts` / `crm_activities` fields that don't exist in the schema, pending a data-model decision. This is a **website-route** concern outside the CRM plugin itself; the booking-route portion was already closed by the Scheduling work.
- ⬜ **Read dashboards not yet repo-routed** — aggregate CRM reads behind `app/api/business-os/{stats,my-day}` are a fast-follow (CRM workplan item 1.2.c).
- ℹ️ **`company` is stored in `custom_fields`** — `crm_contacts` has no dedicated `company` column; the AI assistant stores a supplied company name under `custom_fields.company`.
- ℹ️ **Hard deletes** — `delete_contact` / `delete_task` are permanent (no soft-delete / restore).

---

## Notes

- Every action is automatically scoped to your own account — you can only read and write your own CRM data.
- `delete_contact` and `delete_task` are permanent (hard delete). `list_*` results are paginated (`limit` / `offset`).
- The plugin is also available to the AI assistant and the V6 agent pipeline, so automations can create contacts, add tasks, and log activities as workflow steps.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-06 | Initial documentation | Documented the internal CRM plugin: no-connection (`db_active`) access model, the 17 contact/task/activity/pipeline operations, and the automatically-logged activities. |
| 2026-08-09 | Visibility + testing | Added the "Where it appears (visibility)" note (`visibility: business_os` — hidden from the general plugin catalog, runnable by key) and a "Testing" section pointing to the `/test-business-os` Modules tab. |
