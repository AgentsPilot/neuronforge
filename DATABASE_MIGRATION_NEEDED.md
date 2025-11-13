# 🔧 Database Migration Required

## Issue
Token reconciliation is failing because the `token_usage` table is missing the `execution_id` column.

## Quick Fix (1 minute)

### Go to Supabase Dashboard → SQL Editor

Paste and run this SQL:

```sql
-- Add execution_id column to token_usage table
ALTER TABLE token_usage
ADD COLUMN IF NOT EXISTS execution_id UUID;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_token_usage_execution_id
ON token_usage(execution_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_agent_execution
ON token_usage(agent_id, execution_id);
```

## Then Test

After running the migration, run the Email Summary Agent again and you should see:

```
✅ [WorkflowPilot] Token reconciliation passed
```

Instead of:

```
❌ column token_usage.execution_id does not exist
```

## Current Status

✅ **P0 Fix #1**: Plugin action tracking - **WORKING**
✅ **P0 Fix #2**: Token de-duplication - **WORKING**
❌ **P0 Fix #3**: Token reconciliation - **BLOCKED** (needs migration)
✅ **P0 Fix #4**: Intent classification - **WORKING**
✅ **P0 Fix #5**: Standardized tokens - **WORKING**

Once migration is applied: **ALL P0 FIXES COMPLETE** ✅
