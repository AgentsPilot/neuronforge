# Workplan: Add `modify_email` Action to Gmail Plugin

> **Last Updated**: 2026-03-29
> **Requirement**: [gmail-modify-email-action-2026-03-29.md](/docs/requirements/gmail-modify-email-action-2026-03-29.md)
> **Branch**: `feature/v6-intent-contract-data-schema` (current working branch)
> **Status**: PENDING SA REVIEW

## Overview

Add a `modify_email` action to the Gmail plugin that calls `POST /users/me/messages/{message_id}/modify` to add/remove labels, mark important, and mark read/unread. This unblocks Phase E for the Gmail Urgency Flagging Agent.

---

## Task Breakdown

### Task 1: Plugin Definition Update

**File:** `lib/plugins/definitions/google-mail-plugin-v2.json`

**What to do:**
- Add `modify_email` action object to the `actions` map, after `get_email_attachment`
- Include the full schema as specified in the requirement: `message_id` (required), `add_labels`, `remove_labels`, `mark_important`, `mark_read`
- Include `output_schema` with `message_id`, `labels_added`, `labels_removed`
- Include `output_guidance` with `success_description`, `sample_output`, `common_errors`
- Add metadata fields: `idempotent: true`, `domain: "email"`, `capability: "modify"`, `input_entity: "email"`, `output_entity: "email"`, `input_cardinality: "single"`, `output_cardinality: "single"`

**Estimated complexity:** Low

---

### Task 2: Executor -- `modifyEmail` Method + `getOrCreateLabel` Helper

**File:** `lib/server/gmail-plugin-executor.ts`

**What to do:**

**2a. Add switch case:**
- Add `case 'modify_email': return await this.modifyEmail(connection, parameters);` to `executeSpecificAction`

**2b. Implement `getOrCreateLabel(connection, labelName)` private helper:**
- Define a set of known system labels: `IMPORTANT`, `STARRED`, `UNREAD`, `INBOX`, `SPAM`, `TRASH`, `SENT`, `DRAFT`, `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL`, `CATEGORY_PROMOTIONS`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS`
- If `labelName` is in the system set, return it directly (system labels are their own IDs)
- Otherwise, call `GET /users/me/labels` (reuse the fetch pattern from `list_labels`)
- Search for a label whose `name` matches (case-insensitive)
- If found, return its `id`
- If not found, create it via `POST /users/me/labels` with `{ name: labelName, labelListVisibility: "labelShow", messageListVisibility: "show" }` and return the new `id`
- Log at debug level for resolution, warn level for creation

**2c. Implement `modifyEmail(connection, parameters)` private method:**
1. Extract `message_id`, `add_labels`, `remove_labels`, `mark_important`, `mark_read` from parameters
2. Build `addLabelIds` array:
   - Start with `add_labels || []`
   - If `mark_important === true`, push `"IMPORTANT"`
   - If `mark_read === false`, push `"UNREAD"`
3. Build `removeLabelIds` array:
   - Start with `remove_labels || []`
   - If `mark_important === false`, push `"IMPORTANT"`
   - If `mark_read === true`, push `"UNREAD"`
4. Resolve all label names in both arrays through `getOrCreateLabel` (system labels pass through, custom labels get resolved/created)
5. Call `POST ${this.gmailApisUrl}/users/me/messages/${message_id}/modify` with `{ addLabelIds, removeLabelIds }`
6. Handle response: if `!response.ok`, throw with status and error body
7. Return `{ message_id, labels_added: addLabelIds, labels_removed: removeLabelIds }`

**Estimated complexity:** Medium

---

### Task 3: Unit Tests

**File:** `tests/plugins/unit-tests/google-mail.test.ts`

**What to do:**

Add a new `describe('modify_email', ...)` block with the following tests:

**3a. Happy path -- mark_important + add custom label:**
- Mock `getOrCreateLabel` label list fetch (for custom label resolution) and the modify endpoint
- Use `mockFetchSequence` with:
  - Response 1: `GET /users/me/labels` returning `{ labels: [{ id: 'Label_456', name: 'AgentsPilot', type: 'user' }] }`
  - Response 2: `POST /users/me/messages/{id}/modify` returning `{ id: 'msg-123', labelIds: ['IMPORTANT', 'Label_456'] }`
- Call `executor.executeAction(USER_ID, 'modify_email', { message_id: 'msg-123', mark_important: true, add_labels: ['AgentsPilot'] })`
- Assert: `expectSuccessResult`, `result.data.message_id === 'msg-123'`, `labels_added` contains `'IMPORTANT'` and the resolved label ID

**3b. Happy path -- mark_read (system label only, no label list fetch needed):**
- Mock only the modify endpoint (system labels skip the labels API call)
- Call with `{ message_id: 'msg-200', mark_read: true }`
- Assert: `labels_removed` contains `'UNREAD'`

**3c. Error case -- 404 message not found:**
- For any label resolution call, mock success; for the modify call, mock 404
- Assert: `expectErrorResult`

**3d. Happy path -- getOrCreateLabel creates a new label when not found:**
- Mock `GET /users/me/labels` returning empty list
- Mock `POST /users/me/labels` returning `{ id: 'Label_new', name: 'NewLabel' }`
- Mock `POST /users/me/messages/{id}/modify` returning success
- Call with `{ message_id: 'msg-300', add_labels: ['NewLabel'] }`
- Assert: the modify call used the created label ID

**Estimated complexity:** Medium

---

### Task 4: Plugin Documentation Update

**File:** `docs/plugins/google-mail-plugin.md`

**What to do:**
- Add `### 4. get_email_attachment` section (currently missing from docs -- pre-existing gap, fix now since we are updating this file)
- Add `### 5. modify_email` section with:
  - Description, HTTP Method (POST), Endpoint
  - Parameters table
  - Response structure table
  - Note about label name resolution (system labels vs custom labels)
- Update the Version History table:
  - Add row: `1.1.0 | 2026-03-29 | Added modify_email action (Gmail Urgency Flagging Agent - Phase E blocker). Added get_email_attachment docs.`
- Update `Last Updated` header to `2026-03-29`

**Estimated complexity:** Low

---

## Implementation Order

1. Task 1 (plugin definition) -- no dependencies
2. Task 2 (executor) -- no dependencies on Task 1 at runtime, but logically follows
3. Task 3 (tests) -- depends on Tasks 1 and 2
4. Task 4 (docs) -- no dependencies, can be done last

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Label resolution requires extra API call per custom label | Cache label list within the method call scope (single `GET /labels` per `modifyEmail` invocation) |
| `getOrCreateLabel` creating unwanted labels | Only creates if the label name is not a system label AND not found in existing labels -- this is the expected behavior per requirement |
| Shorthand booleans conflicting with explicit arrays | Document that shorthands are additive -- they merge with explicit arrays, no deduplication needed since Gmail API handles duplicate label IDs gracefully |

---

## Acceptance Criteria Mapping

| Acceptance Criterion | Task |
|---------------------|------|
| `modify_email` action registered in plugin JSON definition and executor switch | Task 1 + Task 2a |
| Unit tests covering happy path + error case, all passing | Task 3 |
| Custom label name to ID resolution works | Task 2b |
| `getOrCreateLabel` helper implemented | Task 2b |
| Plugin docs updated with new action | Task 4 |

---

## SA Review Checklist

- [ ] Plugin definition schema follows conventions of existing actions (send_email, search_emails)
- [ ] Executor follows existing patterns (error handling, logging, response format)
- [ ] `getOrCreateLabel` does not introduce performance issues (single labels API call per modify invocation)
- [ ] Unit tests are sufficient (happy path, error path, label creation path)
- [ ] No hardcoded plugin-specific logic introduced outside the plugin boundary
