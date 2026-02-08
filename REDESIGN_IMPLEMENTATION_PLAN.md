# Agent Detail Page Redesign - Implementation Plan

## Backup Created
✅ `/app/v2/agents/[id]/page.tsx.backup-[timestamp]`

## Current State Analysis

### State Variables to Preserve
- `agent` - Agent data
- `executions` - Filtered execution list
- `allExecutions` - Complete execution list
- `selectedExecution` - Currently selected execution for details panel
- `loading` - Page loading state
- `executing` - Execution in progress
- `copiedId` - Copy ID feedback
- `actionLoading` - Track which action is loading (duplicate, share, delete)
- `showDeleteConfirm` - Delete confirmation modal
- `showShareConfirm` - Share confirmation modal
- `showShareSuccess` - Share success notification
- `shareCreditsAwarded` - Credits earned from sharing
- `shareQualityScore` - Agent quality score
- `sharingRewardAmount`, `sharingValidation`, `sharingStatus`, `sharingConfig` - Sharing feature data
- `shareRewardActive`, `hasBeenShared` - Sharing state
- `memoryCount` - Agent memory count
- `tokensPerPilotCredit` - Token conversion rate
- `executionPage` - Pagination state
- Inline editing states (name, description, schedule, etc.)

### New State Variables to Add
- `showSettingsDrawer` - Settings drawer open/close
- `showInsightsModal` - Insights modal open/close
- `insights` - Insights data for modal
- `insightsEnabled` - Agent insights toggle state

### Functions to Preserve
- `fetchAgentData()` - Load agent and executions
- `fetchPageConfig()` - Load system config
- `fetchShareRewardStatus()` - Check if sharing is enabled
- `checkSharingEligibility()` - Validate sharing eligibility
- `fetchMemoryCount()` - Get agent memory count
- `handleToggleStatus()` - Activate/pause agent
- `handleDuplicateAgent()` - Duplicate agent
- `handleShareAgent()` - Share to templates
- `handleDeleteAgent()` - Delete agent
- `handleExportConfiguration()` - Export agent JSON
- `copyAgentId()` - Copy agent ID to clipboard
- `handleEditClick()` - Navigate to edit page
- `handleSandboxClick()` - Navigate to calibration
- All inline editing functions
- Health calculation function

## New Design Structure

### 1. Header Section (Replaces left column agent info)
```tsx
<div className="header-section">
  <h1>{agent.name}</h1>
  <p className="agent-purpose">{agent.description}</p>

  {/* Health Bar */}
  <div className="health-bar">
    <div className="health-bar-fill" style={{width: `${health.percentage}%`}} />
  </div>

  {/* Quick Actions */}
  <div className="quick-actions">
    <button onClick={handleRunClick}>▶️ Run Now</button>
    <button onClick={() => setShowSettingsDrawer(true)}>⚙️ Settings</button>
    <button onClick={handleSandboxClick}>🎯 Calibrate</button>
  </div>
</div>
```

### 2. Alert Banner (Conditional - only if insights exist)
```tsx
{insights.length > 0 && (
  <div className="alert-banner">
    <div className="alert-content">
      <span>⚠️</span>
      <div>
        <h3>{insights.length} Issues Need Attention</h3>
        <p>Your agent has reliability problems...</p>
      </div>
    </div>
    <button onClick={() => setShowInsightsModal(true)}>
      View Recommendations
    </button>
  </div>
)}
```

### 3. Main Layout (2 columns instead of 3)
```tsx
<div className="main-layout">
  {/* Left: Execution Timeline */}
  <div className="timeline-section">
    {executions.map(exec => (
      <div
        className={`timeline-item ${selectedExecution?.id === exec.id ? 'active' : ''}`}
        onClick={() => setSelectedExecution(exec)}
      >
        <div className="timeline-header">
          <span>{formatDate(exec.started_at)}</span>
          <span className={`status-badge ${exec.status}`}>{exec.status}</span>
        </div>
        <div className="timeline-description">
          {getContextualDescription(exec)}
        </div>
        <div className="timeline-stats">
          <span>⏱ {formatDuration(exec.duration)}</span>
          <span>💰 ${calculateCost(exec)}</span>
        </div>
      </div>
    ))}
  </div>

  {/* Right: Execution Details */}
  <div className="details-section">
    <h2>Latest Execution</h2>
    <div className="metric-grid">
      {/* Duration, Items, Cost */}
    </div>

    {/* Analytics & Results Side by Side */}
    <div className="analytics-results-container">
      <div className="analytics-card">
        {/* Success Rate, Avg Time, API Calls, Tokens */}
      </div>
      <div className="results-card">
        {/* Execution results from logs */}
      </div>
    </div>

    {/* Logs */}
    <div className="log-container">
      {selectedExecution?.logs}
    </div>
  </div>
</div>
```

### 4. Settings Drawer (Replaces settings in left column)
```tsx
<div className={`settings-drawer ${showSettingsDrawer ? 'open' : ''}`}>
  <div className="drawer-header">
    <h2>Agent Settings</h2>
    <button onClick={() => setShowSettingsDrawer(false)}>×</button>
  </div>

  <div className="drawer-content">
    {/* AIS Complexity Score */}
    <AgentIntensityCardV2 agentId={agentId} />

    {/* Intelligence Features */}
    <div className="setting-group">
      <h3>Intelligence Features</h3>
      <ToggleSwitch
        label="Business Insights"
        checked={agent.insights_enabled}
        onChange={handleToggleInsights}
      />
      <ToggleSwitch
        label="Auto-Calibration"
        checked={agent.auto_calibration}
        onChange={handleToggleAutoCalibration}
      />
    </div>

    {/* Execution Settings */}
    <div className="setting-group">
      <h3>Execution Settings</h3>
      <ToggleSwitch
        label="Production Ready"
        checked={agent.production_ready}
        onChange={handleToggleProductionReady}
      />
      <button>Edit Schedule</button>
    </div>

    {/* Notifications */}
    <div className="setting-group">
      <h3>Notifications</h3>
      <ToggleSwitch
        label="Email Alerts"
        checked={emailAlertsEnabled}
        onChange={handleToggleEmailAlerts}
      />
    </div>

    {/* Agent Actions */}
    <div className="setting-group">
      <h3>Agent Actions</h3>
      <button onClick={handleDuplicateAgent}>📋 Duplicate Agent</button>
      <button onClick={handleShareAgentClick}>🔗 Share to Templates</button>
      <button onClick={handleExportConfiguration}>📥 Export Configuration</button>
    </div>

    {/* Danger Zone */}
    <div className="danger-zone">
      <h3>⚠️ Danger Zone</h3>
      <button onClick={() => setShowDeleteConfirm(true)}>🗑️ Delete Agent</button>
    </div>
  </div>
</div>
```

### 5. Insights Modal (Replaces insights tab)
```tsx
<div className={`insights-modal ${showInsightsModal ? 'open' : ''}`}>
  <div className="modal-header">
    <h2>Business Insights & Recommendations</h2>
    <button onClick={() => setShowInsightsModal(false)}>×</button>
  </div>

  <div className="modal-content">
    {insights.map(insight => (
      <InsightCard
        key={insight.id}
        insight={insight}
        onApply={handleApplyInsight}
        onDismiss={handleDismissInsight}
      />
    ))}
  </div>
</div>
```

## Components Affected

### Files to Modify
1. `/app/v2/agents/[id]/page.tsx` - Main page (COMPLETE REWRITE)

### Components to Reuse
1. `AgentIntensityCardV2` - AIS complexity display (in drawer)
2. `AgentHealthCardV2` - Health calculation logic only
3. `InsightsPanel` - Use logic, redesign UI as modal
4. `ConfirmDialog` - Keep for delete confirmation

### New Components to Create
None - all inline in main page for simplicity

## CSS/Styling Strategy

- Use V2 design tokens from existing codebase:
  - `var(--v2-primary)`, `var(--v2-text-primary)`, etc.
  - `var(--v2-radius-button)`, `var(--v2-surface)`, etc.
- Copy styles from mockup HTML but convert to V2 tokens
- Maintain responsive design (grid-template-columns with media queries)

## Data Flow Changes

### Old Flow
1. Load agent → Show 3-column layout
2. Click execution → Update all 3 tabs (results, analytics, insights)
3. Insights in dedicated tab (always visible even if disabled)

### New Flow
1. Load agent → Show header + 2-column layout
2. Click execution → Update right panel only (details)
3. Insights only visible if:
   - Agent has `insights_enabled = true`
   - Insights exist in database
   - Shows as alert banner + modal

## Helper Functions Needed

### 1. Contextual Description Generator
```typescript
function getContextualDescription(execution: Execution): string {
  // Parse logs to generate "Processed 15 invoices" style descriptions
  // Extract meaningful outcomes from execution logs
  // Return user-friendly summary
}
```

### 2. Health Calculation (from existing code)
```typescript
interface HealthMetrics {
  score: number
  maxScore: number
  percentage: number
  recentScore: number
  recentMaxScore: number
  failedCount: number
}

function calculateHealth(allExecutions: Execution[]): HealthMetrics {
  // Use existing logic from AgentHealthCardV2
}
```

### 3. Execution Results Parser
```typescript
function parseExecutionResults(logs: string): {
  analytics: {
    successRate: number
    avgProcessingTime: number
    apiCalls: number
    tokensUsed: number
  }
  results: Array<{
    title: string
    count: number
    items: string[]
  }>
}
```

## Implementation Steps

1. ✅ Create backup
2. ✅ Create implementation plan (this document)
3. Create new page structure with V2 styling
4. Migrate header section
5. Add alert banner (conditional)
6. Build 2-column layout
7. Implement execution timeline
8. Build execution details with analytics/results
9. Create settings drawer
10. Create insights modal
11. Test all functionality
12. Clean up and remove old code

## Migration Checklist

### Preserve
- [x] All state variables
- [ ] All data fetching functions
- [ ] All action handlers (duplicate, share, delete, etc.)
- [ ] Health calculation logic
- [ ] Schedule editing logic
- [ ] Sharing validation logic
- [ ] Export functionality
- [ ] Copy ID functionality

### Remove
- [ ] 3-column grid layout
- [ ] Tab system (results/analytics/insights)
- [ ] 7 small action buttons (move to drawer or header)
- [ ] Inline agent info cards (move to header)
- [ ] Insights tab (replace with modal)

### Add
- [ ] Header with health bar
- [ ] Alert banner component
- [ ] 2-column responsive grid
- [ ] Timeline with contextual descriptions
- [ ] Side-by-side analytics/results cards
- [ ] Settings drawer
- [ ] Insights modal
- [ ] Drawer overlay/backdrop

## Testing Checklist

- [ ] Agent loads correctly
- [ ] Executions display in timeline
- [ ] Clicking execution updates details panel
- [ ] Health bar shows correct percentage
- [ ] Settings drawer opens/closes
- [ ] All toggles work (insights, production_ready, etc.)
- [ ] Duplicate agent works
- [ ] Share agent works (with validation)
- [ ] Delete agent works (with confirmation)
- [ ] Export configuration works
- [ ] Insights modal shows insights (when enabled)
- [ ] Alert banner shows (when insights exist)
- [ ] Copy ID works
- [ ] Navigation to run/edit/calibrate works
- [ ] Responsive design works on mobile
- [ ] All V2 theme colors apply correctly

