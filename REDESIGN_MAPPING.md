# Agent Page Redesign - Complete Mapping

## Summary
- **Current**: 2160 lines, 3-column layout, tabs for results/analytics/insights
- **New**: ~1200 lines, 2-column layout, drawer for settings, modal for insights
- **Goal**: Same functionality, cleaner UI, more efficient code

## Component Mapping

### FROM Current Page → TO New Design

#### 1. **Header/Navigation**
- FROM: Lines 836-851 (Back button + V2Logo + V2Controls)
- TO: Keep V2Logo + V2Controls, move back button to browser back

#### 2. **Agent Info (Left Column)**
- FROM: Lines 856-1200 (Agent card with name, description, status, schedule, plugins, actions)
- TO: **Header Section** - Name, description, health bar, quick actions (Run, Settings, Calibrate)

#### 3. **Action Buttons (7 tiny buttons)**
- FROM: Lines 1260-1400 (Launch/Pause, Run, Edit, Calibration, Export, Duplicate, Share, Delete)
- TO: **Split**:
  - **Header**: Run Now, Settings, Calibrate (only if not production_ready)
  - **Settings Drawer**: Duplicate, Share, Export, Delete

#### 4. **AIS Complexity Card**
- FROM: Lines 1405-1411 (`<AgentIntensityCardV2>`)
- TO: **Settings Drawer** (first section)

#### 5. **Execution History (Middle Column)**
- FROM: Lines 1414-1560 (Execution list with pagination)
- TO: **Timeline (Left Column)** - Simpler execution cards with status badges

#### 6. **Execution Details (Right Column - Results Tab)**
- FROM: Lines 1575-1750 (Logs, status, duration)
- TO: **Details Panel (Right Column)** - Metrics + Analytics/Results cards + Logs

#### 7. **Analytics Tab**
- FROM: Lines 1750-1850 (Separate tab with metrics)
- TO: **Merged into Details Panel** - Side-by-side analytics/results cards

#### 8. **Insights Tab**
- FROM: Lines 1900-1940 (`<InsightsPanel agentId={agentId} executionId={selectedExecution?.id} />`)
- TO: **Two places**:
  - **Alert Banner** (conditional, if insights exist)
  - **Insights Modal** (full insight cards)

#### 9. **Modals/Dialogs**
- FROM: Lines 1960-2160 (Delete confirm, Share confirm, Share success)
- TO: **Keep all** - Delete confirm, Share confirm with validation

## State Variables Mapping

### Keep All Current State:
```typescript
// Core data
const [agent, setAgent] = useState<Agent | null>(null)
const [executions, setExecutions] = useState<Execution[]>([])
const [allExecutions, setAllExecutions] = useState<Execution[]>([])
const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null)
const [loading, setLoading] = useState(true)

// UI state
const [copiedId, setCopiedId] = useState(false)
const [executionPage, setExecutionPage] = useState(1)
const [actionLoading, setActionLoading] = useState<string | null>(null)

// Modals
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
const [showShareConfirm, setShowShareConfirm] = useState(false)
const [showShareSuccess, setShowShareSuccess] = useState(false)

// Sharing data
const [shareCreditsAwarded, setShareCreditsAwarded] = useState(0)
const [shareQualityScore, setShareQualityScore] = useState(0)
const [sharingRewardAmount, setSharingRewardAmount] = useState(500)
const [sharingValidation, setSharingValidation] = useState<any>(null)
const [sharingStatus, setSharingStatus] = useState<any>(null)
const [sharingConfig, setSharingConfig] = useState<any>(null)
const [shareRewardActive, setShareRewardActive] = useState(true)
const [hasBeenShared, setHasBeenShared] = useState(false)

// Other
const [memoryCount, setMemoryCount] = useState(0)
const [tokensPerPilotCredit, setTokensPerPilotCredit] = useState<number>(10)

// Inline editing (if we keep it)
const [isEditing, setIsEditing] = useState(false)
const [editedName, setEditedName] = useState('')
const [editedDescription, setEditedDescription] = useState('')
// ... all schedule editing states
```

### Remove:
```typescript
const [activeTab, setActiveTab] = useState<'results' | 'analytics' | 'insights'>('results')
// No longer needed - modal/drawer instead
```

### Add:
```typescript
const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
const [showInsightsModal, setShowInsightsModal] = useState(false)
```

## Functions Mapping

### Keep All:
- `fetchAgentData()` - Load agent + executions
- `fetchPageConfig()` - System config
- `fetchShareRewardStatus()` - Sharing feature status
- `checkSharingEligibility()` - Validate sharing
- `fetchMemoryCount()` - Agent memory
- `handleToggleStatus()` - Activate/pause
- `handleDuplicateAgent()` - Duplicate
- `handleShareAgent()` - Share with full validation
- `handleDeleteAgent()` - Delete
- `handleExportConfiguration()` - Export JSON
- `copyAgentId()` - Copy ID
- `handleEditClick()` - Navigate to edit
- `handleSandboxClick()` - Navigate to calibration
- `calculateHealthScore()` - Health metrics
- All inline editing functions (if kept)
- All schedule editing functions (if kept)

### Simplify:
```typescript
// OLD: Multiple data fetches
fetchAgentData()
fetchPageConfig()
fetchShareRewardStatus()
fetchMemoryCount()

// NEW: Single batched fetch (IMPROVEMENT)
const fetchAllData = async () => {
  const [agent, executions, config, sharing] = await Promise.all([
    agentApi.get(agentId, userId),
    agentApi.getExecutions(agentId, userId),
    systemConfigApi.getByKeys(['tokens_per_pilot_credit', 'agent_sharing_reward_amount']),
    checkSharingEligibility()
  ])
}
```

## CSS Classes Mapping

Use V2 tokens + match mockup structure:

### Colors:
- `var(--v2-primary)` - Blue primary
- `var(--v2-text-primary)` - Main text
- `var(--v2-text-secondary)` - Secondary text
- `var(--v2-text-muted)` - Muted text
- `var(--v2-surface)` - Card background
- `var(--v2-border)` - Borders
- `var(--v2-background)` - Page background

### Layout Classes (new):
```css
.max-w-[1400px] mx-auto p-6 - Container
.grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 - Main 2-column
.fixed top-0 right-0 w-[500px] - Settings drawer
.fixed top-1/2 left-1/2 -translate - Modal centering
```

## Implementation Strategy

1. ✅ Keep ALL imports from current page
2. ✅ Keep ALL state variables (except activeTab)
3. ✅ Add new state (showSettingsDrawer, showInsightsModal)
4. ✅ Keep ALL functions/handlers
5. ✅ Improve data fetching (consolidate into single call)
6. ✅ New JSX structure:
   - Header with health bar
   - Alert banner (conditional)
   - 2-column layout
   - Settings drawer
   - Insights modal
   - All existing modals

## File Structure

```typescript
// IMPORTS (same as current)

// HELPER FUNCTIONS
function calculateHealth(executions) { ... }
function formatDuration(ms) { ... }
function formatExecutionDate(date) { ... }

// MAIN COMPONENT
export default function V2AgentDetailPage() {
  // ALL STATE VARIABLES

  // ALL EFFECTS

  // ALL HANDLERS

  // RENDER
  return (
    <>
      <V2Logo />
      <V2Controls />

      {/* Header Section */}

      {/* Alert Banner */}

      {/* Main 2-Column Layout */}

      {/* Settings Drawer */}

      {/* Insights Modal */}

      {/* All Existing Modals */}
    </>
  )
}
```

## Testing Checklist

After implementation, verify:
- [ ] Agent loads with all data
- [ ] Executions display in timeline
- [ ] Clicking execution updates details
- [ ] Health bar calculation correct
- [ ] Settings drawer opens/closes
- [ ] All toggles work
- [ ] Duplicate works
- [ ] Share works (with validation)
- [ ] Delete works (with confirmation)
- [ ] Export works
- [ ] Insights show if enabled
- [ ] Alert banner shows if insights exist
- [ ] All modals work
- [ ] Navigation works (run, edit, calibrate)
- [ ] Responsive design works
