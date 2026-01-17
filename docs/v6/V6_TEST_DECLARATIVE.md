# V6 Test Page - Declarative Pipeline Tester

> **URL**: `/test-v6-declarative.html`

This document covers the V6 Declarative Pipeline Test Page, a comprehensive UI for testing the V6 agent generation system.

## Overview

The test page provides a visual interface for:
- Running the complete 5-phase V6 pipeline
- Viewing intermediate results from each phase
- Executing compiled workflows against real plugins
- Saving and loading workflows for later use
- Running system diagnostics

## Accessing the Test Page

```
http://localhost:3000/test-v6-declarative.html
```

The page is located at `public/test-v6-declarative.html`.

---

## Getting an Enhanced Prompt from Thread Conversation

The V6 pipeline requires an **Enhanced Prompt** as input. You can generate one using the Thread Conversation flow in `/test-plugins-v2`:

### Workflow: test-plugins-v2 → V6 Declarative

1. **Open test-plugins-v2**: Navigate to `/test-plugins-v2`
2. **Go to Thread Conversation tab** (Tab 3)
3. **Start a thread** with your automation request
4. **Complete Phase 1** (Analysis) and **Phase 2** (Clarification Questions)
5. **Reach Phase 3** (Enhanced Prompt) - you'll see the generated plan
6. **Expand "View Full Enhanced Prompt JSON"**
7. **Click "📋 Copy Enhanced Prompt JSON"** button
8. **Open V6 Declarative page**: Navigate to `/test-v6-declarative.html`
9. **Paste** the JSON into the "Enhanced Prompt (JSON)" textarea
10. **Run the V6 Pipeline**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         test-plugins-v2                                  │
│  Thread Conversation Tab                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Phase 1: Analysis → Phase 2: Questions → Phase 3: Enhanced Prompt│   │
│  │                                              │                    │   │
│  │                                              ▼                    │   │
│  │                                   [📋 Copy Enhanced Prompt JSON] │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Paste
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       test-v6-declarative.html                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Enhanced Prompt (JSON): [paste here]                             │   │
│  │                                                                   │   │
│  │ [🚀 Run Full Pipeline]                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tab Navigation

The interface has four main tabs:

| Tab | Icon | Purpose |
|-----|------|---------|
| **Compilation** | 🚀 | Run the full 5-phase pipeline |
| **Execution** | ▶️ | Execute compiled workflows |
| **Saved** | 💾 | Manage saved workflows |
| **Diagnostics** | 🔍 | System health checks |

---

## Tab 1: Compilation (Full Pipeline)

### Purpose
Test the complete V6 generation pipeline from Enhanced Prompt to executable PILOT DSL.

### Input Fields

| Field | Description | Example |
|-------|-------------|---------|
| **User ID** | User identifier for plugin authentication | `offir.omer@gmail.com` |
| **Enhanced Prompt** | JSON object with sections structure | See below |

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

### Pipeline Phases Displayed

When you click **Run Full Pipeline**, the page shows progress through all 5 phases:

```
┌─────────────────────────────────────────────────────────┐
│  Phase 1: Understanding                                  │
│  ├── Status: ⚡ Running / ✅ Done                        │
│  └── Output: Semantic Plan JSON                         │
├─────────────────────────────────────────────────────────┤
│  Phase 2: Grounding                                      │
│  ├── Status: ⚡ Running / ✅ Done / Skipped             │
│  └── Output: Grounded Plan with validated fields        │
├─────────────────────────────────────────────────────────┤
│  Phase 3: Formalization                                  │
│  ├── Status: ⚡ Running / ✅ Done                        │
│  └── Output: Declarative IR JSON                        │
├─────────────────────────────────────────────────────────┤
│  Phase 4: Compilation                                    │
│  ├── Status: ⚡ Running / ✅ Done                        │
│  └── Output: Workflow Steps array                       │
├─────────────────────────────────────────────────────────┤
│  Phase 5: Final PILOT DSL                               │
│  ├── Status: ⚡ Running / ✅ Done                        │
│  └── Output: Complete DSL with validation status        │
└─────────────────────────────────────────────────────────┘
```

### Phase Status Indicators

| Status | Meaning |
|--------|---------|
| ⏳ Pending | Phase not yet started |
| ⚡ Running | Phase currently executing |
| ✅ Done | Phase completed successfully |

### API Endpoints Called

1. **Phase 1-3**: `POST /api/v6/generate-ir-semantic`
   - Generates semantic plan, grounds it, and formalizes to IR
   - Returns intermediate results for each phase

2. **Phase 4-5**: `POST /api/v6/compile-declarative`
   - Compiles IR to PILOT DSL
   - Returns workflow steps and validation status

### Success Output

On successful completion:
- Shows step count, compiler used, and compilation time
- Provides buttons to **Save Workflow** or **Go to Execution**
- Stores workflow in `window.currentWorkflow` for execution

---

## Tab 2: Execution

### Purpose
Execute compiled workflows against real plugin connections.

### Two Input Methods

#### Method 1: Use Compiled Workflow
After running the compilation tab, the workflow is automatically available for execution.

#### Method 2: Direct JSON Input
Paste workflow steps JSON directly:

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

### Workflow Editor

The execution tab includes an inline JSON editor that allows you to:
- View the workflow steps
- Edit parameters before execution
- Reset to original workflow
- Apply edits and validate JSON

### Execution Controls

| Button | Action |
|--------|--------|
| **Load & Prepare** | Parse JSON and prepare for execution |
| **Reset to Original** | Restore workflow to pre-edit state |
| **Apply Edits** | Validate and apply JSON changes |
| **Execute Workflow** | Run workflow against real plugins |
| **Load Different** | Return to JSON input mode |

### Execution Results

Shows detailed execution metrics:

| Metric | Description |
|--------|-------------|
| Steps Completed | Number of successfully executed steps |
| Steps Failed | Number of failed steps |
| Execution Time | Total time in milliseconds |
| Tokens Used | LLM tokens consumed (if applicable) |

Also displays:
- List of completed step IDs
- List of failed step IDs (if any)
- Full execution results JSON (expandable)

### API Endpoint Called

`POST /api/v6/execute-test`

Request body:
```json
{
  "workflow": [...],           // Workflow steps array
  "plugins_required": [...],   // Auto-extracted plugin names
  "user_id": "...",           // User for plugin auth
  "workflow_name": "...",     // From IR goal
  "input_variables": {}       // Runtime variables
}
```

---

## Tab 3: Saved Workflows

### Purpose
Persist workflows to browser localStorage for later use.

### Storage Key
Workflows are stored in `localStorage` under the key: `v6_saved_workflow`

### Saved Workflow Structure

```json
{
  "dsl": {...},                    // Full PILOT DSL
  "workflow_steps": [...],         // Steps array
  "ir": {...},                     // Original IR
  "userId": "...",                 // User ID
  "compiledAt": "2026-01-16T..."   // Timestamp
}
```

### Controls

| Button | Action |
|--------|--------|
| **Load & Execute** | Load saved workflow into execution tab |
| **Clear Saved** | Delete saved workflow (with confirmation) |

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
| **LocalStorage** | Browser storage availability |
| **Saved Workflow** | Presence of saved workflow in storage |
| **Current Workflow** | Workflow loaded in memory |
| **Compile API** | `/api/v6/compile-declarative` endpoint reachability |

### Results Table

Shows for each test:
- Test name
- Status (✅ OK, ⚠️ Warning, ❌ Failed)
- Additional details or error messages

---

## Architecture Improvements Banner

The page header displays active V6 improvements:

| Improvement | Description |
|-------------|-------------|
| **Phase 1: Variable Fix** | Correct `.data.` prefix in variable references |
| **Phase 3: Strict Schema** | Automatic retry on schema validation failures |
| **Phase 4: Transforms** | Post-processing (simplify conditions, transform scatter) |
| **Phase 5: DSL + Validation** | Final DSL generation with validation |

---

## Pipeline Flow Visualization

The header shows the complete pipeline flow:

```
📝 Input → P1: Understanding → P2: Grounding → P3: Formalization → P4: Compilation → P5: DSL + Validation → ✅ Execution
```

---

## Usage Workflow

### Basic Testing Flow

1. **Open** the test page at `/test-v6-declarative.html`
2. **Enter** your User ID (must have plugin connections)
3. **Paste** or edit the Enhanced Prompt JSON
4. **Click** "Run Full Pipeline"
5. **Watch** phases complete with visual feedback
6. **Review** each phase's output (expandable JSON)
7. **Save** the workflow if needed
8. **Switch** to Execution tab
9. **Execute** the workflow
10. **Review** execution results

### Debugging Flow

1. Run the full pipeline
2. Expand each phase box to view JSON output
3. Check Phase 1 for semantic understanding issues
4. Check Phase 2 for grounding failures (field matching)
5. Check Phase 3 for IR formalization problems
6. Check Phase 4 for compilation errors
7. Check Phase 5 for validation warnings
8. Use Diagnostics tab to verify system health

### Re-executing Saved Workflows

1. Go to **Saved** tab
2. Click **Load & Execute**
3. Switch to **Execution** tab
4. Optionally edit workflow JSON
5. Click **Execute Workflow**

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "User ID and Enhanced Prompt required" | Missing inputs | Fill in both fields |
| "Semantic plan failed" | Phase 1 LLM error | Check prompt structure |
| "Compilation failed" | Phase 4 error | Review IR for issues |
| "Invalid JSON" | Malformed JSON input | Validate JSON syntax |
| "No workflow to save" | Saving before compilation | Run pipeline first |

### Error Display

Errors are shown in red-bordered boxes with:
- Error title
- Error message
- (In development) Stack trace

---

## Technical Details

### Client-Side State

```javascript
// Current workflow in memory
window.currentWorkflow = {
  dsl: {...},
  workflow_steps: [...],
  ir: {...},
  userId: "...",
  compiledAt: "..."
}

// Original workflow for reset functionality
window.originalWorkflowSteps = [...]
```

### LocalStorage Usage

| Key | Purpose |
|-----|---------|
| `v6_saved_workflow` | Persisted workflow data |
| `diag_test` | Temporary diagnostics test (deleted immediately) |

### API Calls Summary

| Endpoint | Tab | Purpose |
|----------|-----|---------|
| `POST /api/v6/generate-ir-semantic` | Compilation | Phases 1-3 |
| `POST /api/v6/compile-declarative` | Compilation | Phases 4-5 |
| `POST /api/v6/execute-test` | Execution | Run workflow |
| `OPTIONS /api/v6/compile-declarative` | Diagnostics | API check |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [V6_OVERVIEW.md](./V6_OVERVIEW.md) | High-level V6 introduction |
| [V6_ARCHITECTURE.md](./V6_ARCHITECTURE.md) | Phase-by-phase technical details |
| [V6_API_REFERENCE.md](./V6_API_REFERENCE.md) | Complete API documentation |
| [V6_DEVELOPER_GUIDE.md](./V6_DEVELOPER_GUIDE.md) | Integration and debugging guide |

---

*V6 Agent Generation System - Neuronforge*
