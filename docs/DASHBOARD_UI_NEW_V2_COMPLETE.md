# Dashboard UI V2 - Complete Documentation ✅

## Summary
The V2 Dashboard is the central hub for users to monitor their agent ecosystem, track credits, view system alerts, and manage plugin connections. It provides a comprehensive overview with real-time statistics, visual analytics, and quick actions.

**Key Features:**
- ✅ **Credit Balance & Usage** - Real-time credit tracking with visual gauges
- ✅ **Active Agents Overview** - Top agents with execution counts
- ✅ **System Alerts** - Prioritized alerts for failures, quota limits, and critical issues
- ✅ **Recent Activity** - Visual progress bars showing top agent activity
- ✅ **V2 Footer with Plugin Refresh** - Inline token refresh for expired plugins
- ✅ **Responsive Design** - Mobile-first, fully responsive layout
- ✅ **Complete V2 Design System** - CSS variables, consistent styling, dark mode support

---

## Page Structure

### **Route**
`/v2/dashboard`

### **File Location**
[app/v2/dashboard/page.tsx](../app/v2/dashboard/page.tsx)

---

## Layout Architecture

```
┌─────────────────────────────────────────────────────────┐
│ V2Header (Top Navigation)                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Welcome Section                                         │
│ • User greeting (e.g., "Welcome back, Barak!")         │
│ • Subtitle: "Here's what's happening with your agents" │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Credit Balance Gauge (Full Width Card)                 │
│ • Large circular gauge visualization                   │
│ • Current balance, max credits, spent amount           │
│ • Color-coded status (green/yellow/orange/red)         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Cards Grid (2-column on desktop, 1-column on mobile)   │
│                                                         │
│ ┌─────────────────────┬─────────────────────┐          │
│ │ Active Agents       │ System Alerts       │          │
│ │ • Total executions  │ • Priority alerts   │          │
│ │ • Top 3 agents      │ • Failure warnings  │          │
│ │ • Click to navigate │ • Quota warnings    │          │
│ └─────────────────────┴─────────────────────┘          │
│                                                         │
│ ┌─────────────────────┬─────────────────────┐          │
│ │ Recent Activity     │ (Future: Analytics) │          │
│ │ • Top 3 by count    │                     │          │
│ │ • Visual bars       │                     │          │
│ │ • Color-coded       │                     │          │
│ └─────────────────────┴─────────────────────┘          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ V2Footer (Bottom Navigation & Plugin Status)           │
│ • Last Run timestamp                                   │
│ • Connected plugin icons with status indicators        │
│ • Inline token refresh for expired plugins             │
│ • Dark mode toggle                                     │
│ • Create Agent button                                  │
│ • Menu (Agent List, Dashboard, Create Agent)           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### **1. V2Header**
**Location**: [components/v2/V2Header.tsx](../components/v2/V2Header.tsx)

**Purpose**: Consistent top navigation across all V2 pages

**Features**:
- Logo/branding
- Navigation links
- User profile menu
- Responsive hamburger menu on mobile

---

### **2. Welcome Section**
**Lines**: [page.tsx:339-359](../app/v2/dashboard/page.tsx#L339-L359)

**Features**:
- Personalized greeting with user's display name
- Subtitle explaining the dashboard purpose
- Subtle spacing and typography hierarchy

**Code Example**:
```tsx
<div className="space-y-1 sm:space-y-2">
  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--v2-text-primary)]">
    Welcome back, {userName || 'User'}!
  </h1>
  <p className="text-sm sm:text-base text-[var(--v2-text-secondary)]">
    Here's what's happening with your agents
  </p>
</div>
```

**Design Notes**:
- Uses V2 text color variables for consistency
- Responsive font sizes (2xl → 3xl → 4xl)
- Space-y for vertical rhythm

---

### **3. Credit Balance Gauge Card**
**Lines**: [page.tsx:362-404](../app/v2/dashboard/page.tsx#L362-L404)

**Purpose**: Primary visual indicator of user's credit status

**Features**:
- **Large Pie Chart**: Recharts PieChart with custom colors
- **Credit Metrics**:
  - Current Balance (large, prominent)
  - Max Credits (context)
  - Total Spent (lifetime usage)
- **Color-coded Status**:
  - Green (80-100%): Healthy
  - Yellow (50-80%): Warning
  - Orange (20-50%): Low
  - Red (0-20%): Critical
- **Responsive**: Full width on mobile, collapses gracefully

**Visual Representation**:
```
┌──────────────────────────────────────────────┐
│  💰 Credit Balance                           │
│  ────────────────────────────────────────    │
│                                              │
│          ╔════════╗                          │
│          ║  65%   ║  ← Pie chart gauge       │
│          ╚════════╝                          │
│                                              │
│  Balance: 65,000 credits                     │
│  Max: 100,000 credits                        │
│  Spent: 35,000 credits                       │
└──────────────────────────────────────────────┘
```

**Code Highlight**:
```tsx
// Dynamic color based on percentage
const percentage = (stats.creditBalance / stats.maxCredits) * 100
const gaugeColor =
  percentage >= 80 ? '#10B981' :  // Green
  percentage >= 50 ? '#F59E0B' :  // Yellow
  percentage >= 20 ? '#FB923C' :  // Orange
  '#EF4444'                        // Red

const pieData = [
  { name: 'Used', value: stats.creditBalance },
  { name: 'Remaining', value: stats.maxCredits - stats.creditBalance }
]
```

---

### **4. Active Agents Card**
**Lines**: [page.tsx:408-476](../app/v2/dashboard/page.tsx#L408-L476)

**Purpose**: Overview of running agents with execution counts

**Features**:
- **Total Executions**: Aggregate count across all agents
- **Top 3 Agents List**:
  - Agent name (truncated if long)
  - Green status dot indicator
  - Execution count (formatted with commas)
  - Clickable to navigate to agent detail page
- **Overflow Indicator**: Shows "+N more" if more than 3 agents
- **Empty State**: Bot icon with "No active agents yet" message
- **Hover Effects**: Scale on hover, click to navigate

**Visual Representation**:
```
┌─────────────────────────────────────────┐
│ 🤖 Active Agents                        │
│ Your running agents                     │
│                                         │
│ Total Executions        12,456          │
│ ─────────────────────────────────────   │
│                                         │
│ ● Email Summarizer          8,234 runs │
│ ● Slack Notifier            3,421 runs │
│ ● Report Generator            801 runs │
│                                         │
│ +2 more                                 │
└─────────────────────────────────────────┘
```

**Code Highlight**:
```tsx
<div className="flex items-center justify-between py-2.5 px-3
  bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100
  active:scale-[0.98] transition-all cursor-pointer"
  onClick={() => router.push(`/v2/agents/${agent.id}`)}
>
  <div className="flex items-center gap-2">
    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
    <span className="text-sm font-medium">{agent.name}</span>
  </div>
  <div className="flex items-center gap-1">
    <span className="text-sm font-bold">{agent.count.toLocaleString()}</span>
    <span className="text-[10px] text-muted">runs</span>
  </div>
</div>
```

---

### **5. System Alerts Card**
**Lines**: [page.tsx:479-544](../app/v2/dashboard/page.tsx#L479-L544)

**Purpose**: Prioritized alerts for failures, quota warnings, and critical issues

**Features**:
- **Alert Types** (prioritized by severity):
  1. **Critical** (🔴 Red): Agent failures in last 24h
  2. **Warning** (🟠 Orange): Credit balance below 20%
  3. **Caution** (🟡 Yellow): Storage or execution quota above 80%
  4. **Info** (🔵 Blue): General notifications
- **Dynamic Calculation**: Alerts computed based on real-time stats
- **Scrollable List**: Overflow-y-auto for many alerts
- **Empty State**: Green checkmark with "All systems operational"

**Visual Representation**:
```
┌─────────────────────────────────────────┐
│ ⚠️  System Alerts                       │
│ Monitor potential issues and failures   │
│                                         │
│ 🔴 3 agent runs failed in last 24h     │
│ 🟠 Credit balance below 20% (12%)      │
│ 🟡 Storage usage at 85% (340MB/400MB)  │
│                                         │
│ [Scrollable if more alerts...]         │
└─────────────────────────────────────────┘
```

**Alert Calculation Logic** ([lines 89-145](../app/v2/dashboard/page.tsx#L89-L145)):
```tsx
const calculateSystemAlerts = (
  failedCount: number,
  storageUsedMB: number,
  storageQuotaMB: number,
  executionsUsed: number,
  executionsQuota: number | null,
  pilotCredits: number
): SystemAlert[] => {
  const alerts: SystemAlert[] = []

  // 1. Critical: Agent Failures
  if (failedCount > 0) {
    alerts.push({
      type: 'critical',
      icon: '🔴',
      message: `${failedCount} agent run${failedCount > 1 ? 's' : ''} failed in the last 24 hours`,
      severity: 4
    })
  }

  // 2. Warning: Low Credits
  const creditPercentage = (pilotCredits / 100000) * 100
  if (creditPercentage < 20) {
    alerts.push({
      type: 'warning',
      icon: '🟠',
      message: `Credit balance below 20% (${creditPercentage.toFixed(0)}%)`,
      severity: 3
    })
  }

  // 3. Caution: Storage Quota
  const storagePercentage = (storageUsedMB / storageQuotaMB) * 100
  if (storagePercentage >= 80) {
    alerts.push({
      type: 'caution',
      icon: '🟡',
      message: `Storage usage at ${storagePercentage.toFixed(0)}% (${storageUsedMB}MB/${storageQuotaMB}MB)`,
      severity: 2
    })
  }

  // Sort by severity (highest first)
  return alerts.sort((a, b) => b.severity - a.severity)
}
```

---

### **6. Recent Activity Card**
**Lines**: [page.tsx:547-627](../app/v2/dashboard/page.tsx#L547-L627)

**Purpose**: Visual representation of top 3 most active agents

**Features**:
- **Top 3 Sorting**: Agents sorted by execution count
- **Visual Progress Bars**:
  - Relative width based on max count
  - Color-coded (Purple, Cyan, Green, etc.)
  - Smooth animated fill
- **Agent Metrics**:
  - Colored dot indicator
  - Agent name (truncated)
  - Execution count
- **Responsive**: Adjusts bar width and font sizes

**Visual Representation**:
```
┌─────────────────────────────────────────┐
│ 📊 Recent Activity                      │
│ Top 3 most active agents                │
│                                         │
│ 🟣 Email Summarizer            8,234   │
│ ████████████████████████████████ 100%  │
│                                         │
│ 🔵 Slack Notifier              3,421   │
│ █████████████                    42%   │
│                                         │
│ 🟢 Report Generator              801   │
│ ███                              10%   │
└─────────────────────────────────────────┘
```

**Code Highlight**:
```tsx
const topAgents = [...stats.agentStats]
  .sort((a, b) => b.count - a.count)
  .slice(0, 3)

const maxCount = Math.max(...topAgents.map(a => a.count))
const colors = ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444']

topAgents.map((agent, index) => {
  const widthPercent = (agent.count / maxCount) * 100
  const color = colors[index]

  return (
    <div className="space-y-1.5">
      {/* Agent name and count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <span>{agent.name}</span>
        </div>
        <span className="font-bold">{agent.count}</span>
      </div>

      {/* Progress bar */}
      <div className="bg-gray-100 dark:bg-gray-800 rounded-full h-2">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${widthPercent}%`,
            backgroundColor: color
          }}
        />
      </div>
    </div>
  )
})
```

---

## V2 Footer - Plugin Token Refresh Feature

### **Overview**
The V2 Footer is a persistent bottom navigation bar that displays connected plugin status with **inline token refresh** functionality. This allows users to quickly refresh expired OAuth tokens without leaving the page or opening modals.

**Location**: [components/v2/Footer.tsx](../components/v2/Footer.tsx)

---

### **Footer Layout**

```
┌──────────────────────────────────────────────────────────────┐
│ Footer                                                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ 🕐 Last Run: 2h ago                                          │
│                                                              │
│     Plugin Icons (Center):                                  │
│     ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐                                │
│     │📧│  │📅│  │💬│  │🔧│  │📊│                            │
│     └─┘  └─┘  └─┘  └─┘  └─┘                                │
│      🟢   🟢🟠  🟢   🟢   🟢                                  │
│           ↑ Expired: split green/orange indicator           │
│                                                              │
│                                      [🌙] [+] [⋮]           │
│                                      Dark  New  Menu         │
└──────────────────────────────────────────────────────────────┘
```

---

### **Plugin Icon States**

#### **1. Active Plugin (Fully Connected)**
- **Indicator**: Solid green dot (top-right of icon)
- **Tooltip**: Shows "Connected" with connection details
- **Interaction**: Hover only (no click)

#### **2. Expired Plugin (Token Expired)**
- **Indicator**: Split green/orange dot with pulse animation
- **Tooltip**: Shows "Token Expired - Click to refresh token" with 🔄 icon
- **Interaction**: Clickable to refresh

#### **3. During Refresh (Loading)**
- **Overlay**: Semi-transparent surface with spinning loader
- **Animation**: Rotating loader icon
- **Duration**: Until API responds

#### **4. Success State**
- **Overlay**: Green background with white checkmark
- **Duration**: 2 seconds
- **After**: Icon updates to solid green (active)

#### **5. Error State**
- **Overlay**: Red background with white alert icon
- **Duration**: 3 seconds
- **After**: Reverts to expired state (can retry)

---

### **Inline Token Refresh Flow**

**User Journey**:
```
1. User sees expired plugin (🟢🟠 split indicator)
   ↓
2. Hovers over plugin → Tooltip shows "Click to refresh token"
   ↓
3. Clicks plugin icon
   ↓
4. Loading overlay appears (⏳ spinning icon)
   ↓
5a. SUCCESS → Green checkmark (✅) for 2s → Icon turns fully green (🟢)
   OR
5b. REFRESH FAILED → OAuth Reconnection Modal appears
   ↓
6. User sees centered modal with options:
   - [Cancel] → Modal closes, plugin stays expired
   - [🔌 Reconnect] → OAuth flow starts
   ↓
7. OAuth popup opens → User authenticates
   ↓
8. Success → Green checkmark (✅) for 2s → Icon updates → Footer auto-refreshes
```

### **Plugin Disconnect Flow**

**User Journey**:
```
1. User sees active plugin (🟢 solid green indicator)
   ↓
2. Hovers over plugin → Tooltip shows "Click to disconnect"
   ↓
3. Clicks plugin icon
   ↓
4. Disconnect confirmation modal appears (red theme)
   ↓
5. User sees centered modal with options:
   - [Cancel] → Modal closes, plugin stays connected
   - [🔴 Disconnect] → Disconnect process starts
   ↓
6. Loading overlay appears (⏳ red spinning icon)
   ↓
7a. SUCCESS → Green checkmark (✅) for 2s → Plugin removed from footer
   OR
7b. ERROR → Red error icon (❌) with message for 3s
```

---

### **Implementation Details**

#### **State Management** ([Footer.tsx:59-69](../components/v2/Footer.tsx#L59-L69)):
```tsx
// Track which plugin is currently refreshing
const [refreshingPlugin, setRefreshingPlugin] = useState<string | null>(null)

// Track refresh result (success or error)
const [refreshStatus, setRefreshStatus] = useState<{
  plugin: string
  status: 'success' | 'error'
  message?: string
} | null>(null)
```

---

#### **Refresh Handler** ([Footer.tsx:101-173](../components/v2/Footer.tsx#L101-L173)):
```tsx
const handlePluginRefresh = async (plugin: ConnectedPlugin) => {
  // Prevent refresh if not expired or already refreshing
  if (!plugin.is_expired || refreshingPlugin) return

  setRefreshingPlugin(plugin.plugin_key)
  setRefreshStatus(null)

  try {
    // Call the refresh token API
    const response = await fetch('/api/plugins/refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pluginKeys: [plugin.plugin_key]
      })
    })

    const result = await response.json()

    if (result.success && result.refreshed?.includes(plugin.plugin_key)) {
      // Success!
      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'success'
      })

      // Clear success message after 2 seconds
      setTimeout(() => {
        setRefreshStatus(null)
        setRefreshingPlugin(null)

        // Update local state for immediate UI feedback
        setDisplayPlugins(prev => prev.map(p =>
          p.plugin_key === plugin.plugin_key
            ? { ...p, is_expired: false, status: 'active' }
            : p
        ))
      }, 2000)
    } else {
      // Failed or skipped
      const errorMsg = result.failed?.includes(plugin.plugin_key)
        ? 'Failed to refresh token. Click to try again.'
        : result.notFound?.includes(plugin.plugin_key)
        ? 'Plugin not found.'
        : result.message || 'Token refresh unsuccessful.'

      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'error',
        message: errorMsg
      })

      // Clear error after 3 seconds
      setTimeout(() => {
        setRefreshStatus(null)
        setRefreshingPlugin(null)
      }, 3000)
    }
  } catch (error: any) {
    console.error('Plugin refresh error:', error)
    setRefreshStatus({
      plugin: plugin.plugin_key,
      status: 'error',
      message: error.message || 'Network error. Please try again.'
    })

    setTimeout(() => {
      setRefreshStatus(null)
      setRefreshingPlugin(null)
    }, 3000)
  }
}
```

---

#### **Visual Overlays** ([Footer.tsx:227-255](../components/v2/Footer.tsx#L227-L255)):

**Loading Overlay**:
```tsx
{refreshingPlugin === plugin.plugin_key && (
  <div
    className="absolute inset-0 bg-[var(--v2-surface)]/95
      flex items-center justify-center backdrop-blur-sm"
    style={{ borderRadius: 'var(--v2-radius-button)' }}
  >
    <Loader2 className="w-6 h-6 text-[var(--v2-primary)] animate-spin" />
  </div>
)}
```

**Success Overlay**:
```tsx
{refreshStatus?.plugin === plugin.plugin_key && refreshStatus.status === 'success' && (
  <div
    className="absolute inset-0 bg-green-500/95
      flex items-center justify-center animate-fade-in"
    style={{ borderRadius: 'var(--v2-radius-button)' }}
  >
    <CheckCircle2 className="w-7 h-7 text-white" />
  </div>
)}
```

**Error Overlay**:
```tsx
{refreshStatus?.plugin === plugin.plugin_key && refreshStatus.status === 'error' && (
  <div
    className="absolute inset-0 bg-red-500/95
      flex items-center justify-center animate-fade-in"
    style={{ borderRadius: 'var(--v2-radius-button)' }}
  >
    <AlertCircle className="w-7 h-7 text-white" />
  </div>
)}
```

---

#### **Enhanced Tooltip** ([Footer.tsx:299-303](../components/v2/Footer.tsx#L299-L303)):
```tsx
{plugin.is_expired && (
  <div className="text-orange-600 dark:text-orange-400 text-[11px]
    mt-2 pt-2 border-t border-[var(--v2-border)]
    font-semibold flex items-center gap-1.5">
    <RefreshCw className="w-3 h-3" />
    Click to refresh token
  </div>
)}
```

**Tooltip Features**:
- Shows plugin name and display name
- Connection status (Connected/Token Expired)
- Connected date
- Expiration date
- Last refresh timestamp
- Last used timestamp
- **Prominent "Click to refresh token" CTA** for expired plugins

---

### **OAuth Reconnection Modal**

When automatic token refresh fails, the system presents a centered modal dialog prompting the user to reconnect via OAuth.

#### **Modal Design**

```
                Screen Center
                     ↓
         ┌─────────────────────────────┐
         │                             │
         │       [!] Alert Icon         │
         │                             │
         │  Token Refresh Failed       │ ← Title
         │                             │
         │  Gmail needs to be          │ ← Plugin name
         │  reconnected                │
         │                             │
         │  Would you like to          │ ← Description
         │  reconnect via OAuth to     │
         │  refresh your access token? │
         │                             │
         │  [Cancel]  [🔌 Reconnect]   │ ← Actions
         │                             │
         └─────────────────────────────┘
              Dark backdrop behind
```

#### **Modal Components** ([Footer.tsx:633-707](../components/v2/Footer.tsx#L633-L707)):

**1. Backdrop**:
- Semi-transparent black overlay (`bg-black/50`)
- Clicking closes modal (cancels reconnection)
- Z-index 50 for proper layering
- Smooth fade-in animation

**2. Modal Card**:
- Centered positioning (`fixed top-1/2 left-1/2 -translate`)
- V2 surface background with border
- Shadow-2xl for depth
- 320px-400px width (responsive)
- V2 card border radius

**3. Alert Icon**:
- Large orange alert circle (14x14)
- Subtle orange background (`bg-orange-500/10`)
- Centered at top of modal
- Communicates warning/attention needed

**4. Content Sections**:
- **Title**: "Token Refresh Failed" (bold, large)
- **Plugin Name**: Shows which service needs reconnection
- **Description**: Clear explanation of OAuth requirement
- All text uses V2 color variables

**5. Action Buttons**:
- **Cancel**: Secondary style (border, hover effect)
- **Reconnect**: Primary V2 color with PlugZap icon
- Equal width (flex-1)
- Proper spacing and hover states

#### **State Management** ([Footer.tsx:72-75](../components/v2/Footer.tsx#L72-L75)):
```tsx
// State for OAuth reconnection flow
const [reconnectPrompt, setReconnectPrompt] = useState<string | null>(null)
const [reconnecting, setReconnecting] = useState<string | null>(null)
```

**reconnectPrompt**: Stores plugin_key of plugin needing reconnection (triggers modal)
**reconnecting**: Stores plugin_key during OAuth flow (shows loading)

#### **Reconnection Handler** ([Footer.tsx:134-184](../components/v2/Footer.tsx#L134-L184)):
```tsx
const handleOAuthReconnect = async (plugin: ConnectedPlugin) => {
  if (!user) return

  setReconnectPrompt(null)  // Close modal
  setReconnecting(plugin.plugin_key)  // Show loading on icon

  try {
    const pluginAPIClient = getPluginAPIClient()
    const result = await pluginAPIClient.connectPlugin(user.id, plugin.plugin_key)

    if (result.success) {
      // Success! Auto-refresh footer
      setReconnecting(null)
      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'success'
      })

      setTimeout(async () => {
        setRefreshStatus(null)
        // Reload plugins to get updated status
        await loadPlugins()
      }, 2000)
    } else {
      // OAuth failed
      setReconnecting(null)
      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'error',
        message: result.error || 'OAuth connection failed'
      })

      setTimeout(() => {
        setRefreshStatus(null)
      }, 3000)
    }
  } catch (error: any) {
    console.error('OAuth reconnection error:', error)
    setReconnecting(null)
    setRefreshStatus({
      plugin: plugin.plugin_key,
      status: 'error',
      message: error.message || 'Failed to reconnect'
    })

    setTimeout(() => {
      setRefreshStatus(null)
    }, 3000)
  }
}
```

#### **Plugin Icon During Reconnection Prompt** ([Footer.tsx:424-432](../components/v2/Footer.tsx#L424-L432)):
```tsx
{/* Small indicator on plugin icon during reconnection prompt */}
{reconnectPrompt === plugin.plugin_key && (
  <div
    className="absolute inset-0 bg-orange-500/20
      flex items-center justify-center animate-pulse"
    style={{ borderRadius: 'var(--v2-radius-button)' }}
  >
    <AlertCircle className="w-5 h-5 text-orange-500" />
  </div>
)}
```

**Visual Effect**: While modal is open, the plugin icon shows a pulsing orange overlay with alert icon, helping user identify which plugin needs attention.

#### **OAuth Flow States**

```
┌──────────────────────────────────────────────┐
│ State 1: Refresh Failed                      │
│ • Plugin icon: Pulsing orange overlay        │
│ • Modal: Visible with Cancel/Reconnect       │
└──────────────────────────────────────────────┘
              ↓ User clicks "Reconnect"
┌──────────────────────────────────────────────┐
│ State 2: OAuth In Progress                   │
│ • Modal: Closed                              │
│ • Plugin icon: Loading spinner + "Opening    │
│   OAuth..." text                             │
│ • OAuth popup: Opens in new window           │
└──────────────────────────────────────────────┘
              ↓ User authenticates
┌──────────────────────────────────────────────┐
│ State 3: Success                             │
│ • OAuth popup: Closes                        │
│ • Plugin icon: Green checkmark (2s)          │
│ • Footer: Auto-refreshes with updated status │
└──────────────────────────────────────────────┘
```

#### **Error Handling**

**Refresh Failures Trigger Modal** ([Footer.tsx:237-264](../components/v2/Footer.tsx#L237-L264)):
```tsx
if (result.failed?.includes(plugin.plugin_key)) {
  setRefreshingPlugin(null)
  setReconnectPrompt(plugin.plugin_key)  // Show modal
} else if (result.notFound?.includes(plugin.plugin_key)) {
  // Show error overlay (not reconnect modal)
  setRefreshStatus({
    plugin: plugin.plugin_key,
    status: 'error',
    message: 'Plugin not found.'
  })
}

// Network errors also trigger reconnection modal
catch (error: any) {
  setRefreshingPlugin(null)
  setReconnectPrompt(plugin.plugin_key)
}
```

**Design Decision**: Failed token refresh and network errors assume OAuth is needed, while "not found" errors show standard error overlay.

#### **UX Benefits**

✅ **Clear Escalation Path**: Automatic refresh fails → prompt for manual OAuth
✅ **Non-Blocking**: Modal appears only when needed, doesn't interrupt successful refreshes
✅ **User Control**: User can cancel if they don't want to reconnect now
✅ **Professional Design**: Centered modal with proper backdrop, matches alert UI patterns
✅ **Visual Feedback**: Plugin icon shows what needs attention while modal is open
✅ **Automatic Recovery**: After successful OAuth, footer auto-refreshes without user action

---

### **Plugin Disconnect Functionality**

Users can disconnect active (connected) plugins directly from the footer by clicking on them. This provides quick access to plugin management without navigating to a separate settings page.

#### **User Flow**

```
1. User sees active plugin (🟢 solid green indicator)
   ↓
2. Hovers over plugin → Tooltip shows "Click to disconnect"
   ↓
3. Clicks plugin icon
   ↓
4. Disconnect confirmation modal appears (centered, red theme)
   ↓
5. User chooses:
   - [Cancel] → Modal closes, plugin stays connected
   - [🔴 Disconnect] → Disconnect process starts
   ↓
6. Loading overlay appears (⏳ red spinning icon)
   ↓
7a. SUCCESS → Green checkmark (✅) for 2s → Plugin removed from footer
   OR
7b. ERROR → Red error icon (❌) with message for 3s
```

#### **Modal Design**

```
                Screen Center
                     ↓
         ┌─────────────────────────────┐
         │                             │
         │       [X] Alert Icon        │ ← Red icon
         │                             │
         │  Disconnect Plugin          │ ← Title
         │                             │
         │  Gmail                      │ ← Plugin name
         │                             │
         │  Are you sure you want to   │ ← Warning
         │  disconnect this plugin?    │
         │  You will need to           │
         │  reconnect and authorize    │
         │  again to use it.           │
         │                             │
         │  [Cancel]  [🔴 Disconnect]  │ ← Actions
         │                             │
         └─────────────────────────────┘
              Dark backdrop behind
```

#### **Modal Components** ([Footer.tsx:791-865](../components/v2/Footer.tsx#L791-L865)):

**1. Backdrop**:
- Semi-transparent black overlay (`bg-black/50`)
- Clicking closes modal (cancels disconnect)
- Z-index 50 for proper layering
- Smooth fade-in animation

**2. Modal Card**:
- Centered positioning (`fixed top-1/2 left-1/2 -translate`)
- V2 surface background with border
- Shadow-2xl for depth
- 320px-400px width (responsive)
- V2 card border radius

**3. Alert Icon**:
- Large red X circle (14x14)
- Subtle red background (`bg-red-500/10`)
- Centered at top of modal
- Communicates destructive action warning

**4. Content Sections**:
- **Title**: "Disconnect Plugin" (bold, large)
- **Plugin Name**: Shows which service will be disconnected
- **Warning**: Clear explanation of consequences
- All text uses V2 color variables

**5. Action Buttons**:
- **Cancel**: Secondary style (border, hover effect)
- **Disconnect**: Red destructive style with XCircle icon
- Equal width (flex-1)
- Proper spacing and hover states (red-600 on hover)

#### **State Management** ([Footer.tsx:78-80](../components/v2/Footer.tsx#L78-L80)):
```tsx
// State for plugin disconnection flow
const [disconnectPrompt, setDisconnectPrompt] = useState<string | null>(null)
const [disconnecting, setDisconnecting] = useState<string | null>(null)
```

**disconnectPrompt**: Stores plugin_key of plugin needing disconnect confirmation (triggers modal)
**disconnecting**: Stores plugin_key during disconnect process (shows loading)

#### **Disconnect Handler** ([Footer.tsx:217-266](../components/v2/Footer.tsx#L217-L266)):
```tsx
const handleConfirmDisconnect = async (plugin: ConnectedPlugin) => {
  if (!user) return

  setDisconnectPrompt(null)  // Close modal
  setDisconnecting(plugin.plugin_key)  // Show loading on icon

  try {
    const pluginAPIClient = getPluginAPIClient()
    const result = await pluginAPIClient.disconnectPlugin(user.id, plugin.plugin_key)

    if (result.success) {
      // Success! Show checkmark and remove
      setDisconnecting(null)
      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'success'
      })

      setTimeout(() => {
        setRefreshStatus(null)
        // Remove plugin from footer
        setDisplayPlugins(prev => prev.filter(p => p.plugin_key !== plugin.plugin_key))
      }, 2000)
    } else {
      // Disconnect failed
      setDisconnecting(null)
      setRefreshStatus({
        plugin: plugin.plugin_key,
        status: 'error',
        message: result.error || 'Failed to disconnect'
      })

      setTimeout(() => {
        setRefreshStatus(null)
      }, 3000)
    }
  } catch (error: any) {
    console.error('Plugin disconnect error:', error)
    setDisconnecting(null)
    setRefreshStatus({
      plugin: plugin.plugin_key,
      status: 'error',
      message: error.message || 'Network error'
    })

    setTimeout(() => {
      setRefreshStatus(null)
    }, 3000)
  }
}
```

#### **Plugin Icon During Disconnect Prompt** ([Footer.tsx:449-456](../components/v2/Footer.tsx#L449-L456)):
```tsx
{/* Pulsing red indicator on plugin icon during disconnect prompt */}
{disconnectPrompt === plugin.plugin_key && (
  <div
    className="absolute inset-0 bg-red-500/20
      flex items-center justify-center animate-pulse"
    style={{ borderRadius: 'var(--v2-radius-button)' }}
  >
    <XCircle className="w-5 h-5 text-red-500" />
  </div>
)}
```

**Visual Effect**: While modal is open, the plugin icon shows a pulsing red overlay with X icon, helping user identify which plugin will be disconnected.

#### **Plugin Click Router** ([Footer.tsx:198-214](../components/v2/Footer.tsx#L198-L214)):
```tsx
const handlePluginClick = (plugin: ConnectedPlugin) => {
  // Don't allow clicks during any ongoing operation
  if (disconnecting || refreshingPlugin || reconnecting) return

  if (plugin.is_expired) {
    // Expired plugins: trigger refresh
    handlePluginRefresh(plugin)
  } else {
    // Active plugins: trigger disconnect prompt
    setDisconnectPrompt(plugin.plugin_key)
  }
}
```

**Design Decision**: Single click handler routes to appropriate action based on plugin status:
- **Expired plugins** → Token refresh flow
- **Active plugins** → Disconnect confirmation flow

#### **Disconnect Flow States**

```
┌──────────────────────────────────────────────┐
│ State 1: Disconnect Prompt                   │
│ • Plugin icon: Pulsing red overlay           │
│ • Modal: Visible with Cancel/Disconnect      │
└──────────────────────────────────────────────┘
              ↓ User clicks "Disconnect"
┌──────────────────────────────────────────────┐
│ State 2: Disconnecting In Progress           │
│ • Modal: Closed                              │
│ • Plugin icon: Red loading spinner +         │
│   "Disconnecting..." text                    │
└──────────────────────────────────────────────┘
              ↓ API completes
┌──────────────────────────────────────────────┐
│ State 3: Success                             │
│ • Plugin icon: Green checkmark (2s)          │
│ • Footer: Plugin removed from list           │
└──────────────────────────────────────────────┘
```

#### **Tooltip Updates** ([Footer.tsx:520-531](../components/v2/Footer.tsx#L520-L531)):

**Expired Plugins**:
```tsx
<div className="text-orange-600 dark:text-orange-400 text-[11px] ...">
  <RefreshCw className="w-3 h-3" />
  Click to refresh token
</div>
```

**Active Plugins**:
```tsx
<div className="text-red-600 dark:text-red-400 text-[11px] ...">
  <XCircle className="w-3 h-3" />
  Click to disconnect
</div>
```

**Design Pattern**: Tooltips use color-coding to communicate action type:
- **Orange**: Warning level (refresh needed)
- **Red**: Destructive action (disconnect)

#### **Color Scheme Comparison**

| Feature | Color | Icon | Meaning |
|---------|-------|------|---------|
| **OAuth Reconnection** | Orange (`orange-500`) | `AlertCircle` | Warning - Action needed |
| **Plugin Disconnect** | Red (`red-500`) | `XCircle` | Destructive - Remove connection |
| **Success State** | Green (`green-500`) | `CheckCircle2` | Success - Operation complete |
| **Error State** | Red (`red-500`) | `AlertCircle` | Error - Operation failed |

#### **UX Benefits**

✅ **Quick Access**: Disconnect plugins without navigating to settings
✅ **Clear Warning**: Modal clearly explains consequences of disconnection
✅ **User Control**: Cancel option prevents accidental disconnects
✅ **Visual Distinction**: Red color scheme signals destructive action
✅ **Immediate Feedback**: Loading states and success/error indicators
✅ **Clean Removal**: Plugin removed from footer after successful disconnect
✅ **Professional Design**: Matches established modal pattern from OAuth reconnection

---

### **API Integration**

**Endpoint**: `/api/plugins/refresh-token`

**Request**:
```json
{
  "pluginKeys": ["gmail"]
}
```

**Response (Success)**:
```json
{
  "success": true,
  "message": "Processed 1 plugin(s): 1 refreshed, 0 skipped, 0 failed, 0 not found",
  "refreshed": ["gmail"],
  "skipped": [],
  "failed": [],
  "notFound": []
}
```

**Response (Error)**:
```json
{
  "success": false,
  "message": "Processed 1 plugin(s): 0 refreshed, 0 skipped, 1 failed, 0 not found",
  "refreshed": [],
  "skipped": [],
  "failed": ["gmail"],
  "notFound": []
}
```

---

### **UX Benefits**

✅ **No Modal Interruption**: Refresh happens inline without popup
✅ **Immediate Feedback**: Loading spinner shows instantly
✅ **Clear Status**: Green checkmark = success, Red X = error
✅ **Retry-Friendly**: Failed refreshes can be retried by clicking again
✅ **Non-Blocking**: User can continue browsing while refresh happens
✅ **Visual Clarity**: Split indicator makes expired plugins obvious
✅ **Contextual Help**: Tooltip explains what to do

---

### **Animation & Timing**

**Animations**:
- **Loading**: Continuous spin animation (native CSS)
- **Success/Error**: Fade-in animation (0.2s ease-in-out)
- **Hover**: Scale-110 transform on hover

**Timings**:
- **Loading**: Until API responds (typically 1-3 seconds)
- **Success Display**: 2 seconds
- **Error Display**: 3 seconds
- **Fade-in Animation**: 200ms

**CSS Animation** ([Footer.tsx:412-424](../components/v2/Footer.tsx#L412-L424)):
```css
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.animate-fade-in {
  animation: fade-in 0.2s ease-in-out;
}
```

---

## V2 Design System Alignment

All dashboard components follow the V2 design system standards:

### **Colors**
- **Text**: `var(--v2-text-primary)`, `var(--v2-text-secondary)`, `var(--v2-text-muted)`
- **Surface**: `var(--v2-surface)`, `var(--v2-surface-hover)`
- **Border**: `var(--v2-border)`
- **Primary**: `var(--v2-primary)`, `var(--v2-secondary)` (gradient)
- **Status**:
  - Success: `var(--v2-status-success-bg/text/border)`
  - Warning: `var(--v2-status-warning-bg/text/border)`
  - Error: `var(--v2-status-error-bg/text/border)`

### **Border Radius**
- **Cards**: `var(--v2-radius-card)` (16px)
- **Buttons**: `var(--v2-radius-button)` (12px)

### **Shadows**
- **Cards**: `var(--v2-shadow-card)`
- **Buttons**: `var(--v2-shadow-button)`

### **Responsive Breakpoints**
- **Mobile**: Default (< 640px)
- **Tablet**: `sm:` (≥ 640px)
- **Desktop**: `lg:` (≥ 1024px)

---

## Data Fetching & State Management

### **Data Sources**

**1. User Stats** ([page.tsx:182-280](../app/v2/dashboard/page.tsx#L182-L280)):
```tsx
const fetchDashboardStats = async () => {
  const { data: userMetadata } = await supabase
    .from('user_metadata')
    .select('pilot_credits, storage_used_mb, storage_quota_mb, executions_used, executions_quota')
    .eq('user_id', user.id)
    .single()

  const { data: agentStats } = await supabase
    .from('agent_stats')
    .select('agent_id, agent_name, execution_count, last_run_at, failed_count')
    .eq('user_id', user.id)

  const { data: recentRuns } = await supabase
    .from('agent_execution_logs')
    .select('id, agent_name, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // Calculate system alerts
  const systemAlerts = calculateSystemAlerts(
    totalFailedCount,
    userMetadata?.storage_used_mb || 0,
    userMetadata?.storage_quota_mb || 500,
    userMetadata?.executions_used || 0,
    userMetadata?.executions_quota,
    userMetadata?.pilot_credits || 0
  )

  setStats({
    creditBalance: userMetadata?.pilot_credits || 0,
    totalSpent: totalSpent,
    agentStats: formattedAgentStats,
    recentRuns: recentRuns || [],
    systemAlerts: systemAlerts,
    // ...
  })
}
```

**2. User Display Name** ([page.tsx:283-298](../app/v2/dashboard/page.tsx#L283-L298)):
```tsx
const fetchUserDisplayName = async () => {
  const { data: userData } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', user.id)
    .single()

  setUserName(userData?.display_name || user.email?.split('@')[0] || 'User')
}
```

---

### **Real-time Updates**

**Auto-Refresh**: Dashboard data refreshes every time the page loads

**Future Enhancement**: Add real-time subscriptions for:
- Agent execution status changes
- Credit balance updates
- New system alerts

---

## Responsive Design

### **Mobile (< 640px)**
- Single column layout
- Smaller font sizes (text-2xl for heading)
- Compact spacing (space-y-3, gap-3)
- Footer wraps vertically
- Plugin icons smaller (w-12 h-12)

### **Tablet (640px - 1024px)**
- 2-column grid for cards
- Medium font sizes (text-3xl for heading)
- Medium spacing (space-y-4, gap-4)
- Footer stays horizontal
- Plugin icons medium (w-14 h-14)

### **Desktop (≥ 1024px)**
- 2-column grid with more breathing room
- Large font sizes (text-4xl for heading)
- Generous spacing (space-y-6, gap-6)
- Footer fully horizontal
- Plugin icons standard size

---

## Dark Mode Support

All components support dark mode via CSS variables:

**Light Mode**:
- Background: `#FFFFFF`
- Text Primary: `#1F2937`
- Text Secondary: `#6B7280`
- Border: `#E5E7EB`

**Dark Mode**:
- Background: `#0F172A`
- Text Primary: `#F8FAFC`
- Text Secondary: `#CBD5E1`
- Border: `#334155`

**Toggle**: Located in V2Footer

---

## Performance Optimizations

### **Loading States**
- Skeleton loaders while fetching data
- Optimistic UI updates (plugin refresh shows immediately)
- Debounced search queries

### **Lazy Loading**
- Charts rendered only when data available
- Images lazy-loaded for plugin icons

### **Caching**
- UserProvider caches plugin status
- Dashboard stats cached until page refresh

---

## Accessibility

### **Keyboard Navigation**
- All interactive elements focusable via Tab
- Enter/Space to activate buttons
- Escape to close menus

### **Screen Readers**
- Semantic HTML (`<main>`, `<nav>`, `<article>`)
- ARIA labels on icon buttons
- Alt text on images

### **Color Contrast**
- WCAG AA compliant
- Text readable in both light and dark modes
- Status colors distinguishable

---

## Testing Checklist

### **Dashboard Components**
- [x] Welcome section displays user name
- [x] Credit gauge shows correct percentage
- [x] Credit gauge colors update based on threshold
- [x] Active agents list shows top agents
- [x] Agent click navigates to detail page
- [x] System alerts calculate correctly
- [x] System alerts sort by severity
- [x] Recent activity bars show relative widths
- [x] Empty states display when no data
- [x] Dark mode works throughout
- [x] Responsive layout on mobile/tablet/desktop

### **Footer Plugin Refresh**
- [x] Expired plugins show split green/orange indicator
- [x] Tooltip shows "Click to refresh token" for expired plugins
- [x] Click on expired plugin triggers refresh
- [x] Loading spinner appears during refresh
- [x] Success checkmark appears on successful refresh
- [x] Failed refresh triggers OAuth reconnection modal
- [x] Plugin updates to green after successful refresh
- [x] Can refresh multiple plugins sequentially
- [x] Cannot click plugin during refresh (prevents double-refresh)
- [x] Animations smooth and performant
- [x] Dark mode works for all overlays

### **OAuth Reconnection Modal**
- [x] Modal appears centered when token refresh fails
- [x] Dark backdrop visible behind modal
- [x] Clicking backdrop closes modal (cancels)
- [x] Plugin icon shows pulsing orange overlay while modal open
- [x] Plugin name displayed in modal
- [x] Cancel button closes modal
- [x] Reconnect button starts OAuth flow
- [x] Modal closes when OAuth starts
- [x] Plugin shows loading state during OAuth
- [x] Success shows green checkmark, then auto-refreshes footer
- [x] OAuth failure shows error overlay on plugin icon
- [x] Modal animations smooth (fade-in)
- [x] Modal responsive on mobile/tablet/desktop
- [x] Dark mode works for modal

### **Plugin Disconnect Functionality**
- [x] Active plugins show "Click to disconnect" tooltip (red text)
- [x] Clicking active plugin triggers disconnect modal
- [x] Disconnect modal appears centered with red theme
- [x] Dark backdrop visible behind disconnect modal
- [x] Clicking backdrop closes modal (cancels)
- [x] Plugin icon shows pulsing red overlay while modal open
- [x] Plugin name displayed in modal
- [x] Warning message explains consequences
- [x] Cancel button closes modal
- [x] Disconnect button starts disconnect process
- [x] Modal closes when disconnect starts
- [x] Plugin shows red loading spinner during disconnect
- [x] "Disconnecting..." text shows during process
- [x] Success shows green checkmark for 2s
- [x] Plugin removed from footer after successful disconnect
- [x] Error shows red error icon with message
- [x] Modal animations smooth (fade-in)
- [x] Modal responsive on mobile/tablet/desktop
- [x] Dark mode works for disconnect modal
- [x] Cannot click plugins during disconnect operation
- [x] Expired plugins still route to refresh (not disconnect)

---

## Known Limitations

### **Current**
1. **No Real-time Updates**: Dashboard doesn't auto-refresh without page reload
2. **Limited Analytics**: Only shows execution counts, no time-series data
3. **Static Alerts**: Alerts calculated on page load, not updated live
4. **Single Plugin Refresh**: Can only refresh one plugin at a time
5. **OAuth Popup Dependency**: Requires popups enabled for OAuth reconnection

### **Future Enhancements**
1. **Real-time Subscriptions**: Auto-update when agents run or credits change
2. **Time-series Charts**: Show execution trends over time (day/week/month)
3. **Advanced Filters**: Filter agents by status, date range, etc.
4. **Batch Plugin Refresh**: "Refresh All Expired" button
5. **Export Data**: Download dashboard stats as CSV/PDF
6. **Custom Alerts**: User-configurable alert thresholds
7. **Agent Health Scores**: Aggregate success rate, avg execution time, etc.

---

## Related Documentation

- [Agent Creation V2](./CONVERSATIONAL_UI_NEW_V2_COMPLETE.md)
- [V2 Design System](../app/v2/globals-v2.css)
- [Plugin System](../lib/plugins/v2/core/UniversalPlugin.ts)
- [API Routes](../app/api/plugins/)

---

## Summary of Achievements

### ✅ Dashboard Core
- Comprehensive overview of user's agent ecosystem
- Real-time credit tracking with visual gauge
- Top agents with execution counts
- Prioritized system alerts

### ✅ Footer Plugin Management
- **Inline token refresh** (no modal interruption for refresh)
- **OAuth reconnection modal** for failed token refreshes (orange theme)
- **Plugin disconnect modal** for removing connections (red destructive theme)
- Visual feedback (loading/success/error states)
- Centered modals with dark backdrop (professional alert UI)
- Automatic footer refresh after successful OAuth
- Plugin removed from footer after successful disconnect
- Plugin icon visual indicators during all operations
- Intelligent click routing (expired → refresh, active → disconnect)
- Retry-friendly error handling
- V2 design system aligned

### ✅ Production-Ready
- Full responsive design
- Complete dark mode support
- TypeScript type safety
- Accessible and performant

---

**Document Version**: 1.2
**Last Updated**: 2025-01-19
**Author**: Development Team
**Status**: Dashboard Complete - Plugin Refresh, OAuth Reconnection & Disconnect Implemented - Ready for Production

**Page Location**: `/v2/dashboard` → [app/v2/dashboard/page.tsx](../app/v2/dashboard/page.tsx)
