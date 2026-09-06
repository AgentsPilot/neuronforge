# Activity: a document is uploaded

> **Last Updated**: 2026-09-02
> **Status**: ⬜ Open
> **Area**: `app/api/crm/contacts/[id]/documents/route.ts`

## Context

Files attached to a contact leave no mark on the timeline. `document_uploaded` already has an icon, a **files** filter, and a `{ document_type, file_name }` JSON format that `translateDescription` knows how to render — the writer was simply never built.

## Work

- `activity_type: 'document_uploaded'` after a successful upload
- `title` via `activitySentence` in **the business's language**
- `description`: `{ kind: 'document_uploaded', document_type, file_name }`
- non-blocking, `source_capability: 'crm'`, `source_entity_id` = the document

## UI

- sentence in `activityText.ts` for en/es/he
- icon and **files** filter already exist — confirm, do not duplicate
- drill-down: document type and file name

## Verification

1. Upload a file to a contact; a row appears, in the business's language.
2. It is reachable under the files chip.
3. It expands to show the type and the file name.
4. Deleting the document does not break the row.
