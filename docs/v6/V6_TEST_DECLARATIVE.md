# V6 Test Page - Pipeline Orchestrator with Requirements Tracking

> **URL**: `/test-v6-declarative.html`
> **Source**: `public/test-v6-declarative.html`
> **Last aligned to code**: 2026-02-20 (verified against bf425f7)

This document covers the V6 Pipeline Test Page, a comprehensive UI for testing the V6 agent generation system end-to-end: from Enhanced Prompt input through compilation, execution, and persisting the result as an agent in the database.

## Overview

The test page provides a visual interface for:
- Running the complete **6-phase V6 pipeline** (Phase 0 through Phase 5) with 5 validation gates
- Running an alternative **validated pipeline with auto-recovery**
- Viewing intermediate results from each phase (with copy-to-clipboard per phase)
- Executing compiled workflows against real plugins
- Saving/loading workflows to browser localStorage
- Creating agents in the database from compiled workflows
- Running system diagnostics

---

## Accessing the Test Page

```
http://localhost:3000/test-v6-declarative.html
```

---

## Getting an Enhanced Prompt from Thread Conversation

The V6 pipeline requires an **Enhanced Prompt** as input. You can generate one using the Thread Conversation flow in `/test-plugins-v2`:

### Workflow: test-plugins-v2 -> V6 Declarative

1. **Open test-plugins-v2**: Navigate to `/test-plugins-v2`
2. **Go to Thread Conversation tab** (Tab 3)
3. **Start a thread** with your automation request
4. **Complete Phase 1** (Analysis) and **Phase 2** (Clarification Questions)
5. **Reach Phase 3** (Enhanced Prompt) - you'll see the generated plan
6. **Expand "View Full Enhanced Prompt JSON"**
7. **Click "Copy Enhanced Prompt JSON"** button
8. **Open V6 Declarative page**: Navigate to `/test-v6-declarative.html`
9. **Paste** the JSON into the "Enhanced Prompt (JSON)" textarea
10. **Run the V6 Pipeline**

```
+-----------------------------------------------------------------------+
|                         test-plugins-v2                                |
|  Thread Conversation Tab                                              |
|  +---------------------------------------------------------------+   |
|  | Phase 1: Analysis -> Phase 2: Questions -> Phase 3: Enhanced   |   |
|  |                                              |                 |   |
|  |                                              v                 |   |
|  |                                   [Copy Enhanced Prompt JSON]  |   |
|  +---------------------------------------------------------------+   |
+-----------------------------------------------------------------------+
                                      |
                                      | Paste
                                      v
+-----------------------------------------------------------------------+
|                       test-v6-declarative.html                        |
|  +---------------------------------------------------------------+   |
|  | Enhanced Prompt (JSON): [paste here]                           |   |
|  |                                                                |   |
|  | [Run Full Pipeline]  [Run with Validation & Auto-Recovery]     |   |
|  +---------------------------------------------------------------+   |
+-----------------------------------------------------------------------+
```

---

## Tab Navigation

The interface has **five** tabs:

| Tab | Icon | Purpose |
|-----|------|---------|
| **Compilation** | Rocket | Run the full 6-phase pipeline (P0-P5) |
| **Execution** | Play | Execute compiled workflows against real plugins |
| **Saved** | Disk | Manage workflows saved to browser localStorage |
| **Diagnostics** | Search | System health checks |
| **Create Agent** | Robot | Persist a compiled workflow as an agent in the database |

---

## Header: Pipeline Flow Visualization

The page header shows the current pipeline architecture:

```
Prompt -> P0: Requirements -> P1: Semantic -> P2: Grounding -> P3: IR + Auto-Fix -> P4: Compile -> P5: PILOT -> Ready
```

### Feature Banner

The header also displays the active V6 features:

| Feature | Description |
|---------|-------------|
| **Phase 0: Hard Requirements** | Extract thresholds, invariants, routing rules, side-effect constraints |
| **Admin Model Config** | Each phase uses model/provider/temperature from admin configuration |
| **Auto-Recovery (Gate 3)** | Phase 3 auto-fixes invalid operations |
| **5 Validation Gates** | One gate per phase verifying correctness |
| **PILOT Format** | Output is production-ready flat-array PILOT format |
| **Requirement Tracking** | Requirements from Phase 0 are tracked through to final enforcement |

---

## Tab 1: Compilation (Full Pipeline)

### Purpose

Test the complete V6 generation pipeline from Enhanced Prompt to production-ready PILOT workflow.

### Input Fields

| Field | Description | Default |
|-------|-------------|---------|
| **User ID** | User identifier for plugin connection lookup | `offir.omer@gmail.com` |
| **Enhanced Prompt** | JSON object with `sections` structure | Pre-filled example |

### Enhanced Prompt Format

```json
{
  "sections": {
    "data": [
      "- Read Gmail Inbox messages from the last 7 days.",
      "- Use the spreadsheet ID 1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
      "- Use the tab named UrgentEmails as the destination."
    ],
    "actions": [
      "- Filter messages that contain keywords: complaint, refund, angry, not working",
      "- Check if the message link/id already exists in the sheet to avoid duplicates"
    ],
    "output": [
      "- Append new matching messages to the sheet with columns: sender email, subject, date, full email text, Gmail message link/id"
    ],
    "delivery": [
      "- No email notifications, only append to sheet"
    ]
  }
}
```

### Two Pipeline Modes

The Compilation tab offers **two buttons** with different pipeline strategies:

#### Mode 1: "Run Full Pipeline" (`runPipeline()`)

The primary mode. Makes a **single orchestrated API call** that runs all phases server-side.

**Flow:**

1. Fetches admin model configuration from `GET /api/admin/agent-generation-config`
   - Logs which provider/model/temperature is configured for each phase (requirements, semantic, formalization)
2. Calls `POST /api/v6/generate-ir-semantic` with `use_v6_orchestrator: true`
   - The orchestrator runs **all phases (P0-P5)** in a single request
   - Returns all intermediate results in one response
3. Displays results phase-by-phase in the UI

**Current architecture note** (shown in the info box on the page):

| Phase | Status | What it does |
|-------|--------|-------------|
| **Phase 0** | Active | Extract hard requirements (thresholds, invariants, routing rules, side-effect constraints) |
| **Phase 1** | **SKIPPED** | Semantic planning - removed as noise (Enhanced Prompt already has all data) |
| **Phase 2** | **SKIPPED** | Grounding - removed as noise (Enhanced Prompt already has all data) |
| **Phase 3** | Active | IR formalization (directly from Enhanced Prompt) with Gate 3 auto-fix |
| **Phase 4** | Active | Execution graph compilation with Gate 4 validation |
| **Phase 5** | Active | DSL-to-PILOT translation (flat array format) with Gate 5 final validation |

**Improvement over previous architecture**: -35% tokens, -33% time, +150% signal-to-noise ratio (by skipping P1 & P2).

### How Phase 1 & 2 Are Skipped (Code-Level Detail)

There is **no feature flag** controlling this. The skip is implemented as a **block comment** (`/* ... */`) wrapping the entire Phase 1 and Phase 2 code inside the orchestrator class.

**File**: [`lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts`](lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts)

The `run()` method of `V6PipelineOrchestrator` has this structure:

```
Phase 0: Extract Hard Requirements           ← runs normally
                                              ↓
/* PHASES 1 & 2 SKIPPED                       ← block comment starts (line ~143)
   Phase 1: SemanticPlanGenerator.generate()
   Gate 1:  ValidationGates.validateSemanticPlan()
   Phase 2: Mock grounded plan creation
   Gate 2:  ValidationGates.validateGrounding()
*/                                            ← block comment ends (line ~286)
                                              ↓
Phase 3: IRFormalizer.formalize()             ← runs normally, receives Enhanced Prompt DIRECTLY
                                                 (instead of the semantic/grounded plan)
Phase 4: ExecutionGraphCompiler.compile()     ← runs normally
Phase 5: translateToPilotFormat()             ← runs normally
```

**What the comment says** (verbatim from code):

> PHASES 1 & 2 SKIPPED - ENHANCED PROMPT HAS ALL NEEDED INFO
>
> These phases just rephrase what's already in Enhanced Prompt:
> - sections.data, actions, output, delivery already provide semantic understanding
> - Grounding is mocked for API workflows (returns empty data)
>
> We now pass Enhanced Prompt DIRECTLY to Phase 3 (IR Formalization).
> This eliminates ~3500 tokens of noise and 15-30 seconds of LLM time.
>
> IMPORTANT: Do NOT delete this code until we achieve "golden gate" (90%+ success)!

**How the skip is handled downstream:**

1. **Phase 3** calls `formalizer.formalize(enhancedPrompt, hardReqs)` — passes the raw Enhanced Prompt directly instead of a semantic/grounded plan
2. **Requirement map** is updated from the IR's own `requirements_enforcement` tracking instead of flowing through Gates 1 & 2 (a "Week 1 fix" comment in the code)
3. **Gate results** for Phases 1 & 2 are created as dummy PASS values at the end of the pipeline:
   - Gate 1 (semantic): `{ result: 'PASS', reason: 'SKIPPED (Week 1: Enhanced Prompt used directly)' }`
   - Gate 2 (grounding): `{ result: 'PASS', reason: 'SKIPPED (Week 1: Grounding not needed for API workflows)' }`
4. **Intermediate outputs** for P1 and P2 are returned as `undefined` (`semanticPlan: undefined, groundedPlan: undefined`)

**The HTML test page** reflects this: the info box shows P1 & P2 as struck-through, and when results are displayed, Phase 1 shows "Semantic planning completed" with no data, and Phase 2 shows "Skipped (API workflow)".

**Legacy path**: The same API route (`/api/v6/generate-ir-semantic`) also contains a **legacy non-orchestrator path** (triggered when `use_v6_orchestrator` is NOT set) that still runs all 5 phases sequentially. The test page always sets `use_v6_orchestrator: true`, so it always takes the orchestrator path with P1 & P2 skipped.

**To re-enable Phase 1 & 2**: Uncomment the block comment in `V6PipelineOrchestrator.ts` (lines ~143-286), remove the dummy gate results (lines ~567-569), and change `semanticPlan: undefined` / `groundedPlan: undefined` back to their actual values.

**API request:**
```json
POST /api/v6/generate-ir-semantic
{
  "enhanced_prompt": { "sections": {...} },
  "userId": "offir.omer@gmail.com",
  "use_v6_orchestrator": true
}
```

#### Mode 2: "Run with Validation & Auto-Recovery" (`runValidatedPipeline()`)

An alternative mode that uses a dedicated validated endpoint with explicit gate checking.

**API request:**
```json
POST /api/v6/generate-workflow-validated
{
  "enhanced_prompt": { "sections": {...} },
  "config": {
    "provider": "anthropic",
    "model": "claude-opus-4-5-20251101",
    "temperature": 0.1
  }
}
```

**Key difference**: This mode passes an explicit model config override (hardcoded to Claude Opus 4.5), whereas Mode 1 defers to the admin configuration.

---

### Pipeline Phase Display (6 Phases)

When you click **Run Full Pipeline**, the page shows progress through all 6 phases:

```
+--------------------------------------------------------------+
|  Phase 0: Requirements Extraction         [Foundational]      |
|  +-- Requirements count, enforced count                       |
|  +-- Unit of Work, Thresholds, Invariants                     |
|  +-- Full JSON output with [Copy] button                      |
+--------------------------------------------------------------+
|  Phase 1: Semantic Planning               [Gate 1]            |
|  +-- Completed or data shown (may be skipped)                 |
+--------------------------------------------------------------+
|  Phase 2: Grounding                       [Gate 2]            |
|  +-- Completed or "Skipped (API workflow)"                    |
+--------------------------------------------------------------+
|  Phase 3: IR Formalization + Auto-Recovery [Gate 3: Auto-Fix] |
|  +-- IR JSON output with [Copy] button                        |
+--------------------------------------------------------------+
|  Phase 4: DSL Compilation                 [Gate 4]            |
|  +-- Compilation Logs (expandable)                            |
|  +-- Compilation Errors (expandable, if any)                  |
|  +-- DSL before translation JSON with [Copy] button           |
+--------------------------------------------------------------+
|  Phase 5: PILOT Workflow (Production)     [Gate 5: Final]     |
|  +-- Step count, All Gates status, Format info                |
|  +-- Final PILOT workflow JSON with [Copy] button             |
+--------------------------------------------------------------+
|  Requirements Enforcement Summary                             |
|  +-- Gate 1-5 pass/fail status                                |
|  +-- Enforced requirements count vs total                     |
+--------------------------------------------------------------+
```

### Phase 0 Metrics

Phase 0 displays detailed requirement extraction results:

| Metric | Description |
|--------|-------------|
| **Total Requirements** | Number of hard requirements extracted |
| **Enforced** | How many were successfully enforced in the final workflow |
| **Unit of Work** | The atomic unit the workflow operates on (e.g., "email message") |
| **Thresholds** | Numeric boundaries extracted (e.g., "last 7 days") |
| **Invariants** | Rules that must always hold (e.g., "no duplicates") |

### Phase 4 Expandable Logs

Phase 4 shows two expandable sections when relevant:
- **Compilation Logs** - informational messages from the compiler (e.g., step transformations)
- **Compilation Errors** - issues encountered during compilation (shown in red)

### Phase Status Indicators

| Status | Meaning |
|--------|---------|
| Pending | Phase not yet started |
| Running | Phase currently executing |
| Done | Phase completed successfully |

### Copy Buttons

Each phase has a **"Copy"** button in the top-right corner of its JSON output. Click to copy that phase's JSON to clipboard. The button shows "Copied!" feedback for 1.5 seconds.

### Success Output

On successful completion, a summary bar shows:
- Step count
- Requirements enforced (e.g., "3/4 enforced")
- Execution time in ms
- Format confirmation (PILOT Flat Array)

### Action Buttons (After Successful Compilation)

| Button | Action |
|--------|--------|
| **Save to Browser** | Save workflow to localStorage for later use |
| **Download All Phases** | Download complete JSON file with all phase outputs |
| **Go to Execution** | Switch to Execution tab to run the workflow |
| **Create Agent** | Switch to Create Agent tab to persist as a database agent |

### Download All Phases

The **"Download All Phases"** button downloads a single JSON file containing:

```json
{
  "metadata": {
    "userId": "...",
    "compiledAt": "2026-02-20T12:30:45.000Z",
    "pipeline_version": "v6_orchestrator",
    "execution_time_ms": 4500,
    "stepsCount": 5,
    "requirements_enforced": "3/4",
    "gates_passed": 5
  },
  "enhanced_prompt_input": {...},
  "phase0_hard_requirements": {...},
  "phase1_semantic_plan": {...},
  "phase2_grounded_plan": {...},
  "phase3_ir": {...},
  "phase4_dsl_before_translation": {...},
  "phase5_pilot_workflow": [...],
  "requirement_map": {...},
  "validation_results": {...}
}
```

**Filename format**: `v6-pipeline-output-YYYY-MM-DDTHH-MM-SS.json`

---

## Tab 2: Execution

### Purpose

Execute compiled workflows against real plugin connections.

### Two Input Methods

#### Method 1: Use Compiled Workflow

After running the Compilation tab, the workflow is automatically loaded into the Execution tab. Click **"Go to Execution"** from the compilation success bar.

#### Method 2: Direct JSON Input

Paste workflow steps JSON directly into the textarea:

```json
[
  {
    "step_id": "step1",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {
      "query": "newer_than:7d",
      "max_results": 100
    }
  },
  {
    "step_id": "step2",
    "type": "filter",
    "input": "{{step1.data.emails}}",
    "conditions": [...]
  }
]
```

Click **"Load & Prepare for Execution"** to parse and validate the JSON.

### Workflow Editor

Once a workflow is loaded (from compilation or direct JSON), the Execution tab shows:
- **Workflow info summary** (step count, user ID, goal)
- **Inline JSON editor** where you can modify steps before execution
- **Reset to Original** button to revert edits
- **Apply Edits** button to validate and apply changes

### Execution Controls

| Button | Action |
|--------|--------|
| **Load & Prepare for Execution** | Parse direct JSON input and prepare |
| **Reset to Original** | Restore workflow to pre-edit state |
| **Apply Edits** | Validate edited JSON and apply |
| **Execute Workflow** | Run workflow against real plugins |
| **Load Different Workflow** | Return to JSON input mode |

### Execution Results

Shows detailed execution metrics:

| Metric | Description |
|--------|-------------|
| Steps Completed | Number of successfully executed steps |
| Steps Failed | Number of failed steps |
| Execution Time | Total time in milliseconds |
| Tokens Used | LLM tokens consumed (if applicable) |

Also displays:
- List of completed step IDs (in green)
- List of failed step IDs (in red, if any)
- Full execution results JSON (expandable)

### API Endpoint Called

```
POST /api/v6/execute-test
```

Request body:
```json
{
  "workflow": [...],           // Workflow steps array
  "plugins_required": [...],   // Auto-extracted from step.plugin fields
  "user_id": "...",            // User for plugin auth
  "workflow_name": "...",      // From IR goal or "Test Workflow"
  "input_variables": {}        // Runtime variables (empty by default)
}
```

---

## Tab 3: Saved Workflows

### Purpose

Persist workflows to browser localStorage for later use. This is **client-side only** - nothing is saved to a database or server (use the Create Agent tab for that).

### How It Works

The **"Save to Browser"** button (appears after successful compilation) saves the compiled workflow to browser localStorage, allowing you to:

1. **Compile once, execute later** - No need to re-run the pipeline
2. **Persist across sessions** - Close browser, come back later
3. **Quick iteration** - Edit and re-execute without recompiling

### Typical Use Case

```
1. Run the pipeline -> compile a workflow
2. Click "Save to Browser" -> saves to localStorage
3. Close the page or browser
4. Come back later -> go to "Saved" tab
5. Click "Load & Execute" -> loads the saved workflow
6. Execute without re-compiling
```

### Storage Key

Workflows are stored in `localStorage` under the key: `v6_saved_workflow`

### Saved Workflow Structure

```json
{
  "workflow_steps": [...],
  "hard_requirements": {...},
  "requirement_map": {...},
  "validation_results": {...},
  "userId": "...",
  "compiledAt": "2026-02-20T...",
  "pipeline_version": "v6_orchestrator"
}
```

### Controls

| Button | Action |
|--------|--------|
| **Load & Execute** | Load saved workflow into Execution tab and switch to it |
| **Clear Saved** | Delete saved workflow (with confirmation dialog) |

### Workflow Info Displayed

When a workflow is saved:
- Number of steps
- Goal (from IR)
- User ID
- Save timestamp
- Expandable JSON view of workflow steps

---

## Tab 4: Diagnostics

### Purpose

Test system components and verify configuration.

### Tests Performed

| Test | What it checks |
|------|----------------|
| **LocalStorage** | Browser storage read/write availability |
| **Saved Workflow** | Presence and step count of saved workflow in storage |
| **Current Workflow** | Whether a workflow is loaded in memory (from compilation) |
| **Compile API** | `/api/v6/compile-declarative` endpoint reachability (OPTIONS request). **Note**: This route is currently disabled (`route.ts.disabled`) — this check will fail, which is expected. Compilation is handled internally by the orchestrator mode. |

### Results Table

Shows for each test:
- Test name
- Status (OK, Warning, Failed)
- Additional details or error messages

---

## Tab 5: Create Agent

### Purpose

Persist a compiled workflow as an agent record in the Supabase database, making it available for scheduled execution and management via the main AgentPilot UI.

### Prerequisites

- A compiled workflow must exist (run the Compilation tab first)
- If no workflow is compiled, the tab shows a warning: "No compiled workflow found. Run the pipeline in the Compilation tab first."

### Input Fields

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| **Agent Name** | Yes | Display name for the agent | `Urgent Email Monitor` |
| **User Prompt** | No | What the user originally asked for | `Monitor my Gmail for urgent emails and log them to a Google Sheet` |
| **Description** | No | Short description of what the agent does | `Checks Gmail inbox every day for complaint/refund emails` |
| **Status** | Yes | Initial status | `active` (default) or `draft` |

### User ID Validation

The User ID (set in the Compilation tab) **must be a UUID**, not an email address. The `agents` table requires a UUID referencing `auth.users`. If you enter an email, the page will show an error:

> "User ID must be a UUID (e.g. 08456106-aa50-4810-b12c-7ca84102da31), not an email."

### What Gets Saved

The agent record includes:
- `agent_name`, `status`, `description`, `user_prompt`
- `pilot_steps` and `workflow_steps` - the compiled PILOT workflow
- `connected_plugins` and `plugins_required` - auto-extracted from workflow step plugin fields
- `created_from_prompt` - from the IR goal (if available)

### API Endpoint Called

```
POST /api/create-agent
Headers: { "x-user-id": "<uuid>" }
```

Request body:
```json
{
  "agent": {
    "agent_name": "Urgent Email Monitor",
    "status": "active",
    "user_prompt": "...",
    "description": "...",
    "pilot_steps": [...],
    "workflow_steps": [...],
    "connected_plugins": ["google-mail", "google-sheets"],
    "plugins_required": ["google-mail", "google-sheets"],
    "created_from_prompt": "..."
  }
}
```

### Success Output

On successful agent creation, displays:
- Agent ID (UUID)
- Agent name
- Status
- Pilot steps count
- Expandable full API response JSON

The created agent ID is stored in `window.createdAgentId` for reference.

---

## Technical Details

### Client-Side State

```javascript
// Current workflow in memory (set after compilation or loading)
window.currentWorkflow = {
  workflow_steps: [...],          // PILOT workflow steps array
  hard_requirements: {...},       // Phase 0 output
  requirement_map: {...},         // Requirement enforcement tracking
  validation_results: {...},      // Gate pass/fail results
  userId: "...",
  compiledAt: "...",
  pipeline_version: "v6_orchestrator"
}

// All phase outputs (set after compilation, used for download)
window.allPhaseOutputs = {
  metadata: {...},
  enhanced_prompt_input: {...},
  phase0_hard_requirements: {...},
  phase1_semantic_plan: {...},
  phase2_grounded_plan: {...},
  phase3_ir: {...},
  phase4_dsl_before_translation: {...},
  phase5_pilot_workflow: [...],
  requirement_map: {...},
  validation_results: {...}
}

// Original workflow steps (for reset functionality in editor)
window.originalWorkflowSteps = [...]

// Created agent ID (set after Create Agent succeeds)
window.createdAgentId = "uuid-..."
```

### LocalStorage Usage

| Key | Purpose |
|-----|---------|
| `v6_saved_workflow` | Persisted workflow data (Save to Browser) |
| `diag_test` | Temporary diagnostics test (set and deleted immediately) |

### API Calls Summary

| Endpoint | Tab | Purpose |
|----------|-----|---------|
| `GET /api/admin/agent-generation-config` | Compilation | Fetch admin model config for each phase |
| `POST /api/v6/generate-ir-semantic` | Compilation (Mode 1) | Full orchestrated pipeline (P0-P5) |
| `POST /api/v6/generate-workflow-validated` | Compilation (Mode 2) | Validated pipeline with auto-recovery |
| `POST /api/v6/execute-test` | Execution | Run workflow against real plugins |
| `POST /api/create-agent` | Create Agent | Persist workflow as agent in database |
| `OPTIONS /api/v6/compile-declarative` | Diagnostics | API reachability check *(route currently disabled — will fail)* |

---

## Usage Workflows

### Basic Testing Flow

1. **Open** the test page at `/test-v6-declarative.html`
2. **Enter** your User ID (must have plugin connections)
3. **Paste** or edit the Enhanced Prompt JSON
4. **Click** "Run Full Pipeline"
5. **Watch** Phase 0 extract requirements, then P3-P5 compile the workflow
6. **Review** each phase's output (expand JSON, use Copy buttons)
7. **Save** the workflow to browser if needed
8. **Switch** to Execution tab and **execute** against real plugins
9. **Review** execution results (steps completed/failed, timing)

### Creating an Agent from a Compiled Workflow

1. Run the pipeline successfully in the Compilation tab
2. Click **"Create Agent"** button in the success bar (or switch to Create Agent tab)
3. Enter the agent name (required) and optional prompt/description
4. **Important**: Change User ID to a UUID (not email) if needed
5. Click **"Create Agent"**
6. The agent is now in the database and visible in the main AgentPilot UI

### Debugging Flow

1. Run the full pipeline
2. Expand each phase box to view JSON output
3. **Phase 0**: Check that requirements were correctly extracted (thresholds, invariants)
4. **Phase 1/2**: Usually skipped - if shown, check semantic/grounding results
5. **Phase 3**: Check IR formalization - look for auto-fix messages
6. **Phase 4**: Expand **Compilation Logs** and **Compilation Errors** sections
7. **Phase 5**: Verify final PILOT format and validation gate results
8. **Requirements Summary**: Check enforced vs. total requirements count
9. Use **Diagnostics** tab to verify system health if API calls fail

### Re-executing Saved Workflows

1. Go to **Saved** tab
2. Click **Load & Execute** (switches to Execution tab automatically)
3. Optionally edit workflow JSON in the inline editor
4. Click **Execute Workflow**

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "User ID and Enhanced Prompt required" | Missing inputs | Fill in both fields |
| "V6 Pipeline failed: ..." | Server-side pipeline error | Check server logs, review prompt |
| "Validation failed" | A gate check did not pass (Mode 2) | Review phase boxes for details |
| "Invalid JSON" | Malformed JSON input | Validate JSON syntax |
| "No workflow to save" | Saving before compilation | Run pipeline first |
| "Agent name is required" | Creating agent without a name | Enter an agent name |
| "User ID must be a UUID..." | Email used instead of UUID for Create Agent | Use the auth.users UUID |

### Error Display

Errors are shown in red-bordered boxes with:
- Error title
- Error message
- For validated pipeline failures: additional note about auto-recovery failure

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [V6_OVERVIEW.md](./V6_OVERVIEW.md) | High-level V6 introduction |
| [V6_ARCHITECTURE.md](./V6_ARCHITECTURE.md) | Phase-by-phase technical details |
| [V6_API_REFERENCE.md](./V6_API_REFERENCE.md) | Complete API documentation |
| [V6_DEVELOPER_GUIDE.md](./V6_DEVELOPER_GUIDE.md) | Integration and debugging guide |

---

*V6 Pipeline Orchestrator - Neuronforge*
