# Activity: a contact is created

> **Last Updated**: 2026-09-02
> **Status**: ⬜ Open
> **Area**: `app/api/crm/contacts/route.ts`

## Context

The timeline starts mid-story. Every edit to a contact is recorded, but not the moment they first appeared or where they came from — so the earliest thing in a client's history is a change to a record whose creation is invisible.

The drawer is already ready: `contact_created` has an icon, a filter (`changes`), and `translateDescription` even parses a `{ source, stage }` JSON shape for it. Nothing writes it.

## Work

- `activity_type: 'contact_created'` on successful creation
- `title` via `activitySentence` in **the business's language**
- `description`: `{ kind: 'contact_created', source, stage }`
- non-blocking, `source_capability: 'crm'`, `source_entity_id` = the contact

## UI

- sentence in `activityText.ts` for en/es/he
- already has an icon and sits under the **changes** filter — confirm, do not duplicate
- drill-down: source and stage, translated via the existing `crm.source.*` / `crm.stage.*` keys

## Verification

1. Create a contact from the CRM and from a website form; both record a row.
2. The row reads in the business's language and names where the contact came from.
3. It appears under **changes**.
