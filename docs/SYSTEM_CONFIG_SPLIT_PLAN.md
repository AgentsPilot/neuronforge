# System Config Page Split Plan

## Current Problem

The System Config page (`app/admin/system-config/page.tsx`) is **4157 lines** and contains:
- Pricing models ✅ (belongs here)
- Calculator configuration ✅ (belongs here)
- Memory configuration ❌ (should be separate)
- Pilot workflow configuration ❌ (should move to Orchestration)
- Billing configuration ✅ (belongs here)
- Boost packs ✅ (belongs here)
- Obsolete routing sections ❌ (to be deleted)

**Goal:** Split into focused, manageable pages based on logical grouping.

---

## Proposed Split

### 1. System Config (Pricing & Billing Only)
**Keep:** `/admin/system-config`

**Sections to Keep:**
- ✅ Pricing Models Management
- ✅ Calculator Configuration
- ✅ Billing Configuration
- ✅ Boost Packs Management

**Sections to Remove:**
- ❌ Memory Configuration → Move to new Memory Config page
- ❌ Pilot Configuration → Move to Orchestration Config page
- ❌ Orchestration Configuration → Already has dedicated page
- ❌ Old routing sections → Delete entirely

**Final Size:** ~1500-1800 lines (down from 4157)

---

### 2. Orchestration Config (Add Pilot Workflow Settings)
**Existing:** `/admin/orchestration-config`

**Currently Has:**
- Master controls (enable/disable)
- Model tier configuration
- AIS routing thresholds
- Routing strategy weights

**Add from System Config:**
- ✅ Pilot Workflow Configuration
  - Enabled toggle
  - Max steps
  - Max execution time
  - Max parallel steps
  - Retry configuration
  - Circuit breaker threshold
  - Checkpoint settings
  - Retention days
  - AgentKit token protection settings

**Rationale:** Pilot workflow settings control how agents execute, which is part of orchestration.

---

### 3. Memory Config (New Page with Monitoring)
**New:** `/admin/memory-config`

**Sections:**

#### A. Memory Monitoring Dashboard (Top)
- Memory usage statistics
- Recent memory operations
- Memory ROI metrics
- Agent memory summary
- Link to full Memory System page

#### B. Memory Configuration (Below)
**From System Config:**
- Injection Configuration
  - Max tokens
  - Min/max recent runs
  - Semantic search limit
  - Semantic threshold
- Summarization Configuration
  - Model
  - Temperature
  - Max tokens
  - Async mode
- Embedding Configuration
  - Model
  - Batch size
  - Dimensions
- Importance Scoring
  - Base score
  - Error bonus
  - Pattern bonus
  - User feedback bonus
  - First run bonus
  - Milestone bonus
- Retention Policy
  - Run memories retention days
  - Low importance retention days
  - Consolidation threshold
  - Consolidation frequency

**Rationale:** Memory is a complex subsystem that deserves its own dedicated admin page.

---

## Implementation Steps

### Step 1: Enhance Orchestration Config Page
**File:** `app/admin/orchestration-config/page.tsx`

**Add new section (Section 8):**
```typescript
{/* Section 8: Pilot Workflow Configuration */}
<motion.div className="bg-slate-900/50...">
  <button onClick={() => setPilotExpanded(!pilotExpanded)}>
    <Workflow className="w-6 h-6 text-orange-400" />
    <div>
      <h3>Pilot Workflow Configuration</h3>
      <p>Configure workflow execution engine settings</p>
    </div>
  </button>

  {pilotExpanded && (
    <div className="p-6...">
      {/* All pilot configuration fields */}
      {/* - Enabled toggle */}
      {/* - Max steps, execution time, parallel steps */}
      {/* - Retry settings */}
      {/* - Circuit breaker */}
      {/* - Checkpoint & retention */}
      {/* - AgentKit token protection */}
    </div>
  )}
</motion.div>
```

**Update API endpoint** `app/api/admin/orchestration-config/route.ts`:
- Add pilot settings to GET response
- Add pilot settings to PUT handler

---

### Step 2: Create Memory Config Page
**New File:** `app/admin/memory-config/page.tsx`

**Structure:**
```typescript
export default function MemoryConfigPage() {
  // State for memory configuration
  const [memoryConfig, setMemoryConfig] = useState({...});
  const [monitoring, setMonitoring] = useState({...});

  return (
    <div>
      {/* Header */}

      {/* Section 1: Memory Monitoring Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Total Memories" value={monitoring.totalMemories} />
        <StatCard title="Active Agents" value={monitoring.activeAgents} />
        <StatCard title="Avg ROI" value={monitoring.avgROI} />
      </div>

      <div className="bg-blue-500/10...">
        <p>View detailed memory analytics and agent memory in the{' '}
          <Link href="/admin/learning-system">Memory System</Link> page
        </p>
      </div>

      {/* Section 2: Injection Configuration */}
      {/* Section 3: Summarization Configuration */}
      {/* Section 4: Embedding Configuration */}
      {/* Section 5: Importance Scoring */}
      {/* Section 6: Retention Policy */}
    </div>
  );
}
```

**New API endpoint:** `app/api/admin/memory-config/route.ts`
- GET: Fetch memory config + monitoring stats
- PUT: Update memory configuration

---

### Step 3: Simplify System Config Page
**File:** `app/admin/system-config/page.tsx`

**Remove these sections:**
1. Memory Configuration (entire section ~500 lines)
2. Pilot Configuration (entire section ~400 lines)
3. Orchestration Configuration (add pointer to dedicated page)
4. Old routing sections (to be deleted anyway)

**Add pointers:**
```tsx
{/* Quick Links */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
  <Link href="/admin/orchestration-config" className="p-4 bg-blue-500/10...">
    <Brain className="w-8 h-8 text-blue-400 mb-2" />
    <h4 className="font-medium text-white">Orchestration & Pilot</h4>
    <p className="text-sm text-slate-400">Configure routing and workflow execution</p>
  </Link>

  <Link href="/admin/memory-config" className="p-4 bg-purple-500/10...">
    <Database className="w-8 h-8 text-purple-400 mb-2" />
    <h4 className="font-medium text-white">Memory System</h4>
    <p className="text-sm text-slate-400">Configure memory and view monitoring</p>
  </Link>

  <Link href="/admin/learning-system" className="p-4 bg-green-500/10...">
    <BarChart3 className="w-8 h-8 text-green-400 mb-2" />
    <h4 className="font-medium text-white">Memory Analytics</h4>
    <p className="text-sm text-slate-400">View detailed memory ROI and insights</p>
  </Link>
</div>
```

---

### Step 4: Update Admin Sidebar
**File:** `app/admin/components/AdminSidebar.tsx`

**Current:**
```typescript
{
  name: 'Memory System',
  href: '/admin/learning-system',
  icon: Brain,
  description: 'Agent Memory & ROI'
},
{
  name: 'System Config',
  href: '/admin/system-config',
  icon: Sliders,
  description: 'Pricing & System Settings'
},
{
  name: 'Orchestration',
  href: '/admin/orchestration-config',
  icon: Brain,
  description: 'Unified Routing & AIS'
},
```

**New:**
```typescript
{
  name: 'System Config',
  href: '/admin/system-config',
  icon: DollarSign,  // Changed to emphasize pricing
  description: 'Pricing & Billing'
},
{
  name: 'Orchestration',
  href: '/admin/orchestration-config',
  icon: Brain,
  description: 'Routing & Workflows'  // Updated description
},
{
  name: 'Memory Config',
  href: '/admin/memory-config',
  icon: Database,  // Changed icon
  description: 'Memory Settings & Monitoring'
},
{
  name: 'Memory Analytics',
  href: '/admin/learning-system',
  icon: BarChart3,  // Changed icon
  description: 'Memory ROI & Insights'
},
```

---

## File Structure After Split

```
app/admin/
├── system-config/
│   └── page.tsx  (~1500-1800 lines, pricing only)
├── orchestration-config/
│   └── page.tsx  (existing + pilot config)
├── memory-config/
│   └── page.tsx  (NEW - memory settings + monitoring)
└── learning-system/
    └── page.tsx  (existing - detailed analytics)

app/api/admin/
├── system-config/
│   └── route.ts  (pricing, calculator, billing, boosts)
├── orchestration-config/
│   └── route.ts  (routing + pilot config)
└── memory-config/
    └── route.ts  (NEW - memory config + monitoring)
```

---

## Benefits

### 1. Focused Pages
- **System Config:** Pricing and billing only (~1500 lines)
- **Orchestration Config:** All execution control (routing + pilot workflows)
- **Memory Config:** All memory settings + quick monitoring
- **Memory Analytics:** Detailed ROI analysis (existing page)

### 2. Logical Grouping
- Financial settings in one place
- Execution control in one place
- Memory management in one place
- Analytics separate from configuration

### 3. Better UX
- Easier to find settings
- Less scrolling
- Clear navigation
- Related settings grouped together

### 4. Maintainability
- Smaller files, easier to modify
- Clear separation of concerns
- Less risk of merge conflicts
- Easier testing

---

## Migration Path

### Phase 1: Create Memory Config Page
1. Create new page with monitoring dashboard
2. Copy memory configuration from System Config
3. Create new API endpoint
4. Test thoroughly

### Phase 2: Enhance Orchestration Config
1. Add Pilot Workflow section
2. Update API to handle pilot settings
3. Test orchestration + pilot together

### Phase 3: Simplify System Config
1. Remove memory configuration (point to new page)
2. Remove pilot configuration (point to orchestration)
3. Add quick links section
4. Clean up obsolete routing sections
5. Test pricing/billing/calculator/boosts still work

### Phase 4: Update Sidebar
1. Update menu items
2. Update descriptions
3. Update icons for clarity
4. Test navigation

---

## Testing Checklist

### System Config (After Split)
- [ ] Pricing models CRUD works
- [ ] Calculator config saves
- [ ] Billing config saves
- [ ] Boost packs CRUD works
- [ ] Quick links navigate correctly
- [ ] Page loads without errors

### Orchestration Config (After Enhancement)
- [ ] Existing sections still work
- [ ] New Pilot section loads
- [ ] Pilot settings save correctly
- [ ] All pilot fields present
- [ ] No conflicts with routing settings

### Memory Config (New Page)
- [ ] Page loads without errors
- [ ] Monitoring dashboard shows stats
- [ ] All memory settings present
- [ ] Settings save correctly
- [ ] Link to Memory Analytics works

### Navigation
- [ ] Sidebar shows all new items
- [ ] All links work
- [ ] Icons appropriate
- [ ] Descriptions clear
- [ ] Active indicator works

---

## Rollback Plan

If issues arise:

```bash
# Restore original System Config
cp app/admin/system-config/page.tsx.backup app/admin/system-config/page.tsx

# Remove new Memory Config page
rm -rf app/admin/memory-config

# Restore Orchestration Config
git checkout app/admin/orchestration-config/page.tsx

# Restore Sidebar
git checkout app/admin/components/AdminSidebar.tsx
```

---

## Summary

**Before Split:**
- System Config: 4157 lines (everything)
- Orchestration Config: Routing only
- Memory System: Analytics only

**After Split:**
- System Config: ~1500 lines (pricing/billing focus)
- Orchestration Config: ~2000 lines (routing + pilot workflows)
- Memory Config: ~800 lines (NEW - settings + monitoring)
- Memory Analytics: Existing (detailed ROI)

**Total Code:** Similar, but better organized
**Files:** +1 new page (Memory Config)
**Complexity:** Reduced per page
**Maintainability:** Significantly improved
**User Experience:** Much clearer navigation
