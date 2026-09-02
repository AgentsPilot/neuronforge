# Intake Plugin - User Documentation

> **Last Updated**: 2026-08-10

## Overview

The Intake plugin manages your **internal Business OS intake configuration** — which client intake form your account collects and when. Like CRM, Scheduling, and Payments, it is **internal**: it reads your own AgentPilot intake data, with nothing to connect.

Intake is a **configuration surface**, not a form builder. AgentPilot ships a **catalog of ready-made intake templates** (per business vertical — therapist, coach, consultant, etc.). You **select** one and toggle when it's collected; you don't author custom templates in v1.

---

## Connection

**No connection required.** The Intake plugin is a built-in internal capability — no OAuth, no token. Available to any **active Business OS account** (checked server-side via the `db_active` strategy each time an action runs; a non-tenant account gets `access_denied`). Your settings are scoped to your own account.

### Where it appears (visibility)

Intake is a **Business-OS-only** internal module: **hidden by default from the general plugin catalog** (`visibility: business_os`), but fully **resolvable and executable by key** for Business OS surfaces, the AI assistant, and automations. See [PLUGIN_VISIBILITY_SCOPING.md](/docs/PLUGIN_VISIBILITY_SCOPING.md).

---

## Available Actions

| Action | Purpose |
|---|---|
| `list_intake_templates` | List the intake form templates available for your business vertical (plus the generic set). The vertical is resolved from your business profile — not passed in. |
| `get_intake_template` | Fetch one template by `id` (its fields, labels, and options). |
| `get_intake_settings` | Get your current intake settings (which template is active, whether collection is enabled, and when). Returns sensible **disabled defaults** if you haven't configured intake yet. |
| `update_intake_settings` | Update your intake settings — `template_id`, `is_enabled`, `collect_during_booking`, `send_after_booking`. A supplied `template_id` is validated to exist first. |

---

## How it fits together

- **Templates** are a **global, read-only catalog** (seed-managed) grouped by vertical — every account sees the same catalog for its vertical. There is no `user_id` on templates.
- **Settings** are **one row per account** — you pick a template and decide when the form is collected (during booking and/or sent after booking). Booking *responses* to the form are stored on the booking itself and are handled by the Scheduling side, not this plugin.

---

## Testing

Run Intake operations interactively from the **Modules** tab of `/test-business-os`:

1. **Overview → Account Setup → Seed Profile** to make your account an active tenant (also sets the vertical used for template listing).
2. **Modules → Load modules → Intake →** try `get_intake_settings` (see the synthesized defaults), `list_intake_templates` (your vertical's templates), then `update_intake_settings` with a valid `template_id` + `is_enabled: true` and re-run `get_intake_settings` to confirm it persisted.

Without a seeded profile you'll get `access_denied`. See [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) § Tab: Modules.

> **Note:** the plugin registry is cached at server cold-start, so a **dev-server restart** is needed for this plugin to first appear in the Modules list.

---

## Known limitations & open items

- ℹ️ **No template authoring in v1** — you select from the seeded catalog and toggle settings; creating/editing custom templates is a future, larger scope.
- ℹ️ **Booking responses are out of scope** — a client's *answers* to the intake form live on the booking (`scheduling_bookings.intake_responses`) and are handled by the Scheduling flow, not this plugin.
- ℹ️ **`update_intake_settings` returns the bare settings row** (no joined template object) — a caller needing the full template should follow with `get_intake_settings` / `get_intake_template`.
- 🅿️ **Public form-submission path is separate** — the website intake form-submission endpoint (which writes CRM contacts/activities) is a public leaf tracked under CRM `task_dda5f400`, not this plugin.

---

## Notes

- Every settings action is automatically scoped to your own account; a caller-supplied `user_id` is ignored (settings always apply to the authenticated account).
- The plugin is available to the AI assistant and the V6 agent pipeline (`domain: crm`).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Initial documentation | Documented the internal Intake plugin: `db_active` no-connection access model, the 4 template/settings config operations, the select-don't-author model, Modules-tab testing, and v1 known limitations (no template authoring; booking responses handled by Scheduling). |
