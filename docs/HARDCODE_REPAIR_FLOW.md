# Hardcode Repair System - Flow Diagram

## End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER CREATES AGENT                          │
│  Agent has hardcoded values in pilot_workflow:                 │
│  - spreadsheet_id: "1pM8WbXtPgaYqokHn..."                      │
│  - filter: { status: "complaint" }                             │
│  - email: "support@example.com"                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              CALIBRATION PAGE - FIRST RUN                       │
│  User clicks "Run Calibration"                                 │
│  → POST /api/run-agent with execution_type: 'test'            │
│  → Polling starts to track execution status                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  EXECUTION FAILS                                │
│  Status: 'failed', summary.failed > 0                          │
│  → Polling detects failure                                     │
│  → Checks: hasTriedRepair === false ✓                          │
│  → Checks: agent.pilot_steps exists ✓                          │
│  → Triggers: detectHardcodedValues()                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              HARDCODE DETECTION (HardcodeDetector)              │
│  1. Recursively scans pilot_steps for all values               │
│  2. Applies pattern matching:                                  │
│     - Resource IDs (15+ chars alphanumeric)                    │
│     - Emails (regex match)                                     │
│     - URLs (http/https)                                        │
│  3. Analyzes context (parent keys):                            │
│     - "filter", "condition" → business_logic                   │
│     - "max", "limit" → configuration                           │
│  4. Categorizes by priority:                                   │
│     - Critical: Resource IDs used in multiple steps            │
│     - Medium: Business logic values                            │
│     - Low: Configuration values                                │
│  5. Returns DetectionResult with grouped values                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│          DETECTION RESULT (Example)                             │
│  resource_ids: [                                                │
│    {                                                            │
│      path: "step2.params.spreadsheet_id",                      │
│      value: "1pM8WbXtPgaYqokHn...",                           │
│      suggested_param: "spreadsheet_id",                        │
│      label: "Spreadsheet ID",                                  │
│      priority: "critical",                                     │
│      stepIds: ["step2", "step10"]                             │
│    },                                                           │
│    { /* email address */ }                                     │
│  ],                                                             │
│  business_logic: [                                              │
│    { value: "complaint", path: "step8.filter.status" },       │
│    { value: "refund", path: "step8.filter.category" }         │
│  ],                                                             │
│  configuration: [...]                                           │
│  total_count: 6                                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            REPAIR MODAL APPEARS (HardcodeRepairModal)           │
│                                                                 │
│  ╔═════════════════════════════════════════════════════════╗  │
│  ║  Hardcoded Values Detected                              ║  │
│  ║  We found 6 hardcoded values in your workflow.          ║  │
│  ╠═════════════════════════════════════════════════════════╣  │
│  ║                                                          ║  │
│  ║  [Critical - Resource IDs]                              ║  │
│  ║  ☑ Spreadsheet ID (critical)                            ║  │
│  ║    "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"       ║  │
│  ║    Used in: step2, step10                               ║  │
│  ║    New value: [________________]                        ║  │
│  ║                                                          ║  │
│  ║  ☑ Email Address (high)                                 ║  │
│  ║    "support@example.com"                                ║  │
│  ║    New value: [test@example.com___]                     ║  │
│  ║                                                          ║  │
│  ║  [Business Logic - Filters & Conditions]                ║  │
│  ║  ☐ Filter Status (medium)                               ║  │
│  ║    "complaint"                                           ║  │
│  ║                                                          ║  │
│  ║  ☐ Filter Category (medium)                             ║  │
│  ║    "refund"                                              ║  │
│  ║                                                          ║  │
│  ║  [Configuration - Optional Settings]                    ║  │
│  ║  ☐ Named Range (low)                                    ║  │
│  ║    "Sheet1!A1:Z"                                         ║  │
│  ║                                                          ║  │
│  ╠═════════════════════════════════════════════════════════╣  │
│  ║  [Cancel]              [Save & Repair Agent]            ║  │
│  ╚═════════════════════════════════════════════════════════╝  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              USER SELECTS & PROVIDES VALUES                     │
│  Selected:                                                      │
│    - spreadsheet_id → "TEST_SHEET_123"                         │
│    - email_to → "test@example.com"                             │
│  Clicks: "Save & Repair Agent"                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│        API CALL: POST /api/agents/[id]/repair-hardcode          │
│  Request Body:                                                  │
│  {                                                              │
│    selections: [                                                │
│      {                                                          │
│        path: "step2.params.spreadsheet_id",                    │
│        param_name: "spreadsheet_id",                           │
│        value: "TEST_SHEET_123",                                │
│        original_value: "1pM8WbXtPgaYqokHn..."                 │
│      },                                                         │
│      { /* email */ }                                           │
│    ]                                                            │
│  }                                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           REPAIR ENDPOINT PROCESSING                            │
│  1. Fetch agent from database                                  │
│  2. Get current pilot_steps                                    │
│  3. Call HardcodeDetector.applyParameterization():             │
│     - Replace "1pM8WbXtPgaYqokHn..." with "{{input.spreadsheet_id}}"
│     - Replace "support@example.com" with "{{input.email_to}}"  │
│  4. Build new input_schema fields:                             │
│     - { name: "spreadsheet_id", type: "text", ... }            │
│     - { name: "email_to", type: "email", ... }                 │
│  5. Update agents table:                                       │
│     - pilot_steps = repaired_steps                             │
│     - input_schema = merged_schema                             │
│  6. Save test values to agent_configurations:                  │
│     - input_values = { spreadsheet_id: "TEST_SHEET_123", ... } │
│  7. Return success response                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         CALIBRATION PAGE - REPAIR COMPLETE                      │
│  1. Close modal                                                 │
│  2. Set hasTriedRepair = true (don't show again)               │
│  3. Update inputValues state with new values                   │
│  4. Save to session storage                                    │
│  5. Reload agent from database (get updated pilot_steps)       │
│  6. Automatically call handleRun() to retry execution          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXECUTION RETRIES WITH NEW VALUES                  │
│  POST /api/run-agent                                           │
│  {                                                              │
│    agent_id: "...",                                            │
│    execution_type: "test",                                     │
│    input_variables: {                                          │
│      spreadsheet_id: "TEST_SHEET_123",                        │
│      email_to: "test@example.com"                             │
│    }                                                            │
│  }                                                              │
│                                                                 │
│  → WorkflowPilot resolves variables:                           │
│     "{{input.spreadsheet_id}}" → "TEST_SHEET_123"             │
│  → Execution runs with parameterized values                    │
│  → Success! ✓                                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CALIBRATION SUCCESS                           │
│  Agent now has:                                                 │
│  ✓ Parameterized workflow (no hardcoded values)                │
│  ✓ Updated input_schema with new parameters                    │
│  ✓ Test values saved in agent_configurations                   │
│  ✓ Can be tested with different values easily                  │
│                                                                 │
│  User can now:                                                  │
│  - Change test values in calibration page                      │
│  - Run multiple calibration tests with different data          │
│  - Go live with production values                              │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features Illustrated

### 1. Automatic Detection
- Triggers on first failure
- No user intervention needed
- Generic, plugin-agnostic

### 2. Smart Categorization
- **Critical**: Must fix (auto-selected)
- **Medium**: Should review
- **Low**: Optional

### 3. User-Friendly UI
- Grouped by priority
- Shows original values
- Clear input fields
- Explains what will happen

### 4. Seamless Repair
- One-click repair
- Automatic retry
- No manual steps

### 5. Persistent Changes
- Updates database
- Saves test values
- Ready for future runs

## State Flow

```
hasTriedRepair: false
        │
        ▼
 [Execution Fails]
        │
        ▼
 detectHardcodedValues()
        │
        ▼
detectionResult: { ... }
showRepairModal: true
        │
        ▼
 [User Repairs]
        │
        ▼
hasTriedRepair: true
showRepairModal: false
inputValues: { new values }
        │
        ▼
 [Auto Retry]
        │
        ▼
   [Success!]
```

## Error Handling

```
Detection Fails
     │
     ▼
  Log Error
     │
     ▼
Don't Show Modal
     │
     ▼
User Can Still Calibrate
(Just won't get auto-repair)

─────────────────────────

Repair API Fails
     │
     ▼
Show Error Message
     │
     ▼
Keep Modal Open
     │
     ▼
User Can Retry or Cancel

─────────────────────────

User Dismisses Modal
     │
     ▼
hasTriedRepair = true
     │
     ▼
Won't Show Again
(This Session)
```
