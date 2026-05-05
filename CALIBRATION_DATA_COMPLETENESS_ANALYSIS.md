# Calibration Data Completeness Analysis

> **Created**: 2026-04-28
> **Question**: Are we collecting all relevant useful data for calibration history?

---

## Current Data Collection

### ✅ What We're Collecting

| Field | Purpose | Source |
|-------|---------|--------|
| `agent_id` | Link to agent | Parameter |
| `session_id` | Link to active session | Parameter |
| `user_id` | Ownership | Auth |
| `workflow_hash` | Change detection | `generateWorkflowHash()` |
| `workflow_step_count` | Complexity metric | `workflowSteps.length` |
| `status` | Outcome | success/failed/needs_review/verification_only |
| `iterations` | Auto-fix rounds | `loopIteration` |
| `auto_fixes_applied` | Fix count | `autoFixesApplied` |
| `issues_found` | All detected issues | `allIssuesForUI` |
| `issues_fixed` | Auto-repaired issues | `prioritized.autoRepairs` |
| `issues_remaining` | User action needed | `prioritized.critical + warnings` |
| `execution_time_ms` | Performance | `finalResult.executionTimeMs` |
| `steps_completed` | Success metric | `finalResult.stepsCompleted` |
| `steps_failed` | Failure metric | `finalResult.stepsFailed` |
| `steps_skipped` | Skip metric | `finalResult.stepsSkipped` |
| `metadata.validationMetadata` | Fix details | Layer 1/2 validation data |
| `created_at` | When started | NOW() |
| `completed_at` | When finished | NOW() |

### ❌ What We're NOT Collecting (But Should)

| Missing Field | Why Important | How to Collect |
|--------------|---------------|----------------|
| **v6_version** | Track V6 generation quality over time | env var or package.json |
| **model_used** | Correlate model with success rate | From provider factory |
| **input_schema_hash** | Detect input schema changes | Hash of agent.input_schema |
| **plugins_used** | Track plugin combination patterns | Extract from workflow_steps |
| **workflow_complexity_score** | Predict calibration difficulty | Calculate from step types |
| **first_execution_success** | Did it work on first try? | Boolean flag |
| **dry_run_predicted_success** | Was dry run accurate? | From DryRunValidator |

---

## Critical Missing Data for "Fast Path"

### Problem: How do we know calibration is 100% done?

**Current logic (lines 112-157 in batch/route.ts):**
```typescript
if (lastSuccessful && !workflowHasChanged) {
  // Run single verification execution
  if (verificationResult.success && verificationResult.stepsFailed === 0) {
    return { alreadyCalibrated: true, ... };
  } else {
    // Verification failed - run full calibration
  }
}
```

**The Issue:**
We're checking:
1. ✅ `lastSuccessful` exists (from calibration_history)
2. ✅ `!workflowHasChanged` (workflow_hash matches)
3. ✅ Verification execution succeeds

**But we're NOT tracking:**
- ❌ Were there **any issues remaining** in the last successful calibration?
- ❌ Did the last calibration require **user intervention**?
- ❌ Was the last calibration a **full success** or just "good enough"?

### Example Scenario (Current Bug)

**Calibration Run 1:**
- Status: `success`
- Issues found: 5
- Issues fixed: 3 (auto-repaired)
- Issues remaining: 2 (marked as "low priority warnings")
- User: "Good enough for now" → Marks as production_ready

**Calibration Run 2 (same workflow):**
- Fast path triggers: `lastSuccessful` exists, hash matches
- Runs verification → workflow still works
- Returns: "Already calibrated" ✅

**The Problem:**
- Those 2 remaining issues are still there!
- User might expect calibration to find them again
- But fast path skips issue detection

---

## Solution: Enhanced Data Collection

### 1. Track "Calibration Quality Score"

Add to `calibration_history`:

```sql
ALTER TABLE calibration_history
ADD COLUMN calibration_quality_score INTEGER CHECK (quality_score >= 0 AND quality_score <= 100);

COMMENT ON COLUMN calibration_history.calibration_quality_score IS
'Quality score: 100 = perfect (0 issues), 90 = excellent (auto-fixed all), 70 = good (minor warnings), <50 = needs review';
```

**Calculation:**
```typescript
function calculateQualityScore(calibration: {
  status: string;
  issues_found: any[];
  issues_fixed: any[];
  issues_remaining: any[];
  steps_failed: number;
}): number {
  // Perfect calibration
  if (calibration.status === 'success' &&
      calibration.issues_found.length === 0 &&
      calibration.steps_failed === 0) {
    return 100;
  }

  // Excellent - all issues auto-fixed
  if (calibration.status === 'success' &&
      calibration.issues_remaining.length === 0) {
    return 95;
  }

  // Good - only minor warnings remain
  const criticalRemaining = calibration.issues_remaining.filter(i => i.severity === 'high').length;
  if (calibration.status === 'success' && criticalRemaining === 0) {
    return 75;
  }

  // Needs review - critical issues remain
  if (calibration.status === 'needs_review') {
    return 40;
  }

  // Failed
  return 0;
}
```

### 2. Track "First Execution Success"

Did the workflow work on the very first try, before any auto-fixes?

```sql
ALTER TABLE calibration_history
ADD COLUMN first_execution_success BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN calibration_history.first_execution_success IS
'True if workflow succeeded on first execution before any auto-fixes were applied';
```

**Benefits:**
- V6 quality metric: "90% of workflows work on first try"
- Correlate with model_used: "GPT-4o has 95% first-try success vs Sonnet 85%"

### 3. Track "Dry Run Accuracy"

Was the dry run prediction accurate?

```sql
ALTER TABLE calibration_history
ADD COLUMN dry_run_predicted_success BOOLEAN,
ADD COLUMN dry_run_was_accurate BOOLEAN;

COMMENT ON COLUMN calibration_history.dry_run_predicted_success IS
'What DryRunValidator predicted before execution';

COMMENT ON COLUMN calibration_history.dry_run_was_accurate IS
'True if dry run prediction matched actual result';
```

**Benefits:**
- Monitor DryRunValidator accuracy
- Improve dry run logic based on false positives/negatives

### 4. Track Input Schema Hash

Detect when input schema changes (affects workflow validity):

```sql
ALTER TABLE calibration_history
ADD COLUMN input_schema_hash TEXT;

COMMENT ON COLUMN calibration_history.input_schema_hash IS
'SHA-256 hash of agent.input_schema at calibration time';
```

**Why important:**
- User changes input schema → workflow might need recalibration
- Example: Removes required field → hardcoded values become invalid

### 5. Track Plugins Used

Which plugin combinations are most problematic?

```sql
ALTER TABLE calibration_history
ADD COLUMN plugins_used JSONB NOT NULL DEFAULT '[]';

CREATE INDEX idx_calibration_history_plugins_used
ON calibration_history USING GIN(plugins_used);

COMMENT ON COLUMN calibration_history.plugins_used IS
'Array of plugin names used in workflow, e.g., ["gmail", "google-sheets", "google-drive"]';
```

**Benefits:**
- Analytics: "Gmail + Sheets workflows have 30% higher failure rate"
- Product: Focus improvements on problematic plugin combos

### 6. Track Workflow Complexity Score

Predict calibration difficulty:

```sql
ALTER TABLE calibration_history
ADD COLUMN workflow_complexity_score INTEGER;

COMMENT ON COLUMN calibration_history.workflow_complexity_score IS
'Complexity: 1-10 based on step count, nesting, conditional logic, transforms, etc.';
```

**Calculation:**
```typescript
function calculateComplexityScore(steps: any[]): number {
  let score = 0;

  // Base: step count
  score += Math.min(steps.length * 0.5, 3); // Max 3 points

  // Nested steps (parallel, conditional)
  const nestedSteps = steps.filter(s => s.type === 'parallel' || s.branches);
  score += nestedSteps.length * 1.5; // 1.5 points each

  // Transforms
  const transforms = steps.filter(s => s.type === 'transform');
  score += transforms.length * 1; // 1 point each

  // LLM decisions
  const llmSteps = steps.filter(s => s.type === 'llm_decision');
  score += llmSteps.length * 1.5; // 1.5 points each

  return Math.min(Math.round(score), 10); // Cap at 10
}
```

**Benefits:**
- Warn users: "High complexity workflows may require multiple calibration rounds"
- Analytics: Correlate complexity with failure rate

---

## Enhanced Fast Path Logic

### Current (Lines 112-157)
```typescript
if (lastSuccessful && !workflowHasChanged) {
  // Run verification
  if (verificationResult.success) {
    return { alreadyCalibrated: true };
  }
}
```

### Enhanced
```typescript
if (lastSuccessful && !workflowHasChanged && !inputSchemaChanged) {
  // Check calibration quality
  if (lastSuccessful.calibration_quality_score === 100) {
    // Perfect calibration - skip verification, just acknowledge
    return {
      success: true,
      alreadyCalibrated: true,
      message: 'Workflow is perfectly calibrated (0 issues). No verification needed.',
      fastPath: 'perfect',
      lastCalibration: {
        quality_score: 100,
        calibratedAt: lastSuccessful.created_at,
        iterations: lastSuccessful.iterations
      }
    };
  }

  if (lastSuccessful.calibration_quality_score >= 95) {
    // Excellent calibration - quick verification only
    const verificationResult = await pilot.executeWorkflow({ ... });

    if (verificationResult.success && verificationResult.stepsFailed === 0) {
      return {
        success: true,
        alreadyCalibrated: true,
        message: 'Workflow verified successfully. No issues found.',
        fastPath: 'verification_only',
        verification: { ... }
      };
    }
  }

  if (lastSuccessful.calibration_quality_score >= 70) {
    // Good calibration but had minor warnings
    // Ask user if they want quick verification or full calibration
    return {
      success: true,
      alreadyCalibrated: true,
      message: 'Previous calibration had minor warnings. Run full calibration?',
      fastPath: 'partial',
      lastCalibration: {
        quality_score: lastSuccessful.calibration_quality_score,
        issues_remaining: lastSuccessful.issues_remaining,
        warningCount: lastSuccessful.issues_remaining.length
      },
      recommendation: 'quick_verification'
    };
  }

  // Quality < 70 - always run full calibration
}
```

---

## Updated Schema Recommendations

```sql
-- Add new columns to calibration_history
ALTER TABLE calibration_history
ADD COLUMN calibration_quality_score INTEGER CHECK (calibration_quality_score >= 0 AND calibration_quality_score <= 100),
ADD COLUMN first_execution_success BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN dry_run_predicted_success BOOLEAN,
ADD COLUMN dry_run_was_accurate BOOLEAN,
ADD COLUMN input_schema_hash TEXT,
ADD COLUMN plugins_used JSONB NOT NULL DEFAULT '[]',
ADD COLUMN workflow_complexity_score INTEGER CHECK (workflow_complexity_score >= 1 AND workflow_complexity_score <= 10);

-- Add indexes
CREATE INDEX idx_calibration_history_quality_score
ON calibration_history(calibration_quality_score, status);

CREATE INDEX idx_calibration_history_plugins_used
ON calibration_history USING GIN(plugins_used);

-- Add comments
COMMENT ON COLUMN calibration_history.calibration_quality_score IS
'Quality: 100=perfect (0 issues), 95=excellent (all auto-fixed), 75=good (minor warnings), 40=needs review, 0=failed';

COMMENT ON COLUMN calibration_history.first_execution_success IS
'True if workflow succeeded on first execution before any auto-fixes';

COMMENT ON COLUMN calibration_history.dry_run_predicted_success IS
'DryRunValidator prediction before actual execution';

COMMENT ON COLUMN calibration_history.dry_run_was_accurate IS
'True if dry run prediction matched actual execution result';

COMMENT ON COLUMN calibration_history.input_schema_hash IS
'SHA-256 hash of agent.input_schema - detects input changes that invalidate workflow';

COMMENT ON COLUMN calibration_history.plugins_used IS
'Array of plugin names used: ["gmail", "google-sheets"] - for failure pattern analysis';

COMMENT ON COLUMN calibration_history.workflow_complexity_score IS
'Complexity 1-10: step count + nesting + transforms + LLM decisions';
```

---

## Analytics Queries Enabled

### 1. V6 Quality Over Time
```sql
SELECT
  DATE_TRUNC('week', created_at) as week,
  AVG(calibration_quality_score) as avg_quality,
  SUM(CASE WHEN calibration_quality_score = 100 THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as perfect_rate,
  SUM(CASE WHEN first_execution_success THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as first_try_success_rate
FROM calibration_history
WHERE v6_version IS NOT NULL
GROUP BY week
ORDER BY week DESC;
```

### 2. Model Performance Comparison
```sql
SELECT
  model_used,
  COUNT(*) as calibrations,
  AVG(calibration_quality_score) as avg_quality,
  AVG(iterations) as avg_iterations,
  SUM(CASE WHEN first_execution_success THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as first_try_rate
FROM calibration_history
WHERE model_used IS NOT NULL
GROUP BY model_used
ORDER BY avg_quality DESC;
```

### 3. Problematic Plugin Combinations
```sql
SELECT
  plugins_used,
  COUNT(*) as usage_count,
  AVG(calibration_quality_score) as avg_quality,
  AVG(iterations) as avg_iterations,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures
FROM calibration_history
WHERE jsonb_array_length(plugins_used) >= 2
GROUP BY plugins_used
HAVING COUNT(*) >= 10
ORDER BY avg_quality ASC
LIMIT 20;
```

### 4. Complexity vs Success Rate
```sql
SELECT
  workflow_complexity_score,
  COUNT(*) as calibrations,
  AVG(calibration_quality_score) as avg_quality,
  AVG(iterations) as avg_iterations,
  SUM(CASE WHEN calibration_quality_score = 100 THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as perfect_rate
FROM calibration_history
GROUP BY workflow_complexity_score
ORDER BY workflow_complexity_score;
```

### 5. Dry Run Accuracy
```sql
SELECT
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as total,
  SUM(CASE WHEN dry_run_was_accurate THEN 1 ELSE 0 END) as accurate,
  SUM(CASE WHEN dry_run_was_accurate THEN 1 ELSE 0 END)::FLOAT / COUNT(*) as accuracy_rate
FROM calibration_history
WHERE dry_run_predicted_success IS NOT NULL
GROUP BY date
ORDER BY date DESC;
```

---

## Implementation Priority

### High Priority (Do Now)
1. ✅ **v6_version** - Critical for tracking generation improvements
2. ✅ **model_used** - Essential for model comparison
3. ✅ **calibration_quality_score** - Needed for enhanced fast path
4. ✅ **input_schema_hash** - Prevent false fast path matches

### Medium Priority (Next Sprint)
5. ⬜ **first_execution_success** - Good V6 metric but not critical
6. ⬜ **plugins_used** - Useful for pattern analysis
7. ⬜ **workflow_complexity_score** - Nice UX feature

### Low Priority (Future)
8. ⬜ **dry_run_predicted_success** - Only useful if we monitor dry run accuracy
9. ⬜ **dry_run_was_accurate** - Depends on #8

---

## Summary

### ❌ Current Gap
We're not collecting enough data to safely use the fast path. Specifically:
- Can't distinguish "perfect calibration" from "good enough calibration"
- Can't detect input schema changes
- Can't track V6 quality improvements
- Can't identify problematic plugin combinations

### ✅ Proposed Solution
Add 7 new fields to `calibration_history`:
1. `calibration_quality_score` (0-100)
2. `v6_version`
3. `model_used`
4. `input_schema_hash`
5. `first_execution_success`
6. `plugins_used`
7. `workflow_complexity_score`

### 🎯 Impact
- **Fast path becomes safe**: Only triggers for quality_score = 100
- **V6 quality tracking**: Monitor generation improvements over time
- **Model comparison**: Data-driven model selection
- **Pattern detection**: Identify problematic workflows before users hit them
- **Better UX**: "High complexity workflow - expect 2-3 calibration rounds"
