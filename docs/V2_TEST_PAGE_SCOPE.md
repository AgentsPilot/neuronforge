# Test Plugins V2 Page - Complete Functionality Documentation

**Location:** `/app/test-plugins-v2/page.tsx`
**Route:** `/test-plugins-v2`
**Purpose:** Comprehensive testing interface for plugins, AI services, thread conversations, and free tier user management

---

## Overview

The Test Plugins V2 page is a multi-tabbed testing interface that provides developers and administrators with tools to test and manage various aspects of the NeuronForge system. It includes five main functional areas accessible through tabs:
1. **Plugins** - Plugin connectivity, authentication, and action execution
2. **AI Services** - Prompt analysis and enhancement testing
3. **Thread Conversation** - Multi-provider conversational agent creation workflow
4. **Free Tier Users** - User subscription and quota management
5. **Agent Execution** - Agent testing with debug mode and step visualization

---

## Tab 1: Plugins

### Purpose
Test plugin connectivity, authentication, and action execution for integrated third-party services.

### Features

#### 1.1 Plugin Management
- **View Available Plugins**: Lists all registered plugins from the system
- **Plugin Status Indicator**: Shows three connection states:
  - 🟢 **Connected** (green): Plugin is connected with valid token
  - 🟠 **Token Expired** (orange): Plugin connected but OAuth token has expired
  - 🔴 **Not Connected** (red): Plugin not connected for this user
- **Connect Plugin**: Initiates OAuth flow for plugin authentication
- **Disconnect Plugin**: Removes plugin connection for a user
- **Refresh Token**: Refreshes expired OAuth token without re-authentication (shown when token is expired)

**Supported Plugins:**
- Google Mail
- Google Drive
- Google Sheets
- Google Docs
- Google Calendar
- Slack
- HubSpot
- LinkedIn
- Airtable

#### 1.2 Action Testing
- **Select Plugin**: Dropdown to choose from available plugins
- **Select Action**: Dropdown showing all actions available for selected plugin
- **Parameters Editor**: JSON textarea with parameter templates pre-populated
- **Execute Action**: Runs the selected plugin action with provided parameters

**Parameter Templates Available:**
The system includes pre-configured JSON templates for common actions across all plugins:
- Google Mail: `send_email`, `search_emails`, `create_draft`
- Google Drive: `list_files`, `search_files`, `get_file_metadata`, `read_file_content`, `get_folder_contents`
- Google Sheets: `read_range`, `write_range`, `append_rows`, `create_spreadsheet`, `get_spreadsheet_info`
- Google Docs: `read_document`, `insert_text`, `append_text`, `create_document`, `get_document_info`
- Google Calendar: `list_events`, `create_event`, `update_event`, `delete_event`, `get_event_details`
- Slack: `send_message`, `read_messages`, `update_message`, `add_reaction`, `remove_reaction`, `create_channel`, `list_channels`, `list_users`, `get_user_info`, `upload_file`
- HubSpot: `get_contact`, `get_contact_deals`, `get_contact_activities`, `search_contacts`, `get_deal`
- LinkedIn: `get_profile`, `get_user_info`, `create_post`, `get_posts`, `get_organization`, `search_organizations`, `get_organization_posts`, `get_connections`
- Airtable: `list_bases`, `list_records`, `get_record`, `create_records`, `update_records`, `list_tables`, `upload_attachment`, `get_attachment_urls`

#### 1.3 Response Display
- **Last API Response**: Shows full JSON response from last action
- **Copy to Clipboard**: Quick copy button for response data
- **Auto-scroll**: Response appears in scrollable container

**API Endpoints Used:**
- `GET /api/plugins/available` - List all available plugins
- `GET /api/plugins/user-status` - Get user's plugin connection status (includes `active_expired` array)
- `POST /api/plugins/execute` - Execute a plugin action
- `POST /api/plugins/disconnect` - Disconnect a plugin
- `POST /api/plugins/refresh-token` - Refresh expired OAuth token for a plugin

---

## Tab 2: AI Services

### Purpose
Test AI-powered services for prompt analysis, enhancement, clarification question generation, and V5 workflow generation.

### Features

#### 2.1 AI Service Selection
Available AI services:
- **analyze-prompt-clarity**: Analyzes prompt clarity and completeness
- **enhance-prompt**: Enhances a prompt with additional context
- **generate-clarification-questions**: Generates questions to clarify vague prompts
- **test/analyze-prompt**: Test endpoint for prompt analysis with provider/model selection
- **generate-agent-v4**: V4 Agent generation (OpenAI 3-Stage Architecture)
- **test/generate-agent-v5-test-wrapper**: V5 Workflow Generator test endpoint

#### 2.2 Request Configuration
- **Request Body Editor**: JSON textarea for request configuration
- **Generate New Session ID**: Creates fresh UUID for `sessionId` field
- **Generate New Agent ID**: Creates fresh UUID for `agentId` field
- **Reset to Template**: Restores default template with new IDs
- **Import JSON**: Import JSON data into specific fields (enhancedPrompt, technicalWorkflow)

**AI Service Templates Include:**
```json
{
  "prompt": "User's automation request",
  "userId": "test_user_123",
  "sessionId": "<auto-generated-uuid>",
  "agentId": "<auto-generated-uuid>",
  "connected_plugins": {},
  "bypassPluginValidation": false
}
```

#### 2.3 Provider/Model Selection
For services that support it (`test/analyze-prompt`, `test/generate-agent-v5-test-wrapper`):
- **Provider Dropdown**: Select AI provider (OpenAI, Anthropic, Kimi)
- **Model Dropdown**: Dynamic list based on selected provider
- **Injection at Execution**: Provider/model are NOT stored in request body JSON, they are injected automatically when calling the API

#### 2.4 V5 Workflow Generator Test Wrapper

**Purpose:** Test the V5 LLM review flow for technical workflows.

**Input Options:**
1. **enhancedPrompt (stringified JSON)**: Full enhanced prompt from Phase 3
2. **technicalWorkflow**: Pre-built technical workflow steps for LLM review

**Request Body Structure:**
```json
{
  "enhancedPrompt": "<stringified JSON>",
  "technicalWorkflow": {
    "technical_workflow": []
  },
  "userId": "test_user_123"
}
```

**enhancedPrompt JSON Structure:**
```json
{
  "sections": {
    "data": ["..."],
    "output": ["..."],
    "actions": ["..."],
    "delivery": ["..."],
    "processing_steps": ["..."]
  },
  "specifics": {
    "services_involved": ["google-sheets", "google-mail"],
    "resolved_user_inputs": [
      { "key": "user_email", "value": "user@example.com" }
    ],
    "user_inputs_required": []
  },
  "plan_title": "Workflow Title",
  "plan_description": "Workflow description..."
}
```

**Auto-Extraction Features:**
- `required_services`: Auto-extracted from `enhancedPrompt.specifics.services_involved`
- `technicalWorkflow.enhanced_prompt`: Auto-populated from enhancedPrompt (plan_title, plan_description, specifics)
- `technicalWorkflow.analysis`: Auto-generated from plan_title/description
- `provider` and `model`: Injected from dropdown selectors (not in request body)

**Supports Both String and Object for technicalWorkflow:**
- Can be provided as stringified JSON string
- Can be provided as JavaScript object
- API automatically parses if string

**Validation Errors:**
Returns clear error messages with `missingFields` array when required values are missing:
- `userId`, `provider`, `model` - Top-level required fields
- `plan_title`, `plan_description`, `specifics.resolved_user_inputs` - Required in enhancedPrompt
- `specifics.services_involved` - Required for required_services extraction

#### 2.5 Execution & Response
- **Execute AI Service**: Calls the selected AI endpoint
- **Response Display**: Shows full AI service response
- **Copy to Clipboard**: Quick copy functionality
- **Scrollable Output**: Max height container with overflow

**API Endpoints Used:**
- `POST /api/analyze-prompt-clarity`
- `POST /api/enhance-prompt`
- `POST /api/generate-clarification-questions`
- `POST /api/test/analyze-prompt`
- `POST /api/generate-agent-v4`
- `POST /api/test/generate-agent-v5-test-wrapper`

---

## Tab 3: Thread Conversation

### Purpose
Test the complete conversational agent creation workflow with phase-based processing using multi-provider AI support.

### Features

#### 3.1 Session Info Panel
- **Thread ID**: Shows current thread identifier
- **Current Phase**: Displays phase 1, 2, 3, or 4
- **AI Provider**: Shows selected provider (OpenAI/Anthropic/Kimi) and model
- **Mini-Cycle Indicator**: Shows when refinement mini-cycle is active
- **Clarity Score**: Percentage showing prompt clarity
- **API Calls Tracked**: Count of all API communications
- **Download JSON**: Export all API communications as JSON file

**Captured Communications Include:**
- Init Thread calls
- Phase 1 calls (Analysis)
- Phase 2 calls (Clarification Questions)
- Phase 3 calls (Enhanced Prompt Generation)
- Phase 4 calls (Technical Workflow Generation)

#### 3.2 Start New Thread
- **AI Provider Selection**: Dropdown to choose provider (OpenAI, Anthropic, Kimi)
- **Model Selection**: Dynamic dropdown with models for selected provider
- **Initial Prompt Input**: Textarea for user's automation request
- **Start Thread**: Initiates the thread and begins Phase 1

**Supported AI Providers and Models:**

**OpenAI:**
- GPT-5.2, GPT-5.2 Pro (Latest, Highest Accuracy)
- GPT-5.1 (Flagship)
- GPT-5, GPT-5 Mini, GPT-5 Nano (Advanced Reasoning)
- GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano (Coding, 1M Context)
- o3, o4-mini (Powerful/Fast Reasoning)
- GPT-4o, GPT-4o Mini (Multimodal)
- GPT-4 Turbo, GPT-4, GPT-3.5 Turbo (Legacy)

**Anthropic:**
- Claude 4.5 Opus, Sonnet, Haiku (Latest: Most Intelligent/Best Balance/Fastest)
- Claude 4.1 Opus (Agentic)
- Claude 4 Opus, Sonnet (Coding/Reasoning)
- Claude 3.7 Sonnet (Hybrid)
- Claude 3.5 Sonnet, Haiku (Legacy)
- Claude 3 Opus, Sonnet, Haiku (Legacy/Retired/Budget)

**Kimi:**
- Kimi K2 Preview, K2 Thinking, K2 Original (Latest, 256K/128K context)
- Kimi K1.5, K1.5 Long (Multimodal, Step-by-Step)
- Kimi Linear (1M Context, 6x Faster)
- Kimi Dev (Coding, SWE-bench)
- Kimi VL (Vision-Language)

Example prompts:
```
"Send me weekly email summaries of my boss's emails to Slack"
"Create an automation that tracks project tasks"
"Monitor my calendar and send daily updates"
```

#### 3.3 Conversation History
- **Message Display**: Shows alternating user/assistant messages
- **User Messages**: Blue background with left border
- **Assistant Messages**: Yellow background with left border
- **Data Expansion**: Collapsible details showing structured data
- **Auto-scroll**: Automatically scrolls to newest messages when conversation updates

#### 3.4 Phase 2 - Clarification Questions
- **Question Display**: Shows current question with context
- **Theme/Dimension Info**: Shows categorization of question
- **Answer Input**: Textarea for user response
- **Progress Indicator**: "Question X of Y"
- **Submit Answer**: Advances to next question or Phase 3

**Mini-Cycle Detection:**
When Phase 3 detects `user_inputs_required` in the enhanced prompt, the system automatically:
1. Stores Phase 3 result
2. Sets mini-cycle flag
3. Re-runs Phase 2 to ask refinement questions
4. Generates refined Phase 3 output

#### 3.5 Phase 3 - Enhanced Prompt

**Feature Flag Behavior:**
When `NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true`, the Phase 4 buttons are hidden and only the V6 Intent Validation flow is available. This is controlled by the `useV6AgentGeneration()` feature flag from `@/lib/utils/featureFlags`.

- **Plan Title & Description**: High-level overview
- **Workflow Sections**:
  - Data sources
  - Actions to perform
  - Processing steps (bulleted list)
  - Output format
  - Delivery method
  - Error handling
- **Specifics**:
  - Services involved
  - User inputs required
  - Trigger scope
- **Full JSON**: Expandable section with complete enhanced prompt
- **Analysis Data**: Expandable section with analysis details

**Action Buttons:**
- **Accept Plan**: Marks plan as ready for implementation
- **Refine Further**: Returns to Phase 2 for additional questions (v8 feature)
- **Generate Technical Workflow**: Triggers Phase 4 to generate executable workflow
- **Download JSON**: Exports all API communications

#### 3.6 Phase 4 - Technical Workflow
When Phase 3 completes with `ready_for_generation: true`, a "Generate Technical Workflow" button appears:

- **Feasibility Status**: Shows `can_execute` status with color coding:
  - Green: Ready to execute
  - Red: Blocking issues present
- **Blocking Issues**: Lists any critical issues preventing execution
- **Warnings**: Lists non-blocking concerns

- **Technical Inputs Form**: When `technical_inputs_required` is non-empty:
  - Displays a form with text inputs for each required input
  - Shows input key, plugin, and description
  - "Submit Collected Inputs" button re-runs Phase 4 with collected values

- **Technical Workflow Steps**: Displays each step in the workflow:
  - Step ID and kind (operation, transform, control)
  - Plugin and action for operation steps
  - Description of what the step does
  - Inputs and outputs configuration

- **Raw JSON Preview**: Expandable section showing:
  - Full Phase 4 response
  - Technical workflow array
  - Feasibility assessment

- **Metadata Status**: Shows Phase 4 specific flags:
  - `can_execute`: Overall executability
  - `needs_technical_inputs`: Whether inputs are required
  - `needs_user_feedback`: Whether feedback is needed
  - `ready_for_generation`: Final readiness state

**Action Buttons:**
- **Re-generate Technical Workflow**: Re-runs Phase 4 for refinement
- **Reset Thread**: Clears all state and starts fresh

#### 3.7 Import Enhanced Prompt JSON

**Purpose:** Skip Phases 1-2 and jump directly to Phase 3 with a pre-existing Enhanced Prompt.

**Button Location:** "Start New Thread" section header (purple button)

**How to Use:**
1. Click "📥 Import Enhanced Prompt JSON" button
2. Paste your Phase 3 Enhanced Prompt JSON in the modal textarea
3. Click "Import & Skip to Phase 3"

**Modal Features:**
- JSON validation on import
- Required fields hint: `plan_title` or `plan_description`
- Optional fields: `sections`, `specifics`, `original_prompt`
- Error display for invalid JSON

**What Happens on Import:**
```typescript
enhancedPrompt = parsed JSON
currentPhase = 3
threadId = new UUID
initialPrompt = extracted from JSON (original_prompt || plan_description || plan_title)
clarityScore = 100%
conversationHistory = [{ role: 'assistant', content: 'Enhanced Prompt imported...' }]
apiCommunications = [{ phase: 'import', ... }]
```

**Use Case:** Test V6 Intent Validation or other Phase 3+ features without going through the full conversation flow.

#### 3.8 V6 Intent Validation

**Purpose:** Test the V6 agent generation pipeline with 5-layer ambiguity detection and user review flow.

**Feature Flag:** `NEXT_PUBLIC_USE_V6_AGENT_GENERATION`
- When `true`: V6 flow is enabled by default, Phase 4 buttons are hidden
- When `false`: V6 flow must be triggered manually, Phase 4 buttons are visible

**Button Location:** Phase 3 Action Buttons section (blue button: "🔍 V6 Intent Validation")

**How to Use:**
1. Reach Phase 3 (either through conversation or import)
2. Click "🔍 V6 Intent Validation" button
3. Review the ambiguity report in the V6ReviewCustomizeUI component
4. Make decisions on must-confirm items
5. Click "Compile and Generate DSL" to compile the workflow

**V6 Flow Components:**

**API Call 1: `/api/v6/generate-semantic-grounded`**
- Input: Enhanced Prompt, userId, provider/model
- Output: semantic_plan, grounded_plan, ambiguity_report
- Runs: Phase 1 (Understanding) + Phase 2 (Grounding) + 5-Layer Detection

**Review & Customize UI:**
- **Must Confirm** (red): Blocking items that require user decision
- **Should Review** (yellow): Non-blocking items expanded by default
- **Looks Good** (green): Pre-approved items, collapsed
- **Grounding Ambiguities** (blue): Multiple matches found during grounding

**API Call 2: `/api/v6/compile-with-decisions`**
- Input: semantic_plan, user_decisions, enhanced_prompt
- Output: Compiled agent with pilot_steps
- Runs: Phase 3 (IR Formalization) + Phase 4+5 (Compilation)

**Workflow Preview UI (V6WorkflowPreview Component):**
After successful compilation, users see a visual workflow preview before approving the agent:
- **Visual Step Cards**: Each workflow step displayed with icons, badges, and descriptions
- **Step Type Indicators**: Color-coded badges for operation, transform, conditional, scatter_gather
- **Plugin Badges**: Shows which plugin each step uses (Google Sheets, Gmail, etc.)
- **Expandable Details**: Click to expand and see inputs, config, and nested steps
- **User Decisions Summary**: Recap of all confirmed patterns and resolved ambiguities
- **Action Buttons**:
  - **Go Back**: Return to Review & Customize UI to modify decisions
  - **Copy JSON**: Copy compiled workflow to clipboard
  - **Approve & Save Agent**: Confirm and persist the agent (save logic placeholder)
- **Raw JSON View**: Collapsible section showing full compiled result JSON

**V6 State Variables:**
```typescript
v6FlowEnabled: boolean              // V6 mode active
v6AmbiguityReport: object | null    // From API call 1
v6SemanticPlan: object | null       // From API call 1
v6UserDecisions: object | null      // User's choices in Review UI
v6Loading: boolean                  // Loading state
v6Error: string | null              // Error message
v6CompiledResult: object | null     // From API call 2
v6ShowWorkflowPreview: boolean      // Show workflow preview after compilation
```

**Reset V6 Flow:** "Close V6 Flow" or "Reset" button clears all V6 state.

#### 3.9 Testing Controls
- **Reset Thread**: Clears all state and starts fresh

**API Endpoints Used:**
- `POST /api/agent-creation/init-thread` - Initialize conversation thread
- `POST /api/agent-creation/process-message` - Process each phase
- `POST /api/v6/generate-semantic-grounded` - V6 Intent Validation (API Call 1)
- `POST /api/v6/compile-with-decisions` - V6 Compilation with user decisions (API Call 2)

**Phase Flow:**
```
User Input → Phase 1 (Analysis) → [If clarity < threshold] → Phase 2 (Questions)
                                → [If clarity sufficient] → Phase 3 (Enhanced Prompt)

Phase 2 (Questions) → User Answers → Phase 3 (Enhanced Prompt)

Phase 3 → [If user_inputs_required] → Mini-Cycle Phase 2 → Refined Phase 3
        → [If ready_for_generation] → Phase 4 (Technical Workflow)

Phase 4 → [If technical_inputs_required] → Collect Inputs → Re-run Phase 4
        → [If can_execute: true] → Ready for Agent Execution
```

---

## Tab 4: Free Tier Users

### Purpose
Create and manage free tier user subscriptions for testing and onboarding.

### Features

#### 4.1 Info Banner
Explains the functionality:
- Creates record in `user_subscriptions` table
- User must exist in `auth.users` table
- Shows all quotas that will be allocated

#### 4.2 User ID Input
- **UUID Input Field**: Accepts user ID from auth.users table
- **Placeholder**: Shows example UUID format
- **Helper Text**: Explains where to find the user ID
- **Validation**: Disables submit if empty

#### 4.3 What Will Be Created
Information panel showing default allocations:
- **Pilot Tokens**: 20,834 tokens (from `system_settings_config`)
- **Storage Quota**: 1,000 MB (from `system_settings_config`)
- **Execution Quota**: Unlimited (null)
- **Free Tier Duration**: 30 days (from `system_settings_config`)
- **Status**: active
- **Account Frozen**: false

**Important Note:**
If user already has a subscription, free tier allocation is ADDED to existing balance.

#### 4.4 Action Buttons
- **Create Free Tier Subscription**: Calls API to allocate quotas
- **Reset Form**: Clears form and response

#### 4.5 Response Display
**Success Response (Green):**
- ✅ Success header
- Allocation Details box showing:
  - Pilot Tokens allocated
  - Raw Tokens (LLM tokens)
  - Storage MB
  - Executions quota
  - Success message
- Full JSON expansion

**Error Response (Red):**
- ❌ Error header
- Error message box
- Full JSON expansion

**All Responses Include:**
- Copy to Clipboard button
- Expandable full API response

**API Endpoint Used:**
- `POST /api/onboarding/allocate-free-tier`

**Request Format:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Success Response Format:**
```json
{
  "success": true,
  "allocation": {
    "pilot_tokens": 20834,
    "raw_tokens": 208340000,
    "storage_mb": 1000,
    "executions": null
  },
  "message": "Free tier quotas allocated successfully"
}
```

**What Happens in Database:**
1. Checks if `user_subscriptions` record exists for user
2. If exists: Updates record, adds to balance
3. If not exists: Creates new record with:
   - `user_id`
   - `balance` (raw tokens)
   - `total_earned`
   - `storage_quota_mb`
   - `storage_used_mb`: 0
   - `executions_quota`
   - `executions_used`: 0
   - `status`: 'active'
   - `free_tier_granted_at`
   - `free_tier_expires_at`
   - `free_tier_initial_amount`
   - `account_frozen`: false
4. Logs to audit trail with action: `FREE_TIER_ALLOCATED`

---

## Tab 5: Agent Execution

### Purpose
Execute and debug agents with step-by-step visualization and control.

### Features

#### 5.1 Agent Selection
- **Agent ID Input**: Enter or paste agent UUID
- **Agent Dropdown**: Select from list of user's agents
- **Load Agent Details**: Automatically loads agent configuration and workflow steps

#### 5.2 Execution Configuration
- **Input Variables Editor**: JSON textarea for agent input parameters
- **Override User Prompt**: Optional field to override the agent's default prompt
- **Use AgentKit Toggle**: Switch between AgentKit and Pilot execution engines

#### 5.3 Standard Execution
- **Execute Agent**: Runs the agent normally with selected parameters
- **Execution Result**: Displays full JSON response with success/error status

#### 5.4 Debug Mode Execution (New)
Step-by-step execution with real-time visualization and control.

**Debug Controls Component:**
- **Start Debug**: Begin execution in debug mode
- **Pause**: Pause execution at current step
- **Resume**: Continue execution from paused state
- **Step**: Execute single step and pause again
- **Stop**: Terminate execution immediately
- **Reset**: Clear debug state and prepare for new run

**Debug States:**
- `idle`: Ready to start
- `connecting`: Establishing SSE connection
- `running`: Actively executing steps
- `stepping`: Single-step mode active
- `paused`: Execution paused at step boundary
- `stopped`: Execution terminated by user
- `completed`: All steps finished successfully
- `error`: Execution failed with error

**Step Visualizer Component:**
- **Step List**: Visual timeline of all workflow steps
- **Status Indicators**: Color-coded icons for each step state
  - ⏳ Pending (gray)
  - ▶️ Running (blue, animated)
  - ✅ Completed (green)
  - ❌ Failed (red)
  - ⏸️ Paused (yellow)
- **Step Details**: Click to expand and view:
  - Configuration (plugin, action)
  - Input data (JSON)
  - Output data (JSON)
  - Error messages
  - Timing information (start, end, duration)
- **Progress Animation**: Running indicator bar on active step

**Debug Stream Hook (`useDebugStream`):**
Manages SSE connection for real-time debug events:
- `connect(runId)`: Connect to debug stream
- `disconnect()`: Close SSE connection
- `pause()`: Send pause command
- `resume()`: Send resume command
- `step()`: Send step command
- `stop()`: Send stop command
- `reset()`: Clear all state
- `initializeSteps(steps)`: Pre-populate step statuses

**Debug Event Types:**
- `connected`: SSE connection established
- `step_start`: Step execution beginning
- `step_complete`: Step finished successfully
- `step_failed`: Step encountered error
- `plugin_call`: External plugin API call
- `llm_call`: AI model request
- `llm_response`: AI model response
- `handoff`: Control transfer between components
- `paused`: Execution paused
- `resumed`: Execution resumed
- `execution_complete`: All steps done
- `execution_error`: Fatal error occurred

#### 5.5 Agent List
- **Agents Table**: Lists all agents for current user
- **Columns**: ID, Name, Status, Workflow Steps count
- **Quick Select**: Click to populate Agent ID field

**API Endpoints Used:**
- `GET /api/agents/{agentId}` - Load agent details
- `POST /api/run-agent` - Execute agent (with optional `debugMode`, `debugRunId`)
- `GET /api/debug/stream?runId={runId}` - SSE stream for debug events
- `POST /api/debug/control` - Send debug control commands

---

## Global Features

### User Configuration Panel
Present on all tabs:
- **User ID Input**: Enter user UUID for testing
- **Status Display**: Shows plugin counts by status:
  - Connected count
  - Expired count (shown in orange when > 0)
  - Disconnected count

### Control Panel
- **Refresh Status**: Reloads plugins and user status
- **Clear Debug Logs**: Clears the debug log display

### Debug Logs Panel
- **Real-time Logging**: Shows all operations with timestamps
- **Color-coded**:
  - 🟢 Green: Success messages
  - 🔴 Red: Error messages
  - ⚪ Gray: Info messages
- **Scrollable**: Auto-scrolls to show latest logs
- **Limit**: Keeps last 50 log entries

---

## Technical Architecture

### State Management

**Core State:**
```typescript
- userId: string
- apiClient: PluginAPIClient
- availablePlugins: PluginInfo[]
- userStatus: UserPluginStatus | null
- selectedPlugin: string
- selectedAction: string
- parameters: string (JSON)
- lastResponse: any
- isLoading: boolean
```

**AI Services State:**
```typescript
- selectedAIService: string
- aiServiceRequestBody: string (JSON)
- aiServiceResponse: any
```

**Thread Conversation State:**
```typescript
- threadId: string | null
- currentPhase: 1 | 2 | 3 | 4
- initialPrompt: string
- conversationHistory: Array<{role, content, data}>
- conversationHistoryRef: useRef<HTMLDivElement> // for auto-scroll
- currentQuestions: any[]
- currentQuestionIndex: number
- userAnswer: string
- clarificationAnswers: Record<string, string>
- enhancedPrompt: any
- clarityScore: number
- analysisData: any
- missingPlugins: string[]
- isInMiniCycle: boolean
- miniCyclePhase3: any
- apiCommunications: Array<{timestamp, phase, endpoint, request, response}>
// Phase 4 specific state
- technicalWorkflow: any[]
- technicalInputsRequired: any[]
- feasibility: any
- phase4Response: any
- technicalInputsCollected: Record<string, string>
// V6 Intent Validation state
- isV6FeatureFlagEnabled: boolean  // from useV6AgentGeneration() feature flag
- v6FlowEnabled: boolean           // initialized from feature flag
- v6AmbiguityReport: V6AmbiguityReport | null
- v6SemanticPlan: object | null
- v6UserDecisions: V6UserDecisions | null
- v6Loading: boolean
- v6Error: string | null
- v6CompiledResult: any
// Enhanced Prompt Import state
- showEnhancedPromptImportModal: boolean
- enhancedPromptImportValue: string
- enhancedPromptImportError: string | null
```

**Agent Execution State:**
```typescript
- agentId: string
- agentInputVariables: string (JSON)
- agentOverridePrompt: string
- agentExecutionResult: any
- isExecutingAgent: boolean
- useAgentKit: boolean
- agentsList: Array<{id, agent_name, status, pilot_steps?, workflow_steps?}>
// Debug mode state
- debugModeEnabled: boolean
- selectedAgentDetails: any
- agentWorkflowSteps: WorkflowStep[]
// Debug stream hook state (from useDebugStream)
- debugRunId: string | null
- debugState: DebugState
- events: DebugEvent[]
- stepStatuses: Map<string, StepStatus>
- currentStepId: string | null
- isConnected: boolean
- error: string | null
```

**Free Tier Users State:**
```typescript
- freeTierUserId: string
- freeTierResponse: any
```

**Debug Logs State:**
```typescript
- debugLogs: DebugLog[]
```

### Key Functions

**Plugin Management:**
- `loadAvailablePlugins()` - Fetch all plugins
- `loadUserStatus()` - Get user's connection status
- `getPluginStatus(pluginKey)` - Returns 'connected', 'token_expired', or 'not_connected'
- `connectPlugin(pluginKey)` - Initiate OAuth
- `disconnectPlugin(pluginKey)` - Remove connection
- `refreshPluginToken(pluginKey)` - Refresh expired OAuth token
- `executeAction()` - Execute plugin action
- `updateParameterTemplate()` - Load action template

**AI Services:**
- `generateNewSessionId()` - Create UUID for session
- `generateNewAgentId()` - Create UUID for agent
- `resetToAITemplate()` - Load service template
- `executeAIService()` - Call AI endpoint

**Thread Conversation:**
- `startThread()` - Initialize thread
- `processMessage(phase, answers?, threadId?)` - Process phase
- `handleAnswerSubmit()` - Submit clarification answer
- `handleRefinePlan()` - Return to Phase 2
- `handleAcceptPlan()` - Accept final plan
- `resetThreadConversation()` - Clear all state
- `downloadCommunicationHistory()` - Export JSON

**Free Tier Users:**
- `createFreeTierUser()` - Call allocation API
- `resetFreeTierForm()` - Clear form

**Agent Execution:**
- `loadAgentDetails(agentId)` - Fetch agent with pilot_steps
- `handleAgentSelection(agentId)` - Handle dropdown selection
- `executeAgent()` - Standard agent execution
- `startDebugExecution()` - Begin debug mode execution
- `handleDebugPause()` - Pause debug execution
- `handleDebugResume()` - Resume debug execution
- `handleDebugStep()` - Execute single step
- `handleDebugStop()` - Stop debug execution
- `handleDebugReset()` - Reset debug session
- `resetAgentExecutionForm()` - Clear all agent execution state

**Utilities:**
- `addDebugLog(type, message)` - Log to debug panel
- `copyToClipboard()` - Copy response to clipboard
- `refreshAll()` - Reload all data
- `clearLogs()` - Clear debug logs

---

## Use Cases

### UC-1: Test Plugin Connection
1. Enter User ID
2. Navigate to Plugins tab
3. Select plugin from dropdown
4. Click "Connect" button
5. View connection status
6. Check Debug Logs for OAuth flow

### UC-2: Refresh Expired Plugin Token
1. Enter User ID
2. Navigate to Plugins tab
3. Select plugin showing "Token Expired" (orange)
4. Click "Refresh Token" button
5. Check Debug Logs for refresh result
6. If failed, reconnect plugin via OAuth

### UC-3: Execute Plugin Action
1. Ensure plugin is connected (not expired)
2. Select action from dropdown
3. Review/edit JSON parameters
4. Click "Execute Action"
5. View response in display panel
6. Copy response if needed

### UC-4: Test AI Prompt Analysis
1. Navigate to AI Services tab
2. Select "analyze-prompt-clarity"
3. Edit prompt in request body
4. Generate new Session/Agent IDs
5. Click "Execute AI Service"
6. Review clarity score and analysis

### UC-5: Run Complete Thread Conversation
1. Enter User ID
2. Navigate to Thread Conversation tab
3. Enter initial prompt
4. Click "Start Thread"
5. Observe Phase 1 analysis
6. Answer Phase 2 questions (if needed)
7. Review Phase 3 enhanced prompt
8. Download communication history

### UC-6: Create Free Tier User
1. Navigate to Free Tier Users tab
2. Enter user UUID
3. Review allocation details
4. Click "Create Free Tier Subscription"
5. View success/error response
6. Check Debug Logs for details

### UC-7: Debug Mini-Cycle Workflow
1. Start thread with vague prompt requiring user inputs
2. Complete Phase 1 and Phase 2
3. Observe Phase 3 generating `user_inputs_required`
4. Watch automatic mini-cycle activation
5. Answer refinement questions
6. Review refined Phase 3 output
7. Download full communication history

### UC-8: Test Phase 4 Technical Workflow
1. Complete thread flow through Phase 3
2. Verify `ready_for_generation: true` in Phase 3 response
3. Click "Generate Technical Workflow (Phase 4)" button
4. Review feasibility assessment (can_execute, blocking_issues, warnings)
5. If technical_inputs_required is non-empty:
   - Fill in the text fields for each required input
   - Click "Submit Collected Inputs"
   - Verify Phase 4 re-runs with collected values
6. Review technical_workflow steps:
   - Verify operation steps reference valid plugins/actions
   - Check transform steps have correct operation types
   - Verify inputs reference correct sources (from_step, user_input, etc.)
7. Download communication history to verify Phase 4 iteration saved

### UC-9: Execute Agent (Standard Mode)
1. Navigate to Agent Execution tab
2. Enter Agent ID or select from dropdown
3. Configure input variables JSON
4. Optionally set override prompt
5. Toggle AgentKit/Pilot engine as needed
6. Click "Execute Agent"
7. Review execution result JSON

### UC-10: Debug Agent Execution (Step-by-Step)
1. Navigate to Agent Execution tab
2. Select an agent with workflow steps (pilot_steps)
3. Verify step visualization shows all steps as "Pending"
4. Click "Start Debug" in Debug Controls
5. Observe SSE connection established
6. Watch steps transition: Pending → Running → Completed
7. Click "Pause" to halt at current step
8. Inspect step details (input/output data)
9. Click "Step" to advance one step at a time
10. Click "Resume" to continue automatic execution
11. Click "Stop" to terminate early if needed
12. Click "Reset" to clear state and start over

### UC-11: Test Multi-Provider Thread Conversation
1. Navigate to Thread Conversation tab
2. Select AI Provider (e.g., Anthropic)
3. Select Model (e.g., Claude 4.5 Sonnet)
4. Enter initial prompt
5. Click "Start Thread"
6. Verify Session Info shows selected provider/model
7. Complete conversation flow
8. Switch provider and test with different model

### UC-12: Generate Agent from Thread Conversation (V4)
1. Complete thread flow through Phase 3 (or Phase 4)
2. Click "Accept Plan" or "Create Agent" button
3. Observe loading spinner during generation
4. Review Generated Agent section:
   - Verify agent name and description
   - Check Agent ID and Session ID
   - Review workflow steps count
   - Inspect required plugins
   - Check input schema fields
5. Expand "View Workflow Steps" to inspect each step
6. Expand "View Full Agent JSON" for complete response
7. Use "Copy Agent ID" or "Copy Full JSON" buttons
8. Optionally click "Regenerate" for a new attempt
9. Download communication history (includes V4 generation call)

### UC-13: Test V5 Workflow Generator (LLM Review Flow)
1. Navigate to AI Services tab
2. Select `test/generate-agent-v5-test-wrapper` from dropdown
3. Select AI Provider (defaults to Anthropic)
4. Select Model (defaults to Claude Sonnet 4)
5. Prepare enhancedPrompt JSON with required fields:
   - `sections` (data, output, actions, delivery, processing_steps)
   - `specifics.services_involved` (required for auto-extraction)
   - `specifics.resolved_user_inputs`
   - `plan_title` and `plan_description`
6. Use "Import JSON" button to import enhancedPrompt
7. Optionally add pre-built `technicalWorkflow.technical_workflow` steps for LLM review
8. Click "Execute AI Service"
9. Verify response includes:
   - Generated/reviewed workflow steps
   - Validation results
   - DSL output
10. Check for validation errors with clear `missingFields` if inputs are incomplete

### UC-14: Import Enhanced Prompt JSON (Skip to Phase 3)
1. Navigate to Thread Conversation tab
2. Click "📥 Import Enhanced Prompt JSON" button (purple, in header)
3. Paste a valid Enhanced Prompt JSON with at least `plan_title` or `plan_description`
4. Click "Import & Skip to Phase 3"
5. Verify:
   - Phase 3 UI appears with the imported Enhanced Prompt
   - Thread ID is generated
   - Clarity score shows 100%
   - Conversation history shows "Enhanced Prompt imported successfully"
   - API Communications tracks the import
6. Proceed with Phase 4 or V6 Intent Validation testing

### UC-15: Test V6 Intent Validation Flow
1. Reach Phase 3 (via conversation flow or UC-14 import)
2. Click "🔍 V6 Intent Validation" button (blue)
3. Wait for API Call 1 (`/api/v6/generate-semantic-grounded`)
4. Review the V6ReviewCustomizeUI component:
   - **Must Confirm** section: Make required decisions
   - **Should Review** section: Review and optionally modify
   - **Looks Good** section: Expand to verify auto-approved items
   - **Grounding Ambiguities**: Resolve any multiple-match issues
5. Verify all must-confirm items are resolved (button enables)
6. Click "Compile and Generate DSL" button
7. Wait for API Call 2 (`/api/v6/compile-with-decisions`)
8. Verify V6 Compiled Result:
   - Agent name displayed
   - Pilot steps count shown
   - Full JSON available in expandable section
9. Download communication history (includes both V6 API calls)
10. Click "Reset" to clear V6 flow and test again

---

## System Config Dependencies

The test page relies on these system configuration tables:

### `system_settings_config`
Used by Free Tier Users tab:
- `free_tier_pilot_tokens` (default: 20834)
- `free_tier_storage_mb` (default: 1000)
- `free_tier_executions` (default: null/unlimited)
- `free_tier_duration_days` (default: 30)

### `ais_system_config`
Used for token conversion:
- `pilot_credit_cost_usd` (price per Pilot Credit)
- `tokens_per_pilot_credit` (conversion ratio)

---

## Error Handling

### Common Errors

**Authentication Errors:**
- Missing or invalid User ID
- Expired session
- OAuth flow interruption

**Plugin Errors:**
- Plugin not connected
- Invalid parameters
- API rate limits
- Service unavailable

**AI Service Errors:**
- Invalid JSON in request body
- Missing required fields
- Service timeout
- Model errors

**Thread Conversation Errors:**
- Thread not initialized
- Invalid phase transition
- Missing clarification answers
- API communication failure

**Free Tier Errors:**
- User ID not found in auth.users
- User already has active subscription
- System config not found
- Database constraint violation

### Error Display
All errors are:
1. Logged to Debug Logs with timestamp
2. Displayed in response panels with red styling
3. Shown with detailed error messages
4. Available for clipboard copy

---

## Performance Considerations

### Optimization Features
- **Lazy Loading**: Plugins loaded on mount only
- **Conditional Rendering**: Only active tab is rendered
- **Debouncing**: User ID changes trigger status reload
- **Log Limiting**: Debug logs capped at 50 entries
- **JSON Validation**: Parameters validated before execution

### Loading States
- Global `isLoading` state prevents concurrent operations
- Button states reflect loading/disabled conditions
- Clear visual feedback during API calls

---

## Security Notes

### Authentication
- All API calls require valid user authentication
- User ID passed as header: `x-user-id`
- Session/Agent IDs tracked for audit trails
- OAuth tokens managed server-side

### Data Privacy
- Sensitive data not logged to debug panel
- Plugin credentials never exposed to client
- API responses may contain user data (handle carefully)
- Audit trail logs all free tier allocations

---

## Future Enhancements

### Planned Features
1. **Bulk Plugin Testing**: Test multiple actions sequentially
2. **Response Comparison**: Compare responses across API versions
3. **Template Management**: Save/load custom parameter templates
4. **User Search**: Lookup users by email instead of UUID
5. **Quota Management**: View and edit user quotas directly
6. **Real-time Logs**: WebSocket connection for live logs
7. **Export History**: Download plugin execution history
8. **Performance Metrics**: Track API response times

---

## Troubleshooting

### Issue: Plugin Won't Connect
- Check if user ID is valid
- Verify OAuth credentials in environment
- Check plugin status in database
- Review Debug Logs for OAuth errors

### Issue: Plugin Shows Token Expired
- Click "Refresh Token" button to refresh OAuth token
- If refresh fails, the refresh token may have expired - reconnect the plugin
- Check Debug Logs for specific refresh error messages
- Some plugins may not support token refresh - reconnect required

### Issue: Action Execution Fails
- Ensure plugin is connected (not expired)
- If token expired, refresh token first
- Validate JSON parameters syntax
- Check parameter template matches action schema
- Verify user has permissions for action

### Issue: Thread Gets Stuck
- Check API endpoint availability
- Verify phase transitions in logs
- Clear thread and restart
- Check for missing clarification answers

### Issue: Free Tier Creation Fails
- Verify user exists in auth.users
- Check system_settings_config values
- Ensure user doesn't have conflicting subscription
- Review database constraint errors

---

## Related Documentation

- [Plugin System Architecture](./PLUGIN_SYSTEM_ARCHITECTURE.md)
- [Conversational UI Phase Guide](./V2_CONVERSATIONAL_UI_NEW_COMPLETE.md)
- [AI Services Integration](./AI_SERVICES_GUIDE.md)
- [Free Tier Management](./FREE_TIER_MANAGEMENT.md)
- [Stripe Integration Setup](./STRIPE_INTEGRATION_SETUP.md)

---

## Changelog

### Version 1.9.1 (Current)
- **User Decisions Summary Improvements**:
  - Enhanced `getV6UserDecisionsForPreview()` to look up human-readable labels from `v6AmbiguityReport`:
    - `confirmed_patterns` → looks up `must_confirm` items, uses `description` or `title`
    - `resolved_ambiguities` → looks up both `must_confirm` (semantic_ambiguity/vague_language types) and `grounding_ambiguities`
    - `approved_assumptions` / `disabled_assumptions` → looks up from `should_review`, `looks_good`, or `v6SemanticPlan.assumptions`
    - `edge_case_handling` → formats edge case IDs as readable labels
  - Added text truncation (50 chars max) with dotted underline indicator
  - Added native browser tooltips showing full text on hover
- **DecisionSummary Component Updates** (`V6WorkflowPreview.tsx`):
  - Truncates long labels/values to improve readability
  - Shows full `label: value` in tooltip on hover

### Version 1.9
- **V6 Workflow Preview UI**:
  - Added `V6WorkflowPreview` component (`@/components/v6/V6WorkflowPreview`)
  - Visual step cards with type icons, badges, and expandable details
  - User decisions summary showing confirmed patterns and resolved ambiguities
  - Action buttons: Go Back, Copy JSON, Approve & Save Agent
  - Raw JSON view in collapsible section
- **New State Variable**: `v6ShowWorkflowPreview` - controls when workflow preview is displayed
- **New Handler Functions**:
  - `handleV6WorkflowGoBack()` - return to Review UI
  - `handleV6WorkflowCopyJSON()` - copy compiled result to clipboard
  - `handleV6WorkflowApprove()` - approve and save agent (placeholder)
  - `getV6UserDecisionsForPreview()` - transform decisions for preview format
  - `convertPilotStepsToWorkflowSteps()` - convert pilot_steps to WorkflowStep format
- **UI Flow Update**: After clicking "Compile and Generate DSL", shows Workflow Preview instead of simple success box

### Version 1.8
- **V6 Feature Flag Integration**:
  - Added `useV6AgentGeneration()` feature flag from `@/lib/utils/featureFlags`
  - `v6FlowEnabled` state now initializes from `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` environment variable
  - When feature flag is `true`: Phase 4 buttons are hidden, V6 flow is enabled by default
  - When feature flag is `false`: Phase 4 buttons are visible, V6 flow must be triggered manually
- **Button Rename**: "Create Agent" → "Compile and Generate DSL" in V6ReviewCustomizeUI
- **New State Variable**: `isV6FeatureFlagEnabled` from feature flag hook
- **Debug Logging**: Added response logging to `/api/v6/generate-semantic-grounded` before returning

### Version 1.7
- **V6 Intent Validation Integration**:
  - New "🔍 V6 Intent Validation" button in Phase 3 Action Buttons
  - Calls `/api/v6/generate-semantic-grounded` for semantic plan + 5-layer ambiguity detection
  - Integrated `V6ReviewCustomizeUI` component for user review/customization
  - "Compile and Generate DSL" button calls `/api/v6/compile-with-decisions` with user decisions
  - V6 compiled result display with agent name, steps count, and full JSON view
- **Import Enhanced Prompt JSON**:
  - New "📥 Import Enhanced Prompt JSON" button in Thread Conversation header
  - Modal to paste Phase 3 Enhanced Prompt JSON
  - Skips directly to Phase 3 without going through Phase 1-2
  - Validates required fields (`plan_title` or `plan_description`)
  - Sets thread state (threadId, currentPhase, clarityScore, etc.)
- **New State Variables**:
  - V6: `v6FlowEnabled`, `v6AmbiguityReport`, `v6SemanticPlan`, `v6UserDecisions`, `v6Loading`, `v6Error`, `v6CompiledResult`
  - Import: `showEnhancedPromptImportModal`, `enhancedPromptImportValue`, `enhancedPromptImportError`
- **New Components Imported**: `V6ReviewCustomizeUI` from `@/components/v6/V6ReviewCustomizeUI`
- Added UC-14: Import Enhanced Prompt JSON use case
- Added UC-15: Test V6 Intent Validation Flow use case

### Version 1.6
- **Prompt Version Updates**:
  - Agent Creation Prompt upgraded to v13 (`Workflow-Agent-Creation-Prompt-v13-chatgpt.txt`)
  - Technical Reviewer upgraded to v2 (`Workflow-Agent-Technical-Reviewer-SystemPrompt-v2.txt`)
- **Step Routing Schema (v13/v2)**:
  - Steps now support `outputs.next_step` for explicit routing to next step
  - `is_last_step: true` field marks final step(s)
  - Branching steps support per-branch `next_step` in output objects
  - Updated `phase4-schema.ts` with `BranchOutputSchema`, `StepOutputValueSchema`, `is_last_step`
- **Technical Reviewer Schema Validation**:
  - New `lib/validation/technical-reviewer-schema.ts` with Zod schemas
  - `validateTechnicalReviewerResponse()` helper for runtime validation
  - V5 generator now validates LLM responses against schema before processing
  - Detailed error messages when validation fails
- **Schema Types Updated**:
  - `BranchOutput` interface for branching output objects
  - `StepOutputValue` type (string | BranchOutput)
  - `TechnicalReviewerFeasibility` type for reviewer feasibility assessment

### Version 1.5
- **V5 Workflow Generator Test Wrapper**: New AI service `test/generate-agent-v5-test-wrapper`
  - Tests the V5 LLM review flow for technical workflows
  - Supports both `enhancedPrompt` (stringified JSON) and `technicalWorkflow` inputs
  - Auto-extracts `required_services` from `enhancedPrompt.specifics.services_involved`
  - Auto-populates `technicalWorkflow.enhanced_prompt` from enhancedPrompt
  - Provider/model injected from dropdown selectors (not stored in request body)
- **Enhanced Provider/Model Handling**:
  - For `test/analyze-prompt` and `test/generate-agent-v5-test-wrapper`: provider/model removed from request body template
  - Values are now injected at API call time from dropdown selections
  - Default provider for V5 wrapper: Anthropic with Claude Sonnet 4
- **Flexible technicalWorkflow Input**: Accepts both string (JSON) and object formats
- **Improved Validation Errors**: Clear error messages with `missingFields` array showing exactly what's missing
- Added UC-13: Test V5 Workflow Generator use case

### Version 1.4
- **V4 Agent Generation**: Added `/api/generate-agent-v4` integration (OpenAI 3-Stage Architecture)
- **Accept Plan → Generate Agent**: "Accept Plan" and "Create Agent" buttons now trigger V4 agent generation
- **Generated Agent Display**: New UI section showing:
  - Agent summary (name, description)
  - Agent ID and Session ID
  - Workflow steps count and latency
  - Required plugins and input schema
  - Expandable workflow steps preview
  - Full JSON view with copy buttons
- **New State Variables**: `generatedAgent`, `isGeneratingAgent`, `agentGenerationError`
- **API Communication Tracking**: V4 generation calls tracked in download history
- **New AI Service Template**: `generate-agent-v4` template added
- Added UC-12: Generate Agent from Thread Conversation use case

### Version 1.3
- **Multi-Provider AI Support**: Added provider selection (OpenAI, Anthropic, Kimi) to Thread Conversation
- **Expanded Model Lists**: Updated to latest models including:
  - OpenAI: GPT-5.2 series, GPT-5.1, GPT-5, GPT-4.1 (1M context), o3/o4-mini reasoning models
  - Anthropic: Claude 4.5 (Opus/Sonnet/Haiku), Claude 4.1, Claude 4, Claude 3.7
  - Kimi: K2 series, K1.5, Linear (1M context), Dev (coding), VL (vision)
- **Default model changed**: Now defaults to `gpt-5.2` instead of `gpt-4o`
- **Session Info Enhancement**: Now displays AI Provider and Model
- **Auto-scroll Conversation**: Conversation history automatically scrolls to latest messages
- **Tab 5 - Agent Execution**: New tab with full agent execution capabilities
- **Debug Mode Execution**: Step-by-step agent execution with real-time visualization
- **New Components**:
  - `DebugControls` - Control buttons for debug execution (start, pause, resume, step, stop, reset)
  - `StepVisualizer` - Visual timeline of workflow steps with status indicators
- **New Hook**: `useDebugStream` - SSE-based hook for real-time debug event streaming
- **Debug Event Types**: Support for step_start, step_complete, step_failed, plugin_call, llm_call, etc.
- **Agent Details Loading**: Automatically loads pilot_steps when agent is selected
- Added UC-9, UC-10, UC-11: New use cases for agent execution and multi-provider testing

### Version 1.2
- Added Phase 4 - Technical Workflow Generation support
- New "Generate Technical Workflow" button in Phase 3 section
- Phase 4 UI section with feasibility status, workflow steps, technical inputs form
- Added `technicalWorkflow`, `technicalInputsRequired`, `feasibility`, `phase4Response`, `technicalInputsCollected` state variables
- Updated phase flow to include Phase 4 paths
- Added UC-8: Test Phase 4 Technical Workflow use case

### Version 1.1
- Added three-state plugin status: Connected, Token Expired, Not Connected
- Added "Refresh Token" button for expired plugins
- Updated status summary to show expired plugin count
- Plugin dropdown now shows [Expired] suffix for expired tokens
- Color-coded status: green (connected), orange (expired), red (disconnected)

### Version 1.0
- Initial release with 4 tabs
- Plugin management and testing
- AI service testing
- Thread conversation workflow
- Free tier user creation
- Debug logging system
- Communication history export

---

## Support

For issues or questions about the Test Page:
- Check Debug Logs for detailed error messages
- Review API endpoint documentation
- Verify system configuration values
- Contact development team with exported JSON logs

---

**Last Updated:** January 21, 2026 (User Decisions Summary Improvements)
**Maintained By:** NeuronForge Development Team
