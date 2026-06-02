# Shadow Agent + Business Insight System - Complete Architecture

**Document Version:** 1.1
**Created:** 2026-01-06
**Updated:** 2026-01-18
**Status:** Design Complete - Ready for Implementation

---

## 🎯 CORE DESIGN PRINCIPLES

1. **Shadow Agent** = Execution health monitor that **holds, fixes, resumes** from failure point
2. **Data Issues** = Separate tracking (empty results, malformed data, missing fields)
3. **Business Insights** = Two types:
   - **Data Quality Insights** - Help users fix data problems
   - **Growth Insights** - Help users improve business operations
4. **No full reruns** - Resume from checkpoint, not step 1
5. **User decides** - Alert patterns: Stop workflow? Continue with fallback? Auto-retry?
6. **Pre-Execution Intent Validation** = Catch intent mismatches BEFORE first run

---

## 🆕 SYSTEM 0: PRE-EXECUTION INTENT VALIDATOR

### Purpose

Catch workflow issues **before execution** by validating that the compiled workflow matches the user's original intent. This prevents "workflow ran but did the wrong thing" failures.

### The Problem It Solves

Workflows can be created successfully but fail to deliver business value because:
- User answers clarification questions ambiguously
- LLM misinterprets user intent during generation
- Assumptions are made silently without user awareness
- No validation that compiled workflow matches original intent

**Key Insight:** The workflow runs fine technically, but doesn't do what the user actually wanted.

### When It Runs

**After grounding (Phase 2)**, as a single unified step that combines clarifications + confirmations:

```
[Describe] → [Connect] → [Ground & Validate] → [Review & Confirm] → ✓ Created
                                                      ↑
                                               SINGLE UI
                                    (clarifications + assumptions + edge cases)
```

**Why after grounding, not after semantic (Phase 1)?**

| Show After Phase 1 | Show After Phase 2 (Grounding) |
|--------------------|-------------------------------|
| Questions are generic | Questions enriched with real data |
| "Which sheet?" | "Found 3 sheets: Sales, Q1, Old - which one?" |
| Assumptions not validated | Fake validations exposed |
| Two UI interruptions | One unified UI |
| User answers twice | User answers once |

### User-Facing Output: Single Unified UI

All clarifications, assumptions, and edge cases in ONE screen:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  📋 Review & Customize Your Agent                                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  YOUR REQUEST:                                                             │
│  "Send each salesperson their Stage 4 leads daily"                         │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ❓ QUESTIONS                                                              │
│  (from clarifications_needed[], enriched by grounding)                     │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  Which Google Sheet?                                                       │
│  [Sales Pipeline 2026 ▼]  ← Grounding found 3 matching sheets             │
│                                                                            │
│  Email subject line?                                                       │
│  [Your Stage 4 Leads for Today_______________]                             │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ⚠️ PLEASE CONFIRM                                                         │
│  (from 5-layer detection: patterns, fake validations, risks)              │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ How should leads be sent?                                             │ │
│  │                                                                       │ │
│  │  ○ ONE email to ALL salespeople                                       │ │
│  │    Everyone sees everyone's leads                                     │ │
│  │                                                                       │ │
│  │  ● ONE email PER salesperson ⭐                                        │ │
│  │    Each person sees only their leads                                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ✓ ASSUMPTIONS                                                  [Expand] │
│  (from assumptions[], validated by grounding)                              │
│────────────────────────────────────────────────────────────────────────────│
│  3 validated • Click to review                                            │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ❓ EDGE CASES                                                             │
│  (from edge_cases[])                                                       │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  No Stage 4 leads found:     [Skip email entirely ▼]                       │
│  Salesperson has no email:   [Send their leads to me ▼]                    │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                    [Create Agent]          │
└────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Single UI** - All decisions in one place (no two-stage flow)
2. **Grounding-Enriched Questions** - Real data options, not generic questions
3. **Plain Language** - No technical terms (no "IR", "plugin", "action")
4. **Show Assumptions** - Surface what the system assumed
5. **Highlight Edge Cases** - What might not work as expected
6. **Inline Editing** - Click to modify without full regeneration
7. **Always Show on First Run** - Builds user trust

### Data Sources for Each UI Section

| UI Section | Source | When Available |
|------------|--------|----------------|
| **Questions** | `clarifications_needed[]` | Phase 1, enriched by Phase 2 |
| **Please Confirm** | 5-layer detection results | After Phase 2 |
| **Assumptions** | `assumptions[]` + grounding validation | After Phase 2 |
| **Edge Cases** | `edge_cases[]` | Phase 1 + Phase 2 |

### Inline Editing Flow

When user clicks "Make Changes":

```
┌────────────────────────────────────────────────────────┐
│ 1. 📥 Fetch tickets from Zendesk                       │
│    ┌──────────────────────────────────────────────┐   │
│    │ → All tickets from [last 24 hours ▼]         │   │
│    │ → Filtered by: [Priority = High/Urgent ✏️]   │   │
│    └──────────────────────────────────────────────┘   │
│    [+ Add condition]                                   │
│                                                        │
│ ⚠️ ASSUMPTIONS (click to change):                      │
│    [✓] "Urgent" = Priority field is High or Urgent    │
│    [✓] Include tickets assigned to anyone             │
│    [ ] Skip email if no tickets found                  │
└────────────────────────────────────────────────────────┘
```

**Edit → IR Patch Flow:**
```
User edits inline → System captures as "intent correction"
  → Re-run IR formalization with correction hint
  → Update workflow without full regeneration
  → Show updated summary for confirmation
```

### Two-Layer Validation

**Layer 1: Deterministic Checks (No LLM)**
- All filter fields exist in data source
- Plugin + operation_type combinations are valid
- Required config params present
- Email recipient fields resolve to valid emails

**Layer 2: Semantic Intent Check (LLM)**
- Does this workflow accomplish the user's stated goal?
- Are there missing business requirements?
- What edge cases might fail?

### Post-Grounding Ambiguity Detection (Critical)

**Why Post-Grounding Validation is the Key:**

| Stage | What's Available | Limitation |
|-------|------------------|------------|
| Before Grounding | Only LLM's interpretation | Can be overconfident, no real validation |
| **After Grounding** | Actual validation results, confidence scores, evidence | **Exposes fake validations** |

Grounding reveals when the LLM claims "high confidence" but the evidence shows "Behavior validation not implemented, assuming valid" with confidence 0.7.

**The 5-Layer Ambiguity Detection Framework:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    AMBIGUITY DETECTION LAYERS                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: CONFIDENCE MISMATCH                                   │
│  ├─ LLM says "high" but grounding score < 0.8 → flag            │
│  ├─ LLM says "high" but alternatives exist → flag               │
│  └─ Behavior assumption with "not implemented" evidence → flag  │
│                                                                 │
│  Layer 2: SEMANTIC PATTERN DETECTION                            │
│  ├─ Loop intent (grouping + single delivery)                    │
│  ├─ Data visibility (dynamic recipients + shared data)          │
│  ├─ Ownership patterns (assigned_to + broadcast output)         │
│  └─ Time ambiguity ("recent" without definition)                │
│                                                                 │
│  Layer 3: CROSS-ASSUMPTION CONFLICTS                            │
│  ├─ Assumption A depends on field X, B says X missing           │
│  ├─ Filter assumes format, Delivery assumes different format    │
│  └─ Grouping assumes field, Rendering uses different field      │
│                                                                 │
│  Layer 4: VAGUE LANGUAGE DETECTION                              │
│  ├─ Ambiguous terms: "appropriate", "relevant", "some"          │
│  ├─ Time references: "recent", "latest", "old"                  │
│  └─ Quantity references: "few", "many", "all"                   │
│                                                                 │
│  Layer 5: BUSINESS LOGIC RISKS                                  │
│  ├─ PII exposure (personal data visible to multiple people)     │
│  ├─ Irreversible actions (delete, send, post)                   │
│  └─ Data aggregation direction (per-item vs summary)            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Assumption Prioritization (How to Display):**

| Priority | Criteria | UI Treatment |
|----------|----------|--------------|
| **MUST CONFIRM** | Fake validation + high impact + pattern detected | Expanded, requires explicit approval |
| **SHOULD REVIEW** | Failed grounding OR medium confidence | Visible, checkbox pre-checked |
| **LOOKS GOOD** | High confidence + validated | Collapsed, shown as "N assumptions validated" |

**Real Example: Loop Intent Bug Caught by This Framework:**

User intent: "Send each salesperson their own email with their leads"
LLM assumption (A5): "One email to all salespeople" with `confidence: "high"`

Grounding result exposed the issue:
```json
{
  "assumption_id": "A5",
  "validated": true,
  "confidence": 0.7,
  "evidence": "Behavior validation not implemented, assuming valid"
}
```

**How the 5 layers catch it:**
1. **Layer 1**: High confidence claim + 0.7 grounding + "not implemented" evidence → **FLAG**
2. **Layer 2**: `grouping_by_person` + `single_delivery` pattern → **SURFACE QUESTION**
3. **Layer 5**: PII exposure (emails visible to all) → **MUST CONFIRM**

Result: User sees clear question before execution, not after wrong emails are sent.

### What to Surface in the Single UI (After Grounding)

All information is collected and shown in ONE unified screen after Phase 2:

**QUESTIONS Section (from Phase 1 + Phase 2 enrichment):**

| Source | What to Extract | UI Element |
|--------|-----------------|------------|
| `clarifications_needed[]` | Questions LLM identified | Dropdowns with grounding-discovered options |
| `ambiguities[]` where `requires_user_input: true` | Unresolved design decisions | Radio buttons |

**PLEASE CONFIRM Section (from 5-layer detection on grounded data):**

| Source | What to Extract | UI Element |
|--------|-----------------|------------|
| Layer 1: Confidence mismatches | Fake validations exposed | MUST answer radio |
| Layer 2: Semantic patterns | Loop intent, data visibility | MUST answer radio |
| Layer 5: Business risks | PII exposure, irreversible actions | Warning + confirm |
| `grounding_errors[]` | Failed validations | Warning banner |

**ASSUMPTIONS Section (from Phase 1 + Phase 2 validation):**

| Source | What to Extract | UI Element |
|--------|-----------------|------------|
| `assumptions[]` with high confidence | Validated assumptions | Collapsed, expandable |
| `assumptions[]` with medium confidence | Need review | Visible checkboxes |
| `assumptions[]` with fake validation | "Not implemented" evidence | MUST CONFIRM |

**EDGE CASES Section (from Phase 1 edge_cases[]):**

| Source | What to Extract | UI Element |
|--------|-----------------|------------|
| `edge_cases[]` | Failure scenarios | Dropdown with handling options |
| Empty result scenarios | No data found | Dropdown: skip/send anyway/notify |
| Missing field scenarios | Data gaps | Dropdown: skip/fallback/stop |

### Edge Cases: Always Present to User

Edge cases should **always** be surfaced because they represent the system's assumptions about failure handling:

```typescript
interface EdgeCasePresentation {
  scenario: string;           // "No rows match Stage = 4"
  current_handling: string;   // "Send email with 'none found'"
  alternatives: string[];     // ["Don't send", "Send different message"]
  user_choice?: string;       // What user selected
  is_default_approved: boolean; // Did user accept the default?
}
```

**Why edge cases matter:**
1. They expose hidden assumptions about failure behavior
2. Users often have different expectations for edge cases
3. Edge case handling is where "wrong thing" failures happen
4. Users may want alerts/notifications instead of silent handling

**Files to Create for Ambiguity Detection:**

```
lib/pilot/intent-validation/
├── AmbiguityDetector.ts              # Orchestrates all 5 layers
├── detectors/
│   ├── ConfidenceMismatchDetector.ts # Layer 1
│   ├── SemanticPatternDetector.ts    # Layer 2
│   ├── ConflictDetector.ts           # Layer 3
│   ├── VagueLanguageDetector.ts      # Layer 4
│   ├── BusinessLogicDetector.ts      # Layer 5
│   └── LoopIntentDetector.ts         # Specific pattern (part of Layer 2)
```

### Data Model

```typescript
interface IntentValidationResult {
  validation_id: string;
  agent_id: string;

  // Confidence
  overall_confidence: number;

  // User-facing content
  plain_language_summary: PlainLanguageSummary;
  assumptions_made: Assumption[];
  edge_cases: EdgeCase[];

  // Validation results
  deterministic_issues: DeterministicIssue[];
  semantic_issues: SemanticIssue[];

  // User decision
  status: 'pending' | 'approved' | 'rejected' | 'modified';
}

interface Assumption {
  assumption: string;           // "Urgent = Priority High"
  derived_from: string;         // "User answer: urgent tickets"
  risk_level: 'low' | 'medium' | 'high';
  user_approved: boolean;       // User checked the box
}

interface EdgeCase {
  scenario: string;              // "No urgent tickets found"
  current_behavior: string;      // "Sends empty email"
  suggestion?: string;           // "Skip email if no tickets?"
}
```

### Connection to Shadow Agent

Assumptions captured during Intent Validation flow into Shadow Agent:

```typescript
// If step fails and has high-risk assumption
if (step_fails && step.assumptions.some(a => a.risk_level === 'high')) {
  // Likely cause: assumption was wrong
  // Propose: Review assumption with user
}
```

### Files to Create

```
lib/pilot/intent-validation/
├── IntentValidator.ts           # Main orchestrator
├── DeterministicChecker.ts      # Rule-based validation
├── PlainLanguageGenerator.ts    # IR → human-readable summary
├── AssumptionExtractor.ts       # Surface assumptions from plan
├── EdgeCaseDetector.ts          # Identify potential issues
├── InlineEditHandler.ts         # Process user edits
└── types.ts                     # Interfaces

components/agent-creation/
├── IntentConfirmationStep.tsx   # Main UI component
├── EditableSummary.tsx          # Inline editable summary
├── AssumptionCheckboxes.tsx     # Toggle assumptions
└── EdgeCaseWarnings.tsx         # Show potential issues
```

---

## 🏗️ SYSTEM 1: SHADOW AGENT (Execution Health)

### Purpose
Monitor execution step-by-step, capture failures, propose fixes, enable resume from last good checkpoint.

### Key Behaviors

**When Step Fails:**
1. **Hold execution** (pause, don't fail entire workflow)
2. **Capture snapshot** (full context: inputs, outputs, state, dependencies)
3. **Classify error** (7 categories - see below)
4. **Determine if auto-fixable** or needs approval
5. **Propose repair** (fix code, change params, add fallback, alert user)
6. **Resume from checkpoint** (re-run failed step only)

**When Data Missing/Empty:**
1. **Detect scenario**:
   - Empty results (Gmail returns 0 emails)
   - Missing field (step1.data.invalid_field)
   - Null/undefined upstream data
2. **User decision required**: What should happen?
   - Stop workflow and alert user?
   - Continue with empty data?
   - Use fallback/default value?
   - Skip dependent steps?
3. **Store user preference** as behavior rule
4. **Apply deterministically** on future runs

### Error Classification (7 Categories)

```typescript
type FailureCategory =
  | 'execution_error'        // Plugin failed, API error, timeout
  | 'missing_step'           // Workflow missing required step
  | 'invalid_step_order'     // Dependencies not met
  | 'capability_mismatch'    // Plugin can't do requested action
  | 'logic_error'            // Conditional logic broken
  | 'data_shape_mismatch'    // Expected array, got object
  | 'data_unavailable';      // Empty results, missing fields
```

### Repair Strategies

| Error Type | Auto-Fix? | Repair Action |
|------------|-----------|---------------|
| **execution_error** (rate limit) | ✅ Yes | Retry with backoff |
| **execution_error** (auth) | ❌ No | Alert user to reconnect |
| **missing_step** | ✅ Yes | Insert missing step (with approval) |
| **invalid_step_order** | ✅ Yes | Reorder dependencies |
| **capability_mismatch** | ❌ No | Suggest alternative plugin |
| **logic_error** | ⚠️ Maybe | Fix condition (with approval) |
| **data_shape_mismatch** | ✅ Yes | Add transform step |
| **data_unavailable** | ❌ No | Ask user what to do |

### Checkpointing Strategy

**Current:** Checkpoint after every step (coarse-grained)
**Enhanced:** Multi-level checkpoints

```typescript
interface CheckpointLevel {
  step: StepCheckpoint;       // After each step (existing)
  batch: BatchCheckpoint;      // After parallel batch
  phase: PhaseCheckpoint;      // After major workflow section
  validation: ValidationPoint; // Before expensive operations
}
```

**Resume Logic:**
```
Workflow fails at Step 5
  ↓
Shadow Agent captures failure at Step 5 checkpoint
  ↓
Proposes fix (auto or approval)
  ↓
Resume from Step 5 (not Step 1)
  ↓
Steps 1-4 results preserved (metadata only, no data)
  ↓
Step 5 re-executes with fix
  ↓
Continue to Step 6+
```

### Execution Protection (Calibration Mode)

First 3-5 runs of new agent = "calibration mode"

**Protection mechanisms:**
- **Step limit**: Max 20 steps per run
- **Token budget**: Max 10k tokens per run
- **Early stop**: Pause on first failure (don't continue)
- **Cost cap**: Stop if cost exceeds $1
- **Checkpoint frequency**: After every step (not batched)

**After calibration:** Full production mode (no limits)

---

## 🏗️ SYSTEM 2: BUSINESS INSIGHT SYSTEM

### Purpose
Analyze executions to generate actionable insights that improve reliability, reduce cost, and grow business value.

### Two Insight Types

#### 1️⃣ **Data Quality Insights** (Fix Problems)

Answers:
- **What data is missing?** "Gmail search returned 0 emails - check search query"
- **What data is malformed?** "CRM returned array instead of object - add transform"
- **What fields don't exist?** "step1.data.contacts doesn't exist - available: step1.data.records"
- **What caused empty results?** "Airtable filter too strict - only 2/100 records matched"

Examples:
```
📊 Data Quality Insight
━━━━━━━━━━━━━━━━━━━━
Title: "Gmail search returning no results"
Type: data_unavailable
Severity: high

Issue:
Your "Expense Report Generator" ran successfully, but Gmail
found 0 emails matching "subject:expenses from:receipts@company.com".

Impact:
- No expense reports generated (0 items processed)
- Workflow completes but produces no business value
- Wastes 450 tokens per empty run

Recommendation:
1. Check if search query is too restrictive
2. Add fallback: If 0 results, search broader query
3. Alert you when 0 emails found

┌─────────────────────────────┐
│ [Apply Fix] [Ignore] [Edit] │
└─────────────────────────────┘
```

#### 2️⃣ **Growth Insights** (Improve Business)

Answers:
- **What's working well?** "10/10 expense reports processed successfully"
- **What could be automated more?** "You manually approve 80% - consider auto-approval for <$50"
- **What's costing too much?** "Gmail fetch uses 2k tokens - enable caching to save 60%"
- **What patterns exist?** "Most expenses filed Mon-Wed - schedule agent for those days"
- **What risks exist?** "No fallback for Gmail failures - 1 API error stops entire workflow"

Examples:
```
💡 Growth Insight
━━━━━━━━━━━━━━━━
Title: "High manual approval rate"
Type: automation_opportunity
Severity: medium

Pattern Detected:
Your "Lead Qualification" agent requires manual approval
for 82% of leads (45/55 in last week).

Business Impact:
- Average 15min delay per approval
- 11.25 hours spent on approvals last week
- Potential leads lost due to slow response

Recommendation:
Auto-approve leads that match:
- Company size > 100 employees
- Industry in [SaaS, FinTech, Healthcare]
- Lead score > 70

Estimated savings:
- 9 hours/week saved
- 30% faster lead response time
- $180/week in time saved

┌───────────────────────────────────────┐
│ [Enable Auto-Approval] [Customize]    │
└───────────────────────────────────────┘
```

### Insight Generation Flow

```
Execution Completes (or Partially Completes)
  ↓
InsightAnalyzer detects patterns:
  - Empty result workflows
  - Repeated failures
  - High manual approval rates
  - Token usage anomalies
  - Data structure mismatches
  ↓
ConfidenceCalculator determines insight_mode:
  - 1 run → observation
  - 2-3 runs → early_signals
  - 4-10 runs → emerging_patterns
  - 10+ runs → confirmed
  ↓
InsightGenerator translates to business language:
  - "You spent $X on Y" → Not "Step 3 used 2000 tokens"
  - "Consider automating Z" → Not "Add conditional step"
  - Language constraints applied based on confidence mode
  ↓
AdaptationEngine proposes behavior changes:
  - Fallback rules
  - Auto-retry policies
  - Caching strategies
  - Auto-approval thresholds
  ↓
User sees insight in dashboard/execution results
  ↓
User approves adaptation
  ↓
MemoryManager stores as behavior rule
  ↓
Next run applies memory deterministically
```

---

## 🎯 INSIGHT CONFIDENCE SYSTEM (CRITICAL)

### Core Principle (Non-Negotiable)

> **Insight confidence must scale with evidence.**
> With few runs, the system must NOT present trends, diagnoses, or strong recommendations.

Users will abandon the product if insights feel premature or fabricated.

### Confidence Modes

| Run Count | Mode | Allowed Insight |
|-----------|------|-----------------|
| 1 run | **observation** | Describe what happened in the run |
| 2-3 runs | **early_signals** | Possible patterns, low confidence |
| 4-10 runs | **emerging_patterns** | Likely issues + cautious suggestions |
| 10+ runs | **confirmed** | Trends, risks, recommendations |

**Configuration:** Thresholds are configurable **globally per user** (stored in `profiles.insight_preferences`):
```json
{
  "early_signals_threshold": 2,
  "emerging_patterns_threshold": 4,
  "confirmed_threshold": 10
}
```

### Deterministic vs AI Responsibilities

**Deterministic Layer (no reasoning) produces:**
```typescript
interface ExecutionSummary {
  runs_analyzed: number;
  confidence_mode: 'observation' | 'early_signals' | 'emerging_patterns' | 'confirmed';

  // Factual data only
  step_success_rate: number[];
  fallback_usage_rate: number[];
  confidence_scores: number[];
  retry_counts: number[];
  resume_counts: number;
  manual_interventions: number;
  execution_durations_ms: number[];
}
```

Example deterministic input to AI:
```json
{
  "runs_analyzed": 2,
  "confidence_mode": "early_signals",
  "execution_summary": {
    "fallback_rate": [0.22, 0.25],
    "confidence_scores": [0.71, 0.69],
    "resumes": 1,
    "manual_interventions": 0
  }
}
```

**No client data. No interpretation. Just facts.**

**AI Insight Layer is responsible for:**
- Interpreting execution behavior
- Inferring possible business implications
- Communicating in business language
- Suggesting optional actions (when earned)

**AI is NOT allowed to:**
- Invent facts
- Claim trends without evidence
- Diagnose root causes with low sample size
- Suggest urgent or risky actions prematurely

### Language Constraints by Confidence Mode

**Mode: observation (1 run)**
```
Required language: "In this run...", "The workflow..."
Prohibited: trends, patterns, risks, recommendations
```

**Mode: early_signals (2-3 runs)**
```
Required language: "early", "initial", "possible", "worth monitoring"
Must state: "evidence is limited", "may reflect normal variability"
Prohibited: trends, root cause, urgency, strong recommendations
```

**Mode: emerging_patterns (4-10 runs)**
```
Allowed: "likely", "appears to be", "consider", "you might want to"
Still prohibited: definitive claims, urgent language
```

**Mode: confirmed (10+ runs)**
```
Allowed: trends, risks, strong recommendations, ROI claims
Full insight capability unlocked
```

### Example Outputs by Mode

**Observation (1 run):**
```
Run Summary

In this run, the workflow completed successfully in 12 seconds.
3 emails were processed and 2 CRM records were created.

No issues detected in this execution.
```

**Early Signals (2 runs):**
```
Early Observation

Across the first two runs, the automation required fallback
handling for some inputs.

This is common during early setup and may reflect normal
variability rather than a persistent issue.

No action is needed yet — I'll continue monitoring and
notify you if this becomes consistent.
```

**Emerging Patterns (6 runs):**
```
Possible Pattern Detected

Over the past 6 runs, the Gmail search step has returned
empty results 4 times (67%).

This might indicate:
• Search criteria may be too narrow
• Email patterns may have changed

You might want to review the search query or add a fallback
data source for when no emails are found.
```

**Confirmed (15 runs):**
```
Confirmed Trend: High Manual Intervention Rate

Over 15 runs, your "Lead Qualification" agent has required
manual approval 82% of the time (45/55 leads).

Business Impact:
• 11.25 hours spent on approvals last week
• Average 15-minute response delay per lead
• Estimated revenue at risk: $2,400/month

Recommendation:
Auto-approve leads matching these criteria:
• Company size > 100 employees
• Industry in [SaaS, FinTech, Healthcare]
• Lead score > 70

Projected savings: 9 hours/week ($180/week)

┌────────────────────────────────────────┐
│ [Enable Auto-Approval] [Customize]     │
└────────────────────────────────────────┘
```

### Implementation: ConfidenceCalculator

```typescript
// lib/pilot/insight/ConfidenceCalculator.ts

interface UserInsightPreferences {
  early_signals_threshold: number;      // Default: 2
  emerging_patterns_threshold: number;  // Default: 4
  confirmed_threshold: number;          // Default: 10
}

type ConfidenceMode = 'observation' | 'early_signals' | 'emerging_patterns' | 'confirmed';

class ConfidenceCalculator {
  constructor(private userPreferences: UserInsightPreferences) {}

  calculateMode(runsAnalyzed: number): ConfidenceMode {
    const { early_signals_threshold, emerging_patterns_threshold, confirmed_threshold } = this.userPreferences;

    if (runsAnalyzed >= confirmed_threshold) {
      return 'confirmed';
    } else if (runsAnalyzed >= emerging_patterns_threshold) {
      return 'emerging_patterns';
    } else if (runsAnalyzed >= early_signals_threshold) {
      return 'early_signals';
    } else {
      return 'observation';
    }
  }

  getLanguageConstraints(mode: ConfidenceMode): LanguageConstraints {
    const constraints: Record<ConfidenceMode, LanguageConstraints> = {
      observation: {
        required_phrases: [],
        prohibited_phrases: ['trend', 'pattern', 'risk', 'recommend', 'should', 'must'],
        tone: 'neutral_factual',
        can_suggest_actions: false
      },
      early_signals: {
        required_phrases: ['early', 'initial', 'possible', 'may', 'might'],
        prohibited_phrases: ['trend', 'risk', 'urgent', 'critical', 'must'],
        tone: 'cautious_exploratory',
        can_suggest_actions: false
      },
      emerging_patterns: {
        required_phrases: ['appears', 'likely', 'consider', 'you might'],
        prohibited_phrases: ['definitely', 'must', 'urgent', 'critical'],
        tone: 'tentative_helpful',
        can_suggest_actions: true,
        action_prefix: 'You might want to'
      },
      confirmed: {
        required_phrases: [],
        prohibited_phrases: [],
        tone: 'confident_advisory',
        can_suggest_actions: true,
        action_prefix: 'Recommendation:'
      }
    };

    return constraints[mode];
  }
}

interface LanguageConstraints {
  required_phrases: string[];
  prohibited_phrases: string[];
  tone: string;
  can_suggest_actions: boolean;
  action_prefix?: string;
}
```

### Implementation: InsightGenerator Prompt

**Single prompt template with confidence mode injection:**

```typescript
// lib/pilot/insight/InsightGenerator.ts

function buildInsightPrompt(
  executionSummary: ExecutionSummary,
  confidenceMode: ConfidenceMode,
  constraints: LanguageConstraints
): string {
  return `
You are an AI insight generator for an automation platform.
Your role is to analyze execution data and provide business-meaningful insights.

## CRITICAL RULES

1. **Confidence Mode: ${confidenceMode}**
   - Runs analyzed: ${executionSummary.runs_analyzed}
   - You MUST match your confidence level to the evidence available

2. **Language Constraints:**
   - Required phrases to use: ${constraints.required_phrases.join(', ') || 'none'}
   - PROHIBITED phrases (never use): ${constraints.prohibited_phrases.join(', ') || 'none'}
   - Tone: ${constraints.tone}
   - Can suggest actions: ${constraints.can_suggest_actions}
   ${constraints.action_prefix ? `- Action prefix: "${constraints.action_prefix}"` : ''}

3. **You must NEVER:**
   - Invent facts not in the data
   - Claim trends with fewer than 10 runs
   - Diagnose root causes with fewer than 4 runs
   - Use urgent language with fewer than 10 runs
   - Suggest risky actions prematurely

4. **Business Language:**
   - Write for non-technical users
   - Focus on business impact, not technical details
   - Use time saved, cost saved, risk reduced

## EXECUTION DATA

${JSON.stringify(executionSummary, null, 2)}

## YOUR TASK

Generate a business insight following the confidence mode rules above.
Structure your response as:
- Title (short, business-focused)
- Description (what the data shows)
- Business Impact (only if confidence_mode is emerging_patterns or confirmed)
- Recommendation (only if can_suggest_actions is true)

Remember: The Insight Agent must earn the right to be confident.
Confidence increases only as run evidence accumulates.
`;
}
```

### Why This Matters (Design Rationale)

1. **Prevents "fake AI insight"** - No hallucinated trends from 2 runs
2. **Builds long-term user trust** - Insights feel earned, not guessed
3. **Avoids premature alarm** - Users don't panic over normal variability
4. **Scales across domains** - AI handles interpretation without brittle rules
5. **Deterministic control** - Confidence mode is calculated, not guessed

### Key Internal Rule

> **The Insight Agent must earn the right to be confident.**
> Confidence increases only as run evidence accumulates.

---

## 📊 DATA MODELS

### 1. FailureSnapshot (Shadow Agent)

```typescript
interface FailureSnapshot {
  id: string;
  execution_id: string;
  agent_id: string;
  user_id: string;

  // Failure context
  failed_step_id: string;
  failed_step_name: string;
  step_type: string;
  failure_category: FailureCategory;
  error_message: string;
  error_code?: string;

  // Execution state (metadata only)
  checkpoint_data: CheckpointData;
  completed_steps: string[];
  failed_steps: string[];

  // Environment
  upstream_dependencies: StepDependency[];
  available_variables: Record<string, 'available' | 'null' | 'missing'>;

  // Diagnostics
  retry_count: number;
  tokens_used_before_failure: number;
  execution_time_before_failure_ms: number;

  // Timestamps
  failed_at: Date;
  captured_at: Date;
}

interface CheckpointData {
  step_outputs_metadata: Record<string, StepOutputMetadata>; // NO raw data
  context_variables: Record<string, any>; // Only primitives
  execution_state: 'running' | 'paused' | 'failed';
  last_successful_step: string;
}

interface StepDependency {
  step_id: string;
  dependency_type: 'data' | 'control_flow';
  field_path?: string;
  is_satisfied: boolean;
}
```

### 2. RepairPlan (Shadow Agent)

```typescript
interface RepairPlan {
  id: string;
  snapshot_id: string;

  // Repair strategy
  repair_type: 'auto' | 'approval_required';
  repair_actions: RepairAction[];

  // User decision (for data issues)
  requires_user_decision: boolean;
  decision_prompt?: string;
  decision_options?: DecisionOption[];

  // Execution
  estimated_token_cost: number;
  estimated_time_ms: number;
  risk_level: 'low' | 'medium' | 'high';

  // Status
  status: 'proposed' | 'approved' | 'rejected' | 'applied';
  created_at: Date;
  applied_at?: Date;
}

interface RepairAction {
  type: 'retry' | 'add_step' | 'modify_step' | 'add_fallback' | 'alert_user';
  target_step_id?: string;
  modifications?: any; // Step changes
  reason: string; // Human-readable
}

interface DecisionOption {
  id: string;
  label: string; // "Stop workflow and alert me"
  behavior: 'stop' | 'continue' | 'fallback' | 'skip';
  creates_memory_rule: boolean;
}
```

### 3. ResumeContext (Shadow Agent)

```typescript
interface ResumeContext {
  execution_id: string;
  snapshot_id: string;

  // Resume strategy
  resume_from_step: string;
  skip_steps: string[]; // Already completed

  // Restored state
  restored_metadata: Record<string, StepOutputMetadata>;
  restored_variables: Record<string, any>;

  // Modifications
  applied_repairs: RepairAction[];
  modified_steps: WorkflowStep[];

  // Protection
  remaining_token_budget?: number;
  remaining_step_limit?: number;

  created_at: Date;
}
```

### 4. ExecutionInsight (Business Insight System)

```typescript
interface ExecutionInsight {
  id: string;
  user_id: string;
  agent_id: string;
  execution_ids: string[]; // Can span multiple runs

  // Insight classification
  insight_type: InsightType;
  category: 'data_quality' | 'growth_opportunity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0.0 to 1.0

  // User-facing content (BUSINESS LANGUAGE)
  title: string;
  description: string;
  business_impact: string;
  recommendation: string;

  // Supporting data (metadata only)
  pattern_data: PatternData;
  metrics: InsightMetrics;

  // Lifecycle
  status: 'new' | 'viewed' | 'applied' | 'dismissed' | 'snoozed';
  viewed_at?: Date;
  applied_at?: Date;
  dismissed_at?: Date;
  snoozed_at?: Date;
  snooze_until?: Date; // Reappear after this time (default: 7 days)

  created_at: Date;
}

type InsightType =
  | 'data_unavailable'
  | 'data_malformed'
  | 'repeated_failure'
  | 'high_token_usage'
  | 'automation_opportunity'
  | 'performance_degradation'
  | 'cost_optimization'
  | 'reliability_risk';

interface PatternData {
  occurrences: number;
  time_range: { start: Date; end: Date };
  affected_steps: string[];
  sample_data: any; // Anonymized example
}

interface InsightMetrics {
  time_saved_potential_hours?: number;
  cost_saved_potential_usd?: number;
  success_rate_improvement?: number;
  items_processed_avg?: number;
}
```

### 5. BehaviorRule (Memory)

```typescript
interface BehaviorRule {
  id: string;
  user_id: string;
  agent_id?: string; // null = global rule

  // Rule definition
  rule_type: RuleType;
  trigger_condition: TriggerCondition;
  action: RuleAction;

  // Context
  created_from_insight_id?: string;
  created_from_snapshot_id?: string;

  // Lifecycle
  status: 'active' | 'inactive' | 'expired';
  applied_count: number;
  last_applied_at?: Date;

  created_at: Date;
  expires_at?: Date;
}

type RuleType =
  | 'data_fallback'
  | 'auto_retry'
  | 'auto_approval'
  | 'skip_on_empty'
  | 'cache_result'
  | 'alert_on_condition';

interface TriggerCondition {
  step_pattern?: string; // "gmail_search_*"
  error_pattern?: string;
  data_pattern?: {
    field: string;
    operator: 'empty' | 'missing' | 'null' | 'malformed';
  };
}

interface RuleAction {
  type: 'fallback' | 'retry' | 'skip' | 'alert' | 'cache' | 'auto_approve';
  params: any; // Rule-specific parameters
}
```

---

## 🔄 EXECUTION FLOW WITH SHADOW AGENT

### Scenario 1: Gmail Search Returns 0 Results

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Gmail Search (query: "subject:urgent")         │
│ Result: {emails: [], total_found: 0}                   │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Shadow Agent Detects: data_unavailable                  │
│ - Expected: emails array with items                     │
│ - Got: empty array                                       │
│ - Downstream impact: Step 2 (transform) will process 0  │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Shadow Agent Checks Memory: Any rule for this?          │
│ - No existing rule found                                │
│ - PAUSE execution (hold at Step 1)                      │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Create Data Decision Request (like approval)            │
│                                                          │
│ 📧 Empty Results Detected                               │
│                                                          │
│ Your "Urgent Email Processor" found 0 emails matching   │
│ "subject:urgent". What should happen?                   │
│                                                          │
│ Options:                                                 │
│ ○ Stop workflow and alert me                           │
│ ○ Continue with empty data (process 0 items)           │
│ ○ Use fallback query (search "priority:high" instead)  │
│ ○ Skip remaining steps                                  │
│                                                          │
│ [Remember my choice for future runs]  [☑]               │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ User Selects: "Continue with empty data"                │
│ + Remember choice = true                                │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Create Behavior Rule                                     │
│ {                                                        │
│   rule_type: 'skip_on_empty',                           │
│   trigger: {step_pattern: 'gmail_search_*',             │
│             data_pattern: {field: 'emails',              │
│                           operator: 'empty'}},           │
│   action: {type: 'continue', alert: false}              │
│ }                                                        │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Resume Execution from Step 2                            │
│ - Step 1 output preserved (empty array)                 │
│ - Step 2 processes 0 items                              │
│ - Workflow completes                                     │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Insight System Generates Data Quality Insight            │
│                                                          │
│ "Your workflow processed 0 emails. Consider:            │
│  - Broader search query                                  │
│  - Fallback data source                                  │
│  - Alert when 0 results found"                          │
└─────────────────────────────────────────────────────────┘
```

### Scenario 2: Step Fails Mid-Execution

```
┌─────────────────────────────────────────────────────────┐
│ Step 1-4: Complete successfully                         │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5: Airtable create_record → 429 Rate Limit        │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Shadow Agent Captures FailureSnapshot                    │
│ - Category: execution_error                             │
│ - Error: 429 rate limit                                  │
│ - Checkpoint: Steps 1-4 metadata preserved              │
│ - Retry count: 0                                         │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Shadow Agent Determines Repair                          │
│ - Error is retryable (429)                              │
│ - Auto-fix: Retry with exponential backoff              │
│ - No approval needed                                     │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Apply Repair: Retry Step 5 (attempt 1)                 │
│ - Wait 2 seconds                                         │
│ - Re-execute Step 5                                      │
│ - SUCCESS                                                │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Continue Execution from Step 6                          │
│ - Steps 1-4: Skipped (already completed)               │
│ - Step 5: Re-executed (success)                         │
│ - Step 6+: Continue normally                            │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Workflow Completes                                       │
│ - Total tokens: Only Steps 5-10 charged                 │
│ - No full rerun cost                                     │
└─────────────────────────────────────────────────────────┘
```

### Scenario 3: Multiple Failures (Calibration Mode)

```
┌─────────────────────────────────────────────────────────┐
│ NEW AGENT - First Run (Calibration Mode Active)         │
│ Limits: 20 steps max, 10k tokens max, $1 cap           │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 1-3: Complete successfully (2k tokens used)        │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: Slack send_message → 403 Forbidden             │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Shadow Agent: STOP (calibration = early stop enabled)   │
│ - Create FailureSnapshot                                │
│ - Category: execution_error (auth)                      │
│ - Repair: Alert user to reconnect Slack                 │
│ - Cost so far: $0.12 (2k tokens)                        │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ User Notified: "Slack connection expired"               │
│ - Provide reconnect link                                │
│ - Execution paused (can resume after fix)               │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ User Reconnects Slack                                    │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ User Clicks "Resume Execution"                          │
│ - Resume from Step 4 (not Step 1)                       │
│ - Steps 1-3 metadata restored                           │
│ - No re-execution of completed steps                    │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: Retry → SUCCESS                                 │
│ Step 5-10: Complete successfully                        │
│ Total cost: $0.28 (only Steps 4-10 charged)            │
└─────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────┐
│ Calibration Progress: 1/5 runs complete                 │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 IMPLEMENTATION STRUCTURE

### New Files to Create

```
lib/pilot/shadow/
├── ShadowAgent.ts              # Main orchestrator
├── FailureClassifier.ts        # Categorize errors into 7 types
├── RepairEngine.ts             # Generate repair plans
├── CheckpointManager.ts        # Enhanced checkpointing (multi-level)
├── ResumeOrchestrator.ts       # Resume from checkpoint logic
├── ExecutionProtection.ts      # Calibration mode limits
├── DataDecisionHandler.ts      # Handle "what should happen?" decisions
└── types.ts                    # FailureSnapshot, RepairPlan, ResumeContext

lib/pilot/insight/
├── InsightAnalyzer.ts          # Pattern detection engine
├── InsightGenerator.ts         # Business language translation
├── AdaptationEngine.ts         # Propose behavior changes
├── MemoryManager.ts            # Store/apply behavior rules
├── PatternDetectors/
│   ├── DataQualityDetector.ts  # Empty results, malformed data
│   ├── CostDetector.ts         # High token usage patterns
│   ├── AutomationDetector.ts   # Manual approval opportunities
│   └── ReliabilityDetector.ts  # Failure patterns, risks
└── types.ts                    # ExecutionInsight, BehaviorRule

components/v2/insights/
├── InsightCard.tsx             # Single insight display
├── InsightsList.tsx            # List view (dashboard)
├── InsightsPanel.tsx           # Full panel (run page)
├── DataDecisionModal.tsx       # "What should happen?" UI
├── ApplyRecommendationButton.tsx
└── InsightFilterBar.tsx        # Filter by type/severity

app/api/v6/shadow/
├── route.ts                    # GET snapshots, POST repairs
├── [id]/route.ts               # Individual snapshot details
└── [id]/resume/route.ts        # Resume from snapshot

app/api/v6/insights/
├── route.ts                    # GET/POST insights
├── [id]/route.ts               # Individual insight details
└── [id]/apply/route.ts         # Apply recommendation

app/api/v6/behavior-rules/
├── route.ts                    # GET/POST rules
└── [id]/route.ts               # Update/delete rule
```

### Files to Modify

```
lib/pilot/WorkflowPilot.ts
─────────────────────────────────────────────────
CHANGES:
1. Add Shadow Agent initialization in constructor
2. Add pre-execution hook:
   - Check if resuming from snapshot
   - Apply behavior rules
   - Initialize calibration mode if needed
3. Add post-step hook:
   - Trigger checkpoint
   - Check execution protection limits
   - Emit events for Shadow Agent
4. Wrap step execution in try-catch:
   - On error: Call ShadowAgent.captureFailure()
   - Check if auto-fixable
   - If yes: Apply repair and resume
   - If no: Pause and create decision request
5. Add resume logic:
   - Load ResumeContext
   - Restore metadata
   - Skip completed steps
   - Execute from failure point

INTEGRATION POINTS:
- Line ~150: Constructor - Initialize ShadowAgent
- Line ~350: execute() - Check for resume
- Line ~450: executeSteps() - Add post-step hook
- Line ~650: Error handling - Integrate ShadowAgent


lib/pilot/StepExecutor.ts
─────────────────────────────────────────────────
CHANGES:
1. Emit events for Shadow Agent:
   - step_started (with context)
   - step_completed (with output metadata)
   - step_failed (with error details)
2. Add behavior rule lookup:
   - Before step execution
   - Check MemoryManager for applicable rules
   - Apply rules (skip, fallback, cache, etc.)
3. Add data availability detection:
   - After plugin execution
   - Check if result is empty but successful
   - Trigger Shadow Agent data handler
4. Enhanced error context:
   - Capture available variables
   - Capture upstream dependencies
   - Include in error throw

INTEGRATION POINTS:
- Line ~100: execute() - Add event emission
- Line ~250: Plugin execution - Add rule lookup
- Line ~400: Transform - Add data availability check


lib/pilot/StateManager.ts
─────────────────────────────────────────────────
CHANGES:
1. Enhanced checkpoint storage:
   - Store metadata in more granular format
   - Add checkpoint levels (step, batch, phase)
   - Store validation points
2. Resume context restoration:
   - New method: restoreFromSnapshot()
   - Reconstruct ExecutionContext
   - Load step metadata (not data)
3. Snapshot management:
   - Create snapshots on failure
   - Prune old snapshots (retention policy)

INTEGRATION POINTS:
- Line ~50: checkpoint() - Enhance with levels
- Line ~120: Add restoreFromSnapshot() method


lib/pilot/ExecutionContext.ts
─────────────────────────────────────────────────
CHANGES:
1. Add shadow agent context:
   - calibrationMode: boolean
   - executionProtection: ProtectionConfig
   - appliedBehaviorRules: BehaviorRule[]
2. Track calibration state:
   - runNumber: number
   - isCalibrationComplete: boolean
3. Add methods:
   - isInCalibrationMode(): boolean
   - getRemainingTokenBudget(): number
   - getRemainingStepLimit(): number

INTEGRATION POINTS:
- Line ~30: Interface definition - Add new fields
- Line ~150: Constructor - Initialize calibration


app/v2/dashboard/page.tsx
─────────────────────────────────────────────────
CHANGES:
1. Add "Business Insights" card to grid
2. Fetch insights in parallel with existing queries:
   - Top 3 insights by severity
   - Group by type (data_quality, growth)
3. Display InsightsList component
4. Add "View All Insights" link → /v2/insights

INTEGRATION POINTS:
- Line ~200: Add to Promise.all() fetch
- Line ~450: Add card to grid (after "System Alerts")


app/v2/agents/[id]/run/page.tsx
─────────────────────────────────────────────────
CHANGES:
1. After execution completes:
   - Fetch insights for this execution
   - Display InsightsPanel component
2. Show data decision modals if execution paused
3. Add "Resume Execution" button if paused

INTEGRATION POINTS:
- Line ~250: After result display - Add InsightsPanel
- Line ~350: Add resume button logic
```

### Database Migrations

```sql
-- Migration 001: Shadow Failure Snapshots
-- File: supabase/migrations/001_shadow_failure_snapshots.sql

CREATE TABLE shadow_failure_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Failure context
  failed_step_id TEXT NOT NULL,
  failed_step_name TEXT,
  step_type TEXT,
  failure_category TEXT NOT NULL, -- 7 categories
  error_message TEXT,
  error_code TEXT,

  -- Execution state (metadata only - NO client data)
  checkpoint_data JSONB NOT NULL,
  completed_steps TEXT[],
  failed_steps TEXT[],

  -- Environment
  upstream_dependencies JSONB,
  available_variables JSONB, -- Only structure, not values

  -- Diagnostics
  retry_count INTEGER DEFAULT 0,
  tokens_used_before_failure INTEGER,
  execution_time_before_failure_ms INTEGER,

  -- Timestamps
  failed_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shadow_snapshots_user ON shadow_failure_snapshots(user_id);
CREATE INDEX idx_shadow_snapshots_agent ON shadow_failure_snapshots(agent_id);
CREATE INDEX idx_shadow_snapshots_execution ON shadow_failure_snapshots(execution_id);
CREATE INDEX idx_shadow_snapshots_category ON shadow_failure_snapshots(failure_category);

-- RLS Policies
ALTER TABLE shadow_failure_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots"
  ON shadow_failure_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert snapshots"
  ON shadow_failure_snapshots FOR INSERT
  WITH CHECK (true);


-- Migration 002: Repair Plans
-- File: supabase/migrations/002_repair_plans.sql

CREATE TABLE repair_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID REFERENCES shadow_failure_snapshots(id) ON DELETE CASCADE,

  -- Repair strategy
  repair_type TEXT NOT NULL, -- 'auto' | 'approval_required'
  repair_actions JSONB NOT NULL,

  -- User decision
  requires_user_decision BOOLEAN DEFAULT false,
  decision_prompt TEXT,
  decision_options JSONB,
  user_decision JSONB, -- Selected option

  -- Execution
  estimated_token_cost INTEGER,
  estimated_time_ms INTEGER,
  risk_level TEXT, -- 'low' | 'medium' | 'high'

  -- Status
  status TEXT DEFAULT 'proposed', -- 'proposed' | 'approved' | 'rejected' | 'applied'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);

CREATE INDEX idx_repair_plans_snapshot ON repair_plans(snapshot_id);
CREATE INDEX idx_repair_plans_status ON repair_plans(status);

ALTER TABLE repair_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repair plans"
  ON repair_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shadow_failure_snapshots s
      WHERE s.id = repair_plans.snapshot_id
      AND s.user_id = auth.uid()
    )
  );


-- Migration 003: Behavior Rules (Memory)
-- File: supabase/migrations/003_behavior_rules.sql

CREATE TABLE behavior_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE, -- NULL = global rule

  -- Rule definition
  rule_type TEXT NOT NULL,
  trigger_condition JSONB NOT NULL,
  action JSONB NOT NULL,

  -- Metadata
  name TEXT, -- User-friendly name
  description TEXT,

  -- Context (where did this rule come from?)
  created_from_insight_id UUID,
  created_from_snapshot_id UUID REFERENCES shadow_failure_snapshots(id),

  -- Lifecycle
  status TEXT DEFAULT 'active', -- 'active' | 'inactive' | 'expired'
  applied_count INTEGER DEFAULT 0,
  last_applied_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_behavior_rules_user ON behavior_rules(user_id);
CREATE INDEX idx_behavior_rules_agent ON behavior_rules(agent_id);
CREATE INDEX idx_behavior_rules_status ON behavior_rules(status);
CREATE INDEX idx_behavior_rules_type ON behavior_rules(rule_type);

ALTER TABLE behavior_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own rules"
  ON behavior_rules FOR ALL
  USING (auth.uid() = user_id);


-- Migration 004: Execution Insights
-- File: supabase/migrations/004_execution_insights.sql

CREATE TABLE execution_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  execution_ids TEXT[], -- Can span multiple runs

  -- Insight classification
  insight_type TEXT NOT NULL,
  category TEXT NOT NULL, -- 'data_quality' | 'growth_opportunity'
  severity TEXT NOT NULL, -- 'low' | 'medium' | 'high' | 'critical'
  confidence NUMERIC(3,2), -- 0.00 to 1.00

  -- User-facing content (BUSINESS LANGUAGE)
  title TEXT NOT NULL,
  description TEXT,
  business_impact TEXT,
  recommendation TEXT,

  -- Supporting data (metadata only - NO client data)
  pattern_data JSONB,
  metrics JSONB,

  -- Lifecycle
  status TEXT DEFAULT 'new', -- 'new' | 'viewed' | 'applied' | 'dismissed' | 'snoozed'
  viewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  snoozed_at TIMESTAMPTZ,
  snooze_until TIMESTAMPTZ, -- When snoozed, reappear after this time (default: 7 days)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_execution_insights_user ON execution_insights(user_id);
CREATE INDEX idx_execution_insights_agent ON execution_insights(agent_id);
CREATE INDEX idx_execution_insights_type ON execution_insights(insight_type);
CREATE INDEX idx_execution_insights_category ON execution_insights(category);
CREATE INDEX idx_execution_insights_status ON execution_insights(status);
CREATE INDEX idx_execution_insights_severity ON execution_insights(severity);

ALTER TABLE execution_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own insights"
  ON execution_insights FOR ALL
  USING (auth.uid() = user_id);


-- Migration 005: Add calibration tracking to agents
-- File: supabase/migrations/005_agent_calibration.sql

ALTER TABLE agents ADD COLUMN IF NOT EXISTS calibration_run_count INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS calibration_complete BOOLEAN DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS calibration_completed_at TIMESTAMPTZ;

-- Update existing agents to mark calibration complete if they have >5 runs
UPDATE agents
SET
  calibration_complete = true,
  calibration_completed_at = NOW()
WHERE
  (SELECT COUNT(*) FROM workflow_executions WHERE agent_id = agents.id) >= 5
  AND calibration_complete = false;
```

---

## 🎯 IMPLEMENTATION PHASES

### Phase 1: Shadow Agent Core (Week 1-2)
**Goal:** Basic failure capture and resume

**Tasks:**
1. Create data models and database migrations
2. Implement FailureClassifier (7 error categories)
3. Implement CheckpointManager (enhanced checkpointing)
4. Integrate with WorkflowPilot error handling
5. Test: Capture failures, create snapshots

**Success Criteria:**
- ✅ Failures captured with full context
- ✅ Snapshots stored in database
- ✅ Error classification working

### Phase 2: Repair & Resume (Week 3-4)
**Goal:** Auto-fix and resume from checkpoint

**Tasks:**
1. Implement RepairEngine (auto-fix strategies)
2. Implement ResumeOrchestrator
3. Add resume endpoints to API
4. Integrate with StateManager for restoration
5. Test: Resume from Step 5 after failure, not Step 1

**Success Criteria:**
- ✅ Auto-fixable errors retry automatically
- ✅ Resume skips completed steps
- ✅ Token costs reflect only re-executed steps

### Phase 3: Calibration Mode (Week 5)
**Goal:** Protect first 3-5 runs

**Tasks:**
1. Implement ExecutionProtection
2. Add calibration tracking to agents table
3. Add step/token/cost limits
4. Add early stop on first failure
5. Test: New agent respects limits

**Success Criteria:**
- ✅ First 5 runs have protection enabled
- ✅ Limits enforced (20 steps, 10k tokens, $1)
- ✅ Early stop prevents cascading failures

### Phase 4: Data Decision Handler (Week 6)
**Goal:** Ask user what to do with empty/missing data

**Tasks:**
1. Implement DataDecisionHandler
2. Create DataDecisionModal UI component
3. Add decision request workflow (similar to approval)
4. Integrate with MemoryManager
5. Test: Empty Gmail results pause and ask user

**Success Criteria:**
- ✅ Empty results trigger decision request
- ✅ User sees clear options
- ✅ Choice stored as behavior rule
- ✅ Future runs apply rule automatically

### Phase 5: Memory System (Week 7)
**Goal:** Store and apply behavior rules deterministically

**Tasks:**
1. Implement MemoryManager
2. Add rule lookup in StepExecutor
3. Add rule application logic
4. Add rule management UI (view/edit/delete)
5. Test: Rule applied on 2nd run without asking

**Success Criteria:**
- ✅ Rules stored in database
- ✅ Rules applied before step execution
- ✅ Rules modify behavior deterministically
- ✅ Users can manage rules

### Phase 6: Insight System Core (Week 8-9)
**Goal:** Detect patterns and generate insights

**Tasks:**
1. Implement InsightAnalyzer
2. Implement pattern detectors:
   - DataQualityDetector
   - CostDetector
   - AutomationDetector
   - ReliabilityDetector
3. Implement InsightGenerator (business language)
4. Add post-execution hook to analyze
5. Test: Empty results generate insight

**Success Criteria:**
- ✅ Patterns detected across multiple runs
- ✅ Insights generated in business language
- ✅ Insights stored in database

### Phase 7: Insight UI (Week 10)
**Goal:** Display insights to users

**Tasks:**
1. Create insight UI components
2. Add "Business Insights" card to dashboard
3. Add InsightsPanel to run page
4. Create dedicated insights page (/v2/insights)
5. Test: User sees insights after execution

**Success Criteria:**
- ✅ Insights visible in dashboard
- ✅ Insights visible in run results
- ✅ Insights sortable/filterable

### Phase 8: Adaptation Engine (Week 11)
**Goal:** Propose behavior changes

**Tasks:**
1. Implement AdaptationEngine
2. Add "Apply Recommendation" functionality
3. Link adaptations to behavior rules
4. Add approval workflow for risky changes
5. Test: User applies recommendation, creates rule

**Success Criteria:**
- ✅ Recommendations actionable with 1 click
- ✅ Applied recommendations create rules
- ✅ Risky changes require approval

### Phase 9: Testing & Refinement (Week 12)
**Goal:** End-to-end testing and polish

**Tasks:**
1. Test full scenarios (empty data, failures, repairs)
2. Load testing (multiple concurrent failures)
3. UI/UX polish
4. Documentation
5. Performance optimization

**Success Criteria:**
- ✅ All scenarios work end-to-end
- ✅ No performance degradation
- ✅ Documentation complete

---

## ✅ SUCCESS CRITERIA

### Shadow Agent Success
- ✅ Agents resume from failure point (not Step 1)
- ✅ Users pay only for failed step retry (not full rerun)
- ✅ Calibration mode protects first 3-5 runs
- ✅ Data issues trigger user decision workflow
- ✅ Auto-fixable errors resolve without user intervention
- ✅ 80% of retryable errors auto-fix
- ✅ Average resume time < 5 seconds

### Insight System Success
- ✅ Data quality insights help users fix problems
- ✅ Growth insights written in business language (no technical jargon)
- ✅ Users understand impact ("Save 9 hours/week" not "Reduce tokens by 30%")
- ✅ Insights lead to actionable improvements
- ✅ Memory rules reduce repeated questions
- ✅ 60% of insights result in applied recommendations
- ✅ Insight confidence score > 0.8 for high-severity insights

### Integration Success
- ✅ No client data stored (only metadata)
- ✅ Deterministic behavior (rules apply predictably)
- ✅ Non-invasive (event-driven hooks)
- ✅ Dashboard integration (insights visible)
- ✅ Approval workflow reused (familiar UX)
- ✅ <10ms overhead per step (performance)

### Business Impact
- ✅ 50% reduction in full workflow reruns
- ✅ 30% reduction in calibration costs
- ✅ 40% faster time-to-production for new agents
- ✅ 25% increase in agent reliability over time
- ✅ 70% reduction in "why did this fail?" support tickets

---

## 🚨 CRITICAL CONSTRAINTS

### Privacy & Data Security
1. **NEVER store client data** in shadow tables
   - ✅ Store: Metadata, counts, field names, types
   - ❌ Store: Email bodies, CRM records, message content, file contents
2. **Checkpoint data** = metadata only
   - Example: `{emails: {count: 5, fields: ['subject', 'from']}}` ✅
   - Example: `{emails: [{subject: "Re: Invoice", body: "..."}]}` ❌
3. **Behavior rules** = decision only, not data
   - Example: `{action: 'continue', alert: false}` ✅
   - Example: `{fallback_value: user_email@example.com}` ❌

### Performance
1. **Shadow Agent overhead** < 10ms per step
2. **Checkpoint storage** < 5ms per checkpoint
3. **Insight generation** runs async (post-execution)
4. **Memory lookup** < 5ms (cached in memory)

### User Experience
1. **No surprise behavior changes** - Always ask permission for intent-changing rules
2. **Clear language** - Business terms, not technical jargon
3. **One-click actions** - "Apply Recommendation" should be instant
4. **Predictable** - Same inputs + same rules = same outputs

### Data Retention Policies
1. **Failure Snapshots** - 30 days retention, then auto-deleted
2. **Execution Insights** - Retained indefinitely (can be manually dismissed)
3. **Behavior Rules** - No expiry unless explicitly set
4. **Repair Plans** - 30 days retention (follows snapshot lifecycle)

### Limits
1. **Behavior Rules** - No limit per agent (full count allowed)
2. **Active Insights** - Maximum 100 unviewed per agent (oldest auto-archived)
3. **Snapshot History** - Maximum 500 per agent within 30-day window

### Insight Lifecycle
```
new → viewed → applied/dismissed/snoozed
                      ↓
              snoozed (7 days) → reappears as new
```

**Snooze Option:** Dismissed insights can be "snoozed" instead, reappearing after 7 days if the pattern persists. This prevents alert fatigue while ensuring important issues resurface.

---

## 📚 APPENDICES

### A. Error Classification Examples

| Error Message | Category | Auto-Fix? | Action |
|---------------|----------|-----------|--------|
| "429 Too Many Requests" | execution_error | ✅ Yes | Retry with backoff |
| "401 Unauthorized" | execution_error | ❌ No | Alert user to reconnect |
| "Network timeout" | execution_error | ✅ Yes | Retry 3 times |
| "step1.data.contacts is undefined" | data_unavailable | ❌ No | Ask user what to do |
| "Expected array, got object" | data_shape_mismatch | ✅ Yes | Add transform step |
| "Condition field 'x' does not exist" | logic_error | ⚠️ Maybe | Fix condition (with approval) |
| "Plugin 'foo' does not support action 'bar'" | capability_mismatch | ❌ No | Suggest alternative |
| "Step depends on 'step99' which does not exist" | invalid_step_order | ✅ Yes | Reorder dependencies |
| "Workflow missing required step 'data_fetch'" | missing_step | ✅ Yes | Insert step (with approval) |

### B. Business Language Translation Examples

| Technical Message | Business Translation |
|-------------------|---------------------|
| "Step 3 used 2000 tokens" | "Gmail search cost $0.04 per run" |
| "Add conditional step with executeIf" | "Skip this step when no emails are found" |
| "Enable response caching" | "Save 60% by reusing recent results" |
| "Reduce parallel batch size" | "Process fewer items at once to avoid rate limits" |
| "Add error handler with fallback" | "Use backup data source if primary fails" |
| "Increase retry backoff multiplier" | "Wait longer between retry attempts" |

### C. Insight Type Catalog

**Data Quality Insights:**
- `data_unavailable` - Empty results, missing data
- `data_malformed` - Unexpected structure
- `data_missing_fields` - Required fields not present
- `data_type_mismatch` - Wrong data type
- `data_validation_failed` - Schema validation errors

**Growth Insights:**
- `automation_opportunity` - High manual approval rate
- `cost_optimization` - High token usage, caching opportunities
- `performance_degradation` - Slower than historical average
- `reliability_risk` - No fallback, single point of failure
- `scale_opportunity` - Could process more items
- `schedule_optimization` - Better timing for execution

### D. Behavior Rule Patterns

**Data Fallback:**
```typescript
{
  rule_type: 'data_fallback',
  trigger: {step_pattern: 'gmail_*', data_pattern: {field: 'emails', operator: 'empty'}},
  action: {type: 'fallback', params: {default_value: [], alert: true}}
}
```

**Auto-Retry:**
```typescript
{
  rule_type: 'auto_retry',
  trigger: {error_pattern: '429|503'},
  action: {type: 'retry', params: {max_attempts: 5, backoff_ms: 2000}}
}
```

**Skip on Empty:**
```typescript
{
  rule_type: 'skip_on_empty',
  trigger: {step_pattern: 'transform_*', data_pattern: {field: 'input', operator: 'empty'}},
  action: {type: 'skip', params: {reason: 'No data to transform'}}
}
```

**Auto-Approval:**
```typescript
{
  rule_type: 'auto_approval',
  trigger: {step_pattern: 'approval_*'},
  action: {type: 'auto_approve', params: {conditions: [{field: 'amount', operator: '<', value: 50}]}}
}
```

---

## 🔗 RELATED DOCUMENTS

- [V6 Execution Guide](../v6/V6_EXECUTION_GUIDE.md) - Current execution architecture
- [V6 Declarative Architecture](../V6_DECLARATIVE_ARCHITECTURE.md) - DSL compiler design
- [AIS Complete System Guide](../AIS_COMPLETE_SYSTEM_GUIDE.md) - AI Intelligence System
- [Admin UI Reorganization](../ADMIN_UI_REORGANIZATION.md) - UI patterns

---

## 📝 REVISION HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-06 | System | Initial architecture design |

---

**END OF DOCUMENT**
