# Memory System Deep Dive - Behavior Rules Architecture

**Companion to:** [shadow-critic-architecture.md](./shadow-critic-architecture.md)
**Version:** 1.0
**Created:** 2026-01-06

---

## 🎯 WHAT IS THE MEMORY SYSTEM?

The Memory System is how agents **learn from experience without storing client data**. It converts user decisions and system observations into **deterministic behavior rules** that modify future execution predictably.

### Core Concept

```
Problem → User Decision → Behavior Rule → Deterministic Future Behavior
```

**NOT machine learning** - This is explicit, auditable rule storage.
**NOT data storage** - This stores decisions, not data.

---

## 🧠 WHY MEMORY RULES?

### The Problem They Solve

**Without Memory:**
```
Run 1: Gmail returns 0 results → Agent asks "What should I do?"
Run 2: Gmail returns 0 results → Agent asks AGAIN "What should I do?"
Run 3: Gmail returns 0 results → Agent asks AGAIN "What should I do?"
...
```

User gets frustrated answering the same question repeatedly.

**With Memory:**
```
Run 1: Gmail returns 0 results → Agent asks "What should I do?"
       User: "Continue with empty data"
       System: Creates behavior rule

Run 2: Gmail returns 0 results → Rule applied automatically (no question)
Run 3: Gmail returns 0 results → Rule applied automatically (no question)
...
```

User answered once, system remembers forever.

---

## 📊 MEMORY RULE STRUCTURE

### Complete Data Model

```typescript
interface BehaviorRule {
  // Identity
  id: string;                    // UUID
  user_id: string;               // Which user created this rule
  agent_id?: string;             // Specific agent, or null = global

  // Rule Definition (THE CORE)
  rule_type: RuleType;           // What kind of rule
  trigger_condition: TriggerCondition;  // When to apply
  action: RuleAction;            // What to do

  // Provenance (where did this rule come from?)
  created_from_insight_id?: string;     // If from insight
  created_from_snapshot_id?: string;    // If from failure
  created_from: 'user_decision' | 'insight' | 'shadow_agent' | 'manual';

  // Metadata
  name?: string;                 // User-friendly name
  description?: string;          // Human-readable explanation
  priority: number;              // If multiple rules match, which wins?

  // Lifecycle
  status: 'active' | 'inactive' | 'expired';
  applied_count: number;         // How many times used
  last_applied_at?: Date;
  last_applied_execution_id?: string;

  // Effectiveness tracking
  success_count: number;         // Times rule helped
  failure_count: number;         // Times rule caused issues
  effectiveness_score?: number;  // 0.0-1.0 calculated from success/failure

  // Temporal
  created_at: Date;
  updated_at: Date;
  expires_at?: Date;             // Optional auto-expiry
}
```

### Rule Type Taxonomy

```typescript
type RuleType =
  // Data Handling
  | 'data_fallback'        // Use default when data missing
  | 'skip_on_empty'        // Skip step if data empty
  | 'alert_on_condition'   // Alert user on specific data state

  // Error Recovery
  | 'auto_retry'           // Retry on specific errors
  | 'use_fallback_plugin'  // Switch to alternative plugin

  // Optimization
  | 'cache_result'         // Cache step output
  | 'rate_limit_pause'     // Wait before continuing

  // Workflow Control
  | 'auto_approval'        // Auto-approve based on conditions
  | 'conditional_skip'     // Skip steps based on upstream data
  | 'parallel_limit'       // Limit parallel execution

  // Notification
  | 'notify_on_completion' // Alert when done
  | 'escalate_on_failure'; // Alert on repeated failures
```

---

## 🎬 HOW RULES ARE CREATED

### Source 1: User Data Decisions (Most Common)

**Scenario:** Gmail search returns 0 results

**Flow:**
```typescript
// 1. Shadow Agent detects empty data
const detection = {
  step_id: 'step1_gmail_search',
  data_state: 'empty',
  field: 'emails',
  value: []
};

// 2. Create decision request (like approval)
const decisionRequest = {
  title: 'Empty Results Detected',
  message: 'Gmail found 0 emails. What should happen?',
  options: [
    {
      id: 'continue',
      label: 'Continue with empty data (process 0 items)',
      behavior: 'continue',
      creates_rule: true
    },
    {
      id: 'stop',
      label: 'Stop workflow and alert me',
      behavior: 'stop',
      creates_rule: true
    },
    {
      id: 'skip',
      label: 'Skip remaining steps',
      behavior: 'skip',
      creates_rule: true
    },
    {
      id: 'once',
      label: 'Ask me each time (no rule)',
      behavior: 'stop',
      creates_rule: false  // Don't remember
    }
  ],
  remember_choice_default: true
};

// 3. User selects "continue" + "Remember choice"
const userDecision = {
  selected_option: 'continue',
  remember: true
};

// 4. Create behavior rule
const rule: BehaviorRule = {
  id: generateId(),
  user_id: currentUser.id,
  agent_id: currentAgent.id,  // Agent-specific

  rule_type: 'skip_on_empty',
  trigger_condition: {
    step_pattern: 'gmail_search_*',  // Wildcard matching
    data_pattern: {
      field: 'emails',
      operator: 'empty'
    }
  },
  action: {
    type: 'continue',
    params: {
      alert: false,
      log_warning: true
    }
  },

  created_from: 'user_decision',
  name: 'Continue when Gmail returns no emails',
  description: 'When Gmail search finds 0 emails, continue processing with empty data',
  priority: 100,  // Higher = applied first

  status: 'active',
  applied_count: 0,
  success_count: 0,
  failure_count: 0,

  created_at: new Date()
};

// 5. Store in database
await db.behaviorRules.insert(rule);
```

### Source 2: Business Insights (Optimization)

**Scenario:** Insight detects high token usage

**Flow:**
```typescript
// 1. Insight system analyzes 10 runs
const insight: ExecutionInsight = {
  insight_type: 'cost_optimization',
  title: 'High token usage on Gmail fetches',
  description: 'Step "fetch_email_details" uses 2000 tokens per run',
  recommendation: 'Enable caching to reuse recent results',
  metrics: {
    cost_saved_potential_usd: 12.50,  // Per week
    occurrences: 45  // Times this step ran
  }
};

// 2. User clicks "Apply Recommendation"
// 3. System creates rule
const rule: BehaviorRule = {
  rule_type: 'cache_result',
  trigger_condition: {
    step_pattern: 'fetch_email_details'
  },
  action: {
    type: 'cache',
    params: {
      ttl_seconds: 300,  // 5 minute cache
      cache_key_fields: ['email_id'],
      invalidate_on: ['email_modified']
    }
  },

  created_from: 'insight',
  created_from_insight_id: insight.id,
  name: 'Cache Gmail email fetches',
  description: 'Cache email details for 5 minutes to reduce token costs',
  priority: 50
};
```

### Source 3: Shadow Agent Auto-Fix (Error Recovery)

**Scenario:** Repeated 429 rate limit errors

**Flow:**
```typescript
// 1. Shadow Agent detects pattern
const pattern = {
  error_code: '429',
  occurrences: 3,
  plugin: 'airtable',
  action: 'create_record'
};

// 2. Auto-create rule (no approval needed for safe patterns)
const rule: BehaviorRule = {
  rule_type: 'auto_retry',
  trigger_condition: {
    step_pattern: 'airtable_*',
    error_pattern: '429'
  },
  action: {
    type: 'retry',
    params: {
      max_attempts: 5,
      backoff_ms: 2000,
      backoff_multiplier: 2,
      max_backoff_ms: 30000
    }
  },

  created_from: 'shadow_agent',
  name: 'Auto-retry Airtable rate limits',
  priority: 200,  // High priority (apply early)
  status: 'active'
};
```

### Source 4: Manual Rules (Power Users)

**Scenario:** User wants custom rule

**Flow:**
```typescript
// User creates rule via UI
const rule: BehaviorRule = {
  rule_type: 'auto_approval',
  trigger_condition: {
    step_pattern: 'approve_expense',
    data_pattern: {
      field: 'amount',
      operator: '<',
      value: 50
    }
  },
  action: {
    type: 'auto_approve',
    params: {
      reason: 'Amount under $50 threshold',
      notify: false
    }
  },

  created_from: 'manual',
  name: 'Auto-approve expenses under $50',
  priority: 80
};
```

---

## ⚙️ HOW RULES ARE APPLIED

### Execution Flow Integration

```typescript
// In StepExecutor.execute() - BEFORE step runs

class StepExecutor {
  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
    // 1. Look up applicable rules
    const rules = await this.memoryManager.getApplicableRules({
      user_id: context.userId,
      agent_id: context.agentId,
      step: step
    });

    // 2. Sort by priority (highest first)
    rules.sort((a, b) => b.priority - a.priority);

    // 3. Apply rules in order
    for (const rule of rules) {
      const shouldApply = await this.shouldApplyRule(rule, step, context);

      if (shouldApply) {
        const result = await this.applyRule(rule, step, context);

        if (result.modified) {
          // Rule changed step behavior
          console.log(`Applied rule ${rule.id}: ${rule.name}`);

          // Track application
          await this.memoryManager.recordRuleApplication(rule.id, context.executionId);

          // Check if rule says to skip step entirely
          if (result.action === 'skip') {
            context.markStepSkipped(step.id, `Rule: ${rule.name}`);
            return result.output;
          }

          // Modify step before execution
          if (result.modifiedStep) {
            step = result.modifiedStep;
          }
        }
      }
    }

    // 4. Execute step normally (potentially modified by rules)
    try {
      return await this.executeStepInternal(step, context);
    } catch (error) {
      // 5. Check for error-handling rules
      const errorRules = rules.filter(r =>
        r.trigger_condition.error_pattern &&
        this.matchesErrorPattern(error, r.trigger_condition.error_pattern)
      );

      for (const errorRule of errorRules) {
        const recoveryResult = await this.applyErrorRule(errorRule, error, step, context);

        if (recoveryResult.recovered) {
          return recoveryResult.output;
        }
      }

      // No rule handled error, throw
      throw error;
    }
  }
}
```

### Rule Matching Logic

```typescript
class MemoryManager {
  async getApplicableRules(params: {
    user_id: string;
    agent_id: string;
    step: WorkflowStep;
  }): Promise<BehaviorRule[]> {
    const { user_id, agent_id, step } = params;

    // Query database for potentially applicable rules
    const rules = await db.behaviorRules.findMany({
      where: {
        user_id,
        status: 'active',
        OR: [
          { agent_id: agent_id },   // Agent-specific rules
          { agent_id: null }        // Global rules
        ],
        OR: [
          { expires_at: null },     // No expiry
          { expires_at: { gt: new Date() } }  // Not expired
        ]
      }
    });

    // Filter by step pattern matching
    return rules.filter(rule => this.matchesStep(rule, step));
  }

  private matchesStep(rule: BehaviorRule, step: WorkflowStep): boolean {
    const { trigger_condition } = rule;

    // Step pattern matching (supports wildcards)
    if (trigger_condition.step_pattern) {
      const pattern = new RegExp(
        trigger_condition.step_pattern
          .replace(/\*/g, '.*')  // * → .* (regex)
          .replace(/\?/g, '.')   // ? → . (regex)
      );

      const stepIdentifier = `${step.plugin}_${step.action}`;
      if (!pattern.test(stepIdentifier) && !pattern.test(step.id)) {
        return false;
      }
    }

    return true;
  }
}
```

### Rule Application Examples

#### Example 1: skip_on_empty

```typescript
async applyRule(
  rule: BehaviorRule,
  step: WorkflowStep,
  context: ExecutionContext
): Promise<RuleApplicationResult> {
  if (rule.rule_type === 'skip_on_empty') {
    const { data_pattern } = rule.trigger_condition;

    // Resolve the field to check
    const fieldValue = context.resolveVariable(`{{${data_pattern.field}}}`);

    // Check if empty
    const isEmpty =
      fieldValue === null ||
      fieldValue === undefined ||
      (Array.isArray(fieldValue) && fieldValue.length === 0) ||
      (typeof fieldValue === 'object' && Object.keys(fieldValue).length === 0);

    if (isEmpty) {
      // Skip this step
      return {
        modified: true,
        action: 'skip',
        output: {
          stepId: step.id,
          data: null,
          metadata: {
            success: true,
            skipped: true,
            skip_reason: `Rule: ${rule.name}`
          }
        }
      };
    }
  }

  return { modified: false };
}
```

#### Example 2: auto_retry

```typescript
async applyErrorRule(
  rule: BehaviorRule,
  error: Error,
  step: WorkflowStep,
  context: ExecutionContext
): Promise<ErrorRecoveryResult> {
  if (rule.rule_type === 'auto_retry') {
    const { max_attempts, backoff_ms, backoff_multiplier } = rule.action.params;

    // Retry with exponential backoff
    let attempt = 0;
    while (attempt < max_attempts) {
      const delay = backoff_ms * Math.pow(backoff_multiplier, attempt);
      await this.sleep(delay);

      try {
        const output = await this.executeStepInternal(step, context);

        // Success! Track rule effectiveness
        await this.memoryManager.recordRuleSuccess(rule.id);

        return {
          recovered: true,
          output,
          recovery_method: 'auto_retry',
          attempts: attempt + 1
        };
      } catch (retryError) {
        attempt++;
        if (attempt >= max_attempts) {
          // Max attempts reached, track failure
          await this.memoryManager.recordRuleFailure(rule.id);
          throw retryError;
        }
      }
    }
  }

  return { recovered: false };
}
```

#### Example 3: cache_result

```typescript
async applyRule(
  rule: BehaviorRule,
  step: WorkflowStep,
  context: ExecutionContext
): Promise<RuleApplicationResult> {
  if (rule.rule_type === 'cache_result') {
    const { ttl_seconds, cache_key_fields } = rule.action.params;

    // Build cache key
    const cacheKeyParts = cache_key_fields.map(field =>
      context.resolveVariable(`{{${field}}}`)
    );
    const cacheKey = `step:${step.id}:${cacheKeyParts.join(':')}`;

    // Check cache
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      console.log(`Cache hit for step ${step.id} (rule: ${rule.name})`);

      // Return cached result
      return {
        modified: true,
        action: 'return_cached',
        output: {
          stepId: step.id,
          data: cached.data,
          metadata: {
            success: true,
            cached: true,
            cache_hit_at: new Date(),
            execution_time: 0,  // No execution needed
            tokens_used: 0
          }
        }
      };
    }

    // Cache miss - will execute normally
    // After execution, cache the result
    context.afterStepComplete(async (output) => {
      if (output.metadata.success) {
        await this.cacheManager.set(cacheKey, {
          data: output.data,
          metadata: output.metadata
        }, ttl_seconds);
      }
    });
  }

  return { modified: false };
}
```

#### Example 4: auto_approval

```typescript
async applyRule(
  rule: BehaviorRule,
  step: WorkflowStep,
  context: ExecutionContext
): Promise<RuleApplicationResult> {
  if (
    rule.rule_type === 'auto_approval' &&
    step.type === 'human_approval'
  ) {
    const { conditions, reason } = rule.action.params;

    // Evaluate all conditions
    const allConditionsMet = conditions.every(condition => {
      const value = context.resolveVariable(`{{${condition.field}}}`);
      return this.evaluateCondition(value, condition.operator, condition.value);
    });

    if (allConditionsMet) {
      // Auto-approve
      console.log(`Auto-approved by rule: ${rule.name}`);

      return {
        modified: true,
        action: 'auto_approve',
        output: {
          stepId: step.id,
          data: {
            approved: true,
            auto_approved: true,
            approval_reason: reason,
            rule_id: rule.id
          },
          metadata: {
            success: true,
            auto_approved: true,
            execution_time: 0
          }
        }
      };
    }
  }

  return { modified: false };
}
```

---

## 🎯 RULE PRIORITY & CONFLICT RESOLUTION

### When Multiple Rules Match

**Scenario:** Two rules both match the same step

```typescript
Rule A: {
  priority: 200,
  rule_type: 'skip_on_empty',
  trigger: { step_pattern: 'gmail_*' }
}

Rule B: {
  priority: 100,
  rule_type: 'cache_result',
  trigger: { step_pattern: 'gmail_search' }
}
```

**Resolution:**
1. Rules sorted by priority (highest first)
2. Rule A applied first (priority 200)
3. If Rule A skips the step, Rule B never runs
4. If Rule A doesn't modify, Rule B is checked next

### Priority Recommendations

```typescript
Priority Bands:
- 300-400: Critical safety rules (prevent data loss, stop dangerous operations)
- 200-299: Error recovery rules (retries, fallbacks)
- 100-199: Optimization rules (caching, parallelization)
- 50-99:  User preference rules (notifications, auto-approvals)
- 1-49:   Default behaviors
```

### Conflict Detection

```typescript
class MemoryManager {
  async detectConflicts(newRule: BehaviorRule): Promise<Conflict[]> {
    // Find rules that might conflict
    const existingRules = await this.getApplicableRules({
      user_id: newRule.user_id,
      agent_id: newRule.agent_id,
      step: { id: 'test', ...newRule.trigger_condition.step_pattern }
    });

    const conflicts: Conflict[] = [];

    for (const existing of existingRules) {
      // Check for contradictory actions
      if (
        newRule.action.type === 'continue' &&
        existing.action.type === 'stop'
      ) {
        conflicts.push({
          type: 'contradictory_action',
          rule1: existing,
          rule2: newRule,
          resolution: existing.priority > newRule.priority
            ? 'Existing rule will take precedence'
            : 'New rule will take precedence'
        });
      }

      // Check for redundant rules
      if (this.areRulesSimilar(newRule, existing)) {
        conflicts.push({
          type: 'redundant',
          rule1: existing,
          rule2: newRule,
          resolution: 'Consider updating existing rule instead'
        });
      }
    }

    return conflicts;
  }
}
```

---

## 📈 RULE EFFECTIVENESS TRACKING

### Measuring Rule Impact

```typescript
interface RuleEffectivenessMetrics {
  rule_id: string;

  // Application stats
  applied_count: number;
  success_count: number;  // Times rule helped
  failure_count: number;  // Times rule caused issues

  // Business impact
  tokens_saved: number;
  cost_saved_usd: number;
  time_saved_ms: number;
  errors_prevented: number;

  // Calculated score
  effectiveness_score: number;  // 0.0 - 1.0
  confidence_level: 'low' | 'medium' | 'high';

  // Temporal
  first_applied: Date;
  last_applied: Date;
  last_30_days_applications: number;
}
```

### Effectiveness Score Calculation

```typescript
function calculateEffectivenessScore(rule: BehaviorRule): number {
  const { applied_count, success_count, failure_count } = rule;

  if (applied_count === 0) return 0.5;  // Neutral (untested)

  // Success rate
  const successRate = success_count / applied_count;

  // Failure penalty
  const failurePenalty = (failure_count / applied_count) * 0.5;

  // Final score
  const score = Math.max(0, Math.min(1, successRate - failurePenalty));

  return score;
}
```

### Auto-Disable Low-Performing Rules

```typescript
class MemoryManager {
  async evaluateRuleEffectiveness() {
    const rules = await db.behaviorRules.findMany({
      where: { status: 'active' }
    });

    for (const rule of rules) {
      const score = calculateEffectivenessScore(rule);

      // Disable rule if:
      // 1. Applied at least 10 times (enough data)
      // 2. Effectiveness < 0.3 (poor performance)
      if (rule.applied_count >= 10 && score < 0.3) {
        await db.behaviorRules.update({
          where: { id: rule.id },
          data: {
            status: 'inactive',
            effectiveness_score: score,
            deactivated_reason: 'Low effectiveness score',
            deactivated_at: new Date()
          }
        });

        // Notify user
        await this.notificationService.send({
          user_id: rule.user_id,
          type: 'rule_auto_disabled',
          title: 'Behavior rule disabled',
          message: `Rule "${rule.name}" was automatically disabled due to low effectiveness (${(score * 100).toFixed(0)}% success rate)`
        });
      }
    }
  }
}
```

---

## 🔒 PRIVACY & SECURITY

### What Rules CAN Store

✅ **Allowed:**
- Decision metadata (continue, stop, skip)
- Field names and structure (not values)
- Conditions and thresholds (amount < 50)
- Timing preferences (cache 5 minutes)
- Error patterns (429, 503)

### What Rules CANNOT Store

❌ **Forbidden:**
- Email bodies, subjects, or content
- CRM record details
- User messages
- File contents
- API responses
- Any PII or business data

### Example: Safe vs Unsafe Rules

**✅ Safe Rule:**
```typescript
{
  rule_type: 'auto_approval',
  trigger_condition: {
    step_pattern: 'approve_expense',
    data_pattern: {
      field: 'amount',  // Field name OK
      operator: '<',
      value: 50  // Threshold OK
    }
  },
  action: {
    type: 'auto_approve',
    params: {
      reason: 'Under threshold'  // Generic reason OK
    }
  }
}
```

**❌ Unsafe Rule (DO NOT CREATE):**
```typescript
{
  rule_type: 'auto_approval',
  trigger_condition: {
    step_pattern: 'approve_expense',
    data_pattern: {
      field: 'submitter_email',
      operator: '==',
      value: 'john@company.com'  // ⚠️ Stores PII
    }
  },
  action: {
    type: 'auto_approve',
    params: {
      cached_expense_details: {  // ⚠️ Stores business data
        description: 'Office supplies',
        vendor: 'Staples'
      }
    }
  }
}
```

---

## 🛠️ RULE MANAGEMENT UI

### User Interface for Rules

**Location:** `/app/v2/settings/behavior-rules/page.tsx`

**Features:**
1. **View all rules** - Table with filters
2. **Create new rule** - Form with validation
3. **Edit existing rule** - Inline editing
4. **Delete rule** - With confirmation
5. **Enable/disable** - Toggle status
6. **View effectiveness** - Metrics dashboard
7. **Conflict warnings** - When creating/editing

### Example UI Component

```tsx
// components/v2/settings/BehaviorRulesList.tsx

export function BehaviorRulesList() {
  const { data: rules } = useQuery({
    queryKey: ['behavior-rules'],
    queryFn: () => fetch('/api/v6/behavior-rules').then(r => r.json())
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Behavior Rules</h2>
        <button onClick={createNewRule}>Create Rule</button>
      </div>

      <div className="grid gap-4">
        {rules.map(rule => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
      </div>
    </div>
  );
}

function RuleCard({ rule }: { rule: BehaviorRule }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{rule.name}</h3>
            <Badge variant={rule.status === 'active' ? 'success' : 'secondary'}>
              {rule.status}
            </Badge>
            <Badge variant="outline">{rule.rule_type}</Badge>
          </div>

          <p className="text-sm text-gray-600 mt-1">{rule.description}</p>

          <div className="flex gap-4 mt-3 text-sm">
            <span>
              Applied: <strong>{rule.applied_count}</strong> times
            </span>
            <span>
              Success Rate: <strong>{calculateSuccessRate(rule)}%</strong>
            </span>
            {rule.effectiveness_score && (
              <span>
                Effectiveness: <strong>{(rule.effectiveness_score * 100).toFixed(0)}%</strong>
              </span>
            )}
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Trigger: {formatTriggerCondition(rule.trigger_condition)}
            <br />
            Action: {formatAction(rule.action)}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => editRule(rule)}>Edit</button>
          <button onClick={() => toggleRule(rule)}>
            {rule.status === 'active' ? 'Disable' : 'Enable'}
          </button>
          <button onClick={() => deleteRule(rule)}>Delete</button>
        </div>
      </div>
    </Card>
  );
}
```

---

## 🚀 ADVANCED PATTERNS

### Pattern 1: Conditional Rules (Rule Chains)

```typescript
// Rule 1: If Gmail empty, try Outlook
{
  rule_type: 'data_fallback',
  trigger_condition: {
    step_pattern: 'gmail_search',
    data_pattern: { field: 'emails', operator: 'empty' }
  },
  action: {
    type: 'fallback',
    params: {
      fallback_steps: [
        {
          id: 'outlook_search',
          type: 'action',
          plugin: 'outlook',
          action: 'search_emails'
        }
      ]
    }
  },
  priority: 150
}

// Rule 2: If Outlook also empty, alert
{
  rule_type: 'alert_on_condition',
  trigger_condition: {
    step_pattern: 'outlook_search',
    data_pattern: { field: 'emails', operator: 'empty' }
  },
  action: {
    type: 'alert',
    params: {
      message: 'No emails found in Gmail or Outlook',
      severity: 'high'
    }
  },
  priority: 140
}
```

### Pattern 2: Time-Based Rules

```typescript
// Only apply rule during business hours
{
  rule_type: 'rate_limit_pause',
  trigger_condition: {
    step_pattern: 'api_call_*',
    time_condition: {
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      hours: { start: 9, end: 17 },  // 9am - 5pm
      timezone: 'America/New_York'
    }
  },
  action: {
    type: 'delay',
    params: {
      delay_ms: 1000  // 1 second between calls
    }
  }
}
```

### Pattern 3: Context-Aware Rules

```typescript
// Different behavior for different users
{
  rule_type: 'auto_approval',
  trigger_condition: {
    step_pattern: 'approve_purchase',
    context_condition: {
      user_role: 'manager',  // Only for managers
      team: 'engineering'     // Only engineering team
    },
    data_pattern: {
      field: 'amount',
      operator: '<',
      value: 1000  // Managers can auto-approve up to $1000
    }
  },
  action: {
    type: 'auto_approve'
  }
}
```

### Pattern 4: Learning Rules (Effectiveness-Based)

```typescript
// Start with conservative settings, adjust based on success
{
  rule_type: 'auto_retry',
  trigger_condition: {
    step_pattern: 'external_api_*',
    error_pattern: '5\\d\\d'  // 500-599 errors
  },
  action: {
    type: 'retry',
    params: {
      // Initial conservative values
      max_attempts: 2,
      backoff_ms: 5000,

      // Adaptive: If success_rate > 0.8 after 10 applications, increase attempts
      adaptive_threshold: {
        applications: 10,
        success_rate: 0.8,
        adjust: {
          max_attempts: 4  // Increase to 4 attempts
        }
      }
    }
  }
}
```

---

## 📊 ANALYTICS & REPORTING

### Rule Impact Dashboard

```typescript
interface RuleDashboardMetrics {
  // Aggregate metrics
  total_rules: number;
  active_rules: number;
  total_applications: number;

  // Cost savings
  total_tokens_saved: number;
  total_cost_saved_usd: number;
  total_time_saved_hours: number;

  // Effectiveness
  average_effectiveness_score: number;
  high_performing_rules: number;  // Score > 0.8
  low_performing_rules: number;   // Score < 0.3

  // Top rules
  most_applied_rules: Array<{ rule: BehaviorRule; count: number }>;
  highest_savings_rules: Array<{ rule: BehaviorRule; savings_usd: number }>;

  // Timeline
  applications_over_time: Array<{ date: Date; count: number }>;
  savings_over_time: Array<{ date: Date; savings_usd: number }>;
}
```

---

## ✅ SUMMARY

### Memory Rules Enable

1. **✅ No repeated questions** - Ask once, remember forever
2. **✅ Deterministic behavior** - Same inputs = same outputs
3. **✅ Continuous improvement** - Agents get more reliable over time
4. **✅ User control** - View, edit, disable any rule
5. **✅ Privacy-safe** - No client data stored
6. **✅ Transparent** - Every decision is auditable
7. **✅ Measurable** - Track effectiveness and ROI

### Key Concepts Recap

| Concept | Purpose | Example |
|---------|---------|---------|
| **BehaviorRule** | Store user decisions | "Continue when Gmail empty" |
| **Trigger Condition** | When to apply rule | "Step = gmail_search AND emails = []" |
| **Rule Action** | What to do | "Continue execution" |
| **Priority** | Conflict resolution | "Higher priority wins" |
| **Effectiveness Score** | Measure impact | "0.85 = 85% success rate" |
| **Rule Sources** | Where rules come from | User decision, Insight, Shadow Agent, Manual |

---

**END OF DOCUMENT**
