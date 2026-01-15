# DSL Builder CLI Testing Guide

This document explains how to test the V5 Workflow Generator (DSL Builder) from the command line without needing the web UI or running server.

---

## Overview

The CLI test script directly invokes `V5WorkflowGenerator` with JSON fixture files, mimicking the flow of the test page (`/test-plugins-v2` → AI Services tab → `generate-agent-v5-test-wrapper`).

**Benefits:**
- No server required
- Fast iteration
- JSON in/out for easy comparison
- Exit codes for CI/CD integration
- Supports both input paths (Enhanced Prompt and Technical Workflow)
- **Deterministic testing** - Skip LLM reviewer with `--reviewed-workflow` for reproducible tests

---

## Quick Start

```bash
# Run with sample fixture
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/technical-workflow-email.json

# Save output to file
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/technical-workflow-email.json -o output/result.json

# Show help
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts --help
```

---

## Prerequisites

1. **Environment variables** - Ensure your `.env.local` has the required API keys:
   ```
   OPENAI_API_KEY=sk-...
   ANTHROPIC_API_KEY=sk-ant-...  # If using Anthropic
   ```

2. **Dependencies** - The script uses `tsx` to run TypeScript directly:
   ```bash
   npm install -g tsx  # Or use npx tsx
   ```

---

## Command-Line Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--input` | `-i` | Path to input JSON file (required) | — |
| `--output` | `-o` | Path to save output JSON | stdout |
| `--reviewed-workflow` | — | Path to pre-reviewed workflow JSON (skips LLM reviewer) | — |
| `--skip-dsl-builder` | — | Return LLM review only, skip DSL building | `false` |
| `--provider` | — | AI provider: `openai`, `anthropic`, `kimi` | `openai` |
| `--model` | — | Model name | `gpt-4o` |
| `--user-id` | — | User ID for plugin context | `test_user_cli` |
| `--verbose` | `-v` | Show detailed logging | `false` |
| `--help` | `-h` | Show help message | — |

---

## Input Fixture Format

The input JSON supports two paths through the V5 generator:

### Path A: Enhanced Prompt Only

Triggers **Stage 1A** (LLM extraction) → **Stage 2A** (DSL building)

```json
{
  "enhancedPrompt": {
    "plan_title": "Agent Name",
    "plan_description": "What the agent does",
    "sections": {
      "data": ["Data source 1", "Data source 2"],
      "output": ["Expected output"],
      "actions": ["Action 1", "Action 2"],
      "delivery": ["How results are delivered"],
      "processing_steps": ["Step 1", "Step 2"]
    },
    "specifics": {
      "services_involved": ["google-mail", "slack"],
      "resolved_user_inputs": [
        { "key": "recipient_email", "value": "user@example.com" }
      ]
    }
  }
}
```

### Path B: Technical Workflow

Triggers **Stage 1B** (LLM review) → **Stage 2B** (Phase4DSLBuilder)

```json
{
  "enhancedPrompt": {
    "plan_title": "Agent Name",
    "plan_description": "What the agent does",
    "specifics": {
      "services_involved": ["google-mail", "slack"],
      "resolved_user_inputs": [
        { "key": "slack_channel", "value": "#notifications" }
      ]
    }
  },
  "technicalWorkflow": {
    "technical_workflow": [
      {
        "id": "step1",
        "kind": "operation",
        "description": "Fetch emails from Gmail",
        "plugin": "google-mail",
        "action": "list_messages",
        "inputs": {
          "query": { "source": "hardcoded", "value": "is:unread" }
        },
        "outputs": {
          "emails": "Array<Email>"
        }
      },
      {
        "id": "step2",
        "kind": "transform",
        "type": "summarize_with_llm",
        "description": "Summarize email content",
        "inputs": {
          "content": { "source": "from_step", "step_id": "step1", "output_key": "emails" }
        },
        "outputs": {
          "summary": "String"
        }
      }
    ],
    "requiredServices": ["google-mail", "slack"],
    "technical_inputs_required": [
      {
        "key": "slack_channel",
        "description": "Slack channel for notifications",
        "type": "string",
        "required": true
      }
    ]
  }
}
```

### Step Kinds

| Kind | Description | Required Fields |
|------|-------------|-----------------|
| `operation` | Plugin action (external API call) | `plugin`, `action`, `inputs` |
| `transform` | Data transformation | `type`, `inputs` |
| `control` | Flow control (if/for_each) | `control`, `steps` |

### Transform Types

**Deterministic (no LLM):**
- `filter`, `map`, `sort`, `group_by`, `aggregate`, `reduce`, `deduplicate`, `flatten`, `pick_fields`, `format`, `merge`, `split`, `convert`

**LLM-based:**
- `summarize_with_llm`, `classify_with_llm`, `extract_with_llm`, `analyze_with_llm`, `generate_with_llm`, `translate_with_llm`, `enrich_with_llm`

### Input Sources

| Source | Example | Description |
|--------|---------|-------------|
| `hardcoded` | `{ "source": "hardcoded", "value": "hello" }` | Literal value |
| `from_step` | `{ "source": "from_step", "step_id": "step1", "output_key": "emails" }` | Output from previous step |
| `user_input` | `{ "source": "user_input", "key": "recipient" }` | Runtime user input |

---

## Sample Fixtures

Located in `tests/dsl-builder/fixtures/`:

| File | Description |
|------|-------------|
| `technical-workflow-email.json` | Email → Slack summary with both enhancedPrompt and technicalWorkflow |
| `enhanced-prompt-only.json` | Enhanced prompt only (triggers Stage 1A extraction) |
| `reviewed-workflow-email.json` | Pre-reviewed workflow (use with `--reviewed-workflow` to skip LLM) |

---

## Usage Examples

### Basic Test

```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/technical-workflow-email.json
```

### Save Output to File

```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts \
  -i tests/dsl-builder/fixtures/technical-workflow-email.json \
  -o output/email-agent-dsl.json
```

### Test LLM Reviewer Only (Skip DSL Builder)

Useful for debugging the LLM review stage in isolation:

```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts \
  -i tests/dsl-builder/fixtures/technical-workflow-email.json \
  --skip-dsl-builder
```

### Use Different Provider/Model

```bash
# Use Anthropic Claude
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts \
  -i tests/dsl-builder/fixtures/input.json \
  --provider anthropic \
  --model claude-sonnet-4-20250514

# Use GPT-4o-mini for faster/cheaper tests
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts \
  -i tests/dsl-builder/fixtures/input.json \
  --provider openai \
  --model gpt-4o-mini
```

### Verbose Mode

```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json -v
```

### Skip LLM Reviewer (Deterministic Testing)

For unit tests and CI/CD, skip the LLM reviewer call entirely by providing a pre-reviewed workflow:

```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts \
  -i tests/dsl-builder/fixtures/technical-workflow-email.json \
  --reviewed-workflow tests/dsl-builder/fixtures/reviewed-workflow-email.json
```

**Benefits of deterministic testing:**
- **100% reproducible** - No LLM variability
- **Fast execution** - ~50ms instead of ~2-5s
- **Zero API cost** - No LLM calls made
- **CI/CD friendly** - No flaky tests from LLM timeouts

**Workflow:**
1. Run once with LLM reviewer to generate reviewed workflow
2. Save the `reviewedWorkflow` output to a fixture file
3. Use `--reviewed-workflow` in subsequent tests

---

## Output Format

### Success Response

```json
{
  "success": true,
  "workflow": {
    "agent_name": "Daily Email Summary Agent",
    "description": "Fetches unread emails and sends summary to Slack",
    "workflow_steps": [...],
    "required_inputs": [...],
    "suggested_plugins": ["google-mail", "slack"]
  },
  "reviewerSkipped": false,
  "dslBuilderSkipped": false,
  "sessionId": "sess_abc123",
  "metadata": {
    "totalSteps": 3,
    "actionsResolved": 2
  },
  "warnings": [],
  "latency_ms": 2341
}
```

### Failure Response

```json
{
  "success": false,
  "errors": [
    "Plugin 'unknown-plugin' not found in registry"
  ],
  "warnings": [],
  "latency_ms": 150
}
```

### With `--skip-dsl-builder`

```json
{
  "success": true,
  "reviewedWorkflow": {
    "technical_workflow": [...],
    "reviewer_summary": {
      "status": "approved",
      "changes_made": []
    },
    "feasibility": {
      "can_execute": true,
      "confidence": 0.95
    }
  },
  "reviewerSkipped": false,
  "dslBuilderSkipped": true,
  "latency_ms": 1823
}
```

### With `--reviewed-workflow` (Deterministic)

```json
{
  "success": true,
  "workflow": {
    "agent_name": "Daily Email Summary Agent",
    "workflow_steps": [...],
    "required_inputs": [...],
    "suggested_plugins": ["google-mail", "slack"]
  },
  "reviewerSkipped": true,
  "dslBuilderSkipped": false,
  "sessionId": "sess_abc123",
  "metadata": {
    "totalSteps": 3,
    "actionsResolved": 2
  },
  "latency_ms": 52
}
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success - DSL generated successfully |
| `1` | Failure - Errors occurred during generation |

Use exit codes for CI/CD integration:

```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json && echo "Success!" || echo "Failed!"
```

---

## Creating New Test Fixtures

1. Create a new JSON file in `tests/dsl-builder/fixtures/`:
   ```bash
   touch tests/dsl-builder/fixtures/my-new-workflow.json
   ```

2. Add the required structure (see Input Fixture Format above)

3. Run the test:
   ```bash
   npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/my-new-workflow.json
   ```

4. Save successful output as a reference:
   ```bash
   npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts \
     -i tests/dsl-builder/fixtures/my-new-workflow.json \
     -o tests/dsl-builder/fixtures/my-new-workflow.expected.json
   ```

---

## Troubleshooting

### "Error: Input file not found"

Ensure the path is relative to the project root or use an absolute path.

### "Error: No required services found"

Add `services_involved` to `enhancedPrompt.specifics` or `requiredServices` to `technicalWorkflow`.

### "Plugin 'xxx' not found"

The plugin must be registered in the plugin registry. Check available plugins or use a test user with connected plugins.

### LLM API Errors

- Verify your API keys in `.env.local`
- Check rate limits
- Try a different model with `--model gpt-4o-mini`

### Empty or Unexpected Output

Use `--verbose` flag to see detailed logging:
```bash
npx tsx tests/dsl-builder/scripts/test-dsl-builder.ts -i tests/dsl-builder/fixtures/input.json -v
```

---

## Related Documentation

- [V5_GENERATOR_ARCHITECTURE.md](../V5_GENERATOR_ARCHITECTURE.md) - Internal architecture of the V5 generator
- [Phase4-to-PILOT_DSL-Mapping.md](../Phase4-to-PILOT_DSL-Mapping.md) - Schema mapping reference

---

## Files Reference

| File | Purpose |
|------|---------|
| `tests/dsl-builder/scripts/test-dsl-builder.ts` | CLI test script |
| `tests/dsl-builder/fixtures/*.json` | Test input fixtures |
| `lib/agentkit/v4/v5-generator.ts` | V5WorkflowGenerator implementation |
| `lib/agentkit/v4/core/phase4-dsl-builder.ts` | Phase4DSLBuilder (Stage 2B) |

---

**Document Version**: 1.2
**Created**: 2026-01-12
**Updated**: 2026-01-13 - Added `--reviewed-workflow` option for deterministic testing
