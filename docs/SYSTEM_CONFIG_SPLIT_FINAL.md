# System Config Page Split - Final Plan

## Simplified Approach

Based on user feedback, the split is simpler than originally planned:

1. **Memory System page already exists with monitoring** → Just add a "Memory Config" button
2. **Create Memory Config page** → Configuration settings only (no monitoring)
3. **Move Pilot config to Orchestration** → Logical grouping with routing
4. **System Config becomes pricing-only** → With quick link cards

---

## Final Structure

### 1. System Config → Pricing & Billing Only
**Route:** `/admin/system-config`
**Icon:** DollarSign 💵
**Focus:** ALL pricing-related configuration

**Keep (All Pricing Cards):**
- ✅ **AI Model Pricing** - Model pricing management (input/output costs per token)
- ✅ **Calculator Configuration** - Cost calculation parameters and estimates
- ✅ **Billing Configuration** - Payment grace period, billing settings
- ✅ **Boost Packs Management** - Credit packs pricing and configuration

**Remove (Non-Pricing):**
- ❌ Memory Configuration → Move to new Memory Config page
- ❌ Pilot Configuration → Move to Orchestration Config
- ❌ Orchestration section → Add quick link card instead
- ❌ Old routing sections → Delete entirely

**Add:**
- ✅ Quick link cards at top (Orchestration, Memory Config, Memory Analytics)

**Final size:** ~1500-1800 lines
**Purpose:** Single source of truth for all pricing and billing configuration

---

### 2. Orchestration Config → Add Pilot Workflows
**Route:** `/admin/orchestration-config`
**Icon:** Brain 🧠

**Currently has:**
- Master controls
- Model tier configuration
- AIS routing thresholds
- Routing strategy weights

**Add:**
- ✅ Section 5: Pilot Workflow Configuration
  - Enabled toggle
  - Max steps / execution time / parallel steps
  - Retry configuration
  - Circuit breaker threshold
  - Checkpoint & retention settings
  - AgentKit token protection

**Rationale:** Pilot controls workflow execution, which is part of orchestration

---

### 3. Memory Config → Configuration Only (NEW)
**Route:** `/admin/memory-config` ✨ NEW
**Icon:** Database 🗄️

**Sections:**
1. Injection Configuration
2. Summarization Configuration
3. Embedding Configuration
4. Importance Scoring
5. Retention Policy

**NO monitoring dashboard** - that's in Memory System page

**API:** `/api/admin/memory-config` (GET/PUT)

---

### 4. Memory System → Add Config Button
**Route:** `/admin/learning-system` (existing)
**Icon:** BarChart3 📊

**Keep existing:**
- Memory monitoring dashboard
- ROI metrics
- Agent memory analysis
- Usage statistics

**Add:**
- ✅ "Memory Configuration" button/card at top
- Links to `/admin/memory-config`

---

## Admin Sidebar - Final Order

```typescript
const navigationItems = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Messages', href: '/admin/messages', icon: MessageSquare },
  { name: 'Queue Monitor', href: '/admin/queues', icon: Server },
  { name: 'Agent Analytics', href: '/admin/analytics', icon: TrendingUp },

  // Memory grouping
  {
    name: 'Memory System',
    href: '/admin/learning-system',
    icon: BarChart3,
    description: 'Monitoring & ROI'
  },
  {
    name: 'Memory Config',
    href: '/admin/memory-config',
    icon: Database,
    description: 'Memory Settings'
  },

  { name: 'User Management', href: '/admin/users', icon: Users },
  { name: 'System Flow', href: '/admin/system-flow', icon: Activity },

  // Configuration grouping
  {
    name: 'System Config',
    href: '/admin/system-config',
    icon: DollarSign,
    description: 'Pricing & Billing'
  },
  {
    name: 'Orchestration',
    href: '/admin/orchestration-config',
    icon: Brain,
    description: 'Routing & Workflows'
  },
  {
    name: 'AIS Config',
    href: '/admin/ais-config',
    icon: Settings,
    description: 'Intensity Settings'
  },

  { name: 'UI Config', href: '/admin/ui-config', icon: Palette },
  { name: 'Reward Config', href: '/admin/reward-config', icon: Gift },
  { name: 'Audit Trail', href: '/admin/audit-trail', icon: FileText },
];
```

---

## Implementation Steps

### Step 1: Create Memory Config Page ✨
**New file:** `app/admin/memory-config/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, Save, RefreshCw, AlertCircle, CheckCircle, BarChart3 } from 'lucide-react';

export default function MemoryConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [memoryConfig, setMemoryConfig] = useState({
    injection: {
      max_tokens: 4000,
      min_recent_runs: 2,
      max_recent_runs: 5,
      semantic_search_limit: 10,
      semantic_threshold: 0.7
    },
    summarization: {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 1000,
      async: true
    },
    embedding: {
      model: 'text-embedding-3-small',
      batch_size: 100,
      dimensions: 1536
    },
    importance: {
      base_score: 0.5,
      error_bonus: 0.3,
      pattern_bonus: 0.2,
      user_feedback_bonus: 0.4,
      first_run_bonus: 0.1,
      milestone_bonus: 0.15
    },
    retention: {
      run_memories_days: 90,
      low_importance_days: 30,
      consolidation_threshold: 100,
      consolidation_frequency_days: 7
    }
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/memory-config');
      const data = await response.json();
      if (data.success && data.config) {
        setMemoryConfig(data.config);
      }
    } catch (err) {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch('/api/admin/memory-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: memoryConfig })
      });

      if (!response.ok) throw new Error('Failed to save');

      setSuccess('✅ Memory configuration saved successfully!');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 p-8">
      {/* Header with link back to Memory System */}
      <div className="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          <p className="text-sm text-slate-300">
            View <a href="/admin/learning-system" className="text-blue-400 underline">Memory System Monitoring & ROI</a>
          </p>
        </div>
      </div>

      {/* Configuration sections */}
      {/* Section 1: Injection Configuration */}
      {/* Section 2: Summarization Configuration */}
      {/* Section 3: Embedding Configuration */}
      {/* Section 4: Importance Scoring */}
      {/* Section 5: Retention Policy */}
    </div>
  );
}
```

**New API:** `app/api/admin/memory-config/route.ts`

---

### Step 2: Add Config Button to Memory System
**Edit:** `app/admin/learning-system/page.tsx`

Add at the top (after header):
```tsx
{/* Memory Configuration Link */}
<div className="mb-6">
  <Link
    href="/admin/memory-config"
    className="inline-flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-blue-500/50 transition-all"
  >
    <Database className="w-5 h-5" />
    Memory Configuration
    <span className="text-xs opacity-75">Settings & Policies</span>
  </Link>
</div>
```

---

### Step 3: Add Pilot Config to Orchestration
**Edit:** `app/admin/orchestration-config/page.tsx`

Add new section after existing sections:
```tsx
{/* Section 5: Pilot Workflow Configuration */}
<motion.div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl">
  <button onClick={() => setPilotExpanded(!pilotExpanded)}>
    <Workflow className="w-6 h-6 text-orange-400" />
    <div>
      <h3>Pilot Workflow Configuration</h3>
      <p>Configure workflow execution engine settings</p>
    </div>
  </button>

  {pilotExpanded && (
    <div className="p-6">
      {/* All pilot settings from System Config */}
    </div>
  )}
</motion.div>
```

Update API to handle pilot settings.

---

### Step 4: Simplify System Config
**Edit:** `app/admin/system-config/page.tsx`

**Remove:**
- Memory Configuration section
- Pilot Configuration section
- Orchestration section (keep settings, remove UI)

**Add quick links at top:**
```tsx
{/* Quick Links */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
  <Link href="/admin/orchestration-config">
    <Brain />
    <h4>Orchestration & Workflows</h4>
    <p>Configure routing, pilot, and execution</p>
  </Link>

  <Link href="/admin/memory-config">
    <Database />
    <h4>Memory Configuration</h4>
    <p>Settings and policies</p>
  </Link>

  <Link href="/admin/learning-system">
    <BarChart3 />
    <h4>Memory System</h4>
    <p>Monitoring, ROI, and analytics</p>
  </Link>
</div>
```

---

### Step 5: Update Sidebar
**Edit:** `app/admin/components/AdminSidebar.tsx`

Update relevant items:
```typescript
{
  name: 'Memory System',
  href: '/admin/learning-system',
  icon: BarChart3,
  description: 'Monitoring & ROI'
},
{
  name: 'Memory Config',
  href: '/admin/memory-config',
  icon: Database,
  description: 'Memory Settings'
},
{
  name: 'System Config',
  href: '/admin/system-config',
  icon: DollarSign,
  description: 'Pricing & Billing'
},
{
  name: 'Orchestration',
  href: '/admin/orchestration-config',
  icon: Brain,
  description: 'Routing & Workflows'
},
```

---

## Summary

**Changes:**
1. ✨ NEW: Memory Config page (`/admin/memory-config`)
2. 🔄 UPDATE: Memory System - add config button
3. 🔄 UPDATE: Orchestration Config - add pilot section
4. 🔄 UPDATE: System Config - remove memory/pilot, add quick links
5. 🔄 UPDATE: Sidebar - update descriptions and add Memory Config

**Benefits:**
- Clearer separation: Monitoring vs Configuration
- Logical grouping: Pilot with Orchestration
- Focused pages: Each page has clear purpose
- Simpler navigation: Quick links connect related pages

**Files Created:** 1 (Memory Config page + API)
**Files Modified:** 4 (Memory System, Orchestration Config, System Config, Sidebar)
**Files Deleted:** 0

**Ready to implement!**
