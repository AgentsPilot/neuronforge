# ARCHIVED — Debug Integration Guide - Next Steps

> **Archived**: 2026-11-27 (PROD-1c F-8)
> **Superseded by**: nothing. The feature it describes was deleted

## Why this is archived

**The debugger this guide integrates was deleted in PROD-1c F-8, because it
never worked.** Its two routes, `POST /api/debug/control` and
`GET /api/debug/stream`, called `DebugSessionManager` methods that do not
exist, so the stream answered 500 and no command reached a run. F-8 deleted
both routes, the `useDebugStream` hook and `components/debug/`
(`DebugControls`, `StepVisualizer`), and removed the debug panel from
`/test-plugins-v2`. `lib/debug/DebugSessionManager.ts` remains, because
`lib/pilot/WorkflowPilot.ts` still imports it. Everything below is the guide as
it was written, kept as history only.

---

## ✅ What's Been Created

### 1. UI Layer (Complete)
- ✅ `app/v2/sandbox/[agentId]/page.tsx` - Full debug UI
- ✅ V2 design system compliant
- ✅ Real-time step visualization
- ✅ Control buttons (Run, Pause, Step, Stop)

### 2. Backend Infrastructure (Complete)
- ✅ `lib/debug/DebugSessionManager.ts` - In-memory state management
- ✅ `app/api/debug/stream/route.ts` - SSE streaming endpoint
- ✅ `app/api/debug/control/route.ts` - Control commands API

---

## 🔨 What Needs to Be Done

### **Step 1: Integrate with WorkflowPilot** (2-3 hours)

Add debug event emission to the pilot execution engine.

**File to modify:** `lib/pilot/WorkflowPilot.ts`

#### 1.1 Import DebugSessionManager

```typescript
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager'
```

#### 1.2 Add debug flag to execute method

```typescript
async execute(
  agent: Agent,
  userId: string,
  userInput: string,
  inputValues: Record<string, any>,
  sessionId?: string,
  debugMode?: boolean,  // NEW
  stepEmitter?: { ... }
): Promise<WorkflowExecutionResult>
```

#### 1.3 Create debug session if enabled

```typescript
// After line 147 (sessionId generation)
let debugRunId: string | null = null
if (debugMode) {
  debugRunId = crypto.randomUUID()
  DebugSessionManager.createSession(debugRunId, agent.id, userId)
  console.log(`[WorkflowPilot] Debug mode enabled: ${debugRunId}`)
}
```

#### 1.4 Emit events at execution boundaries

**At step start (around line 300):**
```typescript
if (debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'step_start',
    stepId: step.id,
    stepName: step.name,
    data: { stepType: step.type, config: step.config }
  })

  // Check if paused
  await DebugSessionManager.checkPause(debugRunId)
}
```

**At step completion:**
```typescript
if (debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'step_complete',
    stepId: step.id,
    stepName: step.name,
    data: { output: result, duration: executionTime }
  })
}
```

**At step failure:**
```typescript
if (debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'step_failed',
    stepId: step.id,
    stepName: step.name,
    error: error.message,
    data: { stack: error.stack }
  })
}
```

#### 1.5 Cleanup on completion

```typescript
// At the end of execute(), after success/failure
if (debugRunId) {
  DebugSessionManager.cleanup(debugRunId)
}
```

---

### **Step 2: Integrate with runAgentKit** (2-3 hours)

Add debug events to the AgentKit iteration loop.

**File to modify:** `lib/agentkit/runAgentKit.ts`

#### 2.1 Add debug parameters

```typescript
export async function runAgentKit(
  // ... existing parameters
  debugMode?: boolean,
  debugRunId?: string
): Promise<any>
```

#### 2.2 Emit events in iteration loop

**At iteration start (around line 435):**
```typescript
if (debugMode && debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'step_start',
    stepName: `Iteration ${iteration + 1}`,
    data: { iteration, messagesCount: messages.length }
  })

  await DebugSessionManager.checkPause(debugRunId)
}
```

**At LLM call:**
```typescript
if (debugMode && debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'llm_call',
    stepName: `LLM Call (Iteration ${iteration + 1})`,
    data: { model, messages: messages.length }
  })
}
```

**At tool execution:**
```typescript
if (debugMode && debugRunId) {
  DebugSessionManager.emitEvent(debugRunId, {
    type: 'plugin_call',
    stepName: `Plugin: ${toolCall.function.name}`,
    data: { tool: toolCall.function.name, args: toolCall.function.arguments }
  })
}
```

---

### **Step 3: Update Run Agent API** (1 hour)

Add debug mode support to the agent execution API.

**File to modify:** `app/api/run-agent/route.ts`

#### 3.1 Accept debug parameters

```typescript
export async function POST(request: NextRequest) {
  const {
    agentId,
    inputValues,
    debugMode = false,  // NEW
  } = await request.json()
```

#### 3.2 Pass to execution engines

**For WorkflowPilot:**
```typescript
const result = await pilot.execute(
  agent,
  userId,
  userInput,
  inputValues,
  sessionId,
  debugMode  // NEW
)
```

**For AgentKit:**
```typescript
const debugRunId = debugMode ? crypto.randomUUID() : undefined
if (debugMode && debugRunId) {
  DebugSessionManager.createSession(debugRunId, agentId, userId)
}

const result = await runAgentKit(
  // ... existing params
  debugMode,
  debugRunId
)
```

---

### **Step 4: Connect Frontend to Backend** (2 hours)

Update the sandbox page to use real SSE streams instead of simulation.

**File to modify:** `app/v2/sandbox/[agentId]/page.tsx`

#### 4.1 Replace simulation with SSE

```typescript
// Remove handleRun simulation
const handleRun = async () => {
  setDebugState((prev) => ({
    ...prev,
    isRunning: true,
    isPaused: false,
    currentStepIndex: 0,
  }))

  // Start agent execution with debug mode
  const response = await fetch('/api/run-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId,
      debugMode: true,
    }),
  })

  const { runId } = await response.json()

  // Connect to SSE stream
  connectToDebugStream(runId)
}

const connectToDebugStream = (runId: string) => {
  const eventSource = new EventSource(`/api/debug/stream?runId=${runId}`)

  eventSource.onmessage = (event) => {
    const debugEvent = JSON.parse(event.data)

    if (debugEvent.type === 'step_start') {
      setDebugState((prev) => ({
        ...prev,
        steps: prev.steps.map((step) =>
          step.id === debugEvent.stepId
            ? { ...step, status: 'running', startTime: debugEvent.timestamp }
            : step
        ),
      }))
    }

    if (debugEvent.type === 'step_complete') {
      setDebugState((prev) => ({
        ...prev,
        steps: prev.steps.map((step) =>
          step.id === debugEvent.stepId
            ? {
                ...step,
                status: 'completed',
                endTime: debugEvent.timestamp,
                data: debugEvent.data
              }
            : step
        ),
      }))
    }

    // Handle other event types...
  }

  eventSource.onerror = () => {
    eventSource.close()
    setDebugState((prev) => ({ ...prev, isRunning: false }))
  }
}
```

#### 4.2 Update control handlers to call API

```typescript
const handlePause = async () => {
  await fetch('/api/debug/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, action: 'pause' }),
  })

  setDebugState((prev) => ({ ...prev, isPaused: true, isRunning: false }))
}

const handleResume = async () => {
  await fetch('/api/debug/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, action: 'resume' }),
  })

  setDebugState((prev) => ({ ...prev, isPaused: false, isRunning: true }))
}

const handleStep = async () => {
  await fetch('/api/debug/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, action: 'step' }),
  })
}

const handleStop = async () => {
  await fetch('/api/debug/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, action: 'stop' }),
  })

  setDebugState((prev) => ({ ...prev, isRunning: false, isPaused: false }))
}
```

---

## 📋 Integration Checklist

- [ ] **Step 1:** Add debug events to WorkflowPilot
  - [ ] Import DebugSessionManager
  - [ ] Add debugMode parameter
  - [ ] Create debug session
  - [ ] Emit step_start events
  - [ ] Emit step_complete events
  - [ ] Emit step_failed events
  - [ ] Add checkPause calls
  - [ ] Cleanup session on completion

- [ ] **Step 2:** Add debug events to runAgentKit
  - [ ] Add debug parameters
  - [ ] Emit iteration events
  - [ ] Emit LLM call events
  - [ ] Emit plugin call events
  - [ ] Add checkPause calls

- [ ] **Step 3:** Update run-agent API
  - [ ] Accept debugMode parameter
  - [ ] Pass to WorkflowPilot
  - [ ] Pass to runAgentKit
  - [ ] Return runId for SSE connection

- [ ] **Step 4:** Connect frontend to SSE
  - [ ] Replace simulation with real execution
  - [ ] Connect to SSE stream
  - [ ] Handle debug events
  - [ ] Update UI based on events
  - [ ] Call control API endpoints

---

## 🧪 Testing Steps

### 1. Test Debug Session Creation
```typescript
// In browser console or test
const runId = 'test-run-123'
fetch('/api/debug/stream?runId=' + runId)
  .then(response => console.log('Connected:', response.ok))
```

### 2. Test Event Streaming
```typescript
// Create session manually
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager'

const session = DebugSessionManager.createSession('test-123', 'agent-1', 'user-1')

// Emit test event
DebugSessionManager.emitEvent('test-123', {
  type: 'step_start',
  stepName: 'Test Step',
  data: { test: true }
})

// Check in browser SSE connection
```

### 3. Test Pause/Resume
1. Start debug run
2. Click Pause - execution should freeze
3. Click Resume - execution should continue
4. Click Step - should execute one step then pause

### 4. Test Real Agent Execution
1. Navigate to `/v2/sandbox/[agentId]`
2. Click "Run Debug"
3. Watch steps execute in real-time
4. Test all control buttons
5. Verify data inspector shows correct output

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────┐
│  Frontend (Sandbox Page)                    │
│  - User clicks "Run Debug"                  │
│  - Connects to SSE stream                   │
│  - Displays events in timeline              │
│  - Sends control commands (pause/resume)    │
└────────────┬────────────────────────────────┘
             │
             │ POST /api/run-agent
             │ {debugMode: true}
             │
             ↓
┌─────────────────────────────────────────────┐
│  Run Agent API                              │
│  - Creates debug session                    │
│  - Returns runId                            │
│  - Starts WorkflowPilot/AgentKit            │
└────────────┬────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────┐
│  WorkflowPilot / AgentKit                   │
│  - Executes workflow steps                  │
│  - Emits debug events at each boundary      │
│  - Checks for pause at each step            │
│  - Waits if paused                          │
└────────────┬────────────────────────────────┘
             │
             │ emitEvent()
             │ checkPause()
             │
             ↓
┌─────────────────────────────────────────────┐
│  DebugSessionManager (In-Memory)            │
│  - Stores session state                     │
│  - Manages pause/resume                     │
│  - Broadcasts events to listeners           │
└────────────┬────────────────────────────────┘
             │
             │ SSE Stream
             │
             ↓
┌─────────────────────────────────────────────┐
│  GET /api/debug/stream?runId=xxx            │
│  - Subscribes to debug events               │
│  - Streams to frontend via SSE              │
└─────────────────────────────────────────────┘
```

---

## 🎯 Expected Time to Complete

- **Step 1 (WorkflowPilot):** 2-3 hours
- **Step 2 (AgentKit):** 2-3 hours
- **Step 3 (API):** 1 hour
- **Step 4 (Frontend):** 2 hours
- **Testing:** 1-2 hours

**Total: 8-11 hours** (1-2 days of development)

---

## 🚀 Quick Start (Minimal Viable Debug)

If you want to test quickly, start with just WorkflowPilot:

1. ✅ Files already created (DebugSessionManager, API endpoints)
2. Add debug events to WorkflowPilot only (Step 1)
3. Update run-agent API for pilot agents (Step 3, partial)
4. Connect frontend SSE (Step 4)
5. Test with a pilot-based agent

**This gets you a working debugger in ~4-5 hours!**

---

## 📝 Notes

- All state is in-memory (no database changes needed)
- Sessions auto-cleanup after 1 hour of inactivity
- SSE automatically reconnects on disconnect
- Works with both WorkflowPilot and AgentKit
- Zero overhead when debug mode is disabled

---

**Ready to integrate? Start with Step 1!** 🚀
