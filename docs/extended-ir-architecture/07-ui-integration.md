# UI Integration Guide

## Minimal Changes Required

**1 New Component + 1 Modified Component = Complete Integration**

## Current UI Flow (V4)

```
ConversationalAgentBuilderV2
   ↓
EnhancedPromptReview (user approves)
   ↓
SmartAgentBuilder
   ↓
AgentPreview
   ↓
Create Agent
```

## New UI Flow (Extended IR)

```
ConversationalAgentBuilderV2 (NO CHANGE)
   ↓
EnhancedPromptReview (NO CHANGE)
   ↓
[NEW] WorkflowPlanPreview ← ONLY NEW COMPONENT
   ↓
SmartAgentBuilder (NO CHANGE)
   ↓
AgentPreview (NO CHANGE)
   ↓
Create Agent
```

## New Component: WorkflowPlanPreview.tsx

**Location:** `/components/agent-creation/WorkflowPlanPreview.tsx`

**Purpose:** Show natural language workflow plan with approval/edit options

**Props:**
```typescript
interface WorkflowPlanPreviewProps {
  plan: NaturalLanguagePlan
  onApprove: () => void
  onEdit: (correction: string) => Promise<void>
  loading?: boolean
}
```

**Full Implementation:** See [Code Examples](./10-code-examples.md#workflowplanpreview)

## Modified Component: AgentBuilderParent.tsx

**Location:** `/components/agent-creation/AgentBuilderParent.tsx`

**Changes:**

```typescript
// ADD: New state
const [workflowPlan, setWorkflowPlan] = useState<NaturalLanguagePlan | null>(null)
const [showPlanPreview, setShowPlanPreview] = useState(false)

// MODIFY: Enhanced prompt approval handler
const handleEnhancedPromptApproval = async () => {
  if (useExtendedIRArchitecture()) {
    // NEW: Generate IR + translate to English
    const response = await fetch('/api/generate-workflow-plan', {
      method: 'POST',
      body: JSON.stringify({ enhancedPrompt })
    })
    
    const { plan } = await response.json()
    setWorkflowPlan(plan)
    setShowPlanPreview(true)
  } else {
    // EXISTING: V4 path
    setPhase('smart-builder')
  }
}

// ADD: Plan approval handler
const handlePlanApproval = async () => {
  setShowPlanPreview(false)
  
  // Compile IR to PILOT_DSL
  const response = await fetch('/api/compile-workflow', {
    method: 'POST',
    body: JSON.stringify({ logicalIR: workflowPlan.ir })
  })
  
  const { workflow } = await response.json()
  
  // Continue to SmartAgentBuilder
  setPhase('smart-builder')
  setCompiledWorkflow(workflow)
}

// ADD: Correction handler
const handlePlanCorrection = async (correction: string) => {
  const response = await fetch('/api/update-workflow-plan', {
    method: 'POST',
    body: JSON.stringify({
      logicalIR: workflowPlan.ir,
      correction
    })
  })
  
  const { updatedPlan } = await response.json()
  setWorkflowPlan(updatedPlan)
}

// MODIFY: Render
return (
  <>
    {phase === 'conversational' && (
      <ConversationalAgentBuilderV2
        onComplete={handleEnhancedPromptApproval}
      />
    )}
    
    {/* NEW: Plan preview phase */}
    {showPlanPreview && workflowPlan && (
      <WorkflowPlanPreview
        plan={workflowPlan}
        onApprove={handlePlanApproval}
        onEdit={handlePlanCorrection}
      />
    )}
    
    {phase === 'smart-builder' && (
      <SmartAgentBuilder
        initialWorkflow={compiledWorkflow}
        // ... other props
      />
    )}
  </>
)
```

## Feature Flag Integration

**Location:** `/lib/feature-flags.ts`

```typescript
export function useExtendedIRArchitecture(): boolean {
  const user = useUser()
  
  // Phase 1: Dev only
  if (process.env.NODE_ENV === 'development') {
    return process.env.NEXT_PUBLIC_USE_IR_ARCHITECTURE === 'true'
  }
  
  // Phase 2: Beta users
  if (user?.betaTester) return true
  
  // Phase 3: Gradual rollout
  const rolloutPercent = parseInt(process.env.NEXT_PUBLIC_IR_ROLLOUT_PERCENT || '0')
  if (rolloutPercent > 0) {
    // Consistent hashing by user ID
    const hash = hashCode(user?.id || '')
    return (hash % 100) < rolloutPercent
  }
  
  return false
}
```

## No Changes Required For

✅ **ConversationalAgentBuilderV2** - Chat interface unchanged
✅ **EnhancedPromptReview** - Enhanced prompt review unchanged  
✅ **SmartAgentBuilder** - Technical builder unchanged
✅ **AgentPreview** - Workflow preview unchanged
✅ **All execution UI** - No changes

## Integration Timeline

**Week 4-5:**
- Implement WorkflowPlanPreview component
- Modify AgentBuilderParent
- Add feature flag
- Test with sample workflows

**Week 6:**
- Add real-time execution progress
- Integrate with existing ExecutionProgressUI

---

Next: [API Specifications](./08-api-specifications.md)
