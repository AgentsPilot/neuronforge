# Plugin Test Suite — Workplan & Specification

> **Last Updated**: 2026-03-27

## Overview

This document defines the test suite for all NeuronForge V2 plugins. The goal is to unit-test every plugin executor's action logic in isolation — mocking all external HTTP calls and OAuth connections — so that executor code (parameter building, response parsing, error handling) is validated without any network or database dependency.

---

## Motivation

1. **Regression safety** — catch breakages when plugin executors or definitions change.
2. **CI-ready** — a single regression script runs all plugin tests and exits 0 (pass) or 1 (fail).
3. **Living documentation** — this file catalogs every covered plugin and action; update it when plugins or actions are added.
4. **No external dependencies** — tests mock at the `fetch` level, so they run offline, fast, and deterministically.

---

## Directory Structure

```
tests/
└── plugins/
    ├── common/                              # Shared test utilities
    │   ├── mock-fetch.ts                    # Global fetch mock helper
    │   ├── mock-connection.ts               # Fake OAuth connection factory
    │   └── mock-plugin-manager.ts           # Stub PluginManagerV2
    ├── fixtures/                             # Static test data files
    │   └── Invoice677931.pdf                # Invoice PDF for document-extractor tests
    ├── unit-tests/                           # Unit tests (all mocked, no external I/O)
    │   ├── airtable.test.ts
    │   ├── document-extractor.test.ts       # Mocks DeterministicExtractor.extract()
    │   ├── google-calendar.test.ts
    │   ├── google-docs.test.ts
    │   ├── google-drive.test.ts
    │   ├── google-mail.test.ts
    │   ├── google-sheets.test.ts
    │   ├── hubspot.test.ts
    │   ├── linkedin.test.ts
    │   ├── slack.test.ts
    │   └── whatsapp-business.test.ts
    └── integration-tests/                    # Integration tests (real processing, no network)
        └── document-extractor.integration.test.ts  # Runs real DeterministicExtractor against Invoice677931.pdf
```

---

## Test Framework & Tooling

| Tool | Purpose |
|------|---------|
| **Jest** | Test runner, assertions, mocking (`jest.fn()`, `jest.spyOn`) |
| **ts-jest** | TypeScript transform for Jest |
| **Global fetch mock** | Intercepts `fetch()` calls per-test to return canned responses |

### How to Run

```bash
# Run all plugin unit tests
npx jest --config jest.config.ts tests/plugins/unit-tests/

# Run all plugin integration tests
npx jest --config jest.config.ts tests/plugins/integration-tests/

# Run a single plugin's unit tests
npx jest --config jest.config.ts tests/plugins/unit-tests/slack.test.ts

# Run everything (unit + integration) — full regression
npx jest --config jest.config.ts tests/plugins/ --ci --forceExit

# npm script shortcuts
npm run test:plugins            # All unit + integration tests
npm run test:plugins:unit       # Unit tests only
npm run test:plugins:integration # Integration tests only
npm run test:plugins:ci         # CI mode (all tests, single run, exit code)
```

---

## Mocking Strategy

### 1. Fetch-Level Mock (`common/mock-fetch.ts`)

Every test mocks the global `fetch` function. This ensures:
- Executor logic (URL building, header construction, body serialization) is exercised.
- Response parsing and error mapping are tested.
- No real HTTP requests leave the machine.

The mock helper will provide:
- `mockFetchSuccess(responseBody)` — returns 200 with JSON body.
- `mockFetchError(status, errorBody)` — returns an error status.
- `mockFetchSequence([...responses])` — returns responses in order for multi-call actions.
- `getLastFetchCall()` — returns the URL and options of the last `fetch()` invocation for assertion.

### 2. Fake OAuth Connection (`common/mock-connection.ts`)

Provides a factory that returns a minimal connection object:

```typescript
{
  id: 'test-connection-id',
  user_id: 'test-user-id',
  plugin_key: '<plugin-name>',
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_expiry: '<future ISO timestamp>',
  account_info: { email: 'test@example.com' }
}
```

### 3. Stub PluginManagerV2 (`common/mock-plugin-manager.ts`)

A lightweight stub that loads the real plugin definition JSON (so action schemas are validated) but does not perform any I/O beyond file reads.

---

## Test Structure Per Plugin

Each `<plugin>.test.ts` follows this pattern:

```typescript
describe('<PluginName>PluginExecutor', () => {
  // Setup: create executor with mock connection + mock plugin manager
  // Teardown: restore fetch

  describe('<action_name>', () => {
    it('should call the correct endpoint with expected parameters', ...);
    it('should parse a successful response correctly', ...);
    it('should handle API error responses', ...);
  });

  // Repeat for each action
});
```

**What each action test validates:**
1. Correct HTTP method and URL.
2. Correct headers (Authorization, Content-Type, plugin-specific).
3. Correct request body construction from input parameters.
4. Correct parsing/mapping of the success response.
5. Correct error handling for common failure cases (401, 404, rate-limit, etc.).

---

## Plugin & Action Coverage

### 1. Airtable (`airtable.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `list_bases` | List all accessible bases |
| 2 | `list_records` | List records in a table |
| 3 | `get_record` | Get a single record by ID |
| 4 | `create_records` | Create one or more records |
| 5 | `update_records` | Update one or more records |
| 6 | `list_tables` | List tables in a base |
| 7 | `upload_attachment` | Upload an attachment to a record |
| 8 | `get_attachment_urls` | Get attachment URLs from a record |

### 2. Document Extractor (`document-extractor.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `extract_structured_data` | Extract structured data from a document (PDF fixture) |

> **Note — Special mocking strategy:** This plugin does **not** use HTTP `fetch`. It uses `DeterministicExtractor` which internally calls `pdf-parse` (for text PDFs) and optionally AWS Textract (for scanned/image documents). The test will **mock `DeterministicExtractor.prototype.extract()`** to return canned extraction results, avoiding any file I/O or AWS calls. The fixture file `tests/plugins/fixtures/Invoice677931.pdf` (a Beyond Compare license invoice) is used as the base64 input source.
>
> **Fixture contents:** Invoice #677931, vendor Scooter Software, total $31.50 USD, dated 17-Mar-2026. Fields to extract in test: `invoice_number`, `date`, `vendor`, `amount`, `currency`.

### 3. Google Calendar (`google-calendar.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `list_events` | List calendar events |
| 2 | `create_event` | Create a new event |
| 3 | `update_event` | Update an existing event |
| 4 | `delete_event` | Delete an event |
| 5 | `get_event_details` | Get details of a specific event |

### 4. Google Docs (`google-docs.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `read_document` | Read document content |
| 2 | `insert_text` | Insert text at a position |
| 3 | `append_text` | Append text to document |
| 4 | `create_document` | Create a new document |
| 5 | `get_document_info` | Get document metadata |

### 5. Google Drive (`google-drive.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `list_files` | List files in Drive |
| 2 | `search_files` | Search for files |
| 3 | `get_file_metadata` | Get file metadata |
| 4 | `read_file_content` | Read file content |
| 5 | `get_folder_contents` | List folder contents |
| 6 | `upload_file` | Upload a file |
| 7 | `create_folder` | Create a folder |
| 8 | `get_or_create_folder` | Find or create a folder |
| 9 | `share_file` | Share a file |

### 6. Google Mail (`google-mail.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `send_email` | Send an email |
| 2 | `search_emails` | Search emails |
| 3 | `create_draft` | Create a draft email |
| 4 | `get_email_attachment` | Download an email attachment |
| 5 | `modify_email` | Modify email labels — mark important, apply/remove labels, mark read/unread |

### 7. Google Sheets (`google-sheets.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `read_range` | Read a cell range |
| 2 | `write_range` | Write to a cell range |
| 3 | `append_rows` | Append rows to a sheet |
| 4 | `create_spreadsheet` | Create a new spreadsheet |
| 5 | `get_or_create_spreadsheet` | Find or create a spreadsheet |
| 6 | `get_spreadsheet_info` | Get spreadsheet metadata |
| 7 | `get_or_create_sheet_tab` | Find or create a sheet tab |

### 8. HubSpot (`hubspot.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `get_contact` | Get a contact by ID |
| 2 | `get_contact_deals` | Get deals for a contact |
| 3 | `get_contact_activities` | Get activities for a contact |
| 4 | `search_contacts` | Search contacts |
| 5 | `get_deal` | Get a deal by ID |
| 6 | `create_contact` | Create a new contact |
| 7 | `create_task` | Create a task |
| 8 | `create_deal` | Create a deal |
| 9 | `create_contact_note` | Add a note to a contact |

### 9. LinkedIn (`linkedin.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `get_profile` | Get authenticated user's profile |
| 2 | `get_user_info` | Get user info |
| 3 | `create_post` | Create a post |
| 4 | `get_posts` | Get user's posts |
| 5 | `get_organization` | Get organization details |
| 6 | `search_organizations` | Search organizations |
| 7 | `get_organization_posts` | Get organization posts |
| 8 | `get_connections` | Get user's connections |

### 10. Slack (`slack.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `send_message` | Send a message to a channel |
| 2 | `read_messages` | Read message history |
| 3 | `update_message` | Update a message |
| 4 | `add_reaction` | Add an emoji reaction |
| 5 | `remove_reaction` | Remove an emoji reaction |
| 6 | `get_or_create_channel` | Find or create a channel |
| 7 | `create_channel` | Create a channel |
| 8 | `list_channels` | List channels |
| 9 | `list_users` | List workspace users |
| 10 | `get_user_info` | Get user details |
| 11 | `upload_file` | Upload a file |

### 11. WhatsApp Business (`whatsapp-business.test.ts`)

| # | Action | Description |
|---|--------|-------------|
| 1 | `send_template_message` | Send a template message |
| 2 | `send_text_message` | Send a text message |
| 3 | `send_interactive_message` | Send an interactive message |
| 4 | `list_message_templates` | List message templates |
| 5 | `mark_message_read` | Mark a message as read |

---

## Regression Runner

No separate script needed — Jest discovers all `*.test.ts` files recursively under `tests/plugins/` (both `unit-tests/` and `integration-tests/`).

```bash
npx jest --config jest.config.ts tests/plugins/ --ci --forceExit --verbose
```

**Behavior:**
- Runs all `*.test.ts` files in `tests/plugins/unit-tests/` and `tests/plugins/integration-tests/` in parallel (Jest default worker pool).
- Outputs per-test-file pass/fail with verbose action-level results.
- Exits with code 0 if all pass, 1 if any fail.
- `--ci` flag disables interactive watch mode and enables single-run for CI pipelines.

For npm script convenience, entries will be added to `package.json`:

```json
"test:plugins": "jest --config jest.config.ts tests/plugins/ --verbose",
"test:plugins:unit": "jest --config jest.config.ts tests/plugins/unit-tests/ --verbose",
"test:plugins:integration": "jest --config jest.config.ts tests/plugins/integration-tests/ --verbose",
"test:plugins:ci": "jest --config jest.config.ts tests/plugins/ --ci --forceExit --verbose"
```

---

## Adding a New Plugin to the Suite

When a new plugin is created or new actions are added:

1. Create or update `tests/plugins/unit-tests/<plugin-name>.test.ts`.
2. Add a `describe` block for each new action.
3. If the plugin processes files locally (no external API), also add an integration test in `tests/plugins/integration-tests/`.
4. Update the **Plugin & Action Coverage** table in this document.
5. If the plugin requires fixture files, add them to `tests/plugins/fixtures/`.
6. Run `npm run test:plugins` to verify.

---

## Open Items

| # | Item | Status |
|---|------|--------|
| 1 | Obtain PDF fixture for document-extractor tests | ✅ `Invoice677931.pdf` provided |
| 2 | Verify Jest config supports `tests/plugins/` path | ⬜ To check during implementation |
| 3 | Confirm document-extractor mocking approach | ✅ Mock `DeterministicExtractor.prototype.extract()` — no LLM, no fetch, uses pdf-parse + AWS Textract |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-27 | Initial workplan | Defined scope, structure, mocking strategy, and full action coverage for 11 plugins (68 actions) |
| 2026-03-27 | Document-extractor investigation | Confirmed DeterministicExtractor uses pdf-parse + AWS Textract (no LLM). Mock at `extract()` level. Invoice677931.pdf fixture provided. |
| 2026-03-27 | Folder structure update | Split into `unit-tests/` and `integration-tests/` subfolders. Document-extractor has both a unit test (mocked) and integration test (real extraction against PDF). |
| 2026-03-29 | Gmail `modify_email` added | New action added per requirement `docs/requirements/gmail-modify-email-action-2026-03-29.md`. 4 unit tests (mark important + custom label, mark read, 404 error, label auto-creation). Total actions: 69. |
