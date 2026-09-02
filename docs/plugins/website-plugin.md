# Website Plugin - User Documentation

> **Last Updated**: 2026-08-10

## Overview

The Website plugin manages your **internal Business OS website** — your pages, their section blocks, publishing, and view analytics — from your AgentPilot automations and the AI assistant. Like the other Business OS plugins, it is **internal**: it reads and writes your own AgentPilot website data, with nothing to connect.

v1 is a **focused management surface** — list/create/update pages, publish or unpublish them, list and toggle a page's blocks, edit a block's content, and read view analytics. Deeper editor operations (drag-to-reorder, bulk block creation, domain setup, template application) stay in the website builder UI.

---

## Connection

**No connection required.** Built-in internal capability — no OAuth, no token. Available to any **active Business OS account** (checked server-side via `db_active`; a non-tenant gets `access_denied`). Every operation is scoped to your own account.

### Where it appears (visibility)

`visibility: business_os` — **hidden by default from the general plugin catalog**, but fully resolvable/executable by key for Business OS surfaces, the AI assistant, and automations. See [PLUGIN_VISIBILITY_SCOPING.md](/docs/PLUGIN_VISIBILITY_SCOPING.md).

---

## Available Actions

### Pages

| Action | Purpose |
|---|---|
| `list_pages` | List your website pages. |
| `get_page` | Fetch one page by `id`. |
| `create_page` | Create a page (title, slug, type, SEO/theme fields). |
| `update_page` | Edit a page's editable fields. |
| `publish_page` | Publish a page (status → `live`). |
| `unpublish_page` | Unpublish a page (back to draft). |

### Blocks

| Action | Purpose |
|---|---|
| `list_blocks` | List the section blocks on one of your pages. |
| `toggle_block` | Show/hide a block (`enabled`). |
| `update_block_content` | Update a block's content (merged into existing content). |

### Analytics

| Action | Purpose |
|---|---|
| `get_analytics_summary` | View-count summary for your site (optionally by subdomain). |
| `get_page_analytics` | View summary for a single page. |

---

## Ownership & isolation

Website **blocks** don't carry an owner column of their own — a block belongs to whoever owns its parent page. Every block operation (`list_blocks`, `toggle_block`, `update_block_content`) therefore **verifies that the block's page belongs to you before doing anything**, and page create/update accept only a fixed set of editable fields — so there's no way to reach or alter another account's pages or blocks. Every operation is scoped to your own account.

---

## Testing

Run Website operations from the **Modules** tab of `/test-business-os`:

1. **Overview → Account Setup → Seed Profile** to make your account an active tenant.
2. **Modules → Load modules → Website →** try `create_page` → `list_pages` → `publish_page`; then `list_blocks` for that page and `toggle_block` / `update_block_content`; and `get_analytics_summary`.

Without a seeded profile you'll get `access_denied`. See [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) § Tab: Modules.

> **Note:** the plugin registry is cached at server cold-start, so a **dev-server restart** is needed for this plugin to first appear in the Modules list.

---

## Known limitations & open items

- ⬜ **Editor-grade ops are out of v1** — drag-to-reorder blocks, bulk block creation, per-block capability wiring (`capability_config`), section-level content editing, subdomain/custom-domain setup, template application, and uploads remain in the builder UI.
- ⬜ **No page delete/archive** on the agent surface (destructive) — deletion is done in the UI.
- ⬜ **Block reorder deferred** — the reorder path depends on a database routine (`clear_block_positions`) that isn't present, so it currently runs a slow fallback; reorder is intentionally not exposed here.
- 🅿️ **Deeper ownership hardening (repo layer)** — v1 enforces block ownership in the plugin (the executor is the isolation boundary). Threading ownership into `WebsiteBlockRepository` itself (or adding a `user_id` column) is a tracked follow-up that would protect all callers, not just this plugin.
- ℹ️ **Public site rendering + booking/checkout/form-submission** are separate public endpoints, not part of this plugin.

---

## Notes

- The plugin is available to the AI assistant and the V6 agent pipeline (`domain: web`).
- `publish_page` / `unpublish_page` keep the page's publish state consistent (status + the legacy published flag).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Initial documentation | Documented the internal Website plugin: `db_active` no-connection access model, the 11 page/block/analytics operations, the block-ownership isolation model (blocks verified via their parent page; page ops use explicit field allow-lists), Modules-tab testing, and v1 known limitations (editor plumbing, reorder, delete deferred to the UI). |
