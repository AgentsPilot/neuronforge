# Plugin Test Suite

> **Last Updated**: 2026-04-12

## Overview

Comprehensive test suite for all 19 plugin executors in the AgentPilot platform. Covers unit tests, integration tests (with real API credentials), and plugin definition validation.

---

## Directory Structure

```
tests/plugins/
  common/                      Shared test helpers and mocks
    error-scenarios.ts           Standard error scenario runner
    mock-connection.ts           Fake OAuth connection factory
    mock-fetch.ts                Global fetch mock (intercepts all HTTP)
    mock-plugin-manager.ts       PluginManagerV2 test factory
    mock-user-connections.ts     Mock UserPluginConnections
    test-helpers.ts              Executor factory + assertion helpers
  fixtures/                    PDF fixtures for document-extractor tests
  integration-tests/           Real API integration tests (credential-gated)
    integration-config.ts        Credential reader + skip guards
    google-mail.integration.test.ts
    google-sheets.integration.test.ts
    google-drive.integration.test.ts
    slack.integration.test.ts
    notion.integration.test.ts
    document-extractor*.integration.test.ts
  unit-tests/                  Unit tests for all 19 executor classes
    airtable.test.ts
    base-executor.test.ts
    chatgpt-research.test.ts
    discord.test.ts
    document-extractor.test.ts
    dropbox.test.ts
    google-calendar.test.ts
    google-docs.test.ts
    google-drive.test.ts
    google-mail.test.ts
    google-sheets.test.ts
    hubspot.test.ts
    linkedin.test.ts
    meta-ads.test.ts
    notion.test.ts
    onedrive.test.ts
    outlook.test.ts
    salesforce.test.ts
    slack.test.ts
    whatsapp-business.test.ts
  plugin-definitions.test.ts   JSON definition validation (all 19 plugins)
  jest-setup.ts                Environment variable stubs for Supabase
```

---

## How to Run

| Command | What it runs | When to use |
|---------|-------------|-------------|
| `npm run test:plugins` | All plugin tests (unit + definitions + integration) | Full local validation |
| `npm run test:plugins:unit` | Only `unit-tests/` directory | Fast feedback during development |
| `npm run test:plugins:integration` | Only `integration-tests/` directory | When you have API credentials configured |
| `npm run test:plugins:smoke` | Only tests inside `[smoke]` describe blocks | Quick health check, CI on every push |
| `npm run test:plugins:all` | Alias for all plugin tests | Same as `test:plugins` |
| `npm run test:plugins:ci` | All tests with `--ci --forceExit` flags | CI environments |

---

## Test Classification System

All tests are wrapped in either `describe('[smoke]', ...)` or `describe('[full]', ...)` blocks.

| Classification | Purpose | What it contains |
|---------------|---------|-----------------|
| `[smoke]` | Fast health check | Happy-path tests for each action (1-2 per action) |
| `[full]` | Comprehensive coverage | Error paths, edge cases, auth failures, malformed responses |

### Naming Convention (SA-1)

The literal strings `[smoke]` and `[full]` must appear **only** in `describe()` block names, **never** in `it()` block descriptions. This prevents false matches when using `--testNamePattern`.

```typescript
// CORRECT
describe('[smoke]', () => {
  it('should create a record successfully', async () => { ... });
});

// WRONG -- do not put [smoke] in it() descriptions
it('[smoke] should create a record', async () => { ... });
```

### Filtering

```bash
# Run only smoke tests (used by CI and V6 regression gate)
npm run test:plugins:smoke

# Run only full tests
npx jest tests/plugins/ --testNamePattern="\[full\]" --verbose
```

---

## Integration Test Credentials

Integration tests skip gracefully when credentials are not available. To run them locally, set these environment variables:

### Google Mail

| Variable | Description |
|----------|-------------|
| `GOOGLE_MAIL_TEST_TOKEN` | OAuth access token for Gmail API |
| `GOOGLE_MAIL_TEST_REFRESH_TOKEN` | OAuth refresh token (optional) |

### Google Sheets

| Variable | Description |
|----------|-------------|
| `GOOGLE_SHEETS_TEST_TOKEN` | OAuth access token for Sheets API |
| `GOOGLE_SHEETS_TEST_REFRESH_TOKEN` | OAuth refresh token (optional) |
| `GOOGLE_SHEETS_TEST_SPREADSHEET_ID` | ID of a test spreadsheet (must exist) |

### Slack

| Variable | Description |
|----------|-------------|
| `SLACK_TEST_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_TEST_CHANNEL_ID` | Channel ID to post test messages in |

### Notion

| Variable | Description |
|----------|-------------|
| `NOTION_TEST_TOKEN` | Notion internal integration token |
| `NOTION_TEST_PARENT_PAGE_ID` | Parent page ID for creating test pages (optional) |

### Google Drive

| Variable | Description |
|----------|-------------|
| `GOOGLE_DRIVE_TEST_TOKEN` | OAuth access token for Drive API |
| `GOOGLE_DRIVE_TEST_REFRESH_TOKEN` | OAuth refresh token (optional) |
| `GOOGLE_DRIVE_TEST_FOLDER_ID` | Folder ID to use as test sandbox (optional) |

### Local Setup

Create a `.env.test.local` file (git-ignored) with your credentials:

```bash
GOOGLE_MAIL_TEST_TOKEN=your-token-here
SLACK_TEST_TOKEN=xoxb-your-token-here
SLACK_TEST_CHANNEL_ID=C0123456789
# ... etc
```

Then source it before running:

```bash
source .env.test.local && npm run test:plugins:integration
```

---

## V6 Regression Gate

The V6 regression runner (`tests/v6-regression/run-regression.ts`) includes a plugin smoke test gate. Before running any regression scenarios, it executes `[smoke]` tests with a 60-second timeout.

- If smoke tests **pass**: regression proceeds normally
- If smoke tests **fail**: regression aborts with the message:
  ```
  REGRESSION ABORTED -- Plugin smoke tests failed.
  Fix plugin executor issues before running V6 regression.
  ```

This ensures that plugin executor regressions are caught before they propagate into V6 pipeline failures, which are harder to diagnose.

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/plugin-tests.yml`) runs in three modes:

| Trigger | What runs | Credentials needed |
|---------|----------|-------------------|
| Push/PR to `main` (plugin-related paths) | Unit + Smoke tests | No |
| Nightly schedule (03:00 UTC) | Full suite including integration | Yes (GitHub Secrets) |
| Manual dispatch (`workflow_dispatch`) | Full suite on demand | Yes (GitHub Secrets) |

---

## Adding Tests for New Plugins

When generating a new plugin (see `docs/plugins/PLUGIN_GENERATION_WORKFLOW.md`):

1. Create `tests/plugins/unit-tests/{pluginName}.test.ts` with:
   - At least 1 `[smoke]` happy-path test per action
   - At least 1 `[full]` error-path test per action
   - Standard error scenarios via `runStandardErrorScenarios()` from `common/error-scenarios.ts`

2. Create `tests/plugins/integration-tests/{pluginName}.integration.test.ts` with:
   - Credential-gated stubs using `describeIfCredentials()` from `integration-config.ts`
   - At least 1 smoke test for the most common action
   - Cleanup in `afterAll` to remove any test artifacts

3. Add credential env vars to `integration-config.ts` CREDENTIAL_MAP

4. Run `npm run test:plugins:smoke` to verify the new tests pass
