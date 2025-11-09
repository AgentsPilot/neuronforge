# Agent Sharing System Troubleshooting Guide

**Date**: 2025-11-02

---

## How Agent Sharing Works

### Flow Overview

```
1. User clicks "Share" button on agent page
   ↓
2. checkSharingEligibility() validates agent
   ↓
3. Show Share Confirmation Modal
   ↓
4. User confirms → handleShareAgent()
   ↓
5. Insert into shared_agents table
   ↓
6. Award credits via RewardService
   ↓
7. Show success notification
```

---

## Validation Requirements

### Agent Quality Requirements

**File**: [lib/credits/agentSharingValidation.ts:106-213](../lib/credits/agentSharingValidation.ts#L106-L213)

1. **Agent Age**: Must be at least **1 hour old** (configurable)
   - Prevents spam/immediate sharing of new agents
   - Check: `agent.created_at` vs current time

2. **Description Length**: Must have at least **20 characters** (configurable)
   - Ensures quality descriptions for community
   - Check: `agent.description?.trim().length`

3. **Minimum Executions**: Must have at least **3 successful test runs** (configurable)
   - From `agent_executions` table
   - Check: `SELECT COUNT(*) FROM agent_executions WHERE agent_id = ?`

4. **Success Rate**: Must have at least **66% success rate** (configurable)
   - Calculated from `agent_executions.status`
   - Accepts: 'success', 'completed', or 'finished' as successful
   - Check: `(successful_executions / total_executions) * 100 >= 66`

### User Limits

**File**: [lib/credits/agentSharingValidation.ts:218-288](../lib/credits/agentSharingValidation.ts#L218-L288)

1. **Daily Limit**: Max **5 shares per 24 hours** (configurable via `reward_config.max_per_user_per_day`)
2. **Monthly Limit**: Max **20 shares per 30 days** (configurable)
3. **Lifetime Limit**: Max **100 shares total** (configurable)

### Already Shared Check

**File**: [lib/credits/agentSharingValidation.ts:293-312](../lib/credits/agentSharingValidation.ts#L293-L312)

- Each agent can only be shared **once per user**
- Check: `shared_agents` table for existing `original_agent_id + user_id` combo

---

## Configuration System

### Database Tables

#### 1. `reward_config` (Main Reward Settings)
- Contains the `agent_sharing` reward
- Fields:
  - `is_active`: Must be `true` for sharing to work
  - `credits_amount`: How many credits awarded
  - `max_per_user_per_day`: Daily share limit (e.g., 5)

#### 2. `reward_settings` (Detailed Validation Rules)
- Linked to `reward_config` via `reward_config_id`
- Fields:
  - `min_executions`: Required test runs (default: 3)
  - `min_success_rate`: Required success % (default: 66)
  - `require_description`: Must have description (default: true)
  - `min_description_length`: Min chars (default: 20)
  - `min_agent_age_hours`: Minimum age (default: 1)
  - `max_shares_per_month`: Monthly limit (default: 20)
  - `max_total_shares`: Lifetime limit (default: 100)

---

## Common Issues & Solutions

### Issue 1: "Share" Button Not Visible

**Symptoms**:
- Share button doesn't appear in agent header
- No way to share agent

**Possible Causes**:

1. **Reward is inactive**
   ```typescript
   // Check in reward-config page or database
   SELECT is_active FROM reward_config WHERE reward_key = 'agent_sharing';
   // Should be: true
   ```

2. **Agent status is not 'active'**
   ```typescript
   // Share button only shown when agent.status === 'active'
   // File: app/(protected)/agents/[id]/page.tsx:1011
   disabled={agent.status !== 'active'}
   ```

3. **Already shared**
   ```typescript
   // hasBeenShared state is true
   // File: app/(protected)/agents/[id]/page.tsx:1012-1026
   ```

4. **Not the owner**
   ```typescript
   // isOwner must be true && !isSharedAgent
   // File: app/(protected)/agents/[id]/page.tsx:983-984
   ```

---

### Issue 2: "Cannot Share Yet" Error

**Symptoms**:
- Share button visible
- Modal shows red error: "Cannot Share Yet"
- Shows specific reason

**Debug Steps**:

1. **Check Browser Console**
   ```javascript
   // Look for logs from AgentSharingValidator
   // File: lib/credits/agentSharingValidation.ts:110-211
   🔍 [Validator] Validating agent quality for: {agentId}
   📊 [Validator] Agent data: {...}
   ⏰ [Validator] Agent age: X.XXh (required: 1h)
   📈 [Validator] Execution stats: {...}
   ```

2. **Check Agent Age**
   ```sql
   SELECT
     agent_name,
     created_at,
     EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as age_hours
   FROM agents
   WHERE id = '{agentId}';

   -- age_hours must be >= 1
   ```

3. **Check Description Length**
   ```sql
   SELECT
     agent_name,
     LENGTH(TRIM(description)) as desc_length
   FROM agents
   WHERE id = '{agentId}';

   -- desc_length must be >= 20
   ```

4. **Check Execution Count**
   ```sql
   SELECT
     COUNT(*) as total_executions,
     COUNT(*) FILTER (WHERE status IN ('success', 'completed', 'finished')) as successful_executions,
     (COUNT(*) FILTER (WHERE status IN ('success', 'completed', 'finished'))::float / NULLIF(COUNT(*), 0) * 100) as success_rate
   FROM agent_executions
   WHERE agent_id = '{agentId}';

   -- total_executions must be >= 3
   -- success_rate must be >= 66
   ```

5. **Check Reward Settings**
   ```sql
   SELECT
     rc.reward_key,
     rc.is_active,
     rc.max_per_user_per_day,
     rs.*
   FROM reward_config rc
   LEFT JOIN reward_settings rs ON rs.reward_config_id = rc.id
   WHERE rc.reward_key = 'agent_sharing';
   ```

---

### Issue 3: "Already Shared" Error

**Symptoms**:
- Modal shows amber warning: "Already Shared"
- Message: "This assistant has already been shared with the community"

**Cause**:
Agent has already been shared by this user.

**Check**:
```sql
SELECT
  sa.id,
  sa.shared_at,
  sa.original_agent_id,
  a.agent_name
FROM shared_agents sa
JOIN agents a ON a.id = sa.original_agent_id
WHERE sa.user_id = '{userId}'
AND sa.original_agent_id = '{agentId}';
```

**Note**: This is BY DESIGN. Each agent can only be shared once per user to prevent reward farming.

---

### Issue 4: Daily/Monthly Limit Reached

**Symptoms**:
- Modal shows: "Daily share limit reached (5 per day)"
- Or: "Monthly share limit reached (20 per month)"

**Check Daily Shares**:
```sql
SELECT
  COUNT(*) as shares_last_24h,
  MAX(shared_at) as most_recent_share
FROM shared_agents
WHERE user_id = '{userId}'
AND shared_at >= NOW() - INTERVAL '24 hours';
```

**Check Monthly Shares**:
```sql
SELECT
  COUNT(*) as shares_last_30d
FROM shared_agents
WHERE user_id = '{userId}'
AND shared_at >= NOW() - INTERVAL '30 days';
```

**Solution**: Wait for cooldown period to expire, or contact admin to adjust limits.

---

### Issue 5: Console Errors

**Common Console Errors**:

1. **"Error fetching agent execution history"**
   - Database query failed
   - Check RLS policies on `agent_executions` table
   - Check user has permission to read their own executions

2. **"Error checking if agent already shared"**
   - Database query failed
   - Check RLS policies on `shared_agents` table

3. **"Error sharing agent to shared_agents table"**
   - Insert failed
   - Check RLS policies allow insert
   - Check required fields are provided

---

## How to Test Sharing Manually

### Step 1: Verify Reward is Active

```sql
-- Check reward exists and is active
SELECT
  reward_key,
  is_active,
  credits_amount,
  max_per_user_per_day
FROM reward_config
WHERE reward_key = 'agent_sharing';

-- Should return 1 row with is_active = true
```

### Step 2: Check Agent Meets Requirements

```sql
-- Check agent details
SELECT
  id,
  agent_name,
  status,
  LENGTH(TRIM(description)) as desc_length,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as age_hours
FROM agents
WHERE id = '{agentId}';

-- Requirements:
-- status = 'active'
-- desc_length >= 20
-- age_hours >= 1
```

### Step 3: Check Execution History

```sql
-- Check execution stats
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status IN ('success', 'completed', 'finished')) as successful,
  (COUNT(*) FILTER (WHERE status IN ('success', 'completed', 'finished'))::float / NULLIF(COUNT(*), 0) * 100) as success_rate
FROM agent_executions
WHERE agent_id = '{agentId}';

-- Requirements:
-- total >= 3
-- success_rate >= 66
```

### Step 4: Check User Hasn't Already Shared

```sql
-- Check if already shared
SELECT id, shared_at
FROM shared_agents
WHERE user_id = '{userId}'
AND original_agent_id = '{agentId}';

-- Should return 0 rows
```

### Step 5: Check User Limits

```sql
-- Check daily limit
SELECT COUNT(*) as shares_today
FROM shared_agents
WHERE user_id = '{userId}'
AND shared_at >= NOW() - INTERVAL '24 hours';
-- Should be < max_per_user_per_day

-- Check monthly limit
SELECT COUNT(*) as shares_this_month
FROM shared_agents
WHERE user_id = '{userId}'
AND shared_at >= NOW() - INTERVAL '30 days';
-- Should be < max_shares_per_month

-- Check lifetime limit
SELECT COUNT(*) as total_shares
FROM shared_agents
WHERE user_id = '{userId}';
-- Should be < max_total_shares
```

---

## Debugging Workflow

### 1. Open Browser Console

Press `F12` → Console tab

### 2. Try to Share Agent

Click the Share button

### 3. Look for Validation Logs

```
🔍 [Validator] Validating agent quality for: {agentId}
📊 [Validator] Agent data: {name, created, descLength}
⏰ [Validator] Agent age: X.XXh (required: 1h)
📈 [Validator] Execution stats: {total, successful, successRate, required}
```

### 4. Identify Failed Check

Look for the FIRST validation that returns `valid: false`

### 5. Fix the Issue

Based on the failed check:

- **Age < 1 hour**: Wait or adjust `min_agent_age_hours` in reward settings
- **Description too short**: Edit agent, add longer description
- **Not enough executions**: Run agent more times (need 3+)
- **Low success rate**: Fix agent issues, run more successful tests
- **Already shared**: Can't share again (by design)
- **Limit reached**: Wait for cooldown or contact admin

---

## Admin Override (Emergency)

If you need to adjust validation rules:

1. **Go to Admin → Reward Config**
2. **Find "Agent Sharing" reward**
3. **Click "Sharing Requirements"**
4. **Click "Edit"**
5. **Adjust values**:
   - Lower `Min Executions` (e.g., 1 instead of 3)
   - Lower `Min Success Rate` (e.g., 50% instead of 66%)
   - Lower `Min Description Length` (e.g., 10 instead of 20)
   - Lower `Min Agent Age` (e.g., 0.1 hours instead of 1)
6. **Click "Save Settings"**

---

## What Happens When You Share

### 1. Validation Phase

```typescript
// File: lib/credits/agentSharingValidation.ts:317-347
const validator = new AgentSharingValidator(supabase)
const validation = await validator.validateSharing(userId, agentId)

if (!validation.valid) {
  // Show error in modal
  return
}
```

### 2. Insert into shared_agents

```typescript
// File: app/(protected)/agents/[id]/page.tsx:718-732
await supabase.from('shared_agents').insert([{
  original_agent_id: agent.id,
  user_id: user.id,
  agent_name: agent.agent_name,
  description: agent.description,
  user_prompt: agent.user_prompt,
  system_prompt: agent.system_prompt,
  input_schema: agent.input_schema,
  output_schema: agent.output_schema,
  plugins_required: agent.plugins_required,
  workflow_steps: agent.workflow_steps,
  mode: agent.mode,
  shared_at: new Date().toISOString()
}])
```

### 3. Award Credits

```typescript
// File: app/(protected)/agents/[id]/page.tsx:739-756
const rewardResult = await rewardService.awardCredits(
  user.id,
  'agent_sharing',
  {
    agent_id: agent.id,
    agent_name: agent.agent_name
  }
)

if (rewardResult.success) {
  setCreditsAwarded(rewardResult.creditsAwarded || 0)
  setShowSuccessNotification(true)
}
```

### 4. Update UI State

```typescript
setHasBeenShared(true)
setShowSuccessNotification(true)
setCreditsAwarded(amount)
```

---

## Summary Checklist

To share an agent, ALL of these must be true:

- [ ] Reward `agent_sharing` exists in `reward_config` table
- [ ] Reward `is_active = true`
- [ ] Agent `status = 'active'`
- [ ] Agent age >= 1 hour
- [ ] Agent description length >= 20 characters
- [ ] Agent has >= 3 total executions (from `agent_executions`)
- [ ] Agent success rate >= 66%
- [ ] Agent not already shared by this user
- [ ] User hasn't reached daily limit (5/day)
- [ ] User hasn't reached monthly limit (20/month)
- [ ] User hasn't reached lifetime limit (100 total)
- [ ] User is the owner (not viewing a shared agent)
- [ ] Share button is visible (not hidden by feature flag)

---

## Quick Diagnostic SQL

Run this query to check everything at once:

```sql
WITH agent_info AS (
  SELECT
    a.id,
    a.agent_name,
    a.status,
    LENGTH(TRIM(a.description)) as desc_length,
    EXTRACT(EPOCH FROM (NOW() - a.created_at))/3600 as age_hours,
    a.user_id
  FROM agents a
  WHERE a.id = '{agentId}'
),
execution_stats AS (
  SELECT
    agent_id,
    COUNT(*) as total_executions,
    COUNT(*) FILTER (WHERE status IN ('success', 'completed', 'finished')) as successful_executions,
    (COUNT(*) FILTER (WHERE status IN ('success', 'completed', 'finished'))::float / NULLIF(COUNT(*), 0) * 100) as success_rate
  FROM agent_executions
  WHERE agent_id = '{agentId}'
  GROUP BY agent_id
),
sharing_status AS (
  SELECT
    CASE WHEN COUNT(*) > 0 THEN true ELSE false END as already_shared
  FROM shared_agents
  WHERE user_id = '{userId}'
  AND original_agent_id = '{agentId}'
),
user_limits AS (
  SELECT
    COUNT(*) FILTER (WHERE shared_at >= NOW() - INTERVAL '24 hours') as shares_last_24h,
    COUNT(*) FILTER (WHERE shared_at >= NOW() - INTERVAL '30 days') as shares_last_30d,
    COUNT(*) as total_shares
  FROM shared_agents
  WHERE user_id = '{userId}'
),
reward_status AS (
  SELECT
    rc.is_active as reward_active,
    rc.credits_amount,
    rc.max_per_user_per_day,
    rs.min_executions,
    rs.min_success_rate,
    rs.min_description_length,
    rs.min_agent_age_hours,
    rs.max_shares_per_month,
    rs.max_total_shares
  FROM reward_config rc
  LEFT JOIN reward_settings rs ON rs.reward_config_id = rc.id
  WHERE rc.reward_key = 'agent_sharing'
)
SELECT
  ai.agent_name,
  ai.status as agent_status,
  ai.desc_length >= rs.min_description_length as desc_ok,
  ai.age_hours >= rs.min_agent_age_hours as age_ok,
  es.total_executions >= rs.min_executions as executions_ok,
  es.success_rate >= rs.min_success_rate as success_rate_ok,
  NOT ss.already_shared as not_shared_yet,
  ul.shares_last_24h < rs.max_per_user_per_day as daily_limit_ok,
  ul.shares_last_30d < rs.max_shares_per_month as monthly_limit_ok,
  ul.total_shares < rs.max_total_shares as lifetime_limit_ok,
  rs.reward_active,
  -- Details
  ai.desc_length,
  rs.min_description_length,
  ai.age_hours,
  rs.min_agent_age_hours,
  es.total_executions,
  rs.min_executions,
  es.success_rate,
  rs.min_success_rate,
  ul.shares_last_24h,
  rs.max_per_user_per_day,
  ul.shares_last_30d,
  rs.max_shares_per_month,
  ul.total_shares,
  rs.max_total_shares
FROM agent_info ai
CROSS JOIN execution_stats es
CROSS JOIN sharing_status ss
CROSS JOIN user_limits ul
CROSS JOIN reward_status rs;
```

All `_ok` columns should be `true` for sharing to work.
