# Requirement: Add `modify_email` Action to Gmail Plugin

> **Date**: 2026-03-29
> **Origin**: V6 Pipeline QA — Gmail Urgency Flagging Agent (Phase E blocker)
> **Status**: Open

## Context

The V6 pipeline compiles workflows that need to mark emails as important and apply labels. Currently these operations are compiled as `plugin: "unknown"` because the Gmail plugin doesn't support them. This blocks Phase E (live execution) for any workflow involving email flagging/labeling.

## Gmail API Endpoint

Both operations use a single Gmail API endpoint:

```
POST https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/modify
```

Request body:
```json
{
  "addLabelIds": ["IMPORTANT", "Label_123"],
  "removeLabelIds": ["UNREAD"]
}
```

This means **one action** (`modify_email`) can handle all cases — mark important, apply labels, remove labels, mark read/unread.

## What to Implement

### 1. Plugin Definition

Add to `lib/plugins/definitions/google-mail-plugin-v2.json`:

```json
"modify_email": {
  "description": "Modify email labels — mark as important, apply/remove labels, mark read/unread",
  "usage_context": "When you need to mark an email as important, apply a label, remove a label, or mark as read/unread",
  "parameters": {
    "type": "object",
    "required": ["message_id"],
    "properties": {
      "message_id": {
        "type": "string",
        "description": "Gmail message ID to modify"
      },
      "add_labels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Label IDs or system labels to add (e.g. 'IMPORTANT', 'STARRED', or custom label ID)"
      },
      "remove_labels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Label IDs or system labels to remove (e.g. 'UNREAD', 'INBOX')"
      },
      "mark_important": {
        "type": "boolean",
        "description": "Shorthand: if true, adds 'IMPORTANT' label; if false, removes it"
      },
      "mark_read": {
        "type": "boolean",
        "description": "Shorthand: if true, removes 'UNREAD' label; if false, adds it"
      }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "message_id": { "type": "string", "description": "The modified message ID" },
      "labels_added": { "type": "array", "items": { "type": "string" }, "description": "Labels that were added" },
      "labels_removed": { "type": "array", "items": { "type": "string" }, "description": "Labels that were removed" }
    }
  },
  "output_guidance": {
    "success_description": "Email labels modified successfully",
    "sample_output": {
      "message_id": "msg-123",
      "labels_added": ["IMPORTANT", "Label_456"],
      "labels_removed": []
    },
    "common_errors": {
      "message_not_found": "The specified message ID does not exist",
      "label_not_found": "The specified label does not exist"
    }
  }
}
```

### 2. Executor

Add to `lib/server/gmail-plugin-executor.ts`:

- Add `case 'modify_email':` to the switch in `executeSpecificAction`
- Implement `modifyEmail(connection, parameters)` method:
  - Build `addLabelIds` array from `add_labels` param + `mark_important` shorthand (adds `"IMPORTANT"`) + `mark_read` shorthand (removes `"UNREAD"`)
  - Build `removeLabelIds` array from `remove_labels` param + inverse shorthands
  - Handle **custom label names** — need to resolve label name to label ID via `GET /users/me/labels` (Gmail API requires label IDs, not names, for custom labels like "AgentsPilot")
  - Call `POST /users/me/messages/{message_id}/modify` with the built arrays
  - Return `{ message_id, labels_added, labels_removed }`

### 3. Label Name Resolution

Important nuance:

- **System labels** (`IMPORTANT`, `STARRED`, `UNREAD`, `INBOX`, `SPAM`, `TRASH`) can be used directly as IDs
- **Custom labels** (like `"AgentsPilot"`) need to be resolved: call `GET /users/me/labels`, find the label by name, use its `id`. If not found, optionally create it via `POST /users/me/labels`
- Consider adding a helper `getOrCreateLabel(connection, labelName)` that other actions could reuse

### 4. Unit Test

Add to `tests/plugins/unit-tests/google-mail.test.ts`:

- Test with `mark_important: true` — verifies `IMPORTANT` in `addLabelIds`
- Test with `add_labels: ["Label_123"]` — verifies custom label passthrough
- Test with `mark_read: true` — verifies `UNREAD` in `removeLabelIds`
- Test error case (404 message not found)

### 5. Update Plugin Documentation

Read `docs/plugins/google-mail-plugin.md` and update it:

- Add `modify_email` to the action table
- Add parameter and response structure documentation
- Document in the change history that this action was added per this requirement (Gmail Urgency Flagging Agent — Phase E blocker, 2026-03-29)

## Acceptance Criteria

- [ ] `modify_email` action registered in plugin JSON definition and executor switch statement
- [ ] Unit tests added to `tests/plugins/unit-tests/google-mail.test.ts` covering happy path + error case, all passing
- [ ] Custom label name to ID resolution works (for labels like "AgentsPilot")
- [ ] `getOrCreateLabel` helper implemented for label name resolution
- [ ] `docs/plugins/google-mail-plugin.md` reviewed and updated: `modify_email` action added to scope, action table, and response structure sections. Reference to this requirement documented in the change history.

## Blocking Scenario

**Gmail Urgency Flagging Agent** — the compiled DSL has these two steps inside a scatter-gather that currently fail:

- **step5:** Mark email as important → needs `modify_email` with `mark_important: true`
- **step6:** Apply tracking label → needs `modify_email` with `add_labels: ["AgentsPilot"]`

Both currently compile to `plugin: "unknown", action: "unknown"` which blocks Phase E pre-flight validation.

## Reference Files

| File | Purpose |
|------|---------|
| `lib/plugins/definitions/google-mail-plugin-v2.json` | Plugin definition (add action here) |
| `lib/server/gmail-plugin-executor.ts` | Executor (implement action here) |
| `tests/plugins/unit-tests/google-mail.test.ts` | Unit tests (add tests here) |
| `docs/plugins/google-mail-plugin.md` | Plugin documentation (update scope + reference this requirement) |
| `output/vocabulary-pipeline/phase4-pilot-dsl-steps.json` | Current compiled DSL showing `unknown/unknown` steps |
