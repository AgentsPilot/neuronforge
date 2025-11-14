# System Flow Visualization - User Guide

## Overview

The System Flow Visualization is an interactive, animated page that shows the complete integration of all subsystems in NeuronForge:

- **AIS System** - Agent Intensity Scoring
- **Memory System** - Learning & Pattern Recognition
- **Routing Engine** - Intelligent Model Selection
- **Execution** - Agent Workflow Processing
- **Audit Trail** - SOC2 Compliance Logging
- **Analytics** - Metrics & Reporting
- **Database** - Data Persistence

## Accessing the Visualization

### Admin Access

1. Navigate to the admin panel: `/admin`
2. Click on **"System Flow"** in the sidebar menu
3. The visualization will load at `/admin/system-flow`

### Direct URL

```
https://your-domain.com/admin/system-flow
```

## Features

### 1. Animated Step-by-Step Flow

The visualization shows **20 key steps** in a complete agent execution lifecycle:

**Phase 1: Agent Creation (Steps 1-4)**
- User creates agent
- AIS analysis calculates intensity score
- Store configuration in database
- Log creation event to audit trail

**Phase 2: Execution Start (Steps 5-7)**
- User triggers execution
- Create execution record
- Log execution start

**Phase 3: Step Execution Loop (Steps 8-16)**
- Load memory context
- Analyze step complexity (6 factors)
- Check routing memory for learned patterns
- Make intelligent routing decision
- Execute step with selected model
- Record routing decision (history + audit)
- Learn from execution outcome
- Update agent memory

**Phase 4: Completion (Steps 17-20)**
- Finalize execution
- Store outcome as memory
- Log completion event
- Aggregate analytics

### 2. Interactive Controls

**Play/Pause Button**
- Start/stop the animation flow
- Green button = Play
- Orange button = Pause

**Speed Control**
- **Fast**: 1 second per step
- **Normal**: 2 seconds per step (default)
- **Slow**: 3 seconds per step

**Reset Button**
- Reset animation to beginning
- Clear all completed steps
- Start fresh

**Timeline Navigation**
- Click any step in the timeline to jump directly to it
- Completed steps show green checkmarks
- Current step is highlighted

### 3. Visual Elements

**Subsystem Icons (Left Panel)**
- Shows all 7 subsystems
- Active subsystem highlights during animation
- Color-coded for easy identification:
  - 🟣 Purple: AIS System
  - 🟡 Yellow: Memory System
  - 🔵 Blue: Routing Engine
  - 🟢 Green: Execution
  - 🔴 Red: Audit Trail
  - 🟣 Indigo: Analytics
  - ⚪ Gray: Database

**Current Step Card (Main Panel)**
- Large card showing current step details
- Subsystem badge
- Step number (e.g., "Step 5 of 20")
- Title and description
- Data payload (JSON details)
- Connection information

**Timeline (Right Panel)**
- Scrollable list of all 20 steps
- Visual progress indicators
- Step status (pending/active/completed)
- Click to navigate

### 4. Progress Tracking

**Progress Bar**
- Shows overall completion percentage
- Gradient animation from blue to purple
- Located at the top of the page

**Completed Steps**
- Green checkmarks in timeline
- Persistent across play/pause
- Reset clears all progress

## Understanding the Flow

### Memory-Based Learning

The visualization demonstrates how the system learns over time:

1. **Initial Runs (Steps 8-9)**: System uses complexity-based routing
2. **After 3+ Runs (Step 10)**: Memory patterns start forming
3. **High Confidence (Step 11)**: Memory overrides complexity calculation
4. **Continuous Learning (Step 15)**: Every execution updates patterns

### Key Decision Points

**Step 10: Check Routing Memory**
- If memory exists and is confident: Override!
- If no memory or low confidence: Use complexity

**Step 11: Intelligent Routing Decision**
- Shows "MEMORY OVERRIDE" when using learned patterns
- Displays historical success rate and cost savings
- Falls back to complexity-based routing if needed

### Data Flow

The visualization shows how data flows through subsystems:

```
User Input → AIS → Database → Audit → Memory → Routing → Execution → Learning → Analytics
```

Each step shows:
- **Input data**: What the step receives
- **Processing**: What the step does
- **Output data**: What the step produces
- **Connections**: Which steps follow

## Real-World Example

Imagine running a customer support agent:

**First Execution:**
- Step 9: Analyzes complexity → Score: 4.95
- Step 10: No memory exists yet
- Step 11: Routes to tier2 based on complexity
- Step 15: Learns from outcome (92% success)

**Fifth Execution:**
- Step 10: Memory found! (confidence: medium, 92% success)
- Step 11: Still uses complexity (need higher confidence)
- Step 15: Updates pattern (confidence now 70%)

**Tenth Execution:**
- Step 10: Memory confident! (high confidence, 95% success)
- Step 11: **MEMORY OVERRIDE** - Skip complexity, use tier2 directly
- Step 15: Continuous refinement (success rate: 96%)

**Result:** System learned that tier2 is optimal for this agent's workflow, saving 65% in costs while maintaining 96% success rate!

## Tips for Best Experience

1. **Start with Normal Speed**: This gives you time to read each step
2. **Use Pause**: Stop at interesting steps to examine data
3. **Click Timeline Steps**: Jump to specific subsystems you want to understand
4. **Watch Multiple Times**: Each viewing reveals new details about integration
5. **Compare Phases**: Notice how Phase 3 (steps 8-16) repeats for each workflow step

## Technical Details

### Step Data Payloads

Each step shows its internal data:

**Step 2 (AIS Analysis):**
```json
{
  "factors": ["Goal Complexity", "Required Capabilities", "Expected Interactions"],
  "score": 7.5
}
```

**Step 11 (Routing Decision):**
```json
{
  "decision": "MEMORY OVERRIDE",
  "selectedTier": "tier2",
  "model": "claude-3-5-haiku-20241022",
  "reason": "Historical: 92% success, 65% cost savings"
}
```

**Step 15 (Learning):**
```json
{
  "algorithm": "Exponential Moving Average (α=0.3)",
  "updated": "successRate: 0.92 → 0.946",
  "confidence": "1.0 (high)"
}
```

### Subsystem Integration Points

The visualization highlights critical integration moments:

- **AIS → Routing**: Agent intensity influences model tier selection
- **Memory → Routing**: Learned patterns override complexity calculations
- **Routing → Audit**: Every decision logged for compliance
- **Execution → Memory**: Outcomes feed back into learning system
- **All → Database**: Persistent storage of all data
- **All → Analytics**: Continuous metric aggregation

## Troubleshooting

**Animation not starting:**
- Click the green "Play" button
- Check that you're not at the last step (click "Reset")

**Steps moving too fast/slow:**
- Adjust speed using the dropdown (Fast/Normal/Slow)

**Want to examine a specific step:**
- Click "Pause" button
- Click the step in the timeline
- Read the step data in the main panel

**System seems frozen:**
- Click "Reset" to restart
- Refresh the page if needed

## Next Steps

After understanding the system flow:

1. **Read the detailed docs**: [COMPLETE_SYSTEM_FLOW.md](./COMPLETE_SYSTEM_FLOW.md)
2. **Test the system**: Follow [PER_STEP_ROUTING_TESTING_GUIDE.md](./PER_STEP_ROUTING_TESTING_GUIDE.md)
3. **Configure settings**: Visit `/admin/system-config` and `/admin/ais-config`
4. **Monitor analytics**: Check `/admin/analytics` for real metrics

---

**Document Version**: 1.0
**Last Updated**: 2025-11-03
**Page Location**: `/admin/system-flow`
