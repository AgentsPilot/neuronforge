# Simulators

> **Last Updated**: 2026-03-31

## Overview

CLI tools that automate end-to-end testing of AgentPilot flows against a running local server. Each simulator drives real API endpoints with real LLM calls -- no mocks.

---

## Available Simulators

| Simulator | Path | Description |
|-----------|------|-------------|
| Enhanced Prompt Generator | `simulators/enhanced-prompt-generator/` | Automates Phase 1-3 of agent creation: analyze, clarify, finalize |

---

## Prerequisites

### 1. Local Dev Server

The simulator calls your local API, so the dev server must be running:

```bash
npm run dev
```

### 2. Test User Setup

The simulator authenticates as a real Supabase user. You must create a dedicated test account.

**Manual steps:**

1. Open the Supabase Dashboard for your project
2. Navigate to **Authentication > Users**
3. Click **Add user > Create new user**
4. Set:
   - Email: `simulator@yourdomain.com` (or any email you choose)
   - Password: a secure password
   - Auto Confirm User: **ON**
5. (Optional) Configure plugin connections for the test user:
   - Navigate to **Table Editor > plugin_connections**
   - Add entries for `google-mail`, `notion`, or other plugins used by your scenarios
   - These connections can have expired tokens -- the simulator tests prompt generation, not plugin execution

### 3. Environment Variables

Add these to your `.env.local` (already gitignored):

```bash
# Simulator test user credentials
SIMULATOR_USER_EMAIL=simulator@yourdomain.com
SIMULATOR_USER_PASSWORD=your-secure-password

# API base URL (default: http://localhost:3000)
SIMULATOR_BASE_URL=http://localhost:3000

# LLM provider/model for the simulator's answerer and validator
# These do NOT affect the API's own LLM calls -- only the simulator's side-channel calls
SIMULATOR_LLM_PROVIDER=openai
SIMULATOR_LLM_MODEL=gpt-4o
```

The simulator also needs all standard `.env.local` variables (Supabase URL, keys, OpenAI key, etc.) since it imports the `ProviderFactory` directly. Both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` must be present.

---

## Enhanced Prompt Generator

### Usage

```bash
# Run a single scenario
npx tsx simulators/enhanced-prompt-generator/index.ts --scenario gmail-summary

# Run all scenarios
npx tsx simulators/enhanced-prompt-generator/index.ts --all

# Run with verbose logging (debug-level output)
npx tsx simulators/enhanced-prompt-generator/index.ts --scenario gmail-summary --verbose
```

### Scenario Files

Scenarios are JSON files in `simulators/enhanced-prompt-generator/scenarios/`. Each file defines a user prompt, connected services, and optional overrides.

Example (`gmail-summary.json`):

```json
{
  "name": "gmail-summary",
  "description": "Summarize last 10 Gmail emails and save to Notion",
  "user_prompt": "Summarize my last 10 Gmail emails and save the summary to a Notion page",
  "connected_services": ["google-mail", "notion"],
  "clarification_hints": {
    "Which Notion database": "My daily summaries database"
  }
}
```

**Important:** Use actual plugin keys (e.g., `"google-mail"`, not `"gmail"`).

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (used in output filename) |
| `description` | Yes | Human-readable description |
| `user_prompt` | Yes | The natural-language prompt to test |
| `user_context` | No | User context overrides (name, email, timezone) |
| `connected_services` | No | Plugin keys to pass as connected services |
| `clarification_hints` | No | Partial-match question text to hints that guide the LLM's reasoning (not verbatim overrides) |
| `expected_services` | No | Expected services in the final enhanced prompt |
| `tags` | No | Tags for filtering/grouping |
| `ai_provider` | No | Override LLM provider for this scenario |
| `ai_model` | No | Override LLM model for this scenario |

### Output

Results are saved as JSON to `simulators/enhanced-prompt-generator/output/` (gitignored). Each file includes full request/response data for all phases, LLM validation results, and timing information.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All scenarios passed |
| 1 | One or more scenarios failed or errored |

---

## Thread Cleanup

Each simulator run creates `agent_prompt_threads` records. These accumulate over time. Periodically clean them up via the Supabase Dashboard:

```sql
DELETE FROM agent_prompt_threads
WHERE user_id = '<simulator-user-uuid>'
  AND created_at < NOW() - INTERVAL '7 days';
```

---

## Security Notes

- **Never commit credentials.** `SIMULATOR_USER_EMAIL` and `SIMULATOR_USER_PASSWORD` go in `.env.local` only.
- The simulator authenticates as a real user with RLS enforcement -- it tests the same auth path as the browser.
- Output files may contain API responses with user data. The `output/` directory is gitignored.
